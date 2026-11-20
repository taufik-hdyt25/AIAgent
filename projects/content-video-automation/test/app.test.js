import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createServer } from '../src/server.js';

test('health, persistent job creation, listing and validation', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'content-studio-'));
  const server = createServer({ dataDir });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    const invalid = await fetch(`${base}/api/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic: 'x' }) });
    assert.equal(invalid.status, 400);
    const created = await fetch(`${base}/api/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ topic: 'Ide video untuk test' }) });
    assert.equal(created.status, 201);
    const job = (await created.json()).job;
    assert.equal(job.status, 'queued');
    const list = await (await fetch(`${base}/api/jobs`)).json();
    assert.equal(list.jobs[0].id, job.id);
    const traversal = await fetch(`${base}/..%2fpackage.json`);
    assert.notEqual(traversal.status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
