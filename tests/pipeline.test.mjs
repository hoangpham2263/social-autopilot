// pipeline.mjs create end to end on a throw-away brand skill (fake Codex; never the real brand folders, never Metricool):
// Stage A (brands, payload/status, ideas init) -> ideas file -> Stage B (drafts, images in the background) -> Stage C
// (contact sheet, captions file) -> Stage D (captions, check, queue, run log). Also draft.mjs contact-sheet alone.
// node --test tests/pipeline.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from '../scripts/contact-sheet.mjs';

// A solid-colour PNG (the encoder under test is also what the contact sheet writes).
const png = (w, h, rgb) => { const b = Buffer.alloc(w * h * 3); for (let i = 0; i < w * h; i++) b.set(rgb, i * 3); return encodePng(w, h, b); };

const tool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-pipeline-'));
const skills = path.join(tmp, 'skills'), ws = path.join(tmp, 'workspace');
const strip = path.join(tool, '..', 'remove-watermark-skill', 'scripts', 'strip-png-metadata.mjs');
const env = { ...process.env, SA_WORKSPACE: ws, SA_SKILLS_ROOT: skills, SA_CODEX: path.join(tool, 'tests', 'fake-codex.mjs'), FAKE_CODEX_DELAY_MS: '300' };
const run = (...args) => {
  const r = spawnSync(process.execPath, [path.join(tool, 'scripts', 'pipeline.mjs'), ...args], { env, encoding: 'utf8', windowsHide: true, cwd: tool });
  try { return JSON.parse(r.stdout); } catch { throw new Error(`pipeline ${args.join(' ')}: ${r.stdout}${r.stderr}`); }
};
const write = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };

test.before(() => {
  const dir = path.join(skills, 'fakebrand-skills');
  write(path.join(dir, 'SKILL.md'), '# Fake brand skill\n');
  write(path.join(dir, 'project', 'project.md'), '# Fake\n\n- Tên thương hiệu: Fake Brand\n- Website: https://fake.example\n- Hashtag cố định: #fakebrand\n\n## 10. Sản phẩm\nA wooden sign.\n');
  write(path.join(dir, 'project', 'social.json'), JSON.stringify({ brand: 'Fake Brand', enabled: true,
    channels: [{ network: 'facebook', enabled: true, account: 'Fake Brand', lang: ['en'] }],
    language_policy: { mode: 'single', review_langs: ['vn'] }, cadence: { posts_per_day: 1, timezone: 'America/New_York' },
    product_images: { ai_scenes_allowed: true, size_source: 'project.md 10' }, research: { sources: [{ id: 'shop-a', url: 'https://www.facebook.com/a', enabled: true }] } }));
  write(path.join(dir, 'scripts', 'check-skill.mjs'), 'process.exit(0);\n');
  fs.writeFileSync(path.join(dir, 'product.png'), png(64, 64, [150, 100, 60]));
  const store = path.join(ws, 'store', 'fakebrand');
  const items = [1, 2, 3].map((n) => ({ id: `S000${n}`, source_id: 'shop-a', post_url: `https://www.facebook.com/a/posts/${n}`, posted_date: `2026-11-0${n}`, caption: `Reference caption number ${n} about a cosy cabin evening`, images: [`images/S000${n}-1.png`], status: 'new' }));
  for (const it of items) write(path.join(store, it.images[0]), png(16, 16, [n(it), 80, 80]));
  function n(it) { return 40 * Number(it.id.slice(-1)); }
  write(path.join(store, 'items.json'), JSON.stringify({ next: 3, items }));
  write(path.join(ws, 'settings.json'), JSON.stringify({ planning: { ahead_days: 2 }, posts: { images_per_post: [1, 1] }, codex: { concurrency: 3, timeout_minutes: 2 }, ...(fs.existsSync(strip) ? {} : {}) }));
});

