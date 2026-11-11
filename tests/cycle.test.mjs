// One whole cycle against a throw-away brand skill and workspace (never the real brand folders):
// brands -> sources -> research start/ingest into the store (dedupe, cleaning, incremental) -> store ideas -> draft
// (fake Codex) -> automatic checks ("Needs review") -> a person approves (finalize.mjs approve: write-back, host).
// npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
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

// A PNG with a structure of its own (blocks of gray from a seed), so perceptual hashes differ between seeds and stay
// close for the same seed at another size. A solid colour would hash the same as every other solid colour.
export function pattern(seed, size = 32) {
  let x = seed.reduce((a, v, i) => (a * 31 + v + i) >>> 0, 7) || 1;
  const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x % 256; };
  const grid = Array.from({ length: 64 }, rnd);
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) for (let px = 0; px < size; px++) { const v = grid[Math.floor((y * 8) / size) * 8 + Math.floor((px * 8) / size)]; raw.set([v, v, v], y * (size * 3 + 1) + 1 + px * 3); }
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
  // Posts the real tool wrote into the brand ("social-autopilot <draft id>") would collide with this run's draft ids.
  const cat = path.join(dir, 'workspace', 'catalog.json');
  if (fs.existsSync(cat)) { const c = JSON.parse(fs.readFileSync(cat, 'utf8')); c.posts = (c.posts || []).filter((p) => !String(p.source || '').startsWith('social-autopilot ')); fs.writeFileSync(cat, JSON.stringify(c, null, 2)); }
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
  write(path.join(ws, 'settings.json'), JSON.stringify({ posts: { images_per_post: [1, 1] }, imageHost: { type: 'github-repo', path: hostRepo, rawBase: 'https://raw.example.invalid/sources/main', verify: { attempts: 1, delay_seconds: 0 } } })); // one image per draft: the album range (default 1-3) is random, tests/album.test.mjs covers it
  // Not a brand: no social.json.
  write(path.join(skills, 'other-skills', 'SKILL.md'), '---\nname: other-skills\n---\n');
});
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const storeFile = (b) => path.join(ws, 'store', b, 'items.json');
const readItems = (b) => JSON.parse(fs.readFileSync(storeFile(b), 'utf8')).items;

