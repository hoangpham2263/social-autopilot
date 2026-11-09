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
let server, token;
// Every non-GET carries this run's session token and a JSON body type, as the page's call() does.
const hdr = () => ({ 'content-type': 'application/json', 'x-sa-token': token });

test.before(async () => {
  fs.mkdirSync(path.join(tmp, 'skills'), { recursive: true });
  const real = path.resolve(tool, '..', 'vaniecom-workspace', 'skills', 'grenheim-skills');
  if (fs.existsSync(real)) fs.cpSync(real, path.join(tmp, 'skills', 'grenheim-skills'), { recursive: true, filter: (s) => !/[\\/]workspace[\\/]local([\\/]|$)|[\\/]\.git([\\/]|$)/.test(s) });
  server = spawn(process.execPath, [path.join(tool, 'src', 'server.mjs'), '--no-open'], { env: { ...process.env, SA_PORT: String(port), SA_WORKSPACE: path.join(tmp, 'workspace'), SA_SKILLS_ROOT: path.join(tmp, 'skills') }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    let up = false;
    try { up = (await fetch(`${base}/api/root`)).ok; } catch {}
    if (up) { token = /name="sa-token" content="([0-9a-f]+)"/.exec(await (await fetch(base + '/')).text())[1]; return; }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not start');
});
test.after(async () => {
  try { await fetch(`${base}/api/quit`, { method: 'POST', headers: hdr() }); } catch {}
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
  // Image host: settings shown and saved with the rest; "Đưa ảnh lên" refuses anything that is not an approved post.
  assert.match(settings.settings.imageHost.rawBase, /^https:\/\//);
  const saved = await (await fetch(base + '/api/settings', { method: 'POST', headers: hdr(), body: JSON.stringify({ settings: settings.settings }) })).json();
  assert.equal(saved.settings.imageHost.type, 'github-repo', JSON.stringify(saved));
  const host = await fetch(base + '/api/host-image', { method: 'POST', headers: hdr(), body: JSON.stringify({ id: 'grenheim-20261109-01' }) });
  assert.equal(host.status, 400);
  assert.match((await host.json()).error, /Không có bản nháp/);
});

test('brand settings: a token is never written; a bad file is put back', { skip: !fs.existsSync(path.join(tool, '..', 'vaniecom-workspace', 'skills', 'grenheim-skills')) && 'no brand skill to copy' }, async () => {
  const file = path.join(tmp, 'skills', 'grenheim-skills', 'project', 'social.json');
  const before = fs.readFileSync(file, 'utf8');
  const { social } = await (await fetch(`${base}/api/brand?id=grenheim`)).json();
  const post = (s) => fetch(`${base}/api/brand?id=grenheim`, { method: 'POST', headers: hdr(), body: JSON.stringify({ social: s }) }).then((r) => r.json());
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

test('Xem trước: posted text is EN only; the VN reading comes apart as review_texts (older bilingual drafts too)', async () => {
  const { previewOf } = await import('../scripts/preview.mjs');
  const brandDir = path.join(tmp, 'pv-brand'), dir = path.join(tmp, 'pv-draft');
  fs.mkdirSync(path.join(brandDir, 'project'), { recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(brandDir, 'project', 'social.json'), JSON.stringify({ brand: 'Brand', language_policy: { mode: 'single', review_langs: ['vn'] }, channels: [{ network: 'facebook', enabled: true, lang: ['en'] }] }));
  fs.writeFileSync(path.join(dir, 'content-en.txt'), 'Hello');
  fs.writeFileSync(path.join(dir, 'content-vn.txt'), 'Xin chào');
  const old = { brand_dir: brandDir, brand: 'b', networks: [{ network: 'facebook', lang: ['vn', 'en'] }], languages: ['vn', 'en'], language_mode: 'one-post-bilingual', captions: { vn: 'content-vn.txt', en: 'content-en.txt' } };
  const p = previewOf({ dir, draft: old });
  assert.deepEqual(p.posts[0].texts, [{ lang: 'en', text: 'Hello' }]);
  assert.equal(p.mode, 'single');
  assert.deepEqual(p.review_texts, [{ lang: 'vn', text: 'Xin chào' }]);
  const now = previewOf({ dir, draft: { ...old, networks: [{ network: 'facebook', lang: ['en'] }], languages: ['en'], language_mode: 'single', captions: { en: 'content-en.txt' } } });
  assert.deepEqual(now.posts[0].texts, [{ lang: 'en', text: 'Hello' }]);
  assert.deepEqual(now.review_texts, [{ lang: 'vn', text: 'Xin chào' }]);
});
