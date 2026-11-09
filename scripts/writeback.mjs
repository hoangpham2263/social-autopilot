// Step 5: write-back. Writes ONE approved draft into the brand's own skill folder: workspace/posts/POST-<slug>/
// (image cleaned by the skill's scripts/clean-image.mjs, content-<lang>.txt) and one entry in workspace/catalog.json,
// in the format the skill already uses; then runs the skill's scripts/check-post.mjs on it. Refuses anything that is
// not approved. approve.mjs calls it; run it alone only to retry a write-back that failed.
//   node scripts/writeback.mjs --id <draft>      (then host-image.mjs publish, see the end of this file)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cleanDraftImage } from './image-clean.mjs';
import { hostAfterWriteback } from './host-image.mjs';
import { main, out, parseArgs, need, isMain, settings, inside, withLock, loadBrand, readJson, writeJson, today, findDraft, setStatus } from './lib.mjs';

export function slugify(text) {
  const s = String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').filter(Boolean).slice(0, 5).join('-');
  return /^[a-z]/.test(s) ? s : `post-${s || 'social'}`.replace(/-$/, '');
}

// One write-back at a time per brand catalog (the UI and a scheduled agent may approve at the same moment).
export function writeBack(id) {
  const { draft } = findDraft(id);
  const brand = loadBrand(draft.brand);
  return withLock(path.join(brand.dir, 'workspace', 'catalog.json'), () => writeBackInner(id));
}

