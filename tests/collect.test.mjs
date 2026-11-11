// The generic collector (scripts/collect.mjs) and the platform adapters (scripts/platforms/): the PURE parts only, no
// browser and no network. URL/id parsing per platform, search URLs (same as research.mjs), the registry status, login-wall
// detection and tile extraction on saved HTML (tests/fixtures/collect-*.html, linkedom), the raw.json shape that
// `research.mjs ingest` accepts, the product-fit decisions, the delay floor.
// npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { REGISTRY, STATUSES, getAdapter, adapterStatus, isTrusted, platformIds } from '../scripts/platforms/index.mjs';
import { extractTiles, wallSignals, classifyWall } from '../scripts/platforms/common.mjs';
import * as instagram from '../scripts/platforms/instagram.mjs';
import * as pinterest from '../scripts/platforms/pinterest.mjs';
import * as facebook from '../scripts/platforms/facebook.mjs';
import * as etsy from '../scripts/platforms/etsy.mjs';
import * as houzz from '../scripts/platforms/houzz.mjs';
import { SELECTORS as FB, extractFeed } from '../scripts/fb-extract.mjs';
import { resolveTask, rawShape, toRawPost, applyDecisions, suggestedState, fileId } from '../scripts/collect.mjs';
import { searchUrl as researchSearchUrl, nextTask, collectInfo } from '../scripts/research.mjs';

const tool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = (n) => parseHTML(fs.readFileSync(path.join(tool, 'tests', 'fixtures', `collect-${n}.html`), 'utf8')).document;
const MODS = { instagram, pinterest, facebook, etsy, houzz };
const GRID = { instagram, pinterest, etsy, houzz };
// Every grid adapter's tiles on a fixture, as the adapter turns them into posts.
const tilesOf = (id, name, base) => {
  const S = GRID[id].SELECTORS;
  const cfg = { link: S.link, url_pattern: S.url_pattern, container: S.container, img: S.img, img_skip: S.img_skip, author: S.author, caption: S.caption, base };
  return extractTiles(fixture(name), cfg).tiles.map((t) => GRID[id].toPost(t, { found_by: 'keyword:neon' })).filter(Boolean);
};
const wall = (id, name) => {
  const S = MODS[id].SELECTORS;
  const sig = wallSignals(fixture(name), { login_form: S.wall.login_form, captcha: S.wall.captcha, dialog: S.wall.dialog, url: 'https://example.com/' });
  return classifyWall(sig, S.wall);
};

test('registry: every platform has an adapter with the full contract; status is untested until checked on a live page', () => {
  assert.deepEqual(platformIds().sort(), ['etsy', 'facebook', 'houzz', 'instagram', 'pinterest']);
  for (const id of platformIds()) {
    const e = REGISTRY[id], a = getAdapter(id);
    assert.ok(STATUSES.includes(e.status), id);
    if (e.status !== 'untested') assert.match(e.checked, /^\d{4}-\d{2}-\d{2}$/, `${id}: ok needs the date it was checked`);
    else assert.equal(e.checked, '', id); // ok and broken both carry the date of the live check
    for (const f of ['searchUrl', 'pageScript', 'toPost', 'postId']) assert.equal(typeof a[f], 'function', `${id}.${f}`);
    assert.ok(a.SELECTORS && typeof a.SELECTORS === 'object', `${id}: selectors in one block`);
  }
  assert.equal(adapterStatus('myspace').status, 'missing');
  assert.equal(isTrusted('myspace'), false);
});

test('search URLs: the adapters agree with research.mjs for keywords and hashtags', () => {
  for (const id of platformIds()) {
    assert.equal(getAdapter(id).searchUrl('custom neon sign'), researchSearchUrl(id, 'keyword', 'custom neon sign'), `${id} keyword`);
    if (['instagram', 'facebook', 'pinterest'].includes(id)) assert.equal(getAdapter(id).searchUrl('#CustomNeonSign'), researchSearchUrl(id, 'hashtag', 'CustomNeonSign'), `${id} hashtag`);
  }
});

