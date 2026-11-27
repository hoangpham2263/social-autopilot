// "Tạo lại" (Posts > Preview): the person marks images of a draft (or the whole post) to be made again, with an optional note.
// The request lives in the draft folder (redo-request.json: { images: [n..], whole, note, notes: { n: text }, at }), n = 1 cover,
// 2..4 extras. ONE create-mode agent run makes every pending request (server: POST /api/redo/run, prompt from redoPrompt below).
// A request image counts as done when its file was written after the request time (register-image writes a new file and keeps the
// old one aside); draft.mjs redo-done --id <draft> and the end of the run drop the done images, the rest stays pending.
import fs from 'node:fs';
import path from 'node:path';
import { findDraft, listDrafts, readJson, writeJson, stamp, toolRoot, workspace, discoverBrands } from './lib.mjs';
import { draftImages } from './draft-lib.mjs';
import { skillLine, imagesText } from './prompts.mjs';

export const REDO_FILE = 'redo-request.json';
const NOTE_MAX = 300;
const clean = (t) => String(t ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };

// Why a draft cannot take a request ('' = it can): approved / scheduled / posted posts and dropped ones are out.
export function redoBlock(d) {
  if (d.status?.brand_post) return 'Bài đã duyệt: bấm Back to review trước khi tạo lại.';
  if (d.status?.status === 'rejected') return 'Bài đã bỏ.';
  return '';
}

export function readRedo(dir) {
  const r = readJson(path.join(dir, REDO_FILE), null);
  if (!r || !Array.isArray(r.images) || !r.images.length) return null;
  return { images: r.images.filter((n) => Number.isInteger(n)).sort((a, b) => a - b), whole: !!r.whole, note: String(r.note || ''), notes: r.notes && typeof r.notes === 'object' ? r.notes : {}, at: String(r.at || '') };
}

// Set (or clear, when no image is marked) the request of one draft. images: [n..]; whole: every image of the post.
export function setRedo(id, { images = [], whole = false, note = '', notes = {} } = {}) {
  const d = findDraft(String(id || ''));
  const block = redoBlock(d);
  if (block) throw new Error(block);
  const count = draftImages(d.draft).length;
  const all = Array.from({ length: count }, (_, i) => i + 1);
  const picked = whole ? all : [...new Set((Array.isArray(images) ? images : []).map(Number))].sort((a, b) => a - b);
  const bad = picked.filter((n) => !Number.isInteger(n) || n < 1 || n > count);
  if (bad.length) throw new Error(`Ảnh ${bad.join(', ')} không có: bài này có ${count} ảnh (1..${count}).`);
  const file = path.join(d.dir, REDO_FILE);
  if (!picked.length) { fs.rmSync(file, { force: true }); return { id: d.draft.id, cleared: true }; }
  const per = {};
  for (const [k, v] of Object.entries(notes && typeof notes === 'object' ? notes : {})) { const n = Number(k), t = clean(v); if (picked.includes(n) && t) per[n] = t; }
  const req = { images: picked, whole: !!whole || picked.length === count, note: clean(note), notes: per, at: stamp() };
  writeJson(file, req);
  return { id: d.draft.id, request: req };
}

