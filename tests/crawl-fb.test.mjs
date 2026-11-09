// Scripted crawl (scripts/crawl-fb.mjs + scripts/fb-extract.mjs) without a browser: the pure extraction functions on
// saved Facebook HTML (tests/fixtures/fb-*.html, linkedom), dates, block detection, tabs, the round-robin budget and
// the stop rules; then the batch filter (store.mjs classify / verdict), kept / filtered in the run log, the reopened
// run archive, ingest not re-counting posts, caption_empty and newest/oldest with backfilled items. Temp dirs only.
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
import { SELECTORS, extractFeed, extractGrid, extractViewer, parseFbDate, detectBlock, tabUrl } from '../scripts/fb-extract.mjs';
import { splitEven, roundRobin, makeCursor, toRawPost, selectorsBroken } from '../scripts/crawl-fb.mjs';
import { sourceBounds } from '../scripts/store.mjs';

const tool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = (name) => parseHTML(fs.readFileSync(path.join(tool, 'tests', 'fixtures', name), 'utf8')).document;

test('extractFeed: posts, permalink + alt links, caption with See more, images, media type; comments ignored', () => {
  const doc = fixture('fb-feed.html');
  const r = extractFeed(doc, SELECTORS);
  assert.equal(r.posts.length, 4, JSON.stringify(r.posts.map((p) => p.post_url)));
  const [a, b, c, d] = r.posts;
  assert.equal(a.post_url, 'https://www.facebook.com/shopneon/posts/pfbid02AbCdEfGh123');
  assert.deepEqual(a.alt_urls, ['https://www.facebook.com/photo?fbid=1111111111&set=pcb.2222', 'https://www.facebook.com/photo?fbid=1111111112&set=pcb.2222']);
  assert.match(a.caption, /^Đèn neon chữ Love͏ cho tiệc cưới 💖\nDây dài 3m, ánh trắng ấm$/);
  assert.equal(a.see_more_left, true);
  assert.doesNotMatch(a.caption, /Đẹp quá/, 'comment text is not the caption');
  assert.deepEqual(a.images.map((x) => x.src.split('/').pop()), ['neon-1.jpg?stp=dst-jpg_p526x296', 'neon-2.jpg'], 'no emoji, no comment photo');
  assert.equal(a.media_type, 'album');
  assert.equal(a.date_text, 'November 2 at 10:00 AM');
  assert.equal(b.post_url, 'https://www.facebook.com/reel/7777777777');
  assert.equal(b.media_type, 'video');
  assert.equal(c.post_url, 'https://www.facebook.com/permalink.php?story_fbid=3333333333&id=100064');
  assert.equal(c.caption, '');
  assert.equal(c.media_type, 'photo');
  assert.equal(d.post_url, '', 'link only on hover: read on a later step');
  assert.equal(r.page.name, 'Shop Neon ✓');
  assert.match(r.page.avatar, /page-avatar/, 'not the signed-in user in the banner');
  assert.equal(r.signals.loading, true);
  assert.equal(detectBlock(r.block), '');
  // A second step returns only what was not returned before (the post without a link yet).
  assert.deepEqual(extractFeed(doc, SELECTORS).posts.map((p) => p.caption), ['Bài chưa hiện link (hover)']);
});

test('selectors broken: posts on the page but none read -> error: selectors', () => {
  const doc = fixture('fb-feed.html');
  const r = extractFeed(doc, { ...SELECTORS, container: ['div.renamed-by-facebook'] });
  assert.equal(r.posts.length, 0);
  assert.equal(selectorsBroken(3, r.signals), true);
  assert.equal(selectorsBroken(2, r.signals), false);
  assert.equal(selectorsBroken(5, { messages: 0, post_links: 0 }), false, 'an empty page is the end, not an error');
});

test('extractGrid / extractViewer: photos and reels tabs, the opened tile', () => {
  const g = extractGrid(fixture('fb-grid.html'), SELECTORS);
  assert.deepEqual(g.tiles.map((t) => [t.url, t.media_type]), [
    ['https://www.facebook.com/photo?fbid=5555555551&set=a.123', 'photo'],
    ['https://www.facebook.com/photo.php?fbid=5555555552&set=a.123', 'photo'],
    ['https://www.facebook.com/reel/6666666661', 'video'],
  ]);
  const v = extractViewer(fixture('fb-viewer.html'), SELECTORS);
  assert.equal(v.caption, 'Neon Happy Birthday để bàn, pin sạc 8 tiếng');
  assert.equal(v.images[0].src, 'https://scontent.xx.fbcdn.net/v/t39/big.jpg');
  assert.deepEqual([v.post_url, v.alt_urls], ['https://www.facebook.com/photo?fbid=5555555551&set=a.123', ['https://www.facebook.com/shopneon/posts/pfbid0ZzYyXx987']]);
  assert.equal(parseFbDate(v.date_text, new Date(2026, 10, 9)), '2025-11-02');
});

