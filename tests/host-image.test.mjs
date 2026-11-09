// host-image.mjs against a throw-away brand copy and a temp git repo as the image host (its "origin" is a local bare
// repo, so the push is fake; the real social-autopilot-sources is never touched). A local HTTP server stands in for
// GitHub Pages / raw.githubusercontent.com (SA_IMAGE_HOST_CHECK_BASE, SA_IMAGE_HOST_RAW_CHECK_BASE) and answers 404 the
// first time for each file, like GitHub lag. /main/ serves real MIME types (like Pages); /raw/ serves .mp4 as
// application/octet-stream (like raw.githubusercontent.com).
// npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

// A small valid PNG (solid colour), so clean-image and check-post accept it.
function png(w = 8, h = 8, rgb = [200, 120, 40]) {
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const tool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'social-autopilot-host-'));
const skills = path.join(tmp, 'skills');
const ws = path.join(tmp, 'workspace');
const host = path.join(tmp, 'host');
const bare = path.join(tmp, 'remote.git');
const brandDir = path.join(skills, 'dreamyvows-skills');
const realBrand = path.resolve(tool, '..', 'vaniecom-workspace', 'skills', 'dreamyvows-skills');
const haveReal = fs.existsSync(path.join(realBrand, 'project', 'social.json'));
const RAW = 'https://raw.example.invalid/sources/main';
const PAGES = 'https://pages.example.invalid/sources';
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };
const git = (cwd, ...args) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
const catalogFile = path.join(brandDir, 'workspace', 'catalog.json');
const entryOf = (id) => JSON.parse(fs.readFileSync(catalogFile, 'utf8')).posts.find((p) => p.id === id);

// Host server: /main|raw/<path> -> the file at the bare repo's main; 404 the first time a URL is asked.
const seen = new Set();
let hits = 0;
const server = http.createServer((req, res) => {
  hits++;
  const m = req.url.match(/^\/(main|raw)\/(.*)$/);
  if (!m) { res.writeHead(404); return res.end('404'); }
  const rel = decodeURI(m[2]);
  const r = spawnSync('git', ['--git-dir', bare, 'show', `main:${rel}`], { encoding: 'buffer' });
  if (!seen.has(req.url) || r.status !== 0) { seen.add(req.url); res.writeHead(404); return res.end('404'); }
  const type = /\.mp4$/.test(rel) ? (m[1] === 'raw' ? 'application/octet-stream' : 'video/mp4') : /\.jpg$/.test(rel) ? 'image/jpeg' : 'image/png';
  res.writeHead(200, { 'content-type': type }); res.end(r.stdout);
});
const base = (prefix) => `http://127.0.0.1:${server.address().port}/${prefix}`;
// Runs fn with another imageHost settings / env, then restores both.
async function withHost(imageHost, extraEnv, fn) {
  const file = path.join(ws, 'settings.json');
  const keep = fs.readFileSync(file, 'utf8'), e = env;
  fs.writeFileSync(file, JSON.stringify({ imageHost: { type: 'github-repo', path: host, rawBase: RAW, verify: { attempts: 3, delay_seconds: 0.05 }, ...imageHost } }));
  env = { ...e, ...extraEnv };
  try { return await fn(); } finally { fs.writeFileSync(file, keep); env = e; }
}
const setStatus = (id, status) => { const c = JSON.parse(fs.readFileSync(catalogFile, 'utf8')); c.posts.find((p) => p.id === id).status = status; fs.writeFileSync(catalogFile, JSON.stringify(c, null, 2)); };
// A tiny file that starts like an MP4 (ftyp box); enough for check-post and host-image.
const mp4 = () => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.from([0, 0, 2, 0]), Buffer.from('isomiso2mp41'), Buffer.alloc(64, 7)]);
let env;
// Async child process, so the server above keeps answering while the script waits.
const run = (script, ...args) => new Promise((resolve, reject) => {
  const p = spawn(process.execPath, [path.join(tool, 'scripts', script), ...args], { env });
  let o = '', e = '';
  p.stdout.on('data', (d) => { o += d; }); p.stderr.on('data', (d) => { e += d; });
  p.on('close', () => { try { resolve(JSON.parse(o)); } catch { reject(new Error(`${script} ${args.join(' ')}: ${o}${e}`)); } });
});

