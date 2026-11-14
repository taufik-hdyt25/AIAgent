import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

test('Get Model updates active provider and replaces stale user selections', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'th-model-test-'));
  try {
    await mkdir(path.join(dir, 'data'));
    await mkdir(path.join(dir, '.pi', 'agent'), { recursive: true });
    await writeFile(path.join(dir, '.env'), 'PI_PROVIDER=cliproxy\nPI_MODEL=old\n');
    await writeFile(path.join(dir, 'data', 'context.json'), JSON.stringify({ piModels: { 1: 'old' }, other: true }));
    await writeFile(path.join(dir, '.pi', 'agent', 'models.json'), JSON.stringify({ providers: { other: { models: [{ id: 'keep' }] }, cliproxy: { api: 'openai-completions', models: [{ id: 'old' }] } } }));
    const moduleUrl = pathToFileURL(path.resolve('src/services/pi-service.js')).href;
    const code = `globalThis.fetch = async () => ({ ok: true, json: async () => ({ data: [{ id: 'codex-model' }, { id: 'antigravity-model' }] }) }); const { syncPiModelDirectly } = await import(${JSON.stringify(moduleUrl)}); const result = await syncPiModelDirectly('http://example.test/v1', 'test-key', null); if (!result.ok || result.activeModel !== 'codex-model') process.exit(1);`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: dir, env: { ...process.env, HOME: dir, ENV_FILE: path.join(dir, '.env'), PI_PROVIDER: 'cliproxy', PI_MODEL: 'old', WORKSPACE_DIR: '' }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(await readFile(path.join(dir, '.pi', 'agent', 'models.json')));
    assert.deepEqual(config.providers.cliproxy.models.map(m => m.id), ['codex-model', 'antigravity-model']);
    assert.equal(config.providers.other.models[0].id, 'keep');
    const custom = JSON.parse(await readFile(path.join(dir, 'data', 'models.json')));
    assert.equal(custom.piProvider, 'cliproxy');
    const context = JSON.parse(await readFile(path.join(dir, 'data', 'context.json')));
    assert.equal(context.piModels, undefined);
    assert.equal(context.other, true);

    await writeFile(path.join(dir, 'data', 'context.json'), JSON.stringify({ piModels: { 1: 'codex-model', 2: 'old' } }));
    const autoCode = `const { syncCpaModelsIfActive } = await import(${JSON.stringify(moduleUrl)}); const result = await syncCpaModelsIfActive('http://example.test', [{ id: 'codex-model' }, { id: 'new-model' }]); if (!result.synced) throw new Error(JSON.stringify(result));`;
    const auto = spawnSync(process.execPath, ['--input-type=module', '-e', autoCode], { cwd: dir, env: { ...process.env, HOME: dir, ENV_FILE: path.join(dir, '.env'), PI_PROVIDER: 'cliproxy', PI_MODEL: 'codex-model', PI_SERVER_URL: 'http://example.test/v1', WORKSPACE_DIR: '' }, encoding: 'utf8' });
    assert.equal(auto.status, 0, auto.stderr);
    const updated = JSON.parse(await readFile(path.join(dir, 'data', 'context.json')));
    assert.deepEqual(updated.piModels, { 1: 'codex-model' });
    const synced = JSON.parse(await readFile(path.join(dir, '.pi', 'agent', 'models.json')));
    assert.deepEqual(synced.providers.cliproxy.models.map(m => m.id), ['codex-model', 'new-model']);
    await writeFile(path.join(dir, 'data', 'models.json'), JSON.stringify({ piProvider: 'cliproxy', piModels: [{ id: 'curated' }] }));
    const guardCode = `const { syncCpaModelsIfActive } = await import(${JSON.stringify(moduleUrl)}); const r = await syncCpaModelsIfActive('http://example.test', [{id:'new-model'}]); if (r.synced || !r.message.includes('kustom')) process.exit(1); const other = await syncCpaModelsIfActive('http://other.test', [{id:'x'}]); if (!other.skipped) process.exit(2);`;
    const guard = spawnSync(process.execPath, ['--input-type=module', '-e', guardCode], { cwd: dir, env: { ...process.env, HOME: dir, PI_PROVIDER: 'cliproxy', PI_SERVER_URL: 'http://example.test/v1' }, encoding: 'utf8' });
    assert.equal(guard.status, 0, guard.stderr);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
