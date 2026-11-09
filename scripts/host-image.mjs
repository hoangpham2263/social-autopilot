// Image hosting for an APPROVED post: puts a copy of the post's clean image at a public URL (Metricool fetches media
// by URL; see docs/plan.md section 8) and records it as `media_url` in the brand's catalog entry (project-skill-standard
// check-post accepts the field). Host = settings imageHost:
//   { type: "github-repo", path: <local clone>, rawBase: <raw URL of the branch>, branch: "main", remote: "origin" }
//   type "shopify-files" is a placeholder for later (not implemented).
// Rules (user, 09/11/2026): only images of posts a person has approved (catalog status approved/scheduled/published;
// never drafts, never competitor reference photos), metadata stripped (checked here again), files may be removed once
// Metricool keeps its own copy. Nothing is posted anywhere: this only commits the file to the host repo.
//   node scripts/host-image.mjs publish --brand <id> --post <POST-id>   copy, commit "<brand> <post-id>", push, wait for HTTP 200, write media_url
//   node scripts/host-image.mjs remove  --brand <id> --post <POST-id>   delete the hosted file (commit, push), drop media_url
// Both are idempotent. approve.mjs / writeback.mjs call publish right after a write-back (imageHost.auto_after_writeback).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { main, out, isMain, parseArgs, need, settings, toolRoot, workspace, inside, withLock, loadBrand, readJson, writeJson, today } from './lib.mjs';
import { metadataChunks } from './image-clean.mjs';

const APPROVED = ['approved', 'scheduled', 'published'];
// pHYs/bKGD: pixel size and background colour; the brand skill's clean-image keeps them, they say nothing about origin.
const HARMLESS = ['pHYs', 'bKGD'];
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function hostConfig(s = settings()) {
  const h = s.imageHost || {};
  if (h.type === 'shopify-files') throw new Error('imageHost.type "shopify-files" chưa làm (chỗ giữ cho sau). Dùng "github-repo".');
  if (h.type !== 'github-repo') throw new Error(`imageHost.type "${h.type || ''}" không hỗ trợ (settings imageHost).`);
  if (!h.path || !h.rawBase) throw new Error('Thiếu imageHost.path hoặc imageHost.rawBase trong settings.');
  const repo = path.resolve(toolRoot, h.path);
  if (!fs.existsSync(path.join(repo, '.git'))) throw new Error(`imageHost.path không phải repo git: ${repo}`);
  return {
    type: h.type, repo, rawBase: String(h.rawBase).replace(/\/+$/, ''), branch: h.branch || 'main', remote: h.remote || 'origin',
    push: h.push !== false, auto: h.auto_after_writeback !== false,
    attempts: Math.max(1, Number(h.verify?.attempts ?? 6)), delayMs: Math.max(0, Number(h.verify?.delay_seconds ?? 10) * 1000),
    // Test only: where the URL is checked (a local server standing in for raw.githubusercontent.com).
    checkBase: (process.env.SA_IMAGE_HOST_CHECK_BASE || '').replace(/\/+$/, ''),
  };
}

