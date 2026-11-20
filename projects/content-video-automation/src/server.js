import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');
const port = Number(process.env.PORT || 3217);
const maxBodyBytes = 64 * 1024;
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

async function readJobs(dataDir) {
  try { return JSON.parse(await fs.readFile(path.join(dataDir, 'jobs.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
async function saveJobs(jobs, dataDir) {
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  const target = path.join(dataDir, 'jobs.json');
  const temp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(jobs, null, 2), { mode: 0o600 });
  await fs.rename(temp, target);
}
function isAuthorized(req, user, password) {
  const header = req.headers.authorization || '';
  const expected = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
  const actualBuffer = Buffer.from(header);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}
function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}
async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBodyBytes) throw Object.assign(new Error('Request body too large'), { status: 413 });
  }
  try { return JSON.parse(body || '{}'); }
  catch { throw Object.assign(new Error('Invalid JSON body'), { status: 400 }); }
}

export function createServer({ dataDir = process.env.DATA_DIR || path.join(here, '..', 'data'), webUser = process.env.WEB_USER || '', webPassword = process.env.WEB_PASSWORD || '' } = {}) {
  return http.createServer(async (req, res) => {
    try {
      if (webPassword && !isAuthorized(req, webUser || 'admin', webPassword)) {
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Content Studio", charset="UTF-8"', 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('401 Unauthorized');
      }
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname.startsWith('/api/')) {
        if (req.method === 'GET' && url.pathname === '/api/health') return sendJson(res, 200, { ok: true, service: 'content-video-automation' });
        if (req.method === 'GET' && url.pathname === '/api/jobs') return sendJson(res, 200, { ok: true, jobs: await readJobs(dataDir) });
        if (req.method === 'POST' && url.pathname === '/api/jobs') {
          const body = await readBody(req);
          const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
          if (topic.length < 3 || topic.length > 1000) return sendJson(res, 400, { ok: false, error: 'Topic wajib 3–1000 karakter.' });
          const jobs = await readJobs(dataDir);
          const job = { id: crypto.randomUUID(), topic, status: 'queued', createdAt: new Date().toISOString(), source: 'web', note: 'Pipeline AI belum dikonfigurasi; pekerjaan dicatat untuk MVP.' };
          jobs.unshift(job);
          await saveJobs(jobs.slice(0, 500), dataDir);
          return sendJson(res, 201, { ok: true, job });
        }
        return sendJson(res, 404, { ok: false, error: 'API route tidak ditemukan.' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('Method Not Allowed'); }
      const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
      const resolved = path.resolve(publicDir, `.${requested}`);
      if (!resolved.startsWith(`${publicDir}${path.sep}`)) { res.writeHead(403); return res.end('Forbidden'); }
      const content = await fs.readFile(resolved);
      res.writeHead(200, { 'Content-Type': mime[path.extname(resolved)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      sendJson(res, error.status || 500, { ok: false, error: error.status ? error.message : 'Kesalahan internal.' });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer();
  server.listen(port, '0.0.0.0', () => console.log(`Content Video Automation listening on ${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
