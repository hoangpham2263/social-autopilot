// One whole cycle against a throw-away brand skill and workspace (never the real brand folders):
// brands -> sources -> research start/ingest (limits, cleaning) -> ideas -> draft (fake Codex) -> check -> approve -> write-back.
// npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'social-autopilot-test-'));
const skills = path.join(tmp, 'skills');
const ws = path.join(tmp, 'workspace');
const env = { ...process.env, SA_WORKSPACE: ws, SA_SKILLS_ROOT: skills, SA_CODEX: path.join(tool, 'tests', 'fake-codex.mjs') };
const run = (script, ...args) => {
  const r = spawnSync(process.execPath, [path.join(tool, 'scripts', script), ...args], { env, encoding: 'utf8' });
  try { return JSON.parse(r.stdout); } catch { throw new Error(`${script} ${args.join(' ')}: ${r.stdout}${r.stderr}`); }
};
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

// A small valid PNG (solid colour), so clean-image and check-post accept it.
export function png(w = 8, h = 8, rgb = [200, 120, 40]) {
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Scratch copies of the real brand skills (from skillsRoot), switched on for the test; the originals are never written.
const realSkills = path.resolve(tool, '..', 'vaniecom-workspace', 'skills');
const haveReal = fs.existsSync(path.join(realSkills, 'dreamyvows-skills', 'project', 'social.json'));
function scratchBrand(name, patch) {
  const dir = path.join(skills, name);
  fs.cpSync(path.join(realSkills, name), dir, { recursive: true, filter: (src) => !/[\/]workspace[\/]local([\/]|$)|[\/]\.git([\/]|$)/.test(src) });
  const file = path.join(dir, 'project', 'social.json');
  const social = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify(patch(social), null, 2));
  return dir;
}
const brandDir = path.join(skills, 'dreamyvows-skills');