function writeBackInner(id) {
  const { dir, draft, status } = findDraft(id);
  if (status.brand_post) return { id, status: 'approved', brand_post: status.brand_post, reused: true };
  if (status.status !== 'approved') throw new Error(`Bản nháp ${id} chưa được duyệt (status "${status.status}"); không ghi vào thương hiệu.`);
  const brand = loadBrand(draft.brand);
  const { by = 'user', note = '' } = status;
  if (!fs.existsSync(path.join(dir, 'image.png'))) throw new Error('Bản nháp không có image.png.');
  // The brand's catalog and post folder, as its skill writes them.
  const catalogFile = path.join(brand.dir, 'workspace', 'catalog.json');
  const catalog = readJson(catalogFile, { updated: '', paths: 'Đường dẫn tính từ gốc skill.', posts: [], covers: [] });
  const number = Math.max(0, ...catalog.posts.map((p) => Number(/^POST-(\d+)$/.exec(p.id)?.[1] || 0))) + 1;
  const postId = `POST-${String(number).padStart(2, '0')}`;
  const taken = new Set(['posts', 'published'].flatMap((d) => { const p = path.join(brand.dir, 'workspace', d); return fs.existsSync(p) ? fs.readdirSync(p) : []; }));
  const base = `POST-${slugify(`${draft.idea.product_type} ${draft.idea.scene}`)}`;
  let name = base;
  for (let i = 0; taken.has(name); i++) name = `${base}-${'bcdefghijklmnopqrstuvwxyz'[i] || 'z' + i}`;
  const folderRel = `workspace/posts/${name}`;
  const folder = path.join(brand.dir, folderRel);
  fs.mkdirSync(folder, { recursive: true });

  const warnings = [];
  // Clean again before it leaves the tool: the remove-watermark skill (skipped when image.png is still its clean output),
  // then the brand skill's own clean-image.mjs only when its --check does not already say SẠCH (no double work).
  try { cleanDraftImage(dir, { generator: 'codex' }); } catch (e) { fs.rmSync(folder, { recursive: true, force: true }); throw e; }
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

  const date = today(brand.timezone);
  const rel = (p) => path.relative(brand.dir, p).split(path.sep).join('/');
  const entry = {
    id: postId, folder: folderRel, group: 'standard',
    sequence: Math.max(0, ...catalog.posts.filter((p) => p.group === 'standard').map((p) => Number(p.sequence) || 0)) + 1,
    status: 'approved', created: date,
    image: 'image.png', ...(dims ? { image_dimensions: dims } : {}),
    image_mode: draft.image_mode || 'brand-image',
    image_source: draft.image_mode === 'scene-swap' ? `reference:${draft.inspiration.post_url || draft.inspiration.source_url}` : inside(brand.dir, draft.product_image) ? rel(draft.product_image) : draft.product_image,
    captions: Object.fromEntries(brand.languages.map((l) => [l, `content-${l}.txt`])),
    caption_status: Object.fromEntries(brand.languages.map((l) => [l, 'approved'])),
    // Reviewer-only languages (language_policy.review_langs): the file is kept for reading, never a posted caption.
    ...((brand.review_languages || []).some((l) => captionFiles.includes(`content-${l}.txt`)) ? { review_captions: Object.fromEntries(brand.review_languages.filter((l) => captionFiles.includes(`content-${l}.txt`)).map((l) => [l, `content-${l}.txt`])) } : {}),
    ...(captionFiles.some((f) => /-[a-z]+\.txt$/.test(f.replace(/^content-[a-z]{2}/, ''))) ? { caption_variants: captionFiles.filter((f) => /^content-[a-z]{2}-/.test(f)) } : {}),
    channels: draft.networks.map((n) => n.network),
    language_mode: draft.language_mode,
    inspiration: { ...(/^https?:\/\//.test(draft.inspiration.post_url || '') ? { url: draft.inspiration.post_url } : {}), source: draft.inspiration.source, source_shop: draft.inspiration.source_shop || '', mode: draft.image_mode || 'brand-image', source_url: draft.inspiration.source_url, run: draft.inspiration.run, ref: draft.inspiration.ref, idea: `${draft.idea.product_type} · ${draft.idea.scene} · ${draft.idea.angle}` },
    // Bookkeeping only: a record that AI made the image. Never a label on the post or in the caption.
    ...(draft.image_mode === 'scene-swap'
      ? { ai_disclosure: true }
      : { ai_disclosure: { ai_scene: true, tool: 'codex' } }),
    approval: { by, date, note },
    source: `social-autopilot ${draft.id}`,
  };
  catalog.posts.push(entry);
  catalog.updated = date;
  writeJson(catalogFile, catalog);

  let checkPost = null;
  const checker = path.join(brand.dir, 'scripts', 'check-post.mjs');
  if (fs.existsSync(checker)) {
    const r = spawnSync(process.execPath, [checker, postId], { cwd: brand.dir, encoding: 'utf8', windowsHide: true });
    try { const j = JSON.parse(r.stdout); checkPost = { errors: j.errors, results: j.results.map(({ errors, warnings }) => ({ errors, warnings })) }; } catch { checkPost = { errors: 1, output: (r.stdout || r.stderr).slice(0, 2000) }; }
  }
  const brandPost = { id: postId, folder: path.join(brand.dir, folderRel), catalog: catalogFile };
  setStatus(dir, 'approved', { brand_post: brandPost, problems: [], error: '' });
  return { id: draft.id, status: 'approved', brand_post: brandPost, check_post: checkPost, warnings, next: 'Publish (later: Metricool) — chưa làm; bài nằm trong workspace/posts của thương hiệu, trạng thái approved.' };
}

// Then the image goes to the image host (host-image.mjs, settings imageHost.auto_after_writeback); a hosting error is
// reported in image_host and never undoes the write-back.
if (isMain(import.meta.url)) main(async () => {
  const r = writeBack(need(parseArgs(), 'id'));
  const host = await hostAfterWriteback(r);
  if (host) try { setStatus(findDraft(r.id).dir, 'approved', { image_host: { ok: host.ok, at: new Date().toISOString(), ...(host.url ? { url: host.url } : {}), ...(host.ok ? {} : { error: host.error, next: host.next || '' }) } }); } catch {}
  out(host ? { ...r, image_host: host } : r);
});
