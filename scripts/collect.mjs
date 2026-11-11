// Generic collector (Mode 1 step 1.2), the ONE research path: the agent opens the page or search URL with Playwright MCP,
// scrolls it with normal Playwright MCP actions (End / mouse wheel, 1-2 times, research.scroll_wait_seconds) and decides when
// to stop; to read the data it runs ONE extract script that reads what is on the page now and returns at once. The AI writes
// / fixes the platform adapters (scripts/platforms/<platform>.mjs, SELECTORS) and judges the images.
//   node scripts/collect.mjs script (--platform <id> (--query <q> | --url <u>) | --brand <id> --for-query <qid> | --for-source <sid>) [--seen <file>] [--max N]
//        prints the extract script for browser_run_code_unsafe: no navigation, no scroll, no pause; returns ONE line
//        { total, total_on_page, reason, tag, b64 } with only the tiles whose id is not in the task's seen list
//        (<task dir>/seen.json, written by from-page; --seen <file> = another JSON list of ids)
//   node scripts/collect.mjs from-page --brand <id> (--for-query <qid> | --for-source <sid>) --b64 <line> | --file <result.json> | --stdin [--images N]
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
import { main, out, isMain, parseArgs, need, loadBrand, readJson, writeJson, workspace, stamp } from './lib.mjs';
import { openRun, nextTask } from './research.mjs';
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
      return { kind: 'query', id: q.id, platform: q.platform, url: q.url, found_by: q.found_by, dir: q.dir, raw_file: q.raw_file, max: num(args.max) || share || 30, mode: { full: true }, known_file: '' };
    }
    const s = run.sources?.find((x) => x.id === String(args['for-source']));
    if (!s) throw new Error(`Nguồn "${args['for-source']}" không có trong lượt này.`);
    const share = nxt.step === 'reference' && nxt.source === s.id ? nxt.share : 0;
    return { kind: 'source', id: s.id, platform: s.platform || '', url: s.url, found_by: 'reference page', name: s.name, dir: s.dir, raw_file: s.raw_file, max: num(args.max) || share || 0, mode: run.mode || {}, known_file: s.known_file || '' };
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
  out({ brand: brand.id, raw_file: task.raw_file, fit: r.fit, off_brand: r.off, undecided: r.undecided, next: r.undecided.length ? 'Còn bài chưa có quyết định: ingest sẽ từ chối bài thiếu product_fit.type; quyết nốt rồi chạy lại fit.' : 'node scripts/research.mjs ingest ... rồi result ...' });
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
