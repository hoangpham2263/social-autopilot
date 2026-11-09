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
  // This machine's Metricool brands (fake ids; the real list lives only in workspace/, never in git).
  fs.mkdirSync(path.join(tmp, 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'workspace', 'metricool-brands.json'), JSON.stringify({ version: 1, account: { user_id: '1' }, brands: [
    { name: 'Brand A', blog_id: '1001', timezone: 'Indian/Christmas', networks: ['facebook'], skill_id: 'dreamyvows' },
    { name: 'Brand B', blog_id: '1002', timezone: 'Indian/Christmas', networks: ['facebook'], skill_id: 'grenheim' },
    { name: 'Brand C', blog_id: '1003', timezone: 'America/New_York', networks: ['facebook', 'instagram'], skill_id: null },
  ] }));
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
  // Every brand of the Metricool account is listed, with its skill (or none).
  const names = brands.metricool.brands.map((b) => b.name);
  assert.deepEqual(names, ['Brand A', 'Brand B', 'Brand C']);
  const other = brands.metricool.brands.find((b) => b.name === 'Brand C');
  assert.equal(other.skill, null);
  assert.equal(other.tz_mismatch, false);
  assert.equal(brands.metricool.never_synced, true);
  assert.ok(Array.isArray(brands.metricool.skills_without_metricool));
  assert.equal((await (await fetch(`${base}/api/metricool-brands`)).json()).brands.length, 3);
  assert.equal((await (await fetch(`${base}/api/drafts`)).json()).drafts.length, 0);
  const store = await (await fetch(`${base}/api/store`)).json();
  assert.ok(Array.isArray(store.brands));
  assert.equal(store.current, null);
  // Prompt tab: every mode x agent prompt of docs/scheduled-prompt.md, with {{BRAND}} to fill.
  const pr = await (await fetch(`${base}/api/prompts`)).json();
  const modes = [...new Set(pr.prompts.map((p) => p.mode))];
  assert.deepEqual(modes, ['Research only', 'Create & publish', 'Publish approved']);
  for (const m of modes) assert.deepEqual(pr.prompts.filter((p) => p.mode === m).map((p) => p.agent), ['Claude Code', 'Codex', 'ChatGPT'], m);
  assert.ok(pr.prompts.every((p) => p.text.includes('{{BRAND}}') && p.text.split(String.fromCharCode(10)).length <= 18), 'every prompt is short and has the brand slot');
  // One fixed template: TASK, OPTIONS, numbered STEPS ending with the run log and the report, STOP IF, NEVER.
  const shape = (t) => { const l = t.split('\n'); return /^TASK: /.test(l[0]) && /^OPTIONS: /.test(l[1]) && l[2] === 'TOOL: {{TOOL}}' && l[3] === '{{SKILLS}}' && /^STEPS /.test(l[4]) && /for each SKILL line read that skill's SKILL\.md/.test(l[5]) && l.some((x) => /^\d+\. .*runlog\.mjs add/.test(x)) && /^STOP IF: /.test(l.at(-2)) && /^NEVER: /.test(l.at(-1)); };
  assert.ok(pr.prompts.filter((p) => p.agent !== 'ChatGPT').every((p) => shape(p.text)), 'one fixed template');
  assert.ok(pr.prompts.filter((p) => p.mode === 'Publish approved' && p.agent !== 'ChatGPT').every((p) => p.text.split(String.fromCharCode(10)).length <= 14 && /--mode publish/.test(p.text) && /NEVER: make ideas or posts/.test(p.text)), 'Publish approved: short, no new posts');
  assert.ok(pr.prompts.filter((p) => p.agent !== 'ChatGPT').every((p) => p.text.includes('{{OPTIONS}}') && /RUNBOOK.md Mode [123]/.test(p.text)), 'prompts point to the RUNBOOK');
  assert.ok(pr.all_brands);
  // Mode button counts per brand: research (unused library items), create (posts still needed), publish (approved, not sent).
  const pc = await (await fetch(base + '/api/prompt-counts')).json();
  assert.ok(pc.brands && Object.values(pc.brands).every((c) => ['research', 'create', 'publish'].every((k) => Number.isInteger(c[k]))), JSON.stringify(pc));
  assert.ok(Array.isArray((await (await fetch(`${base}/api/queue`)).json()).brands));
  const settings = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(settings.settings.metricool?.default_mode, undefined); // no Metricool draft mode: always scheduled
  assert.equal(settings.settings.approval, undefined);
  assert.equal((await fetch(`${base}/file?path=${encodeURIComponent(path.join(tool, 'icon.svg'))}`)).status, 404); // only workspace images
  // Image host: settings shown and saved with the rest. Approve exists again (review step); no hosting button.
  assert.match(settings.settings.imageHost.rawBase, /^https:\/\//);
  const saved = await (await fetch(base + '/api/settings', { method: 'POST', headers: hdr(), body: JSON.stringify({ settings: settings.settings }) })).json();
  assert.equal(saved.settings.imageHost.type, 'github-repo', JSON.stringify(saved));
  assert.match((await (await fetch(base + '/api/approve', { method: 'POST', headers: hdr(), body: JSON.stringify({ id: 'grenheim-20261109-01' }) })).json()).error, /Unknown post/);
  for (const p of ['/api/reject', '/api/host-image']) assert.equal((await fetch(base + p, { method: 'POST', headers: hdr(), body: '{}' })).status, 404, p);
  // An old metricool.default_mode is dropped on save.
  const sched = await (await fetch(base + '/api/settings', { method: 'POST', headers: hdr(), body: JSON.stringify({ settings: { metricool: { default_mode: 'draft' } } }) })).json();
  assert.equal(sched.settings.metricool?.default_mode, undefined, JSON.stringify(sched));
  // Settings, Accounts: names only, never a token.
  const acc = await (await fetch(base + '/api/accounts')).json();
  assert.ok(Array.isArray(acc.requirements) && acc.codex && acc.github && acc.metricool, JSON.stringify(acc));
  assert.doesNotMatch(JSON.stringify(acc), /token|eyJ/i);
  const cancel = await fetch(base + '/api/cancel', { method: 'POST', headers: hdr(), body: JSON.stringify({ id: 'grenheim-20261109-01' }) });
  assert.equal(cancel.status, 400);
  assert.match((await cancel.json()).error, /Không có bản nháp/);
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
  const good = JSON.parse(JSON.stringify(social)); good.cadence = { ...good.cadence, posts_per_week: 4 };
  assert.equal((await post(good)).saved, true);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).cadence.posts_per_week, 4);
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