function post(id, status, image = png(16, 16, [20, 160, 90])) {
  const folder = `workspace/posts/POST-host-test-${id.toLowerCase()}`;
  write(path.join(brandDir, folder, 'image.png'), image);
  for (const l of ['vn', 'en']) write(path.join(brandDir, folder, `content-${l}.txt`), `Bảng neon thử host (${l}).\n\n🌐 Website: https://dreamyvows.com/\n#DreamyVows\n`);
  const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
  catalog.posts.push({ id, folder, group: 'standard', status, created: '2026-11-09', image: 'image.png', image_dimensions: [16, 16],
    captions: { vn: 'content-vn.txt', en: 'content-en.txt' }, approval: status === 'approved' ? { by: 'Hoang', date: '2026-11-09', note: '' } : undefined });
  fs.writeFileSync(catalogFile, JSON.stringify(catalog, null, 2));
}

function videoPost(id) {
  const folder = `workspace/posts/VID-host-test-${id.toLowerCase()}`;
  write(path.join(brandDir, folder, 'video.mp4'), mp4());
  write(path.join(brandDir, folder, 'image.png'), png(16, 16, [90, 30, 160]));
  for (const l of ['vn', 'en']) write(path.join(brandDir, folder, `content-${l}.txt`), `Video thử host (${l}).\n\n🌐 Website: https://dreamyvows.com/\n#DreamyVows\n`);
  const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
  catalog.posts.push({ id, folder, group: 'standard', status: 'approved', created: '2026-11-09', video: 'video.mp4', image: 'image.png', image_dimensions: [16, 16],
    captions: { vn: 'content-vn.txt', en: 'content-en.txt' }, approval: { by: 'Hoang', date: '2026-11-09', note: '' } });
  fs.writeFileSync(catalogFile, JSON.stringify(catalog, null, 2));
}

