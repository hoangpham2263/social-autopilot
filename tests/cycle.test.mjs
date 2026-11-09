// One whole cycle against a throw-away brand skill and workspace (never the real brand folders):
// brands -> sources -> research start/ingest (append, dedupe, cleaning) -> ideas -> draft (fake Codex) -> check -> approve -> write-back.
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
// Image host: a temp git repo whose origin is a local bare repo (never the real social-autopilot-sources); the link check
// goes to a closed local port, so hosting after approval fails softly (image_host.ok false) and the approval stands.
const hostRepo = path.join(tmp, 'host'), hostBare = path.join(tmp, 'host.git');
const env = { ...process.env, SA_WORKSPACE: ws, SA_SKILLS_ROOT: skills, SA_CODEX: path.join(tool, 'tests', 'fake-codex.mjs'), SA_IMAGE_HOST_CHECK_BASE: 'http://127.0.0.1:9/main' };
const git = (cwd, ...args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }); if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const run = (script, ...args) => {
  const r = spawnSync(process.execPath, [path.join(tool, 'scripts', script), ...args], { env, encoding: 'utf8', windowsHide: true });
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
  // Posted language en only; vn is reviewer-only (language_policy.review_langs).
  const on = (s, sources) => ({ ...s, enabled: true,
    research: { ...s.research, sources },
    channels: (s.channels || []).map((c) => ({ ...c, lang: ['en'] })),
    language_policy: { ...s.language_policy, mode: 'single', review_langs: ['vn'] },
    product_images: { ...s.product_images, ai_scenes_allowed: true },
    cadence: { ...s.cadence, slots: [{ day: 'tue', time: '19:00' }] },
    approval: (({ owner, ...rest }) => rest)(s.approval || {}) });
  scratchBrand('dreamyvows-skills', (s) => on(s, [
    { id: 'shop-a', name: 'Shop A', platform: 'facebook', url: 'https://www.facebook.com/shopa', enabled: true, what_to_take: 'neon để bàn', notes: '' },
    { id: 'shop-b', name: 'Shop B', platform: 'facebook', url: 'https://www.facebook.com/shopb', enabled: true, what_to_take: '', notes: '' },
    { id: 'shop-off', name: 'Off', platform: 'facebook', url: 'https://www.facebook.com/off', enabled: false, what_to_take: '', notes: '' },
  ]));
  scratchBrand('grenheim-skills', (s) => on(s, [{ id: 'wood-a', name: 'Wood A', platform: 'facebook', url: 'https://www.facebook.com/wooda', enabled: true, what_to_take: '', notes: '' }]));
  write(path.join(brandDir, 'project', 'sources', 'inputs', 'test-product', 'product.png'), png());
  git(tmp, 'init', '--quiet', '--bare', '-b', 'main', hostBare);
  git(tmp, 'init', '--quiet', '-b', 'main', hostRepo);
  git(hostRepo, 'config', 'user.name', 'test'); git(hostRepo, 'config', 'user.email', 'test@example.invalid');
  write(path.join(hostRepo, 'README.md'), '# test host\n');
  git(hostRepo, 'add', 'README.md'); git(hostRepo, 'commit', '--quiet', '-m', 'init'); git(hostRepo, 'remote', 'add', 'origin', hostBare); git(hostRepo, 'push', '--quiet', '-u', 'origin', 'main');
  write(path.join(ws, 'settings.json'), JSON.stringify({ imageHost: { type: 'github-repo', path: hostRepo, rawBase: 'https://raw.example.invalid/sources/main', verify: { attempts: 1, delay_seconds: 0 } } }));
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

  // shop-a: 3 posts, no limits; Facebook's U+034F removed.
  const posts = [1, 2, 3].map((n) => ({ post_url: `https://fb/p${n}`, caption: `Đèn neon͏͏ số ${n}​ giá 600k`, image: `raw/${n}.png` }));
  posts.forEach((p, i) => write(path.join(a.dir, p.image), png(8, 8, [i * 40, 10, 10])));
  // Only real images inside the source folder: a text file named .png, a .txt and a file outside the run are dropped.
  write(path.join(a.dir, 'raw', 'fake.png'), 'not an image');
  write(path.join(a.dir, 'raw', 'note.txt'), 'x');
  const outsideImg = path.join(tmp, 'elsewhere.png'); write(outsideImg, png(8, 8, [1, 2, 3]));
  write(a.raw_file, JSON.stringify([...posts, { post_url: 'https://fb/fake', image: 'raw/fake.png' }, { post_url: 'https://fb/txt', image: 'raw/note.txt' }, { post_url: 'https://fb/out', image: outsideImg }]));
  // A leftover file in refs/ from an earlier ingest is removed.
  write(path.join(a.dir, 'refs', 'R09-stale.png'), png());
  posts.forEach((p, i) => write(path.join(b.dir, p.image), png(8, 8, [10, i * 40 + 5, 10])));
  write(b.raw_file, JSON.stringify(posts));
  const ingest = run('research.mjs', 'ingest', '--brand', 'dreamyvows');
  assert.equal(ingest.ok, true, JSON.stringify(ingest));
  assert.deepEqual(ingest.sources.map((s) => s.refs), [3, 3]);
  assert.deepEqual(ingest.sources[0].dropped.map((d) => d.post_url).sort(), ['https://fb/fake', 'https://fb/out', 'https://fb/txt']);
  assert.ok(!fs.existsSync(path.join(a.dir, 'refs', 'R09-stale.png')), 'stale ref file removed');
  const refs = JSON.parse(fs.readFileSync(path.join(a.dir, 'refs.json'), 'utf8')).refs;
  assert.ok(!/[͏​]/.test(refs[0].caption));
  // A second run the same day: start again is allowed, the new post is appended, duplicates dropped.
  assert.equal(run('research.mjs', 'start', '--brand', 'dreamyvows').reused, true);
  write(path.join(a.dir, 'raw', '4.png'), png(8, 8, [200, 200, 10]));
  write(a.raw_file, JSON.stringify([...posts, { post_url: 'https://fb/p4', caption: 'mới', image: 'raw/4.png' }]));
  const again = run('research.mjs', 'ingest', '--brand', 'dreamyvows');
  assert.deepEqual(again.sources.map((s) => s.refs), [4, 3]);
  assert.equal(again.sources[0].added, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(a.dir, 'refs.json'), 'utf8')).refs.map((r) => r.id), ['R01', 'R02', 'R03', 'R04']);
  assert.equal(fs.readdirSync(path.join(a.dir, 'refs')).length, 4);

  const init = run('ideas.mjs', 'init', '--brand', 'dreamyvows');
  assert.equal(init.total, 7);
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
  // remove-watermark-skill: Codex's original kept, image.png without metadata chunks, same pixels, report beside it.
  const original = fs.readFileSync(path.join(draft.dir, 'image-generated.png'));
  assert.ok(original.includes(Buffer.from('caBX')), 'the original stays untouched');
  assert.ok(!fs.readFileSync(path.join(draft.dir, 'image.png')).includes(Buffer.from('caBX')));
  const cleanReport = JSON.parse(fs.readFileSync(path.join(draft.dir, 'image-clean-report.json'), 'utf8'));
  assert.deepEqual(cleanReport.removedChunks.sort(), ['caBX', 'tEXt']);
  assert.equal(cleanReport.imageDataIdentical, true);
  assert.deepEqual(image.metadata_removed.sort(), ['caBX', 'tEXt']);
  assert.equal(run('image-clean.mjs', '--id', draft.id).skipped, true); // idempotent
  fs.copyFileSync(path.join(draft.dir, 'image-generated.png'), path.join(draft.dir, 'image.png')); // metadata back in
  assert.ok(run('draft.mjs', 'check', '--id', draft.id).problems.some((p) => /làm sạch/.test(p)), 'check fails on an unclean image');
  assert.equal(run('image-clean.mjs', '--id', draft.id).pixels_identical, true);

  assert.equal(run('draft.mjs', 'check', '--id', draft.id).status, 'needs_caption');
  for (const l of ['vn', 'en']) write(path.join(draft.dir, `content-${l}.txt`), `Bảng neon "Love" cho bữa tối kỷ niệm (${l}).\n\n🌐 Website: https://dreamyvows.com/\n#DreamyVows #neon\n`);
  const checked = run('draft.mjs', 'check', '--id', draft.id);
  assert.equal(checked.status, 'awaiting_approval', JSON.stringify(checked.problems));
  const waiting = run('queue.mjs').brands[0].awaiting_approval;
  assert.equal(waiting.length, 1);
  // vn is reviewer-only: shown apart, never in the posted captions.
  assert.deepEqual(Object.keys(waiting[0].captions), ['content-en.txt']);
  assert.deepEqual(Object.keys(waiting[0].review_captions), ['content-vn.txt']);
  assert.deepEqual(waiting[0].review_languages, ['vn']);
  // An AI label in any caption (posted or reviewer-only) blocks it.
  const vnFile = path.join(draft.dir, 'content-vn.txt'), vnText = fs.readFileSync(vnFile, 'utf8');
  fs.writeFileSync(vnFile, vnText.replace('#DreamyVows', 'Ảnh tạo bằng AI\n#DreamyVows'));
  const labelled = run('draft.mjs', 'check', '--id', draft.id);
  assert.ok(labelled.problems.some((p) => /nhãn AI/.test(p) && /content-vn/.test(p)), JSON.stringify(labelled.problems));
  fs.writeFileSync(vnFile, vnText);
  assert.equal(run('draft.mjs', 'check', '--id', draft.id).status, 'awaiting_approval');

  // Nothing in the brand before approval; write-back refuses a draft not approved. No named approver: --by is free text.
  assert.equal(JSON.parse(fs.readFileSync(path.join(brandDir, 'workspace', 'catalog.json'), 'utf8')).posts.filter((p) => p.source === `social-autopilot ${draft.id}`).length, 0);
  assert.equal(run('writeback.mjs', '--id', draft.id).ok, false);
  const ok = run('approve.mjs', 'approve', '--id', draft.id, '--by', '  someone   else ', '--note', 'đẹp');
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const catalog = JSON.parse(fs.readFileSync(path.join(brandDir, 'workspace', 'catalog.json'), 'utf8'));
  const post = catalog.posts.find((p) => p.id === ok.brand_post.id);
  assert.match(post.id, /^POST-\d+$/);
  assert.equal(catalog.posts.filter((p) => p.id === post.id).length, 1); // a new number, after the brand's own posts
  assert.equal(post.status, 'approved');
  assert.equal(post.approval.by, 'someone else');
  assert.deepEqual(Object.keys(post.captions), ['en']); // posted captions only
  assert.deepEqual(post.review_captions, { vn: 'content-vn.txt' });
  assert.equal(post.ai_disclosure.label, undefined); // never an AI label on a post
  assert.equal(post.ai_disclosure.ai_scene, true);
  assert.ok(fs.existsSync(path.join(brandDir, post.folder, 'image.png')));
  assert.ok(ok.check_post, "check-post.mjs of the skill must run");
  assert.equal(ok.check_post.errors, 0, JSON.stringify(ok.check_post));
  // Wired after write-back: the approved image is committed and pushed to the host; the link check fails here (closed
  // port), so no media_url yet and the command to run again is given.
  assert.equal(ok.image_host.ok, false, JSON.stringify(ok.image_host));
  assert.ok(ok.image_host.next.endsWith(`host-image.mjs publish --brand dreamyvows --post ${post.id}`), ok.image_host.next);
  assert.equal(git(tmp, '--git-dir', hostBare, 'log', '-1', '--format=%s', 'main'), `dreamyvows ${post.id}`);
  assert.equal(post.media_url, undefined);
  assert.equal(run('approve.mjs', 'approve', '--id', draft.id).reused, true);
  // Queue (RUNBOOK step 6): the approved post with "chưa có link" and the host error + command.
  const done = run('queue.mjs').brands.find((x) => x.brand === 'dreamyvows').approved.find((x) => x.id === draft.id);
  assert.equal(done.media_url, null);
  assert.equal(done.image_link, 'chưa có link');
  assert.ok(done.host_error, JSON.stringify(done));
  assert.ok(done.next.includes(`--post ${post.id}`));

  // Reject needs a note.
  run('ideas.mjs', 'pick', '--brand', 'dreamyvows', '--id', 'I01');
  const second = run('draft.mjs', 'new', '--brand', 'dreamyvows', '--idea', `${date}/I01`, '--product', product, '--again');
  assert.equal(run('approve.mjs', 'reject', '--id', second.id).ok, false);
  const rejected = run('approve.mjs', 'reject', '--id', second.id, '--note', 'không hợp');
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.by, 'user');
  assert.match(run('approve.mjs', 'reject', '--id', second.id, '--note', 'lại').error, /không từ chối lại/);

  // Scene-swap: off by default (brand images only), opt-in per brand in social.json.
  const socialFile = path.join(brandDir, 'project', 'social.json');
  const setRedraw = (value) => { const s = JSON.parse(fs.readFileSync(socialFile, 'utf8')); s.product_images.reference_redraw = value; fs.writeFileSync(socialFile, JSON.stringify(s, null, 2)); };
  const refPath = path.join(a.dir, refs[1].image);
  setRedraw({ enabled: false, require_logo_removal: true, only_if_brand_can_produce: true });
  const swapArgs = ['draft.mjs', 'new', '--brand', 'dreamyvows', '--idea', `${date}/I01`, '--ref-image', refPath, '--again'];
  assert.match(run(...swapArgs).error, /reference_redraw\.enabled/);
  setRedraw({ enabled: true, require_logo_removal: true, only_if_brand_can_produce: true });
  assert.match(run(...swapArgs).error, /brand-can-produce/);
  assert.equal(run('draft.mjs', 'new', '--brand', 'dreamyvows', '--idea', `${date}/I01`, '--ref-image', outside, '--again', '--brand-can-produce').ok, false); // not a reference of this brand
  const swap = run(...swapArgs, '--brand-can-produce');
  assert.equal(swap.ok, true, JSON.stringify(swap));
  const swapPrompt = path.join(swap.dir, 'prompt.txt');
  assert.match(fs.readFileSync(swapPrompt, 'utf8'), /Shop A/);
  fs.writeFileSync(swapPrompt, fs.readFileSync(swapPrompt, 'utf8').replace('{{PRODUCT_DESCRIPTION}}', 'A neon sign reading "Love".'));
  assert.equal(run('draft.mjs', 'image', '--id', swap.id).ok, true);
  for (const l of ['vn', 'en']) write(path.join(swap.dir, `content-${l}.txt`), `Bảng neon "Love" giống mẫu của Shop A (${l}).\n\n🌐 Website: https://dreamyvows.com/\n#DreamyVows\n`);
  const swapCheck = run('draft.mjs', 'check', '--id', swap.id);
  assert.equal(swapCheck.status, 'needs_caption');
  assert.ok(swapCheck.problems.some((p) => /Shop A/.test(p) && /content-vn/.test(p)), 'shop name in caption is flagged');
  assert.ok(swapCheck.problems.some((p) => /confirm-clean/.test(p)), 'visual logo check is required');
  for (const l of ['vn', 'en']) write(path.join(swap.dir, `content-${l}.txt`), `Bảng neon "Love" cho bàn tiệc (${l}).\n\n🌐 Website: https://dreamyvows.com/\n#DreamyVows\n`);
  assert.equal(run('draft.mjs', 'confirm-clean', '--id', swap.id, '--by', 'agent').ok, true);
  assert.equal(run('draft.mjs', 'check', '--id', swap.id).status, 'awaiting_approval');
  const shown = run('queue.mjs').brands.find((b) => b.brand === 'dreamyvows').awaiting_approval.find((d) => d.id === swap.id);
  assert.equal(shown.reference_image, refPath); // the approver sees the shop's original beside the result
  const swapOk = run('approve.mjs', 'approve', '--id', swap.id);
  assert.equal(swapOk.ok, true, JSON.stringify(swapOk));
  const swapPost = JSON.parse(fs.readFileSync(path.join(brandDir, 'workspace', 'catalog.json'), 'utf8')).posts.find((p) => p.id === swapOk.brand_post.id);
  assert.equal(swapPost.image_mode, 'scene-swap');
  assert.equal(swapPost.ai_disclosure, true);
  assert.equal(swapPost.inspiration.source_shop, 'Shop A');
  assert.equal(swapOk.check_post.errors, 0, JSON.stringify(swapOk.check_post));
  setRedraw(undefined);
});

test('research has no limits: another brand starts after a big run, the same brand restarts', { skip: !haveReal && 'no brand skills to copy' }, () => {
  const r = run('research.mjs', 'start', '--brand', 'grenheim');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.run.budget, undefined);
  assert.equal(run('research.mjs', 'start', '--brand', 'grenheim').reused, true);
  assert.equal(run('research.mjs', 'limits').ok, false); // the command is gone
});

test('clean script strips U+034F and zero-width characters from a CSV', () => {
  const file = path.join(tmp, 'dirty.csv');
  write(file, '﻿store,content\nA,"Xin͏ chào​ bạn"\n');
  const r = run('research.mjs', 'clean', '--in', file, '--out', path.join(tmp, 'clean.csv'));
  assert.equal(r.hidden_chars_removed, 2);
  assert.equal(r.nbsp_replaced, 1);
  assert.match(fs.readFileSync(path.join(tmp, 'clean.csv'), 'utf8'), /"?Xin chào bạn"?/);
});
