// Generic collector (Mode 1 step 1.2), the ONE research path: the agent opens the page or search URL with Playwright MCP,
// scrolls it with normal Playwright MCP actions (scrollBy from next.scroll, mouse.wheel only as the fallback, 1-2 times, research.scroll_wait_seconds) and decides when
// to stop; to read the data it runs ONE extract script that reads what is on the page now and returns at once. The AI writes
// / fixes the platform adapters (scripts/platforms/<platform>.mjs, SELECTORS) and judges the images.
//   node scripts/collect.mjs script (--platform <id> (--query <q> | --url <u>) | --brand <id> --for-query <qid> | --for-source <sid>) [--seen <file>] [--max N]
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
//        product_fit, the others move to rejected[] (what ingest needs for a discovery query)
//   node scripts/collect.mjs status      every adapter with its status (untested | ok | broken)
// Read only: it never likes, saves, follows, comments, messages, joins, posts or signs in. A login wall / captcha / block
// page = state blocked, nothing more opened. Cookies stay in Chrome; nothing secret is written.
import path from 'node:path';
import { main, out, isMain, parseArgs, need, settings, loadBrand, readJson, writeJson, workspace, stamp } from './lib.mjs';
import { openRun, nextTask, timeInfo, TIME_NEXT } from './research.mjs';
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
    return { kind: 'source', id: s.id, platform: s.platform || '', url: s.url, found_by: 'reference page', name: s.name, dir: s.dir, raw_file: s.raw_file, max: num(args.max) || share || 0, mode: run.mode || {}, known_file: s.known_file || '', started: s.issued_at || '' };
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
export function applyDecisions(raw, decisions) {
  const by = new Map((Array.isArray(decisions) ? decisions : []).filter((d) => d && d.id).map((d) => [String(d.id), d]));
  const posts = [], rejected = [...(raw.rejected || [])];
  let fit = 0, off = 0;
  const undecided = [];
  for (const p of raw.posts || []) {
    const d = by.get(String(p.collector_id || p.post_url));
    if (!d) { posts.push(p); undecided.push(p.collector_id || p.post_url); continue; }
    if (d.fit === false) { rejected.push({ post_url: p.post_url, author: p.author || '', reason: String(d.reason || 'not a product the brand sells') }); off++; continue; }
    if (!String(d.type || '').trim()) { posts.push(p); undecided.push(`${p.collector_id}: fit without type`); continue; }
    posts.push({ ...p, product_fit: { type: String(d.type).trim(), reason: String(d.reason || '') } }); fit++;
  }
  return { raw: { ...raw, posts, rejected }, fit, off, undecided };
}
// Counters per task (cumulative; <task dir>/progress.json holds read + need, kept / rejected come from raw.json).
// kept here = fit kept per task; ingest takes at most the share (will_ingest), and `report` counts what ingest really added.
// need = the task's share; need_more = max(0, need - kept). One definition for from-page, fit and the run progress.
export function counters(raw, read, need = 0) {
  const posts = raw?.posts || [];
  const kept = posts.filter((p) => p.product_fit && String(p.product_fit.type || '').trim()).length;
  const rejected = (raw?.rejected || []).length;
  const r = Math.max(Number(read) || 0, posts.length + rejected);
  const n = Math.max(0, Number(need) || 0);
  return { read: r, pending_fit: Math.max(0, r - kept - rejected), kept, rejected, need: n, need_more: Math.max(0, n - kept), will_ingest: n ? Math.min(kept, n) : kept };
}
export const counterLine = (c) => `read ${c.read} · kept ${c.kept} · rejected ${c.rejected}${c.pending_fit ? ` · to fit ${c.pending_fit}` : ''}${c.need ? ` · need ${c.need} · missing ${c.need_more}` : ''}${c.need && c.kept > c.need ? ` · will ingest ${c.need} (share ${c.need})` : ''}`;
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

function fit(args) {
  const brand = loadBrand(need(args, 'brand'));
  const task = resolveTask(args, openRun(args, brand).run);
  const raw = readJson(task.raw_file, null);
  if (!raw) throw new Error(`Chưa có ${task.raw_file}: chạy collect.mjs trước.`);
  const file = path.resolve(need(args, 'file'));
  const r = applyDecisions(raw, readJson(file, []));
  writeJson(task.raw_file, r.raw);
  const c = counters(r.raw, readJson(progressFile(task), { read: 0 }).read, task.max);
  writeJson(progressFile(task), { read: c.read, need: c.need });
  const stop = fitStop(c, settings().research?.max_read_factor);
  const summary = counterLine(c);
  if (task.kind !== 'standalone') track('crawl', { brand: brand.id, detail: `${task.id}: ${summary}` });
  const tm = timeInfo(task.started);
  out({ brand: brand.id, raw_file: task.raw_file, fit: r.fit, off_brand: r.off, undecided: r.undecided, ...c, summary, stop, ...(tm.started ? { time_limit_minutes: tm.time_limit_minutes, started: tm.started, elapsed: tm.elapsed } : {}), ...(tm.time_over && !stop ? { stop: 'time' } : {}),
    next: tm.time_over && !stop ? TIME_NEXT : stop === 'target' ? 'Đủ bài giữ lại (need_more 0): dừng, rồi ingest + result.' : stop === 'poor_source' ? 'Nguồn này ít bài hợp thương hiệu: dừng, chuyển nguồn khác (ingest + result).' : c.need_more > 0 && !r.undecided.length ? 'Còn thiếu bài: cuộn tiếp, extract, from-page, nhìn ảnh, fit lại.' : r.undecided.length ? 'Còn bài chưa có quyết định: ingest sẽ từ chối bài thiếu product_fit.type; quyết nốt rồi chạy lại fit.' : 'node scripts/research.mjs ingest ... rồi result ...' });
}

if (isMain(import.meta.url)) main(async () => {
  const args = parseArgs();
  const cmd = args._[0] || '';
  if (cmd === 'status') return out({ statuses: STATUSES, adapters: Object.fromEntries(Object.keys(REGISTRY).map((id) => [id, adapterStatus(id)])) });
  if (cmd === 'fit') return fit(args);
  if (cmd === 'script') return (await import('./collect-pagemode.mjs')).script(args);
  if (cmd === 'from-page') return (await import('./collect-pagemode.mjs')).fromPage(args);
  throw new Error('Lệnh: script | from-page | fit | status');
});
