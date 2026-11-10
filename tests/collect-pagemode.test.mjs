// In-page mode of the collector (scripts/collect-pagemode.mjs): pure transform, caption/id parsing, the script text, and the
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

test('pageScript: self-contained, carries the adapter selectors and the polite pauses; only Pinterest/Instagram have one', () => {
  for (const a of [pinterest, instagram]) {
    const s = a.pageScript({ url: 'https://example.com/', found_by: 'keyword:x', max: 3, steps: 2, delay: [5, 15] });
    assert.match(s, /^async \(page\) => \{/);
    assert.doesNotThrow(() => new Function(`return (${s});`), 'valid JS');
    assert.match(s, /"delay":\[5,15\]/);
    assert.match(s, /window\.scrollBy/);
    assert.doesNotMatch(s, /\.click\(|\.fill\(|method:\s*'POST'/i, 'read only');
  }
  assert.match(instagram.pageScript({ url: 'u', found_by: '', max: 1, steps: 1, delay: [5, 15] }), /"post_fallback":true/);
  for (const id of platformIds()) assert.ok(['function', 'undefined'].includes(typeof getAdapter(id).pageScript), id);
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
    const sc = spawn(process.execPath, [path.join(tool, 'scripts', 'collect.mjs'), 'script', '--brand', 'dv', '--for-query', n.query], { env });
    let src = ''; sc.stdout.on('data', (d) => { src += d; });
    await new Promise((r) => sc.on('close', r));
    assert.match(src, /^async \(page\) =>/);
    // The page result as the in-page script returns it; image hosts replaced by the local server (referer/headers path is the same code).
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
    const again = await run('collect.mjs', 'from-page', '--brand', 'dv', '--for-query', n.query, '--file', path.join(tmp, 'page.json'));
    assert.equal(again.collected, 1, JSON.stringify(again)); // the off-brand one is not in the store
    assert.equal(again.skipped_known, 2, JSON.stringify(again));
  } finally { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('b64 single-line result: round trip, exact mismatch position, 4-char tag; deadline option in the script', async () => {
  const { packB64, unpackB64, buildPageScript, checksumOf } = await import('../scripts/platforms/common.mjs');
  const { loadPageResults } = await import('../scripts/collect-pagemode.mjs');
  const obj = { platform: 'etsy', total: 1, checksum: checksumOf(['1']), tiles: [{ id: '1', url: 'https://e/1', image_urls: ['https://i/a.jpg'], caption: 'Café ' + 'long '.repeat(80) }] };
  const p = packB64(obj);
  assert.equal(p.tag.length, 4);
  assert.deepEqual(unpackB64(p.line).obj, obj);
  assert.deepEqual(loadPageResults({ _: [], b64: p.line }).result.tiles[0].id, '1');
  const bad = p.line.slice(0, 150) + (p.line[150] === 'A' ? 'B' : 'A') + p.line.slice(151);
  assert.throws(() => unpackB64(bad), /characters 101-200/);
  assert.throws(() => unpackB64(p.line.slice(0, 120) + p.line.slice(121)), /characters 101-/);
  const s = buildPageScript({ link: 'a', url_pattern: '', container: '', img: '', img_skip: '', author: '', caption: '', wall: { login_form: [], captcha: [], dialog: [] } }, { platform: 'x', url: 'https://x', found_by: 'f', max: 8, steps: 2, delay: [5, 15], id_re: '(\d+)' });
  assert.match(s, /"deadline":120/);
  assert.match(s, /partial/);
  assert.doesNotThrow(() => new Function(`return (${s});`));
});

test('a result without total/checksum is unverified (from-page then suggests partial with a warning)', async () => {
  const { mergePageResults } = await import('../scripts/collect-pagemode.mjs');
  assert.equal(mergePageResults([{ platform: 'etsy', tiles: [] }]).verified, false);
});