test.before(async () => {
  if (!haveReal) return;
  fs.cpSync(realBrand, brandDir, { recursive: true, filter: (s) => !/[\\/]workspace[\\/]local([\\/]|$)|[\\/]\.git([\\/]|$)/.test(s) });
  git(tmp, 'init', '--quiet', '--bare', '-b', 'main', bare);
  git(tmp, 'init', '--quiet', '-b', 'main', host);
  git(host, 'config', 'user.name', 'test'); git(host, 'config', 'user.email', 'test@example.invalid');
  write(path.join(host, 'README.md'), '# test host\n');
  git(host, 'add', 'README.md'); git(host, 'commit', '--quiet', '-m', 'init');
  git(host, 'remote', 'add', 'origin', bare); git(host, 'push', '--quiet', '-u', 'origin', 'main');
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  write(path.join(ws, 'settings.json'), JSON.stringify({ imageHost: { type: 'github-repo', path: host, pagesBase: '', rawBase: RAW, verify: { attempts: 4, delay_seconds: 0.05 } } }));
  env = { ...process.env, SA_WORKSPACE: ws, SA_SKILLS_ROOT: skills, SA_IMAGE_HOST_CHECK_BASE: `http://127.0.0.1:${server.address().port}/main` };
  post('POST-90', 'approved');
  post('POST-91', 'awaiting_review');
  videoPost('VID-93');
  const dirty = png(16, 16, [1, 2, 3]);
  post('POST-92', 'approved', Buffer.concat([dirty.subarray(0, 33), Buffer.from([0, 0, 0, 4, 0x74, 0x45, 0x58, 0x74, 0x61, 0x3d, 0x62, 0x0a, 0, 0, 0, 0]), dirty.subarray(33)]));
});
test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('publish: approved only, clean only, commit + push + 200, media_url in the catalog; idempotent; remove', { skip: !haveReal && 'no brand skill to copy' }, async () => {
  const head = () => git(tmp, '--git-dir', bare, 'rev-parse', 'main');
  const start = head();

  const draft = await run('host-image.mjs', 'publish', '--brand', 'dreamyvows', '--post', 'POST-91');
  assert.equal(draft.ok, false);
  assert.match(draft.error, /đã ghi vào thương hiệu/);
  const dirty = await run('host-image.mjs', 'publish', '--brand', 'dreamyvows', '--post', 'POST-92');
  assert.equal(dirty.ok, false);
  assert.match(dirty.error, /metadata/);
  assert.equal(head(), start, 'nothing pushed for a draft or an unclean image');

  const r = await run('host-image.mjs', 'publish', '--brand', 'dreamyvows', '--post', 'POST-90');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.path, 'dreamyvows/2026/11/post-90.png');
  assert.equal(r.url, `${RAW}/dreamyvows/2026/11/post-90.png`);
  assert.equal(r.committed, true);
  assert.equal(r.pushed, true);
  assert.equal(r.http_status, 200);
  assert.ok(r.attempts >= 2, 'retried past the first 404');
  assert.equal(git(tmp, '--git-dir', bare, 'log', '-1', '--format=%s', 'main'), 'dreamyvows POST-90');
  assert.equal(entryOf('POST-90').media_url, r.url);
  assert.equal(r.check_post.errors, 0, JSON.stringify(r.check_post));

  const again = await run('host-image.mjs', 'publish', '--brand', 'dreamyvows', '--post', 'POST-90');
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(again.reused, true);
  assert.equal(again.committed, false);
  assert.equal(git(tmp, '--git-dir', bare, 'rev-list', '--count', 'main'), '2');

  // Approved, not published: Metricool still points at the link, so remove refuses without --force.
  const early = await run('host-image.mjs', 'remove', '--brand', 'dreamyvows', '--post', 'POST-90');
  assert.equal(early.ok, false);
  assert.match(early.error, /published/);
  assert.equal(entryOf('POST-90').media_url, r.url, 'nothing removed');
  assert.equal(spawnSync('git', ['--git-dir', bare, 'cat-file', '-e', 'main:dreamyvows/2026/11/post-90.png']).status, 0, 'file still hosted');

  const rm = await run('host-image.mjs', 'remove', '--brand', 'dreamyvows', '--post', 'POST-90', '--force');
  assert.equal(rm.ok, true, JSON.stringify(rm));
  assert.equal(rm.removed, true);
  assert.match(rm.warning, /CẢNH BÁO/);
  assert.equal(spawnSync('git', ['--git-dir', bare, 'cat-file', '-e', 'main:dreamyvows/2026/11/post-90.png']).status !== 0, true, 'file gone from the host');
  assert.equal(git(tmp, '--git-dir', bare, 'log', '-1', '--format=%s', 'main'), 'dreamyvows POST-90 remove');
  assert.equal(entryOf('POST-90').media_url, undefined);
  const rm2 = await run('host-image.mjs', 'remove', '--brand', 'dreamyvows', '--post', 'POST-90', '--force');
  assert.equal(rm2.removed, false);
  assert.equal(rm2.reused, true);
});

test('a link that never answers 200 is an error, and media_url is not written', { skip: !haveReal && 'no brand skill to copy' }, async () => {
  const e = env;
  env = { ...e, SA_IMAGE_HOST_CHECK_BASE: `http://127.0.0.1:${server.address().port}/nowhere` };
  try {
    const r = await run('host-image.mjs', 'publish', '--brand', 'dreamyvows', '--post', 'POST-90');
    assert.equal(r.ok, false);
    assert.match(r.error, /chưa mở được/);
    assert.equal(entryOf('POST-90').media_url, undefined);
  } finally { env = e; }
});

