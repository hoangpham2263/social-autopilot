// Generic collector (Mode 1 step 1.2): a SCRIPT reads the raw data of a page, the AI only writes/fixes the platform adapters
// (scripts/platforms/<platform>.mjs) and judges the images. Attaches to the Chrome the user already signed in to
// (settings research.browser: cdp or user_data_dir, same as crawl-fb.mjs), opens ONE tab, scrolls with random pauses
// (research.delay_seconds, never below 5-15 s), asks the adapter for the posts on screen after every scroll, downloads the
// images and writes the raw.json that `research.mjs ingest --source|--query` already reads. Nothing else changes downstream.
//   node scripts/collect.mjs --brand <id> --for-query <qid> [--max N]    a discovery query of the open run (research.mjs next)
//   node scripts/collect.mjs --brand <id> --for-source <sid> [--max N]   a reference page of the open run (non-Facebook)
//   node scripts/collect.mjs --platform <id> (--url <page> | --query <keyword|#hashtag>) [--brand <id>] [--max N] [--out <dir>]
//        standalone (testing an adapter): writes <out>/raw.json (default workspace/tmp/collect/...), --brand = skip posts it has
//   node scripts/collect.mjs fit --brand <id> (--for-query <qid> | --for-source <sid>) --file decisions.json
//        decisions [{ id, fit: true, type, reason } | { id, fit: false, reason }] (the agent LOOKED at the images): fit posts get
//        product_fit, the others move to rejected[] (what ingest needs for a discovery query)
//   node scripts/collect.mjs status      every adapter with its status (untested | ok | broken)
// Options: --max-steps N (scroll steps, default 10 for a query, research.browser.max_scroll_steps for a page), --images N (per post,
// default 4), --cdp <url>, --date YYYY-MM-DD (run of --for-*).
// Read only: it never likes, saves, follows, comments, messages, joins, posts or signs in. A login wall / captcha / block
// page stops it at once (state blocked, nothing more opened). Cookies stay in Chrome; nothing secret is written.
import fs from 'node:fs';
import path from 'node:path';
import { main, out, fail, isMain, parseArgs, need, settings, loadBrand, readJson, writeJson, workspace, stamp } from './lib.mjs';
import { track } from './progress.mjs';
import { openRun, nextTask } from './research.mjs';
import { knownPosts } from './store.mjs';
import { openBrowser, download, pause, makeCursor } from './crawl-fb.mjs';
import { REGISTRY, STATUSES, getAdapter, adapterStatus, isTrusted, platformIds } from './platforms/index.mjs';

// ---------- pure parts (tests/collect.test.mjs) ----------
export const DEFAULT_DELAY = [5, 15];
// research.delay_seconds, never lower than the defaults (5-15 s).
export function delayRange(cfg) {
  const [a, b] = Array.isArray(cfg) ? cfg.map(Number) : [];
  const lo = Math.max(Number.isFinite(a) ? a : 0, DEFAULT_DELAY[0]);
  const hi = Math.max(Number.isFinite(b) ? b : 0, DEFAULT_DELAY[1], lo);
  return [lo, hi];
}
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

