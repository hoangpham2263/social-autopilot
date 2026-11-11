// Media hosting for an APPROVED post: puts a copy of the post's clean image, or its MP4 video, at a public URL (Metricool
// fetches media by URL; see docs/plan.md section 8) and records it in the tool's register entry (workspace/posts/<brand>/catalog.json): `media_url` for an image,
// `video_url` (+ `video_thumbnail_url` when the post also has an image) for a video (project-skill-standard check-post
// accepts these fields; scripts/metricool-csv.mjs reads them). Host = settings imageHost:
//   { type: "github-repo", path: <local clone, default workspace/image-host; cloned from remote_url when missing>, remote_url: <git URL>, rawBase: <raw.githubusercontent.com URL of the branch>, pagesBase: "",
//     branch: "main", remote: "origin" }
//   Links are GitHub raw links (rawBase; user, 09/11/2026: no personal domain). raw.githubusercontent.com serves .mp4 as
//   application/octet-stream: accepted for a video when pagesBase is empty, since Metricool's MCP copies the media to its
//   own storage (UNTESTED with a real video post). pagesBase (a GitHub Pages URL) stays optional: when set, links use
//   it and raw is only the fast first link for images.
//   type "shopify-files" is a placeholder for later (not implemented).
// Rules (user, 09/11/2026): only media of posts a person has approved (catalog status approved/scheduled/published;
// never drafts, never competitor reference photos), image metadata stripped (checked here again), files are removed only
// once the post is published (Metricool keeps pointing at the link until then). Nothing is posted anywhere: this only
// commits files to the host repo.
//   node scripts/host-image.mjs publish --brand <id> --post <POST-id> [--video]
//       copy, commit "<brand> <post-id>", push, wait for HTTP 200 with the same bytes and the right content-type
//       (image/* for images, video/mp4 for videos), write the URL field(s). A video is auto-detected (catalog `video`, or
//       an .mp4 as the post's media); --video makes it required.
//   node scripts/host-image.mjs remove  --brand <id> --post <POST-id> [--force]
//       delete the hosted file(s) (commit, push), drop the URL fields. Only for status "published"; --force removes
//       anyway and returns a warning (Metricool posts still pointing at the link lose their media).
// Both are idempotent. finalize.mjs / writeback.mjs call publish right after a write-back (imageHost.auto_after_writeback).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { main, out, isMain, parseArgs, need, settings, toolRoot, workspace, inside, withLock, loadBrand, readJson, writeJson, today, stamp, findDraft } from './lib.mjs';
import { metadataChunks } from './image-clean.mjs';
import { postsDir, postsCatalogFile, postFolder, checkPost as checkRegisterPost } from './posts.mjs';

const APPROVED = ['approved', 'scheduled', 'published'];
const URL_FIELDS = ['media_url', 'video_url', 'video_thumbnail_url'];
// pHYs/bKGD: pixel size and background colour; the brand skill's clean-image keeps them, they say nothing about origin.
const HARMLESS = ['pHYs', 'bKGD'];
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const trim = (u) => String(u || '').replace(/\/+$/, '');
const isVideoName = (name) => /\.mp4$/i.test(name || '');

