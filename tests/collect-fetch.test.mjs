// Problem 1 (compact page result: total + checksum, chunks) and Problem 2 (direct fetch routes). No network: saved samples + injected clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parsePageResult, mergePageResults, loadPageResults } from '../scripts/collect-pagemode.mjs';
import { checksumOf } from '../scripts/platforms/common.mjs';
import * as etsy from '../scripts/platforms/etsy.mjs';
import * as reddit from '../scripts/platforms/fetch/reddit.mjs';
import * as houzz from '../scripts/platforms/fetch/houzz.mjs';
import * as pinterest from '../scripts/platforms/fetch/pinterest.mjs';
import { makeLimiter, politeGet, BlockedError } from '../scripts/platforms/fetch/common.mjs';
import { hasFetchRoute } from '../scripts/platforms/fetch/index.mjs';
import { fetchPosts } from '../scripts/collect-fetch.mjs';

const tool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fx = (f) => fs.readFileSync(path.join(tool, 'tests', 'fixtures', f), 'utf8');

const tiles = (n) => Array.from({ length: n }, (_, i) => ({ id: String(100000 + i), url: `https://www.etsy.com/listing/${100000 + i}`, image_urls: ['u'], caption: 'c', author: 'a' }));
const compact = (all, extra = {}) => ({ platform: 'etsy', loginWall: false, total: all.length, checksum: checksumOf(all.map((t) => t.id)), tiles: all, ...extra });
const chunkOf = (all, i, size = 6) => compact(all, { tiles: all.slice(i * size, (i + 1) * size), chunk: { i, size, of: Math.ceil(all.length / size) } });

test('page script returns a compact result with total + checksum (and a chunk variant)', () => {
  const s = etsy.pageScript({ url: 'https://example.com/', found_by: 'k', max: 12, steps: 2, delay: [5, 15] });
  assert.doesNotThrow(() => new Function(`return (${s});`));
  assert.match(s, /checksumOf/);
  assert.match(s, /total, checksum/);
  assert.match(etsy.pageScript({ url: 'u', max: 12, steps: 1, delay: [5, 15], chunk: 1 }), /"chunk":1/);
});

test('from-page input: intact result is verified, tampering / truncation fail loudly', () => {
  const all = tiles(12);
  const ok = mergePageResults([compact(all)]);
  assert.equal(ok.verified, true);
  assert.equal(ok.result.tiles.length, 12);
  // a tile dropped by hand
  assert.throws(() => mergePageResults([compact(all, { tiles: all.slice(0, 7) })]), /BỊ CẮT.*7 tile.*total 12/);
  // an id edited, same count
  const edited = all.map((t, i) => (i === 3 ? { ...t, id: '999999' } : t));
  assert.throws(() => mergePageResults([compact(all, { tiles: edited })]), /Checksum sai/);
  // JSON cut off in the middle
  const text = JSON.stringify(compact(all));
  assert.throws(() => parsePageResult(text.slice(0, Math.floor(text.length * 0.6))), /JSON/);
  assert.throws(() => parsePageResult(text.slice(0, 40) + ' ... ' + text.slice(-30)), /cắt cụt hoặc bị sửa/);
  // wrapped in MCP output still parses
  assert.equal(parsePageResult(`### Result\n${text}\n### Ran`).total, 12);
  // an old result without total/checksum is accepted but marked unverified
  assert.equal(mergePageResults([{ tiles: all }]).verified, false);
  // --json input
  assert.equal(loadPageResults({ _: ['from-page'], json: text }).result.tiles.length, 12);
  assert.throws(() => loadPageResults({ _: ['from-page'] }), /Thiếu kết quả/);
});

test('chunks merge in any order with the same total/checksum; missing or foreign chunk fails', () => {
  const all = tiles(14); // 3 chunks of 6
  const m = mergePageResults([chunkOf(all, 2), chunkOf(all, 0), chunkOf(all, 1)]);
  assert.deepEqual(m.result.tiles.map((t) => t.id), all.map((t) => t.id));
  assert.equal(m.verified, true);
  assert.throws(() => mergePageResults([chunkOf(all, 0), chunkOf(all, 2)]), /Thiếu chunk 1 trên 3/);
  const other = tiles(14).map((t) => ({ ...t, id: `x${t.id}` }));
  assert.throws(() => mergePageResults([chunkOf(all, 0), chunkOf(other, 1), chunkOf(all, 2)]), /không cùng một lần chạy/);
  const cut = chunkOf(all, 1); cut.tiles = cut.tiles.slice(0, 3);
  assert.throws(() => mergePageResults([chunkOf(all, 0), cut, chunkOf(all, 2)]), /BỊ CẮT/);
});