test('post id / url parsing per platform (pure)', () => {
  assert.equal(instagram.postId('https://www.instagram.com/p/CxAbC12345/?igsh=1'), 'CxAbC12345');
  assert.equal(instagram.postId('https://www.instagram.com/studio/reel/CxAbC12345/'), 'CxAbC12345');
  assert.equal(instagram.canonicalUrl('https://www.instagram.com/studio/p/CxAbC12345/?x=1'), 'https://www.instagram.com/p/CxAbC12345/');
  assert.equal(instagram.canonicalUrl('https://www.instagram.com/reel/Dy123456/'), 'https://www.instagram.com/reel/Dy123456/');
  assert.equal(instagram.authorOf('https://www.instagram.com/studio.events/p/CxAbC12345/'), '@studio.events');
  assert.equal(instagram.authorOf('https://www.instagram.com/p/CxAbC12345/'), '');
  assert.equal(pinterest.postId('https://www.pinterest.com/pin/some-title--987654321098/'), '987654321098');
  assert.equal(pinterest.canonicalUrl('https://www.pinterest.com/pin/123456789012/?x=1'), 'https://www.pinterest.com/pin/123456789012/');
  assert.equal(pinterest.upgradeImage('https://i.pinimg.com/236x/ab/cd/x.jpg'), 'https://i.pinimg.com/736x/ab/cd/x.jpg');
  assert.equal(etsy.postId('https://www.etsy.com/uk/listing/1234567890/custom-neon?ref=x'), '1234567890');
  assert.equal(etsy.canonicalUrl('https://www.etsy.com/listing/1234567890/custom-neon?ref=x'), 'https://www.etsy.com/listing/1234567890');
  assert.equal(etsy.upgradeImage('https://i.etsystatic.com/1/r/il/ab/5/il_340x270.5_ab.jpg'), 'https://i.etsystatic.com/1/r/il/ab/5/il_794xN.5_ab.jpg');
  assert.equal(houzz.postId('https://www.houzz.com/photos/live-edge-dining-table-phvw-vp~12345678?x=1'), '12345678');
  assert.deepEqual(facebook.postIds('https://www.facebook.com/shop/posts/pfbid02abcdefghij'), ['pfbid02abcdefghij']);
  assert.deepEqual(facebook.postIds('https://www.facebook.com/photo/?fbid=1122334455'), ['1122334455']);
  assert.equal(facebook.postId('https://www.facebook.com/shop/posts/1234567890'), '1234567890');
  assert.equal(facebook.postId('https://www.facebook.com/'), '');
});

test('tiles on saved pages become adapter posts: id, canonical url, images, caption, author, found_by', () => {
  const ig = tilesOf('instagram', 'instagram-grid', 'https://www.instagram.com/explore/tags/neon/');
  assert.deepEqual(ig.map((p) => p.id), ['CxAbC12345', 'CxAbC12345', 'DyXyZ98765']);
  assert.equal(new Set(ig.map((p) => p.url)).size, 2, 'the same code under /p/ and /<user>/p/ is one post (same canonical url)');
  assert.equal(ig[0].url, 'https://www.instagram.com/p/CxAbC12345/');
  assert.equal(ig[2].url, 'https://www.instagram.com/reel/DyXyZ98765/');
  assert.match(ig[0].caption, /Better Together neon sign/);
  assert.deepEqual(ig[0].image_urls, ['https://scontent.cdninstagram.com/v/t51/a1.jpg']);
  assert.equal(ig[0].found_by, 'keyword:neon');
  const pin = tilesOf('pinterest', 'pinterest-grid', 'https://www.pinterest.com/search/pins/?q=neon');
  assert.deepEqual(pin.map((p) => p.id), ['123456789012', '987654321098']);
  assert.equal(pin[0].image_urls[0], 'https://i.pinimg.com/736x/ab/cd/ef/abcdef.jpg');
  assert.equal(pin[1].image_urls[0], 'https://i.pinimg.com/736x/11/22/33/x.jpg', 'the largest srcset entry');
  assert.equal(pin[0].caption, 'Custom neon sign wedding');
  const et = tilesOf('etsy', 'etsy-grid', 'https://www.etsy.com/search?q=neon');
  assert.deepEqual(et.map((p) => p.url), ['https://www.etsy.com/listing/1234567890', 'https://www.etsy.com/listing/2222222222']);
  assert.match(et[0].image_urls[0], /il_794xN\.5555_abcd\.jpg$/);
  assert.equal(et[0].caption, 'Custom neon sign for wedding');
  assert.equal(et[0].author, 'NeonShopUS');
  const hz = tilesOf('houzz', 'houzz-grid', 'https://www.houzz.com/photos/query/live-edge');
  assert.equal(hz.length, 1);
  assert.equal(hz[0].id, '12345678');
  assert.match(hz[0].image_urls[0], /[/]fimgs[/].*-w1000-h1000-b0-p0/);
  assert.equal(hz[0].image_urls.length, 1, 'the professional avatar (/simgs/) is not an image of the post');
  assert.equal(etsy.stripCaption('May include: A neon sign.'), 'A neon sign.');
  assert.equal(etsy.shopOf('Ad・By AncientArt Ad from shop AncientArt'), 'AncientArt');
  assert.equal(etsy.shopOf('By VibeyDesignCo From shop VibeyDesignCo'), 'VibeyDesignCo');
});

