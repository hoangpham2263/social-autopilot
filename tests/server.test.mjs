// The UI server: starts on a throw-away workspace and skills folder, serves the page and the JSON the pages read, and
// refuses to save a social.json that holds a token. Never touches the real brand folders.
// npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
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
  const shape = (t) => { let l = t.split('\n'); if (/^GOAL: /.test(l[4])) l = [...l.slice(0, 4), ...l.slice(5)]; /* Research: a goal-first line before STEPS */ return /^TASK: /.test(l[0]) && /^OPTIONS: /.test(l[1]) && l[2] === 'TOOL: {{TOOL}}' && l[3] === '{{SKILLS}}' && /^STEPS /.test(l[4]) && /for each SKILL line read that skill's SKILL\.md/.test(l[5]) && l.some((x) => /^\d+\. .*runlog\.mjs add/.test(x)) && /^STOP IF: /.test(l.at(-2)) && /^NEVER: /.test(l.at(-1)); };
  assert.ok(pr.prompts.filter((p) => p.agent !== 'ChatGPT').every((p) => shape(p.text)), 'one fixed template');
  assert.ok(pr.prompts.filter((p) => p.mode === 'Research only' && p.agent !== 'ChatGPT').every((p) => /^2\. 1\.0 .*node scripts\/research\.mjs browser/m.test(p.text) && /research\.mjs next/.test(p.text) && /product_fit/.test(p.text)), 'Research: the browser check is step 2 (1.0), then the next loop with product fit');
  assert.ok(pr.prompts.filter((p) => p.mode === 'Publish approved' && p.agent !== 'ChatGPT').every((p) => p.text.split(String.fromCharCode(10)).length <= 14 && /--mode publish/.test(p.text) && /NEVER: make ideas or posts/.test(p.text)), 'Publish approved: short, no new posts');
  assert.ok(pr.prompts.filter((p) => p.agent !== 'ChatGPT').every((p) => p.text.includes('{{OPTIONS}}') && /RUNBOOK.md Mode [123]/.test(p.text)), 'prompts point to the RUNBOOK');
  assert.ok(pr.all_brands);
  // "Run in a sub-agent" (Prompt tab, Claude Code): the first line of the prompt hands the task to one background sub-agent.
  const page = await (await fetch(base + '/')).text();
  assert.match(page, /Run this whole task in ONE background sub-agent \(Agent tool, general-purpose\) with the prompt below; keep this chat free; when it finishes, relay its 'Report' section to me\./);
  assert.match(page, /Codex runs it in its own session/);
  // Mode button counts per brand: research (available library items), create (posts still needed), publish (approved, not sent).
  const pc = await (await fetch(base + '/api/prompt-counts')).json();
  assert.ok(pc.brands && Object.values(pc.brands).every((c) => ['research', 'create', 'publish', 'on_metricool'].every((k) => Number.isInteger(c[k]))), JSON.stringify(pc));
  assert.ok(Array.isArray((await (await fetch(`${base}/api/queue`)).json()).brands));
  // Posts tab: four states in order (no "Queued"); Prompt tab: the never-sent-again note under Publish approved.
  assert.ok(page.includes('const STATES = [["review", "To review"], ["approved", "Approved"], ["scheduled", "Scheduled"], ["posted", "Posted"]];'));
  assert.doesNotMatch(page, /Queued/);
  assert.ok(page.includes('Already on Metricool: ${sum("on_metricool")} (never sent again)'));
  const settings = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(settings.settings.metricool?.default_mode, undefined); // no Metricool draft mode: always scheduled
  assert.equal(settings.settings.approval, undefined);
  // Prompt tab: Time and Start only for Publish approved (Create & publish keeps Posts only).
  const html = fs.readFileSync(path.join(tool, 'ui', 'index.html'), 'utf8');
  for (const id of ["prWindow", "prStart"]) assert.match(html, new RegExp(`<div class="field" data-opt="publish" hidden><label for="${id}"`), id);
  assert.match(html, /win = pub \? \$\("#prWindow"\)\.value : ""/);
  assert.ok(settings.times.primary[0] >= 1 && settings.times.backup[0] >= 1, 'Times: primary + backup hours per day'); // Settings summary
  // The Settings form sends only Plan ahead and Auto-host images; everything else stays as saved.
  const small = await (await fetch(base + '/api/settings', { method: 'POST', headers: hdr(), body: JSON.stringify({ settings: { planning: { ahead_days: 7 }, imageHost: { auto_after_writeback: true } } }) })).json();
  assert.equal(small.error, undefined, JSON.stringify(small));
  assert.deepEqual(small.settings.research.delay_seconds, settings.settings.research.delay_seconds);
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

test('brand settings: skills are read-only, saving social.json is refused and the file stays as it is', { skip: !fs.existsSync(path.join(tool, '..', 'vaniecom-workspace', 'skills', 'grenheim-skills')) && 'no brand skill to copy' }, async () => {
  const file = path.join(tmp, 'skills', 'grenheim-skills', 'project', 'social.json');
  const before = fs.readFileSync(file, 'utf8');
  const { social } = await (await fetch(`${base}/api/brand?id=grenheim`)).json();
  const post = (s) => fetch(`${base}/api/brand?id=grenheim`, { method: 'POST', headers: hdr(), body: JSON.stringify({ social: s }) }).then((r) => r.json());
  const good = JSON.parse(JSON.stringify(social)); good.cadence = { ...good.cadence, posts_per_day: 2 };
  assert.match((await post(good)).error, /chỉ đọc/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

// Brand Edit saves per-brand overrides IN THE TOOL (workspace/brands/<id>.json), merged over social.json; skill untouched.
test('brand settings: Brand Edit saves overrides in the tool, merged over the skill; the skill file is not changed', { skip: !fs.existsSync(path.join(tool, '..', 'vaniecom-workspace', 'skills', 'grenheim-skills')) && 'no brand skill to copy' }, async () => {
  const file = path.join(tmp, 'skills', 'grenheim-skills', 'project', 'social.json');
  const before = fs.readFileSync(file, 'utf8');
  const skillSources = (JSON.parse(before).research?.sources || []).filter((x) => x?.id);
  const post = (o) => fetch(`${base}/api/brand?id=grenheim`, { method: 'POST', headers: hdr(), body: JSON.stringify({ override: o }) }).then((r) => r.json());
  const disabled = skillSources.slice(0, 1).map((x) => x.id);
  const r = await post({ posts_per_day: 3, paused: false, sources_add: [{ id: 'src-new-page', url: 'https://www.facebook.com/newpage', name: 'New page' }], sources_disabled: disabled });
  assert.equal(r.saved, true, JSON.stringify(r));
  const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'workspace', 'brands', 'grenheim.json'), 'utf8'));
  assert.equal(saved.posts_per_day, 3);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'the skill is never written');
  const got = await (await fetch(`${base}/api/brand?id=grenheim`)).json();
  assert.equal(got.social.cadence.posts_per_day, 3);
  assert.ok(got.social.research.sources.some((x) => x.id === 'src-new-page' && x.enabled));
  for (const id of disabled) assert.equal(got.social.research.sources.find((x) => x.id === id).enabled, false);
  assert.equal(got.skill_social.cadence?.posts_per_day, JSON.parse(before).cadence?.posts_per_day);
  assert.match((await post({ posts_per_day: 0 })).error, /posts_per_day/);
  assert.match((await post({ sources_add: [{ id: 'x', url: 'javascript:alert(1)' }] })).error, /http/);
  // paused: the brand leaves the run
  await post({ paused: true });
  const brands = await (await fetch(`${base}/api/brands`)).json();
  const g = (brands.brands || []).find((b) => b.id === 'grenheim');
  if (g) assert.equal(g.usable, false);
  await post({});
});

