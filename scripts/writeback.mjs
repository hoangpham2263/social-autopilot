// Step 5: write-back. Writes ONE approved draft into the TOOL's own post register (scripts/posts.mjs; user, 10/11/2026:
// skills are read-only for the tool, social-autopilot never writes into a skill folder): workspace/posts/<brand>/<POST-id>/
// (clean image, content-<lang>.txt) and one entry in workspace/posts/<brand>/catalog.json; then the register's delivery
// check (posts.mjs checkPost). Refuses anything that is not approved (finalize.mjs sets approved after a person clicked
// Approve and every automatic check passed). finalize.mjs calls it; run it alone only to retry a write-back that failed.
//   node scripts/writeback.mjs --id <draft>      (then host-image.mjs publish, see the end of this file)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cleanDraftImage } from './image-clean.mjs';
import { hostAfterWriteback } from './host-image.mjs';
import { postsDir, postsCatalogFile, nextPostId, checkPost } from './posts.mjs';
import { publishPairs, draftImages, extraShotOf } from './draft-lib.mjs';
import { main, out, parseArgs, need, isMain, inside, withLock, loadBrand, readJson, writeJson, today, findDraft, setStatus, cleanText, aiLabelHits } from './lib.mjs';

// Alt text for the post image, made at Approve from the idea (product, scene, props, sign text): short, descriptive,
// never an AI label (a sentence with one is dropped), never the source shop. Always present, so payload never lacks it.
export function altText(draft) {
  const i = draft.idea || {};
  const one = (s) => cleanText(String(s || '')).text.replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  const parts = [one(i.product_type) || 'Product photo'];
  if (draft.sign_text) parts[0] += ` reading "${one(draft.sign_text)}"`;
  if (one(i.scene)) parts.push(`in ${one(i.scene).replace(/^(in|on|at)\s+/i, '')}`);
  if (one(i.props) && !/^at most/i.test(one(i.props))) parts.push(`with ${one(i.props).replace(/^with\s+/i, '')}`);
  let alt = parts.join(' ');
  if (aiLabelHits(alt).length) alt = parts[0];
  if (aiLabelHits(alt).length) alt = 'Product photo';
  if (draft.inspiration?.source_shop && alt.toLowerCase().includes(String(draft.inspiration.source_shop).toLowerCase())) alt = parts[0];
  alt = alt.charAt(0).toUpperCase() + alt.slice(1);
  return alt.length > 240 ? alt.slice(0, 237).replace(/\s+\S*$/, '') + '…' : alt + '.';
}

// One alt text per image, in post order (album: cover, then close-up detail / wider view of the same scene).
export function altTexts(draft) {
  const cover = altText(draft);
  const what = cover.split(/ in | with /)[0].replace(/[.…]+$/, '');
  return draftImages(draft).map((_, k) => (k === 0 ? cover : extraShotOf(k) === 'detail' ? `Close-up of the ${what.charAt(0).toLowerCase() + what.slice(1)}: material, edge and light.` : `${what}, a wider view of the same scene.`));
}

export function slugify(text) {
  const s = String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').filter(Boolean).slice(0, 5).join('-');
  return /^[a-z]/.test(s) ? s : `post-${s || 'social'}`.replace(/-$/, '');
}

// One write-back at a time per brand catalog (two agents may finalize at the same moment).
export function writeBack(id) {
  const { draft } = findDraft(id);
  const brand = loadBrand(draft.brand);
  return withLock(postsCatalogFile(brand.id), () => writeBackInner(id));
}

