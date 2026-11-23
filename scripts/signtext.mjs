// Sign wording + product <-> scene context: the tool's STEP ORDER and its checkpoints. The RULES are the brand skill's: project.md,
// section 10, block "### Sign wording rules" (English, short, with a table). The tool only reads that block, embeds it (ideas todo
// _context, Flow brief, [image] lines in every image prompt) and validates against it; it carries no brand rule of its own. Every
// problem string starts with [CAUSE:<code>] so the agent sees which earlier step was skipped.
//   node scripts/signtext.mjs rules --brand <id>     print the brand's block, parsed table and sign mode (or the missing-block error)
//
// ON BY DEFAULT (user 2026-11-21): every brand whose block has a table runs the context workflow; no setting to flip. The table's
// COLUMN HEADERS (by name, not position) decide how the sign wording is made (signMode):
//   scene        | scene_type | sign wording that fits | allowed scene words | forbidden scene words |   NEW English wording per idea
//   placeholder  | product (handle) | design | placeholder on sign | scene |   sign_text = the row's placeholder, exactly
//   none         no block (or social.json product_images.sign_text_mode "none"): no sign workflow (works as before, a note only)
// social.json product_images.sign_text_mode ("scene"|"placeholder"|"none") overrides the table; legacy custom_text: true = scene
// when the skill has no table (the block is then required: [CAUSE:skill-missing-sign-rules]).
//
// The workflow (each step has a checkpoint; a later step fails when an earlier one was skipped):
//   1 idea + audience          ideas.mjs set/check  [CAUSE:missing-audience]
//   2 scene_type + scene       ideas.mjs set/check  [CAUSE:missing-scene-type | bad-scene-type | scene-mismatch]
//   3 sign wording             ideas.mjs set/check  scene: [CAUSE:missing-sign-text | missing-text-reason | sign-not-english |
//                              sign-copied-from-reference | sign-name-from-reference | sign-repeats-recent | sign-has-brand-name |
//                              missing-ref-text | description-has-ref-text]   placeholder: [CAUSE:missing-sign-text | sign-not-placeholder]
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
export const WORKFLOW_VERSION = 2; // drafts made with the step workflow carry sign_workflow: 2 (older drafts only get warnings)
export const SIGN_MODES = ['scene', 'placeholder', 'none'];