test('facebook adapter reads posts through fb-extract (reused, not copied)', () => {
  const doc = parseHTML(fs.readFileSync(path.join(tool, 'tests', 'fixtures', 'fb-feed.html'), 'utf8')).document;
  const posts = extractFeed(doc, FB).posts.map((p) => facebook.toPost(p, { found_by: 'hashtag:neon' })).filter(Boolean);
  assert.ok(posts.length >= 1);
  for (const p of posts) { assert.ok(p.id && p.url.startsWith('https://www.facebook.com/'), p.url); assert.equal(p.found_by, 'hashtag:neon'); assert.ok(Array.isArray(p.image_urls)); }
  assert.equal(facebook.SELECTORS.feed, FB);
});

test('login wall / captcha / block page detection on saved HTML; ordinary pages pass', () => {
  assert.match(wall('instagram', 'instagram-wall'), /login/i);
  assert.match(wall('pinterest', 'pinterest-wall'), /sign-in dialog|blocked|login/i);
  assert.equal(wall('etsy', 'etsy-wall'), 'captcha');
  assert.match(wall('houzz', 'houzz-wall'), /captcha/);
  for (const id of Object.keys(MODS)) assert.equal(wall(id, 'ok-page'), '', `${id}: a normal page is not a wall`);
  for (const [id, name] of [['instagram', 'instagram-grid'], ['pinterest', 'pinterest-grid'], ['etsy', 'etsy-grid']]) assert.equal(wall(id, name), '', `${id} grid`);
  assert.match(classifyWall({ url: 'https://www.instagram.com/accounts/login/?next=/explore/' }, instagram.SELECTORS.wall), /login wall/);
  assert.match(classifyWall({ url: 'https://www.facebook.com/checkpoint/1' }, facebook.SELECTORS.wall), /login wall|block/);
  assert.match(classifyWall({ title: 'x', text: 'Sorry, unusual traffic from your computer network' }, {}), /unusual traffic/);
});

