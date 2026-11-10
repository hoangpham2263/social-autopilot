// The tool's own post register (user, 10/11/2026: the tool keeps ALL of its work inside its workspace; brand skills are
// READ-ONLY for the tool: rules, product images, brand data). One register per brand:
//   workspace/posts/<brand>/catalog.json      { updated, posts: [ { id, draft, folder, status, captions, image, media_url,
//                                                metricool.<network>, schedule.<network>, published.<network>, ... } ] }
//   workspace/posts/<brand>/<POST-id>/        final image + content-<lang>.txt of an approved post
//   workspace/posts/<brand>/archive/<POST-id>-<time>/   posts sent back to review (their numbers are never used again)
// `folder` is relative to workspace/posts/<brand>/. Post ids are the tool's own numbering per brand (POST-xx, after the
// highest id in the register or its archive). Approve (finalize.mjs -> writeback.mjs) writes here; payload/record/status,
// host-image, the queue, the app and the run log read here. Nothing is ever written into a skill folder.
//   node scripts/posts.mjs list  --brand <id>
//   node scripts/posts.mjs check --brand <id> --post POST-xx           delivery check of one register post
//   node scripts/posts.mjs mark-published --brand <id> --post POST-xx --date yyyy-mm-dd [--url <link>] [--network facebook] [--lang en]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main, out, isMain, parseArgs, need, workspace, readJson, writeJson, withLock, loadBrand, today, projectField, hasHidden, aiLabelHits, brandLanguages, inside } from './lib.mjs';

export const postsDir = (brandId) => path.join(workspace, 'posts', brandId);
export const postsCatalogFile = (brandId) => path.join(postsDir(brandId), 'catalog.json');
export const postsArchiveDir = (brandId) => path.join(postsDir(brandId), 'archive');
export const readPosts = (brandId) => readJson(postsCatalogFile(brandId), { updated: '', posts: [] });
export const postFolder = (brandId, entry) => (entry?.folder ? path.join(postsDir(brandId), entry.folder) : '');
export const findPost = (brandId, postId) => (readPosts(brandId).posts || []).find((p) => p.id === postId) || null;

// Next POST-xx of the brand in the tool's own numbering: after the highest id in the register and its archive.
export function nextPostId(brandId) {
  const num = (s) => Number(/^POST-(\d+)(?:$|-)/.exec(s || '')?.[1] || 0);
  const archived = fs.existsSync(postsArchiveDir(brandId)) ? fs.readdirSync(postsArchiveDir(brandId)).map(num) : [];
  const n = Math.max(0, ...archived, ...(readPosts(brandId).posts || []).map((p) => num(p.id))) + 1;
  return `POST-${String(n).padStart(2, '0')}`;
}

// Read-modify-write of the register under its lock.
export function updatePosts(brandId, fn) {
  const file = postsCatalogFile(brandId);
  return withLock(file, () => {
    const catalog = readJson(file, { updated: '', posts: [] });
    const r = fn(catalog);
    writeJson(file, catalog);
    return r;
  });
}

// Template placeholders in Title/upper case ("Your Names", "YOUR LOGO"); a CTA like "send us your logo" is fine.
const PLACEHOLDER = /\bY(?:our|OUR)\s+(?:N(?:ames?|AMES?)|L(?:ogo|OGO)|B(?:ar|AR)\s+N(?:ame|AME)|B(?:usiness|USINESS)\s+N(?:ame|AME)|T(?:ext|EXT)|S(?:hop|HOP)\s+N(?:ame|AME))\b/;