test('pipeline create: two stops (ideas, captions), images in the background, same checks; timings', { skip: !fs.existsSync(strip) && 'no remove-watermark-skill strip script on this machine' }, () => {
  const T = Date.now();
  const a = run('create', '--brand', 'fakebrand', '--agent', 'Test');
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(a.stop, 'ideas');
  assert.equal(a.ideas, 2, 'ahead_days 2 x 1 per day');
  assert.match(a.notes.join(' '), /not synced/);
  assert.match(run('create', '--brand', 'fakebrand').error, /open/, 'one open run at a time');
  const todo = JSON.parse(fs.readFileSync(a.ideas_file, 'utf8'));
  const [first, second] = todo.ideas;
  Object.assign(first, { idea: { product_type: 'wooden sign', scene: 'cabin porch at dusk', angle: 'eye level', props: 'lantern', caption_structure: 'hook, story, CTA', hook: 'Evenings outside', why: 'warm mood' },
    product: path.join(skills, 'fakebrand-skills', 'product.png'), size: '60 cm (24 in) wide', description: 'A light oak sign with the word "Welcome" carved in serif capitals.' });
  second.reject = 'not our product type';
  fs.writeFileSync(a.ideas_file, JSON.stringify(todo));
  const tA = Date.now() - T;

  const b = run('create', '--resume', '--ideas', a.ideas_file);
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.equal(b.drafts.length, 1);
  assert.equal(b.rejected.length, 1);
  const draftId = b.drafts[0];
  const prompt = fs.readFileSync(path.join(ws, 'drafts', 'fakebrand', draftId, 'prompt.txt'), 'utf8');
  assert.ok(!prompt.includes('{{PRODUCT_DESCRIPTION}}') && prompt.includes('"Welcome" carved'), 'description filled in');
  assert.match(prompt, /NO LOGO/);

  const c = run('create', '--resume');
  assert.equal(c.ok, true, JSON.stringify(c));
  assert.equal(c.stage, 'C done');
  assert.equal(c.contact_sheets.length, 1);
  const sheet = decodePng(fs.readFileSync(c.contact_sheets[0].file));
  assert.ok(sheet.w > 500 && sheet.h > 500);
  const caps = JSON.parse(fs.readFileSync(c.captions_file, 'utf8'));
  assert.deepEqual(Object.keys(caps.drafts), [draftId]);
  assert.deepEqual(Object.keys(caps.drafts[draftId].captions).sort(), ['en', 'vn']);

  // A caption with an AI label fails the same check as step by step; fixed, it is ready and the run finishes.
  const W = '\u{1F310} Website: https://fake.example';
  caps.drafts[draftId].captions = { en: `Evenings outside feel warmer with a sign that says Welcome.\n\nMade with AI.\n\n${W}\n#fakebrand`, vn: `Buổi tối ngoài hiên ấm hơn với tấm biển Welcome.\n\n${W}\n#fakebrand` };
  fs.writeFileSync(c.captions_file, JSON.stringify(caps));
  const d1 = run('create', '--resume', '--captions', c.captions_file);
  assert.equal(d1.stage, 'D partial', JSON.stringify(d1));
  assert.notEqual(d1.results[0].status, 'ready');
  caps.drafts[draftId].captions.en = `Evenings outside feel warmer with a sign that says Welcome.\n\n${W}\n#fakebrand`;
  fs.writeFileSync(c.captions_file, JSON.stringify(caps));
  const d2 = run('create', '--resume', '--captions', c.captions_file);
  assert.equal(d2.ok, true, JSON.stringify(d2));
  assert.equal(d2.results[0].status, 'ready', JSON.stringify(d2.results));
  assert.equal(d2.finished, true);
  assert.deepEqual(d2.to_review, [draftId]);
  assert.ok(fs.readdirSync(path.join(ws, 'logs', 'runs')).some((f) => f.endsWith('-create.json')), 'run log written');
  const st = JSON.parse(fs.readFileSync(path.join(ws, 'pipeline', 'create.json'), 'utf8'));
  assert.equal(st.stage, 'done');
  // Measured (fake Codex 300 ms): printed for the report.
  console.log(`pipeline timings: stage A ${tA} ms, whole run ${Date.now() - T} ms, state ${JSON.stringify(st.timing)}`);
});

test('draft.mjs contact-sheet: labelled tiles, several sheets past --per-sheet, PNG only in Node', () => {
  const r = spawnSync(process.execPath, [path.join(tool, 'scripts', 'draft.mjs'), 'contact-sheet', '--brand', 'fakebrand', '--status', 'ready,needs_caption', '--out', path.join(tmp, 'cs')], { env, encoding: 'utf8', windowsHide: true });
  const j = JSON.parse(r.stdout);
  assert.equal(j.ok, true, r.stdout + r.stderr);
  if (j.count) { assert.ok(fs.existsSync(j.sheets[0].file)); assert.equal(j.sheets[0].drafts[0].n, 1); }
});

test('pipeline publish: payload + status printed for the agent, then --resume writes the run log (mode publish)', () => {
  const p = run('publish', '--brand', 'fakebrand', '--start', 'today', '--agent', 'Test');
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.equal(p.publish_items, 0, 'nothing approved in this workspace');
  assert.ok(p.publish.fakebrand);
  const r = run('publish', '--resume');
  assert.equal(r.finished, true, JSON.stringify(r));
  assert.ok(fs.readdirSync(path.join(ws, 'logs', 'runs')).some((f) => f.endsWith('-publish.json')));
  assert.match(run('publish', '--resume').error, /No open Publish run/);
});
