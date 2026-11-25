// One-command Create & publish (RUNBOOK Mode 2, fast path): runs every deterministic step in order and STOPS only where
// the agent's judgement is needed, printing exactly what to do. The checks are the same as step by step (it calls the
// same scripts); only the agent's round trips are fewer: all ideas in one file, all captions in one file, every new
// image in one contact sheet. Metricool MCP calls stay with the agent (the payload items and record commands are printed).
//
//   node scripts/pipeline.mjs mcp-plan [--brand <id|all>]
//        the Metricool MCP calls to make first (getBrandSettings, getBestTimeToPostByNetwork per brand, exact args)
//   node scripts/pipeline.mjs create --brand <id|all> [--count N | --items S0008,S0012] [--agent "Claude Code"] [--image-engine codex|flow|antigravity] [--images N|min-max] [--album angle|scene|random]
//        --items: ideas from exactly these library items (passed to ideas.mjs init; one brand); only their ideas go in the
//        ideas file. A reused item comes with _context.previous_uses + reuse_rule (take a new angle).
//        [--brand-settings <file> --best-times-dir <dir>]   (the saved MCP answers: sync-brands / sync-times run here)
//        Stage A: brands --run create, sync, payload + status per brand, ideas init -> ideas file
//        STOP (i): fill the ideas file (every brand, one pass), then:
//   node scripts/pipeline.mjs create --resume --ideas <file>
//        Stage B: ideas set/pick, draft new, product description into prompt.txt, image-batch in the background
//        (send the payload items to Metricool meanwhile), then:
//   node scripts/pipeline.mjs create --resume
//        Stage C: waits for the images, makes the contact sheet(s) + captions file
//        STOP (ii): LOOK at the sheet(s); write every caption in one file (or "redo" a bad image), then:
//   node scripts/pipeline.mjs create --resume --captions <file>
//        Stage D: redo images (back to C), write captions, clean, watermark when on, draft check; all ready ->
//        queue + runlog (finish). Not ready -> fix those entries and send the captions file again.
//   node scripts/pipeline.mjs status          where the run is and what to do next
//   node scripts/pipeline.mjs publish --brand <id|all> [--limit N] [--window w] [--start today] [--brand-settings f --best-times-dir d]
//        Mode 3: brands --run publish, sync, payload (computed now, right before sending) + status; the agent sends;
//        then: node scripts/pipeline.mjs publish --resume (queue + run log)
//
// State: workspace/pipeline/create.json (one Create run at a time). Files for the agent: workspace/pipeline/
// ideas-todo.json, captions-todo.json, contact-sheet-<n>.png, publish.json, image-batch.json.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isoWithOffset } from './metricool-mcp.mjs';
import { nowIn, publishStock } from './metricool-csv.mjs';
import { main, out, parseArgs, workspace, readJson, writeJson, stamp, settings, imageEngine, loadBrand, findDraft, cleanText, metricoolBrands, isMain } from './lib.mjs';
import { previousUses } from './store.mjs';
import { REUSE_RULE } from './ideas.mjs';
import { requireSignRules, ideaSignProblems, hasSignContext, signRules, placeholderOf, draftSignMode, cause, WORKFLOW_VERSION, perImageSigns } from './signtext.mjs';

// Shown at the top of the ideas todo for brands with a sign mode (scene | placeholder) (rules: the brand skill's "Sign wording rules"; checkpoints: signtext.mjs).
const SIGN_CHECKLIST = [
  'ORDER (brands with _context.sign_mode). Each step has a checkpoint that fails with [CAUSE:..] when an earlier step was skipped:',
  '1. IDEA + AUDIENCE: fill the idea fields and "audience" (who this post is for).',
  '2. SCENE TYPE: "scene_type" = one key of the skill table (_context.scene_types; placeholder mode: the product handle); the scene must fit that row (the sign type / product decides the scene).',
  '3. SIGN WORDING. sign_mode scene: "sign_text" = NEW English wording fitting this scene + audience, "text_reason" = why; "ref_text" = what the reference sign reads. sign_mode placeholder: "sign_text" = the row placeholder exactly (_context.placeholders; leave it empty and the tool fills it; " / " = line break; "" = no lettering), no text_reason. Checkpoint: node scripts/ideas.mjs check --brand <id> --id <I...> ([CAUSE:missing-audience|missing-scene-type|scene-mismatch|missing-sign-text|missing-text-reason|sign-not-english|sign-copied-from-reference|sign-name-from-reference|sign-repeats-recent|missing-ref-text|description-has-ref-text|sign-not-placeholder]).',
  '4. IMAGE PROMPT carries the wording exactly (the tool builds it from sign_text). Checkpoint: draft.mjs check-prompt --id <draft> ([CAUSE:prompt-missing-sign-text]; also run by flow-brief and register-image).',
  '5. IMAGE, then LOOK at it and run: draft.mjs sign-check --id <draft> --reads "<the words seen on the sign>" (custom-text SCENE album: each extra image has its OWN wording from album_signs: add --reads-02 ".." --reads-03 "..") ([CAUSE:image-text-mismatch|image-not-checked]).',
  '6. CAPTION written from the idea + audience, never from the image; scene mode: it quotes sign_text exactly; placeholder mode: never quotes the placeholder as a customer name ([CAUSE:caption-before-image-check] when step 5 was skipped).',
  '7. CHECK: draft.mjs check (pipeline does it).',
  'NEVER: copy or lightly edit the reference wording, its names, foreign-language text or numbers; use a real or customer name; repeat the wording of the last 10 posts (scene mode); pick the wording before the scene; write the caption from the image; skip a checkpoint or work around a [CAUSE:..] error (fix the earlier step).',
];
import { draftImages, parseImagesOpt, parseAlbumOpt, albumModeOf, albumSceneOf, extraShotOf } from './draft-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const pipeDir = () => path.join(workspace, 'pipeline');
const stateFile = () => path.join(pipeDir(), 'create.json');
const IDEA_FIELDS = ['product_type', 'scene', 'angle', 'props', 'caption_structure', 'hook', 'why'];
const IMAGE = /\.(png|jpe?g|webp)$/i;

