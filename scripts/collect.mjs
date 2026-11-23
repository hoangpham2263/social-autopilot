// Generic collector (Mode 1 step 1.2), the ONE research path: the agent opens the page or search URL with Playwright MCP,
// scrolls it with normal Playwright MCP actions (scrollBy from next.scroll, never mouse.wheel: it hangs in a background tab, 1-2 times, research.scroll_wait_seconds) and decides when
// to stop; to read the data it runs ONE extract script that reads what is on the page now and returns at once. The AI writes
// / fixes the platform adapters (scripts/platforms/<platform>.mjs, SELECTORS) and judges the images.
//   node scripts/collect.mjs script (--platform <id> (--query <q> | --url <u>) | --brand <id> --for-query <qid> | --for-source <sid>) [--seen <file>] [--max N] [--once]
//        (for a task of an open run the file SCROLLS THE PAGE BY ITSELF until 3 known posts in a row (complete source), the end of the page,
//        its round time or a block, and returns ONE result per round; --once = one plain extract, no scrolling)
//        writes the extract script to research.script_dir (~/.playwright-mcp/social-autopilot/<brand>-<task>.js, readable by the Playwright
//        MCP) and prints its path; run it with browser_run_code_unsafe filename=: no navigation, no scroll, no pause; it POSTs its result to the
//        app (one-time token, 15 min) and returns { saved:true, total, tag, bytes } (b64 only when the POST failed) with only the tiles whose id is not in the task's seen list
//        (<task dir>/seen.json, written by from-page; --seen <file> = another JSON list of ids)
//   node scripts/collect.mjs from-page --brand <id> (--for-query <qid> | --for-source <sid>) [--b64 <line> | --file <result.json> | --stdin | --json] [--images N]   (no result flag = <task dir>/page-result.json sent by the script)
//        checks total + checksum + tag (fails loudly when cut off or edited), drops posts the store already has, downloads
//        images into the run folder, ADDS the posts to raw.json (scroll, extract, scroll, extract accumulates) and says
//        whether to stop (target reached, 3 extracts with no new posts, all known, login wall / captcha / closed page)
//   node scripts/collect.mjs fit --brand <id> (--for-query <qid> | --for-source <sid>) --file decisions.json
//        decisions [{ id, fit: true, type, reason } | { id, fit: false, reason }] (the agent LOOKED at the images): fit posts get
//        product_fit, the others move to rejected[] (what ingest needs for a discovery query). A post you did NOT look at gets
//        NO decision (it stays pending_fit); a fit:false whose reason says it was not looked at ("unreviewed", "not inspected",
//        "budget"...) or that reuses another brand's / run's decision is REFUSED (the post stays pending, listed in `refused`).
//        Decisions are per brand: judged against THIS brand's product_fit.types / project.md, never copied from another brand.
//   node scripts/collect.mjs pending --brand <id> [--per 16]   posts of earlier runs still waiting for fit (store/<brand>/pending.json):
//        the next batch with ONE contact sheet (numbered tiles) to judge them
//   node scripts/collect.mjs fit --brand <id> --pending --file decisions.json   applies decisions to those pending posts
//        (fit -> Library through the same store checks, fit:false -> rejected.json, no decision -> stays pending)
//   node scripts/collect.mjs status      every adapter with its status (untested | ok | broken)
// Read only: it never likes, saves, follows, comments, messages, joins, posts or signs in. A login wall / captcha / block
// page = state blocked, nothing more opened. Cookies stay in Chrome; nothing secret is written.
import fs from 'node:fs';
import path from 'node:path';
import { main, out, isMain, parseArgs, need, settings, loadBrand, brandDiscovery, readJson, writeJson, workspace, stamp } from './lib.mjs';
import { notLookedAt, borrowedFit, knownBrandIds, readPending, removePending, addPosts, logRejected, storeDir } from './store.mjs';
import { writeSheets } from './contact-sheet.mjs';
import { openRun, nextTask, timeInfo, brandTotal, TIME_NEXT, srcMode, BATCH_RULE } from './research.mjs';
import { track } from './progress.mjs';
import { REGISTRY, STATUSES, getAdapter, adapterStatus, platformIds } from './platforms/index.mjs';