// Every pending request (eligible drafts only), oldest first.
export function pendingRedos(brand) {
  const out = [];
  for (const d of listDrafts(brand || undefined)) {
    const r = readRedo(d.dir);
    if (!r || redoBlock(d)) continue;
    out.push({ id: d.id, brand: d.draft.brand, dir: d.dir, count: draftImages(d.draft).length, ...r });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

// The images of a request already made again (file written after the request time).
export function doneImages(dir, draft, req) {
  const files = draftImages(draft), t = Date.parse(req.at) || 0;
  return req.images.filter((n) => files[n - 1] && mtime(path.join(dir, files[n - 1])) > t);
}

// Drop the done images of a draft's request; the file goes when nothing is left.
export function redoDone(id) {
  const d = findDraft(String(id || ''));
  const r = readRedo(d.dir);
  if (!r) return { id: d.draft.id, pending: [], cleared: [] };
  const done = doneImages(d.dir, d.draft, r), left = r.images.filter((n) => !done.includes(n));
  const file = path.join(d.dir, REDO_FILE);
  if (!left.length) fs.rmSync(file, { force: true });
  else if (done.length) writeJson(file, { ...readJson(file, {}), images: left, whole: false, notes: Object.fromEntries(Object.entries(r.notes).filter(([k]) => left.includes(Number(k)))) });
  return { id: d.draft.id, cleared: done, pending: left };
}

// End of a redo run: every request whose images were made again is cleared (whatever the run status); the rest stays pending.
export function clearDoneRedos(ids = null) {
  const res = [];
  for (const p of pendingRedos()) if (!ids || ids.includes(p.id)) { try { res.push(redoDone(p.id)); } catch {} }
  return res;
}

// Progress of a redo run (live bar): the snapshot taken at start ({ items: [{ id, images }] }), images written since the run started.
export function redoProgress(redo, started) {
  const t0 = (Date.parse(started) || 0) - 5000, posts = [], runTimes = [];
  let total = 0, done = 0, next = null;
  for (const it of Array.isArray(redo?.items) ? redo.items : []) {
    let d; try { d = findDraft(it.id); } catch { continue; }
    const files = draftImages(d.draft), list = (it.images || []).filter((n) => files[n - 1]);
    const times = list.map((n) => mtime(path.join(d.dir, files[n - 1])));
    const ok = times.filter((t) => t && t >= t0);
    runTimes.push(...ok);
    total += list.length; done += ok.length;
    const miss = list.find((n, i) => !(times[i] && times[i] >= t0));
    if (!next && miss) next = { id: it.id, n: miss };
    posts.push({ id: it.id, brand: d.draft.brand, images: ok.length, total: list.length, caption: true, state: ok.length >= list.length ? 'done' : ok.length ? 'partial' : 'todo' });
  }
  runTimes.sort((a, b) => a - b);
  return { posts, next, imagesTotal: total, imagesDone: done, imagesRun: runTimes.length, drafts: posts.length };
}

const ENGINE_FLAG = { antigravity: ' --engine antigravity', flow: '' };
// The BROWSER line of a Flow run (the same wording the Run tab puts in OPTIONS for a Create run with Flow).
export function browserLine(info = {}) {
  if (info.mode !== 'own') return 'BROWSER: the person\'s everyday Chrome through the Playwright extension (see the RUN-NOW NOTE above)' + (info.flow_account ? `; for Google Flow use ONLY the already logged-in Google account ${info.flow_account} (docs/flow-images.md "Google account")` : '') + '.';
  return `BROWSER: the tool's OWN already logged-in browser, no Connect step, nothing to wait for: the Playwright MCP of THIS session must be started with --browser chrome --user-data-dir ${info.profile_dir || '<tool>/workspace/browser-profile'}${info.headless === false ? '' : ' --headless'} ${info.flow_account ? ` For Google Flow use ONLY the already logged-in Google account ${info.flow_account} (docs/flow-images.md "Google account"); ` : ''}(a login wall or checkpoint: stop and report, the person re-opens Browser > Open browser to log in)`;
}

// The prompt of ONE redo run. items = pendingRedos(); engine = flow | antigravity; agent = claude | antigravity; browser = browserInfo() (Flow only).
export function redoPrompt({ items, engine, agent = 'claude', browser = {}, brands = discoverBrands().brands }) {
  if (!['flow', 'antigravity'].includes(engine)) throw new Error('Tạo lại cần Images = Flow hoặc Antigravity (Run tab > Images); Codex không tạo lại từng ảnh.');
  if (!items.length) throw new Error('Không có ảnh nào chờ tạo lại.');
  const ids = [...new Set(items.map((x) => x.brand))].sort();
  const skills = ids.map((id) => brands.find((b) => b.id === id)).filter(Boolean).map(skillLine);
  const nImg = items.reduce((a, x) => a + x.images.length, 0);
  const who = agent === 'antigravity' ? 'Antigravity' : 'Claude Code';
  const flag = ENGINE_FLAG[engine];
  const name = (n) => (n === 1 ? '1 (cover)' : String(n));
  const rows = items.map((x) => {
    const per = Object.entries(x.notes || {}).map(([n, t]) => `image ${n}: "${t}"`);
    return `- ${x.id} · ${x.whole ? `ALL ${x.count} images (whole post)` : `image ${x.images.map(name).join(', ')}`} of ${x.count}${x.note ? ` · note: "${x.note}"` : ''}${per.length ? ` · ${per.join('; ')}` : ''}`;
  });
  let images = imagesText(engine);
  if (engine === 'flow' && agent === 'antigravity') images += '\n  REGISTER: Flow is driven by Antigravity: add --engine antigravity-flow to every register-image command.';
  return [
    `TASK: Redo ${nImg} image(s) of ${items.length} existing draft(s) — brand: ${ids.join(', ')} — agent: ${who}. NO new posts, no pipeline.mjs create / publish, and NO Metricool at all (no Metricool MCP tools, no publish.json, no createScheduledPost, no Metricool drafts).`,
    'WHY: the person reviewed these drafts in the app (Posts > Preview > Tạo lại) and asked for exactly these images to be made again. The note (the person\'s words, often Vietnamese) says what was wrong or what to change; follow it within the skill rules.',
    'REDO (draft · images · note):',
    ...rows,
    `DRAFTS: folder ${path.join(workspace, 'drafts', '<brand>', '<draft id>')}. Keep each draft's idea, scene, product, album type and image count.`,
    `TOOL: ${toolRoot}`,
    ...(engine === 'flow' ? [browserLine(browser)] : []),
    ...skills,
    images,
    'NOTE ON THE IMAGES LINES: they describe a normal Create run. Here there is no pipeline: ignore every "pipeline.mjs create --resume" and "waiting for ... images" part. flow-queue does NOT list these images (their old files still exist): take them from the REDO list above.',
    'STEPS:',
    `1. cd ${toolRoot}; read AGENTS.md, RUNBOOK.md "Rules for every run" and 2.3a (sign mode checklist)${engine === 'flow' ? ', docs/flow-images.md, docs/flow-ui-notes.md, workspace/flow-ui-lessons.md' : ''}; read what the SKILL line(s) name (only these brands).`,
    '2. Per draft: read draft.json and brief.md, LOOK at the current images to redo and read the note. Keep the sign wording (draft.json sign_text) unless the note asks for other wording or it breaks the skill\'s sign rules; to change it: node scripts/draft.mjs reprompt --id <draft> --sign-text "<wording>" (a [CAUSE:..] error = fix that step), then node scripts/draft.mjs check-prompt --id <draft>. If the COVER\'s wording changes, the other images of that post must show the same wording: redo them too.',
    `3. Make ONLY the listed images again, a cover before its extras: node scripts/draft.mjs flow-brief --id <draft> --n <k>${flag} prints the prompt, reference and register command of each one; add the note as a short English change to that prompt (never against the skill rules). The IMAGES rules above apply (pacing, gate, stop rules). register-image keeps the old file aside by itself. LOOK at each picture; run sign-check / size-check when draft.mjs asks; at most one redo for a wrong sign.`,
    '4. Captions: ONLY when the cover\'s wording changed, rewrite that draft\'s captions (the files named in draft.json captions, per the skill) so they match; otherwise do not touch them. Then node scripts/draft.mjs check --id <draft> until it passes (status ready), then node scripts/draft.mjs redo-done --id <draft>. Never approve.',
    '5. Report in Vietnamese: per draft the images redone, the sign wording, the check result; anything skipped and why.',
    'STATUS LINES: one short Vietnamese sentence per step, post and image first (e.g. "Bài signlurex-20261122-01 ảnh 2: ảnh đạt, chữ Lily"). No English, no CLI names.',
    'NEVER: Metricool tools, approve posts, pipeline.mjs, write into a skill or brand folder, put logos on products, add AI labels, use a placeholder or the reference wording, touch drafts or images that are not in the REDO list (except the cover-wording rule of step 2).',
  ].join('\n');
}
