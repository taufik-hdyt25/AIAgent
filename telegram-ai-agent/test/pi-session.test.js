import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const piServiceUrl = pathToFileURL(path.resolve('src/services/pi-service.js')).href;
const telegramFilesUrl = pathToFileURL(path.resolve('src/services/telegram-files.js')).href;

function runIsolated(dir, code) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: dir,
      DATA_DIR: path.join(dir, 'data'),
      ENV_FILE: path.join(dir, '.env'),
      PI_MODEL: '',
    },
    encoding: 'utf8',
  });
}

test('overflow detection recognizes provider context errors', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'th-pi-overflow-'));
  try {
    const code = `
      const m = await import(${JSON.stringify(piServiceUrl)});
      const hit = "400 Bad Request (stream): Your input exceeds the context window of this model. Please adjust your input and try again.";
      if (!m.isContextOverflowMessage(hit)) throw new Error('failed to detect overflow');
      if (!m.isContextOverflowMessage('context_length_exceeded')) throw new Error('failed to detect length error');
      if (!m.isContextOverflowMessage('This model maximum context length is 128000 tokens')) throw new Error('failed to detect max length');
      if (m.isContextOverflowMessage('401 Unauthorized')) throw new Error('false positive');
    `;
    const res = runIsolated(dir, code);
    assert.equal(res.status, 0, res.stderr);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sanitizePiSession removes inline base64 and clips giant messages', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'th-pi-sanitize-'));
  try {
    const code = `
      import { mkdir, writeFile, readFile } from 'node:fs/promises';
      import path from 'node:path';
      import os from 'node:os';
      const m = await import(${JSON.stringify(piServiceUrl)});

      const cwd = path.join(os.homedir(), 'workspace');
      await mkdir(cwd, { recursive: true });
      const normalized = path.resolve(cwd).replace(/^[/\\\\]+/, '').replace(/[/\\\\]/g, '-');
      const sessionDir = path.join(os.homedir(), '.pi', 'agent', 'sessions', '--' + normalized + '--');
      await mkdir(sessionDir, { recursive: true });
      const sessionId = 'conv-1-project';
      const file = path.join(sessionDir, '2026-01-01T00-00-00-000Z_' + sessionId + '.jsonl');

      const base64 = 'A'.repeat(2 * 1024 * 1024);
      const entries = [
        { type: 'session', id: 's1', parentId: null, timestamp: 't0' },
        { type: 'message', id: 'u1', parentId: 's1', message: { role: 'user', content: [{ type: 'text', text: 'halo, tolong buat mockup' }] } },
        { type: 'message', id: 'a1', parentId: 'u1', message: { role: 'assistant', content: [
          { type: 'thinking', thinking: 'rencana '.repeat(5000) },
          { type: 'text', text: '![generated image](data:image/png;base64,' + base64 + ')' },
        ] } },
        { type: 'message', id: 'u2', parentId: 'a1', message: { role: 'user', content: [{ type: 'text', text: 'lanjut bro' }] } },
      ];
      await writeFile(file, entries.map((e) => JSON.stringify(e)).join('\\n') + '\\n', 'utf8');

      const before = (await readFile(file, 'utf8')).length;
      const result = await m.sanitizePiSession(cwd, sessionId, { force: true });
      const afterText = await readFile(file, 'utf8');
      const after = afterText.length;

      if (result.changed !== 1) throw new Error('expected 1 changed entry, got ' + result.changed);
      if (!(after < before / 4)) throw new Error('file not shrunk enough: ' + before + ' -> ' + after);
      if (afterText.includes('base64,')) throw new Error('base64 payload still present');
      if (!afterText.includes('gambar inline base64 dihapus')) throw new Error('missing placeholder');
      if (!afterText.includes('halo, tolong buat mockup')) throw new Error('small message lost');
      if (!afterText.includes('lanjut bro')) throw new Error('latest user message lost');
      for (const line of afterText.split('\\n')) {
        if (!line.trim()) continue;
        const entry = JSON.parse(line);
        if (!entry.id) throw new Error('entry id lost');
      }
      const bigPart = JSON.parse(afterText.split('\\n')[2]).message.content.find((p) => p.type === 'text');
      if (bigPart.text.length > 13000) throw new Error('text part not clipped: ' + bigPart.text.length);
    `;
    const res = runIsolated(dir, code);
    assert.equal(res.status, 0, res.stderr);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sanitizeReplyText strips inline base64 images from chat replies', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'th-pi-reply-'));
  try {
    const code = `
      const m = await import(${JSON.stringify(telegramFilesUrl)});
      const payload = '![img](data:image/png;base64,' + 'A'.repeat(5000) + ')';
      const out = m.sanitizeReplyText('Hasil mockup:\\n' + payload + '\\nSelesai.');
      if (out.includes('base64,')) throw new Error('base64 still present');
      if (!out.includes('tidak ditampilkan di chat')) throw new Error('missing placeholder');
      if (!out.includes('Hasil mockup:') || !out.includes('Selesai.')) throw new Error('text lost');
      if (m.sanitizeReplyText('halo biasa') !== 'halo biasa') throw new Error('plain text changed');
    `;
    const res = runIsolated(dir, code);
    assert.equal(res.status, 0, res.stderr);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('prunePiSessionHistory keeps summary and latest messages with valid parent links', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'th-pi-prune-'));
  try {
    const code = `
      import { mkdir, writeFile, readFile } from 'node:fs/promises';
      import path from 'node:path';
      import os from 'node:os';
      const m = await import(${JSON.stringify(piServiceUrl)});

      const cwd = path.join(os.homedir(), 'workspace');
      await mkdir(cwd, { recursive: true });
      const normalized = path.resolve(cwd).replace(/^[/\\\\]+/, '').replace(/[/\\\\]/g, '-');
      const sessionDir = path.join(os.homedir(), '.pi', 'agent', 'sessions', '--' + normalized + '--');
      await mkdir(sessionDir, { recursive: true });
      const sessionId = 'conv-old';
      const file = path.join(sessionDir, '2026-01-01T00-00-00-000Z_' + sessionId + '.jsonl');

      const entries = [{ type: 'session', id: 's1', parentId: null }];
      let parent = 's1';
      for (let i = 0; i < 40; i++) {
        const id = 'm' + i;
        entries.push({ type: 'message', id, parentId: parent, message: { role: i % 2 ? 'assistant' : 'user', content: [{ type: 'text', text: 'pesan ' + i }] } });
        parent = id;
      }
      entries.push({ type: 'compaction', id: 'c1', parentId: parent, summary: 'ringkasan lama', firstKeptEntryId: 'm30' });
      await writeFile(file, entries.map((e) => JSON.stringify(e)).join('\\n') + '\\n', 'utf8');

      const result = await m.prunePiSessionHistory(cwd, sessionId, { keepMessages: 10 });
      if (result.pruned !== 30) throw new Error('expected 30 pruned, got ' + result.pruned);

      const lines = (await readFile(file, 'utf8')).split('\\n').filter(Boolean).map(JSON.parse);
      const ids = new Set(lines.map((e) => e.id));
      if (!ids.has('s1') || !ids.has('c1')) throw new Error('header/compaction missing');
      if (lines.filter((e) => e.type === 'message').length !== 10) throw new Error('wrong kept message count');
      for (const entry of lines) {
        if (entry.parentId && !ids.has(entry.parentId)) throw new Error('dangling parentId on ' + entry.id);
      }
      const messages = lines.filter((e) => e.type === 'message');
      if (!messages.some((e) => e.message.content[0].text === 'pesan 39')) throw new Error('latest message lost');
      if (!messages.some((e) => e.message.content[0].text === 'pesan 30')) throw new Error('kept window starts too late');
    `;
    const res = runIsolated(dir, code);
    assert.equal(res.status, 0, res.stderr);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
