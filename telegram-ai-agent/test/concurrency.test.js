import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConversationKey,
  clearActiveTask,
  getActiveTask,
  getActiveTaskForConversation,
  getActiveTasks,
  getLockedProjects,
  isConversationBusy,
  releaseConversationReservation,
  setActiveTask,
  tryReserveConversation,
} from "../src/services/cli-runner.js";
import {
  clearQueue,
  enqueueTask,
  processNextQueue,
  registerQueueExecutor,
} from "../src/services/queue-service.js";

function makeCtx(chatId, threadId = null) {
  return {
    chat: { id: chatId },
    from: { id: chatId, username: `user${chatId}` },
    message: { message_id: 1, message_thread_id: threadId },
    reply: async () => {},
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

test("conversation key separates chat and forum topic", () => {
  assert.equal(buildConversationKey(100, null), "100:0");
  assert.equal(buildConversationKey(100, 7), "100:7");
  assert.notEqual(buildConversationKey(100, 7), buildConversationKey(100, 8));
  assert.notEqual(buildConversationKey(100, null), buildConversationKey(101, null));
});

test("active tasks are tracked per conversation", () => {
  clearActiveTask();
  const keyA = buildConversationKey(1, null);
  const keyB = buildConversationKey(-100, 42);

  setActiveTask({ id: "task-a", chatId: 1, threadId: null, startedAt: 1, targetProject: "proj-a" });
  setActiveTask({ id: "task-b", chatId: -100, threadId: 42, startedAt: 2, targetProject: "proj-b" });

  assert.equal(getActiveTasks().length, 2);
  assert.equal(getActiveTaskForConversation(keyA).id, "task-a");
  assert.equal(getActiveTaskForConversation(keyB).id, "task-b");
  assert.equal(getActiveTaskForConversation(buildConversationKey(2, null)), null);
  assert.equal(getActiveTask().id, "task-b");
  assert.deepEqual([...getLockedProjects()].sort(), ["proj-a", "proj-b"]);

  clearActiveTask("task-a");
  assert.equal(getActiveTaskForConversation(keyA), null);
  assert.equal(getActiveTasks().length, 1);
  clearActiveTask();
  assert.equal(getActiveTasks().length, 0);
});

test("conversation reservation blocks a second start for the same chat", () => {
  clearActiveTask();
  const key = buildConversationKey(5, null);
  assert.equal(tryReserveConversation(key), true);
  assert.equal(tryReserveConversation(key), false);
  assert.equal(isConversationBusy(key), true);
  releaseConversationReservation(key);
  assert.equal(isConversationBusy(key), false);
});

test("queue runs different conversations in parallel and serializes the same conversation", async () => {
  clearActiveTask();
  clearQueue();

  const keyA = buildConversationKey(200, null);
  const keyB = buildConversationKey(-300, 9);
  const ctxA = makeCtx(200);
  const ctxB = makeCtx(-300, 9);

  const started = [];
  let releaseA;
  const gateA = new Promise((resolve) => {
    releaseA = resolve;
  });

  registerQueueExecutor(async (item) => {
    started.push(item.userMessage);
    if (item.userMessage === "a-1") await gateA;
  });

  enqueueTask({ userMessage: "a-1", ctx: ctxA });
  enqueueTask({ userMessage: "a-2", ctx: ctxA });
  enqueueTask({ userMessage: "b-1", ctx: ctxB });

  await processNextQueue();
  await flush();

  assert.deepEqual(started.sort(), ["a-1", "b-1"]);

  releaseA();
  await flush();

  assert.deepEqual(started.sort(), ["a-1", "a-2", "b-1"]);
  assert.equal(isConversationBusy(keyA), false);
  assert.equal(isConversationBusy(keyB), false);
  clearQueue();
});

test("queue defers items whose project is locked by another conversation", async () => {
  clearActiveTask();
  clearQueue();

  const ctx = makeCtx(400);
  const started = [];
  registerQueueExecutor(async (item) => {
    started.push(item.userMessage);
  });

  setActiveTask({
    id: "locked-task",
    chatId: 999,
    threadId: null,
    startedAt: Date.now(),
    targetProject: "th-blog",
  });

  enqueueTask({ userMessage: "touch blog", ctx, targetProject: "th-blog" });
  await processNextQueue();
  await flush();
  assert.equal(started.length, 0);

  clearActiveTask("locked-task");
  await processNextQueue();
  await flush();
  assert.deepEqual(started, ["touch blog"]);

  clearQueue();
});
