// Page -> tool transfer of the extract result (docs/research.md). The extract script's Node side POSTs its compact result to the app's own
// loopback server instead of making the agent retype b64; `collect.mjs script` issues a ONE-TIME token per task (15 minutes),
// src/server.mjs redeems it on POST /api/collect-result and writes <task dir>/page-result.json, `collect.mjs from-page` reads it.
// The token lives only in the script file (script_dir) and, as a sha256 hash, in workspace/collect-tokens/. Never logged.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { workspace, settings } from './lib.mjs';

export const TOKEN_TTL_MS = 15 * 60 * 1000;
export const MAX_BODY = 512 * 1024;
export const tokenDir = () => path.join(workspace, 'collect-tokens');
export const resultFile = (taskDir) => path.join(taskDir, 'page-result.json');
const hash = (t) => createHash('sha256').update(String(t)).digest('hex');
const safe = (x) => String(x || '').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60) || 'x';

// Folder the Playwright MCP may read files from (browser_run_code_unsafe filename=): under the user's home, not the tool folder.
export function scriptDir(cfg = settings().research?.script_dir, home = os.homedir()) {
  return path.resolve(cfg && cfg !== true ? String(cfg) : path.join(home, '.playwright-mcp', 'social-autopilot'));
}
export const scriptFile = (brandId, taskId, dir = scriptDir()) => path.join(dir, `${safe(brandId)}-${safe(taskId)}.js`);
export function cleanScripts(dir = scriptDir()) {
  try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fs.rmSync(path.join(dir, f), { force: true }); } catch { /* none yet */ }
}

// The app's own address from workspace/server-address.json -> 'http://127.0.0.1:<port>' or ''.
export function serverBase(file = path.join(workspace, 'server-address.json')) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    return Number(j.port) > 0 ? `http://127.0.0.1:${Number(j.port)}` : '';
  } catch { return ''; }
}

// A token for ONE task dir; a newer token for the same task replaces the older one.
export function issueToken(taskDir, taskId, now = Date.now(), dir = tokenDir()) {
  const token = randomBytes(24).toString('hex');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) {
    try { const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (j.dir === taskDir || j.exp < now) fs.rmSync(path.join(dir, f), { force: true }); } catch { fs.rmSync(path.join(dir, f), { force: true }); }
  }
  fs.writeFileSync(path.join(dir, `${hash(token)}.json`), JSON.stringify({ task: String(taskId), dir: taskDir, exp: now + TOKEN_TTL_MS }));
  return token;
}

// Redeem: valid token + same task id + task dir inside workspace/runs and existing + body below the limit and JSON -> writes page-result.json.
// -> { ok, status, error? }. The token is spent on success only (a failed attempt may be retried until it expires).
export function redeem({ token, task, body, now = Date.now(), dir = tokenDir(), runsRoot = path.join(workspace, 'runs') }) {
  const f = path.join(dir, `${hash(token || '')}.json`);
  let j;
  try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return { ok: false, status: 403, error: 'Invalid or used token.' }; }
  if (!token || j.exp < now) { fs.rmSync(f, { force: true }); return { ok: false, status: 403, error: 'Token expired.' }; }
  if (String(task || '') !== j.task) return { ok: false, status: 403, error: 'Token is for another task.' };
  const root = path.resolve(runsRoot) + path.sep;
  if (!path.resolve(j.dir).startsWith(root) || !fs.existsSync(j.dir)) return { ok: false, status: 404, error: 'Task is not in an open run.' };
  if (!Buffer.isBuffer(body) || !body.length || body.length > MAX_BODY) return { ok: false, status: 413, error: 'Body empty or above 512 KB.' };
  let obj;
  try { obj = JSON.parse(body.toString('utf8')); } catch { return { ok: false, status: 400, error: 'Body is not JSON.' }; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, status: 400, error: 'Body is not a result object.' };
  fs.writeFileSync(resultFile(j.dir), JSON.stringify(obj));
  fs.rmSync(f, { force: true });
  return { ok: true, status: 200 };
}

// Code that goes into the extract script (inside `async (page) => {...}`, after `r` and `p = packB64(r)`): the script's NODE side
// (the Playwright MCP process, outside page.evaluate: no page CSP, no CORS, no Private Network Access) POSTs r to the app and returns
// only a summary; if that fails it returns saved:false + reason + the b64 line.
export const POST_JS = `const post = o.post;
  const summary = (x) => Object.assign({ platform: r.platform, total: r.total, total_on_page: r.total_on_page, reason: r.reason }, x);
  let why = 'standalone task: no transfer token';
  if (post && post.url && post.token) {
    try {
      const body = JSON.stringify(Object.assign({}, r, { tag: p.tag }));
      const res = await page.context().request.post(post.url, { headers: { 'X-Collect-Token': post.token, 'content-type': 'text/plain' }, data: body, timeout: 10000 });
      if (res.ok()) return summary({ saved: true, status: res.status(), tag: p.tag, bytes: body.length });
      why = 'app answered HTTP ' + res.status();
    } catch (e) { why = 'post failed: ' + String((e && e.message) || e).slice(0, 120); }
  }
  return summary({ saved: false, reason_saved: why, tag: p.tag, b64: p.line });`;
