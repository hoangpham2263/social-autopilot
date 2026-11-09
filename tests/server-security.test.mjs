// The UI server only obeys its own window: Host must be 127.0.0.1/localhost:<port> (DNS rebinding), every non-GET needs
// Content-Type application/json, a same-origin (or no) Origin and this run's token from the served HTML (CSRF).
// Also: /api/runs validates brand/date, bad bodies get clear 400s, slow reads are cached and cleared by any write.
// Throw-away workspace and skills folder; never posts anywhere.
// npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'social-autopilot-sec-'));
const port = 48100 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${port}`;
let server, token;

// Raw request (fetch cannot set Host).
const raw = (p, { method = 'GET', headers = {}, data } = {}) => new Promise((done, fail) => {
  const req = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => {
    let text = ''; res.on('data', (c) => (text += c)); res.on('end', () => done({ status: res.statusCode, text }));
  });
  req.on('error', fail);
  req.end(data);
});
const post = (p, data, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sa-token': token, ...headers }, body: data === undefined ? undefined : typeof data === 'string' ? data : JSON.stringify(data) });

test.before(async () => {
  fs.mkdirSync(path.join(tmp, 'skills'), { recursive: true });
  server = spawn(process.execPath, [path.join(tool, 'src', 'server.mjs'), '--no-open'], { env: { ...process.env, SA_PORT: String(port), SA_WORKSPACE: path.join(tmp, 'workspace'), SA_SKILLS_ROOT: path.join(tmp, 'skills') }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${base}/api/root`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  token = /<meta name="sa-token" content="([0-9a-f]+)">/.exec(await (await fetch(base + '/')).text())?.[1];
  assert.ok(token, 'token in the served page');
});
test.after(async () => {
  // core/launch.ps1 quits with a bare POST (no token) when the window closes: still allowed for a non-browser client.
  try { assert.equal((await raw('/api/quit', { method: 'POST', headers: { host: `127.0.0.1:${port}` } })).status, 200); } catch {}
  server?.kill();
  await new Promise((r) => setTimeout(r, 300));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the token is in both pages, and every script that writes sends it', async () => {
  for (const p of ['/', '/setup']) {
    const html = await (await fetch(base + p)).text();
    assert.ok(html.includes(`content="${token}"`), p);
  }
  for (const f of ['ui/index.html', 'core/assets/hub.js', 'core/setup/page.js']) assert.ok(fs.readFileSync(path.join(tool, f), 'utf8').includes(`"x-sa-token": document.querySelector('meta[name="sa-token"]')`), f);
  // No write left without the token header: every POST in those scripts goes through the helper.
  for (const f of ['ui/index.html', 'core/assets/hub.js', 'core/setup/page.js']) assert.doesNotMatch(fs.readFileSync(path.join(tool, f), 'utf8'), /method: ["']POST["'], (signal|body)/, f);
});

test('DNS rebinding: a foreign Host is refused, localhost and 127.0.0.1 work', async () => {
  assert.equal((await raw('/api/root', { headers: { host: 'evil.example' } })).status, 403);
  assert.equal((await raw('/api/settings', { headers: { host: `evil.example:${port}` } })).status, 403);
  assert.equal((await raw('/', { headers: { host: `127.0.0.1:${port + 1}` } })).status, 403);
  assert.equal((await raw('/api/root', { headers: { host: `localhost:${port}` } })).status, 200);
  assert.equal((await raw('/api/root', { headers: { host: `127.0.0.1:${port}` } })).status, 200);
});

test('CSRF: writes need JSON, same origin and the token', async () => {
  const settings = (await (await fetch(base + '/api/settings')).json()).settings;
  const evil = JSON.stringify({ settings: { ...settings, codex: { ...settings.codex, command: 'calc.exe' } } });
  // A cross-site form/text post (the old attack).
  let r = await fetch(base + '/api/settings', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: evil });
  assert.equal(r.status, 403);
  r = await fetch(base + '/api/settings', { method: 'POST', headers: { 'content-type': 'text/plain', 'x-sa-token': token }, body: evil });
  assert.equal(r.status, 403);
  r = await fetch(base + '/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: evil });
  assert.equal(r.status, 403);
  assert.match((await r.json()).error, /X-SA-Token/);
  r = await post('/api/settings', evil, { 'x-sa-token': 'f'.repeat(48) });
  assert.equal(r.status, 403);
  r = await post('/api/settings', evil, { origin: 'http://evil.example' });
  assert.equal(r.status, 403);
  for (const p of ['/api/brand?id=x', '/api/reject', '/api/approve', '/api/update', '/api/reload', '/api/setup-step', '/api/client-error'])
    assert.equal((await fetch(base + p, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 403, p);
  // A browser POST to /api/quit (Origin / Sec-Fetch-Site present) is not the launcher: refused without the token.
  assert.equal((await raw('/api/quit', { method: 'POST', headers: { host: `127.0.0.1:${port}`, origin: 'http://evil.example' } })).status, 403);
  assert.equal((await raw('/api/quit', { method: 'POST', headers: { host: `127.0.0.1:${port}`, 'sec-fetch-site': 'cross-site' } })).status, 403);
  // Nothing changed.
  assert.equal((await (await fetch(base + '/api/settings')).json()).settings.codex.command, settings.codex.command);
  // The app's own request goes through, from either address of the window.
  r = await post('/api/settings', { settings }, { origin: base });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await post('/api/client-error', { message: 'test' }, { origin: `http://localhost:${port}` })).status, 200);
});

test('/api/runs: brand must be a discovered brand, date YYYY-MM-DD', async () => {
  fs.mkdirSync(path.join(tmp, 'workspace', 'runs', 'x'), { recursive: true });
  for (const q of ['date=../../../x', 'brand=grenheim&date=../../../x', 'brand=..%2F..%2Fx', 'brand=../../x&date=2026-11-09', 'brand=nope'])
    assert.equal((await fetch(`${base}/api/runs?${q}`)).status, 400, q);
  const r = await (await fetch(`${base}/api/runs?brand=..%2F..%2Fx`)).json();
  assert.match(r.error, /Không có thương hiệu/);
  assert.match((await (await fetch(`${base}/api/runs?date=2026-1-9`)).json()).error, /YYYY-MM-DD/);
  assert.equal((await fetch(`${base}/api/runs`)).status, 200);
});

test('bad bodies get clear Vietnamese errors (400)', async () => {
  const check = async (p, data, re) => { const r = await post(p, data); assert.equal(r.status, 400, p); assert.match((await r.json()).error, re, p); };
  await check('/api/approve', 'null', /object JSON/);
  await check('/api/approve', '[1]', /object JSON/);
  await check('/api/approve', '{bad', /không phải JSON hợp lệ/);
  await check('/api/approve', {}, /Thiếu mã bản nháp/);
  await check('/api/approve', { id: 'no-such-draft' }, /no-such-draft/); // no approver name needed; the draft is looked up
  await check('/api/host-image', {}, /Thiếu mã bản nháp/);
  await check('/api/host-image', { id: 42 }, /Thiếu mã bản nháp/);
  await check('/api/reject', null, /object JSON/);
  await check('/api/reject', { note: 'x' }, /Thiếu mã bản nháp/);
  await check('/api/settings', {}, /Thiếu cài đặt/);
  await check('/api/brand?id=x', {}, /social/);
  await check('/api/brand', { social: {} }, /Thiếu mã thương hiệu/);
  for (const r of [await post('/api/approve', 'null'), await post('/api/host-image', {})]) assert.doesNotMatch((await r.json()).error, /Cannot read|undefined/);
});

test('/api/brands is cached; any write clears the cache', async () => {
  const skipped = async () => (await (await fetch(base + '/api/brands')).json()).skipped.map((s) => path.basename(s.dir));
  const first = await skipped();
  fs.mkdirSync(path.join(tmp, 'skills', 'new-folder'));
  assert.deepEqual(await skipped(), first, 'served from the cache');
  assert.equal((await post('/api/client-error', { message: 'x' })).status, 200);
  assert.ok((await skipped()).includes('new-folder'), 'a write clears the cache');
});