test('shopify-files is only a placeholder', { skip: !haveReal && 'no brand skill to copy' }, async () => {
  const file = path.join(ws, 'settings.json');
  const keep = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, JSON.stringify({ imageHost: { type: 'shopify-files' } }));
  try {
    const r = await run('host-image.mjs', 'publish', '--brand', 'dreamyvows', '--post', 'POST-90');
    assert.equal(r.ok, false);
    assert.match(r.error, /shopify-files" chưa làm/);
  } finally { fs.writeFileSync(file, keep); }
  assert.ok(hits > 0);
});

test('video: Pages link with video/mp4, thumbnail, video_url in the catalog; octet-stream refused; remove once published', { skip: !haveReal && 'no brand skill to copy' }, async () => {
  await withHost({ pagesBase: PAGES }, { SA_IMAGE_HOST_CHECK_BASE: base('main') }, async () => {
    const noVideo = await run('host-image.mjs', 'publish', '--brand', 'dreamyvows', '--post', 'POST-92', '--video');
    assert.equal(noVideo.ok, false);
    assert.match(noVideo.error, /không có video/);
    const r = await run('host-image.mjs', 'publish', '--brand', 'dreamyvows', '--post', 'VID-93');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.kind, 'video');
    assert.equal(r.field, 'video_url');
    assert.equal(r.url, `${PAGES}/dreamyvows/2026/11/vid-93.mp4`);
    assert.equal(r.thumbnail_url, `${PAGES}/dreamyvows/2026/11/vid-93-thumb.png`);
    assert.equal(r.content_type, 'video/mp4');
    assert.equal(r.served_by, 'pages');
    assert.equal(entryOf('VID-93').video_url, r.url);
    assert.equal(entryOf('VID-93').video_thumbnail_url, r.thumbnail_url);
    assert.equal(entryOf('VID-93').media_url, undefined);
    assert.equal(r.check_post.errors, 0, JSON.stringify(r.check_post));
    assert.equal(git(tmp, '--git-dir', bare, 'log', '-1', '--format=%s', 'main'), 'dreamyvows VID-93');
  });
  // A host answering application/octet-stream for the MP4 (like raw.githubusercontent.com) is refused; no raw fallback for video.
  await withHost({ pagesBase: PAGES }, { SA_IMAGE_HOST_CHECK_BASE: base('raw'), SA_IMAGE_HOST_RAW_CHECK_BASE: base('raw') }, async () => {
    const r = await run('host-image.mjs', 'publish', '--brand', 'dreamyvows', '--post', 'VID-93', '--video');
    assert.equal(r.ok, false);
    assert.match(r.error, /video\/mp4/);
    assert.equal(entryOf('VID-93').video_url, `${PAGES}/dreamyvows/2026/11/vid-93.mp4`, 'catalog unchanged');
  });
  setStatus('VID-93', 'published');
  await withHost({ pagesBase: PAGES }, {}, async () => {
    const rm = await run('host-image.mjs', 'remove', '--brand', 'dreamyvows', '--post', 'VID-93');
    assert.equal(rm.ok, true, JSON.stringify(rm));
    assert.equal(rm.removed, true);
    assert.equal(rm.warning, undefined);
    assert.deepEqual([...rm.paths].sort(), ['dreamyvows/2026/11/vid-93-thumb.png', 'dreamyvows/2026/11/vid-93.mp4']);
    assert.equal(entryOf('VID-93').video_url, undefined);
    assert.equal(entryOf('VID-93').video_thumbnail_url, undefined);
  });
});