// One step script, its JSON answer (every script prints one JSON object).
export function step(script, args, { env = {} } = {}) {
  const r = spawnSync(process.execPath, [path.join(here, script), ...args], { encoding: 'utf8', windowsHide: true, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
  try { return JSON.parse(r.stdout); } catch { return { ok: false, error: `${script} ${args.join(' ')}: ${(r.stdout + r.stderr).trim().slice(0, 600)}` }; }
}
const rel = (f) => path.relative(process.cwd(), f) || f;
const readState = () => readJson(stateFile(), null);
const saveState = (st) => { st.updated = stamp(); writeJson(stateFile(), st); return st; };

// ----- mcp-plan -----
export function mcpPlan(brandArg = 'all') {
  const usable = step('brands.mjs', []).usable || [];
  const scope = brandArg === 'all' ? usable : usable.filter((x) => x === brandArg);
  const list = metricoolBrands().brands || [];
  const calls = [{ tool: 'getBrandSettings', args: {}, save_to: 'workspace/tmp/brand-settings.json' }];
  for (const id of scope) {
    const m = list.find((b) => !b.removed && (b.skill_id === id || path.basename(String(b.skill_path || '')).replace(/-skills$/, '') === id));
    if (!m) { calls.push({ brand: id, note: 'no Metricool brand linked: skipped' }); continue; }
    const tz = m.timezone || 'America/New_York';
    // tomorrow 00:00 .. the 7th day from tomorrow 23:59, in the brand's Metricool timezone (RUNBOOK 2.0)
    const today = nowIn(tz).date, plus = (n) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    const from = plus(1), to = plus(7);
    calls.push({ brand: id, tool: 'getBestTimeToPostByNetwork', args: { brandId: m.blog_id, socialNetwork: 'facebook', timezone: tz, fromDate: isoWithOffset(from, '00:00', tz), toDate: isoWithOffset(to, '23:59', tz) }, save_to: `workspace/tmp/best-times-${id}.json` });
  }
  return { brands: scope, calls, next: `Make these MCP calls (in parallel), save each answer as given, then: node scripts/pipeline.mjs create --brand ${brandArg} --brand-settings workspace/tmp/brand-settings.json --best-times-dir workspace/tmp` };
}

// 2.0 sync (from the agent's saved MCP answers), 2.1 payload + 2.2 status per brand -> workspace/pipeline/publish.json.
// payload runs here, right before the agent sends (times are computed as late as possible).
function syncAndPayload(args, scope, notes, errors, payloadFlags = []) {
  // 2.0 sync (the agent's saved MCP answers)
  const sync = { brands: null, times: {} };
  if (args['brand-settings'] && args['brand-settings'] !== true) {
    const r = step('metricool-mcp.mjs', ['sync-brands', '--from', String(args['brand-settings'])]);
    sync.brands = r.ok === false ? { error: r.error } : { added: r.added || [], removed: r.removed || [] };
    if (r.ok === false) errors.push(`sync-brands: ${r.error}`);
    const dir = args['best-times-dir'] && args['best-times-dir'] !== true ? String(args['best-times-dir']) : path.dirname(String(args['brand-settings']));
    for (const id of scope) {
      const f = path.join(dir, `best-times-${id}.json`);
      if (!fs.existsSync(f)) { sync.times[id] = 'no file: research table used'; continue; }
      const x = step('metricool-mcp.mjs', ['sync-times', '--brand', id, '--from', f]);
      sync.times[id] = x.ok === false ? `error: ${x.error}` : 'synced';
    }
  } else notes.push('Metricool not synced this run (no --brand-settings): run pipeline.mjs mcp-plan first when the agent has the Metricool MCP.');
  // 2.1 payload + 2.2 status per brand
  const publish = { generated_at: new Date().toISOString(), note: 'Valid ONLY for the run that just wrote it. Never reuse this file in a later run: re-run pipeline.mjs create; run each item\'s precheck right before sending.', brands: {} };
  for (const id of scope) {
    const p = step('metricool-mcp.mjs', ['payload', '--brand', id, ...(typeof payloadFlags === 'function' ? payloadFlags(id) : payloadFlags)]);
    const s = step('metricool-mcp.mjs', ['status', '--brand', id]);
    // Hosted links are checked (read-only) before anything is sent: a post whose link is dead or differs from its file is
    // blocked with the reason instead of going to Metricool; the app then offers Gửi lại ảnh.
    const hostBlocked = [];
    if (p.ok !== false && (p.items || []).length) {
      const hc = step('host-image.mjs', ['check', '--brand', id, '--posts', p.items.map((i) => i.post).join(',')]);
      if (hc.ok === false) notes.push(id + ': kiểm link ảnh không chạy được (' + String(hc.error).slice(0, 200) + '); bài vẫn đi theo link đã lưu.');
      else for (const r of hc.results || []) if (!r.ok) hostBlocked.push(r.post + ': ảnh chưa lên repo / link hỏng (' + r.problems.join('; ') + '); mở tab Posts, Kiểm tra ảnh, Gửi lại ảnh.');
      if (hostBlocked.length) p.items = p.items.filter((i) => !(hc.results || []).some((r) => !r.ok && r.post === i.post));
    }
    publish.brands[id] = {
      items: p.ok === false ? [] : (p.items || []).map(({ post, time_source, send_before, tool, args: a, precheck, record }) => ({ post, time_source, send_before, tool, args: a, precheck, record })),
      blocked: [...(p.ok === false ? [p.error] : p.blocked || []), ...hostBlocked],
      status_query: s.ok === false ? null : s.query || null, ignore_ids: s.ignore_ids || [],
    };
    if (s.ok === false) errors.push(`${id} status: ${s.error}`);
  }
  writeJson(path.join(pipeDir(), 'publish.json'), publish);
  return { sync, publish };
}

// ----- Stage A -----
function productFolders(b) {
  const dirs = [];
  for (const x of [].concat(b.social.product_images?.sources || [])) if (x?.path && !/^https?:/i.test(x.path)) dirs.push(path.resolve(b.dir, x.path));
  for (const d of ['project/sources/assets/products', 'project/sources/products', 'project/sources/assets']) if (fs.existsSync(path.join(b.dir, d))) dirs.push(path.join(b.dir, d));
  return [...new Set(dirs)].filter((d) => fs.existsSync(d));
}
function someImages(dir, max = 40) {
  const found = [];
  const walk = (d, depth) => {
    if (found.length >= max || depth > 3) return;
    let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) { if (found.length >= max) return; const f = path.join(d, e.name); if (e.isDirectory()) walk(f, depth + 1); else if (IMAGE.test(e.name)) found.push(f); }
  };
  walk(dir, 0);
  return found;
}

function stageA(args) {
  const started = stamp();
  const engineArg = args['image-engine'] && args['image-engine'] !== true ? String(args['image-engine']) : '';
  if (engineArg && !['codex', 'flow', 'antigravity'].includes(engineArg)) throw new Error('--image-engine must be codex, flow or antigravity.');
  const imagesArg = args.images === undefined || args.images === true || args.images === '' ? '' : String(args.images);
  if (imagesArg && !parseImagesOpt(imagesArg)) throw new Error('--images must be N or min-max within 1..4 (e.g. 2 or 1-3); omit it for the default range.');
  const albumArg = parseAlbumOpt(args.album);
  if (albumArg === null) throw new Error('--album must be angle, scene or random; omit it for the Settings default (posts.album_mode).');
  const brandArg = String(args.brand && args.brand !== true ? args.brand : 'all');
  const agent = String(args.agent && args.agent !== true ? args.agent : 'Claude Code');
  const pickIds = args.items && args.items !== true ? String(args.items).split(',').map((x) => x.trim()).filter(Boolean) : [];
  if (pickIds.length && brandArg === 'all') throw new Error('--items needs one brand (--brand <id>): library item ids belong to one brand.');
  const t0 = Date.now(), timing = {};
  const lap = (k, t) => { timing[k] = Date.now() - t; };
  let t = Date.now();
  const br = step('brands.mjs', ['--run', 'create']);
  if (br.ok === false) throw new Error(br.error);
  const scope = brandArg === 'all' ? br.usable : br.usable.filter((x) => x === brandArg);
  if (!scope.length) throw new Error(brandArg === 'all' ? 'No usable brand.' : `Brand "${brandArg}" is not usable: ${(br.brands.find((b) => b.id === brandArg)?.problems || ['unknown brand']).join('; ')}`);
  lap('brands', t);
  const notes = [], errors = [], needsResearch = [];
  t = Date.now();
  const { sync, publish } = syncAndPayload(args, scope, notes, errors);
  lap('sync_payload_status', t);
  // 2.3 ideas init per brand -> one ideas file for every brand
  t = Date.now();
  const todo = { ...(scope.some((x) => { try { return hasSignContext(loadBrand(x)); } catch { return false; } }) ? { checklist: SIGN_CHECKLIST } : {}), how: 'Fill every entry (one pass, all brands). Per idea EITHER "reject": "<reason>" OR: idea fields (abstract, prompts/idea-abstract.md: no copied words, phone, link or shop name), product (the brand\'s own photo, from _context.product_folders), size (real size, cm + in, from _context.size_source), compare (the comparison object in the scene with ITS real size, e.g. "the 4-seat wooden table below, 120 cm (47 in) wide"; the product stays at most 60% of it unless the brand sets other size_limits), audience + scene_type + sign_text + text_reason (when _context.sign_mode: follow the checklist and _context.sign_rules; sign_mode scene: the wording is NEW English that fits scene + audience, never taken from the reference, never a placeholder; sign_mode placeholder: scene_type = the product handle, sign_text = the placeholder of that row, exactly, from _context.placeholders (empty = the tool fills it), no text_reason), description (the exact product: every letter and accent of its text (brands with _context.sign_mode: NOT the words, describe the lettering style only; the words come from sign_text), font, colours, material, proportions). Albums (a post with 2+ images gets album_mode angle|scene when the draft is made): for an expected SCENE album you may add "album_scenes": [one scene line per extra image] (each a believable setting for this exact product per the brand project.md section 10 table, different from the cover scene and from each other, never a forbidden one; props in the same line); omit it to choose them at Stage C. For a sign_mode scene brand ALSO add "album_signs": [one NEW English sign wording per extra image, in the same order as album_scenes], each fitting ITS scene (never the cover wording, the reference wording or each other); the cover keeps sign_text and the caption quotes only sign_text. A reused library item (_context.previous_uses): a NEW angle, a different scene (new-scene) OR a different sign_text (keep-scene) than every previous use; the same scene + sign_text + product is rejected. Reference-based post / scene-swap (only when _context.reference_redraw): "scene_swap": true + "brand_can_produce": true instead of product (the PRODUCT always comes from the reference photo; every foreign logo, shop name, watermark, phone, price is removed); LOOK at _context.ref_image and set "ref_has_face" (true when any human face / identifiable person shows) and "ref_mode": no face -> "keep-scene" (the scene/background/framing stay; sign_text = NEW wording per _context.sign_rules (sign_mode placeholder: the row placeholder instead; never the reference wording, names or foreign-language text; no placeholder, no third-party brand, no real customer name); "ref_text" = what the reference reads exactly; compare not needed), face -> "new-scene" (a new real-life scene, every person removed; the product text stays as is ONLY when there is no _context.sign_mode; sign_mode scene: the wording is NEW too (sign_text + ref_text + the rest of the checklist); sign_mode placeholder: the reference wording is replaced by the row placeholder; compare + proportion rules apply). Delete nothing else. Then: node scripts/pipeline.mjs create --resume --ideas workspace/pipeline/ideas-todo.json', brands: {}, ideas: [] };
  for (const id of scope) {
    let signRulesOf = null;
    try { signRulesOf = requireSignRules(loadBrand(id)); } catch (e) { errors.push(e.message); continue; } // a sign mode set but the skill has no fitting sign wording rules: stop here
    if (!signRulesOf) { try { if (!signRules(loadBrand(id))?.rows.length) notes.push(`${id}: no "### Sign wording rules" block (project.md section 10): ideas run without the product <-> scene context (audience, scene_type, [image] rules). Add the block to the brand skill.`); } catch {} }
    const r = step('ideas.mjs', ['init', '--brand', id, ...(args.restart ? ['--reset'] : []), ...(pickIds.length ? ['--items', pickIds.join(',')] : args.count && args.count !== true ? ['--count', String(args.count)] : [])]);
    for (const n of r.notes || []) notes.push(`${id}: ${n}`);
    if (r.ok === false) { if (/trống/.test(r.error || '')) { needsResearch.push(id); errors.push(`${id}: stop: needs research (Library is empty): run Research for ${id} first, then Create again.`); } else errors.push(`${id} ideas: ${r.error}`); continue; }
    if (r.warning) notes.push(`${id}: ${r.warning}`);
    if (!pickIds.length && !(r.items || []).length && r.store_ready_left === 0 && !readJson(path.join(workspace, 'store', id, 'ideas.json'), { ideas: [] }).ideas.some((i) => ['todo', 'ready'].includes(i.status))) { needsResearch.push(id); errors.push(`${id}: stop: needs research (Library has 0 available items): run Research for ${id} first (RUNBOOK 1.x), then Create again.`); continue; }
    const b = loadBrand(id);
    const ideas = readJson(path.join(workspace, 'store', id, 'ideas.json'), { ideas: [] }).ideas.filter((i) => ['todo', 'ready'].includes(i.status) && (!pickIds.length || pickIds.includes(i.item)));
    const items = readJson(path.join(workspace, 'store', id, 'items.json'), { items: [] }).items;
    const folders = productFolders(b);
    todo.brands[id] = { skill: b.dir, skill_root: b.skillRoot || b.dir, skill_md: path.join(b.skillRoot || b.dir, 'SKILL.md'), project_md: path.join(b.dir, 'project', 'project.md'), image_guide: path.join(b.skillRoot || b.dir, 'references', 'image-guide.md'), size_source: b.social.product_images?.size_source || 'project.md section 5/10', custom_text: signRulesOf?.mode === 'scene', sign_mode: signRulesOf?.mode || 'none', reference_redraw: b.social.product_images?.reference_redraw?.enabled === true, product_folders: folders, product_images: folders.flatMap((d) => someImages(d, 30)).slice(0, 60) };
    for (const i of ideas) {
      const it = items.find((x) => x.id === i.item) || {};
      const prev = previousUses(it);
      todo.ideas.push({ brand: id, id: i.id, _context: { item: i.item, ref_image: i.ref_image, reference_caption: String(it.caption || '').slice(0, 400), source: i.source, ...(prev.length ? { previous_uses: prev, reuse_rule: REUSE_RULE } : {}), ...(todo.brands[id].reference_redraw ? { reference_redraw: true } : {}), ...(signRulesOf ? { sign_mode: signRulesOf.mode, custom_text: signRulesOf.mode === 'scene', sign_rules: signRulesOf.text, scene_types: signRulesOf.rows.map((x) => x.key), ...(signRulesOf.mode === 'placeholder' ? { placeholders: Object.fromEntries(signRulesOf.rows.map((x) => [x.key, x.sign_text])) } : {}) } : {}) }, idea: Object.fromEntries(IDEA_FIELDS.map((f) => [f, i[f] || ''])), product: '', size: i.product_size || '', compare: i.size_compare || '', sign_text: i.sign_text || '', description: '', reject: '', ...(todo.brands[id].reference_redraw ? { scene_swap: false, brand_can_produce: false, ref_has_face: i.ref_has_face ?? null, ref_mode: i.ref_mode || '', ref_text: i.ref_text || '' } : {}) });
    }
  }
  const ideasFile = path.join(pipeDir(), 'ideas-todo.json');
  writeJson(ideasFile, todo);
  lap('ideas_init', t);
  const st = saveState({ run_started: started, image_engine_choice: engineArg, images_choice: imagesArg, album_choice: albumArg, agent, brand: brandArg, scope, stage: todo.ideas.length ? 'ideas' : 'captions', ideas_file: ideasFile, requested: args.count && args.count !== true ? Number(args.count) : null, drafts: [], redos: {}, notes, errors, timing: { A: Date.now() - t0, ...timing } });
  const items = Object.values(publish.brands).reduce((n, b) => n + b.items.length, 0);
  return {
    stage: 'A done', stop: todo.ideas.length ? 'ideas' : needsResearch.length ? 'needs research' : 'captions', ...(needsResearch.length ? { needs_research: needsResearch } : {}), brands: scope, sync, publish_file: path.join(pipeDir(), 'publish.json'), publish_items: items,
    status_queries: Object.fromEntries(Object.entries(publish.brands).filter(([, b]) => b.status_query).map(([id, b]) => [id, b.status_query])),
    ideas_file: ideasFile, ideas: todo.ideas.length, notes, errors, timing_ms: st.timing,
    next: [
      items ? `Metricool (now, fast): for each item in ${rel(path.join(pipeDir(), 'publish.json'))}: FIRST its precheck command (it fails with DO NOT SEND when the post is already on Metricool: then skip it, never send), then createScheduledPost with exactly its args (skip an item already past send_before: run metricool-mcp.mjs payload --brand <id> again for it), then run its record command (send each post ONCE: never call createScheduledPost twice for a post, even if a call looked slow or failed; check getScheduledPosts for its text first). After the last send: getScheduledPosts for the brand (a few days per call), save the answer to a file and run node scripts/metricool-mcp.mjs dupes --file <file>; any duplicate group = report the ids to the user and send nothing more.` : 'Metricool: nothing approved to send.',
      'Reconcile: for each status_queries entry call getScheduledPosts with it; PUBLISHED -> posts.mjs mark-published (RUNBOOK 2.2); ERROR -> report.',
      todo.ideas.length ? `STOP (i): fill ${rel(ideasFile)} (all brands, one pass; read each brand's SKILL.md + project.md + image-guide.md first), then: node scripts/pipeline.mjs create --resume --ideas ${rel(ideasFile)}` : 'No new ideas needed: node scripts/pipeline.mjs create --resume (finishes: queue + run log).',
    ],
  };
}

// ----- Flow images (settings image_engine = flow): no Codex run; the agent makes each image in Google Flow (docs/flow-images.md)
// and registers it: draft.mjs register-image --id <draft> --n <k> --from <downloaded file>. -----
const manualImages = (e) => e === 'flow' || e === 'antigravity'; // images made by the agent itself (Flow, or Antigravity's image-generator) and registered with register-image
function flowTodo(st) {
  const todo = [];
  for (const id of st.drafts || []) {
    let d; try { d = findDraft(id); } catch { continue; }
    if (['approved', 'rejected'].includes(d.status.status)) continue;
    const files = draftImages(d.draft), missing = files.filter((f) => !fs.existsSync(path.join(d.dir, f)));
    if (!missing.length) continue;
    // EVERY missing image of the post: image.png (cover, n=1) and the album extras image-02.png.. (n>=2, same scene: image 1 is their reference).
    const am = albumModeOf(d.draft);
    todo.push({ id, brand: d.draft.brand, album_images: files.length, ...(am ? { album_mode: am, album_note: am === 'scene' ? 'SCENE album: the same product in a different scene per extra (pick each scene per the brand table, project.md section 10; never a forbidden scene; write it as draft.album_scenes or on the "NEW SCENE FOR THIS IMAGE:" line of prompt-0N.txt; custom-text brand: each extra ALSO has its OWN new sign wording fitting its scene, draft.mjs reprompt --id <draft> --album-signs "<image 2>|<image 3>|..", and sign-check needs --reads-02 --reads-03 ..)' : 'ANGLE album: the same scene, a different camera shot per extra' } : {}), product_image: d.draft.product_image || '',
      images_to_make: missing.map((f) => { const n = files.indexOf(f) + 1; return { n, file: f, prompt: path.join(d.dir, n === 1 ? 'prompt.txt' : 'prompt-' + String(n).padStart(2, '0') + '.txt'), needs_image1_as_reference: n > 1, ...(n > 1 ? { make: am === 'scene' ? `a different scene: ${albumSceneOf(d.dir, d.draft, n) || '(not chosen yet: pick per the brand table)'}` : `same scene, ${extraShotOf(n - 1)} shot` } : { make: 'cover' }), brief: `node scripts/draft.mjs flow-brief --id ${id} --n ${n}${st.image_engine === 'antigravity' ? ' --engine antigravity' : ''}`, register: `node scripts/draft.mjs register-image --id ${id} --n ${n}${st.image_engine === 'antigravity' ? ' --engine antigravity' : ''} --from <${st.image_engine === 'antigravity' ? 'generated image file' : 'downloaded file'}>` }; }) });
  }
  return todo;
}
const AGY_NEXT = 'Antigravity images (no Flow, no browser, no flow-pace gate; docs/flow-images.md section Antigravity images): for EVERY image listed in flow_images, in order (cover before its extras): node scripts/draft.mjs flow-brief --id <draft> --n <k> --engine antigravity prints the prompt, aspect and image_paths; call invoke_subagent with type_name "image-generator" (only that subagent) giving Prompt, ImagePaths, AspectRatio, ImageName exactly as printed; LOOK at the saved JPG, then run its register command (--engine antigravity --from <that jpg>). Refused or failed image: retry ONCE with --safe, then skip it and report it; never stop the run for one image. Same brand rules as always (sign wording, no logo on the product, scene-fitting text). Then node scripts/pipeline.mjs create --resume.';
const nextFor = (st) => (st.image_engine === 'antigravity' ? AGY_NEXT : FLOW_NEXT);
const FLOW_NEXT = 'Google Flow (docs/flow-images.md; Flow project is set up ONCE and reused (node scripts/flow-pace.mjs project get | project set --url <url>; group posts by ratio). READ docs/flow-ui-notes.md and workspace/flow-ui-lessons.md BEFORE opening Flow and follow them; when you find a faster or more reliable way, or a pitfall that cost you more than 3 steps, APPEND one short line to workspace/flow-ui-lessons.md (UI element as shown + what to do; no personal data; no duplicates; create the file with a one-line header if missing).), WORK LIKE A PERSON: one Flow project per run, post by post, by hand with the browser tools. NEVER write or run a script, loop or batch file that drives Flow for several images (Google locks the profile for automated bursts). Upload the reference images of ONE item right before the prompt of that item; never pre-upload the references of several items in bulk. Per image run flow-brief (condensed prompt + ratio + reference copied to Downloads). BEFORE EVERY prompt you submit run: node scripts/flow-pace.mjs gate --tag <draft>#<n> (it waits a random human-like time and makes groups of 2-3; never skip it). For each post: the cover, wait for it, then that post\'s extras n>=2 (attach its image 1 via "+" > thumbnail > "Thêm vào câu lệnh"), wait, download each result (1K), LOOK at it, register it with its register command, then the next post. One image refused by Flow (policy): retry THAT image ONCE with flow-brief --safe; refused again -> skip it, go on; never stop the run for it. Then: node scripts/pipeline.mjs create --resume.';

// ----- Stage B -----
function spawnImages(st, ids) {
  const outFile = path.join(pipeDir(), 'image-batch.json');
  fs.rmSync(outFile, { force: true });
  const fd = fs.openSync(outFile, 'w');
  const brandArg = st.scope.length === 1 ? st.scope[0] : 'all';
  const p = spawn(process.execPath, [path.join(here, 'draft.mjs'), 'image-batch', '--brand', brandArg], { detached: true, stdio: ['ignore', fd, 'ignore'], windowsHide: true, env: process.env });
  p.unref();
  fs.closeSync(fd);
  st.batch = { pid: p.pid, out: outFile, started: stamp(), drafts: ids };
}
// The same product description goes into prompt.txt and every album extra prompt (prompt-02.txt, ...).
const fillDescription = (dir, text) => {
  let filled = false;
  for (const name of fs.readdirSync(dir).filter((x) => /^prompt(-\d+)?\.txt$/.test(x))) {
    const f = path.join(dir, name), p = fs.readFileSync(f, 'utf8');
    if (!p.includes('{{PRODUCT_DESCRIPTION}}')) continue;
    fs.writeFileSync(f, p.replace('{{PRODUCT_DESCRIPTION}}', () => text), 'utf8');
    if (name === 'prompt.txt') filled = true;
  }
  return filled;
};

function stageB(st, file) {
  const t0 = Date.now();
  const data = readJson(path.resolve(file));
  const made = [], rejected = [], problems = [];
  for (const e of data.ideas || []) {
    const tag = `${e.brand} ${e.id}`;
    if (e.reject) { const r = step('ideas.mjs', ['reject', '--brand', e.brand, '--id', e.id, '--note', String(e.reject)]); r.ok === false ? problems.push(`${tag}: ${r.error}`) : rejected.push(tag); continue; }
    const swap = e.scene_swap === true;
    // The idea fields belong in e.idea; an agent that wrote audience / scene_type / scene / text_reason at the top level of the entry
    // is accepted too (copied into e.idea when e.idea has no value for them). album_scenes / album_signs stay top level as documented.
    e.idea ||= {};
    for (const k of ['audience', 'scene_type', 'scene', 'text_reason', 'angle', 'props']) if (e[k] !== undefined && (e.idea[k] === undefined || e.idea[k] === '')) e.idea[k] = e[k];
    // Steps 1-3 (audience, scene_type fits the scene, the wording per sign mode): an idea of a brand with a sign mode cannot skip them.
    const bObj = loadBrand(e.brand, { allowDisabled: true }), rulesB = requireSignRules(bObj), custom = rulesB?.mode === 'scene';
    if (rulesB?.mode === 'placeholder' && !String(e.sign_text || e.idea?.sign_text || '').trim()) e.sign_text = placeholderOf(bObj, e.idea?.scene_type) || '';
    if (rulesB) {
      const sp = ideaSignProblems(bObj, { ...e.idea, sign_text: String(e.sign_text || e.idea?.sign_text || ''), ref_text: String(e.ref_text || ''), ref_mode: swap ? String(e.ref_mode || '') : '', description: String(e.description || '') }, { exceptIdea: e.id });
      if (sp.length) { problems.push(`${tag}: ${sp.join(' | ')}`); continue; }
    }
    const miss = [...(swap ? [] : ['product']), 'size', 'description'].filter((k) => !String(e[k] || '').trim());
    if (swap && e.brand_can_produce !== true) { problems.push(`${tag}: scene_swap needs "brand_can_produce": true (the brand makes this exact product, project.md section 5)`); continue; }
    // The agent looked at the reference: a face -> new-scene, none -> keep-scene (new sign_text + ref_text required).
    const refMode = swap ? String(e.ref_mode || '').trim() : '';
    if (swap) {
      const rp = [];
      if (typeof e.ref_has_face !== 'boolean') rp.push('"ref_has_face": true|false (LOOK at the reference: any human face?)');
      if (!['keep-scene', 'new-scene'].includes(refMode)) rp.push('"ref_mode": "keep-scene" (no face) or "new-scene" (face)');
      else if (typeof e.ref_has_face === 'boolean' && e.ref_has_face !== (refMode === 'new-scene')) rp.push(`ref_has_face ${e.ref_has_face} does not fit ref_mode ${refMode} (face -> new-scene, no face -> keep-scene)`);
      if ((refMode === 'keep-scene' || custom) && !String(e.ref_text || '').trim()) rp.push(`${refMode} needs "ref_text" (what the reference reads; "unreadable" when it cannot be read)`);
      if ((refMode === 'keep-scene' || custom) && !String(e.sign_text || '').trim()) rp.push(`${refMode} needs "sign_text" (the NEW English wording)`);
      if (rp.length) { problems.push(`${tag}: ${rp.join('; ')}`); continue; }
    }
    if (miss.length) { problems.push(`${tag}: missing ${miss.join(', ')}`); continue; }
    const ideaFile = path.join(pipeDir(), `idea-${e.brand}-${e.id}.json`);
    writeJson(ideaFile, { ...e.idea, product_size: e.size, ...(e.compare ? { size_compare: e.compare } : {}), ...(e.sign_text ? { sign_text: e.sign_text } : {}), ...(swap ? { ref_has_face: e.ref_has_face, ref_mode: refMode, ...(e.ref_text ? { ref_text: e.ref_text } : {}) } : {}) });
    const s = step('ideas.mjs', ['set', '--brand', e.brand, '--id', e.id, '--file', ideaFile]);
    fs.rmSync(ideaFile, { force: true });
    if (s.ok === false || (s.problems || []).length || (s.missing || []).length) { problems.push(`${tag}: ${s.error || [...(s.missing || []).map((m) => 'missing ' + m), ...(s.problems || [])].join('; ')}`); continue; }
    const p = step('ideas.mjs', ['pick', '--brand', e.brand, '--id', e.id]);
    if (p.ok === false) { problems.push(`${tag}: ${p.error}`); continue; }
    const refImage = swap ? String(e.ref_image || e._context?.ref_image || '') : '';
    const n = step('draft.mjs', ['new', '--brand', e.brand, '--idea', e.id, ...(swap ? ['--ref-image', refImage, '--brand-can-produce', '--ref-mode', refMode, '--ref-has-face', String(e.ref_has_face), ...(e.ref_text ? ['--ref-text', String(e.ref_text)] : [])] : ['--product', String(e.product)]), '--size', String(e.size), ...(e.compare ? ['--compare', String(e.compare)] : []), ...(e.sign_text ? ['--sign-text', String(e.sign_text)] : []), ...(e.scene_image ? ['--scene', String(e.scene_image)] : []), ...(st.images_choice ? ['--images', String(st.images_choice)] : []), ...(st.album_choice ? ['--album', String(st.album_choice)] : []), ...(Array.isArray(e.album_scenes) && e.album_scenes.length ? ['--album-scenes', e.album_scenes.map((x) => String(x).replace(/\|/g, ' ')).join('|')] : []), ...(Array.isArray(e.album_signs) && e.album_signs.length ? ['--album-signs', e.album_signs.map((x) => String(x).replace(/\|/g, ' ')).join('|')] : [])]);
    if (n.ok === false) { problems.push(`${tag}: ${n.error}`); continue; }
    fillDescription(n.dir, cleanText(String(e.description)).text);
    made.push(n.id);
  }
  st.drafts = [...new Set([...(st.drafts || []), ...made])];
  st.image_engine = st.image_engine_choice || imageEngine(settings()); // --image-engine of this run, else the Settings default
  if (st.drafts.length && !manualImages(st.image_engine)) spawnImages(st, made);
  st.stage = st.drafts.length ? 'images' : problems.length ? 'ideas' : 'captions';
  st.timing = { ...st.timing, B: Date.now() - t0 };
  saveState(st);
  return {
    stage: 'B done', drafts: made, rejected, problems, images: st.image_engine === 'antigravity' ? 'antigravity: made by the agent with its image-generator subagent' : st.image_engine === 'flow' ? 'flow: made by the agent in Google Flow' : st.batch ? `running in the background (pid ${st.batch.pid}), at most codex.concurrency at once` : 'none',
    ...(manualImages(st.image_engine) ? { flow_images: flowTodo(st) } : {}),
    next: problems.length && !made.length
      ? `Fix these entries in the ideas file and send it again: node scripts/pipeline.mjs create --resume --ideas ${rel(path.resolve(file))}`
      : manualImages(st.image_engine) ? [nextFor(st), `Metricool steps (publish.json items + status queries) if not done yet.${problems.length ? ' Some ideas failed (problems): fix them and send the ideas file again later.' : ''}`]
      : [`Images are being made. Meanwhile do the Metricool steps (publish.json items + status queries) if not done yet.${problems.length ? ' Some ideas failed (problems): fix them and send the ideas file again later.' : ''}`, 'Then: node scripts/pipeline.mjs create --resume (waits for the images, makes the contact sheet).'],
  };
}

// ----- Stage C -----
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function waitImages(st, maxMs) {
  const until = Date.now() + maxMs;
  const busy = () => st.drafts.some((id) => { try { return findDraft(id).status.status === 'generating'; } catch { return false; } });
  const running = () => (st.batch?.pids || (st.batch ? [st.batch.pid] : [])).some(alive);
  while (running() || busy()) { if (Date.now() > until) return false; sleep(1000); }
  return true;
}
function captionTemplate(st) {
  const tpl = { how: 'LOOK at every contact sheet first. Per draft EITHER the captions (one key per language in langs: the posted ones and the reviewer-only ones; follow brief.md, SKILL.md section A, project.md; mention sign_text exactly (not for _context.sign_mode placeholder: never quote the placeholder as a name); write it from the idea + audience, not from the image; Website line + fixed hashtag; no Markdown, no AI label, no source shop name) plus "size_check": { "product_pct": N, "object_pct": N } measured on the image (product width as % of the image width and of the comparison object; not for ref_mode keep-scene, which keeps the original framing), plus for a draft with a sign mode and sign_text "sign_check": { "reads": "<the words you SEE on the sign>", "by": "<name>" } (step 5: it must equal sign_text; without it the captions are not accepted: [CAUSE:caption-before-image-check]), plus for a scene-swap draft "confirm_clean": { "by": "<name>", "no_people": true|false } once you LOOKED at the image beside _context.reference_image (no shop name, logo, watermark, phone, price left; new-scene: no person left, no_people true; keep-scene: the new sign_text reads exactly), OR "redo": { "description": "...", "size": "...", "compare": "...", "smaller": N, "sign_text": "..." } (only what changes; "smaller": N when the product is too big, N from the size limits; at most 2 redos per draft). Then: node scripts/pipeline.mjs create --resume --captions workspace/pipeline/captions-todo.json', drafts: {} };
  const old = readJson(path.join(pipeDir(), 'captions-todo.json'), { drafts: {} }).drafts || {};
  for (const id of st.drafts) {
    let d; try { d = findDraft(id); } catch { continue; }
    if (['approved', 'rejected', 'ready'].includes(d.status.status)) continue;
    const langs = Object.keys(d.draft.captions || {});
    const prev = old[id]?.captions || {};
    tpl.drafts[id] = { _context: { brand: d.draft.brand, status: d.status.status, error: d.status.error || '', problems: d.status.problems || [], image: path.join(d.dir, 'image.png'), brief: path.join(d.dir, 'brief.md'), sign_text: d.draft.sign_text || '', ...(draftSignMode(d.draft) ? { sign_mode: draftSignMode(d.draft), audience: d.draft.idea?.audience || '', scene_type: d.draft.idea?.scene_type || '', text_reason: d.draft.idea?.text_reason || '', write_from: 'the IDEA + audience (idea, hook, why, audience), NOT from what the image shows; the image only confirms sign_text reads exactly' } : {}), ...(d.draft.image_mode === 'scene-swap' ? { ref_mode: d.draft.ref_mode || '', ref_text: d.draft.ref_text || '', reference_image: d.draft.reference_image } : {}), idea: d.draft.idea, posted_langs: d.draft.languages || [], review_langs: d.draft.review_languages || [] },
      ...(d.draft.ref_mode === 'keep-scene' ? {} : { size_check: { product_pct: d.status.size_check?.product_pct ?? '', object_pct: d.status.size_check?.object_pct ?? '' } }),
      ...(draftSignMode(d.draft) && d.draft.sign_text ? { sign_check: { reads: '', ...(perImageSigns(d.draft) ? Object.fromEntries(draftImages(d.draft).slice(1).map((_, k) => ['reads_' + String(k + 2).padStart(2, '0'), ''])) : {}), by: '' } } : {}),
      ...(d.draft.image_mode === 'scene-swap' ? { confirm_clean: { by: '', no_people: d.draft.ref_mode === 'new-scene' ? false : null } } : {}),
      captions: Object.fromEntries(langs.map((l) => [l, prev[l] || (fs.existsSync(path.join(d.dir, `content-${l}.txt`)) ? fs.readFileSync(path.join(d.dir, `content-${l}.txt`), 'utf8') : '')])) };
  }
  return tpl;
}
function stageC(st, args) {
  const t0 = Date.now();
  if (manualImages(st.image_engine)) {
    const todo = flowTodo(st);
    if (todo.length) return { stage: st.image_engine === 'antigravity' ? 'C waiting for Antigravity images' : 'C waiting for Flow images', flow_images: todo, next: nextFor(st) };
  }
  const done = waitImages(st, Number(args['wait-minutes'] || 40) * 60000);
  if (!done) return { stage: 'C waiting', next: 'Images are still being made: run node scripts/pipeline.mjs create --resume again.' };
  const batch = readJson(st.batch?.out || '', null);
  const sheet = step('draft.mjs', ['contact-sheet', '--ids', st.drafts.join(',')]);
  const tpl = captionTemplate(st);
  const capFile = path.join(pipeDir(), 'captions-todo.json');
  writeJson(capFile, tpl);
  st.stage = 'captions';
  st.timing = { ...st.timing, C_wait: Date.now() - t0, images: st.batch ? Date.now() - Date.parse(st.batch.started) : 0 };
  saveState(st);
  const failed = Object.entries(tpl.drafts).filter(([, x]) => x._context.status === 'image_failed').map(([id, x]) => ({ id, error: x._context.error }));
  return {
    stage: 'C done', contact_sheets: (sheet.sheets || []).map((s) => ({ file: s.file, drafts: s.drafts.map((x) => `#${x.n} ${x.id}`) })), image_failed: failed, batch_failed: batch?.failed || [],
    captions_file: capFile, drafts: Object.keys(tpl.drafts),
    next: [
      'STOP (ii): LOOK at every contact sheet (Read each PNG; rules docs/LESSONS.md): product fits the setting, real size vs surroundings (fill size_check: product % of image width and of the comparison object; too big = redo with "smaller"), sign text exact, no logo on the product, no placeholder. Unsure: open that image file.',
      failed.length ? `image_failed: give those drafts a "redo" (Codex quota: stop making images and report).` : '',
      `Write every caption in ${rel(capFile)} (or "redo" for a bad image), then: node scripts/pipeline.mjs create --resume --captions ${rel(capFile)}`,
    ].filter(Boolean),
  };
}

// ----- Stage D -----
function stageD(st, file, args) {
  const t0 = Date.now();
  const data = readJson(path.resolve(file));
  const redo = [], results = [], problems = [];
  for (const [id, e] of Object.entries(data.drafts || {})) {
    let d; try { d = findDraft(id); } catch (err) { problems.push(`${id}: ${err.message}`); continue; }
    if (e.redo) {
      const n = (st.redos[id] || 0) + 1;
      if (n > 2) { problems.push(`${id}: already redone twice; report it (the user can Drop it in the app).`); continue; }
      const r = step('draft.mjs', ['reprompt', '--id', id, ...(e.redo.size ? ['--size', String(e.redo.size)] : []), ...(e.redo.compare ? ['--compare', String(e.redo.compare)] : []), ...(Number(e.redo.smaller) > 0 ? ['--smaller', String(e.redo.smaller)] : []), ...(e.redo.sign_text ? ['--sign-text', String(e.redo.sign_text)] : []), ...(e.redo.description ? ['--description', String(e.redo.description)] : [])]);
      if (r.ok === false) { problems.push(`${id}: ${r.error}`); continue; }
      st.redos[id] = n; redo.push(id); continue;
    }
    // The measured proportions of the image (draft.mjs size-check); over the limit: the check blocks it, give a redo with "smaller".
    const sc = e.size_check || {};
    if (String(sc.product_pct ?? '').trim()) { const r = step('draft.mjs', ['size-check', '--id', id, '--product-pct', String(sc.product_pct), ...(String(sc.object_pct ?? '').trim() ? ['--object-pct', String(sc.object_pct)] : []), ...(String(sc.wall_pct ?? '').trim() ? ['--wall-pct', String(sc.wall_pct)] : [])]); if (r.ok === false) problems.push(`${id} size-check: ${r.error}`); }
    // clean (metadata) when the image is not clean yet; watermark when the brand has it on; then the automatic check.
    if (!fs.existsSync(path.join(d.dir, 'image.png')) && fs.existsSync(path.join(d.dir, 'image-generated.png'))) step('image-clean.mjs', ['--id', id]);
    const b = loadBrand(d.draft.brand, { allowDisabled: true });
    if (b.social.product_images?.watermark?.enabled && !d.status.watermark) { const w = step('draft.mjs', ['watermark', '--id', id]); if (w.ok === false) problems.push(`${id} watermark: ${w.error}`); }
    // Scene-swap: the agent looked at the image (no shop marks; new-scene: no person) -> draft.mjs confirm-clean.
    const cc = e.confirm_clean || {};
    if (String(cc.by || '').trim()) { const r = step('draft.mjs', ['confirm-clean', '--id', id, '--by', String(cc.by), ...(cc.no_people === true ? ['--no-people'] : [])]); if (r.ok === false) problems.push(`${id} confirm-clean: ${r.error}`); }
    // Step 5 -> step 6: the image was LOOKED at (sign-check) before any caption is accepted.
    if (draftSignMode(d.draft) && d.draft.sign_text && d.draft.sign_workflow >= WORKFLOW_VERSION) {
      const sc = e.sign_check || {};
      if (String(sc.reads || '').trim()) { const xr = Object.entries(sc).filter(([k, v]) => /^reads_\d+$/.test(k) && String(v || '').trim()).flatMap(([k, v]) => ['--' + k.replace('_', '-'), String(v)]); const r = step('draft.mjs', ['sign-check', '--id', id, '--reads', String(sc.reads), ...xr, '--by', String(sc.by || 'agent')]); if (r.ok === false && !r.kept_anyway) { problems.push(`${id}: ${r.error}`); continue; } }
      const fresh = findDraft(id);
      if (!fresh.status.sign_check?.ok) { problems.push(`${id}: ${cause('caption-before-image-check', 'step 6 before step 5: LOOK at the image and give "sign_check": { "reads": "<words seen on the sign>", "by": "<name>" } with the captions (or draft.mjs sign-check).')}`); continue; }
    }
    // Step 6: the captions (written from the idea, quoting sign_text exactly).
    const caps = e.captions || {};
    const want = Object.keys(d.draft.captions || {});
    const empty = want.filter((l) => !String(caps[l] || '').trim());
    if (empty.length) { problems.push(`${id}: caption missing for ${empty.join(', ')}`); continue; }
    for (const l of want) fs.writeFileSync(path.join(d.dir, d.draft.captions[l] || `content-${l}.txt`), cleanText(String(caps[l])).text.trim() + '\n', 'utf8');
    const c = step('draft.mjs', ['check', '--id', id]);
    results.push({ id, status: c.status || 'error', problems: c.problems || (c.error ? [c.error] : []), warnings: c.warnings || [] });
  }
  if (redo.length) {
    // Redone images: --force per draft in the background (Codex slots keep the machine limit), then back to Stage C.
    const outFile = path.join(pipeDir(), 'image-batch.json');
    const flow = manualImages(st.image_engine);
    // Flow redo: the old images are put aside so the draft shows as waiting for new ones (register-image fills them again).
    if (flow) for (const id of redo) { const d = findDraft(id); for (const f of draftImages(d.draft)) if (fs.existsSync(path.join(d.dir, f))) fs.renameSync(path.join(d.dir, f), path.join(d.dir, `image-old-${Date.now()}-${f}`)); }
    const pids = flow ? [] : redo.map((id) => { const p = spawn(process.execPath, [path.join(here, 'draft.mjs'), 'image', '--id', id, '--force'], { detached: true, stdio: 'ignore', windowsHide: true }); p.unref(); return p.pid; });
    st.batch = flow ? null : { pid: pids[pids.length - 1], pids, out: outFile, started: stamp(), drafts: redo };
    st.stage = 'images';
  }
  st.timing = { ...st.timing, D: Date.now() - t0 };
  saveState(st);
  const notReady = results.filter((r) => r.status !== 'ready');
  const allReady = !redo.length && !problems.length && !notReady.length && st.drafts.every((id) => { try { return ['ready', 'approved', 'rejected'].includes(findDraft(id).status.status); } catch { return true; } });
  if (allReady && !args['no-finish']) return { stage: 'D done', results, ...finish(st) };
  return {
    stage: 'D partial', results, redo, problems,
    next: redo.length && manualImages(st.image_engine) ? (st.image_engine === 'antigravity' ? `Redo ${redo.length} image(s) with Antigravity (image-generator; new prompt.txt written; docs/flow-images.md), register each with draft.mjs register-image --id <draft> --n <k> --engine antigravity --from <file> (replaces the old image), then: node scripts/pipeline.mjs create --resume.` : `Redo ${redo.length} image(s) in Google Flow (new prompt.txt written; docs/flow-images.md), register each with draft.mjs register-image --id <draft> --n <k> --from <file> (replaces the old image), then: node scripts/pipeline.mjs create --resume.`)
      : redo.length ? `Redoing ${redo.length} image(s) in the background: node scripts/pipeline.mjs create --resume (waits, new contact sheet), then captions for those.`
      : `Fix the drafts that are not ready (problems above) in ${rel(path.resolve(file))} and send it again: node scripts/pipeline.mjs create --resume --captions ${rel(path.resolve(file))}${notReady.length || problems.length ? ' (or finish anyway: node scripts/pipeline.mjs create --resume --finish; they stay out of To review)' : ''}`,
  };
}

// queue (report data) + run log; the run is over.
function finish(st) {
  const q = step('queue.mjs', []);
  const notesFile = path.join(pipeDir(), 'runlog-notes.json');
  writeJson(notesFile, { notes: ['pipeline.mjs create', ...(st.requested ? [`requested ${st.requested}, done ${(st.drafts || []).length}${(st.drafts || []).length < st.requested ? ` (Hết stock: chỉ còn ${(st.drafts || []).length} bài khả dụng, bạn chọn ${st.requested})` : ''}`] : []), ...(st.notes || [])].join(' · '), errors: st.errors || [] });
  const log = step('runlog.mjs', ['add', '--mode', 'create', '--agent', st.agent || 'Claude Code', '--started', st.run_started, '--file', notesFile]);
  st.stage = 'done'; st.finished = stamp(); st.timing = { ...st.timing, total: Date.now() - Date.parse(st.run_started) };
  saveState(st);
  const ready = st.drafts.filter((id) => { try { return findDraft(id).status.status === 'ready'; } catch { return false; } });
  return { finished: true, to_review: ready, queue: q.ok === false ? q.error : q.brands ? Object.keys(q.brands) : q, runlog: log.ok === false ? log.error : log.id || log.file || 'written', timing_ms: st.timing,
    next: 'Report in Vietnamese with the fixed headings of RUNBOOK 2.10 (captions of each To review draft verbatim, VN "chỉ để đọc, không đăng"); remind the user to open the Posts tab. Never approve.' };
}

function create(args) {
  fs.mkdirSync(pipeDir(), { recursive: true });
  if (!args.resume) {
    const cur = readState();
    if (cur && cur.stage !== 'done' && !args.restart) throw new Error(`A Create run is open (stage ${cur.stage}, started ${cur.run_started}): node scripts/pipeline.mjs create --resume, or --restart to begin a new one.`);
    return stageA(args);
  }
  const st = readState();
  if (!st || st.stage === 'done') throw new Error('No open Create run: node scripts/pipeline.mjs create --brand <id|all>.');
  st.redos ||= {};
  if (args.finish) return finish(st);
  if (args.ideas && args.ideas !== true) return stageB(st, String(args.ideas));
  if (args.captions && args.captions !== true) return stageD(st, String(args.captions), args);
  if (st.stage === 'images') return stageC(st, args);
  if (st.stage === 'captions') return st.drafts.length ? stageC(st, args) : finish(st);
  if (st.stage === 'ideas') return { stage: 'ideas', next: `Fill ${rel(st.ideas_file)} then: node scripts/pipeline.mjs create --resume --ideas ${rel(st.ideas_file)}` };
  throw new Error(`Unknown stage ${st.stage}.`);
}

// ----- Publish approved (RUNBOOK Mode 3) -----
const publishState = () => path.join(pipeDir(), 'publish-run.json');
function publishRun(args) {
  fs.mkdirSync(pipeDir(), { recursive: true });
  if (args.resume) {
    const st = readJson(publishState(), null);
    if (!st || st.finished) throw new Error('No open Publish run: node scripts/pipeline.mjs publish --brand <id|all>.');
    const q = step('queue.mjs', []);
    const notesFile = path.join(pipeDir(), 'runlog-notes.json');
    writeJson(notesFile, { notes: ['pipeline.mjs publish', ...(st.notes || [])].join(' · '), errors: st.errors || [] });
    const log = step('runlog.mjs', ['add', '--mode', 'publish', '--agent', st.agent, '--started', st.run_started, '--file', notesFile]);
    st.finished = stamp(); writeJson(publishState(), st);
    return { finished: true, queue: q.ok === false ? q.error : 'ok', runlog: log.ok === false ? log.error : 'written', next: 'Report in Vietnamese with the fixed headings of RUNBOOK 3.2.' };
  }
  const run_started = stamp(), t0 = Date.now();
  const brandArg = String(args.brand && args.brand !== true ? args.brand : 'all');
  const agent = String(args.agent && args.agent !== true ? args.agent : 'Claude Code');
  const br = step('brands.mjs', ['--run', 'publish']);
  if (br.ok === false) throw new Error(br.error);
  const scope = brandArg === 'all' ? br.usable : br.usable.filter((x) => x === brandArg);
  if (!scope.length) throw new Error(`No usable brand for "${brandArg}".`);
  const flags = [];
  for (const k of ['window', 'start']) if (args[k] && args[k] !== true) flags.push(`--${k}`, String(args[k]));
  // --limit N = N posts IN TOTAL across the brands in scope (the Run tab "Posts" box), oldest approved first over all brands.
  // The stock is what can be sent now: approved, not on Metricool yet, with media. Fewer than N: send them all and say so;
  // none: no run (nothing is opened, sent or logged).
  const requested = args.limit && args.limit !== true ? Number(args.limit) : null;
  if (requested !== null && !(Number.isInteger(requested) && requested > 0)) throw new Error('--limit must be a positive whole number.');
  const stock = scope.flatMap((id) => { try { return publishStock(id); } catch { return []; } }).sort((a, b) => a.when.localeCompare(b.when) || a.id.localeCompare(b.id));
  const available = stock.length, chosen = requested ? stock.slice(0, requested) : stock;
  const stock_message = !available ? 'Hết stock: không còn bài đã duyệt chưa gửi' : requested && available < requested ? `Hết stock: chỉ còn ${available} bài đã duyệt (bạn chọn ${requested})` : '';
  if (!available) return { stop: true, requested: requested ?? 'all', available, selected: 0, stock_message, next: 'Nothing approved is waiting: do NOT make Metricool calls, do NOT write a run log. Report to me in Vietnamese only this line: ' + stock_message };
  const byBrand = {};
  for (const c of chosen) (byBrand[c.brand] ||= []).push(c.id);
  const scoped = scope.filter((id) => byBrand[id]);
  const notes = [], errors = [];
  if (stock_message) notes.push(stock_message);
  notes.push(`requested ${requested ?? 'all'}, selected ${chosen.length} of ${available} available`);
  const { sync, publish } = syncAndPayload(args, scoped, notes, errors, (id) => [...flags, '--posts', byBrand[id].join(',')]);
  writeJson(publishState(), { run_started, agent, scope, notes, errors, requested: requested ?? 'all', available, selected: chosen.length });
  const items = Object.values(publish.brands).reduce((n, b) => n + b.items.length, 0);
  // One line per brand of the whole discovery (the report must say which brands were processed and why one was skipped).
  const brand_lines = (br.brands || []).map((b) => {
    if (!scope.includes(b.id)) return `${b.id}: skipped (${brandArg !== 'all' && b.usable ? `not selected: this run is for ${brandArg} only` : b.usable ? 'not in scope' : b.enabled ? `not usable: ${(b.problems || []).join('; ') || 'skill check failed'}` : 'disabled (social.json enabled: false)'})`;
    const x = publish.brands[b.id] || {};
    const n = (x.items || []).length, bl = (x.blocked || []).length;
    return `${b.id}: ${n ? `${n} approved post(s) to send now (${(x.items || []).map((i) => i.post).join(', ')})` : 'skipped (no approved post waiting to be sent' + (bl ? '; blocked: ' + x.blocked.join(' / ') : '') + ')'}`;
  });
  return { brands: scope, requested: requested ?? 'all', available, selected: chosen.length, stock_message, report_line: `requested ${requested ?? 'all'}, done <number of createScheduledPost sent and recorded> (selected ${chosen.length} of ${available} available)${stock_message ? '; ' + stock_message : ''}`, brand_lines, sync, publish_file: path.join(pipeDir(), 'publish.json'), publish_items: items, publish: publish.brands, notes, errors, timing_ms: Date.now() - t0,
    next: [
      items ? 'Send NOW (times were just computed): for each item createScheduledPost with exactly its args, then its record command. An item already past send_before: do not send it; run metricool-mcp.mjs payload --brand <id> (same flags) again for it.' : 'Nothing approved to send.',
      'Reconcile: each status_query -> getScheduledPosts; PUBLISHED -> posts.mjs mark-published; ERROR -> report (RUNBOOK 2.2).',
      'Then: node scripts/pipeline.mjs publish --resume (queue + run log), and report (RUNBOOK 3.2).',
    ] };
}

if (isMain(import.meta.url)) main(() => {
  const args = parseArgs();
  const cmd = args._[0];
  if (cmd === 'mcp-plan') return out(mcpPlan(String(args.brand && args.brand !== true ? args.brand : 'all')));
  if (cmd === 'create') return out(create(args));
  if (cmd === 'publish') return out(publishRun(args));
  if (cmd === 'status') { const st = readState(); return out({ state: st, file: stateFile() }); }
  throw new Error('Commands: mcp-plan [--brand] | publish --brand <id|all> [--limit N] [--window w] [--start today] [--brand-settings f --best-times-dir d] | publish --resume | create --brand <id|all> [--count N | --items S0001,S0002] [--brand-settings f --best-times-dir d] | create --resume [--ideas f | --captions f | --finish] | status');
});
