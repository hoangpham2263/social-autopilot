// Draft checks shared by draft.mjs, status.mjs and approve.mjs (no command of its own).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { cleanProblems } from './image-clean.mjs';
import { loadRefs, readJson, runDir, projectField, hasHidden, sharedWords } from './lib.mjs';

// The prompt must keep the no-logo rule: the brand's logo never appears on the product (user, 07/11/2026).
export function logoWarnings(prompt) {
  const text = String(prompt || '');
  return /NO LOGO/.test(text) && /never appear on the product/i.test(text) ? [] : ['prompt.txt thiếu lệnh không logo ("NO LOGO ... must never appear on the product"): logo không bao giờ được nằm trên sản phẩm'];
}

// The same delivery rules as the brand's check-post.mjs, plus a copy check against the reference caption, the
// no-logo prompt rule (warning) and, when the brand asks for one, the watermark overlay.
export function checkDraft(dir, draft, status = {}) {
  const problems = [];
  const promptFile = path.join(dir, 'prompt.txt');
  const warnings = logoWarnings(fs.existsSync(promptFile) ? fs.readFileSync(promptFile, 'utf8') : '');
  try {
    const social = readJson(path.join(draft.brand_dir, 'project', 'social.json'));
    if (social.product_images?.watermark?.enabled && !status.watermark) problems.push('thương hiệu bật watermark nhưng chưa chèn (draft.mjs watermark)');
  } catch {}
  const project = fs.readFileSync(path.join(draft.brand_dir, 'project', 'project.md'), 'utf8');
  const website = projectField(project, 'Website').split(/\s/)[0];
  const tag = projectField(project, 'Hashtag cố định').split(/\s/)[0];
  if (!fs.existsSync(path.join(dir, 'image.png'))) problems.push('chưa có image.png');
  // image.png must be the remove-watermark skill's clean copy: no metadata chunks, pixels identical to the original.
  else problems.push(...cleanProblems(dir, status));
  let refCaption = '';
  try { refCaption = loadRefs(draft.brand, draft.inspiration.run).find((r) => r.key === draft.inspiration.ref)?.caption || ''; } catch {}
  const files = Object.values(draft.captions);
  for (const f of fs.readdirSync(dir)) if (/^content-[a-z]{2}-[a-z]+\.txt$/.test(f)) files.push(f);
  const captions = {};
  for (const f of files) {
    const file = path.join(dir, f);
    if (!fs.existsSync(file)) { problems.push(`thiếu ${f}`); continue; }
    const text = fs.readFileSync(file, 'utf8');
    captions[f] = text;
    if (!text.trim()) problems.push(`${f} trống`);
    if (hasHidden(text)) problems.push(`${f} có ký tự ẩn`);
    if (/\*\*|`|^#{1,6}\s|^>\s|\\#/m.test(text)) problems.push(`${f} có Markdown`);
    if (/\n[\t ]*\n[\t ]*\n/.test(text.replace(/\r\n/g, '\n'))) problems.push(`${f} thừa dòng trống`);
    if (website && !text.includes(`🌐 Website: ${website}`)) problems.push(`${f} thiếu dòng "🌐 Website: ${website}"`);
    if (tag && !text.trim().split(/\r?\n/).at(-1)?.split(/\s+/).includes(tag)) problems.push(`${f} thiếu hashtag ${tag} ở dòng cuối`);
    const hits = sharedWords(text, refCaption);
    if (hits.length) problems.push(`${f} chép chữ bài tham khảo: "${hits[0]}"`);
    const shop = String(draft.inspiration.source_shop || '').trim();
    if (draft.image_mode === 'scene-swap' && shop.length > 2 && text.toLowerCase().includes(shop.toLowerCase())) problems.push(`${f} nhắc tên shop nguồn "${shop}"`);
  }
  // Scene-swap: the source shop's name/logo/watermark must be gone from the image. A program cannot read that reliably,
  // so a person or the agent looks and confirms (draft.mjs confirm-clean); a new image needs a new confirmation.
  if (draft.image_mode === 'scene-swap') {
    const image = path.join(dir, 'image.png');
    const hash = fs.existsSync(image) ? crypto.createHash('sha1').update(fs.readFileSync(image)).digest('hex') : '';
    if (draft.require_logo_removal !== false && (!status.logo_check || status.logo_check.image_sha1 !== hash)) {
      problems.push(`scene-swap: xem image.png và xác nhận không còn tên shop "${draft.inspiration.source_shop || draft.inspiration.source}", logo, watermark, nhãn size, số điện thoại (draft.mjs confirm-clean --id ${draft.id} --by <tên>)`);
    }
    warnings.push('scene-swap: người duyệt phải xem ảnh gốc của shop cạnh ảnh mới (reference_image trong báo cáo/giao diện).');
  }
  return { problems, warnings, captions };
}

export function summary({ dir, draft, status }) {
  const captions = {};
  for (const f of Object.values(draft.captions)) { const file = path.join(dir, f); if (fs.existsSync(file)) captions[f] = fs.readFileSync(file, 'utf8'); }
  return { id: draft.id, brand: draft.brand, status: status.status, dir, image: path.join(dir, 'image.png'), idea: `${draft.idea.product_type} · ${draft.idea.scene} · ${draft.idea.angle}`, inspiration: draft.inspiration.post_url || draft.inspiration.source_url, networks: draft.networks.map((n) => n.network), problems: status.problems || [], note: status.note || '', captions,
    image_mode: draft.image_mode || 'brand-image',
    // Scene-swap: the approver sees the shop's original photo next to the result.
    ...(draft.image_mode === 'scene-swap' ? { reference_image: draft.reference_image, source_shop: draft.inspiration.source_shop || '', source_url: draft.inspiration.source_url || '', logo_check: status.logo_check || null } : {}) };
}

