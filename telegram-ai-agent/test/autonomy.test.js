import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const autonomyUrl = pathToFileURL(path.resolve('src/services/autonomy-service.js')).href;
const swarmUrl = pathToFileURL(path.resolve('src/services/swarm-service.js')).href;

test('autonomy mode defaults to orchestrator and forbids confirmation questions', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'th-autonomy-test-'));
  try {
    await mkdir(path.join(dir, 'data'));
    const code = `
      const m = await import(${JSON.stringify(autonomyUrl)});
      const cfg = await m.getAutonomyConfig();
      if (cfg.mode !== 'orchestrator') throw new Error('default mode: ' + cfg.mode);
      const d = m.buildAutonomyDirective(cfg.mode);
      if (!d.includes('MODE ORKESTRATOR')) throw new Error('missing orchestrator directive');
      if (!d.includes('DILARANG meminta izin')) throw new Error('missing confirmation ban');
      if (!d.includes('PERTANYAAN/diskusi')) throw new Error('missing question/task distinction');
      const saved = await m.saveAutonomyConfig({ mode: 'strict' });
      if (saved.mode !== 'strict') throw new Error('save failed');
      const again = await m.getAutonomyConfig();
      if (again.mode !== 'strict') throw new Error('not persisted: ' + again.mode);
      if (!m.getAutonomyLabel('strict').toLowerCase().includes('ketat')) throw new Error('bad label');
    `;
    const res = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: dir,
        DATA_DIR: path.join(dir, 'data'),
        AUTONOMY_CONFIG_FILE: path.join(dir, 'data', 'autonomy_config.json'),
        AGENT_MODE: '',
      },
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, res.stderr);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('autonomy mode persists to data dir and rejects unknown modes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'th-autonomy-file-'));
  try {
    const dataDir = path.join(dir, 'data');
    await mkdir(dataDir, { recursive: true });
    const configFile = path.join(dataDir, 'autonomy_config.json');
    await writeFile(configFile, JSON.stringify({ mode: 'balanced' }));
    const code = `
      const m = await import(${JSON.stringify(autonomyUrl)});
      const cfg = await m.getAutonomyConfig();
      if (cfg.mode !== 'balanced') throw new Error('expected balanced, got ' + cfg.mode);
      const saved = await m.saveAutonomyConfig({ mode: 'ngawur' });
      if (saved.mode !== 'balanced') throw new Error('unknown mode should be ignored, got ' + saved.mode);
    `;
    const res = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: dir,
        DATA_DIR: dataDir,
        AUTONOMY_CONFIG_FILE: configFile,
        AGENT_MODE: '',
      },
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, res.stderr);
    const persisted = JSON.parse(await readFile(configFile, 'utf8'));
    assert.equal(persisted.mode, 'balanced');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('numbered instructions are not auto-promoted to swarm', async () => {
  const code = `
    const m = await import(${JSON.stringify(swarmUrl)});
    const cases = [
      ['1. Perbaiki bug login\\n2. Tambahkan test', false],
      ['- rapikan header\\n- perbaiki footer', false],
      ['tolong perbaiki auth dan tambahkan test sekalian', false],
      ['/swarm A | B', true],
      ['kerjakan secara paralel: A | B', true],
    ];
    for (const [text, expected] of cases) {
      const got = m.isMultiTaskRequest(text);
      if (got !== expected) throw new Error(JSON.stringify({ text, got, expected }));
    }
    // Explicit /swarm still decomposes into multiple tasks
    const tasks = m.decomposeTasks('/swarm Cek container | Cek disk');
    if (!tasks || tasks.length !== 2) throw new Error('decompose failed');
  `;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, res.stderr);
});
