import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTopicConversationId, buildTopicKey } from '../src/services/topic-service.js';
import { buildReplyOptions, sendSmartReply } from '../src/services/telegram-files.js';

test('conversation identity includes group and thread', () => {
  assert.notEqual(buildTopicConversationId('user', -100, 10), buildTopicConversationId('user', -101, 10));
  assert.notEqual(buildTopicConversationId('user', -100, 10), buildTopicConversationId('user', -100, 11));
  assert.equal(buildTopicConversationId('user', 123, null), 'user');
  assert.equal(buildTopicKey(-100, 10), '-100:10');
});

test('reply keeps topic for all message chunks', async () => {
  const sent = [];
  const ctx = { message: { message_id: 9, message_thread_id: 10 }, reply: async (text, options) => sent.push({ text, options }) };
  assert.equal(buildReplyOptions(ctx).message_thread_id, 10);
  await sendSmartReply(ctx, 'a'.repeat(8000));
  assert.ok(sent.length > 1);
  assert.ok(sent.every((item) => item.options.message_thread_id === 10));
});
