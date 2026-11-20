// Sign wording (custom-text brands, product_images.custom_text): the tool's STEP ORDER and its checkpoints. The RULES are the
// brand skill's: project.md, section 10, block "### Sign wording rules" (English, short, with the sign type x scene table).
// The tool only reads that block, embeds it (ideas todo _context, Flow brief) and validates against it; it carries no
// brand rule of its own. Every problem string starts with [CAUSE:<code>] so the agent sees which earlier step was skipped.
//   node scripts/signtext.mjs rules --brand <id>     print the brand's block + parsed table (or the missing-block error)
//
// The workflow (each step has a checkpoint; a later step fails when an earlier one was skipped):
//   1 idea + audience          ideas.mjs set/check  [CAUSE:missing-audience]
//   2 scene_type + scene       ideas.mjs set/check  [CAUSE:missing-scene-type | bad-scene-type | scene-mismatch]
//   3 NEW English sign wording ideas.mjs set/check  [CAUSE:missing-sign-text | missing-text-reason | sign-not-english |
//                              sign-copied-from-reference | sign-name-from-reference | sign-repeats-recent | sign-has-brand-name |
//                              missing-ref-text | description-has-ref-text]
//   4 image prompt carries it  draft.mjs check-prompt / flow-brief / register-image  [CAUSE:prompt-missing-sign-text]
//   5 image reads it           draft.mjs sign-check --reads "<what the image shows>"   [CAUSE:image-text-mismatch | image-not-checked]
//   6 caption from the idea    pipeline captions step                                   [CAUSE:caption-before-image-check]
//   7 final check              draft.mjs check                                          (all of the above, once more)
import fs from 'node:fs';
import path from 'node:path';
import { main, out, isMain, parseArgs, need, loadBrand, readJson, listDrafts, projectSection } from './lib.mjs';
import { sameSignText } from './draft-lib.mjs';
import { postsCatalogFile } from './posts.mjs';
import { storeIdeasFile } from './store.mjs';

export const cause = (code, msg) => `[CAUSE:${code}] ${msg}`;
export const isCustomText = (brand) => brand?.social?.product_images?.custom_text === true;
export const WORKFLOW_VERSION = 2; // drafts made with the step workflow carry sign_workflow: 2 (older drafts only get warnings)

// The block of project.md section 10 that starts at "### Sign wording rules" (up to the next heading).
export function signRules(brand) {
  const sec = projectSection(brand.project || '', 10);
  const m = sec.match(/^###\s+Sign wording rules[^\n]*\n([\s\S]*?)(?=^#{2,3}\s|$(?![\s\S]))/im);
  if (!m) return null;
  const text = m[1].trim();
  const split = (x) => String(x || '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
  const rows = text.split(/\r?\n/).filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l)).map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
    .filter((c) => c.length >= 4 && c[0].toLowerCase() !== 'scene_type').map((c) => ({ key: c[0].toLowerCase(), wording: c[1], allowed: split(c[2]), forbidden: split(c[3]) }));
  // Lines the skill tags [image] go into the (short) image prompt as they are; the whole block goes to the agent.
  const image = text.split(/\r?\n/).filter((l) => /^\d+\.\s*\[image\]/.test(l)).map((l) => l.replace(/^\d+\.\s*\[image\]\s*/, '').trim());
  const clean = text.replace(/^(\d+\.\s*)\[image\]\s*/gm, '$1');
  return { text: clean, rows, image };
}
// For a custom-text brand the block must exist and have a table: else the skill is missing the rules (fix the skill, not the tool).
export function requireSignRules(brand) {
  if (!isCustomText(brand)) return null;
  const r = signRules(brand);
  if (!r || !r.rows.length) throw new Error(cause('skill-missing-sign-rules', `${brand.id}: project.md section 10 has no "### Sign wording rules" block with a scene_type table. Add it to the brand skill (not to the tool).`));
  return r;
}