test('resolveTask: from an open run (query / source) or standalone; max defaults to the step share', () => {
  const run = { brand: 'dv', mode: { max_posts: 6 }, sources: [{ id: 'shop', name: 'Shop', platform: 'instagram', url: 'https://www.instagram.com/shop/', dir: '/w/shop', raw_file: '/w/shop/raw.json', known_file: '/w/shop/known.json', result: null, new: 0 }],
    discovery: { max_per_platform: 4, platforms: [{ id: 'etsy' }], queries: [{ id: 'etsy-k-neon', platform: 'etsy', kind: 'keyword', term: 'neon', found_by: 'keyword:neon', url: 'https://www.etsy.com/search?q=neon', state: 'pending', kept: 0, dir: '/w/q', raw_file: '/w/q/raw.json' }] } };
  const s = resolveTask({ 'for-source': 'shop' }, run);
  assert.deepEqual([s.kind, s.platform, s.found_by, s.raw_file, s.max], ['source', 'instagram', 'reference page', '/w/shop/raw.json', 6]);
  assert.equal(resolveTask({ 'for-source': 'shop', max: '3' }, run).max, 3);
  const done = { ...run, sources: [{ ...run.sources[0], result: { state: 'end' } }] };
  const q = resolveTask({ 'for-query': 'etsy-k-neon' }, done);
  assert.deepEqual([q.kind, q.platform, q.found_by, q.dir, q.max, q.mode], ['query', 'etsy', 'keyword:neon', '/w/q', 4, { full: true }]);
  assert.throws(() => resolveTask({ 'for-query': 'nope' }, run), /không có trong lượt/);
  assert.throws(() => resolveTask({ 'for-query': 'x' }, null), /Chưa có lượt/);
  const t = resolveTask({ platform: 'Etsy', query: '#neon sign', out: path.join(os.tmpdir(), 'sa-collect-x') });
  assert.deepEqual([t.kind, t.platform, t.found_by, t.max, t.url], ['standalone', 'etsy', 'hashtag:neon sign', 30, 'https://www.etsy.com/search?q=neon%20sign']);
  assert.throws(() => resolveTask({ platform: 'myspace', query: 'x' }), /Chưa có adapter/);
  assert.throws(() => resolveTask({ platform: 'etsy' }), /--url/);
  assert.throws(() => resolveTask({}), /--platform/);
});

test('next: every step carries the one path (open, scroll, script, from-page, target, stop rules) and the adapter status', () => {
  const run = { brand: 'dv', mode: { max_posts: 5 }, sources: [{ id: 'shop', platform: 'instagram', url: 'https://www.instagram.com/shop/', result: null, new: 0 }],
    discovery: { max_per_platform: 3, platforms: [{ id: 'etsy' }], queries: [{ id: 'etsy-k-neon', platform: 'etsy', found_by: 'keyword:neon', state: 'pending', kept: 0 }] } };
  const a = nextTask(run);
  assert.match(a.script, /^node scripts\/collect\.mjs script --brand dv --for-source shop( --max \d+)?$/);
  assert.equal(a.adapter.platform, 'instagram');
  assert.match(a.do, /ONE path/);
  assert.equal(a.open, 'https://www.instagram.com/shop/');
  assert.equal(a.scroll_wait_seconds.length, 2);
  assert.match(a.stop_rules, /3 extracts in a row/);
  assert.match(a.from_page, /from-page --brand dv --for-source shop$/); // no --b64: the extract script posts the result, from-page reads <task dir>/page-result.json
  const b = nextTask({ ...run, sources: [{ ...run.sources[0], result: { state: 'end' } }] });
  assert.equal(b.step, 'discovery');
  assert.match(b.script, /--for-query etsy-k-neon$/);
  assert.ok(b.target > 0);
  assert.equal(b.adapter.platform, 'etsy');
  assert.equal(collectInfo('dv', 'query', 'q1', 'myspace').adapter.status, 'missing');
});

test('suggested state, file ids', () => {
  assert.equal(suggestedState('query', { blocked: true }), 'blocked');
  assert.equal(suggestedState('query', { error: true }), 'partial');
  assert.equal(suggestedState('query', { limit: true, read: 5 }), 'limit');
  assert.equal(suggestedState('query', { read: 5 }), 'done');
  assert.equal(suggestedState('query', { read: 0 }), 'empty');
  assert.equal(suggestedState('source', { stop: 'known', read: 3 }), 'known');
  assert.equal(suggestedState('source', { read: 3 }), 'end');
  assert.equal(fileId('pfbid02abc/..\\x'), 'pfbid02abc_.._x');
});