// Column roles by header name (tolerant: case, scene_type/product, wording, placeholder, allowed/scene, forbidden). First match wins.
const ROLE_TESTS = [['forbidden', /forbidden|not allowed/i], ['placeholder', /placeholder/i], ['key', /scene[\s_-]*type|product|handle/i], ['allowed', /allowed|scene/i], ['wording', /wording|lettering|text/i], ['design', /design/i]];
function columnsOf(header) {
  const col = {};
  header.forEach((h, i) => { const role = ROLE_TESTS.find(([r, re]) => !(r in col) && re.test(h))?.[0]; if (role) col[role] = i; });
  return 'key' in col ? col : { key: 0, wording: 1, allowed: 2, forbidden: 3 }; // unrecognised header: the old positional table
}
// Placeholder cell -> lines: 'ABC (line 1), Your Text (line 2)', 'A / B', 'A | B'; 'none ...' = no lettering on this product.
export function placeholderLines(cell) {
  const c = String(cell || '').replace(/`/g, '').trim();
  if (!c || /^(none|no lettering|n\/a|-)\b/i.test(c)) return [];
  const parts = /\(line\s*\d+\)/i.test(c) ? c.split(/\s*\(line\s*\d+\)\s*,?\s*/i) : c.split(/\s+[/|]\s+/);
  return parts.map((x) => x.replace(/^["']|["']$/g, '').trim()).filter(Boolean);
}
export const signLines = (t) => String(t || '').split(/\s+\/\s+/).map((x) => x.trim()).filter(Boolean);

// The block of project.md section 10 that starts at "### Sign wording rules" (up to the next heading). mode = what the table header says.
export function signRules(brand) {
  const sec = projectSection(brand.project || '', 10);
  const m = sec.match(/^###\s+Sign wording rules[^\n]*\n([\s\S]*?)(?=^#{2,3}\s|$(?![\s\S]))/im);
  if (!m) return null;
  const text = m[1].replace(/<!--[\s\S]*?-->/g, '').trim(); // a commented-out skeleton (skill template) does not count
  const split = (x) => String(x || '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
  const table = text.split(/\r?\n/).filter((l) => /^\|/.test(l)).map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
  const sepAt = table.findIndex((c) => c.every((x) => /^:?-{2,}:?$/.test(x) || !x));
  const header = sepAt > 0 ? table[sepAt - 1] : [];
  const col = columnsOf(header), mode = 'placeholder' in col ? 'placeholder' : 'scene';
  const cell = (c, role) => (role in col ? c[col[role]] || '' : '');
  const rows = table.slice(sepAt > 0 ? sepAt + 1 : 0).filter((c) => c.length >= 3 && !/^:?-{2,}/.test(c[0]) && !/^scene_type$/i.test(c[0])).map((c) => {
    const key = cell(c, 'key').replace(/`/g, '').toLowerCase(), row = { key, wording: cell(c, 'wording') };
    // The scene column lists ALLOWED scenes (free phrases; sizes in parentheses dropped); "any scene from the other rows" = union.
    const scenes = cell(c, 'allowed').replace(/\([^)]*\)/g, '').split(/[,;]/).map((w) => w.trim().toLowerCase()).filter(Boolean);
    // Scene mode: a wording cell "none ..." = a product without lettering (art only): its sign_text stays empty.
    if (mode === 'scene') return { ...row, ...(/^\s*(none|no lettering|n\/a|-)\b/i.test(row.wording) ? { no_lettering: true } : {}), design: cell(c, 'design'), allowed: scenes.filter((x) => !/any scene from the other rows/.test(x)), any_row: scenes.some((x) => /any scene from the other rows/.test(x)), forbidden: split(cell(c, 'forbidden')) };
    const lines = placeholderLines(cell(c, 'placeholder'));
    return { ...row, design: cell(c, 'design'), placeholder: cell(c, 'placeholder'), lines, sign_text: lines.join(' / '), allowed: scenes.filter((x) => !/any scene from the other rows/.test(x)), any_row: scenes.some((x) => /any scene from the other rows/.test(x)), forbidden: split(cell(c, 'forbidden')) };
  }).filter((r) => r.key);
  // Lines the skill tags [image] go into the (short) image prompt as they are; the whole block goes to the agent.
  const image = text.split(/\r?\n/).filter((l) => /^\d+\.\s*\[image\]/.test(l)).map((l) => l.replace(/^\d+\.\s*\[image\]\s*/, '').trim());
  const clean = text.replace(/^(\d+\.\s*)\[image\]\s*/gm, '$1');
  return { text: clean, mode, header, columns: col, rows, image };
}
// The brand's sign mode: social.json sign_text_mode override > the table header > legacy custom_text (true = scene) > none.
export function signMode(brand, r) {
  const pi = brand?.social?.product_images || {}, set = String(pi.sign_text_mode || '').trim().toLowerCase();
  if (SIGN_MODES.includes(set)) return set;
  if (r === undefined) r = brand?.project !== undefined ? signRules(brand) : null;
  if (r?.rows.length) return r.mode;
  return pi.custom_text === true ? 'scene' : 'none';
}
export const isCustomText = (brand) => signMode(brand) === 'scene'; // scene mode: NEW wording per idea (legacy name)
export const hasSignContext = (brand) => signMode(brand) !== 'none';
// The draft's mode: draft.sign_mode, legacy drafts: custom_text true = scene. '' = no sign workflow on this draft.
export const draftSignMode = (draft = {}) => draft.sign_mode || (draft.custom_text ? 'scene' : '');
// For a brand with a sign mode the block must exist and have a table that fits the mode: else fix the skill, not the tool.
export function requireSignRules(brand) {
  const r = signRules(brand), mode = signMode(brand, r);
  if (mode === 'none') return null;
  if (!r || !r.rows.length) throw new Error(cause('skill-missing-sign-rules', `${brand.id}: project.md section 10 has no "### Sign wording rules" block with a table (sign mode ${mode}). Add it to the brand skill (not to the tool).`));
  if (mode === 'placeholder' && r.mode !== 'placeholder') throw new Error(cause('skill-missing-sign-rules', `${brand.id}: sign_text_mode "placeholder" but the "Sign wording rules" table has no "placeholder" column.`));
  return { ...r, mode };
}
// Placeholder mode: the sign_text of an idea's row (scene_type = product handle); null when not placeholder mode or no such row.
export function placeholderOf(brand, sceneType) {
  const r = requireSignRules(brand);
  if (r?.mode !== 'placeholder') return null;
  const row = r.rows.find((x) => x.key === String(sceneType || '').trim().toLowerCase());
  return row ? row.sign_text : null;
}