export function hostConfig(s = settings()) {
  const h = s.imageHost || {};
  if (h.type === 'shopify-files') throw new Error('imageHost.type "shopify-files" chưa làm (chỗ giữ cho sau). Dùng "github-repo".');
  if (h.type !== 'github-repo') throw new Error(`imageHost.type "${h.type || ''}" không hỗ trợ (settings imageHost).`);
  if (!h.path || !h.rawBase) throw new Error('Thiếu imageHost.path hoặc imageHost.rawBase trong settings.');
  if (h.pagesBase && !/^https:\/\//.test(h.pagesBase)) throw new Error('imageHost.pagesBase phải là link https.');
  const repo = path.resolve(toolRoot, h.path);
  if (!fs.existsSync(path.join(repo, '.git'))) cloneHostRepo(repo, h);
  return {
    type: h.type, repo, rawBase: trim(h.rawBase), pagesBase: trim(h.pagesBase), branch: h.branch || 'main', remote: h.remote || 'origin',
    push: h.push !== false, auto: h.auto_after_writeback !== false,
    attempts: Math.max(1, Number(h.verify?.attempts ?? 6)), delayMs: Math.max(0, Number(h.verify?.delay_seconds ?? 10) * 1000),
    // Test only: where links are checked (local servers standing in for Pages and raw.githubusercontent.com).
    checkBase: trim(process.env.SA_IMAGE_HOST_CHECK_BASE),
    rawCheckBase: trim(process.env.SA_IMAGE_HOST_RAW_CHECK_BASE),
  };
}

// The image repo lives inside the tool (default workspace/image-host, git-ignored by the tool repo; its own git repo).
// Missing on this machine: clone imageHost.remote_url there (an empty folder is fine). A folder with files that is not a
// git repo is never touched.
function cloneHostRepo(repo, h) {
  if (fs.existsSync(repo) && fs.readdirSync(repo).length) throw new Error(`imageHost.path không phải repo git: ${repo}`);
  if (!h.remote_url) throw new Error(`Chưa có repo ảnh ở ${repo} và settings imageHost.remote_url trống (link git của repo ảnh công khai).`);
  fs.mkdirSync(path.dirname(repo), { recursive: true });
  const args = ['clone', ...(h.branch ? ['--branch', h.branch] : []), h.remote_url, repo];
  const r = spawnSync('git', args, { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`git clone ${h.remote_url} lỗi: ${(r.stderr || r.stdout || r.error?.message || '').trim()}`);
}

function git(repo, ...args) {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${(r.stderr || r.stdout || '').trim()}`);
  return r.stdout.trim();
}
const hasRemote = (h) => spawnSync('git', ['remote', 'get-url', h.remote], { cwd: h.repo, windowsHide: true }).status === 0;
const sync = (h) => { if (h.push && hasRemote(h)) git(h.repo, 'pull', '--ff-only', '--quiet', h.remote, h.branch); };
function commitPush(h, rels, message) {
  const staged = spawnSync('git', ['diff', '--cached', '--quiet', '--', ...rels], { cwd: h.repo, windowsHide: true }).status === 1;
  if (staged) git(h.repo, 'commit', '--quiet', '-m', message, '--', ...rels);
  let pushed = false;
  if (h.push && hasRemote(h)) {
    git(h.repo, 'push', '--quiet', h.remote, `HEAD:${h.branch}`);
    pushed = true;
  }
  return { committed: staged, pushed, commit: git(h.repo, 'rev-parse', 'HEAD') };
}

// The register entry for <post> (workspace/posts/<brand>/catalog.json, scripts/posts.mjs): only the tool's own posts.
function postOf(brandId, postId) {
  if (!/^[A-Z]+-\d+$/.test(postId || '')) throw new Error(`Mã bài không hợp lệ: "${postId}" (vd POST-03).`);
  const brand = loadBrand(brandId, { allowDisabled: true });
  const catalogFile = postsCatalogFile(brand.id);
  const entry = readJson(catalogFile, { posts: [] }).posts.find((p) => p.id === postId);
  if (!entry) throw new Error(`Sổ bài của ${brand.id} (workspace/posts/${brand.id}/catalog.json) không có ${postId}.`);
  return { brand, catalogFile, entry };
}

const brandSlug = (id) => String(id).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
// Repo path of a hosted link (Pages or raw).
const relOf = (h, url) => {
  for (const base of [h.pagesBase, h.rawBase].filter(Boolean)) if (typeof url === 'string' && url.startsWith(base + '/')) return decodeURI(url.slice(base.length + 1));
  return '';
};
// A hosted file of this post already in the repo (when the catalog lost its URL): <post-id><suffix>.<ext>.
function findHosted(h, brandId, postId, exts = ['png', 'jpg'], suffix = '') {
  const base = path.join(h.repo, brandSlug(brandId));
  if (!fs.existsSync(base)) return '';
  const names = exts.map((e) => `${postId.toLowerCase()}${suffix}.${e}`);
  const hit = fs.readdirSync(base, { recursive: true }).map(String).find((f) => names.includes(path.basename(f)));
  return hit ? `${brandSlug(brandId)}/${hit.split(path.sep).join('/')}` : '';
}

// Sets (string) or drops (empty) catalog URL fields of a post in one write.
function setFields(catalogFile, postId, fields) {
  return withLock(catalogFile, () => {
    const catalog = readJson(catalogFile);
    const entry = catalog.posts.find((p) => p.id === postId);
    if (!entry) throw new Error(`Catalog không còn ${postId}.`);
    let changed = false;
    for (const [key, url] of Object.entries(fields)) {
      if ((entry[key] || undefined) === (url || undefined)) continue;
      if (url) entry[key] = url; else delete entry[key];
      changed = true;
    }
    if (changed) { catalog.updated = today(); writeJson(catalogFile, catalog); }
    return changed;
  });
}

// Delivery check of a register post (posts.mjs).
const checkPost = (brand, postId) => checkRegisterPost(brand, postId);

// GitHub Pages / raw lag a little after a push: retried until the link answers 200 with exactly our bytes and the
// expected content-type (video/mp4 for a video, image/* for an image).
async function verifyAt(h, base, rel, hash, kind, { attempts = h.attempts, delayMs = h.delayMs } = {}) {
  const url = `${base}/${encodeURI(rel)}`;
  // A video through raw (no pagesBase) comes back as application/octet-stream; the bytes are still checked.
  const okType = kind === 'video' ? (h.pagesBase || h.checkBase ? /^video\/mp4\b/i : /^(video\/mp4|application\/octet-stream)\b/i) : /^image\//i;
  let last = '';
  for (let i = 1; i <= attempts; i++) {
    try {
      const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(120000) });
      const type = r.headers.get('content-type') || '';
      const body = Buffer.from(await r.arrayBuffer());
      if (r.status === 200 && sha(body) === hash && okType.test(type)) return { ok: true, http_status: 200, content_type: type, attempts: i };
      last = r.status !== 200 ? `HTTP ${r.status}` : sha(body) !== hash ? '200 nhưng nội dung chưa khớp (cache cũ)' : `content-type "${type || '(trống)'}" không phải ${kind === 'video' ? 'video/mp4' : 'image/*'}`;
    } catch (e) { last = e.cause?.code || e.message; }
    if (i < attempts) await wait(delayMs);
  }
  return { ok: false, last };
}

// Checks one hosted file and returns its public link.
// Image with pagesBase: raw first with a short wait (raw is usually live within seconds) and that link is written to
// the catalog at once (early(url)), so a slow Pages build never leaves the post without a link; then Pages with the
// full wait, upgrading the link when it serves. fast: stop after the raw link (pages_pending) - the caller upgrades
// later. Video: one link (Pages when set, else raw, octet-stream accepted); fast skips the check (pending, no link yet).
async function verify(h, item, hash, { fast = false, early = () => {} } = {}) {
  const primary = publicBase(h);
  const short = { attempts: Math.min(h.attempts, 5), delayMs: Math.min(h.delayMs, 3000) };
  const urlAt = (base) => `${base}/${encodeURI(item.rel)}`;
  if (item.kind === 'video' && fast) return { ok: false, pending: true };
  // Under test (checkBase set) raw is checked only at a test raw base, never the network.
  const rawCheck = h.rawCheckBase || (h.checkBase ? '' : h.rawBase);
  let raw = null;
  if (h.pagesBase && item.kind !== 'video' && rawCheck) {
    raw = await verifyAt(h, rawCheck, item.rel, hash, item.kind, short);
    if (raw.ok) {
      raw = { ...raw, url: urlAt(h.rawBase), served_by: 'raw' };
      early(raw.url);
      if (fast) return { ...raw, pages_pending: true };
    }
  }
  const first = await verifyAt(h, h.checkBase || primary, item.rel, hash, item.kind, fast ? short : undefined);
  if (first.ok) return { ...first, url: urlAt(primary), served_by: h.pagesBase ? 'pages' : 'raw' };
  if (raw?.ok) return { ...raw, fallback: `Pages chưa sẵn sàng (${first.last}); tạm dùng link raw.` };
  throw new Error(`Link ${item.kind === 'video' ? 'video' : 'ảnh'} chưa mở được đúng (${first.last}). File đã đẩy lên; chạy lại publish sau ít phút.`);
}
const publicBase = (h) => h.pagesBase || h.rawBase;

// What a post hosts: its video (+ cover image as thumbnail) or its image.
function mediaOf(brand, entry, postId, wantVideo) {
  const folder = postFolder(brand.id, entry);
  const resolve = (name) => {
    const file = path.resolve(folder, name);
    if (!folder || !inside(postsDir(brand.id), file) || !fs.existsSync(file)) throw new Error(`Không thấy file của ${postId}: ${file}`);
    return file;
  };
  const images = [entry.image, ...[].concat(entry.images || []), ...Object.values(entry.localized_images || {})].filter(Boolean);
  const videoName = (typeof entry.video === 'string' && entry.video) || images.find(isVideoName);
  const imageName = images.find((n) => !isVideoName(n));
  if (wantVideo && !videoName) throw new Error(`${postId} không có video (.mp4) trong catalog (--video).`);
  if (videoName) {
    if (!isVideoName(videoName)) throw new Error(`Chỉ host video MP4 (${videoName}).`);
    const file = resolve(videoName);
    const fd = fs.openSync(file, 'r'); const head = Buffer.alloc(8); fs.readSync(fd, head, 0, 8, 0); fs.closeSync(fd);
    if (head.subarray(4, 8).toString('latin1') !== 'ftyp') throw new Error(`${videoName} của ${postId} không phải MP4 hợp lệ.`);
    const items = [{ kind: 'video', file, ext: '.mp4', suffix: '', field: 'video_url' }];
    if (imageName) items.push({ kind: 'image', file: resolve(imageName), ext: imageExt(imageName), suffix: '-thumb', field: 'video_thumbnail_url' });
    return items;
  }
  if (!imageName) throw new Error(`${postId} không có ảnh trong catalog.`);
  // Album (entry.images, cover first): every image is hosted (<post>-01.png, <post>-02.png, ...) and media_url becomes
  // the list of links in the same order. One image: media_url stays one link, as before.
  const album = [...new Set([].concat(entry.images || []))].filter((n) => !isVideoName(n));
  if (album.length > 1) return album.map((n, i) => ({ kind: 'image', file: resolve(n), ext: imageExt(n), suffix: `-${String(i + 1).padStart(2, '0')}`, field: 'media_url', index: i }));
  return [{ kind: 'image', file: resolve(imageName), ext: imageExt(imageName), suffix: '', field: 'media_url' }];
}
function imageExt(name) {
  const ext = path.extname(name).toLowerCase().replace('.jpeg', '.jpg');
  if (!['.png', '.jpg'].includes(ext)) throw new Error(`Chỉ host PNG/JPEG (${name}).`);
  return ext;
}

// fast: a short wait only (raw link for an image, no check for a video); used right after an approval so it returns
// quickly. Importable: never exits the process (the server calls it in-process).
export async function publish({ brand: brandId, post: postId, video: wantVideo = false, fast = false }, s = settings()) {
  const h = hostConfig(s);
  const { brand, catalogFile, entry } = postOf(brandId, postId);
  if (!APPROVED.includes(entry.status)) throw new Error(`${postId} đang "${entry.status}"; chỉ host media của bài đã duyệt (approved/scheduled/published).`);
  const items = mediaOf(brand, entry, postId, wantVideo);
  const cleaner = path.join(brand.dir, 'scripts', 'clean-image.mjs');
  for (const it of items) {
    it.buf = fs.readFileSync(it.file);
    it.hash = sha(it.buf);
    if (it.kind !== 'image') continue;
    const left = metadataChunks(it.buf, { allow: HARMLESS });
    if (left.length) throw new Error(`Ảnh ${postId} còn metadata (${left.join(', ')}); làm sạch trước (clean-image), không host.`);
    if (fs.existsSync(cleaner) && !/SẠCH:/.test(spawnSync(process.execPath, [cleaner, '--check', it.file], { encoding: 'utf8', windowsHide: true }).stdout || '')) throw new Error(`clean-image.mjs --check của skill chưa báo SẠCH cho ${postId}; không host.`);
  }

  const date = /^\d{4}-\d{2}/.test(entry.approval?.date || '') ? entry.approval.date : /^\d{4}-\d{2}/.test(entry.created || '') ? entry.created : today();
  const dir = `${brandSlug(brand.id)}/${date.slice(0, 4)}/${date.slice(5, 7)}`;
  const git1 = withLock(path.join(workspace, 'image-host'), () => {
    sync(h);
    let copied = false;
    for (const it of items) {
      const known = relOf(h, it.index === undefined ? entry[it.field] : [].concat(entry[it.field] || [])[it.index]) || findHosted(h, brand.id, postId, it.kind === 'video' ? ['mp4'] : ['png', 'jpg'], it.suffix);
      it.rel = known && known.endsWith(it.ext) ? known : `${dir}/${postId.toLowerCase()}${it.suffix}${it.ext}`;
      it.target = path.join(h.repo, ...it.rel.split('/'));
      if (!fs.existsSync(it.target) || sha(fs.readFileSync(it.target)) !== it.hash) {
        fs.mkdirSync(path.dirname(it.target), { recursive: true }); fs.copyFileSync(it.file, it.target); copied = true;
      }
      git(h.repo, 'add', '--', it.rel);
    }
    return { copied, ...commitPush(h, items.map((it) => it.rel), `${brand.id} ${postId}`) };
  });
  let written = false;
  for (const it of items) {
    // An image link is written as soon as one serves (raw), so the catalog is never left without it.
    it.check = await verify(h, it, it.hash, { fast, early: (url) => { if (it.kind === 'image' && items.length === 1) written = setFields(catalogFile, postId, { [it.field]: url }) || written; } });
  }
  const [main1, thumb] = items;
  // fast + video: nothing verified yet, no link written (the caller runs the full publish later).
  if (main1.check.pending) return { brand: brand.id, post: postId, kind: main1.kind, path: main1.rel, url: '', field: main1.field, pending: true, commit: git1.commit, committed: git1.committed, pushed: git1.pushed, catalog: catalogFile, reused: false };
  // Album: media_url = every image link in order (only when all of them serve).
  const albumUrls = items.every((it) => it.index !== undefined) ? items.map((it) => it.check.url) : null;
  written = setFields(catalogFile, postId, albumUrls ? (albumUrls.every(Boolean) ? { media_url: albumUrls } : {}) : Object.fromEntries(items.filter((it) => it.check.url).map((it) => [it.field, it.check.url]))) || written;
  const { url, ...check } = main1.check;
  return {
    brand: brand.id, post: postId, kind: main1.kind, file: main1.target, path: main1.rel, url, field: main1.field, ...(albumUrls ? { urls: albumUrls, paths: items.map((it) => it.rel) } : {}),
    ...(main1.kind === 'video' ? { video: main1.file, thumbnail_url: thumb?.check.url || '', thumbnail_path: thumb?.rel || '' } : { image: main1.file }),
    ...check, commit: git1.commit, committed: git1.committed, pushed: git1.pushed, catalog: catalogFile,
    reused: !git1.copied && !git1.committed && !written, check_post: checkPost(brand, postId),
  };
}

export function remove({ brand: brandId, post: postId, force = false }, s = settings()) {
  const h = hostConfig(s);
  const { brand, catalogFile, entry } = postOf(brandId, postId);
  let warning = '';
  if (entry.status !== 'published') {
    if (!force) throw new Error(`${postId} đang "${entry.status}", chưa đăng: Metricool vẫn trỏ về link host, gỡ bây giờ là bài mất ảnh/video. Chỉ gỡ khi trạng thái "published" (hoặc --force nếu chắc chắn).`);
    warning = `CẢNH BÁO: gỡ media của ${postId} khi bài đang "${entry.status}" (--force). Bài đã nhập/hẹn giờ trên Metricool sẽ mất ảnh/video.`;
    process.stderr.write(warning + '\n');
  }
  const git1 = withLock(path.join(workspace, 'image-host'), () => {
    sync(h);
    const rels = [...new Set([
      ...URL_FIELDS.flatMap((f) => [].concat(entry[f] || []).map((u) => relOf(h, u))),
      ...Array.from({ length: 10 }, (_, i) => findHosted(h, brand.id, postId, ['png', 'jpg'], `-${String(i + 1).padStart(2, '0')}`)),
      findHosted(h, brand.id, postId), findHosted(h, brand.id, postId, ['mp4']), findHosted(h, brand.id, postId, ['png', 'jpg'], '-thumb'),
    ].filter((rel) => rel && fs.existsSync(path.join(h.repo, ...rel.split('/')))))];
    if (!rels.length) return { rels, removed: false };
    git(h.repo, 'rm', '--quiet', '--', ...rels);
    return { rels, removed: true, ...commitPush(h, rels, `${brand.id} ${postId} remove`) };
  });
  const cleared = setFields(catalogFile, postId, Object.fromEntries(URL_FIELDS.map((f) => [f, ''])));
  return {
    brand: brand.id, post: postId, path: git1.rels[0] || '', paths: git1.rels, removed: git1.removed, commit: git1.commit || '', pushed: !!git1.pushed,
    media_url_cleared: cleared, reused: !git1.removed && !cleared, ...(warning ? { warning } : {}),
  };
}

// The draft's status.json keeps the last hosting result (image_host), whatever happened; the draft status is untouched.
function recordHost(draftId, host) {
  try {
    const file = path.join(findDraft(draftId).dir, 'status.json');
    withLock(file, () => {
      const cur = readJson(file, {});
      writeJson(file, { ...cur, image_host: { ok: !!host.ok, at: stamp(), ...(host.url ? { url: host.url } : {}), ...(host.pending ? { pending: true } : {}), ...(host.ok ? {} : { error: host.error || '', next: host.next || '' }), ...(host.upgrade_error ? { upgrade_error: host.upgrade_error } : {}) }, updated: stamp() });
    });
  } catch { /* the draft may be gone; the catalog still has the link */ }
}

// Called right after a write-back (finalize.mjs, writeback.mjs, the app): a hosting failure never undoes the write-back.
// It returns quickly: push + a short check (an image gets its raw link at once). When the post still needs the slow
// part (the Pages link, or any video), the full publish keeps running in the background (`background` holds its
// promise) and records its result in status.json image_host. Every outcome, ok or error (+ the command to run again),
// is recorded in status.json image_host by this function itself.
export async function hostAfterWriteback(result, s = settings(), { background = true } = {}) {
  if (!result?.brand_post?.id || result.reused) return null;
  const record = (host) => { if (result.id) recordHost(result.id, host); return host; };
  let h;
  try { h = hostConfig(s); } catch (e) { return record({ ok: false, error: e.message }); }
  if (!h.auto) return null;
  const brand = String(result.id).replace(/-\d{8}-\d{2}$/, '');
  const input = { brand, post: result.brand_post.id };
  const next = `node scripts/host-image.mjs publish --brand ${brand} --post ${input.post}`;
  let first;
  try { first = { ok: true, ...(await publish({ ...input, fast: true }, s)) }; } catch (e) { first = { ok: false, error: e.message, next }; }
  if (first.ok && !first.pending && !first.pages_pending) return record(first);
  // Slow part: the full publish (idempotent) upgrades the link to Pages or retries a failed check.
  const host = first.ok && first.pending ? { ...first, ok: false, error: 'Đang đưa video lên, chờ link GitHub Pages…', next } : first;
  record(host);
  if (!background) return host;
  const full = publish(input, s).then(
    (r) => record({ ok: true, ...r }),
    (e) => record(first.ok && first.url ? { ...first, pages_pending: false, upgrade_error: e.message } : { ok: false, error: e.message, next }),
  );
  return Object.defineProperty({ ...host, background: true }, 'promise', { value: full, enumerable: false });
}

if (isMain(import.meta.url)) main(async () => {
  const args = parseArgs();
  const cmd = args._[0];
  const input = { brand: need(args, 'brand'), post: need(args, 'post') };
  if (cmd === 'publish') return out(await publish({ ...input, video: args.video === true }));
  if (cmd === 'remove') return out(remove({ ...input, force: args.force === true }));
  throw new Error('Lệnh: publish [--video] | remove [--force]');
});