// hostAfterWriteback in a child process (the module reads SA_WORKSPACE at import): prints status.json right after the
// quick step, then again after the background publish.
const afterWriteback = (draftId, postId) => new Promise((resolve, reject) => {
  const mod = new URL(`file:///${path.join(tool, 'scripts', 'host-image.mjs').split(path.sep).join('/')}`).href;
  const statusFile = path.join(ws, 'drafts', 'dreamyvows', draftId, 'status.json');
  const code = `import { hostAfterWriteback } from ${JSON.stringify(mod)}; import fs from 'node:fs';
    const read = () => JSON.parse(fs.readFileSync(${JSON.stringify(statusFile)}, 'utf8'));
    const host = await hostAfterWriteback({ id: ${JSON.stringify(draftId)}, brand_post: { id: ${JSON.stringify(postId)} } });
    const quick = read(); if (host.promise) await host.promise;
    console.log(JSON.stringify({ host, quick, final: read() }));`;
  const p = spawn(process.execPath, ['--input-type=module', '-e', code], { env });
  let o = '', e = '';
  p.stdout.on('data', (d) => { o += d; }); p.stderr.on('data', (d) => { e += d; });
  p.on('close', () => { try { resolve(JSON.parse(o)); } catch { reject(new Error(`afterWriteback: ${o}${e}`)); } });
});
const draft = (draftId) => {
  write(path.join(ws, 'drafts', 'dreamyvows', draftId, 'draft.json'), JSON.stringify({ id: draftId, brand: 'dreamyvows' }));
  write(path.join(ws, 'drafts', 'dreamyvows', draftId, 'status.json'), JSON.stringify({ status: 'approved', tool_status: 'approved' }));
};

test('after an approval: raw link recorded at once, Pages link in the background; errors recorded too', { skip: !haveReal && 'no brand skill to copy' }, async () => {
  post('POST-94', 'approved', png(16, 16, [10, 200, 200]));
  draft('dreamyvows-20261109-07');
  await withHost({ pagesBase: PAGES }, { SA_IMAGE_HOST_CHECK_BASE: base('main'), SA_IMAGE_HOST_RAW_CHECK_BASE: base('raw') }, async () => {
    const r = await afterWriteback('dreamyvows-20261109-07', 'POST-94');
    assert.equal(r.host.ok, true, JSON.stringify(r.host));
    assert.equal(r.host.pages_pending, true);
    assert.equal(r.host.background, true);
    assert.equal(r.quick.image_host.ok, true);
    assert.equal(r.quick.image_host.url, `${RAW}/dreamyvows/2026/11/post-94.png`, 'raw link recorded before Pages answers');
    assert.equal(r.quick.status, 'approved');
    assert.equal(r.final.image_host.ok, true);
    assert.equal(r.final.image_host.url, `${PAGES}/dreamyvows/2026/11/post-94.png`, 'upgraded to Pages');
    assert.equal(entryOf('POST-94').media_url, `${PAGES}/dreamyvows/2026/11/post-94.png`);
  });
  // A post that cannot be hosted: the error and the command to run again are recorded, never silently dropped.
  draft('dreamyvows-20261109-08');
  const bad = await afterWriteback('dreamyvows-20261109-08', 'POST-92');
  assert.equal(bad.host.ok, false);
  assert.equal(bad.final.image_host.ok, false);
  assert.match(bad.final.image_host.error, /metadata/);
  assert.match(bad.final.image_host.next, /host-image\.mjs publish --brand dreamyvows --post POST-92/);
});

test('image: Pages link when ready, raw as fallback when Pages is not', { skip: !haveReal && 'no brand skill to copy' }, async () => {
  await withHost({ pagesBase: PAGES }, { SA_IMAGE_HOST_CHECK_BASE: base('nowhere'), SA_IMAGE_HOST_RAW_CHECK_BASE: base('main') }, async () => {
    const r = await run('host-image.mjs', 'publish', '--brand', 'dreamyvows', '--post', 'POST-90');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.served_by, 'raw');
    assert.match(r.fallback, /Pages chưa sẵn sàng/);
    assert.equal(entryOf('POST-90').media_url, `${RAW}/dreamyvows/2026/11/post-90.png`);
  });
  await withHost({ pagesBase: PAGES }, { SA_IMAGE_HOST_CHECK_BASE: base('raw') }, async () => {
    const r = await run('host-image.mjs', 'publish', '--brand', 'dreamyvows', '--post', 'POST-90');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.served_by, 'pages');
    assert.equal(r.content_type, 'image/png');
    assert.equal(r.url, `${PAGES}/dreamyvows/2026/11/post-90.png`, 'the raw link is replaced by the Pages link');
    assert.equal(entryOf('POST-90').media_url, r.url);
  });
});