// Prompt tab, Run progress: GET the steps + current run of a mode; Copy prompt (POST) makes a new pending run.
test('/api/progress: fixed steps per mode, Copy prompt starts a pending run, the step scripts move it', async () => {
  const get = async (mode) => (await fetch(`${base}/api/progress?mode=${mode}`)).json();
  let r = await get('create');
  assert.equal(r.steps.length, 8);
  assert.deepEqual(r.steps.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(r.run, null);
  assert.equal(r.active, false);
  assert.equal(r.last_log, null);
  assert.equal((await get('publish')).steps.length, 6);
  assert.match((await get('nope')).error, /mode must be/);
  const copy = (b, h = hdr()) => fetch(`${base}/api/progress`, { method: 'POST', headers: h, body: JSON.stringify(b) });
  assert.equal((await copy({ mode: 'create' }, { 'content-type': 'application/json' })).status, 403, 'a write needs the session token');
  assert.equal((await copy({ mode: 'nope' })).status, 400);
  const made = await (await copy({ mode: 'create', brands: ['grenheim', '../x'], agent: 'Claude Code' })).json();
  assert.ok(!made.run.brands.includes('../x'), 'only discovered brands');
  r = await get('create');
  assert.equal(r.active, true);
  assert.equal(r.run.run_id, made.run.run_id);
  assert.ok(r.run.steps.every((s) => s.state === 'pending'));
  // A step script of the agent (same workspace) moves it.
  const q = spawnSync(process.execPath, [path.join(tool, 'scripts', 'queue.mjs')], { env: { ...process.env, SA_WORKSPACE: path.join(tmp, 'workspace'), SA_SKILLS_ROOT: path.join(tmp, 'skills'), SA_PROGRESS: '' }, encoding: 'utf8', windowsHide: true });
  assert.equal(JSON.parse(q.stdout).ok, true);
  r = await get('create');
  assert.equal(r.run.steps[5].state, 'done');
  assert.equal(r.run.detail, 'queue report');
  // The panel is in the page: under the Copy row, polling every 3 s while a run is active.
  const html = fs.readFileSync(path.join(tool, 'ui', 'index.html'), 'utf8');
  assert.ok(html.indexOf('id="prRun"') > html.indexOf('id="prCopy"') && html.indexOf('id="prRun"') < html.indexOf('id="prText"'));
  assert.match(html, /runTimer = setTimeout\(loadProgress, 3000\)/);
  assert.match(html, /postJson\("\/api\/progress", \{ mode: modeKey\(prMode\)/);
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