// Delivery check of one register post (the rules of the skill standard's check-post.mjs, run on the tool's own copy):
// folder, captions of the posted languages (no hidden characters, no Markdown, website footer, fixed hashtag, no AI
// label, no placeholder for custom-text products, the sign text quoted), image PNG/JPEG without metadata (the skill's
// clean-image.mjs --check, read only), https media links. Returns { errors: <count>, results: [{ errors, warnings }] }.
export function checkPost(brand, postOrId) {
  const entry = typeof postOrId === 'string' ? findPost(brand.id, postOrId) : postOrId;
  const errors = [], warnings = [];
  if (!entry) return { errors: 1, results: [{ id: postOrId, errors: [`${postOrId} không có trong sổ bài của tool (workspace/posts/${brand.id}/catalog.json).`], warnings }] };
  const folder = postFolder(brand.id, entry);
  if (!folder || !inside(postsDir(brand.id), folder) || !fs.existsSync(folder)) errors.push(`Thiếu thư mục bài ${entry.folder || ''}.`);
  else {
    const project = brand.project ?? fs.readFileSync(path.join(brand.dir, 'project', 'project.md'), 'utf8');
    const social = brand.social ?? readJson(path.join(brand.dir, 'project', 'social.json'), {});
    const website = projectField(project, 'Website').split(/\s/)[0];
    const tag = projectField(project, 'Hashtag cố định').split(/\s/)[0];
    const langs = brandLanguages(social);
    for (const l of langs.length ? langs : Object.keys(entry.captions || {})) {
      const name = entry.captions?.[l];
      if (!name) { errors.push(`Catalog thiếu caption "${l}".`); continue; }
      const file = path.join(folder, name);
      if (!fs.existsSync(file)) { errors.push(`Thiếu ${name}.`); continue; }
      const text = fs.readFileSync(file, 'utf8');
      if (!text.trim()) errors.push(`${name} trống.`);
      if (hasHidden(text)) errors.push(`${name} có ký tự ẩn.`);
      if (/\*\*|`|^#{1,6}\s|^>\s|\\#/m.test(text)) errors.push(`${name} có Markdown.`);
      if (aiLabelHits(text).length) errors.push(`${name} có nhãn AI.`);
      if (website && !text.includes(`🌐 Website: ${website}`)) errors.push(`${name} thiếu dòng "🌐 Website: ${website}".`);
      if (tag && !text.trim().split(/\r?\n/).at(-1)?.split(/\s+/).includes(tag)) errors.push(`${name} thiếu hashtag ${tag} ở dòng cuối.`);
      if (social.product_images?.custom_text === true && PLACEHOLDER.test(text)) errors.push(`${name} còn chữ mẫu kiểu "Your Names"/"Your Logo".`);
      if (entry.sign_text && !text.toLowerCase().includes(String(entry.sign_text).toLowerCase())) errors.push(`${name} không nhắc đúng chữ trên bảng "${entry.sign_text}".`);
    }
    const images = [...new Set([...(entry.images || []), ...(entry.image ? [entry.image] : [])])];
    if (!images.length && !entry.video && !entry.media_url && !entry.video_url) errors.push('Chưa có ảnh trong catalog.');
    const cleaner = path.join(brand.dir, 'scripts', 'clean-image.mjs');
    for (const name of images) {
      const file = path.join(folder, name);
      if (path.basename(name) !== name || !fs.existsSync(file)) { errors.push(`Thiếu ${name}.`); continue; }
      const data = fs.readFileSync(file);
      const png = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const jpeg = data[0] === 255 && data[1] === 216;
      if (!png && !jpeg) { errors.push(`${name} không phải PNG/JPEG.`); continue; }
      if (fs.existsSync(cleaner)) {
        const r = spawnSync(process.execPath, [cleaner, '--check', file], { encoding: 'utf8', windowsHide: true });
        if (r.status !== 0 || !/SẠCH:/.test(r.stdout || '')) errors.push(`${name} còn metadata: ${(r.stdout || r.stderr || '').trim().slice(0, 300)}`);
      } else warnings.push('skill không có scripts/clean-image.mjs: bỏ qua kiểm metadata');
    }
    if (entry.video && !fs.existsSync(path.join(folder, entry.video))) errors.push(`Thiếu ${entry.video}.`);
  }
  for (const k of ['media_url', 'video_url', 'video_thumbnail_url']) if (entry[k] && !/^https:\/\//.test(String(entry[k]))) errors.push(`${k} phải là link https công khai.`);
  return { errors: errors.length, results: [{ id: entry.id, errors, warnings }] };
}

// Posted (reconcile step, getScheduledPosts says PUBLISHED): status "published" + published.<network> in the register.
export function markPublished({ brand: brandId, post, date, url = '', network = '', lang = '' }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('--date phải là yyyy-mm-dd.');
  if (url && !/^https?:\/\//.test(url)) throw new Error('--url phải là link http(s).');
  const brand = loadBrand(brandId, { allowDisabled: true });
  return updatePosts(brand.id, (catalog) => {
    const entry = (catalog.posts || []).find((p) => p.id === post);
    if (!entry) throw new Error(`${post} không có trong sổ bài của tool (${postsCatalogFile(brand.id)}).`);
    const networks = network ? [network] : (entry.channels?.length ? entry.channels : Object.keys(entry.metricool || {}));
    entry.published = { ...(entry.published || {}) };
    for (const n of networks.length ? networks : ['facebook']) entry.published[n] = { date, ...(url ? { url } : {}), ...(lang ? { languages: lang.split(',') } : {}) };
    entry.status = 'published';
    catalog.updated = today(brand.timezone);
    return { brand: brand.id, post, status: entry.status, published: entry.published };
  });
}

if (isMain(import.meta.url)) main(() => {
  const args = parseArgs();
  const cmd = args._[0];
  const brandId = need(args, 'brand');
  if (cmd === 'list') return out({ brand: brandId, catalog: postsCatalogFile(brandId), posts: readPosts(brandId).posts || [] });
  if (cmd === 'check') { const r = checkPost(loadBrand(brandId, { allowDisabled: true }), need(args, 'post')); return out({ ok: !r.errors, ...r }); }
  if (cmd === 'mark-published') return out(markPublished({ brand: brandId, post: need(args, 'post'), date: need(args, 'date'), url: args.url === true ? '' : args.url || '', network: args.network === true ? '' : args.network || '', lang: args.lang === true ? '' : args.lang || '' }));
  throw new Error('Lệnh: list --brand <id> | check --brand <id> --post POST-xx | mark-published --brand <id> --post POST-xx --date yyyy-mm-dd [--url ..] [--network ..] [--lang ..]');
});
