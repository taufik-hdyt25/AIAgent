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

test('long replies are split without dropping any content', async () => {
  const sent = [];
  const ctx = { message: { message_id: 9 }, reply: async (text, options) => sent.push({ text, options }) };
  const paragraphs = Array.from({ length: 40 }, (_, i) => `Bagian ${i + 1}: ${'x'.repeat(300)}`).join('\n\n');
  await sendSmartReply(ctx, paragraphs);

  assert.ok(sent.length > 2);
  assert.ok(sent.every((item) => item.text.length <= 4096));

  const joined = sent.map((item) => item.text).join('\n\n');
  for (let i = 1; i <= 40; i++) {
    assert.match(joined, new RegExp(`Bagian ${i}\\b`), `missing Bagian ${i}`);
  }
});