test.before(() => {
  if (!haveReal) return;
  const on = (s, sources) => ({ ...s, enabled: true,
    research: { ...s.research, max_per_day: 1, sources },
    product_images: { ...s.product_images, ai_scenes_allowed: true, ai_disclosure_label: 'Ảnh minh hoạ dựng bằng AI' },
    cadence: { ...s.cadence, slots: [{ day: 'tue', time: '19:00' }] },
    approval: { ...s.approval, owner: 'Hoang' } });
  scratchBrand('dreamyvows-skills', (s) => on(s, [
    { id: 'shop-a', name: 'Shop A', platform: 'facebook', url: 'https://www.facebook.com/shopa', enabled: true, what_to_take: 'neon để bàn', notes: '' },
    { id: 'shop-b', name: 'Shop B', platform: 'facebook', url: 'https://www.facebook.com/shopb', enabled: true, what_to_take: '', notes: '' },
    { id: 'shop-off', name: 'Off', platform: 'facebook', url: 'https://www.facebook.com/off', enabled: false, what_to_take: '', notes: '' },
  ]));
  scratchBrand('grenheim-skills', (s) => on(s, [{ id: 'wood-a', name: 'Wood A', platform: 'facebook', url: 'https://www.facebook.com/wooda', enabled: true, what_to_take: '', notes: '' }]));
  write(path.join(brandDir, 'project', 'sources', 'inputs', 'test-product', 'product.png'), png());
  write(path.join(ws, 'settings.json'), JSON.stringify({ research: { max_posts_per_source: 2, max_posts_per_day_all_brands: 3 } }));
  // Not a brand: no social.json.
  write(path.join(skills, 'other-skills', 'SKILL.md'), '---\nname: other-skills\n---\n');
});
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('whole cycle', { skip: !haveReal && 'no brand skills to copy' }, () => {
  const brands = run('brands.mjs');
  assert.deepEqual(brands.usable.sort(), ['dreamyvows', 'grenheim'], JSON.stringify(brands.brands.map((b) => b.problems)));
  assert.equal(brands.skipped.length, 1);

  const sources = run('sources.mjs');
  assert.deepEqual(sources.brands[0].sources.map((s) => s.id), ['shop-a', 'shop-b']);

  const start = run('research.mjs', 'start', '--brand', 'dreamyvows');
  assert.equal(start.ok, true, JSON.stringify(start));
  assert.equal(run('research.mjs', 'start', '--brand', 'dreamyvows').reused, true);
  const [a, b] = start.run.sources;

  // shop-a: 3 posts, cap 2 per source; Facebook's U+034F removed.
  const posts = [1, 2, 3].map((n) => ({ post_url: `https://fb/p${n}`, caption: `Đèn neon͏͏ số ${n}​ giá 600k`, image: `raw/${n}.png` }));
  posts.forEach((p, i) => write(path.join(a.dir, p.image), png(8, 8, [i * 40, 10, 10])));
  write(a.raw_file, JSON.stringify(posts));
  // shop-b: 3 posts, but only 1 left of the 3 a day for all brands.
  posts.forEach((p, i) => write(path.join(b.dir, p.image), png(8, 8, [10, i * 40 + 5, 10])));
  write(b.raw_file, JSON.stringify(posts));
  const ingest = run('research.mjs', 'ingest', '--brand', 'dreamyvows');
  assert.equal(ingest.ok, true, JSON.stringify(ingest));
  assert.deepEqual(ingest.sources.map((s) => s.refs), [2, 1]);
  const refs = JSON.parse(fs.readFileSync(path.join(a.dir, 'refs.json'), 'utf8')).refs;
  assert.ok(!/[͏​]/.test(refs[0].caption));
  // Idempotent: ingesting again gives the same.
  assert.deepEqual(run('research.mjs', 'ingest', '--brand', 'dreamyvows').sources.map((s) => s.refs), [2, 1]);

  const init = run('ideas.mjs', 'init', '--brand', 'dreamyvows');
  assert.equal(init.total, 3);
  const copied = run('ideas.mjs', 'set', '--brand', 'dreamyvows', '--id', 'I01', '--json', JSON.stringify({ product_type: 'đèn neon số 1 giá 600k', scene: 'x', angle: 'y', caption_structure: 'z' }));
  assert.ok(copied.problems.length >= 1);
  assert.equal(run('ideas.mjs', 'pick', '--brand', 'dreamyvows', '--id', 'I01').ok, false);
  const idea = { product_type: 'neon chữ để bàn', scene: 'bàn ăn tối kỷ niệm, chạng vạng', angle: 'ngang tầm mắt người ngồi', caption_structure: 'dịp dùng, cách đặt làm, CTA' };
  assert.equal(run('ideas.mjs', 'set', '--brand', 'dreamyvows', '--id', 'I01', '--json', JSON.stringify(idea)).idea.status, 'ready');
  assert.equal(run('ideas.mjs', 'pick', '--brand', 'dreamyvows', '--id', 'I01').idea.status, 'picked');

  const date = start.run.date;
  const outside = path.join(tmp, 'outside.png'); fs.writeFileSync(outside, png());
  assert.equal(run('draft.mjs', 'new', '--brand', 'dreamyvows', '--idea', `${date}/I01`, '--product', outside).ok, false);
  const product = path.join(brandDir, 'project', 'sources', 'inputs', 'test-product', 'product.png');
  const refImage = path.join(a.dir, refs[0].image);
  assert.equal(run('draft.mjs', 'new', '--brand', 'dreamyvows', '--idea', `${date}/I01`, '--product', product, '--scene', refImage).ok, false);
  const draft = run('draft.mjs', 'new', '--brand', 'dreamyvows', '--idea', `${date}/I01`, '--product', product);
  assert.equal(draft.ok, true, JSON.stringify(draft));
  assert.equal(run('draft.mjs', 'image', '--id', draft.id).ok, false); // {{PRODUCT_DESCRIPTION}} not filled
  const promptFile = path.join(draft.dir, 'prompt.txt');
  fs.writeFileSync(promptFile, fs.readFileSync(promptFile, 'utf8').replace('{{PRODUCT_DESCRIPTION}}', 'A warm white neon sign reading "Love".'));
  const image = run('draft.mjs', 'image', '--id', draft.id);
  assert.equal(image.ok, true, JSON.stringify(image));
  assert.match(fs.readFileSync(path.join(draft.dir, 'codex.log'), 'utf8'), /exec --skip-git-repo-check -s workspace-write - -i/);

  assert.equal(run('draft.mjs', 'check', '--id', draft.id).status, 'needs_caption');
  for (const l of ['vn', 'en']) write(path.join(draft.dir, `content-${l}.txt`), `Bảng neon "Love" cho bữa tối kỷ niệm (${l}).\n\n🌐 Website: https://dreamyvows.com/\n#DreamyVows #neon\n`);
  const checked = run('draft.mjs', 'check', '--id', draft.id);
  assert.equal(checked.status, 'awaiting_approval', JSON.stringify(checked.problems));
  assert.equal(run('queue.mjs').brands[0].awaiting_approval.length, 1);

  // Nothing in the brand before approval; wrong approver refused.
  assert.equal(JSON.parse(fs.readFileSync(path.join(brandDir, 'workspace', 'catalog.json'), 'utf8')).posts.filter((p) => p.id.startsWith('POST-')).length, 0);
  assert.equal(run('approve.mjs', 'approve', '--id', draft.id, '--by', 'someone').ok, false);
  assert.equal(run('writeback.mjs', '--id', draft.id).ok, false);
  const ok = run('approve.mjs', 'approve', '--id', draft.id, '--by', 'hoang', '--note', 'đẹp');
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const catalog = JSON.parse(fs.readFileSync(path.join(brandDir, 'workspace', 'catalog.json'), 'utf8'));
  const post = catalog.posts.find((p) => p.id === ok.brand_post.id);
  assert.equal(post.id, 'POST-01');
  assert.equal(post.status, 'approved');
  assert.equal(post.ai_disclosure.label, 'Ảnh minh hoạ dựng bằng AI');
  assert.ok(fs.existsSync(path.join(brandDir, post.folder, 'image.png')));
  assert.ok(ok.check_post, "check-post.mjs of the skill must run");
  assert.equal(ok.check_post.errors, 0, JSON.stringify(ok.check_post));
  assert.equal(run('approve.mjs', 'approve', '--id', draft.id, '--by', 'hoang').reused, true);

  // Reject needs a note.
  run('ideas.mjs', 'pick', '--brand', 'dreamyvows', '--id', 'I01');
  const second = run('draft.mjs', 'new', '--brand', 'dreamyvows', '--idea', `${date}/I01`, '--product', product, '--again');
  assert.equal(run('approve.mjs', 'reject', '--id', second.id).ok, false);
  assert.equal(run('approve.mjs', 'reject', '--id', second.id, '--note', 'không hợp').status, 'rejected');
});

test('research limit: another brand cannot start once the all-brand day cap is used', { skip: !haveReal && 'no brand skills to copy' }, () => {
  const r = run('research.mjs', 'start', '--brand', 'grenheim');
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.match(r.error, /hạn mức/);
  assert.equal(run('research.mjs', 'start', '--brand', 'dreamyvows').reused, true);
});

test('clean script strips U+034F and zero-width characters from a CSV', () => {
  const file = path.join(tmp, 'dirty.csv');
  write(file, '﻿store,content\nA,"Xin͏ chào​ bạn"\n');
  const r = run('research.mjs', 'clean', '--in', file, '--out', path.join(tmp, 'clean.csv'));
  assert.equal(r.hidden_chars_removed, 2);
  assert.equal(r.nbsp_replaced, 1);
  assert.match(fs.readFileSync(path.join(tmp, 'clean.csv'), 'utf8'), /"?Xin chào bạn"?/);
});
