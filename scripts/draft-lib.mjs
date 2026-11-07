// Draft checks shared by draft.mjs, status.mjs and approve.mjs (no command of its own).
import fs from 'node:fs';
import path from 'node:path';
import { loadRefs, readJson, runDir, projectField, hasHidden, sharedWords } from './lib.mjs';

// The same delivery rules as the brand's check-post.mjs, plus a copy check against the reference caption.
export function checkDraft(dir, draft) {
  const problems = [];
  const project = fs.readFileSync(path.join(draft.brand_dir, 'project', 'project.md'), 'utf8');
  const website = projectField(project, 'Website').split(/\s/)[0];
  const tag = projectField(project, 'Hashtag cố định').split(/\s/)[0];
  if (!fs.existsSync(path.join(dir, 'image.png'))) problems.push('chưa có image.png');
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
  }
  return { problems, captions };
}

export function summary({ dir, draft, status }) {
  const captions = {};
  for (const f of Object.values(draft.captions)) { const file = path.join(dir, f); if (fs.existsSync(file)) captions[f] = fs.readFileSync(file, 'utf8'); }
  return { id: draft.id, brand: draft.brand, status: status.status, dir, image: path.join(dir, 'image.png'), idea: `${draft.idea.product_type} · ${draft.idea.scene} · ${draft.idea.angle}`, inspiration: draft.inspiration.post_url || draft.inspiration.source_url, networks: draft.networks.map((n) => n.network), problems: status.problems || [], note: status.note || '', captions };
}

