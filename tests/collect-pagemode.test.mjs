// Extract path of the collector (scripts/collect-pagemode.mjs): pure transform, seen filter, caption/id parsing, the script text, and the
// CLI `collect.mjs from-page` -> raw.json -> `research.mjs ingest` in a throw-away workspace (images from a local http server).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parsePageResult, pageResultPosts } from '../scripts/collect-pagemode.mjs';
import * as pinterest from '../scripts/platforms/pinterest.mjs';
import * as instagram from '../scripts/platforms/instagram.mjs';
import { platformIds, getAdapter } from '../scripts/platforms/index.mjs';

const tool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const png = (seed = 90) => {
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((8 * 3 + 1) * 8, seed);
  for (let y = 0; y < 8; y++) { raw[y * 25] = 0; raw[y * 25 + 1 + (seed % 8) * 3] = 255 - seed; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};

test('pinterest: "This may contain:" style caption prefixes are stripped, ids parsed', () => {
  assert.equal(pinterest.stripCaption('This may contain: Live edge table'), 'Live edge table');
  assert.equal(pinterest.stripCaption('This contains an image of: River table'), 'River table');
  assert.equal(pinterest.stripCaption('This contains: Cocinas negras'), 'Cocinas negras');
  assert.equal(pinterest.stripCaption('a wooden table'), 'a wooden table');
  assert.equal(pinterest.postId('https://www.pinterest.com/pin/996632592625920486/'), '996632592625920486');
  const p = pinterest.toPost({ url: 'https://www.pinterest.com/pin/996632592625920486/?x=1', image_urls: ['https://i.pinimg.com/236x/aa/bb/c.jpg'], caption: 'This may contain: Hello', author: '' });
  assert.deepEqual([p.id, p.caption, p.image_urls[0]], ['996632592625920486', 'Hello', 'https://i.pinimg.com/736x/aa/bb/c.jpg']);
});

test('instagram: author and text come out of the post page og:description', () => {
  const r = instagram.splitOgCaption('306 likes, 1 comments - flowerwallcompanyinc on October 2, 2026: "Mr & Mrs | Neon".');
  assert.deepEqual(r, { author: '@flowerwallcompanyinc', text: 'Mr & Mrs | Neon' });
  assert.deepEqual(instagram.splitOgCaption('Happy Engagement #neon'), { author: '', text: 'Happy Engagement #neon' });
  assert.equal(instagram.toPost({ url: 'https://www.instagram.com/p/DeTAZLwxm7P/', image_urls: ['u'], caption: '1 likes, 0 comments - ab.c on May 1, 2025: "Hi"', author: '' }).author, '@ab.c');
});

test('page result -> posts: dedupe by id, known posts dropped before download, login wall returns nothing', () => {
  const tiles = [
    { url: 'https://www.pinterest.com/pin/111111111/', image_urls: ['https://i.pinimg.com/originals/a.jpg'], caption: 'A' },
    { url: 'https://www.pinterest.com/pin/111111111/?dup=1', image_urls: ['x'], caption: 'dup' },
    { url: 'https://www.pinterest.com/pin/222222222/', image_urls: ['https://i.pinimg.com/originals/b.jpg'], caption: 'B' },
  ];
  const cursor = { take: (p) => (/222222222/.test(p.post_url) ? 'known' : 'collect') };
  const r = pageResultPosts({ tiles }, pinterest, { cursor, found_by: 'keyword:k' });
  assert.deepEqual([r.read, r.skippedKnown, r.posts.map((p) => p.id)], [2, 1, ['111111111']]);
  assert.equal(r.posts[0].found_by, 'keyword:k');
  assert.equal(pageResultPosts({ loginWall: true, tiles }, pinterest).loginWall, true);
  assert.equal(pageResultPosts({ tiles }, pinterest, { max: 1 }).posts.length, 1);
  assert.deepEqual(parsePageResult('### Result\n{"a":1}\n### Ran'), { a: 1 });
  assert.throws(() => parsePageResult('nothing'), /JSON/);
});

test('extract script: self-contained, read only, no navigation / scroll / pause; carries the seen ids', () => {
  for (const a of [pinterest, instagram, getAdapter('facebook')]) {
    const s = a.pageScript({ found_by: 'keyword:x', max: 3, seen: ['111', '222'] });
    assert.match(s, /^async \(page\) => \{/);
    assert.doesNotThrow(() => new Function(`return (${s});`), 'valid JS');
    assert.match(s, /"seen":\["111","222"\]/);
    assert.doesNotMatch(s, /page\.goto|scrollBy|scrollTo|setTimeout|\.click\(|\.fill\(|dispatchEvent|method:\s*'POST'/i, 'extract only');
  }
  assert.match(instagram.pageScript({ found_by: '' }), /"post_fallback":true/);
  assert.match(instagram.pageScript({ found_by: '' }), /AbortSignal\.timeout/);
  for (const id of platformIds()) assert.ok(['function', 'undefined'].includes(typeof getAdapter(id).pageScript), id);
});

test('seen filter: only new tiles come back, total_on_page counts all', async () => {
  const { filterSeen } = await import('../scripts/platforms/common.mjs');
  const { tileKeys, readSeen } = await import('../scripts/collect-pagemode.mjs');
  const tiles = [{ id: '1', url: 'u1' }, { id: '2', url: 'u2' }, { id: '', url: 'u3' }];
  assert.deepEqual(filterSeen(tiles, ['1', 'u3']), { tiles: [{ id: '2', url: 'u2' }], total_on_page: 3 });
  assert.deepEqual(filterSeen(tiles).tiles.length, 3);
  assert.deepEqual(tileKeys([{ id: 'pfbid0x', alt: ['123456'] }, { id: '', url: 'u3' }]), ['pfbid0x', '123456', 'u3']);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-seen-'));
  fs.writeFileSync(path.join(tmp, 'a.json'), JSON.stringify(['1', '1', 2]));
  fs.writeFileSync(path.join(tmp, 'b.json'), JSON.stringify({ seen: ['x'] }));
  assert.deepEqual([readSeen(path.join(tmp, 'a.json')), readSeen(path.join(tmp, 'b.json')), readSeen(path.join(tmp, 'none.json'))], [['1', '2'], ['x'], []]);
  fs.rmSync(tmp, { recursive: true, force: true });
  // a post seen under its photo fbid (alias) is skipped too
  const fb = getAdapter('facebook');
  const r = pageResultPosts({ tiles: [{ id: 'pfbid0abcdefghijk', alt: ['1333219135645308'], url: 'https://www.facebook.com/x/posts/pfbid0abcdefghijk', image_urls: ['i'], caption: 'c' }] }, fb, { skip: ['1333219135645308'] });
  assert.equal(r.read, 0);
});

test('CLI: from-page downloads images and writes a raw.json that research.mjs ingest accepts (temp workspace)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-pagemode-'));
  const skills = path.join(tmp, 'skills'), ws = path.join(tmp, 'workspace'), brandDir = path.join(skills, 'dv-skills');
  const env = { ...process.env, SA_WORKSPACE: ws, SA_SKILLS_ROOT: skills, SA_PROGRESS: 'off' };
  const write = (f, x) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof x === 'string' ? x : JSON.stringify(x)); };
  const run = (script, ...args) => new Promise((res) => {
    const c = spawn(process.execPath, [path.join(tool, 'scripts', script), ...args], { env, windowsHide: true });
    let o = '', e = '';
    c.stdout.on('data', (d) => { o += d; }); c.stderr.on('data', (d) => { e += d; });
    c.on('close', () => { try { res(JSON.parse(o)); } catch { res({ ok: false, error: o + e }); } });
  });
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'image/png'); res.end(png(40 + Number(String(req.url).match(/a(\d)/)?.[1] || 0) * 50)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  write(path.join(brandDir, 'SKILL.md'), '# dv');
  write(path.join(brandDir, 'project', 'project.md'), '# dv\nProducts: live edge tables.');
  write(path.join(brandDir, 'scripts', 'check-skill.mjs'), "console.log('ok')");
  write(path.join(brandDir, 'project', 'social.json'), { brand: 'DV', enabled: true, channels: [{ network: 'facebook', enabled: true, lang: ['en'] }], cadence: { timezone: 'America/New_York' },
    research: { sources: [], discovery: { enabled: true, platforms: [{ id: 'pinterest', enabled: true }], keywords: ['live edge table'], hashtags: [], product_fit: { types: ['live edge table'], must_have: ['table'], must_not: [] }, max_per_platform: 5 } } });
  try {
    assert.equal((await run('research.mjs', 'start', '--brand', 'dv')).ok, true);
    const n = await run('research.mjs', 'next', '--brand', 'dv');
    assert.equal(n.step, 'discovery');
    assert.match(n.script, /collect\.mjs script --brand dv --for-query/);
    const sc = spawn(process.execPath, [path.join(tool, 'scripts', 'collect.mjs'), 'script', '--brand', 'dv', '--for-query', n.query, '--stdout'], { env });
    let src = ''; sc.stdout.on('data', (d) => { src += d; });
    await new Promise((r) => sc.on('close', r));
    assert.match(src, /^async \(page\) =>/);
    // The result as the extract script returns it; image hosts replaced by the local server (referer/headers path is the same code).
    const result = { platform: 'pinterest', loginWall: false, tiles: [1, 2, 3].map((k) => ({ url: `https://www.pinterest.com/pin/${900000000 + k}/`, image_urls: [`${base}/736x/a${k}.png`], caption: `This may contain: Table ${k}`, author: '' })) };
    write(path.join(tmp, 'page.json'), result);
    const fp = await run('collect.mjs', 'from-page', '--brand', 'dv', '--for-query', n.query, '--file', path.join(tmp, 'page.json'));
    assert.equal(fp.ok, true, JSON.stringify(fp));
    assert.deepEqual([fp.read, fp.collected, fp.dropped_no_image], [3, 3, 0]);
    assert.ok(fs.existsSync(fp.review[0].image));
    const raw = JSON.parse(fs.readFileSync(n.raw_file, 'utf8'));
    assert.equal(raw.posts[0].caption, 'Table 1');
    const dec = [1, 2, 3].map((k) => ({ id: String(900000000 + k), fit: k !== 2, type: 'live edge table', reason: 'table is the subject' }));
    write(path.join(tmp, 'dec.json'), dec);
    assert.equal((await run('collect.mjs', 'fit', '--brand', 'dv', '--for-query', n.query, '--file', path.join(tmp, 'dec.json'))).ok, true);
    const ing = await run('research.mjs', 'ingest', '--brand', 'dv', '--query', n.query);
    assert.equal(ing.ok, true, JSON.stringify(ing));
    assert.deepEqual([ing.added, ing.rejected_off_brand], [2, 1], JSON.stringify(ing));
    // Posts already in the store are dropped before any download on the next from-page.
    // (a new task run: forget this task's earlier extracts, which would otherwise accumulate)
    for (const f of ['seen.json', 'extracts.json', 'raw.json']) fs.rmSync(path.join(path.dirname(n.raw_file), f), { force: true });
    const again = await run('collect.mjs', 'from-page', '--brand', 'dv', '--for-query', n.query, '--file', path.join(tmp, 'page.json'));
    assert.equal(again.collected, 1, JSON.stringify(again)); // the off-brand one is not in the store
    assert.equal(again.skipped_known, 2, JSON.stringify(again));
  } finally { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('b64 single-line result: round trip, exact mismatch position, 4-char tag', async () => {
  const { packB64, unpackB64, checksumOf } = await import('../scripts/platforms/common.mjs');
  const { loadPageResult } = await import('../scripts/collect-pagemode.mjs');
  const obj = { platform: 'etsy', total: 1, checksum: checksumOf(['1']), tiles: [{ id: '1', url: 'https://e/1', image_urls: ['https://i/a.jpg'], caption: 'Café ' + 'long '.repeat(80) }] };
  const p = packB64(obj);
  assert.equal(p.tag.length, 4);
  assert.deepEqual(unpackB64(p.line).obj, obj);
  assert.deepEqual(loadPageResult({ _: [], b64: p.line }).result.tiles[0].id, '1');
  const bad = p.line.slice(0, 150) + (p.line[150] === 'A' ? 'B' : 'A') + p.line.slice(151);
  assert.throws(() => unpackB64(bad), /characters 101-200/);
  assert.throws(() => unpackB64(p.line.slice(0, 120) + p.line.slice(121)), /characters 101-/);
});

test('a result without total/checksum is unverified; a cut result fails', async () => {
  const { verifyPageResult } = await import('../scripts/collect-pagemode.mjs');
  assert.equal(verifyPageResult({ platform: 'etsy', tiles: [] }).verified, false);
  assert.throws(() => verifyPageResult({ platform: 'etsy', total: 2, checksum: 'x', tiles: [{ id: '1' }] }), /BỊ CẮT/);
});

test('scroll waits: per platform from config, defaults 2-4 s (grids) and 5-10 s (Instagram/Facebook)', async () => {
  const { scrollWait } = await import('../scripts/collect-pagemode.mjs');
  assert.deepEqual(scrollWait('pinterest', {}), [2, 4]);
  assert.deepEqual(scrollWait('facebook', {}), [5, 10]);
  assert.deepEqual(scrollWait('etsy', { etsy: [3, 6] }), [3, 6]);
});

test('facebook: reason codes, closed page, tile -> post', async () => {
  const fb = getAdapter('facebook');
  assert.equal(fb.fbReason({ url: 'https://www.facebook.com/checkpoint/123' }, 0), 'checkpoint');
  assert.equal(fb.fbReason({ url: 'https://www.facebook.com/login/?next=x' }, 5), 'login_wall');
  assert.equal(fb.fbReason({ url: 'https://www.facebook.com/x', login_form: true }, 0), 'login_wall');
  assert.equal(fb.fbReason({ url: 'https://www.facebook.com/x', captcha: true }, 0), 'captcha');
  assert.equal(fb.fbReason({ url: 'https://www.facebook.com/x', text: "This content isn't available right now" }, 0), 'unavailable');
  assert.equal(fb.fbReason({ url: 'https://www.facebook.com/x', text: 'Hineon posts' }, 0), 'no_posts');
  assert.equal(fb.fbReason({ url: 'https://www.facebook.com/x', text: 'Hineon posts' }, 3), '');
  assert.equal(fb.isClosedPage('Urban Hardwoods · Permanently closed'), true);
  assert.equal(fb.isClosedPage('Open now'), false);
  const p = fb.toPost({ url: 'https://www.facebook.com/photo/?fbid=1333219135645308&set=pcb.1333219525645269', image_urls: ['https://scontent.x.fbcdn.net/a.jpg'], caption: 'Neon', author: 'Hineon' }, { found_by: 'reference page' });
  assert.deepEqual([p.id, p.image_urls.length, p.caption, p.author], ['1333219135645308', 1, 'Neon', 'Hineon']);
  const { parseHTML } = await import('linkedom');
  const { document: login } = parseHTML(fs.readFileSync(path.join(tool, 'tests', 'fixtures', 'fb-login.html'), 'utf8'));
  const { wallSignals } = await import('../scripts/platforms/common.mjs');
  assert.equal(fb.fbReason(wallSignals(login, fb.SELECTORS.wall), 0), 'login_wall');
});

test('facebook: post permalink id with photo fbids as aliases, caption of the post container, date text (fixture fb-album.html)', async () => {
  const fb = getAdapter('facebook');
  assert.deepEqual(fb.fbPostKeys('https://www.facebook.com/photo/?fbid=111111', ['https://www.facebook.com/x/posts/pfbid0abcdefghijkl']), { id: 'pfbid0abcdefghijkl', aliases: ['111111'] });
  assert.deepEqual(fb.fbPostKeys('https://www.facebook.com/permalink.php?story_fbid=222222&id=9', []).id, '222222');
  assert.deepEqual(fb.fbPostKeys('https://www.facebook.com/photo/?fbid=333333', []), { id: '333333', aliases: [] });
  const { parseHTML } = await import('linkedom');
  const { extractFeed, SELECTORS } = await import('../scripts/fb-extract.mjs');
  const { document } = parseHTML(fs.readFileSync(path.join(tool, 'tests', 'fixtures', 'fb-album.html'), 'utf8'));
  const posts = extractFeed(document, { ...SELECTORS, done_attr: '' }).posts;
  const got = posts.map((p) => [fb.fbPostKeys(p.post_url, p.alt_urls), p.caption, p.date_text]);
  assert.deepEqual(got, [
    [{ id: 'pfbid02AbCdEfGhIjKlMnOpQrStUv', aliases: ['1333219135645308', '1333219135645399'] }, 'Our new neon sign album for weddings', 'November 2, 2024 at 10:00 AM'],
    [{ id: '1444444444444444', aliases: [] }, 'Single photo post', 'Monday, October 7, 2024 at 9:15 AM'],
    [{ id: '9876543210123', aliases: [] }, 'No date here', ''],
  ]);
  assert.equal(document.querySelectorAll('[data-sa-seen]').length, 0, 'the extract leaves no mark in the DOM');
  // the stored post carries the photo fbids as links, so the known-post check matches either id
  const p = fb.toPost({ id: 'pfbid02AbCdEfGhIjKlMnOpQrStUv', alt: ['1333219135645308'], url: posts[0].post_url, image_urls: ['i'], caption: posts[0].caption, date_text: posts[0].date_text });
  assert.ok(p.alt_urls.some((u) => u.includes('1333219135645308')));
  assert.equal(p.posted_date, '2024-11-02');
  const cursorKnownByPhoto = { take: (x) => ([x.post_url, ...x.alt_urls].some((u) => u.includes('1333219135645308')) ? 'known' : 'collect') };
  assert.equal(pageResultPosts({ tiles: [{ id: p.id, alt: p.aliases, url: p.url, image_urls: ['i'] }] }, fb, { cursor: cursorKnownByPhoto }).skippedKnown, 1);
});

test('facebook feed: real permalink first, set=pcb id as post key, date from aria-label, cut at a word', async () => {
  const fb = getAdapter('facebook');
  const { cutWords } = await import('../scripts/platforms/common.mjs');
  const doc = parseHTML(fs.readFileSync(path.join(tool, 'tests', 'fixtures', 'fb-photo-posts.html'), 'utf8')).document;
  const posts = extractFeed(doc, FB).posts;
  const k0 = fb.fbPostKeys(posts[0].post_url, posts[0].alt_urls);
  assert.equal(k0.id, 'pfbid02RealPermalinkAbcdefghijk123');
  assert.ok(k0.aliases.includes('1333219525645269') && k0.aliases.includes('1333219135645308'));
  assert.match(posts[0].date_text, /3 tháng 11/);
  const k1 = fb.fbPostKeys(posts[1].post_url, posts[1].alt_urls);
  assert.equal(k1.id, '1326352609665294');
  assert.deepEqual([...k1.aliases].sort(), ['1326352479665307', '1326352506331971']);
  assert.match(posts[1].date_text, /Tháng 11 5/);
  const long = 'Quá trình test và vệ sinh đèn là một bước vô cùng quan trọng trước khi gửi đến tay khách hàng Cám ơn các bạn';
  const cut = cutWords(long, 100);
  assert.ok(cut.endsWith('…') && long.startsWith(cut.slice(0, -1)) && /\s/.test(long[cut.length - 1]), cut);
  assert.equal(cutWords('short', 100), 'short');
  assert.equal(instagram.splitOgCaption('ab.c on May 1, 2026: "Hello wor…').author, '@ab.c');
});

// Hand-made result (the fallback when the extract script does not work): no total / checksum / tag is fine, verified:false.
test('loadPageResult accepts a hand-made --json result without total/checksum', async () => {
  const { loadPageResult } = await import('../scripts/collect-pagemode.mjs');
  const json = JSON.stringify({ platform: 'facebook', url: 'https://www.facebook.com/x', tiles: [{ id: '1', url: 'https://www.facebook.com/x/posts/1', image_urls: ['https://example.com/a.jpg'], caption: 'hi', author: 'x', date_text: '1d' }] });
  const r = loadPageResult({ json });
  assert.equal(r.verified, false);
  assert.equal(r.result.tiles.length, 1);
});

test('timeInfo: elapsed under the limit, stop "time" over it, nothing without a start', async () => {
  const { timeInfo, TIME_NEXT } = await import('../scripts/research.mjs');
  const now = Date.parse('2026-11-11T10:10:00Z');
  const under = timeInfo('2026-11-11T10:08:00Z', now, 3);
  assert.equal(under.elapsed, '2m00s'); assert.equal(under.stop, undefined);
  const over = timeInfo('2026-11-11T10:06:00Z', now, 3);
  assert.equal(over.stop, 'time'); assert.equal(over.next, TIME_NEXT);
  assert.deepEqual(timeInfo('', now, 3), {});
});
