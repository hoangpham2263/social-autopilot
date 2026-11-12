// One-command Create & publish (RUNBOOK Mode 2, fast path): runs every deterministic step in order and STOPS only where
// the agent's judgement is needed, printing exactly what to do. The checks are the same as step by step (it calls the
// same scripts); only the agent's round trips are fewer: all ideas in one file, all captions in one file, every new
// image in one contact sheet. Metricool MCP calls stay with the agent (the payload items and record commands are printed).
//
//   node scripts/pipeline.mjs mcp-plan [--brand <id|all>]
//        the Metricool MCP calls to make first (getBrandSettings, getBestTimeToPostByNetwork per brand, exact args)
//   node scripts/pipeline.mjs create --brand <id|all> [--count N | --items S0008,S0012] [--agent "Claude Code"]
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
import { nowIn } from './metricool-csv.mjs';
import { main, out, parseArgs, workspace, readJson, writeJson, stamp, settings, loadBrand, findDraft, cleanText, metricoolBrands, isMain } from './lib.mjs';
import { previousUses } from './store.mjs';
import { REUSE_RULE } from './ideas.mjs';

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
  const publish = { brands: {} };
  for (const id of scope) {
    const p = step('metricool-mcp.mjs', ['payload', '--brand', id, ...payloadFlags]);
    const s = step('metricool-mcp.mjs', ['status', '--brand', id]);
    publish.brands[id] = {
      items: p.ok === false ? [] : (p.items || []).map(({ post, time_source, send_before, tool, args: a, record }) => ({ post, time_source, send_before, tool, args: a, record })),
      blocked: p.ok === false ? [p.error] : p.blocked || [],
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
  const todo = { how: 'Fill every entry (one pass, all brands). Per idea EITHER "reject": "<reason>" OR: idea fields (abstract, prompts/idea-abstract.md: no copied words, phone, link or shop name), product (the brand\'s own photo, from _context.product_folders), size (real size, cm + in, from _context.size_source), compare (the comparison object in the scene with ITS real size, e.g. "the 4-seat wooden table below, 120 cm (47 in) wide"; the product stays at most 60% of it unless the brand sets other size_limits), sign_text (when _context.custom_text; a text that fits the scene, never a placeholder), description (the exact product: every letter and accent of its text, font, colours, material, proportions). A reused library item (_context.previous_uses): a NEW angle, a different scene (new-scene) OR a different sign_text (keep-scene) than every previous use; the same scene + sign_text + product is rejected. Reference-based post / scene-swap (only when _context.reference_redraw): "scene_swap": true + "brand_can_produce": true instead of product (the PRODUCT always comes from the reference photo; every foreign logo, shop name, watermark, phone, price is removed); LOOK at _context.ref_image and set "ref_has_face" (true when any human face / identifiable person shows) and "ref_mode": no face -> "keep-scene" (the scene/background/framing stay; sign_text = NEW text in the SAME language/script as the original, fitting the scene, no placeholder, no third-party brand, no real customer name; "ref_text" = what the reference reads exactly; compare not needed), face -> "new-scene" (a new real-life scene, every person removed; the product text stays as is: sign_text empty or only what it already reads; compare + proportion rules apply). Delete nothing else. Then: node scripts/pipeline.mjs create --resume --ideas workspace/pipeline/ideas-todo.json', brands: {}, ideas: [] };
  for (const id of scope) {
    const r = step('ideas.mjs', ['init', '--brand', id, ...(args.restart ? ['--reset'] : []), ...(pickIds.length ? ['--items', pickIds.join(',')] : args.count && args.count !== true ? ['--count', String(args.count)] : [])]);
    for (const n of r.notes || []) notes.push(`${id}: ${n}`);
    if (r.ok === false) { if (/trống/.test(r.error || '')) { needsResearch.push(id); errors.push(`${id}: stop: needs research (Library is empty): run Research for ${id} first, then Create again.`); } else errors.push(`${id} ideas: ${r.error}`); continue; }
    if (r.warning) notes.push(`${id}: ${r.warning}`);
    if (!pickIds.length && !(r.items || []).length && r.store_ready_left === 0 && !readJson(path.join(workspace, 'store', id, 'ideas.json'), { ideas: [] }).ideas.some((i) => ['todo', 'ready'].includes(i.status))) { needsResearch.push(id); errors.push(`${id}: stop: needs research (Library has 0 available items): run Research for ${id} first (RUNBOOK 1.x), then Create again.`); continue; }
    const b = loadBrand(id);
    const ideas = readJson(path.join(workspace, 'store', id, 'ideas.json'), { ideas: [] }).ideas.filter((i) => ['todo', 'ready'].includes(i.status) && (!pickIds.length || pickIds.includes(i.item)));
    const items = readJson(path.join(workspace, 'store', id, 'items.json'), { items: [] }).items;
    const folders = productFolders(b);
    todo.brands[id] = { skill: b.dir, skill_root: b.skillRoot || b.dir, skill_md: path.join(b.skillRoot || b.dir, 'SKILL.md'), project_md: path.join(b.dir, 'project', 'project.md'), image_guide: path.join(b.skillRoot || b.dir, 'references', 'image-guide.md'), size_source: b.social.product_images?.size_source || 'project.md section 5/10', custom_text: b.social.product_images?.custom_text === true, reference_redraw: b.social.product_images?.reference_redraw?.enabled === true, product_folders: folders, product_images: folders.flatMap((d) => someImages(d, 30)).slice(0, 60) };
    for (const i of ideas) {
      const it = items.find((x) => x.id === i.item) || {};
      const prev = previousUses(it);
      todo.ideas.push({ brand: id, id: i.id, _context: { item: i.item, ref_image: i.ref_image, reference_caption: String(it.caption || '').slice(0, 400), source: i.source, ...(prev.length ? { previous_uses: prev, reuse_rule: REUSE_RULE } : {}), ...(todo.brands[id].reference_redraw ? { reference_redraw: true } : {}) }, idea: Object.fromEntries(IDEA_FIELDS.map((f) => [f, i[f] || ''])), product: '', size: i.product_size || '', compare: i.size_compare || '', sign_text: i.sign_text || '', description: '', reject: '', ...(todo.brands[id].reference_redraw ? { scene_swap: false, brand_can_produce: false, ref_has_face: i.ref_has_face ?? null, ref_mode: i.ref_mode || '', ref_text: i.ref_text || '' } : {}) });
    }
  }
  const ideasFile = path.join(pipeDir(), 'ideas-todo.json');
  writeJson(ideasFile, todo);
  lap('ideas_init', t);
  const st = saveState({ run_started: started, agent, brand: brandArg, scope, stage: todo.ideas.length ? 'ideas' : 'captions', ideas_file: ideasFile, drafts: [], redos: {}, notes, errors, timing: { A: Date.now() - t0, ...timing } });
  const items = Object.values(publish.brands).reduce((n, b) => n + b.items.length, 0);
  return {
    stage: 'A done', stop: todo.ideas.length ? 'ideas' : needsResearch.length ? 'needs research' : 'captions', ...(needsResearch.length ? { needs_research: needsResearch } : {}), brands: scope, sync, publish_file: path.join(pipeDir(), 'publish.json'), publish_items: items,
    status_queries: Object.fromEntries(Object.entries(publish.brands).filter(([, b]) => b.status_query).map(([id, b]) => [id, b.status_query])),
    ideas_file: ideasFile, ideas: todo.ideas.length, notes, errors, timing_ms: st.timing,
    next: [
      items ? `Metricool (now, fast): for each item in ${rel(path.join(pipeDir(), 'publish.json'))}: createScheduledPost with exactly its args (skip an item already past send_before: run metricool-mcp.mjs payload --brand <id> again for it), then run its record command.` : 'Metricool: nothing approved to send.',
      'Reconcile: for each status_queries entry call getScheduledPosts with it; PUBLISHED -> posts.mjs mark-published (RUNBOOK 2.2); ERROR -> report.',
      todo.ideas.length ? `STOP (i): fill ${rel(ideasFile)} (all brands, one pass; read each brand's SKILL.md + project.md + image-guide.md first), then: node scripts/pipeline.mjs create --resume --ideas ${rel(ideasFile)}` : 'No new ideas needed: node scripts/pipeline.mjs create --resume (finishes: queue + run log).',
    ],
  };
}

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
    const miss = [...(swap ? [] : ['product']), 'size', 'description'].filter((k) => !String(e[k] || '').trim());
    if (swap && e.brand_can_produce !== true) { problems.push(`${tag}: scene_swap needs "brand_can_produce": true (the brand makes this exact product, project.md section 5)`); continue; }
    // The agent looked at the reference: a face -> new-scene, none -> keep-scene (new sign_text + ref_text required).
    const refMode = swap ? String(e.ref_mode || '').trim() : '';
    if (swap) {
      const rp = [];
      if (typeof e.ref_has_face !== 'boolean') rp.push('"ref_has_face": true|false (LOOK at the reference: any human face?)');
      if (!['keep-scene', 'new-scene'].includes(refMode)) rp.push('"ref_mode": "keep-scene" (no face) or "new-scene" (face)');
      else if (typeof e.ref_has_face === 'boolean' && e.ref_has_face !== (refMode === 'new-scene')) rp.push(`ref_has_face ${e.ref_has_face} does not fit ref_mode ${refMode} (face -> new-scene, no face -> keep-scene)`);
      if (refMode === 'keep-scene' && !String(e.ref_text || '').trim()) rp.push('keep-scene needs "ref_text" (what the reference reads)');
      if (refMode === 'keep-scene' && !String(e.sign_text || '').trim()) rp.push('keep-scene needs "sign_text" (the NEW text, same language/script as the original)');
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
    const n = step('draft.mjs', ['new', '--brand', e.brand, '--idea', e.id, ...(swap ? ['--ref-image', refImage, '--brand-can-produce', '--ref-mode', refMode, '--ref-has-face', String(e.ref_has_face), ...(e.ref_text ? ['--ref-text', String(e.ref_text)] : [])] : ['--product', String(e.product)]), '--size', String(e.size), ...(e.compare ? ['--compare', String(e.compare)] : []), ...(e.sign_text ? ['--sign-text', String(e.sign_text)] : []), ...(e.scene_image ? ['--scene', String(e.scene_image)] : [])]);
    if (n.ok === false) { problems.push(`${tag}: ${n.error}`); continue; }
    fillDescription(n.dir, cleanText(String(e.description)).text);
    made.push(n.id);
  }
  st.drafts = [...new Set([...(st.drafts || []), ...made])];
  if (st.drafts.length) spawnImages(st, made);
  st.stage = st.drafts.length ? 'images' : problems.length ? 'ideas' : 'captions';
  st.timing = { ...st.timing, B: Date.now() - t0 };
  saveState(st);
  return {
    stage: 'B done', drafts: made, rejected, problems, images: st.batch ? `running in the background (pid ${st.batch.pid}), at most codex.concurrency at once` : 'none',
    next: problems.length && !made.length
      ? `Fix these entries in the ideas file and send it again: node scripts/pipeline.mjs create --resume --ideas ${rel(path.resolve(file))}`
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
  const tpl = { how: 'LOOK at every contact sheet first. Per draft EITHER the captions (one key per language in langs: the posted ones and the reviewer-only ones; follow brief.md, SKILL.md section A, project.md; mention sign_text exactly; Website line + fixed hashtag; no Markdown, no AI label, no source shop name) plus "size_check": { "product_pct": N, "object_pct": N } measured on the image (product width as % of the image width and of the comparison object; not for ref_mode keep-scene, which keeps the original framing), plus for a scene-swap draft "confirm_clean": { "by": "<name>", "no_people": true|false } once you LOOKED at the image beside _context.reference_image (no shop name, logo, watermark, phone, price left; new-scene: no person left, no_people true; keep-scene: the new sign_text reads exactly), OR "redo": { "description": "...", "size": "...", "compare": "...", "smaller": N, "sign_text": "..." } (only what changes; "smaller": N when the product is too big, N from the size limits; at most 2 redos per draft). Then: node scripts/pipeline.mjs create --resume --captions workspace/pipeline/captions-todo.json', drafts: {} };
  const old = readJson(path.join(pipeDir(), 'captions-todo.json'), { drafts: {} }).drafts || {};
  for (const id of st.drafts) {
    let d; try { d = findDraft(id); } catch { continue; }
    if (['approved', 'rejected', 'ready'].includes(d.status.status)) continue;
    const langs = Object.keys(d.draft.captions || {});
    const prev = old[id]?.captions || {};
    tpl.drafts[id] = { _context: { brand: d.draft.brand, status: d.status.status, error: d.status.error || '', problems: d.status.problems || [], image: path.join(d.dir, 'image.png'), brief: path.join(d.dir, 'brief.md'), sign_text: d.draft.sign_text || '', ...(d.draft.image_mode === 'scene-swap' ? { ref_mode: d.draft.ref_mode || '', ref_text: d.draft.ref_text || '', reference_image: d.draft.reference_image } : {}), idea: d.draft.idea, posted_langs: d.draft.languages || [], review_langs: d.draft.review_languages || [] },
      ...(d.draft.ref_mode === 'keep-scene' ? {} : { size_check: { product_pct: d.status.size_check?.product_pct ?? '', object_pct: d.status.size_check?.object_pct ?? '' } }),
      ...(d.draft.image_mode === 'scene-swap' ? { confirm_clean: { by: '', no_people: d.draft.ref_mode === 'new-scene' ? false : null } } : {}),
      captions: Object.fromEntries(langs.map((l) => [l, prev[l] || (fs.existsSync(path.join(d.dir, `content-${l}.txt`)) ? fs.readFileSync(path.join(d.dir, `content-${l}.txt`), 'utf8') : '')])) };
  }
  return tpl;
}
function stageC(st, args) {
  const t0 = Date.now();
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
    const caps = e.captions || {};
    const want = Object.keys(d.draft.captions || {});
    const empty = want.filter((l) => !String(caps[l] || '').trim());
    if (empty.length) { problems.push(`${id}: caption missing for ${empty.join(', ')}`); continue; }
    for (const l of want) fs.writeFileSync(path.join(d.dir, d.draft.captions[l] || `content-${l}.txt`), cleanText(String(caps[l])).text.trim() + '\n', 'utf8');
    // clean (metadata) when the image is not clean yet; watermark when the brand has it on; then the automatic check.
    if (!fs.existsSync(path.join(d.dir, 'image.png')) && fs.existsSync(path.join(d.dir, 'image-generated.png'))) step('image-clean.mjs', ['--id', id]);
    const b = loadBrand(d.draft.brand, { allowDisabled: true });
    if (b.social.product_images?.watermark?.enabled && !d.status.watermark) { const w = step('draft.mjs', ['watermark', '--id', id]); if (w.ok === false) problems.push(`${id} watermark: ${w.error}`); }
    // Scene-swap: the agent looked at the image (no shop marks; new-scene: no person) -> draft.mjs confirm-clean.
    const cc = e.confirm_clean || {};
    if (String(cc.by || '').trim()) { const r = step('draft.mjs', ['confirm-clean', '--id', id, '--by', String(cc.by), ...(cc.no_people === true ? ['--no-people'] : [])]); if (r.ok === false) problems.push(`${id} confirm-clean: ${r.error}`); }
    const c = step('draft.mjs', ['check', '--id', id]);
    results.push({ id, status: c.status || 'error', problems: c.problems || (c.error ? [c.error] : []), warnings: c.warnings || [] });
  }
  if (redo.length) {
    // Redone images: --force per draft in the background (Codex slots keep the machine limit), then back to Stage C.
    const outFile = path.join(pipeDir(), 'image-batch.json');
    const pids = redo.map((id) => { const p = spawn(process.execPath, [path.join(here, 'draft.mjs'), 'image', '--id', id, '--force'], { detached: true, stdio: 'ignore', windowsHide: true }); p.unref(); return p.pid; });
    st.batch = { pid: pids[pids.length - 1], pids, out: outFile, started: stamp(), drafts: redo };
    st.stage = 'images';
  }
  st.timing = { ...st.timing, D: Date.now() - t0 };
  saveState(st);
  const notReady = results.filter((r) => r.status !== 'ready');
  const allReady = !redo.length && !problems.length && !notReady.length && st.drafts.every((id) => { try { return ['ready', 'approved', 'rejected'].includes(findDraft(id).status.status); } catch { return true; } });
  if (allReady && !args['no-finish']) return { stage: 'D done', results, ...finish(st) };
  return {
    stage: 'D partial', results, redo, problems,
    next: redo.length ? `Redoing ${redo.length} image(s) in the background: node scripts/pipeline.mjs create --resume (waits, new contact sheet), then captions for those.`
      : `Fix the drafts that are not ready (problems above) in ${rel(path.resolve(file))} and send it again: node scripts/pipeline.mjs create --resume --captions ${rel(path.resolve(file))}${notReady.length || problems.length ? ' (or finish anyway: node scripts/pipeline.mjs create --resume --finish; they stay out of To review)' : ''}`,
  };
}

// queue (report data) + run log; the run is over.
function finish(st) {
  const q = step('queue.mjs', []);
  const notesFile = path.join(pipeDir(), 'runlog-notes.json');
  writeJson(notesFile, { notes: ['pipeline.mjs create', ...(st.notes || [])].join(' · '), errors: st.errors || [] });
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
  for (const k of ['limit', 'window', 'start']) if (args[k] && args[k] !== true) flags.push(`--${k}`, String(args[k]));
  const notes = [], errors = [];
  const { sync, publish } = syncAndPayload(args, scope, notes, errors, flags);
  writeJson(publishState(), { run_started, agent, scope, notes, errors });
  const items = Object.values(publish.brands).reduce((n, b) => n + b.items.length, 0);
  return { brands: scope, sync, publish_file: path.join(pipeDir(), 'publish.json'), publish_items: items, publish: publish.brands, notes, errors, timing_ms: Date.now() - t0,
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
