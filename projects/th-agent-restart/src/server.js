import http from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.PORT || 3817);
const TOKEN = process.env.RESTART_TOKEN || '';
const UNIT = process.env.TH_AGENT_UNIT || 'telegram-coding-agent.service';
const ALLOWED_UNITS = new Set(['telegram-coding-agent.service']);
const COOLDOWN_MS = Number(process.env.COOLDOWN_MS || 60_000);
let lastRestartAt = 0;
let restarting = false;

function authorized(req) {
  if (!TOKEN) return false;
  const got = createHash('sha256').update(req.headers.authorization || '').digest();
  const want = createHash('sha256').update(`Bearer ${TOKEN}`).digest();
  return timingSafeEqual(got, want);
}
function respond(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}
function systemctl(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/systemctl', args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000 });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `systemctl exit ${code}`)));
  });
}
const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') return respond(res, 200, { ok: true });
  if (req.method !== 'POST' || req.url !== '/v1/restart') return respond(res, 404, { error: 'not found' });
  if (!authorized(req)) return respond(res, 401, { error: 'unauthorized' });
  if (!ALLOWED_UNITS.has(UNIT)) return respond(res, 500, { error: 'service not allowlisted' });
  if (restarting || Date.now() - lastRestartAt < COOLDOWN_MS) return respond(res, 429, { error: 'restart rate limited' });
  restarting = true;
  lastRestartAt = Date.now();
  respond(res, 202, { ok: true, status: 'restart scheduled', unit: UNIT });
  // Delay lets the requester receive its response before the service is restarted.
  setTimeout(async () => {
    try {
      await systemctl(['restart', UNIT]);
      console.info(`[restart-gateway] restarted ${UNIT}`);
    } catch (error) {
      console.error(`[restart-gateway] failed: ${error.message}`);
    } finally { restarting = false; }
  }, 1500).unref();
});
server.listen(PORT, '127.0.0.1', () => {
  if (!TOKEN) console.error('[restart-gateway] RESTART_TOKEN missing; restart endpoint will reject all requests');
  console.info(`[restart-gateway] listening on 127.0.0.1:${PORT}`);
});