function writeBackInner(id) {
  const { dir, draft, status } = findDraft(id);
  if (status.brand_post) return { id, status: 'approved', brand_post: status.brand_post, reused: true };
  if (status.status !== 'approved') throw new Error(`Bản nháp ${id} chưa qua finalize.mjs (status "${status.status}"); không ghi vào sổ bài.`);
  const brand = loadBrand(draft.brand);
  const { by = 'user', note = '' } = status;
  if (!fs.existsSync(path.join(dir, 'image.png'))) throw new Error('Bản nháp không có image.png.');
  // The tool's register (workspace/posts/<brand>/): catalog.json + one folder per post, named by its id.
  const catalogFile = postsCatalogFile(brand.id);
  const catalog = readJson(catalogFile, { updated: '', posts: [] });
  const postId = nextPostId(brand.id);
  const folderRel = postId;
  const folder = path.join(postsDir(brand.id), folderRel);
  if (fs.existsSync(folder)) throw new Error(`Thư mục bài đã có: ${folder}`);
  fs.mkdirSync(folder, { recursive: true });

  const warnings = [];
  // Clean again before it leaves the tool: the remove-watermark skill (skipped when image.png is still its clean output),
  // then the brand skill's own clean-image.mjs only when its --check does not already say SẠCH (no double work).
  try { cleanDraftImage(dir, { generator: 'codex' }); } catch (e) { fs.rmSync(folder, { recursive: true, force: true }); throw e; }
  // The skill's clean-image.mjs is only run (read-only use of the skill), its output goes into the tool's folder.
  const cleaner = path.join(brand.dir, 'scripts', 'clean-image.mjs');
  const already = fs.existsSync(cleaner) && /SẠCH:/.test(spawnSync(process.execPath, [cleaner, '--check', path.join(dir, 'image.png')], { encoding: 'utf8', windowsHide: true }).stdout || '');
  if (fs.existsSync(cleaner) && !already) {
    const r = spawnSync(process.execPath, [cleaner, path.join(dir, 'image.png'), path.join(folder, 'image.png')], { encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) { fs.rmSync(folder, { recursive: true, force: true }); throw new Error(`clean-image.mjs lỗi: ${(r.stderr || r.stdout).trim()}`); }
  } else {
    fs.copyFileSync(path.join(dir, 'image.png'), path.join(folder, 'image.png'));
    if (!fs.existsSync(cleaner)) warnings.push('skill không có scripts/clean-image.mjs; dùng bản sạch của remove-watermark-skill');
  }
  const captionFiles = fs.readdirSync(dir).filter((f) => /^content-[a-z]{2}(-[a-z]+)?\.txt$/.test(f));
  for (const f of captionFiles) fs.copyFileSync(path.join(dir, f), path.join(folder, f));
  const png = fs.readFileSync(path.join(folder, 'image.png'));
  const dims = png.subarray(1, 4).toString('latin1') === 'PNG' ? [png.readUInt32BE(16), png.readUInt32BE(20)] : undefined;
  // Album: the extras (already metadata-clean, draft-lib albumProblems) go in too, and every image takes the brand
  // skill's name: image-01.png (cover, the draft's image.png), image-02.png, ... One image stays image.png.
  const pairs = publishPairs(draft);
  if (pairs.length > 1) {
    for (const p of pairs.slice(1)) {
      if (!fs.existsSync(path.join(dir, p.from))) { fs.rmSync(folder, { recursive: true, force: true }); throw new Error(`Album: bản nháp thiếu ${p.from}.`); }
      fs.copyFileSync(path.join(dir, p.from), path.join(folder, p.to));
    }
    fs.renameSync(path.join(folder, 'image.png'), path.join(folder, pairs[0].to));
  }
  const images = pairs.map((p) => p.to);

  const date = today(brand.timezone);
  const rel = (p) => path.relative(brand.dir, p).split(path.sep).join('/');
  const entry = {
    id: postId, draft: draft.id, folder: folderRel,
    status: 'approved', created: date,
    image: images[0], ...(images.length > 1 ? { images } : {}), ...(dims ? { image_dimensions: dims } : {}),
    image_mode: draft.image_mode || 'brand-image',
    image_source: draft.image_mode === 'scene-swap' ? `reference:${draft.inspiration.post_url || draft.inspiration.source_url}` : inside(brand.dir, draft.product_image) ? rel(draft.product_image) : draft.product_image,
    captions: Object.fromEntries(brand.languages.map((l) => [l, `content-${l}.txt`])),
    caption_status: Object.fromEntries(brand.languages.map((l) => [l, 'approved'])),
    // Reviewer-only languages (language_policy.review_langs): the file is kept for reading, never a posted caption.
    ...((brand.review_languages || []).some((l) => captionFiles.includes(`content-${l}.txt`)) ? { review_captions: Object.fromEntries(brand.review_languages.filter((l) => captionFiles.includes(`content-${l}.txt`)).map((l) => [l, `content-${l}.txt`])) } : {}),
    ...(captionFiles.some((f) => /-[a-z]+\.txt$/.test(f.replace(/^content-[a-z]{2}/, ''))) ? { caption_variants: captionFiles.filter((f) => /^content-[a-z]{2}-/.test(f)) } : {}),
    channels: draft.networks.map((n) => n.network),
    language_mode: draft.language_mode,
    inspiration: { ...(/^https?:\/\//.test(draft.inspiration.post_url || '') ? { url: draft.inspiration.post_url } : {}), source: draft.inspiration.source, source_shop: draft.inspiration.source_shop || '', mode: draft.image_mode || 'brand-image', source_url: draft.inspiration.source_url, run: draft.inspiration.run, ref: draft.inspiration.ref, ...(draft.inspiration.store_item ? { store_item: draft.inspiration.store_item } : {}), idea: `${draft.idea.product_type} · ${draft.idea.scene} · ${draft.idea.angle}` },
    // Bookkeeping only: a record that AI made the image. Never a label on the post or in the caption.
    ...(draft.image_mode === 'scene-swap'
      ? { ai_disclosure: true }
      : { ai_disclosure: { ai_scene: true, tool: 'codex' } }),
    ...(draft.sign_text ? { sign_text: draft.sign_text } : {}),
    ...(draft.product_size ? { product_size: draft.product_size } : {}),
    media_alt: altTexts(draft),
    approval: { by, date, note },
    source: `social-autopilot ${draft.id}`,
  };
  catalog.posts.push(entry);
  catalog.updated = date;
  writeJson(catalogFile, catalog);

  const check = checkPost(brand, entry);
  const brandPost = { id: postId, folder, catalog: catalogFile };
  setStatus(dir, 'approved', { brand_post: brandPost, problems: [], error: '' });
  return { id: draft.id, status: 'approved', brand_post: brandPost, check_post: check, warnings, next: `node scripts/metricool-mcp.mjs payload --brand ${draft.brand} --posts ${postId}` };
}

// Then the image goes to the image host (host-image.mjs, settings imageHost.auto_after_writeback); a hosting error is
// reported in image_host and never undoes the write-back.
if (isMain(import.meta.url)) main(async () => {
  const r = writeBack(need(parseArgs(), 'id'));
  const host = await hostAfterWriteback(r);
  if (host) try { setStatus(findDraft(r.id).dir, 'approved', { image_host: { ok: host.ok, at: new Date().toISOString(), ...(host.url ? { url: host.url } : {}), ...(host.ok ? {} : { error: host.error, next: host.next || '' }) } }); } catch {}
  out(host ? { ...r, image_host: host } : r);
});