test('parsers on the saved samples', () => {
  const r = reddit.parse(fx('fetch-reddit.rss'));
  assert.ok(r.length >= 10 && r.every((t) => /reddit\.com\/r\/\w+\/comments\//.test(t.url) && t.image_urls[0] && t.author.startsWith('/u/')), `reddit ${r.length}`);
  assert.match(reddit.requestFor({ kind: 'query', found_by: 'keyword:live edge dining table' }).url, /^https:\/\/www\.reddit\.com\/search\.rss\?q=%22live%20edge%20dining%20table%22/);
  const h = houzz.parse(fx('fetch-houzz.html'));
  assert.equal(h.length, 20);
  assert.match(h[0].url, /^https:\/\/www\.houzz\.com\/photos\/.*~\d{5,}$/);
  assert.match(h[0].image_urls[0], /^https:\/\/st\.hzcdn\.com\/fimgs\/.*-w550-/);
  assert.equal(h[0].caption, 'Live-Edge Table');
  const p = pinterest.parse(fx('fetch-pinterest.rss'));
  assert.equal(p.length, 25);
  const posts = fetchPosts(pinterest, fx('fetch-pinterest.rss'), { max: 3, found_by: 'reference page' });
  assert.deepEqual([posts.posts.length, /\/736x\//.test(posts.posts[0].image_urls[0])], [3, true]);
  assert.equal(pinterest.requestFor({ kind: 'source', url: 'https://www.pinterest.com/someone/' }).url, 'https://www.pinterest.com/someone/feed.rss');
  assert.equal(pinterest.requestFor({ kind: 'source', url: 'https://www.pinterest.com/someone/tables/' }).url, 'https://www.pinterest.com/someone/tables.rss');
  assert.throws(() => pinterest.requestFor({ kind: 'query', url: 'x' }), /tham chiếu/);
  assert.deepEqual([hasFetchRoute('pinterest', 'query'), hasFetchRoute('pinterest', 'source'), hasFetchRoute('reddit', 'query'), hasFetchRoute('etsy', 'query')], [false, true, true, false]);
  const known = fetchPosts(houzz, fx('fetch-houzz.html'), { max: 0, found_by: 'k' }, {});
  assert.equal(known.read, 20);
});

test('throttle: >= 5 s between requests of a host (injected clock), backoff on 5xx, no tight loop', async () => {
  let t = 1000000;
  const sleeps = [];
  const sleep = async (ms) => { sleeps.push(ms); t += ms; };
  const limiter = makeLimiter({ now: () => t, sleep, gapMs: 100 }); // below the minimum: still 5 s
  let calls = 0;
  const get = async () => { calls++; return { status: 200, text: '<ok/>' }; };
  await politeGet({ url: 'https://a.test/x' }, get, { limiter, sleep });
  await politeGet({ url: 'https://a.test/y' }, get, { limiter, sleep });
  assert.equal(sleeps[0], 5000);
  await politeGet({ url: 'https://b.test/x' }, get, { limiter, sleep }); // another host: no wait
  assert.equal(sleeps.length, 1);
  // 503 twice then ok: waits 5 s, then 10 s (+ the gap) between tries
  let n = 0; sleeps.length = 0;
  const flaky = async () => (++n < 3 ? { status: 503, text: '' } : { status: 200, text: 'fine' });
  assert.equal(await politeGet({ url: 'https://c.test/' }, flaky, { limiter, sleep }), 'fine');
  assert.equal(n, 3);
  assert.ok(sleeps.every((ms) => ms >= 5000), JSON.stringify(sleeps));
  // always 500: stops after 1 + 2 retries
  n = 0;
  await assert.rejects(politeGet({ url: 'https://d.test/' }, async () => { n++; return { status: 500, text: '' }; }, { limiter, sleep }), /HTTP 500/);
  assert.equal(n, 3);
});

test('429 / 403 / captcha page -> blocked, one request only, host refused afterwards', async () => {
  for (const [status, text] of [[429, ''], [403, 'nope'], [200, '<html>Please verify you are a human (captcha)</html>']]) {
    let t = 5000000, calls = 0;
    const limiter = makeLimiter({ now: () => t, sleep: async (ms) => { t += ms; } });
    const get = async () => { calls++; return { status, text }; };
    await assert.rejects(politeGet({ url: 'https://www.reddit.com/search.rss' }, get, { limiter }), (e) => e instanceof BlockedError && /blocked, try later/.test(e.message));
    assert.equal(calls, 1);
    await assert.rejects(politeGet({ url: 'https://www.reddit.com/search.rss' }, get, { limiter }), /blocked, try later/);
    assert.equal(calls, 1, 'no second request while blocked');
    t += 31 * 60 * 1000; // the block memory expires
    await assert.rejects(politeGet({ url: 'https://www.reddit.com/search.rss' }, get, { limiter }), BlockedError);
    assert.equal(calls, 2);
  }
});

test('CLI: fetch --from-file writes the same raw.json shape as from-page (temp workspace, local images); errors are never a silent empty', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-fetch-'));
  const skills = path.join(tmp, 'skills'), ws = path.join(tmp, 'workspace'), brandDir = path.join(skills, 'dv-skills');
  const env = { ...process.env, SA_WORKSPACE: ws, SA_SKILLS_ROOT: skills, SA_PROGRESS: 'off' };
  const write = (f, x) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof x === 'string' ? x : JSON.stringify(x)); };
  const run = (script, ...args) => new Promise((res) => {
    const c = spawn(process.execPath, [path.join(tool, 'scripts', script), ...args], { env, windowsHide: true });
    let o = '', e = '';
    c.stdout.on('data', (d) => { o += d; }); c.stderr.on('data', (d) => { e += d; });
    c.on('close', () => { try { res(JSON.parse(o)); } catch { res({ ok: false, error: o + e }); } });
  });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'image/png'); res.end(png); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  write(path.join(brandDir, 'SKILL.md'), '# dv');
  write(path.join(brandDir, 'project', 'project.md'), '# dv\nProducts: live edge tables.');
  write(path.join(brandDir, 'scripts', 'check-skill.mjs'), "console.log('ok')");
  write(path.join(brandDir, 'project', 'social.json'), { brand: 'DV', enabled: true, channels: [{ network: 'facebook', enabled: true, lang: ['en'] }], cadence: { timezone: 'America/New_York' },
    research: { sources: [], discovery: { enabled: true, platforms: [{ id: 'pinterest', enabled: true }], keywords: ['live edge table'], hashtags: [], product_fit: { types: ['live edge table'], must_have: ['table'], must_not: [] }, max_per_platform: 5 } } });
  try {
    // standalone, from a saved Pinterest feed whose image host is the local server
    const feed = path.join(tmp, 'feed.rss');
    write(feed, fx('fetch-pinterest.rss').replace(/https:\/\/i\.pinimg\.com/g, base));
    const o = path.join(tmp, 'out');
    const r = await run('collect.mjs', 'fetch', '--platform', 'pinterest', '--url', 'https://www.pinterest.com/someone/', '--from-file', feed, '--max', '3', '--out', o);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual([r.mode, r.parsed, r.collected, r.state], ['fetch', 25, 3, 'ok']);
    const raw = JSON.parse(fs.readFileSync(path.join(o, 'raw.json'), 'utf8'));
    assert.equal(raw.posts.length, 3);
    assert.ok(raw.posts[0].post_url && raw.posts[0].images[0] && raw.posts[0].collector_id && raw.posts[0].platform === 'pinterest');
    assert.ok(fs.existsSync(path.join(o, raw.posts[0].images[0])));
    // unsupported platform / keyword for pinterest
    assert.equal((await run('collect.mjs', 'fetch', '--platform', 'etsy', '--query', 'x', '--from-file', feed)).ok, false);
    // a blocked page saved as the response: state blocked, no posts
    const stub = path.join(tmp, 'stub.html');
    write(stub, '<html><title>Blocked</title>You have been blocked by network security. captcha</html>');
    const bl = await run('collect.mjs', 'fetch', '--platform', 'houzz', '--query', 'live edge table', '--from-file', stub, '--out', path.join(tmp, 'out2'));
    assert.equal(bl.ok, true);
    assert.equal(bl.collected, 0);
    assert.equal(bl.state, 'partial'); // from-file skips the HTTP layer: 0 cards parsed = error, never a silent empty
    // the open run: next shows fetch first for a Pinterest source only, not for a pinterest keyword
    assert.equal((await run('research.mjs', 'start', '--brand', 'dv')).ok, true);
    const n = await run('research.mjs', 'next', '--brand', 'dv');
    assert.equal(n.fetch, undefined);
    assert.match(n.do, /FIRST run the collector/);
    assert.match(n.do, /"fetch" field/);
  } finally { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('network error (no HTTP answer) fails fast: at most 1 retry after 3 s', async () => {
  let t = 7000000, calls = 0; const sleeps = [];
  const sleep = async (ms) => { sleeps.push(ms); t += ms; };
  const limiter = makeLimiter({ now: () => t, sleep });
  await assert.rejects(politeGet({ url: 'https://net.test/' }, async () => { calls++; throw new Error('fetch failed'); }, { limiter, sleep }), /fetch failed/);
  assert.equal(calls, 2);
  assert.ok(sleeps.includes(3000), JSON.stringify(sleeps));
});