test('detectBlock, parseFbDate, tabUrl', () => {
  assert.match(detectBlock(extractFeed(fixture('fb-login.html'), SELECTORS).block), /login wall/);
  assert.match(detectBlock({ url: 'https://www.facebook.com/checkpoint/1501092823525282/' }), /checkpoint/);
  assert.match(detectBlock({ title: 'Facebook', text: 'Bạn tạm thời bị chặn' }), /blocked/);
  assert.match(detectBlock({ captcha: true }), /captcha/);
  const now = new Date(2026, 10, 9, 15, 0);
  for (const [t, want] of [['Just now', '2026-11-09'], ['5m', '2026-11-09'], ['3 hrs', '2026-11-09'], ['2d', '2026-11-07'], ['1w', '2026-11-02'], ['Yesterday at 9:00 PM', '2026-11-08'],
    ['November 2 at 10:00 AM', '2026-11-02'], ['December 24', '2025-12-24'], ['November 2, 2024', '2024-11-02'], ['2 November 2024', '2024-11-02'], ['Hôm qua lúc 21:00', '2026-11-08'],
    ['3 giờ', '2026-11-09'], ['2 ngày', '2026-11-07'], ['2 tháng 11', '2026-11-02'], ['2 tháng 11, 2024', '2024-11-02'], ['', ''], ['Sponsored', '']]) assert.equal(parseFbDate(t, now), want, t);
  assert.equal(parseFbDate('', now, Date.UTC(2026, 0, 15, 12) / 1000), '2026-01-15');
  assert.equal(tabUrl('https://www.facebook.com/shopneon/?ref=x', 'photos'), 'https://www.facebook.com/shopneon/photos_by');
  assert.equal(tabUrl('https://www.facebook.com/shopneon', 'reels'), 'https://www.facebook.com/shopneon/reels');
  assert.equal(tabUrl('https://www.facebook.com/profile.php?id=1000', 'reels'), 'https://www.facebook.com/profile.php?id=1000&sk=reels_tab');
});

test('round-robin budget: even shares, leftovers to sources that still have posts, unopened = skipped', async () => {
  assert.deepEqual(splitEven(10, 3), [4, 3, 3]);
  assert.deepEqual(splitEven(2, 3), [1, 1, 0]);
  // a has 1 post, b and c plenty: pass 1 = 4/3/3 -> a 1 (end), b 3, c 3; pass 2: 3 left over b, c -> 2/1.
  const have = { a: 1, b: 99, c: 99 }, calls = [];
  const crawl = async (s, share) => { calls.push(`${s.id}:${share}`); const got = Math.min(share, have[s.id]); have[s.id] -= got; return { added: got, state: got < share ? 'end' : 'limit' }; };
  const r = await roundRobin([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 10, crawl);
  assert.deepEqual(calls, ['a:4', 'b:3', 'c:3', 'b:2', 'c:1']);
  assert.deepEqual(Object.values(r.sources).map((x) => x.added), [1, 5, 4]);
  // budget 2 over 3 sources: the third is never opened -> skipped (quota), never "dried up".
  const r2 = await roundRobin([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 2, async () => ({ added: 1, state: 'limit' }));
  assert.equal(r2.sources.c.state, 'skipped');
  assert.match(r2.sources.c.note, /quota/);
  // blocked stops everything; later sources stay pending.
  const r3 = await roundRobin([{ id: 'a' }, { id: 'b' }], 0, async (s) => (s.id === 'a' ? { added: 0, state: 'blocked', note: 'captcha' } : { added: 5, state: 'end' }));
  assert.deepEqual([r3.blocked, r3.sources.b.state], [true, 'pending']);
});

test('cursor: 3 known in a row (new), backfill skips until oldest_seen, --since', () => {
  const post = (n, d = '') => ({ post_url: `https://www.facebook.com/x/posts/${n}`, posted_date: d });
  const known = { count: 3, brand_post_urls: [], brand_post_ids: ['100001', '100002', '100003'], oldest_seen: { date: '2026-11-01', post_id: '100003', post_url: '' } };
  const c = makeCursor({ mode: {}, known });
  assert.deepEqual([post(100009), post(100001), post(100002), post(100009)].map(c.take), ['collect', 'known', 'known', 'seen']);
  assert.equal(c.stop, null);
  c.take(post(100003));
  assert.equal(c.stop, 'known');
  const b = makeCursor({ mode: { backfill: true }, known });
  assert.deepEqual([post(100008), post(100001), post(100003), post(100004)].map(b.take), ['skip', 'known', 'known', 'collect']);
  const full = makeCursor({ mode: { full: true }, known });
  [post(100001), post(100002), post(100003)].forEach(full.take);
  assert.equal(full.stop, null);
  const s = makeCursor({ mode: { since: '2026-11-01' }, known: { count: 0 } });
  assert.deepEqual([post(1000001, '2026-11-05'), post(1000002, '2026-10-01'), post(1000003, '2026-10-02')].map(s.take), ['collect', 'old', 'old']);
  assert.equal(s.stop, 'since');
  assert.deepEqual(toRawPost({ post_url: 'u', date_text: '2d', images: [{ src: 'i' }], media_type: 'photo' }, new Date(2026, 10, 9)), { post_url: 'u', alt_urls: [], posted_date: '2026-11-07', date_text: '2d', caption: '', image_urls: ['i'], media_type: 'photo' });
});

test('sourceBounds: a backfilled item never becomes newest; undated by page order', () => {
  const it = (id, posted_date, run, page_pos, crawl_mode) => ({ id, posted_date, run, page_pos, crawl_mode, post_url: `https://www.facebook.com/x/posts/${id}`, post_ids: [id] });
  const b = sourceBounds([it('1000001', '', '2026-11-01', 1, 'new'), it('1000002', '', '2026-11-01', 2, 'new'), it('1000003', '2026-09-01', '2026-11-09', 1, 'backfill'), it('1000004', '2026-08-01', '2026-11-09', 2, 'backfill')]);
  assert.deepEqual([b.newest_seen.item, b.oldest_seen.item], ['1000001', '1000004']);
  const u = sourceBounds([it('1000001', '', '2026-11-01', 2, 'new'), it('1000002', '', '2026-11-01', 1, 'new')]);
  assert.deepEqual([u.newest_seen.item, u.oldest_seen.item], ['1000002', '1000001'], 'page_pos, not insertion order');
});

// ----- CLI: classify / verdict, run log, reopened run, re-ingest -----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-crawl-test-'));
const skills = path.join(tmp, 'skills'), ws = path.join(tmp, 'workspace'), brandDir = path.join(skills, 'cf-skills');
const env = { ...process.env, SA_WORKSPACE: ws, SA_SKILLS_ROOT: skills };
const write = (f, x) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof x === 'string' || Buffer.isBuffer(x) ? x : JSON.stringify(x)); };
const cli = (script, ...args) => { const r = spawnSync(process.execPath, [path.join(tool, 'scripts', script), ...args], { env, encoding: 'utf8', windowsHide: true }); try { return JSON.parse(r.stdout); } catch { throw new Error(r.stdout + r.stderr); } };
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

