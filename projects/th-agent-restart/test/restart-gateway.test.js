import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('health is public; restart requires token and does not accept GET', async () => {
  const port = 39000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['src/server.js'], { cwd: projectDir, env: { ...process.env, PORT: String(port), RESTART_TOKEN: 'test-token' }, stdio: 'ignore' });
  try {
    await new Promise(async (resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`gateway exited ${code}`)));
      for (let i = 0; i < 60; i++) {
        try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return resolve(); } catch {}
        await delay(50);
      }
      reject(new Error('gateway did not start'));
    });
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.deepEqual(await health.json(), { ok: true });
    const unauthorized = await fetch(`http://127.0.0.1:${port}/v1/restart`, { method: 'POST' });
    assert.equal(unauthorized.status, 401);
    const wrongMethod = await fetch(`http://127.0.0.1:${port}/v1/restart`);
    assert.equal(wrongMethod.status, 404);
  } finally { child.kill('SIGTERM'); await once(child, 'exit').catch(() => {}); }
});