test('applyDecisions: fit posts get product_fit, the others move to rejected[], undecided are reported', () => {
  const raw = { query: { id: 'q' }, posts: [{ post_url: 'u1', collector_id: 'a', author: '@a' }, { post_url: 'u2', collector_id: 'b' }, { post_url: 'u3', collector_id: 'c' }, { post_url: 'u4', collector_id: 'd' }], rejected: [{ post_url: 'old', reason: 'r' }] };
  const r = applyDecisions(raw, [{ id: 'a', fit: true, type: 'name neon sign', reason: 'name on wall' }, { id: 'b', fit: false, reason: 'strip lights' }, { id: 'd', fit: true }]);
  assert.deepEqual([r.fit, r.off], [1, 1]);
  assert.deepEqual(r.raw.posts.map((p) => p.collector_id), ['a', 'c', 'd']);
  assert.deepEqual(r.raw.posts[0].product_fit, { type: 'name neon sign', reason: 'name on wall' });
  assert.equal(r.raw.posts[1].product_fit, undefined);
  assert.deepEqual(r.undecided, ['c', 'd: fit without type']);
  assert.deepEqual(r.raw.rejected.map((x) => x.post_url), ['old', 'u2']);
});

// ---- the raw.json written by the collector is what research.mjs ingest reads ----
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