write(path.join(brandDir, 'SKILL.md'), '# cf');
write(path.join(brandDir, 'project', 'project.md'), '# cf\nProducts: LED neon signs.');
write(path.join(brandDir, 'project', 'social.json'), { brand: 'CF', enabled: true, channels: [{ network: 'facebook', enabled: true, lang: ['en'] }], cadence: { timezone: 'America/New_York' },
  research: { sources: [{ id: 'a', name: 'A', url: 'https://www.facebook.com/a', enabled: true, what_to_take: 'neon signs only' }, { id: 'b', name: 'B', url: 'https://www.facebook.com/b', enabled: true }] } });
write(path.join(brandDir, 'scripts', 'check-skill.mjs'), "console.log('ok')");

test('reopened run archives old raw; re-ingest skips posts already ingested; caption_empty kept; classify -> verdict -> run log', () => {
  const start = cli('research.mjs', 'start', '--brand', 'cf', '--max-posts', '1');
  assert.equal(start.ok, true, JSON.stringify(start));
  const [a] = start.run.sources;
  const caps = ['Đèn neon chữ Love cho tiệc cưới ngoài trời, ánh trắng ấm, dây dài ba mét', 'Tuyển nhân viên bán hàng part-time, lương cao, liên hệ inbox ngay hôm nay', '', 'Minigame tháng 11: like và share để nhận quà, công bố kết quả cuối tuần', 'Bảng LED tên cô dâu chú rể treo cổng hoa, màu hồng phấn, kèm móc treo', 'Mua hai tặng một cho mọi mẫu bàn ghế gỗ, giao hàng toàn quốc miễn phí'];
  const posts = caps.map((c, n) => { write(path.join(a.dir, 'raw', `${n}.png`), pattern([n * 17, 3, n, 200 - n])); return { post_url: `https://www.facebook.com/a/posts/9000000${n}`, caption: c, images: [`raw/${n}.png`], media_type: n === 2 ? 'photo' : 'album', page_pos: n + 1 }; });
  write(a.raw_file, { page: { name: 'A' }, posts });
  // A same-day restart moves the earlier crawl's raw.json away: nothing old is re-ingested.
  const again = cli('research.mjs', 'start', '--brand', 'cf');
  assert.equal(again.reused, true);
  assert.ok(again.archived.some((x) => x.source === 'a'), JSON.stringify(again.archived));
  assert.ok(again.archived.some((x) => x.run), 'the previous run.json is kept too');
  assert.equal(fs.existsSync(a.raw_file), false);
  // Quota 0 for the second source: logged "skipped (quota)", not "dried up".
  cli('research.mjs', 'result', '--brand', 'cf', '--source', 'b', '--state', 'skipped');
  for (const [n] of caps.entries()) write(path.join(a.dir, 'raw', `${n}.png`), pattern([n * 17, 3, n, 200 - n]));
  write(a.raw_file, { page: { name: 'A' }, posts });
  const ing = cli('research.mjs', 'ingest', '--brand', 'cf', '--source', 'a');
  assert.equal(ing.sources[0].added, 6, JSON.stringify(ing));
  const re = cli('research.mjs', 'ingest', '--brand', 'cf', '--source', 'a');
  assert.deepEqual([re.sources[0].added, re.sources[0].duplicates, re.sources[0].already_ingested], [0, 0, 6], 'no fake duplicates');
  const items = JSON.parse(fs.readFileSync(path.join(ws, 'store', 'cf', 'items.json'), 'utf8')).items;
  assert.equal(items[2].caption_empty, true);
  assert.equal(items[0].media_type, 'album');
  assert.equal(items[0].crawl_mode, 'new');
  cli('research.mjs', 'result', '--brand', 'cf', '--source', 'a', '--state', 'end');

  const cls = cli('store.mjs', 'classify', '--brand', 'cf', '--limit', '4');
  assert.equal(cls.ok, true, JSON.stringify(cls));
  assert.deepEqual([cls.total_unjudged, cls.batch_size, cls.remaining_after], [6, 4, 2]);
  assert.equal(cls.sources.a.what_to_take, 'neon signs only');
  assert.match(cls.project_md, /project\.md$/);
  assert.equal(cls.items[2].caption, '(no caption)');
  assert.ok(fs.existsSync(cls.items[0].thumb));
  assert.ok(cls.rules_of_thumb.some((r) => /recruitment/.test(r)));
  const file = path.join(tmp, 'verdicts.json');
  write(file, [{ id: 'S0001', fit: true, reason: 'neon sign' }, { id: 'S0002', fit: false, reason: 'recruitment' }, { id: 'S0003', fit: false, reason: 'image only, no product' }, { id: 'S0004', fit: false, reason: 'minigame' },
    { id: 'S0005', fit: false, reason: 'off-category' }, { id: 'S0006', fit: false, reason: 'furniture, off-category' }, { id: 'S0009', fit: true }, { id: 'S0001', fit: false }]);
  const v = cli('store.mjs', 'verdict', '--brand', 'cf', '--file', file);
  assert.deepEqual([v.kept, v.filtered.length, v.left], [['S0001'], 5, 0]);
  assert.deepEqual(v.skipped.map((x) => x.id), ['S0009', 'S0001']);
  const shown = cli('store.mjs', 'show', '--brand', 'cf', '--id', 'S0002').item;
  assert.deepEqual([shown.status, shown.note, shown.rejected_by], ['rejected', 'filter: recruitment', 'filter']);
  assert.equal(cli('store.mjs', 'classify', '--brand', 'cf').total_unjudged, 0);
  // Restored by the user: back to new, not judged again.
  cli('store.mjs', 'restore', '--brand', 'cf', '--id', 'S0005');
  assert.equal(cli('store.mjs', 'classify', '--brand', 'cf').total_unjudged, 0);

  const report = cli('research.mjs', 'report', '--brand', 'cf');
  const ra = report.sources.find((x) => x.id === 'a');
  assert.deepEqual([ra.kept, ra.filtered, ra.low_keep], [1, 5, true]);
  const log = cli('runlog.mjs', 'add', '--mode', 'research', '--agent', 'Claude Code').log;
  assert.match(log.headline, /^\+6 posts · 1 kept · 5 filtered$/);
  const src = log.brands[0].research.sources;
  assert.deepEqual(src.map((x) => [x.id, x.state]), [['a', 'new posts'], ['b', 'skipped (quota)']]);
  assert.equal(src[0].low_keep, true);
  // Every source has its result: nothing to crawl. --redo with no Chrome listening: a clear error, nothing written.
  assert.equal(cli('crawl-fb.mjs', '--brand', 'cf').sources.length, 0);
  const noChrome = cli('crawl-fb.mjs', '--brand', 'cf', '--redo', '--cdp', 'http://127.0.0.1:9');
  assert.equal(noChrome.ok, false);
  assert.match(noChrome.error, /remote-debugging-port/);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