// ---------- browser ----------
async function collectPage({ context, task, adapter, delay, maxSteps, cursor, log }) {
  const page = await context.newPage();
  const found = [], seen = new Set();
  let state = '', note = '', read = 0, skippedKnown = 0, steps = 0, idle = 0, stop = '';
  try {
    await page.goto(task.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await pause(delay);
    for (let step = 0; step < maxSteps && !state; step++) {
      steps++;
      const wall = await adapter.isLoginWall(page);
      if (wall) { state = 'blocked'; note = wall; break; }
      let posts;
      try { posts = await adapter.extract(page, { found_by: task.found_by }); } catch (e) { state = 'partial'; note = `error: extract failed (${String(e.message || e).split('\n')[0].slice(0, 160)})`; break; }
      let fresh = 0;
      for (const p of posts) {
        if (!p?.id || seen.has(p.id)) continue;
        seen.add(p.id); fresh++; read++;
        const v = cursor.take({ post_url: p.url, alt_urls: p.alt_urls || [] });
        if (v === 'known') skippedKnown++;
        if (v === 'collect') { found.push(p); if (task.max && found.length >= task.max) { state = 'limit'; break; } }
        if (cursor.stop) { stop = cursor.stop; state = cursor.stop; break; }
      }
      log(`step ${step + 1}: ${posts.length} on screen, ${fresh} new, ${found.length} kept`);
      if (state) break;
      idle = fresh ? 0 : idle + 1;
      if (idle >= 3) { state = 'end'; break; }
      await page.evaluate('window.scrollBy(0, Math.round(innerHeight * 0.9))'); // the only action besides reading
      await pause(delay);
      if (step === maxSteps - 1) { state = task.kind === 'source' ? 'partial' : 'end'; if (task.kind === 'source') note = `stopped after ${maxSteps} scroll steps (--max-steps)`; }
    }
  } finally { await page.close().catch(() => {}); }
  return { found, state, note, read, skippedKnown, steps, stop };
}

async function runCollect(args) {
  const cfg = { ...(settings().research?.browser || {}) };
  if (args.cdp && args.cdp !== true) cfg.cdp = String(args.cdp);
  const brandId = args.brand && args.brand !== true ? String(args.brand) : '';
  const brand = brandId ? loadBrand(brandId) : null;
  const run = args['for-query'] || args['for-source'] ? openRun(args, brand || loadBrand(need(args, 'brand'))).run : null;
  const task = resolveTask(args, run);
  const adapter = getAdapter(task.platform);
  if (!adapter) return fail(`Chưa có adapter cho nền tảng "${task.platform}": viết scripts/platforms/${task.platform || '<platform>'}.mjs rồi đăng ký trong scripts/platforms/index.mjs (docs/research.md "Adapter workflow"); trong lúc đó lấy bằng Playwright MCP.`, { platform: task.platform, adapter: adapterStatus(task.platform) });
  const delay = delayRange(settings().research?.delay_seconds);
  const maxSteps = Number(args['max-steps']) || (task.kind === 'source' ? Number(cfg.max_scroll_steps) || 300 : 10);
  const known = task.known_file ? readJson(task.known_file, { count: 0 }) : brand ? knownPosts(brand.id) : { count: 0 };
  const cursor = makeCursor({ mode: task.mode, known });
  const lines = [];
  const log = (m) => { lines.push(`${stamp()} ${m}`); process.stderr.write(m + '\n'); };
  const { context, close } = await openBrowser(cfg);
  let res;
  try { res = await collectPage({ context, task, adapter, delay, maxSteps, cursor, log }); } catch (e) { res = { found: [], state: 'partial', note: `error: ${String(e.message || e).split('\n')[0].slice(0, 200)}`, read: 0, skippedKnown: 0, steps: 0, stop: '' }; }
  // Images of the posts kept (this session's cookies are used for the request and never written).
  const rawDir = path.join(task.dir, 'raw');
  fs.mkdirSync(rawDir, { recursive: true });
  const perPost = Math.max(1, Number(args.images) || 4);
  const posts = [];
  let noImage = 0;
  try {
    for (const p of res.found) {
      const images = [];
      for (const [k, u] of (p.image_urls || []).slice(0, perPost).entries()) {
        const f = await download(context, u, path.join(rawDir, `${fileId(p.id)}-${k + 1}`), { Referer: p.url });
        if (f) images.push(`raw/${path.basename(f)}`);
      }
      if (!images.length) { noImage++; continue; }
      posts.push(toRawPost(p, images, task.platform));
    }
  } finally { await close(); }
  const suspect = !res.read && res.state !== 'blocked' && !/^error/.test(res.note);
  const note = res.note || (suspect ? 'error: 0 posts read (page empty, or the adapter selectors no longer fit) - verify with Playwright MCP, fix scripts/platforms/' + task.platform + '.mjs' : noImage && !posts.length ? 'error: posts read but no image could be downloaded (adapter image selectors / host?)' : '');
  writeJson(task.raw_file, rawShape(task, posts, { rejected: [] }));
  fs.appendFileSync(path.join(task.dir, 'collect.log'), lines.join('\n') + '\n');
  const st = adapterStatus(task.platform);
  const state = suggestedState(task.kind, { blocked: res.state === 'blocked', error: /^error/.test(note), limit: res.state === 'limit', read: res.read, stop: res.stop });
  const idArg = task.kind === 'query' ? `--query ${task.id}` : task.kind === 'source' ? `--source ${task.id}` : '';
  const forArg = task.kind === 'query' ? `--for-query ${task.id}` : `--for-source ${task.id}`;
  const b = brandId || '<id>';
  const trust = isTrusted(task.platform) && !suspect && !/^error/.test(note);
  const next = res.state === 'blocked' ? `Bị chặn: node scripts/research.mjs result --brand ${b} ${idArg} --state blocked --note "${note.replace(/"/g, "'")}" (dừng nền tảng này, không thử lại trong lượt).`
    : !trust ? `Chưa tin được kết quả (adapter ${st.status}${suspect || /^error/.test(note) ? `, ${note.slice(0, 80)}` : ''}): mở cùng trang bằng Playwright MCP, so với review[]; đúng thì set status "ok" + ngày trong scripts/platforms/index.mjs, sai thì sửa adapter rồi chạy lại collect.mjs; chưa sửa được thì lấy tay (docs/research.md).`
      : task.kind === 'query' ? `Nhìn ảnh review[].image (đúng loại sản phẩm?), ghi decisions rồi: node scripts/collect.mjs fit --brand ${b} ${forArg} --file <decisions.json>; node scripts/research.mjs ingest --brand ${b} ${idArg}; node scripts/research.mjs result --brand ${b} ${idArg} --state ${state}`
        : `node scripts/research.mjs ingest --brand ${b} ${idArg}; node scripts/research.mjs result --brand ${b} ${idArg} --state ${state} (đúng loại sản phẩm: lọc ở 1.3, hoặc collect.mjs fit trước ingest)`;
  if (task.kind !== 'standalone') track('crawl', { brand: brandId, detail: `${task.id}: collected ${posts.length} (${state})` });
  out({ brand: brandId, platform: task.platform, kind: task.kind, [task.kind === 'source' ? 'source' : 'query']: task.id, url: task.url, found_by: task.found_by, adapter: st, trusted: trust,
    steps: res.steps, read: res.read, collected: posts.length, skipped_known: res.skippedKnown, dropped_no_image: noImage, max: task.max || null, state: res.state || 'end', suggested_state: state, ...(note ? { note } : {}), raw_file: task.raw_file,
    review: posts.map((p, i) => ({ n: i + 1, id: p.collector_id, url: p.post_url, author: p.author, caption: p.caption.slice(0, 140), image: path.join(task.dir, p.images[0]) })), next });
  process.exit(0); // the CDP connection would keep the process alive
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
  if (cmd) throw new Error('Lệnh: (không lệnh) | fit | status');
  await runCollect(args);
});