function git(repo, ...args) {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${(r.stderr || r.stdout || '').trim()}`);
  return r.stdout.trim();
}
const hasRemote = (h) => spawnSync('git', ['remote', 'get-url', h.remote], { cwd: h.repo, windowsHide: true }).status === 0;
const sync = (h) => { if (h.push && hasRemote(h)) git(h.repo, 'pull', '--ff-only', '--quiet', h.remote, h.branch); };
function commitPush(h, rel, message) {
  const staged = spawnSync('git', ['diff', '--cached', '--quiet', '--', rel], { cwd: h.repo, windowsHide: true }).status === 1;
  if (staged) git(h.repo, 'commit', '--quiet', '-m', message, '--', rel);
  let pushed = false;
  if (h.push && hasRemote(h)) {
    git(h.repo, 'push', '--quiet', h.remote, `HEAD:${h.branch}`);
    pushed = true;
  }
  return { committed: staged, pushed, commit: git(h.repo, 'rev-parse', 'HEAD') };
}

// The brand's catalog entry for <post>.
function postOf(brandId, postId) {
  if (!/^[A-Z]+-\d+$/.test(postId || '')) throw new Error(`Mã bài không hợp lệ: "${postId}" (vd POST-03).`);
  const brand = loadBrand(brandId, { allowDisabled: true });
  const catalogFile = path.join(brand.dir, 'workspace', 'catalog.json');
  const entry = readJson(catalogFile, { posts: [] }).posts.find((p) => p.id === postId);
  if (!entry) throw new Error(`Catalog của ${brand.id} không có ${postId}.`);
  return { brand, catalogFile, entry };
}

const brandSlug = (id) => String(id).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
const relOf = (h, url) => url && url.startsWith(h.rawBase + '/') ? decodeURI(url.slice(h.rawBase.length + 1)) : '';
// A hosted file of this post already in the repo (when the catalog lost its media_url).
function findHosted(h, brandId, postId) {
  const base = path.join(h.repo, brandSlug(brandId));
  if (!fs.existsSync(base)) return '';
  const hit = fs.readdirSync(base, { recursive: true }).map(String).find((f) => new RegExp(`(^|[\\\\/])${postId.toLowerCase()}\\.(png|jpg)$`).test(f));
  return hit ? `${brandSlug(brandId)}/${hit.split(path.sep).join('/')}` : '';
}

function setMediaUrl(catalogFile, postId, url) {
  return withLock(catalogFile, () => {
    const catalog = readJson(catalogFile);
    const entry = catalog.posts.find((p) => p.id === postId);
    if (!entry) throw new Error(`Catalog không còn ${postId}.`);
    if ((entry.media_url || undefined) === (url || undefined)) return false;
    if (url) entry.media_url = url; else delete entry.media_url;
    catalog.updated = today();
    writeJson(catalogFile, catalog);
    return true;
  });
}

function checkPost(brand, postId) {
  const checker = path.join(brand.dir, 'scripts', 'check-post.mjs');
  if (!fs.existsSync(checker)) return null;
  const r = spawnSync(process.execPath, [checker, postId], { cwd: brand.dir, encoding: 'utf8', windowsHide: true });
  try { const j = JSON.parse(r.stdout); return { errors: j.errors, results: j.results.map(({ errors, warnings }) => ({ errors, warnings })) }; } catch { return { errors: 1, output: (r.stdout || r.stderr).slice(0, 2000) }; }
}

// GitHub raw can lag a little after a push: retried until it answers 200 with exactly our bytes.
async function verify(h, rel, hash) {
  const url = `${h.checkBase || h.rawBase}/${encodeURI(rel)}`;
  let last = '';
  for (let i = 1; i <= h.attempts; i++) {
    try {
      const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
      const body = Buffer.from(await r.arrayBuffer());
      if (r.status === 200 && sha(body) === hash) return { http_status: 200, attempts: i };
      last = r.status === 200 ? '200 nhưng nội dung chưa khớp (cache cũ)' : `HTTP ${r.status}`;
    } catch (e) { last = e.cause?.code || e.message; }
    if (i < h.attempts) await wait(h.delayMs);
  }
  throw new Error(`Link ảnh chưa mở được sau ${h.attempts} lần (${last}). File đã đẩy lên; chạy lại publish sau ít phút.`);
}

export async function publish({ brand: brandId, post: postId }, s = settings()) {
  const h = hostConfig(s);
  const { brand, catalogFile, entry } = postOf(brandId, postId);
  if (!APPROVED.includes(entry.status)) throw new Error(`${postId} đang "${entry.status}"; chỉ host ảnh của bài đã được người duyệt (approved/scheduled/published).`);
  const name = entry.image || [].concat(entry.images || [])[0] || Object.values(entry.localized_images || {})[0];
  if (!name) throw new Error(`${postId} không có ảnh trong catalog.`);
  const folder = path.resolve(brand.dir, entry.folder || '');
  const file = path.resolve(folder, name);
  if (!inside(path.join(brand.dir, 'workspace'), file) || !fs.existsSync(file)) throw new Error(`Không thấy ảnh của ${postId}: ${file}`);
  const ext = path.extname(name).toLowerCase().replace('.jpeg', '.jpg');
  if (!['.png', '.jpg'].includes(ext)) throw new Error(`Chỉ host PNG/JPEG (${name}).`);
  const buf = fs.readFileSync(file);
  const left = metadataChunks(buf, { allow: HARMLESS });
  if (left.length) throw new Error(`Ảnh ${postId} còn metadata (${left.join(', ')}); làm sạch trước (clean-image), không host.`);
  const cleaner = path.join(brand.dir, 'scripts', 'clean-image.mjs');
  if (fs.existsSync(cleaner) && !/SẠCH:/.test(spawnSync(process.execPath, [cleaner, '--check', file], { encoding: 'utf8', windowsHide: true }).stdout || '')) throw new Error(`clean-image.mjs --check của skill chưa báo SẠCH cho ${postId}; không host.`);

  const date = /^\d{4}-\d{2}/.test(entry.approval?.date || '') ? entry.approval.date : /^\d{4}-\d{2}/.test(entry.created || '') ? entry.created : today();
  const fresh = `${brandSlug(brand.id)}/${date.slice(0, 4)}/${date.slice(5, 7)}/${postId.toLowerCase()}${ext}`;
  const hash = sha(buf);
  const git1 = withLock(path.join(workspace, 'image-host'), () => {
    sync(h);
    const known = relOf(h, entry.media_url) || findHosted(h, brand.id, postId);
    const rel = known && known.endsWith(ext) ? known : fresh;
    const target = path.join(h.repo, ...rel.split('/'));
    const copied = !fs.existsSync(target) || sha(fs.readFileSync(target)) !== hash;
    if (copied) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(file, target); }
    git(h.repo, 'add', '--', rel);
    return { rel, target, copied, ...commitPush(h, rel, `${brand.id} ${postId}`) };
  });
  const url = `${h.rawBase}/${encodeURI(git1.rel)}`;
  const check = await verify(h, git1.rel, hash);
  const written = setMediaUrl(catalogFile, postId, url);
  const reused = !git1.copied && !git1.committed && !written;
  return {
    brand: brand.id, post: postId, image: file, file: git1.target, path: git1.rel, url, field: 'media_url',
    commit: git1.commit, committed: git1.committed, pushed: git1.pushed, ...check, catalog: catalogFile, reused,
    check_post: checkPost(brand, postId),
  };
}

export function remove({ brand: brandId, post: postId }, s = settings()) {
  const h = hostConfig(s);
  const { brand, catalogFile, entry } = postOf(brandId, postId);
  const git1 = withLock(path.join(workspace, 'image-host'), () => {
    sync(h);
    const rel = relOf(h, entry.media_url) || findHosted(h, brand.id, postId);
    if (!rel || !fs.existsSync(path.join(h.repo, ...rel.split('/')))) return { rel, removed: false };
    git(h.repo, 'rm', '--quiet', '--', rel);
    return { rel, removed: true, ...commitPush(h, rel, `${brand.id} ${postId} remove`) };
  });
  const cleared = setMediaUrl(catalogFile, postId, '');
  return { brand: brand.id, post: postId, path: git1.rel || '', removed: git1.removed, commit: git1.commit || '', pushed: !!git1.pushed, media_url_cleared: cleared, reused: !git1.removed && !cleared };
}

// Called right after a write-back (approve.mjs, writeback.mjs): a hosting failure never undoes the approval; it is
// reported with the command to run again.
export async function hostAfterWriteback(result, s = settings()) {
  if (!result?.brand_post?.id || result.reused) return null;
  let h;
  try { h = hostConfig(s); } catch (e) { return { ok: false, error: e.message }; }
  if (!h.auto) return null;
  const brand = String(result.id).replace(/-\d{8}-\d{2}$/, '');
  try { return { ok: true, ...(await publish({ brand, post: result.brand_post.id }, s)) }; } catch (e) {
    return { ok: false, error: e.message, next: `node scripts/host-image.mjs publish --brand ${brand} --post ${result.brand_post.id}` };
  }
}

if (isMain(import.meta.url)) main(async () => {
  const args = parseArgs();
  const cmd = args._[0];
  const input = { brand: need(args, 'brand'), post: need(args, 'post') };
  if (cmd === 'publish') return out(await publish(input));
  if (cmd === 'remove') return out(remove(input));
  throw new Error('Lệnh: publish | remove');
});