const asciiLetters = (t) => !/[^\x00-\x7F]/.test(String(t || '').replace(/[‘’“”–—]/g, "'"));
const words = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter(Boolean);
const STOP = new Set(['a', 'an', 'the', 'and', 'of', 'to', 'in', 'on', 'at', 'for', 'is', 'we', 'you', 'our', 'my', 'your', 'mr', 'mrs', 'ms', 'its']);
const content = (t) => words(t).filter((w) => !STOP.has(w));
const norm = (t) => String(t || '').normalize('NFC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
const UNREADABLE = /^\s*(unreadable|unknown|not readable|n\/a|none)\s*$/i;

// Sign texts of the brand's last 10 posts and drafts (+ other ideas of this batch), except the one being checked.
export function recentSignTexts(brandId, { exceptDraft = '', exceptIdea = '' } = {}) {
  const list = [];
  try { for (const p of (readJson(postsCatalogFile(brandId), { posts: [] }).posts || []).slice(-10)) { if (p.sign_text) list.push({ text: p.sign_text, where: p.id }); for (const a of p.album_signs || []) if (a) list.push({ text: a, where: p.id }); } } catch {}
  try { for (const d of listDrafts(brandId).filter((x) => x.id !== exceptDraft && x.status.status !== 'rejected').slice(-10)) { if (d.draft.sign_text) list.push({ text: d.draft.sign_text, where: d.id }); for (const a of d.draft.album_signs || []) if (a) list.push({ text: a, where: d.id }); } } catch {}
  try { for (const i of readJson(storeIdeasFile(brandId), { ideas: [] }).ideas) if (i.id !== exceptIdea && i.sign_text && ['ready', 'picked'].includes(i.status)) list.push({ text: i.sign_text, where: `idea ${i.id}` }); } catch {}
  return list;
}

// Steps 1-3: the idea's audience, scene_type, scene, sign_text, text_reason against the skill's block and the reference.
// idea: { audience, scene_type, scene, sign_text, text_reason, ref_text, ref_mode, description }. Returns [] when all is well.
export function ideaSignProblems(brand, idea, { exceptDraft = '', exceptIdea = '', needRefText = true } = {}) {
  if (!isCustomText(brand)) return [];
  const rules = requireSignRules(brand);
  const p = [], s = (k) => String(idea[k] || '').trim();
  if (s('audience').length < 6) p.push(cause('missing-audience', 'step 1: "audience" is empty (who this post is for, e.g. "engaged couples in the US planning a small wedding"). Write the idea + audience first.'));
  const key = s('scene_type').toLowerCase();
  if (!key) p.push(cause('missing-scene-type', `step 2: "scene_type" is empty: one of ${rules.rows.map((r) => r.key).join(' | ')} (the sign type x scene table in the skill).`));
  const row = rules.rows.find((r) => r.key === key);
  if (key && !row) p.push(cause('bad-scene-type', `step 2: scene_type "${key}" is not in the skill table (${rules.rows.map((r) => r.key).join(' | ')}).`));
  if (row && s('scene')) {
    const has = (w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i').test(s('scene'));
    const bad = row.forbidden.find(has);
    if (bad) p.push(cause('scene-mismatch', `step 2: scene "${s('scene')}" contains "${bad}", not allowed for scene_type ${key} (skill table). Change the scene or the scene_type, then rewrite the wording.`));
    else if (row.allowed.length && !row.allowed.some(has)) p.push(cause('scene-mismatch', `step 2: scene "${s('scene')}" has none of the allowed scene words for scene_type ${key}: ${row.allowed.join(', ')}.`));
  }
  const sign = s('sign_text'), ref = s('ref_text');
  if (!sign) p.push(cause('missing-sign-text', 'step 3: "sign_text" is empty: write NEW English wording that fits this scene and audience (never copied from the reference photo).'));
  else {
    if (!asciiLetters(sign) || /[^\x20-\x7E‘’“”]/.test(sign)) p.push(cause('sign-not-english', `step 3: sign_text "${sign}" has non-English letters or symbols (English letters A-Z, digits and & ' - . , ! ? only).`));
    if (s('text_reason').length < 15) p.push(cause('missing-text-reason', 'step 3: "text_reason" is missing or too short: say why this audience wants exactly this wording in this scene.'));
    if (brand.brand && new RegExp(`\\b${String(brand.brand).replace(/[^A-Za-z0-9]/g, '')}\\b`, 'i').test(sign.replace(/\s+/g, ''))) p.push(cause('sign-has-brand-name', `step 3: sign_text contains the brand name "${brand.brand}".`));
    if (ref && !UNREADABLE.test(ref)) {
      if (sameSignText(sign, ref)) p.push(cause('sign-copied-from-reference', `step 3: sign_text "${sign}" is the reference photo's own wording; write a new one.`));
      else {
        const a = content(sign), b = content(ref), shared = a.filter((w) => b.includes(w));
        const pair = ref.match(/([A-Za-z][\w'-]+)\s*(?:&|\+|\band\b)\s*([A-Za-z][\w'-]+)/);
        const names = pair ? [pair[1], pair[2]].map((x) => x.toLowerCase()).filter((x) => !STOP.has(x)) : [];
        if (names.some((n) => a.includes(n))) p.push(cause('sign-name-from-reference', `step 3: sign_text "${sign}" reuses a name from the reference wording "${ref}". Invent different names.`));
        else if (shared.length && shared.length / Math.max(1, Math.min(a.length, b.length)) >= 0.5) p.push(cause('sign-copied-from-reference', `step 3: sign_text "${sign}" copies "${shared.join(' ')}" from the reference wording "${ref}"; write a new one.`));
      }
    }
    const n = norm(sign);
    for (const r of recentSignTexts(brand.id, { exceptDraft, exceptIdea })) {
      const m = norm(r.text);
      if (m && (m === n || (Math.min(m.length, n.length) >= 6 && (m.includes(n) || n.includes(m))))) { p.push(cause('sign-repeats-recent', `step 3: sign_text "${sign}" repeats "${r.text}" (${r.where}), one of the brand's last 10 signs. Write different wording.`)); break; }
    }
  }
  if (needRefText && s('ref_mode') && !ref) p.push(cause('missing-ref-text', 'step 3: reference-based idea without "ref_text" (what the reference sign reads, exactly; "unreadable" when it cannot be read). It is needed to prove the new wording is not a copy.'));
  const desc = s('description');
  if (desc && ref && !UNREADABLE.test(ref) && norm(ref).length >= 3 && norm(desc).includes(norm(ref))) p.push(cause('description-has-ref-text', `step 3: the product description contains the reference wording "${ref}". Describe the lettering style only; the words come from sign_text.`));
  return p;
}

// Step 4: the prompt(s) of a draft must carry sign_text exactly.
export function promptProblems(dir, draft) {
  const p = [];
  if (!draft.custom_text || !draft.sign_text) return p;
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => /^prompt(-\d+)?\.txt$/.test(x)) : []) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    const xm = /^prompt-(\d+)\.txt$/.exec(f), own = xm && perImageSigns(draft) ? albumSignOf(draft, Number(xm[1])) : '';
    if (xm && perImageSigns(draft)) {
      if (!own || /\{\{ALBUM_SIGN\}\}/.test(t)) p.push(cause('missing-album-sign', `step 4: ${f} has no wording of its own yet: this album image needs its OWN new sign wording that fits its scene (draft.mjs reprompt --id ${draft.id} --album-signs "<wording of image 2>|<image 3>|..").`));
      else if (!t.includes(own)) p.push(cause('prompt-missing-sign-text', `step 4: ${f} does not carry its sign wording "${own}" exactly (draft.mjs reprompt --id ${draft.id} --album-signs "...").`));
      continue;
    }
    if (!t.includes(draft.sign_text)) p.push(cause('prompt-missing-sign-text', `step 4: ${f} does not carry the sign wording "${draft.sign_text}" exactly (draft.mjs reprompt --id ${draft.id} --sign-text "...").`));
    if (draft.ref_text && !UNREADABLE.test(draft.ref_text) && draft.ref_mode && norm(draft.ref_text).length >= 3 && new RegExp(`"${draft.ref_text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(t) && !/replace|instead of|old text/i.test(t)) p.push(cause('prompt-missing-sign-text', `step 4: ${f} still quotes the reference wording "${draft.ref_text}" without replacing it.`));
  }
  return p;
}

// Step 5: the agent looked at the image(s) and wrote down what the sign reads (draft.mjs sign-check).
export function signCheckProblems(dir, draft, status, imageHash) {
  if (!draft.custom_text || !draft.sign_text) return { problems: [], warnings: [] };
  const sc = status.sign_check;
  const miss = !sc || sc.image_sha1 !== imageHash || (perImageSigns(draft) && !sc.reads_extra) ? cause('image-not-checked', `step 5: look at the image(s) and record what the sign reads: draft.mjs sign-check --id ${draft.id} --reads "<cover wording>"${perImageSigns(draft) ? ' --reads-02 "<image 2 wording>" --reads-03 ... (every album image has its own wording)' : ''} --by <name>`) : '';
  const bad = sc && sc.image_sha1 === imageHash && !sc.ok ? cause('image-text-mismatch', `step 5: the image(s) do not read the wording they should (cover read "${sc.reads}", sign_text "${draft.sign_text}"${sc.reads_extra ? '; extras read ' + JSON.stringify(sc.reads_extra) : ''}): redo the image(s) (reprompt + image).`) : '';
  const list = [miss, bad].filter(Boolean);
  return draft.sign_workflow >= WORKFLOW_VERSION ? { problems: list, warnings: [] } : { problems: [], warnings: list };
}

if (isMain(import.meta.url)) main(() => {
  const args = parseArgs();
  if (args._[0] !== 'rules') throw new Error('Command: rules --brand <id>');
  const brand = loadBrand(need(args, 'brand'), { allowDisabled: true });
  const r = signRules(brand);
  return out({ brand: brand.id, custom_text: isCustomText(brand), found: !!r, ...(r || {}), ...(isCustomText(brand) && !r ? { error: cause('skill-missing-sign-rules', 'add the block to the brand skill project.md section 10') } : {}) });
});

// Per-image wording (user 2026-11-20): in a custom-text SCENE album every extra image carries its OWN new sign wording that fits its
// scene: draft.album_signs[k] = wording of image k + 2. The cover keeps draft.sign_text (the caption quotes it).
export const perImageSigns = (draft = {}) => !!draft.custom_text && !!draft.sign_text && draft.album_mode === 'scene' && draft.sign_workflow >= WORKFLOW_VERSION;
export const albumSignOf = (draft = {}, n) => String((draft.album_signs || [])[n - 2] || '').trim();
// Each extra wording: English, non-empty, different from the cover, the reference text and the other extras.
export function albumSignProblems(draft, signs = draft.album_signs || []) {
  const p = [], seen = [{ t: draft.sign_text, w: 'the cover' }, ...(draft.ref_text && !UNREADABLE.test(draft.ref_text) ? [{ t: draft.ref_text, w: 'the reference photo' }] : [])];
  for (let k = 0; k < (draft.image_count || 1) - 1; k++) {
    const s = String(signs[k] || '').trim(), n = k + 2;
    if (!s) { p.push(cause('missing-album-sign', `step 3: image ${n} has no sign wording of its own (album_signs).`)); continue; }
    if (!asciiLetters(s) || /[^\x20-\x7E‘’“”]/.test(s)) p.push(cause('sign-not-english', `step 3: album sign ${n} "${s}" has non-English letters or symbols.`));
    const same = seen.find((x) => sameSignText(s, x.t) || (norm(s).length >= 6 && (norm(s).includes(norm(x.t)) || norm(x.t).includes(norm(s)))));
    if (same) p.push(cause('album-sign-repeats', `step 3: album sign ${n} "${s}" repeats the wording of ${same.w} ("${same.t}"): each image needs a different wording that fits its scene.`));
    seen.push({ t: s, w: 'image ' + n });
  }
  return p;
}
