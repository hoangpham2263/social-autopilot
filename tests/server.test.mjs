// The UI server: starts on a throw-away workspace and skills folder, serves the page and the JSON the pages read, and
// refuses to save a social.json that holds a token. Never touches the real brand folders.
// npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'social-autopilot-server-'));
const port = 47900 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${port}`;
let server;

test.before(async () => {
  fs.mkdirSync(path.join(tmp, 'skills'), { recursive: true });
  const real = path.resolve(tool, '..', 'vaniecom-workspace', 'skills', 'grenheim-skills');
  if (fs.existsSync(real)) fs.cpSync(real, path.join(tmp, 'skills', 'grenheim-skills'), { recursive: true, filter: (s) => !/[\\/]workspace[\\/]local([\\/]|$)|[\\/]\.git([\\/]|$)/.test(s) });
  server = spawn(process.execPath, [path.join(tool, 'src', 'server.mjs'), '--no-open'], { env: { ...process.env, SA_PORT: String(port), SA_WORKSPACE: path.join(tmp, 'workspace'), SA_SKILLS_ROOT: path.join(tmp, 'skills') }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${base}/api/root`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not start');
});
test.after(async () => {
  try { await fetch(`${base}/api/quit`, { method: 'POST' }); } catch {}
  server?.kill();
  await new Promise((r) => setTimeout(r, 300));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('serves the page, the shell assets and the data APIs', async () => {
  const root = await (await fetch(`${base}/api/root`)).json();
  assert.equal(root.service, 'social-autopilot');
  for (const p of ['/', '/core/assets/tool.css', '/core/assets/hub.js', '/icon.svg', '/setup']) assert.equal((await fetch(base + p)).status, 200, p);
  const brands = await (await fetch(`${base}/api/brands`)).json();
  assert.ok(Array.isArray(brands.brands));
  // Every brand of the Metricool account is listed, with its skill (or none: Fortera Apparel has no skill yet).
  const names = brands.metricool.brands.map((b) => b.name);
  assert.deepEqual(names, ['Dreamy Vows', 'Grenheim', 'Fortera Apparel']);
  const fortera = brands.metricool.brands.find((b) => b.name === 'Fortera Apparel');
  assert.equal(fortera.skill, null);
  assert.equal(fortera.tz_mismatch, false);
  assert.ok(Array.isArray(brands.metricool.skills_without_metricool));
  assert.equal((await (await fetch(`${base}/api/metricool-brands`)).json()).brands.length, 3);
  assert.equal((await (await fetch(`${base}/api/drafts`)).json()).drafts.length, 0);
  assert.ok((await (await fetch(`${base}/api/runs`)).json()).brands);
  const settings = await (await fetch(`${base}/api/settings`)).json();
  assert.match(settings.scheduledPrompt, /RUNBOOK\.md/);
  assert.equal((await fetch(`${base}/file?path=${encodeURIComponent(path.join(tool, 'icon.svg'))}`)).status, 404); // only workspace images
  // The app is self-contained in ui/ and core/assets: it does not use the static dashboard's stylesheet.
  assert.doesNotMatch(await (await fetch(base + '/')).text(), /dashboard.css/);
  assert.equal((await fetch(base + '/ui/dashboard.css')).status, 404);
  // Image host: settings shown and saved with the rest; "Đưa ảnh lên" refuses anything that is not an approved post.
  assert.match(settings.settings.imageHost.rawBase, /^https:\/\//);
  const saved = await (await fetch(base + '/api/settings', { method: 'POST', body: JSON.stringify({ settings: settings.settings }) })).json();
  assert.equal(saved.settings.imageHost.type, 'github-repo', JSON.stringify(saved));
  const host = await fetch(base + '/api/host-image', { method: 'POST', body: JSON.stringify({ id: 'grenheim-20261109-01' }) });
  assert.equal(host.status, 400);
  assert.match((await host.json()).error, /Không có bản nháp/);
});

test('brand settings: a token is never written; a bad file is put back', { skip: !fs.existsSync(path.join(tool, '..', 'vaniecom-workspace', 'skills', 'grenheim-skills')) && 'no brand skill to copy' }, async () => {
  const file = path.join(tmp, 'skills', 'grenheim-skills', 'project', 'social.json');
  const before = fs.readFileSync(file, 'utf8');
  const { social } = await (await fetch(`${base}/api/brand?id=grenheim`)).json();
  const post = (s) => fetch(`${base}/api/brand?id=grenheim`, { method: 'POST', body: JSON.stringify({ social: s }) }).then((r) => r.json());
  assert.match((await post({ ...social, metricool: { access_token: 'x' } })).error, /token/);
  const bad = JSON.parse(JSON.stringify(social)); bad.channels[0].network = 'myspace';
  const r = await post(bad);
  assert.equal(r.saved, false);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  const good = JSON.parse(JSON.stringify(social)); good.approval.owner = 'Tester';
  assert.equal((await post(good)).saved, true);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).approval.owner, 'Tester');
});

test('projectField keeps the value only (no trailing note)', async () => {
  const { projectField } = await import('../scripts/lib.mjs');
  const md = '- Hashtag cố định: #DreamyVows (người dùng chốt 2026-11-06)\n- Website (*): https://x.com <!-- ghi chú -->\n';
  assert.equal(projectField(md, 'Hashtag cố định'), '#DreamyVows');
  assert.equal(projectField(md, 'Website'), 'https://x.com');
});