test('whole cycle', { skip: !haveReal && 'no brand skills to copy' }, () => {
  const brands = run('brands.mjs');
  assert.deepEqual(brands.usable.sort(), ['dreamyvows', 'grenheim'], JSON.stringify(brands.brands.map((b) => b.problems)));
  assert.equal(brands.skipped.length, 1);

  const sources = run('sources.mjs');
  assert.deepEqual(sources.brands[0].sources.map((s) => s.id), ['shop-a', 'shop-b']);

  // ----- Mode 1 "Chỉ nghiên cứu": crawl -> store -----
  const start = run('research.mjs', 'start', '--brand', 'dreamyvows', '--platforms', 'none'); // reference pages only (discovery: research-discovery.test.mjs)
  assert.equal(start.ok, true, JSON.stringify(start));
  assert.equal(run('research.mjs', 'start', '--brand', 'dreamyvows', '--platforms', 'none').reused, true);
  const [a, b] = start.run.sources;
  assert.equal(a.known_count, 0);
  assert.match(a.stop_rule, /cuộn tới hết trang/);

  // shop-a: 3 posts; Facebook's U+034F removed. Captions differ enough not to count as one.
  const caps = ['Đèn neon͏͏ chữ Love​ cho tiệc cưới ngoài trời, ánh trắng ấm, dây dài ba mét', 'Bảng LED tên cô dâu chú rể treo cổng hoa, màu hồng phấn, kèm móc treo', 'Neon Happy Birthday để bàn nhà hàng, pin sạc dùng tám tiếng liền'];
  const posts = [1, 2, 3].map((n) => ({ post_url: `https://www.facebook.com/shopa/posts/10000000${n}`, caption: caps[n - 1], image: `raw/${n}.png`, posted_date: `2026-10-0${n}` }));
  const pics = [[0, 0, 0, 255, 255, 255], [255, 255, 255, 0, 0, 0], [0, 255, 0, 255, 0, 255]];
  posts.forEach((p, i) => write(path.join(a.dir, p.image), pattern(pics[i])));
  // Only real images inside the source folder: a text file named .png, a .txt and a file outside the run are dropped.
  write(path.join(a.dir, 'raw', 'fake.png'), 'not an image');
  write(path.join(a.dir, 'raw', 'note.txt'), 'x');
  const outsideImg = path.join(tmp, 'elsewhere.png'); write(outsideImg, png(8, 8, [1, 2, 3]));
  write(a.raw_file, JSON.stringify([...posts, { post_url: 'https://fb/fake', image: 'raw/fake.png' }, { post_url: 'https://fb/txt', image: 'raw/note.txt' }, { post_url: 'https://fb/out', image: outsideImg }]));
  // shop-b: one post of its own, and the same photo as shop-a's first post re-encoded (another shop reposting it).
  write(path.join(b.dir, 'raw', '1.png'), pattern([10, 200, 10, 200, 10, 200], 32));
  write(path.join(b.dir, 'raw', 'repost.png'), pattern(pics[0], 48));
  write(b.raw_file, JSON.stringify([{ post_url: 'https://www.facebook.com/shopb/posts/20000001', caption: 'Mẫu đèn ngủ hình mặt trăng cho phòng bé, cắm cổng USB tiện lợi', images: ['raw/1.png'] }, { post_url: 'https://www.facebook.com/shopb/posts/20000002', caption: 'Hàng mới về', image: 'raw/repost.png' }]));
  const ingest = run('research.mjs', 'ingest', '--brand', 'dreamyvows');
  assert.equal(ingest.ok, true, JSON.stringify(ingest));
  assert.deepEqual(ingest.sources.map((s) => s.added), [3, 1]);
  assert.deepEqual(ingest.sources[0].dropped.map((d) => d.post_url).sort(), ['https://fb/fake', 'https://fb/out', 'https://fb/txt']);
  assert.equal(ingest.sources[1].duplicates, 1, JSON.stringify(ingest.sources[1]));
  assert.equal(ingest.sources[1].duplicate_list[0].rule, 'image_phash');
  assert.equal(ingest.sources[1].note, '1 bài trùng bỏ qua');
  let items = readItems('dreamyvows');
  assert.deepEqual(items.map((i) => i.id), ['S0001', 'S0002', 'S0003', 'S0004']);
  assert.ok(!/[͏​]/.test(items[0].caption));
  assert.ok(items.every((i) => i.status === 'new' && fs.existsSync(path.join(ws, 'store', 'dreamyvows', i.images[0]))));
  const dupLog = JSON.parse(fs.readFileSync(path.join(ws, 'store', 'dreamyvows', 'duplicates.json'), 'utf8')).duplicates;
  assert.equal(dupLog.length, 1);
  assert.equal(dupLog[0].matched, 'S0001');

  // How each source ended; blocked needs a reason. The report: new per source, duplicates, done, blocked.
  assert.equal(run('research.mjs', 'result', '--brand', 'dreamyvows', '--source', 'shop-b', '--state', 'blocked').ok, false);
  assert.equal(run('research.mjs', 'result', '--brand', 'dreamyvows', '--source', 'shop-a', '--state', 'end').result.reached_end, true);
  assert.equal(run('research.mjs', 'result', '--brand', 'dreamyvows', '--source', 'shop-b', '--state', 'blocked', '--note', 'checkpoint').run_status, 'done-with-blocked');
  const report = run('research.mjs', 'report', '--brand', 'dreamyvows');
  assert.deepEqual(report.sources.map((s) => [s.id, s.new, s.duplicates]), [['shop-a', 3, 0], ['shop-b', 1, 1]]);
  assert.deepEqual(report.done, ['shop-a']);
  assert.deepEqual(report.blocked, ['shop-b: checkpoint']);
  assert.equal(report.store.new, 4);

  // A later crawl (incremental): start tells where to stop (known posts of the source, brand-wide ids to skip).
  const again = run('research.mjs', 'start', '--brand', 'dreamyvows', '--source', 'shop-a', '--since', '2026-01-01', '--max-posts', '1');
  const a2 = again.run.sources[0];
  assert.deepEqual(again.run.sources.map((s) => s.id), ['shop-a']);
  assert.equal(a2.known_count, 3);
  assert.equal(a2.reached_end_before, true);
  assert.match(a2.stop_rule, /3 bài liên tiếp đã có/);
  assert.match(a2.stop_rule, /2026-01-01/);
  const known = JSON.parse(fs.readFileSync(a2.known_file, 'utf8'));
  assert.equal(known.post_urls.length, 3);
  assert.ok(known.brand_post_ids.includes('20000001'), 'brand-wide Facebook ids, to skip before downloading');
  assert.match(run('research.mjs', 'start', '--brand', 'dreamyvows', '--full').run.sources[0].stop_rule, /--full/);
  run('research.mjs', 'start', '--brand', 'dreamyvows', '--source', 'shop-a', '--since', '2026-01-01', '--max-posts', '1');
  // Same post under another link spelling (tracking parameters, m.) is a duplicate; an old post (before --since) is
  // dropped; only 1 new post (--max-posts 1).
  write(path.join(a.dir, 'raw', '5.png'), pattern([200, 0, 0, 0, 0, 200]));
  write(path.join(a.dir, 'raw', '6.png'), pattern([0, 0, 200, 200, 0, 0]));
  write(path.join(a.dir, 'raw', '7.png'), pattern([0, 90, 0, 90, 0, 90], 24, 3));
  write(a.raw_file, JSON.stringify([
    { post_url: 'https://m.facebook.com/shopa/posts/100000001/?__cft__=x&ref=share', caption: 'khác', image: 'raw/5.png' },
    { post_url: 'https://www.facebook.com/shopa/posts/100000009', caption: 'Cũ lắm rồi nhưng vẫn là một caption đủ dài để so sánh', image: 'raw/6.png', posted_date: '2025-12-31' },
    { post_url: 'https://www.facebook.com/shopa/posts/100000010', caption: 'Bài mới tinh về đèn treo tường hình trái tim cho phòng khách', image: 'raw/5.png', posted_date: '2026-11-01' },
    { post_url: 'https://www.facebook.com/shopa/posts/100000011', caption: 'Một bài mới nữa về chữ neon để quầy bar quán cà phê', image: 'raw/7.png', posted_date: '2026-11-02' },
  ]));
  const inc = run('research.mjs', 'ingest', '--brand', 'dreamyvows', '--source', 'shop-a');
  assert.equal(inc.sources[0].added, 1, JSON.stringify(inc));
  assert.deepEqual(inc.sources[0].duplicate_list.map((d) => d.rule), ['post_url']);
  assert.deepEqual(inc.sources[0].dropped.map((d) => d.reason).sort(), ['vượt --max-posts', 'đăng trước --since 2026-01-01']);
  items = readItems('dreamyvows');
  assert.equal(items.length, 5);

  // ----- Mode 2 "Làm bài & đưa lên": store -> ideas -> draft -> automatic checks -> brand -> host -----
  // Store "Bỏ": a rejected item is never picked for an idea; restore puts it back.
  assert.equal(run('store.mjs', 'reject', '--brand', 'dreamyvows', '--id', 'S0002', '--note', 'không hợp').item.status, 'rejected');
  assert.match(run('store.mjs', 'reject', '--brand', 'dreamyvows', '--id', 'S0002').error, /already removed/);
  const init = run('ideas.mjs', 'init', '--brand', 'dreamyvows', '--count', '2');
  assert.equal(init.ok, true, JSON.stringify(init));
  assert.equal(init.added.length, 2);
  assert.ok(!init.items.includes('S0002'), 'rejected item not used');
  items = readItems('dreamyvows');
  // Items are not used up: an idea alone is no use (status stays new, no uses until a draft is made).
  for (const id of init.items) { const it = items.find((x) => x.id === id); assert.equal(it.status, 'new'); assert.deepEqual(it.uses || [], []); }
  // An item with an open idea gets no second idea (--items says so); a removed item is an error.
  const twice = run('ideas.mjs', 'init', '--brand', 'dreamyvows', '--items', init.items[0]);
  assert.deepEqual(twice.added, []);
  assert.match(twice.notes.join(' '), /already has open idea/);
  assert.match(run('ideas.mjs', 'init', '--brand', 'dreamyvows', '--items', 'S0002').error, /removed .không hợp.: restore it/);
  assert.equal(run('store.mjs', 'restore', '--brand', 'dreamyvows', '--id', 'S0002').item.status, 'new');
  const rest = run('ideas.mjs', 'init', '--brand', 'dreamyvows', '--count', '10');
  assert.equal(rest.added.length, 5, "the 2 unfilled ideas are dropped and their items picked again with the rest");
  assert.equal(rest.store_new_left, 0);
  // A plain re-run replaces the unfilled ideas (drops then picks the same items again): nothing piles up.
  const replay = run('ideas.mjs', 'init', '--brand', 'dreamyvows');
  assert.equal(replay.dropped_unfilled, 5);
  assert.equal(replay.added.length, 5);
  assert.equal(replay.total, 5);

  const I = replay.added[0], itemId = replay.items[0]; // the re-run replaced the earlier unfilled ideas
  const refItem = items.find((x) => x.id === itemId);
  const copied = run('ideas.mjs', 'set', '--brand', 'dreamyvows', '--id', I, '--json', JSON.stringify({ product_type: refItem.caption.split(' ').slice(0, 7).join(' '), scene: 'x', angle: 'y', caption_structure: 'z' }));
  assert.ok(copied.problems.length >= 1, JSON.stringify(copied));
  assert.equal(run('ideas.mjs', 'pick', '--brand', 'dreamyvows', '--id', I).ok, false);
  const idea = { product_type: 'neon chữ để bàn', scene: 'bàn ăn tối kỷ niệm, chạng vạng', angle: 'ngang tầm mắt người ngồi', caption_structure: 'dịp dùng, cách đặt làm, CTA' };
  assert.equal(run('ideas.mjs', 'set', '--brand', 'dreamyvows', '--id', I, '--json', JSON.stringify(idea)).idea.status, 'ready');
  assert.equal(run('ideas.mjs', 'pick', '--brand', 'dreamyvows', '--id', I).idea.status, 'picked');

  const outside = path.join(tmp, 'outside.png'); fs.writeFileSync(outside, png());
  assert.equal(run('draft.mjs', 'new', '--brand', 'dreamyvows', '--idea', I, '--product', outside).ok, false);
  assert.match(run('draft.mjs', 'new', '--brand', 'dreamyvows', '--idea', `2026-11-09/I01`, '--product', outside).error, /--idea I001/);
  const product = path.join(brandDir, 'project', 'sources', 'inputs', 'test-product', 'product.png');
  const refImage = path.join(ws, 'store', 'dreamyvows', refItem.images[0]);
  assert.equal(run('draft.mjs', 'new', '--brand', 'dreamyvows', '--idea', I, '--product', product, '--scene', refImage).ok, false);
  // Real size is required; the brand's skill marks custom-text products (product_images.custom_text): a context text,
  // never the template placeholder.
  const newArgs = ['draft.mjs', 'new', '--brand', 'dreamyvows', '--idea', I, '--product', product];
  assert.match(run(...newArgs).error, /--size/);
  assert.match(run(...newArgs, '--size', '76 cm (30 in) wide').error, /--sign-text/);
  assert.match(run(...newArgs, '--size', '76 cm (30 in) wide', '--sign-text', 'Your Names').error, /placeholder/);
  const size = ['--size', '76 cm (30 in) wide, about half the table', '--sign-text', 'Love'];
  const draft = run(...newArgs, ...size);
  assert.equal(draft.ok, true, JSON.stringify(draft));
  const made = JSON.parse(fs.readFileSync(path.join(draft.dir, 'draft.json'), 'utf8'));
  assert.equal(made.product_size, '76 cm (30 in) wide, about half the table');
  assert.equal(made.sign_text, 'Love');
  assert.equal(made.custom_text, true);
  const firstPrompt = fs.readFileSync(path.join(draft.dir, 'prompt.txt'), 'utf8');
  assert.match(firstPrompt, /Real size: 76 cm \(30 in\) wide/);
  // Proportions always in the prompt (user 10/11/2026): comparison object, limits, framing share of the image width.
  assert.match(firstPrompt, /Comparison object: the main piece of furniture/);
  assert.match(firstPrompt, /at most 60% as wide as the comparison object/);
  assert.match(firstPrompt, /at most 40% of the visible wall width/);
  assert.match(firstPrompt, /about 20-35% of the image width, never more than 35%/);
  assert.ok(!/frame-filling/.test(firstPrompt), 'the close-up line is only for scene-swap');
  assert.match(firstPrompt, /PHOTOREALISM \(a candid real-life photo/); // user 10/11/2026: real-life look, not a render
  assert.match(firstPrompt, /no glossy CGI \/ 3D-render look/);
  assert.ok(draft.warnings.some((w) => /--compare/.test(w)));
  assert.match(firstPrompt, /must read exactly: "Love"/);
  assert.ok(firstPrompt.includes(path.join(brandDir, 'references', 'image-guide.md')), 'points to the skill image guide');
  assert.ok(!/\{\{(SIZE|SIGN_TEXT_RULE|IMAGE_GUIDE)\}\}/.test(firstPrompt));
  assert.match(fs.readFileSync(path.join(draft.dir, 'brief.md'), 'utf8'), /Chữ trên bảng là "Love"/);
  assert.ok(readItems('dreamyvows').find((x) => x.id === itemId).used_by.includes(draft.id), 'store item used_by the draft');
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
  const capFile = path.join(draft.dir, 'content-en.txt');
  const goodCap = fs.readFileSync(capFile, 'utf8');
  write(capFile, goodCap.replace('"Love"', 'with Your Names'));
  const signProblems = run('draft.mjs', 'check', '--id', draft.id).problems;
  assert.ok(signProblems.some((p) => /content-en/.test(p) && /"Love"/.test(p)), JSON.stringify(signProblems));
  assert.ok(signProblems.some((p) => /Your Names/.test(p)), JSON.stringify(signProblems));
  write(capFile, goodCap.replace('#DreamyVows', 'Send us your logo or try your names in the designer.\n#DreamyVows'));
  assert.ok(!run('draft.mjs', 'check', '--id', draft.id).problems.some((p) => /Your Names/.test(p)), 'a lower-case CTA is not a placeholder');
  write(capFile, goodCap);
  const re = run('draft.mjs', 'reprompt', '--id', draft.id, '--size', '91 cm (36 in) wide', '--sign-text', 'Emma & Liam');
  assert.equal(re.ok, true, JSON.stringify(re));
  const rePrompt = fs.readFileSync(path.join(draft.dir, 'prompt.txt'), 'utf8');
  assert.match(rePrompt, /Real size: 91 cm \(36 in\)/);
  assert.match(rePrompt, /must read exactly: "Emma & Liam"/);
  assert.match(rePrompt, /A warm white neon sign reading "Love"\./); // description kept
  assert.ok(run('draft.mjs', 'check', '--id', draft.id).problems.some((p) => /"Emma & Liam"/.test(p)), 'captions must follow the new sign text');
  assert.equal(run('draft.mjs', 'reprompt', '--id', draft.id, '--size', '76 cm (30 in) wide, about half the table', '--sign-text', 'Love', '--compare', 'the dining table below, 150 cm (59 in) wide').ok, true);
  assert.match(fs.readFileSync(promptFile, 'utf8'), /Comparison object: the dining table below, 150 cm \(59 in\) wide\./);
  // Size check: measured proportions logged; over a limit blocks the draft and suggests one smaller retry.
  assert.match(run('draft.mjs', 'size-check', '--id', draft.id, '--product-pct', '50').error, /--object-pct/);
  const big = run('draft.mjs', 'size-check', '--id', draft.id, '--product-pct', '51', '--object-pct', '71');
  assert.equal(big.within_limits, false, JSON.stringify(big));
  assert.deepEqual(big.over.map((o) => o.what), ['frame', 'object']);
  assert.equal(big.smaller, 45);
  assert.match(big.next, /reprompt --id .* --smaller 45/);
  assert.ok(run('draft.mjs', 'check', '--id', draft.id).problems.some((p) => /too big/.test(p)));
  assert.equal(run('draft.mjs', 'reprompt', '--id', draft.id, '--smaller', '35').ok, true);
  assert.match(fs.readFileSync(promptFile, 'utf8'), /make the product about 35% smaller/);
  assert.match(fs.readFileSync(promptFile, 'utf8'), /the dining table below, 150 cm/); // compare kept
  const fine = run('draft.mjs', 'size-check', '--id', draft.id, '--product-pct', '30', '--object-pct', '45');
  assert.equal(fine.within_limits, true);
  assert.equal(fine.size_check.over.length, 0);
  const st = JSON.parse(fs.readFileSync(path.join(draft.dir, 'status.json'), 'utf8'));
  assert.equal(st.size_check.history.length, 0); // same image measured again: one entry per image
  const shownSize = run('draft.mjs', 'show', '--id', draft.id).size_check;
  assert.equal(shownSize.current, true);
  assert.equal(shownSize.tries, 1);
  const checked = run('draft.mjs', 'check', '--id', draft.id);
  assert.equal(checked.status, 'ready', JSON.stringify(checked.problems));
  const waiting = run('queue.mjs').brands.find((x) => x.brand === 'dreamyvows').ready;
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
  // Approve checks again, so a label slipped in after check stops that post (check_failed).
  assert.equal(run('draft.mjs', 'check', '--id', draft.id).status, 'needs_caption');
  fs.writeFileSync(vnFile, vnText);
  assert.equal(run('draft.mjs', 'check', '--id', draft.id).status, 'ready');
  fs.writeFileSync(vnFile, vnText.replace('#DreamyVows', 'made with AI\n#DreamyVows'));
  const stopped = run('finalize.mjs', 'approve', '--id', draft.id);
  assert.deepEqual(stopped.failed, [draft.id]);
  assert.match(stopped.results[0].error, /nhãn AI/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(draft.dir, 'status.json'), 'utf8')).status, 'check_failed');
  fs.writeFileSync(vnFile, vnText);

  // Nothing in the register before finalize; write-back refuses a draft not finalized. The skill folder is read-only:
  // Approve must leave it exactly as it is.
  const registerFile = path.join(ws, 'posts', 'dreamyvows', 'catalog.json');
  const skillSnapshot = () => fs.readdirSync(brandDir, { recursive: true }).sort().map((f) => { const p = path.join(brandDir, f); return fs.statSync(p).isFile() ? `${f}:${fs.statSync(p).size}:${fs.readFileSync(p).toString('base64').slice(0, 40)}` : f; }).join('|');
  const skillBefore = skillSnapshot();
  assert.equal((fs.existsSync(registerFile) ? JSON.parse(fs.readFileSync(registerFile, 'utf8')).posts : []).filter((p) => p.source === `social-autopilot ${draft.id}`).length, 0);
  assert.equal(run('writeback.mjs', '--id', draft.id).ok, false);
  // No bulk approval: a person approves each post.
  assert.match(run('finalize.mjs', 'approve', '--brand', 'dreamyvows').error, /No bulk approval/);
  assert.equal(run('draft.mjs', 'check', '--id', draft.id).status, 'ready');
  const done = run('finalize.mjs', 'approve', '--id', draft.id);
  assert.deepEqual(done.done, [draft.id], JSON.stringify(done));
  const ok = done.results[0];
  const catalog = JSON.parse(fs.readFileSync(registerFile, 'utf8'));
  const post = catalog.posts.find((p) => p.id === ok.brand_post.id);
  assert.match(post.id, /^POST-\d+$/);
  assert.equal(catalog.posts.filter((p) => p.id === post.id).length, 1); // the tool's own numbering per brand
  assert.equal(post.draft, draft.id);
  assert.equal(skillSnapshot(), skillBefore, 'Approve leaves the skill folder untouched');
  assert.equal(post.status, 'approved');
  assert.equal(post.approval.by, 'user');
  assert.equal(post.inspiration.store_item, itemId);
  assert.deepEqual(Object.keys(post.captions), ['en']); // posted captions only
  assert.deepEqual(post.review_captions, { vn: 'content-vn.txt' });
  assert.equal(post.ai_disclosure.label, undefined); // never an AI label on a post
  assert.equal(post.ai_disclosure.ai_scene, true);
  assert.ok(fs.existsSync(path.join(ws, 'posts', 'dreamyvows', post.folder, 'image.png')));
  assert.ok(ok.check_post, 'the register delivery check must run');
  assert.equal(ok.check_post.errors, 0, JSON.stringify(ok.check_post));
  // Wired after write-back: the image is committed and pushed to the host; the link check fails here (closed port), so
  // no media_url yet and the command to run again is given.
  assert.equal(ok.image_host.ok, false, JSON.stringify(ok.image_host));
  assert.ok(ok.image_host.next.endsWith(`host-image.mjs publish --brand dreamyvows --post ${post.id}`), ok.image_host.next);
  assert.equal(git(tmp, '--git-dir', hostBare, 'log', '-1', '--format=%s', 'main'), `dreamyvows ${post.id}`);
  assert.equal(post.media_url, undefined);
  assert.equal(run('finalize.mjs', 'approve', '--id', draft.id).results[0].reused, true);
  // Report: the written post with "chưa có link" and the host error + command; not sent to Metricool yet.
  const w = run('queue.mjs').brands.find((x) => x.brand === 'dreamyvows').written.find((x) => x.id === draft.id);
  assert.equal(w.media_url, null);
  assert.equal(w.image_link, 'chưa có link');
  assert.ok(w.host_error, JSON.stringify(w));
  assert.ok(w.next.includes(`--post ${post.id}`));
  assert.equal(w.metricool, 'not_sent');

  // Optional "Bỏ" before a draft reaches the brand; not after.
  run('ideas.mjs', 'pick', '--brand', 'dreamyvows', '--id', I);
  const second = run('draft.mjs', 'new', '--brand', 'dreamyvows', '--idea', I, '--product', product, '--again', ...size);
  assert.equal(run('finalize.mjs', 'cancel', '--id', second.id, '--note', 'không hợp').status, 'rejected');
  assert.match(run('finalize.mjs', 'cancel', '--id', second.id).error, /đã bỏ/);
  assert.match(run('finalize.mjs', 'cancel', '--id', draft.id).error, /đã ghi vào thương hiệu/);

  // Scene-swap: off by default (brand images only), opt-in per brand in social.json; the image is a store image.
  const socialFile = path.join(brandDir, 'project', 'social.json');
  const setRedraw = (value) => { const s = JSON.parse(fs.readFileSync(socialFile, 'utf8')); s.product_images.reference_redraw = value; fs.writeFileSync(socialFile, JSON.stringify(s, null, 2)); };
  const refPath = path.join(ws, 'store', 'dreamyvows', items.find((x) => x.id === 'S0001').images[0]);
  setRedraw({ enabled: false, require_logo_removal: true, only_if_brand_can_produce: true });
  const swapArgs = ['draft.mjs', 'new', '--brand', 'dreamyvows', '--idea', I, '--ref-image', refPath, '--again', ...size];
  assert.match(run(...swapArgs).error, /reference_redraw\.enabled/);
  setRedraw({ enabled: true, require_logo_removal: true, only_if_brand_can_produce: true });
  assert.match(run(...swapArgs).error, /brand-can-produce/);
  assert.equal(run('draft.mjs', 'new', '--brand', 'dreamyvows', '--idea', I, '--ref-image', outside, '--again', '--brand-can-produce', ...size).ok, false); // not a store image of this brand
  // The agent looks at the reference and picks the mode: a face -> new-scene, no face -> keep-scene.
  assert.match(run(...swapArgs, '--brand-can-produce').error, /--ref-mode keep-scene\|new-scene/);
  assert.match(run(...swapArgs, '--brand-can-produce', '--ref-mode', 'new-scene', '--ref-has-face', 'false').error, /does not fit/);
  const swap = run(...swapArgs, '--brand-can-produce', '--ref-mode', 'new-scene');
  assert.equal(swap.ok, true, JSON.stringify(swap));
  assert.equal(swap.ref_mode, 'new-scene');
  const swapDraft = JSON.parse(fs.readFileSync(path.join(swap.dir, 'draft.json'), 'utf8'));
  assert.equal(swapDraft.ref_mode, 'new-scene');
  assert.equal(swapDraft.ref_has_face, true);
  const swapPrompt = path.join(swap.dir, 'prompt.txt');
  assert.match(fs.readFileSync(swapPrompt, 'utf8'), /Shop A/);
  // new-scene: the reference product entirely, its text too, in a new scene with nobody in it; pulls back from the close-up.
  assert.match(fs.readFileSync(swapPrompt, 'utf8'), /MODE: NEW SCENE/);
  assert.match(fs.readFileSync(swapPrompt, 'utf8'), /Remove every person entirely/);
  assert.match(fs.readFileSync(swapPrompt, 'utf8'), /Keep the product's text EXACTLY as in the reference photo/);
  assert.ok(!/must read exactly/.test(fs.readFileSync(swapPrompt, 'utf8')));
  assert.match(fs.readFileSync(swapPrompt, 'utf8'), /do NOT keep its frame-filling scale/);
  assert.match(fs.readFileSync(path.join(swap.dir, 'brief.md'), 'utf8'), /New-scene \(ảnh tham khảo có người\)/);
  fs.writeFileSync(swapPrompt, fs.readFileSync(swapPrompt, 'utf8').replace('{{PRODUCT_DESCRIPTION}}', 'A neon sign reading "Love".'));
  assert.equal(run('draft.mjs', 'image', '--id', swap.id).ok, true);
  for (const l of ['vn', 'en']) write(path.join(swap.dir, `content-${l}.txt`), `Bảng neon "Love" giống mẫu của Shop A (${l}).\n\n🌐 Website: https://dreamyvows.com/\n#DreamyVows\n`);
  const swapCheck = run('draft.mjs', 'check', '--id', swap.id);
  assert.equal(swapCheck.status, 'needs_caption');
  assert.ok(swapCheck.problems.some((p) => /Shop A/.test(p) && /content-vn/.test(p)), 'shop name in caption is flagged');
  assert.ok(swapCheck.problems.some((p) => /confirm-clean/.test(p)), 'visual logo check is required');
  for (const l of ['vn', 'en']) write(path.join(swap.dir, `content-${l}.txt`), `Bảng neon "Love" cho bàn tiệc (${l}).\n\n🌐 Website: https://dreamyvows.com/\n#DreamyVows\n`);
  // new-scene: the agent also confirms no person is left.
  assert.match(run('draft.mjs', 'confirm-clean', '--id', swap.id, '--by', 'agent').error, /--no-people/);
  const cc = run('draft.mjs', 'confirm-clean', '--id', swap.id, '--by', 'agent', '--no-people');
  assert.equal(cc.ok, true, JSON.stringify(cc));
  assert.equal(run('draft.mjs', 'check', '--id', swap.id).status, 'ready');
  const shown = run('queue.mjs').brands.find((x) => x.brand === 'dreamyvows').ready.find((d) => d.id === swap.id);
  assert.equal(shown.reference_image, refPath); // the shop's original beside the result in the app
  const swapOk = run('finalize.mjs', 'run', '--id', swap.id).results[0];
  assert.equal(swapOk.ok, true, JSON.stringify(swapOk));
  const swapPost = JSON.parse(fs.readFileSync(path.join(ws, 'posts', 'dreamyvows', 'catalog.json'), 'utf8')).posts.find((p) => p.id === swapOk.brand_post.id);
  assert.equal(swapPost.image_mode, 'scene-swap');
  assert.equal(swapPost.ai_disclosure, true);
  assert.equal(swapPost.inspiration.source_shop, 'Shop A');
  assert.equal(swapOk.check_post.errors, 0, JSON.stringify(swapOk.check_post));

  // keep-scene (no face in the reference): the scene stays, the product gets NEW text (same language as the original).
  const keepArgs = ['draft.mjs', 'new', '--brand', 'dreamyvows', '--idea', I, '--ref-image', refPath, '--again', '--brand-can-produce', '--ref-mode', 'keep-scene', '--size', '76 cm (30 in) wide'];
  assert.match(run(...keepArgs, '--sign-text', 'Forever Us').error, /--ref-text/);
  assert.match(run(...keepArgs, '--ref-text', 'Love').error, /--sign-text/);
  assert.match(run(...keepArgs, '--ref-text', 'Love', '--sign-text', 'love!').error, /reference's own text/);
  assert.match(run(...keepArgs, '--ref-text', 'Love', '--sign-text', 'Forever Us', '--ref-has-face', 'true').error, /does not fit/);
  const keep = run(...keepArgs, '--ref-text', 'Love', '--sign-text', 'Forever Us');
  assert.equal(keep.ok, true, JSON.stringify(keep));
  const keepDraft = JSON.parse(fs.readFileSync(path.join(keep.dir, 'draft.json'), 'utf8'));
  assert.deepEqual([keepDraft.ref_mode, keepDraft.ref_has_face, keepDraft.ref_text, keepDraft.sign_text], ['keep-scene', false, 'Love', 'Forever Us']);
  const keepPrompt = path.join(keep.dir, 'prompt.txt');
  const kp = fs.readFileSync(keepPrompt, 'utf8');
  assert.match(kp, /MODE: KEEP SCENE, NEW TEXT/);
  assert.match(kp, /reads "Love"\. Replace that text ENTIRELY with exactly: "Forever Us"/);
  assert.match(kp, /same language and script as the original/);
  assert.match(kp, /NO LOGO/);
  assert.ok(!/frame-filling|Comparison object/.test(kp), 'keep-scene keeps the original framing');
  assert.match(fs.readFileSync(path.join(keep.dir, 'brief.md'), 'utf8'), /Keep-scene/);
  fs.writeFileSync(keepPrompt, kp.replace('{{PRODUCT_DESCRIPTION}}', 'A neon sign in white script.'));
  assert.equal(run('draft.mjs', 'image', '--id', keep.id).ok, true);
  assert.equal(run('draft.mjs', 'size-check', '--id', keep.id, '--product-pct', '80').skipped, true);
  const keepCaption = (t) => { for (const l of ['vn', 'en']) write(path.join(keep.dir, `content-${l}.txt`), `${t} (${l}).\n\n🌐 Website: https://dreamyvows.com/\n#DreamyVows\n`); };
  keepCaption('Bảng neon cho bàn tiệc');
  assert.equal(run('draft.mjs', 'confirm-clean', '--id', keep.id, '--by', 'agent').ok, true);
  const keepCheck = run('draft.mjs', 'check', '--id', keep.id);
  assert.ok(keepCheck.problems.some((p) => /Forever Us/.test(p)), 'captions quote the new text');
  assert.ok(!keepCheck.warnings.some((w) => /size not measured/.test(w)), 'no size check for keep-scene');
  keepCaption('Bảng neon "Forever Us" cho bàn tiệc');
  assert.equal(run('draft.mjs', 'check', '--id', keep.id).status, 'ready');
  // reprompt cannot put the reference's own text back.
  assert.match(run('draft.mjs', 'reprompt', '--id', keep.id, '--sign-text', 'LOVE').error, /reference's own text/);
  const keepShown = run('queue.mjs').brands.find((x) => x.brand === 'dreamyvows').ready.find((d) => d.id === keep.id);
  assert.equal(keepShown.ref_mode, 'keep-scene');
  assert.equal(keepShown.framing, 'kept original framing');
  setRedraw(undefined);
});

test('store dedupe rules: post link / Facebook id, caption (exact and near), image file and perceptual hash', async () => {
  const { postKey, postIds, normCaption, captionSimilarity, findDuplicate } = await import(new URL('../scripts/store.mjs', import.meta.url));
  assert.equal(postKey('https://m.facebook.com/shop/posts/123456789/?__cft__[0]=x&ref=y'), postKey('https://www.facebook.com/shop/posts/123456789'));
  assert.equal(postKey('https://www.facebook.com/photo/?fbid=555666777&set=a.1&__tn__=x'), 'facebook.com/photo?fbid=555666777');
  assert.deepEqual(postIds('https://www.facebook.com/photo/?fbid=555666777&set=a.1'), ['555666777']);
  assert.deepEqual(postIds('https://www.facebook.com/duodecor/posts/pfbid02abcDEF123ghiJKL'), ['pfbid02abcDEF123ghiJKL']);
  assert.deepEqual(postIds('https://example.com/p/123456789'), []);
  assert.equal(normCaption('Đèn NEON͏ 😍 #sale gọi 0896 677 966 https://x.vn !!'), 'đèn neon gọi');
  const long = 'đèn neon chữ love cho tiệc cưới ngoài trời ánh trắng ấm dây dài ba mét bảo hành mười hai tháng';
  assert.ok(captionSimilarity(long, long.replace('mười hai', '12')) >= 0.9);
  assert.ok(captionSimilarity(long, 'bảng led tên cô dâu chú rể treo cổng hoa màu hồng phấn kèm móc treo chắc chắn') < 0.5);
  const cfg = { image_distance: 20, caption_similarity: 0.9 };
  const store = [{ id: 'S0001', post_keys: ['facebook.com/shop/posts/111'], post_ids: ['111', '999888777'], image_sha1: ['aa'], image_phash: ['0'.repeat(64)], caption_norm: long, caption_hash: 'h1' }];
  const cand = (x) => ({ post_url: '', alt_urls: [], sha1: ['zz'], phash: ['f'.repeat(64)], caption_norm: 'ngắn', caption_hash: 'hx', ...x });
  assert.equal(findDuplicate(cand({ post_url: 'https://facebook.com/shop/posts/111/?ref=a' }), store, cfg).rule, 'post_url');
  // Facebook shows one post under the post id and each photo's fbid: any shared id is the same post.
  assert.equal(findDuplicate(cand({ post_url: 'https://www.facebook.com/shop/posts/222', alt_urls: ['https://www.facebook.com/photo/?fbid=999888777'] }), store, cfg).rule, 'post_id');
  assert.equal(findDuplicate(cand({ sha1: ['aa'] }), store, cfg).rule, 'image_sha1');
  assert.equal(findDuplicate(cand({ phash: ['0'.repeat(63) + '7'] }), store, cfg).rule, 'image_phash');
  assert.equal(findDuplicate(cand({ phash: ['f'.repeat(32) + '0'.repeat(32)] }), store, cfg), null);
  assert.equal(findDuplicate(cand({ caption_norm: long, caption_hash: 'h1' }), store, cfg).rule, 'caption');
  assert.equal(findDuplicate(cand({ caption_norm: long.replace('ba mét', '3 mét'), caption_hash: 'h2' }), store, cfg).rule, 'caption_similar');
  assert.equal(findDuplicate(cand({ caption_norm: 'đèn neon', caption_hash: 'h3' }), [{ ...store[0], caption_norm: 'đèn neon', caption_hash: 'h3' }], cfg), null, 'short captions are too common to match');
});

test('perceptual hash: same picture resized matches, different picture does not', async () => {
  const { decodePng, dhash, hamming } = await import(new URL('../scripts/phash.mjs', import.meta.url));
  const a = dhash(decodePng(pattern([0, 0, 0, 255, 255, 255], 64))), b = dhash(decodePng(pattern([0, 0, 0, 255, 255, 255], 40)));
  const c = dhash(decodePng(pattern([0, 255, 0, 255, 0, 255], 64)));
  assert.ok(hamming(a, b) <= 20, `resized: ${hamming(a, b)}`);
  assert.ok(hamming(a, c) > 40, `different: ${hamming(a, c)}`);
});

test('migrate: old dated runs into the store, duplicates once, drafted references get a use', async () => {
  const brand = 'migr';
  const day = path.join(ws, 'runs', brand, '2026-11-08', 'src1');
  write(path.join(day, 'refs', 'R01-a.png'), pattern([0, 0, 0, 255, 255, 255]));
  write(path.join(day, 'refs', 'R02-b.png'), pattern([255, 0, 0, 0, 0, 255]));
  write(path.join(day, 'refs.json'), JSON.stringify({ refs: [{ id: 'R01', post_url: 'https://www.facebook.com/x/posts/101010101', caption: 'một', image: 'refs/R01-a.png' }, { id: 'R02', post_url: 'https://www.facebook.com/x/posts/202020202', caption: 'hai', image: 'refs/R02-b.png' }] }));
  write(path.join(ws, 'runs', brand, '2026-11-08', 'ideas.json'), JSON.stringify({ ideas: [{ id: 'I01', ref: 'src1/R02', status: 'drafted', drafts: ['migr-20261108-01'] }] }));
  const day2 = path.join(ws, 'runs', brand, '2026-11-09', 'src1');
  write(path.join(day2, 'refs', 'R01-a.png'), pattern([0, 0, 0, 255, 255, 255]));
  write(path.join(day2, 'refs.json'), JSON.stringify({ refs: [{ id: 'R01', post_url: 'https://www.facebook.com/x/posts/101010101', caption: 'một', image: 'refs/R01-a.png' }] }));
  const r = run('store.mjs', 'migrate', '--brand', brand).brands[0];
  assert.equal(r.added, 2);
  assert.equal(r.duplicates, 1);
  assert.equal(run('store.mjs', 'migrate', '--brand', brand).brands[0].added, 0);
  const items = readItems(brand);
  assert.equal(items.length, 2);
  assert.equal(items[1].status, 'new', 'never a one-shot "used" status');
  assert.deepEqual(items[1].used_by, ['migr-20261108-01']);
  assert.deepEqual(items[1].uses.map((u) => u.draft), ['migr-20261108-01']);
  assert.equal(items[0].status, 'new');
});

test('research has no limits by default: another brand starts after a big run, the same brand restarts', { skip: !haveReal && 'no brand skills to copy' }, () => {
  const r = run('research.mjs', 'start', '--brand', 'grenheim');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.run.budget, undefined);
  assert.equal(r.run.mode.max_posts, 0);
  assert.equal(run('research.mjs', 'start', '--brand', 'grenheim').reused, true);
  assert.equal(run('research.mjs', 'limits').ok, false); // the command is gone
  assert.match(run('research.mjs', 'start', '--brand', 'grenheim', '--since', '9/11').error, /YYYY-MM-DD/);
  assert.match(run('research.mjs', 'start', '--brand', 'grenheim', '--source', 'nope').error, /nope/);
  // Stores stay apart per brand.
  assert.ok(!fs.existsSync(storeFile('grenheim')) || readItems('grenheim').every((i) => i.source_id === 'wood-a'));
});

// A first crawl cut by --max-posts leaves older posts; --backfill fetches them later, starting past oldest_seen.
test('backfill: progress tracks newest/oldest seen, reached_end; backfill collects older posts and then skips the source', { skip: !haveReal && 'no brand skills to copy' }, () => {
  const progress = () => JSON.parse(fs.readFileSync(path.join(ws, 'store', 'grenheim', 'progress.json'), 'utf8')).sources['wood-a'];
  const caps = ['Kệ gỗ sồi treo tường ba tầng cho phòng khách nhỏ, hoàn thiện dầu tự nhiên', 'Bàn trà gỗ óc chó chân sắt sơn tĩnh điện, mặt bàn dày bốn phân', 'Tủ giày gỗ thông cửa lùa, có ngăn kéo nhỏ để chìa khoá và ví'];
  const first = run('research.mjs', 'start', '--brand', 'grenheim', '--max-posts', '2');
  const w = first.run.sources[0];
  assert.equal(first.run.crawl_mode, 'new');
  [0, 1].forEach((n) => write(path.join(w.dir, 'raw', `b${n}.png`), pattern([n * 40, 7, 90, n, 33, 210])));
  write(w.raw_file, JSON.stringify([
    { post_url: 'https://www.facebook.com/wooda/posts/30000005', caption: caps[0], image: 'raw/b0.png', posted_date: '2026-11-05' },
    { post_url: 'https://www.facebook.com/wooda/posts/30000004', caption: caps[1], image: 'raw/b1.png', posted_date: '2026-11-04' },
  ]));
  assert.equal(run('research.mjs', 'ingest', '--brand', 'grenheim', '--source', 'wood-a').sources[0].added, 2);
  run('research.mjs', 'result', '--brand', 'grenheim', '--source', 'wood-a', '--state', 'limit');
  let p = progress();
  assert.deepEqual([p.newest_seen.date, p.newest_seen.post_id, p.oldest_seen.date, p.oldest_seen.post_id], ['2026-11-05', '30000005', '2026-11-04', '30000004']);
  assert.equal(p.reached_end, false);
  assert.deepEqual([p.last_run.mode, p.last_run.state, p.last_run.new_on_top, p.last_run.backfilled], ['new', 'limit', 2, 0]);
  let rep = run('research.mjs', 'report', '--brand', 'grenheim').sources[0];
  assert.deepEqual([rep.new_on_top, rep.backfilled, rep.reached_end, rep.reached_end_text], [2, 0, false, 'chưa']);
  assert.match(rep.older_posts, /--backfill/);

  // Backfill: start tells where to start collecting (oldest_seen), known.json carries it too; "known" is no end for it.
  assert.match(run('research.mjs', 'start', '--brand', 'grenheim', '--full', '--backfill').error, /--backfill/);
  const bf = run('research.mjs', 'start', '--brand', 'grenheim', '--backfill');
  const b = bf.run.sources[0];
  assert.equal(bf.run.crawl_mode, 'backfill');
  assert.match(b.stop_rule, /backfill: cuộn NHANH/);
  assert.match(b.stop_rule, /2026-11-04, mã 30000004/);
  assert.equal(b.oldest_seen.post_id, '30000004');
  assert.equal(JSON.parse(fs.readFileSync(b.known_file, 'utf8')).oldest_seen.date, '2026-11-04');
  assert.match(bf.next, /oldest_seen/);
  assert.match(run('research.mjs', 'result', '--brand', 'grenheim', '--source', 'wood-a', '--state', 'known').error, /backfill/);
  write(path.join(b.dir, 'raw', 'b2.png'), pattern([5, 150, 5, 150, 60, 60]));
  write(b.raw_file, JSON.stringify([{ post_url: 'https://www.facebook.com/wooda/posts/30000001', caption: caps[2], image: 'raw/b2.png', posted_date: '2026-10-01' }]));
  assert.equal(run('research.mjs', 'ingest', '--brand', 'grenheim', '--source', 'wood-a').sources[0].added, 1);
  run('research.mjs', 'result', '--brand', 'grenheim', '--source', 'wood-a', '--state', 'end');
  p = progress();
  assert.equal(p.reached_end, true);
  assert.deepEqual([p.oldest_seen.date, p.newest_seen.date], ['2026-10-01', '2026-11-05']);
  assert.deepEqual([p.last_run.mode, p.last_run.new_on_top, p.last_run.backfilled], ['backfill', 0, 1]);
  rep = run('research.mjs', 'report', '--brand', 'grenheim');
  assert.deepEqual([rep.sources[0].new_on_top, rep.sources[0].backfilled, rep.sources[0].reached_end_text, rep.backfilled_total], [0, 1, 'có', 1]);
  assert.match(rep.sources[0].older_posts, /bài cũ nhất/);

  // reached_end: backfill skips the source; the default run (new posts on top) still crawls it.
  const again = run('research.mjs', 'start', '--brand', 'grenheim', '--backfill', '--platforms', 'none');
  assert.deepEqual(again.run.sources, []);
  assert.equal(again.run.status, 'done');
  assert.equal(again.run.skipped[0].id, 'wood-a');
  assert.match(again.run.skipped[0].reason, /reached_end/);
  assert.match(run('research.mjs', 'start', '--brand', 'grenheim').run.sources[0].stop_rule, /3 bài liên tiếp/);
});

test('clean script strips U+034F and zero-width characters from a CSV', () => {
  const file = path.join(tmp, 'dirty.csv');
  write(file, '﻿store,content\nA,"Xin͏ chào​ bạn"\n');
  const r = run('research.mjs', 'clean', '--in', file, '--out', path.join(tmp, 'clean.csv'));
  assert.equal(r.hidden_chars_removed, 2);
  assert.equal(r.nbsp_replaced, 1);
  assert.match(fs.readFileSync(path.join(tmp, 'clean.csv'), 'utf8'), /"?Xin chào bạn"?/);
});

// Mode 2 in parallel: draft.mjs image-batch runs several Codex processes at once; a rate limit waits and retries once.
test('image-batch: concurrent Codex runs, prompt not filled is skipped, rate limit retried once then image_failed', { skip: !haveReal && 'no brand skills to copy' }, () => {
  const product = path.join(brandDir, 'project', 'sources', 'inputs', 'test-product', 'product.png');
  const mk = (n, promptExtra = '') => {
    const id = `dreamyvows-20261201-${n}`, dir = path.join(ws, 'drafts', 'dreamyvows', id);
    write(path.join(dir, 'draft.json'), JSON.stringify({ id, brand: 'dreamyvows', brand_dir: brandDir, image_mode: 'brand-image', product_image: product, idea: { product_type: 'x', scene: 'y' }, inspiration: {}, captions: { en: 'content-en.txt' } }));
    write(path.join(dir, 'status.json'), JSON.stringify({ status: 'needs_prompt' }));
    write(path.join(dir, 'prompt.txt'), `Edit the image. ${promptExtra}\nSave the result in the current working directory as image.png.`);
    return { id, dir };
  };
  const ok = [mk('01'), mk('02'), mk('03')];
  const unfilled = mk('04', '{{PRODUCT_DESCRIPTION}}');
  const once = mk('05', 'QUOTA-ONCE');
  const always = mk('06', 'QUOTA-ALWAYS');
  const log = path.join(tmp, 'codex-times.log');
  const r = spawnSync(process.execPath, [path.join(tool, 'scripts', 'draft.mjs'), 'image-batch', '--brand', 'dreamyvows', '--concurrency', '3'],
    { env: { ...env, FAKE_CODEX_LOG: log, FAKE_CODEX_DELAY_MS: '600', SA_CODEX_RETRY_WAIT_SECONDS: '0' }, encoding: 'utf8', windowsHide: true });
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true, r.stdout + r.stderr);
  assert.equal(out.concurrency, 3);
  for (const d of [...ok, once]) assert.ok(out.done.includes(d.id), `${d.id} done: ${JSON.stringify(out)}`);
  assert.ok(out.skipped.some((x) => x.id === unfilled.id && /PRODUCT_DESCRIPTION/.test(x.reason)));
  assert.deepEqual(out.failed.map((x) => x.id), [always.id]);
  for (const d of ok) assert.ok(fs.existsSync(path.join(d.dir, 'image.png')) && fs.existsSync(path.join(d.dir, 'codex.log')), 'own image and log');
  assert.equal(out.results.find((x) => x.id === once.id).retried_after_rate_limit, true);
  assert.match(fs.readFileSync(path.join(once.dir, 'codex.log'), 'utf8'), /attempt 2/);
  const failed = JSON.parse(fs.readFileSync(path.join(always.dir, 'status.json'), 'utf8'));
  assert.equal(failed.status, 'image_failed');
  assert.match(failed.error, /thử lại 1 lần/);
  // Parallel: at some moment more than one fake Codex was running, never more than 3.
  let busy = 0, peak = 0;
  for (const [kind] of fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => l.split(' ')).sort((a, b) => Number(a[1]) - Number(b[1]) || (a[0] === 'end' ? -1 : 1))) { busy += kind === 'start' ? 1 : -1; peak = Math.max(peak, busy); }
  assert.ok(peak >= 2 && peak <= 3, `peak ${peak}`);
  // Nothing left to do: a second batch has no work.
  const again = JSON.parse(spawnSync(process.execPath, [path.join(tool, 'scripts', 'draft.mjs'), 'image-batch', '--brand', 'all'], { env: { ...env, SA_CODEX_RETRY_WAIT_SECONDS: '0' }, encoding: 'utf8', windowsHide: true }).stdout);
  assert.deepEqual(again.done, []);
  assert.deepEqual(again.failed.map((x) => x.id), [always.id]); // an image_failed draft is tried again
});