// ---------- pure parts (tests/collect.test.mjs) ----------
const slug = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';
export const fileId = (id) => String(id || '').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'post';

// What to collect: from an open run (--for-query / --for-source) or from --platform + --url|--query.
// run = the opened run.json (or null for standalone). -> { kind, id, platform, url, found_by, dir, raw_file, max, mode, known_file }
export function resolveTask(args, run = null) {
  const num = (v) => (v && v !== true && Number(v) > 0 ? Math.floor(Number(v)) : 0);
  if (args['for-query'] || args['for-source']) {
    if (!run) throw new Error('Chưa có lượt nghiên cứu: chạy research.mjs start trước.');
    const nxt = nextTask(run);
    if (args['for-query']) {
      const q = run.discovery?.queries?.find((x) => x.id === String(args['for-query']));
      if (!q) throw new Error(`Truy vấn "${args['for-query']}" không có trong lượt này.`);
      const share = nxt.step === 'discovery' && nxt.query === q.id ? nxt.share : 0;
      return { kind: 'query', id: q.id, platform: q.platform, url: q.url, found_by: q.found_by, dir: q.dir, raw_file: q.raw_file, max: num(args.max) || share || 30, mode: { full: true }, known_file: '', started: q.issued_at || '' };
    }
    const s = run.sources?.find((x) => x.id === String(args['for-source']));
    if (!s) throw new Error(`Nguồn "${args['for-source']}" không có trong lượt này.`);
    const share = nxt.step === 'reference' && nxt.source === s.id ? nxt.share : 0;
    return { kind: 'source', id: s.id, platform: s.platform || '', url: s.url, found_by: 'reference page', name: s.name, dir: s.dir, raw_file: s.raw_file, max: num(args.max) || share || 0, mode: srcMode(run, s), crawl: s.crawl || '', resume: s.registry_before?.resume || null, known_file: s.known_file || '', started: s.issued_at || '' };
  }
  const platform = String(args.platform && args.platform !== true ? args.platform : '').toLowerCase();
  if (!platform) throw new Error('Thiếu --platform (hoặc --for-query / --for-source).');
  const adapter = getAdapter(platform);
  if (!adapter) throw new Error(`Chưa có adapter cho "${platform}" (có: ${platformIds().join(', ')}). Viết scripts/platforms/${platform}.mjs và đăng ký trong scripts/platforms/index.mjs.`);
  const query = args.query && args.query !== true ? String(args.query) : '';
  const url = args.url && args.url !== true ? String(args.url) : query ? adapter.searchUrl(query) : '';
  if (!url) throw new Error('Cần --url <trang> hoặc --query <từ khoá|#hashtag>.');
  const dir = path.resolve(args.out && args.out !== true ? String(args.out) : path.join(workspace, 'tmp', 'collect', `${platform}-${slug(query || url)}`));
  const found_by = args['found-by'] && args['found-by'] !== true ? String(args['found-by']) : query ? (/^\s*#/.test(query) ? `hashtag:${query.replace(/^\s*#/, '')}` : `keyword:${query}`) : 'reference page';
  return { kind: 'standalone', id: `${platform}-${slug(query || url)}`, platform, url, found_by, dir, raw_file: path.join(dir, 'raw.json'), max: num(args.max) || 30, mode: { full: true }, known_file: '' };
}

// An adapter post + its downloaded images -> a raw.json post (the shape ingest reads).
export const toRawPost = (p, images, platform) => ({
  post_url: p.url, alt_urls: p.alt_urls || [], author: p.author || '', caption: p.caption || '', posted_date: p.posted_date || '',
  images, found_by: p.found_by || '', platform, collector_id: p.id, ...(p.media_type ? { media_type: p.media_type } : {}),
});
// The whole raw.json: { query, platform, posts, rejected } for a query, { page, platform, posts, rejected } for a reference page.
export function rawShape(task, posts, { rejected = [], now = stamp() } = {}) {
  const head = task.kind === 'source' ? { page: { name: task.name || task.id } } : { query: { id: task.id, platform: task.platform } };
  return { ...head, platform: task.platform, tool: 'collect', collected: now, posts, rejected };
}
// Product-fit decisions (the agent looked at the images) -> raw: fit posts get product_fit, the others go to rejected[].
// types = the brand's product_fit.types: a decision type is normalised to the exact valid string, an unknown one lands in `bad` (fit refuses).
const normType = (x) => String(x || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function matchType(type, types = []) {
  if (!types.length) return String(type || '').trim();
  const t = String(type || '').trim();
  if (types.includes(t)) return t;
  const hit = types.filter((x) => normType(x) === normType(t));
  return hit.length === 1 && normType(t) ? hit[0] : '';
}
// A decision that is not a real look by THIS brand -> why it is refused ('' = fine). brand = this brand's id, others = every brand id.
export function refuseDecision(d, brand = '', others = []) {
  const reason = String(d?.reason || '').trim();
  if (d?.brand && brand && String(d.brand) !== brand) return `decision made for brand "${d.brand}", not ${brand}: fit is per brand`;
  if (d?.fit === false && !reason) return 'fit:false needs a reason (what you SAW that is off-brand)';
  if (notLookedAt(reason)) return 'reason says the post was not looked at: give NO decision for posts you did not look at (they stay pending)';
  if (borrowedFit(reason, brand, others)) return "reason reuses another brand's / run's decision: judge this brand's own product list";
  return '';
}
export function applyDecisions(raw, decisions, types = [], { brand = '', others = [] } = {}) {
  const by = new Map((Array.isArray(decisions) ? decisions : []).filter((d) => d && d.id).map((d) => [String(d.id), d]));
  const posts = [], rejected = [...(raw.rejected || [])];
  let fit = 0, off = 0;
  const undecided = [], bad = [], refused = [];
  for (const p of raw.posts || []) {
    const d = by.get(String(p.collector_id || p.post_url));
    if (!d) { posts.push(p); undecided.push(p.collector_id || p.post_url); continue; }
    const no = refuseDecision(d, brand, others);
    if (no) { posts.push(p); refused.push({ id: p.collector_id || p.post_url, why: no }); continue; }
    if (d.fit === false) { rejected.push({ post_url: p.post_url, author: p.author || '', reason: String(d.reason || 'not a product the brand sells') }); off++; continue; }
    if (!String(d.type || '').trim()) { posts.push(p); undecided.push(`${p.collector_id}: fit without type`); continue; }
    const type = matchType(d.type, types);
    if (!type) { bad.push({ id: p.collector_id || p.post_url, type: String(d.type).trim() }); posts.push(p); continue; }
    posts.push({ ...p, product_fit: { type, reason: String(d.reason || '') } }); fit++;
  }
  return { raw: { ...raw, posts, rejected }, fit, off, undecided, bad, refused };
}
// Counters per task (cumulative; <task dir>/progress.json holds read + need, kept / rejected come from raw.json).
// kept here = fit kept per task; ingest takes ALL of them (will_ingest = kept) and `report` counts what ingest really added.
// need = the task's share; need_more = max(0, need - kept). One definition for from-page, fit and the run progress.
// pending_fit = downloaded posts of this batch without a decision; parked = posts ingest left undecided (kept for the next run in
// store/<brand>/pending.json, never rejected); queued = posts read from the page but not downloaded yet (backlog.json: next batch).
export function counters(raw, read, need = 0, queued = 0) {
  const posts = raw?.posts || [];
  const kept = posts.filter((p) => p.product_fit && String(p.product_fit.type || '').trim()).length;
  const rejected = (raw?.rejected || []).length, parked = (raw?.parked || []).length;
  const r = Math.max(Number(read) || 0, posts.length + rejected + parked);
  const n = Math.max(0, Number(need) || 0);
  return { read: r, pending_fit: Math.max(0, posts.length - kept), parked, queued: Math.max(0, Number(queued) || 0), kept, rejected, need: n, need_more: Math.max(0, n - kept), will_ingest: kept };
}
// brand = { target, kept } of the whole brand run (kept = already ingested + this task's fit kept): source need N · brand target T · brand kept K.
export const counterLine = (c, brand = null) => `read ${c.read} · kept ${c.kept} · rejected ${c.rejected}${c.pending_fit ? ` · to fit ${c.pending_fit}` : ''}${c.queued ? ` · queued ${c.queued}` : ''}${c.parked ? ` · pending (next run) ${c.parked}` : ''}${c.need ? ` · source need ${c.need}` : ''}${brand?.target ? ` · brand target ${brand.target} · brand kept ${brand.kept}` : ''}`;
// Stop by KEPT posts: target once enough are kept (none waiting for fit); poor_source when read >= factor * need and kept is still short.
export function fitStop(c, factor = 3) {
  if (c.pending_fit > 0) return '';
  if (c.need && c.need_more === 0) return 'target';
  if (c.need && c.read >= Math.max(1, Number(factor) || 3) * c.need) return 'poor_source';
  return '';
}
export const progressFile = (task) => path.join(task.dir, 'progress.json');
// How the step ended -> the state `research.mjs result` takes.
export function suggestedState(kind, { blocked, error, limit, read, stop }) {
  if (blocked) return 'blocked';
  if (error) return 'partial';
  if (kind === 'source') return stop || (limit ? 'limit' : 'end');
  return limit ? 'limit' : read ? 'done' : 'empty';
}

// The posts read from the page but not downloaded yet (collect-pagemode.mjs from-page: one batch per call, the rest waits here).
export const backlogFile = (task) => path.join(task.dir, 'backlog.json');
export const readBacklog = (task) => (readJson(backlogFile(task), { posts: [] }).posts || []);
// One rule text for every place that tells the agent how to judge (research.mjs next, from-page, fit, pending, RUNBOOK).
const fitTypes = (brand) => brandDiscovery(brand.social).product_fit.types || [];
const badTypes = (bad, types) => new Error(`fit refused: type not in the brand's product_fit.types for ${bad.map((x) => `${x.id} ("${x.type}")`).join(', ')}. Valid types (use the exact string): ${types.map((x) => `"${x}"`).join(' | ')}. Nothing was written.`);
const refusedNext = (refused) => refused.length ? `${refused.length} decision(s) REFUSED and left pending (${refused.slice(0, 3).map((x) => `${x.id}: ${x.why}`).join('; ')}${refused.length > 3 ? '; ...' : ''}): look at those tiles and decide them yourself, or leave them out (they stay pending for the next run). ` : '';

function fit(args) {
  const brand = loadBrand(need(args, 'brand'));
  if (args.pending) return fitPending(args, brand);
  const run = openRun(args, brand).run;
  const task = resolveTask(args, run);
  const raw = readJson(task.raw_file, null);
  if (!raw) throw new Error(`Chưa có ${task.raw_file}: chạy collect.mjs trước.`);
  const file = path.resolve(need(args, 'file'));
  const types = fitTypes(brand);
  const r = applyDecisions(raw, readJson(file, []), types, { brand: brand.id, others: knownBrandIds() });
  if (r.bad.length) throw badTypes(r.bad, types);
  writeJson(task.raw_file, r.raw);
  const queued = readBacklog(task).length;
  const c = counters(r.raw, readJson(progressFile(task), { read: 0 }).read, task.max, queued);
  writeJson(progressFile(task), { read: c.read, need: c.need });
  const stop = fitStop(c, settings().research?.max_read_factor);
  const summary = counterLine(c, { target: run.mode?.max_posts || 0, kept: brandTotal(run) + c.kept });
  if (task.kind !== 'standalone') track('crawl', { brand: brand.id, detail: `${task.id}: ${summary}` });
  const tm = timeInfo(task.started);
  const forArg = task.kind === 'query' ? `--for-query ${task.id}` : `--for-source ${task.id}`;
  const nextBatch = `node scripts/collect.mjs from-page --brand ${brand.id} ${forArg} --next (next batch of ${queued} queued: ONE contact sheet again)`;
  const base = tm.time_over && !stop ? TIME_NEXT : stop === 'target' ? 'Đủ bài giữ lại (need_more 0): dừng, rồi ingest + result.' : stop === 'poor_source' ? 'Nguồn này ít bài hợp thương hiệu: dừng, chuyển nguồn khác (ingest + result).'
    : r.undecided.length || r.refused.length ? `Posts without a decision stay pending (pending_fit ${c.pending_fit}): decide the ones you LOOKED at and run fit again; if you stop here, ingest keeps the rest pending for the next run (store/<brand>/pending.json), never rejected.`
    : queued ? nextBatch
    : c.need_more > 0 ? 'Còn thiếu bài: cuộn tiếp, extract, from-page, nhìn contact sheet, fit lại.' : 'node scripts/research.mjs ingest ... rồi result ...';
  out({ brand: brand.id, raw_file: task.raw_file, fit: r.fit, off_brand: r.off, undecided: r.undecided, ...(r.refused.length ? { refused: r.refused } : {}), ...c, summary, stop, ...(tm.started ? { time_limit_minutes: tm.time_limit_minutes, started: tm.started, elapsed: tm.elapsed } : {}), ...(tm.time_over && !stop ? { stop: 'time' } : {}),
    next: refusedNext(r.refused) + base });
}

// ----- pending_fit of earlier runs (store/<brand>/pending.json) -----
const pendingDir = (brand) => path.join(storeDir(brand), 'pending-sheets');
const goodImages = (x) => [].concat(x.images || []).filter((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } });
export function pendingBatch(brandId, per = 16) {
  const all = readPending(brandId);
  const withImg = all.filter((x) => goodImages(x).length), noImg = all.length - withImg.length;
  const batch = withImg.slice(0, per);
  const sheets = batch.length ? writeSheets(batch.map((x, i) => ({ file: goodImages(x)[0], label: String(x.collector_id || '').slice(0, 10) })), pendingDir(brandId), { prefix: 'pending', per, ffmpeg: settings().ffmpeg?.command || '' }) : [];
  return { total: all.length, without_image: noImg, batch_size: batch.length, contact_sheet: sheets.map((x) => x.file),
    review: batch.map((x, i) => ({ tile: i + 1, id: x.collector_id || x.post_url, url: x.post_url, platform: x.platform || '', found_by: x.found_by || '', author: x.author || '', caption: String(x.caption || '').slice(0, 140), image: goodImages(x)[0], why: x.why || '' })) };
}
function pending(args) {
  const brand = loadBrand(need(args, 'brand'));
  const per = Math.max(1, Number(args.per) || Number(settings().research?.batch_size) || 16);
  const b = pendingBatch(brand.id, per);
  out({ brand: brand.id, file: path.join(storeDir(brand.id), 'pending.json'), ...b, product_fit: brandDiscovery(brand.social).product_fit,
    next: b.batch_size ? `Read the contact sheet ONCE, judge each tile against ${brand.id}'s OWN product_fit.types / project.md (not another brand's), write [{id, fit:true, type, reason}|{id, fit:false, reason}] for the tiles you looked at, then: node scripts/collect.mjs fit --brand ${brand.id} --pending --file <decisions.json>. ${BATCH_RULE}`
      : b.total ? `${b.total} pending posts have no image file left: they come back when their query / source is crawled again.` : 'Nothing pending.' });
}
function fitPending(args, brand) {
  const types = fitTypes(brand), others = knownBrandIds();
  const decisions = readJson(path.resolve(need(args, 'file')), []);
  const all = readPending(brand.id);
  const by = new Map((Array.isArray(decisions) ? decisions : []).filter((d) => d && d.id).map((d) => [String(d.id), d]));
  const keep = [], off = [], refused = [], bad = [];
  for (const x of all) {
    const d = by.get(String(x.collector_id || x.post_url)) || by.get(String(x.post_url));
    if (!d) continue;
    const no = refuseDecision(d, brand.id, others);
    if (no) { refused.push({ id: x.collector_id || x.post_url, why: no }); continue; }
    if (d.fit === false) { off.push({ x, reason: String(d.reason) }); continue; }
    const type = matchType(d.type, types);
    if (!type) { bad.push({ id: x.collector_id || x.post_url, type: String(d.type || '').trim() }); continue; }
    keep.push({ ...x, images: goodImages(x), product_fit: { type, reason: String(d.reason || '') } });
  }
  if (bad.length) throw badTypes(bad, types);
  const added = [], duplicates = [], rejected = [];
  // one addPosts per origin (discovery query or reference source), same store checks as ingest
  const groups = new Map();
  for (const p of keep.filter((p) => p.images.length)) { const k = `${p.source || ''}|${p.query || ''}`; groups.set(k, [...(groups.get(k) || []), p]); }
  for (const [k, posts] of groups) {
    const [sid, query] = k.split('|');
    const platform = posts[0].platform || '';
    const src = { id: sid || `discovery-${platform}`, url: posts[0].source_url || '', name: platform, platform, found_by: posts[0].found_by || '', ...(query ? { query } : {}) };
    const r = addPosts(brand.id, src, posts, { run: posts[0].run || '', productFit: brandDiscovery(brand.social).product_fit, requireFit: true });
    added.push(...r.added); duplicates.push(...r.duplicates); rejected.push(...r.rejected);
  }
  const offLog = logRejected(brand.id, off.map(({ x, reason }) => ({ post_url: x.post_url, author: x.author || '', platform: x.platform || '', found_by: x.found_by || '', source: x.source || '', ...(x.query ? { query: x.query } : {}), run: x.run || '', reason: `off-brand: ${reason.replace(/^off-brand:\s*/, '')}` })));
  const decided = [...keep.filter((p) => p.images.length).map((p) => p.post_url), ...off.map(({ x }) => x.post_url)];
  removePending(brand.id, decided);
  const left = readPending(brand.id).length;
  out({ brand: brand.id, added: added.length, ids: added, duplicates: duplicates.length, rejected_off_brand: (offLog?.logged || 0) + rejected.length, ...(refused.length ? { refused } : {}), pending_left: left,
    next: refusedNext(refused) + (left ? `${left} still pending: node scripts/collect.mjs pending --brand ${brand.id} for the next batch (or leave them for the next run).` : 'Nothing pending.') + (added.length ? ` Then node scripts/store.mjs classify --brand ${brand.id} for the new Library posts.` : '') });
}

if (isMain(import.meta.url)) main(async () => {
  const args = parseArgs();
  const cmd = args._[0] || '';
  if (cmd === 'status') return out({ statuses: STATUSES, adapters: Object.fromEntries(Object.keys(REGISTRY).map((id) => [id, adapterStatus(id)])) });
  if (cmd === 'fit') return fit(args);
  if (cmd === 'pending') return pending(args);
  if (cmd === 'check-chrome') return (await import('./chrome-check.mjs')).checkChrome(args);
  if (cmd === 'install') return (await import('./collect-pagemode.mjs')).install(args);
  if (cmd === 'script') return (await import('./collect-pagemode.mjs')).script(args);
  if (cmd === 'from-page') return (await import('./collect-pagemode.mjs')).fromPage(args);
  throw new Error('Lệnh: install | check-chrome | script | from-page | fit | pending | status');
});
