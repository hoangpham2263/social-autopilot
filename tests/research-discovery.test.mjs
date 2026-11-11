// Mode 1 redesign (user, 10/11/2026): the agent collects with Playwright MCP; reference pages first, then discovery by
// keywords/hashtags round-robin across platforms; only posts whose product fits the brand are stored; dedupe across
// platforms; the skill's research.discovery block (check-skill).
// npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { discoveryQueries, searchUrl, nextTask, brandTotal } from '../scripts/research.mjs';
import { postIds, platformOfUrl, fitProblem } from '../scripts/store.mjs';

const tool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-discovery-test-'));
const skills = path.join(tmp, 'skills'), ws = path.join(tmp, 'workspace'), brandDir = path.join(skills, 'dv-skills');
const env = { ...process.env, SA_WORKSPACE: ws, SA_SKILLS_ROOT: skills, SA_PROGRESS: 'off' };
const write = (f, x) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof x === 'string' || Buffer.isBuffer(x) ? x : JSON.stringify(x)); };
const run = (script, ...args) => { const r = spawnSync(process.execPath, [path.join(tool, 'scripts', script), ...args], { env, encoding: 'utf8', windowsHide: true }); try { return JSON.parse(r.stdout); } catch { throw new Error(r.stdout + r.stderr); } };
// A small PNG with a seeded 8x8 pattern: different seeds = different images (dHash), same seed = the same image.
function pattern(seed, size = 32) {
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

const productFit = { types: ['wedding neon sign', 'name neon sign'], must_have: ['a LED neon sign is the subject'], must_not: ['LED strip lights'] };
write(path.join(brandDir, 'SKILL.md'), '# dv');
write(path.join(brandDir, 'project', 'project.md'), '# dv\nProducts: custom LED neon signs.');
write(path.join(brandDir, 'scripts', 'check-skill.mjs'), "console.log('ok')");
write(path.join(brandDir, 'project', 'social.json'), { brand: 'DV', enabled: true, channels: [{ network: 'facebook', enabled: true, lang: ['en'] }], cadence: { timezone: 'America/New_York' },
  research: { sources: [{ id: 'shop', name: 'Shop', platform: 'facebook', url: 'https://www.facebook.com/shop', enabled: true, what_to_take: 'neon signs' }],
    discovery: { enabled: true, platforms: [{ id: 'instagram', enabled: true, notes: 'tags' }, { id: 'pinterest', enabled: true }, { id: 'etsy', enabled: true }, { id: 'houzz', enabled: false }],
      keywords: ['custom neon sign', 'wedding neon sign'], hashtags: ['customneonsign'], product_fit: productFit, max_per_platform: 2 } } });

test('discovery queries: keywords and hashtags interleaved per platform, hashtags only where the platform has tag pages; search URLs', () => {
  const qs = discoveryQueries(['instagram', 'etsy'], ['custom neon sign', 'wedding neon sign'], ['customneonsign']);
  assert.deepEqual(qs.map((q) => q.id), ['instagram-k-custom-neon-sign', 'instagram-h-customneonsign', 'instagram-k-wedding-neon-sign', 'etsy-k-custom-neon-sign', 'etsy-k-wedding-neon-sign']);
  assert.deepEqual(qs.map((q) => q.found_by).slice(0, 2), ['keyword:custom neon sign', 'hashtag:customneonsign']);
  assert.equal(searchUrl('instagram', 'hashtag', 'CustomNeonSign'), 'https://www.instagram.com/explore/tags/customneonsign/');
  assert.equal(searchUrl('etsy', 'keyword', 'custom neon sign'), 'https://www.etsy.com/search?q=custom%20neon%20sign');
  assert.equal(searchUrl('houzz', 'keyword', 'live edge dining table'), 'https://www.houzz.com/photos/query/live-edge-dining-table');
  assert.match(searchUrl('reddit', 'keyword', 'walnut desk'), /reddit\.com\/search\/\?q=walnut%20desk/);
});

test('next: reference pages first, then discovery round-robin across platforms; caps, blocked platforms and the target', () => {
  const q = (id, platform, state = 'pending', kept = 0) => ({ id, platform, state, kept, found_by: `keyword:${id}` });
  const base = () => ({ brand: 'dv', mode: { max_posts: 0 }, sources: [{ id: 'shop', url: 'https://www.facebook.com/shop', result: null, new: 0 }],
    discovery: { max_per_platform: 2, platforms: [{ id: 'instagram' }, { id: 'pinterest' }, { id: 'etsy' }], queries: [q('i1', 'instagram'), q('i2', 'instagram'), q('p1', 'pinterest'), q('e1', 'etsy')] } });
  const r = base();
  assert.equal(nextTask(r).step, 'reference');
  assert.equal(nextTask(r).source, 'shop');
  r.sources[0].result = { state: 'end' }; r.sources[0].new = 1;
  assert.deepEqual([nextTask(r).step, nextTask(r).query], ['discovery', 'i1']);
  r.discovery.queries[0].state = 'done';
  assert.equal(nextTask(r).query, 'p1', 'round-robin: the next platform, not the next instagram query');
  r.discovery.queries[2].state = 'empty';
  assert.equal(nextTask(r).query, 'e1');
  r.discovery.queries[3].state = 'done';
  assert.equal(nextTask(r).query, 'i2');
  // A platform at max_per_platform is skipped; a blocked platform too.
  const c = base(); c.sources[0].result = { state: 'end' }; c.discovery.queries[0] = q('i1', 'instagram', 'done', 2);
  assert.equal(nextTask(c).query, 'p1');
  assert.equal(nextTask(c).share, 2);
  const b = base(); b.sources[0].result = { state: 'end' }; b.discovery.queries[0].state = 'blocked'; b.discovery.queries[1].state = 'skipped';
  assert.equal(nextTask(b).query, 'p1');
  // Target: the share is what is left; met = done (also before the reference pages are all done).
  const t = base(); t.mode.max_posts = 3; t.sources[0].result = { state: 'end' }; t.sources[0].new = 2;
  assert.deepEqual([nextTask(t).query, nextTask(t).share, brandTotal(t)], ['i1', 1, 2]);
  t.discovery.queries[0].kept = 1; t.discovery.queries[0].state = 'limit';
  assert.equal(nextTask(t).step, 'done');
  assert.match(nextTask(t).reason, /target reached \(3\/3\)/);
  const t2 = base(); t2.mode.max_posts = 1; t2.discovery.queries[0].kept = 1;
  assert.equal(nextTask(t2).skip, true, 'target met: the remaining reference page is skipped');
  const all = base(); all.sources[0].result = { state: 'end' }; for (const x of all.discovery.queries) x.state = 'done';
  assert.match(nextTask(all).reason, /every discovery query is done/);
});

test('cross-platform post ids, platform of a link, product fit', () => {
  assert.deepEqual(postIds('https://www.instagram.com/reel/CxYz123/'), postIds('https://instagram.com/p/CxYz123/?igsh=abc'));
  assert.deepEqual(postIds('https://www.pinterest.com/pin/neon-sign--1234567890/'), ['pin:1234567890']);
  assert.deepEqual(postIds('https://www.etsy.com/listing/123456789/custom-neon'), ['etsy:123456789']);
  assert.equal(platformOfUrl('https://www.houzz.com/photos/x-phvw-vp~123456'), 'houzz');
  assert.equal(fitProblem({ product_fit: { type: 'Wedding Neon Sign' } }, productFit, { required: true }), '');
  assert.match(fitProblem({ product_fit: { type: 'LED strip' } }, productFit), /not one of the brand's product types/);
  assert.match(fitProblem({}, productFit, { required: true }), /no product_fit\.type/);
  assert.equal(fitProblem({}, productFit), '', 'a crawled reference post without product_fit goes to the filter step');
  assert.match(fitProblem({ product_fit: { fit: false, reason: 'string lights' } }, productFit), /^off-brand: string lights$/);
});

test('CLI: start with platforms/keywords; reference page, then discovery; product fit at capture; dedupe across platforms; report + library', () => {
  assert.equal(run('research.mjs', 'start', '--brand', 'dv', '--platforms', 'myspace').ok, false);
  const none = run('research.mjs', 'start', '--brand', 'dv', '--platforms', 'none');
  assert.equal(none.discovery, null);
  const kw = run('research.mjs', 'start', '--brand', 'dv', '--platforms', 'instagram,houzz', '--keywords', 'neon name sign');
  assert.deepEqual(kw.discovery.platforms, ['instagram'], 'houzz is not enabled in the skill');
  assert.deepEqual(kw.discovery.platforms_ignored, ['houzz']);
  assert.deepEqual(kw.discovery.keywords, ['neon name sign']);
  const st = run('research.mjs', 'start', '--brand', 'dv', '--max-posts', '5');
  assert.equal(st.ok, true, JSON.stringify(st));
  assert.deepEqual(st.discovery.platforms, ['instagram', 'pinterest', 'etsy']);
  assert.equal(st.discovery.queries, 8);

  // 1. The reference page first.
  const n1 = run('research.mjs', 'next', '--brand', 'dv');
  assert.deepEqual([n1.step, n1.source, n1.found_by], ['reference', 'shop', 'reference page']);
  write(path.join(n1.downloads, '1.png'), pattern([1, 2, 3]));
  write(path.join(n1.downloads, '2.png'), pattern([9, 9, 9]));
  write(n1.raw_file, { page: { name: 'Shop' }, posts: [
    { post_url: 'https://www.facebook.com/shop/posts/11111111', caption: 'Mr & Mrs neon for the sweetheart table', images: ['raw/1.png'], product_fit: { type: 'wedding neon sign', reason: 'neon sign is the subject' } },
    { post_url: 'https://www.facebook.com/shop/posts/22222222', caption: 'Fairy lights', images: ['raw/2.png'], product_fit: { fit: false, reason: 'string lights, no sign' } },
  ], rejected: [{ post_url: 'https://www.facebook.com/shop/posts/33333333', reason: 'LED strip lights' }] });
  const i1 = run('research.mjs', 'ingest', '--brand', 'dv', '--source', 'shop');
  assert.deepEqual([i1.sources[0].added, i1.sources[0].rejected_off_brand], [1, 2], JSON.stringify(i1));
  run('research.mjs', 'result', '--brand', 'dv', '--source', 'shop', '--state', 'end');

  // 2. Discovery: instagram first.
  const n2 = run('research.mjs', 'next', '--brand', 'dv');
  assert.deepEqual([n2.step, n2.platform, n2.query, n2.share], ['discovery', 'instagram', 'instagram-k-custom-neon-sign', 2]);
  assert.ok(fs.existsSync(n2.downloads));
  assert.deepEqual(n2.product_fit.types, productFit.types);
  for (const [n, seed] of [[1, [5, 5, 5]], [2, [6, 6, 6]], [3, [7, 7, 7]], [4, [1, 2, 3]]]) write(path.join(n2.downloads, `${n}.png`), pattern(seed));
  write(n2.raw_file, { query: { id: n2.query, platform: 'instagram' }, platform: 'instagram', posts: [
    { post_url: 'https://www.instagram.com/p/AbCdE1/', author: '@neonweddings', caption: 'Our names in lights', images: ['raw/1.png'], likes: 120, product_fit: { type: 'name neon sign', reason: 'name sign on the wall' } },
    { post_url: 'https://www.instagram.com/p/AbCdE2/', author: '@lights', caption: 'Strip lights', images: ['raw/2.png'], product_fit: { type: 'LED strip lights', reason: '' } },
    { post_url: 'https://www.instagram.com/p/AbCdE3/', author: '@x', caption: 'no fit given', images: ['raw/3.png'] },
    { post_url: 'https://www.instagram.com/p/AbCdE4/', author: '@repost', caption: 'reposted', images: ['raw/4.png'], product_fit: { type: 'wedding neon sign' } },
  ], rejected: [{ post_url: 'https://www.instagram.com/p/AbCdE9/', author: '@car', reason: 'neon car, no sign' }] });
  const i2 = run('research.mjs', 'ingest', '--brand', 'dv', '--query', n2.query);
  assert.equal(i2.ok, true, JSON.stringify(i2));
  assert.deepEqual([i2.added, i2.rejected_off_brand, i2.duplicates], [1, 3, 1], JSON.stringify(i2));
  assert.equal(i2.duplicate_list[0].rule, 'image_sha1', 'the same photo already came from the reference page');
  const res = run('research.mjs', 'result', '--brand', 'dv', '--query', n2.query, '--state', 'done');
  assert.equal(res.state, 'done');

  // 3. Round-robin: pinterest next. Its post links the instagram reel of the same post (/reel/ = /p/): a duplicate.
  const n3 = run('research.mjs', 'next', '--brand', 'dv');
  assert.deepEqual([n3.platform, n3.query], ['pinterest', 'pinterest-k-custom-neon-sign']);
  write(path.join(n3.downloads, '1.png'), pattern([40, 41, 42]));
  write(path.join(n3.downloads, '2.png'), pattern([50, 51, 52]));
  write(n3.raw_file, { platform: 'pinterest', posts: [
    { post_url: 'https://www.pinterest.com/pin/111222333444/', alt_urls: ['https://www.instagram.com/reel/AbCdE1/'], caption: 'pinned', images: ['raw/1.png'], product_fit: { type: 'name neon sign' } },
    { post_url: 'https://www.pinterest.com/pin/555666777888/', author: 'Neon Co', caption: 'Better Together neon at the reception', images: ['raw/2.png'], product_fit: { type: 'wedding neon sign', reason: 'clear sign' } },
  ] });
  const i3 = run('research.mjs', 'ingest', '--brand', 'dv', '--query', n3.query);
  assert.deepEqual([i3.added, i3.duplicates, i3.duplicate_list[0].rule], [1, 1, 'post_id'], JSON.stringify(i3));
  run('research.mjs', 'result', '--brand', 'dv', '--query', n3.query, '--state', 'limit');
  // Blocked on etsy: its other query is skipped, the others go on.
  const n4 = run('research.mjs', 'next', '--brand', 'dv');
  assert.equal(n4.platform, 'etsy');
  assert.equal(run('research.mjs', 'result', '--brand', 'dv', '--query', n4.query, '--state', 'blocked').ok, false, 'blocked needs a note');
  const blk = run('research.mjs', 'result', '--brand', 'dv', '--query', n4.query, '--state', 'blocked', '--note', 'login wall');
  assert.deepEqual(blk.skipped, ['etsy-k-wedding-neon-sign']);
  assert.equal(run('research.mjs', 'next', '--brand', 'dv').platform, 'instagram');

  // Store items carry platform, source_url, author, found_by, product_fit; off-brand posts are not stored but logged.
  const items = JSON.parse(fs.readFileSync(path.join(ws, 'store', 'dv', 'items.json'), 'utf8')).items;
  assert.equal(items.length, 3);
  assert.deepEqual([items[0].platform, items[0].found_by, items[0].product_fit.type], ['facebook', 'reference page', 'wedding neon sign']);
  const ig = items.find((i) => i.platform === 'instagram');
  assert.deepEqual([ig.source_id, ig.author, ig.found_by, ig.product_fit.type, ig.likes, ig.query], ['discovery-instagram', '@neonweddings', 'keyword:custom neon sign', 'name neon sign', 120, 'instagram-k-custom-neon-sign']);
  assert.equal(ig.source_url, 'https://www.instagram.com/explore/search/keyword/?q=custom%20neon%20sign');
  const rejected = JSON.parse(fs.readFileSync(path.join(ws, 'store', 'dv', 'rejected.json'), 'utf8')).rejected;
  assert.equal(rejected.length, 5);
  assert.ok(rejected.every((x) => /^off-brand: /.test(x.reason)), JSON.stringify(rejected));
  assert.ok(rejected.some((x) => x.post_url.endsWith('AbCdE9/') && x.query === 'instagram-k-custom-neon-sign' && x.found_by === 'keyword:custom neon sign'));

  // Report: per platform / query counts.
  const rep = run('research.mjs', 'report', '--brand', 'dv');
  const igp = rep.discovery.platforms.find((p) => p.id === 'instagram');
  assert.deepEqual([igp.kept, igp.rejected_off_brand, igp.duplicates, igp.done], [1, 3, 1, 1]);
  assert.equal(rep.discovery.platforms.find((p) => p.id === 'etsy').blocked, true);
  assert.deepEqual([rep.new_total, rep.discovery_kept_total, rep.rejected_off_brand_total], [3, 2, 5]);

  // Library: filter by platform.
  const lib = run('store.mjs', 'list', '--brand', 'dv', '--platform', 'pinterest');
  assert.deepEqual(lib.items.map((i) => [i.platform, i.found_by]), [['pinterest', 'keyword:custom neon sign']]);
  assert.deepEqual(lib.platforms, ['facebook', 'instagram', 'pinterest']);

  // Filter step: product_fit rules in the batch; an off-brand verdict -> Removed with its reason.
  const cls = run('store.mjs', 'classify', '--brand', 'dv');
  assert.deepEqual(cls.product_fit.types, productFit.types);
  assert.ok(cls.items.every((i) => i.platform && i.found_by));
  const file = path.join(tmp, 'v.json');
  write(file, [{ id: ig.id, fit: false, reason: 'off-brand: the sign is a tiny background detail' }]);
  run('store.mjs', 'verdict', '--brand', 'dv', '--file', file);
  const shown = run('store.mjs', 'show', '--brand', 'dv', '--id', ig.id).item;
  assert.deepEqual([shown.status, shown.note], ['rejected', 'filter: off-brand: the sign is a tiny background detail']);
});

// check-skill of the skill standard validates research.discovery (skips without the workspace repo).
const realSkill = path.resolve(tool, '..', 'vaniecom-workspace', 'skills', 'dreamyvows-skills');
test('check-skill: research.discovery block is validated and product_fit is needed for --tool-ready', { skip: !fs.existsSync(path.join(realSkill, 'scripts', 'check-skill.mjs')) && 'no vaniecom-workspace skills' }, () => {
  const dir = path.join(tmp, 'skill-copy');
  for (const p of ['SKILL.md', 'project', 'scripts', 'references', 'templates']) if (fs.existsSync(path.join(realSkill, p))) fs.cpSync(path.join(realSkill, p), path.join(dir, p), { recursive: true });
  for (const d of ['workspace/posts', 'workspace/published', 'workspace/covers']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  const check = (...a) => spawnSync(process.execPath, [path.join(dir, 'scripts', 'check-skill.mjs'), ...a], { cwd: dir, encoding: 'utf8', windowsHide: true });
  const sj = path.join(dir, 'project', 'social.json');
  const social = JSON.parse(fs.readFileSync(sj, 'utf8'));
  assert.ok(social.research.discovery.enabled && social.research.discovery.product_fit.types.length, 'DreamyVows declares discovery');
  const bad = structuredClone(social);
  bad.research.discovery.platforms.push({ id: 'myspace', enabled: true });
  bad.research.discovery.hashtags.push('#neon sign');
  bad.research.discovery.max_per_platform = 0;
  bad.research.discovery.product_fit = { types: 'neon' };
  fs.writeFileSync(sj, JSON.stringify(bad));
  const out = check().stdout;
  for (const re of [/platforms\[\d+\]\.id phải thuộc/, /discovery\.hashtags phải là mảng chuỗi/, /max_per_platform phải là số nguyên/, /product_fit\.types phải là mảng chuỗi/]) assert.match(out, re);
  const noFit = structuredClone(social);
  delete noFit.research.discovery;
  noFit.enabled = false;
  fs.writeFileSync(sj, JSON.stringify(noFit));
  const r = check('--tool-ready');
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /research\.discovery\.product_fit/);
});