test('CLI: collector raw.json (query and reference page) is accepted by research.mjs ingest; fit decisions gate discovery', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-collect-test-'));
  const skills = path.join(tmp, 'skills'), ws = path.join(tmp, 'workspace'), brandDir = path.join(skills, 'dv-skills');
  const env = { ...process.env, SA_WORKSPACE: ws, SA_SKILLS_ROOT: skills, SA_PROGRESS: 'off' };
  const write = (f, x) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof x === 'string' || Buffer.isBuffer(x) ? x : JSON.stringify(x)); };
  const run = (script, ...args) => { const r = spawnSync(process.execPath, [path.join(tool, 'scripts', script), ...args], { env, encoding: 'utf8', windowsHide: true }); try { return JSON.parse(r.stdout); } catch { return { ok: false, error: r.stdout + r.stderr }; } };
  const productFit = { types: ['wedding neon sign', 'name neon sign'], must_have: ['a LED neon sign is the subject'], must_not: ['LED strip lights'] };
  write(path.join(brandDir, 'SKILL.md'), '# dv');
  write(path.join(brandDir, 'project', 'project.md'), '# dv\nProducts: custom LED neon signs.');
  write(path.join(brandDir, 'scripts', 'check-skill.mjs'), "console.log('ok')");
  write(path.join(brandDir, 'project', 'social.json'), { brand: 'DV', enabled: true, channels: [{ network: 'facebook', enabled: true, lang: ['en'] }], cadence: { timezone: 'America/New_York' },
    research: { sources: [{ id: 'shop', name: 'Shop', platform: 'instagram', url: 'https://www.instagram.com/shop/', enabled: true, what_to_take: 'neon signs' }],
      discovery: { enabled: true, platforms: [{ id: 'etsy', enabled: true }], keywords: ['name neon sign'], hashtags: [], product_fit: productFit, max_per_platform: 5 } } });
  try {
    const st = run('research.mjs', 'start', '--brand', 'dv');
    assert.equal(st.ok, true, JSON.stringify(st));
    // Reference page: collector raw shape { page, posts } (no product_fit needed).
    const n1 = run('research.mjs', 'next', '--brand', 'dv');
    assert.equal(n1.step, 'reference');
    assert.match(n1.script, /collect\.mjs script --brand dv --for-source shop/);
    assert.equal(n1.adapter.platform, 'instagram');
    write(path.join(n1.downloads, 'AbCdE12345-1.png'), pattern([1, 2, 3]));
    const t1 = { kind: 'source', id: 'shop', platform: 'instagram', name: 'Shop' };
    write(n1.raw_file, rawShape(t1, [toRawPost({ id: 'AbCdE12345', url: 'https://www.instagram.com/p/AbCdE12345/', caption: 'Names in lights', author: '@shop', found_by: 'reference page' }, ['raw/AbCdE12345-1.png'], 'instagram')]));
    const i1 = run('research.mjs', 'ingest', '--brand', 'dv', '--source', 'shop');
    assert.equal(i1.ok, true, JSON.stringify(i1));
    assert.equal(i1.sources[0].added, 1, JSON.stringify(i1));
    run('research.mjs', 'result', '--brand', 'dv', '--source', 'shop', '--state', 'end');
    // Discovery query: the agent's product-fit decisions are applied before ingest.
    const n2 = run('research.mjs', 'next', '--brand', 'dv');
    assert.deepEqual([n2.step, n2.platform], ['discovery', 'etsy']);
    assert.match(n2.script, new RegExp(`--for-query ${n2.query}`));
    for (const [k, seed] of [[1, [5, 5, 5]], [2, [6, 6, 6]], [3, [7, 7, 7]]]) write(path.join(n2.downloads, `E${k}-1.png`), pattern(seed));
    const t2 = { kind: 'query', id: n2.query, platform: 'etsy' };
    const mk = (k, caption) => toRawPost({ id: `E${k}`, url: `https://www.etsy.com/listing/${1000000 + k}`, caption, author: 'NeonShop', found_by: n2.found_by }, [`raw/E${k}-1.png`], 'etsy');
    const rawQ = rawShape(t2, [mk(1, 'Name sign'), mk(2, 'Strip lights'), mk(3, 'Wedding sign')]);
    assert.deepEqual(Object.keys(rawQ).sort(), ['collected', 'platform', 'posts', 'query', 'rejected', 'tool']);
    const decided = applyDecisions(rawQ, [{ id: 'E1', fit: true, type: 'name neon sign', reason: 'name on wall' }, { id: 'E2', fit: false, reason: 'LED strip lights, no sign' }, { id: 'E3', fit: true, type: 'wedding neon sign', reason: 'sign is the subject' }]);
    write(n2.raw_file, decided.raw);
    const i2 = run('research.mjs', 'ingest', '--brand', 'dv', '--query', n2.query);
    assert.equal(i2.ok, true, JSON.stringify(i2));
    assert.deepEqual([i2.added, i2.rejected_off_brand], [2, 1], JSON.stringify(i2));
    const items = JSON.parse(fs.readFileSync(path.join(ws, 'store', 'dv', 'items.json'), 'utf8')).items.filter((x) => x.platform === 'etsy');
    assert.deepEqual(items.map((x) => x.found_by), [n2.found_by, n2.found_by]);
    assert.equal(run('collect.mjs', 'status').adapters.etsy.status, 'ok'); // etsy adapter is verified (status ok)
    assert.equal(run('collect.mjs', '--platform', 'myspace', '--query', 'x').ok, false);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// Counters: the stop rule counts posts KEPT after the fit filter (pure, no network).
test('counters + fitStop: kept decides, not posts read', async () => {
  const { counters, counterLine, fitStop, applyDecisions } = await import('../scripts/collect.mjs');
  const post = (id) => ({ collector_id: id, post_url: `u/${id}` });
  // 3 read, none fitted yet: pending_fit 3, never "target" even though read >= need
  let c = counters({ posts: [post('a'), post('b'), post('c')], rejected: [] }, 3, 3);
  assert.deepEqual([c.read, c.pending_fit, c.kept, c.rejected, c.need_more], [3, 3, 0, 0, 3]);
  assert.equal(fitStop(c), '');
  // after fit: 1 kept, 2 rejected -> still short, no stop
  const r = applyDecisions({ posts: [post('a'), post('b'), post('c')], rejected: [] }, [{ id: 'a', fit: true, type: 'card' }, { id: 'b', fit: false, reason: 'x' }, { id: 'c', fit: false, reason: 'y' }]);
  c = counters(r.raw, 3, 3);
  assert.deepEqual([c.pending_fit, c.kept, c.rejected, c.need_more], [0, 1, 2, 2]);
  assert.equal(fitStop(c), '');
  assert.equal(counterLine(c), 'read 3 · kept 1 · rejected 2 · source need 3');
  // enough kept -> target
  c = counters({ posts: [1, 2, 3].map((i) => ({ ...post(i), product_fit: { type: 't' } })), rejected: [] }, 3, 3);
  assert.equal(fitStop(c), 'target');
  // read >= 3 x need and short -> poor_source (factor configurable)
  c = counters({ posts: [{ ...post('k'), product_fit: { type: 't' } }], rejected: Array.from({ length: 8 }, (_, i) => ({ post_url: `r${i}` })) }, 9, 3);
  assert.deepEqual([c.pending_fit, c.need_more], [0, 2]);
  assert.equal(fitStop(c), 'poor_source');
  assert.equal(fitStop(c, 4), '');
});