const asciiLetters = (t) => !/[^\x00-\x7F]/.test(String(t || '').replace(/[‘’“”–—]/g, "'"));
const words = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter(Boolean);
const STOP = new Set(['a', 'an', 'the', 'and', 'of', 'to', 'in', 'on', 'at', 'for', 'is', 'we', 'you', 'our', 'my', 'your', 'mr', 'mrs', 'ms', 'its']);
const content = (t) => words(t).filter((w) => !STOP.has(w));
const norm = (t) => String(t || '').normalize('NFC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
const UNREADABLE = /^\s*(unreadable|unknown|not readable|n\/a|none)\s*$/i;
const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (text, w) => new RegExp(`\\b${esc(w)}s?\\b`, 'i').test(text);
// Placeholder tables list free scene phrases: a scene fits when it holds a whole phrase or one of their telling words.
const VAGUE = new Set([...STOP, 'or', 'with', 'from', 'any', 'plus', 'other', 'behind', 'above', 'wall', 'room', 'seated', 'standing', 'photo', 'event', 'table', 'gift']);
const sceneFits = (scene, phrases) => phrases.some((x) => hasWord(scene, x)) || phrases.flatMap(words).some((w) => w.length >= 3 && !VAGUE.has(w) && hasWord(scene, w));


// Sign texts of the brand's last 10 posts and drafts (+ other ideas of this batch), except the one being checked.
export function recentSignTexts(brandId, { exceptDraft = '', exceptIdea = '' } = {}) {
  const list = [];
  try { for (const p of (readJson(postsCatalogFile(brandId), { posts: [] }).posts || []).slice(-10)) { if (p.sign_text) list.push({ text: p.sign_text, where: p.id }); for (const a of p.album_signs || []) if (a) list.push({ text: a, where: p.id }); } } catch {}
  try { for (const d of listDrafts(brandId).filter((x) => x.id !== exceptDraft && x.status.status !== 'rejected').slice(-10)) { if (d.draft.sign_text) list.push({ text: d.draft.sign_text, where: d.id }); for (const a of d.draft.album_signs || []) if (a) list.push({ text: a, where: d.id }); } } catch {}
  try { for (const i of readJson(storeIdeasFile(brandId), { ideas: [] }).ideas) if (i.id !== exceptIdea && i.sign_text && ['ready', 'picked'].includes(i.status)) list.push({ text: i.sign_text, where: `idea ${i.id}` }); } catch {}
  return list;
}

// Steps 1-3: the idea's audience, scene_type, scene, sign_text (+ text_reason in scene mode) against the skill's block and the reference.
// idea: { audience, scene_type, scene, sign_text, text_reason, ref_text, ref_mode, description }. Returns [] when all is well.
export function ideaSignProblems(brand, idea, { exceptDraft = '', exceptIdea = '', needRefText = true } = {}) {
  const rules = requireSignRules(brand);
  if (!rules) return [];
  const ph = rules.mode === 'placeholder', what = ph ? 'product handle' : 'scene_type';
  const p = [], s = (k) => String(idea[k] || '').trim();
  if (s('audience').length < 6) p.push(cause('missing-audience', 'step 1: "audience" is empty (who this post is for, e.g. "engaged couples in the US planning a small wedding"). Write the idea + audience first.'));
  const key = s('scene_type').toLowerCase();
  if (!key) p.push(cause('missing-scene-type', `step 2: "scene_type" is empty: one ${what} of ${rules.rows.map((r) => r.key).join(' | ')} (the table in the skill).`));
  const row = rules.rows.find((r) => r.key === key);
  if (key && !row) p.push(cause('bad-scene-type', `step 2: scene_type "${key}" is not a ${what} of the skill table (${rules.rows.map((r) => r.key).join(' | ')}).`));
  if (row && s('scene')) {
    const has = (w) => hasWord(s('scene'), w);
    const allowed = row.any_row ? [...new Set(rules.rows.flatMap((r) => r.allowed))] : row.allowed;
    const bad = row.forbidden.find(has);
    if (bad) p.push(cause('scene-mismatch', `step 2: scene "${s('scene')}" contains "${bad}", not allowed for scene_type ${key} (skill table). Change the scene or the scene_type, then rewrite the wording.`));
    else if (allowed.length && !sceneFits(s('scene'), allowed)) p.push(cause('scene-mismatch', ph ? `step 2: scene "${s('scene')}" fits none of the scenes listed for product ${key}: ${allowed.join(', ')}.` : `step 2: scene "${s('scene')}" has none of the allowed scene words for scene_type ${key}: ${allowed.join(', ')}.`));
  }
  const sign = s('sign_text'), ref = s('ref_text');
  const desc = s('description');
  const descRef = desc && ref && !UNREADABLE.test(ref) && norm(ref).length >= 3 && norm(desc).includes(norm(ref)) ? cause('description-has-ref-text', `step 3: the product description contains the reference wording "${ref}". Describe the lettering style only; the words come from sign_text.`) : '';
  // Placeholder mode: the wording is fixed by the row (no new wording, no repeat / reference-copy / text_reason checks).
  if (ph) {
    if (row && row.sign_text && !sign) p.push(cause('missing-sign-text', `step 3: "sign_text" is empty: product ${key} shows the placeholder "${row.sign_text}" exactly.`));
    else if (row && row.sign_text && !sameSignText(sign, row.sign_text)) p.push(cause('sign-not-placeholder', `step 3: sign_text "${sign}" is not the placeholder of product ${key}: "${row.sign_text}" (skill table), exactly.`));
    else if (row && !row.sign_text && sign) p.push(cause('sign-not-placeholder', `step 3: product ${key} carries no lettering (skill table: "${row.placeholder}"): leave sign_text empty.`));
    if (descRef) p.push(descRef);
    return p;
  }
  if (row && row.no_lettering) { if (sign) p.push(cause('sign-on-unlettered', `step 3: product ${key} carries no lettering (skill table: "${row.wording}"): leave sign_text empty.`)); if (descRef) p.push(descRef); return p; }
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
  if (descRef) p.push(descRef);
  return p;
}

// Step 4: the prompt(s) of a draft must carry sign_text exactly.
export function promptProblems(dir, draft) {
  const p = [];
  if (!draftSignMode(draft) || !draft.sign_text) return p;
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
  if (!draftSignMode(draft) || !draft.sign_text) return { problems: [], warnings: [] };
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
  let r = null, error = null, mode = 'none';
  try { r = signRules(brand); mode = signMode(brand, r); requireSignRules(brand); } catch (e) { error = e.message; }
  const rows = (r?.rows || []).map((x) => mode === 'placeholder' ? { key: x.key, sign_text: x.sign_text, lines: x.lines, allowed: x.allowed, ...(x.any_row ? { any_row: true } : {}) } : x);
  return out({ brand: brand.id, sign_mode: mode, custom_text: mode === 'scene', found: !!r, ...(r ? { header: r.header, columns: r.columns, table_mode: r.mode, image: r.image, rows, text: r.text } : {}), ...(error ? { error } : {}), ...(mode === 'none' ? { note: r?.rows.length ? 'sign_text_mode none: no sign workflow' : 'no "### Sign wording rules" block in project.md section 10: ideas run without the product <-> scene context' } : {}) });
});

// Per-image wording (user 2026-11-20): in a custom-text SCENE album every extra image carries its OWN new sign wording that fits its
// scene: draft.album_signs[k] = wording of image k + 2. The cover keeps draft.sign_text (the caption quotes it).
export const perImageSigns = (draft = {}) => draftSignMode(draft) === 'scene' && !!draft.sign_text && draft.album_mode === 'scene' && draft.sign_workflow >= WORKFLOW_VERSION;
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