// Brands in parallel (Mode 2/3): two image-batch processes at once never run more Codex than codex.concurrency on the
// machine (shared slots), never take the same draft, and the Run progress counts the images.
test('image-batch: parallel batches share the codex.concurrency slots; Run progress counts the images', { skip: !haveReal && 'no brand skills to copy' }, async () => {
  const settingsFile = path.join(ws, 'settings.json');
  const saved = fs.readFileSync(settingsFile, 'utf8');
  fs.writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(saved), codex: { concurrency: 2 } }));
  const find = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory() && !/^(\.git|node_modules|workspace)$/.test(e.name)) { const f = find(p); if (f) return f; } else if (/\.(png|jpe?g)$/i.test(e.name)) return p; } return ''; };
  const products = { dreamyvows: path.join(brandDir, 'project', 'sources', 'inputs', 'test-product', 'product.png'), grenheim: find(path.join(skills, 'grenheim-skills')) };
  assert.ok(products.grenheim, 'a grenheim image');
  const mk = (brand, n) => {
    const id = `${brand}-20261202-${n}`, dir = path.join(ws, 'drafts', brand, id);
    write(path.join(dir, 'draft.json'), JSON.stringify({ id, brand, brand_dir: path.join(skills, `${brand}-skills`), created: new Date().toISOString(), image_mode: 'brand-image', product_image: products[brand], idea: { product_type: 'x', scene: 'y' }, inspiration: {}, captions: { en: 'content-en.txt' } }));
    write(path.join(dir, 'status.json'), JSON.stringify({ status: 'needs_prompt' }));
    write(path.join(dir, 'prompt.txt'), 'Edit the image.\nSave the result in the current working directory as image.png.');
    return { id, dir };
  };
  // The earlier batch test left an image_failed draft (QUOTA-ALWAYS): it is out of this test.
  fs.rmSync(path.join(ws, 'drafts', 'dreamyvows', 'dreamyvows-20261201-06'), { recursive: true, force: true });
  const drafts = [...['01', '02', '03'].map((n) => mk('dreamyvows', n)), ...['01', '02', '03'].map((n) => mk('grenheim', n))];
  const pe = { ...env, SA_PROGRESS: '' };
  assert.equal(JSON.parse(spawnSync(process.execPath, [path.join(tool, 'scripts', 'progress.mjs'), 'new', '--mode', 'create'], { env: pe, encoding: 'utf8', windowsHide: true }).stdout).ok, true);
  const log = path.join(tmp, 'codex-times-2.log');
  const batch = (brand) => new Promise((done) => {
    const p = spawn(process.execPath, [path.join(tool, 'scripts', 'draft.mjs'), 'image-batch', '--brand', brand, '--concurrency', '2'], { env: { ...pe, FAKE_CODEX_LOG: log, FAKE_CODEX_DELAY_MS: '500', SA_CODEX_RETRY_WAIT_SECONDS: '0' }, windowsHide: true });
    let o = ''; p.stdout.on('data', (x) => { o += x; }); p.on('close', () => done(JSON.parse(o)));
  });
  const [a, b] = await Promise.all([batch('dreamyvows'), batch('grenheim')]);
  fs.writeFileSync(settingsFile, saved);
  assert.equal(a.ok && b.ok, true, JSON.stringify([a, b]));
  assert.deepEqual([...a.done, ...b.done].sort(), drafts.map((d) => d.id).sort(), JSON.stringify([a, b]));
  for (const d of drafts) assert.ok(fs.existsSync(path.join(d.dir, 'image.png')), d.id);
  let busy = 0, peak = 0;
  for (const [kind] of fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => l.split(' ')).sort((x, y) => Number(x[1]) - Number(y[1]) || (x[0] === 'end' ? -1 : 1))) { busy += kind === 'start' ? 1 : -1; peak = Math.max(peak, busy); }
  assert.ok(peak >= 1 && peak <= 2, `peak ${peak} > codex.concurrency 2`);
  assert.equal(fs.readdirSync(path.join(ws, 'tmp', 'codex-slots')).length, 0, 'every slot given back');
  // Run progress: step 5 (Make posts) running, Images 6/6 summed over the two brands.
  const pr = JSON.parse(fs.readFileSync(path.join(ws, 'runs', 'current-create.json'), 'utf8'));
  assert.equal(pr.steps[4].state, 'running');
  assert.deepEqual(pr.items, { label: 'Images', done: 6, total: 6 });
  // A draft another process is making is not taken twice.
  const claimed = mk('dreamyvows', '04');
  write(path.join(claimed.dir, 'status.json'), JSON.stringify({ status: 'generating', updated: new Date().toISOString() }));
  const r = run('draft.mjs', 'image', '--id', claimed.id);
  assert.equal(r.ok, false);
  assert.match(r.error, /tiến trình khác/);
  assert.equal(run('draft.mjs', 'image-batch', '--brand', 'dreamyvows').done.length, 0, 'a fresh claim is skipped by a batch');
});
