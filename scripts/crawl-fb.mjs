// Mode 1 step 1.2, scripted: crawl every source of an open research run (research.mjs start) with Playwright driving
// the user's own, already signed-in Chrome, then ingest. "Crawl everything fast, then filter" (RUNBOOK 1.3): no AI
// agent clicking post by post; the agent only steps in when a source ends "blocked" or "error".
//   node scripts/crawl-fb.mjs --brand <id> [--source a,b] [--date YYYY-MM-DD] [--cdp http://127.0.0.1:9222] [--redo]
//        [--max-steps N]
// Browser (settings research.browser): { cdp: "http://127.0.0.1:9222" } attaches to a Chrome started with
// --remote-debugging-port (RUNBOOK "Chrome cho crawl"); or { user_data_dir: "<profile folder outside the repo>" }
// launches Chrome on that persistent profile. Cookies stay in Chrome's profile, never in this repo.
// Per source: open the page, scroll; per scroll step ONE page.evaluate expands "See more", reads every new post
// (link + ids, caption, date, image URLs, media type) and scrolls; random pause research.delay_seconds per step.
// Stop rules = research.mjs (new: 3 known in a row; backfill: fast past known posts until oldest_seen; full; --since;
// the source's share of --max-posts; end of page). A feed that stops loading (Facebook often shows 1-3 posts then
// nothing) is retried (wait for the loader, End key, scroll back and forth), then the source's /posts tab, then the
// /photos_by and /reels grids (each new tile opened once for its caption). --max-posts is split evenly round-robin:
// each pass gives every source still having posts an even share; what a dry source leaves goes to the others.
// After each pass: images downloaded to <source>/raw/, <source>/raw.json = { page, posts } (this pass only),
// research.mjs ingest (dedupe by link/id, dHash, caption). At the end research.mjs result per source.
// Checkpoint / captcha / login wall: stop at once, that source "blocked", no other source opened.
// Extraction finds 0 posts on a page that clearly shows posts: "partial" with note "error: selectors ...".
// Never likes, comments, follows, shares or sends messages; the only click is "See more" inside a post's text.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main, out, isMain, parseArgs, need, settings, loadBrand, readJson, writeJson, toolRoot, stamp } from './lib.mjs';
import { openRun } from './research.mjs';
import { postKey, postIds } from './store.mjs';
import { SELECTORS, extractFeed, extractGrid, extractViewer, browserStep, parseFbDate, detectBlock, tabUrl, TAB_MODE } from './fb-extract.mjs';

// ---------- pure parts (tests/crawl-fb.test.mjs) ----------
// total split over n sources, larger shares first: 10 over 3 -> [4, 3, 3]; 2 over 3 -> [1, 1, 0].
export function splitEven(total, n) {
  if (!n) return [];
  const base = Math.floor(total / n), extra = total % n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

// The brand's --max-posts across its sources, round-robin. crawl(src, share) -> { added, state } (share 0 = no cap).
// Pass after pass, every source still having posts (not crawled yet, or stopped at its share) gets an even part of
// what is left; a source that ends (end/known/since/error) leaves its part to the others. Blocked stops everything.
// Sources never opened (budget used up first) end as "skipped" (not "dried up").
export async function roundRobin(sources, budget, crawl, { maxPasses = 25 } = {}) {
  const st = new Map(sources.map((s) => [s.id, { added: 0, state: null, note: '', passes: 0 }]));
  const apply = (s, r) => { const x = st.get(s.id); x.added += r.added || 0; x.state = r.state; x.note = r.note || ''; x.passes++; return r.state === 'blocked'; };
  let blocked = false;
  if (!budget) {
    for (const s of sources) if (apply(s, await crawl(s, 0))) { blocked = true; break; }
  } else {
    for (let pass = 0; pass < maxPasses && !blocked; pass++) {
      const left = budget - [...st.values()].reduce((a, x) => a + x.added, 0);
      const active = sources.filter((s) => [null, 'limit'].includes(st.get(s.id).state));
      if (left <= 0 || !active.length) break;
      const shares = splitEven(left, active.length);
      for (const [i, s] of active.entries()) {
        if (!shares[i]) continue;
        if (apply(s, await crawl(s, shares[i]))) { blocked = true; break; }
      }
    }
  }
  for (const s of sources) {
    const x = st.get(s.id);
    if (x.state === null) Object.assign(x, blocked ? { state: 'pending', note: 'not opened: another source was blocked' } : { state: 'skipped', note: 'quota: --max-posts used up before this source' });
  }
  return { blocked, sources: Object.fromEntries(st) };
}

// Where to stop on one source, post by post (same rules as research.mjs stopRule). take(post) -> 'seen' | 'known' |
// 'skip' (backfill, still above oldest_seen) | 'old' (before --since) | 'collect'; .stop = end state once reached.
export function makeCursor({ mode = {}, known = {} } = {}) {
  const keys = new Set([...(known.brand_post_urls || []), ...(known.post_urls || [])].map(postKey).filter(Boolean));
  const ids = new Set(known.brand_post_ids || []);
  const oldest = known.oldest_seen || null;
  const c = { seen: new Set(), streak: 0, old: 0, stop: null, passedOldest: !mode.backfill || !known.count || !oldest };
  c.take = (p) => {
    const urls = [p.post_url, ...(p.alt_urls || [])].filter(Boolean);
    const pk = urls.map(postKey).filter(Boolean), pid = urls.flatMap(postIds);
    const k = pk[0] || pid[0] || '';
    if (!k || c.seen.has(k) || pk.some((x) => c.seen.has(x))) return 'seen';
    pk.forEach((x) => c.seen.add(x)); c.seen.add(k);
    const isKnown = pk.some((x) => keys.has(x)) || pid.some((x) => ids.has(x));
    if (!c.passedOldest) {
      const atOldest = (oldest.post_id && pid.includes(oldest.post_id)) || (oldest.post_url && pk.includes(postKey(oldest.post_url)));
      const older = p.posted_date && oldest.date && p.posted_date < oldest.date;
      if (atOldest || older) c.passedOldest = true;
      if (!c.passedOldest || isKnown) return isKnown ? 'known' : 'skip';
    }
    if (isKnown) {
      c.streak++;
      if (!mode.backfill && !mode.full && known.count && c.streak >= 3) c.stop = 'known';
      return 'known';
    }
    c.streak = 0;
    if (mode.since && p.posted_date && p.posted_date < mode.since) { if (++c.old >= 2) c.stop = 'since'; return 'old'; }
    c.old = 0;
    return 'collect';
  };
  return c;
}

// A post read from the page -> raw.json post (images downloaded later).
export function toRawPost(p, now = new Date()) {
  return { post_url: p.post_url, alt_urls: p.alt_urls || [], posted_date: parseFbDate(p.date_text, now, p.utime), date_text: p.date_text || '', caption: p.caption || '', image_urls: (p.images || []).map((x) => x.src), media_type: p.media_type || '' };
}

// 0 posts read although the page clearly shows posts -> the selectors no longer fit Facebook.
export const selectorsBroken = (stepsWithoutPosts, signals = {}) => stepsWithoutPosts >= 3 && (signals.messages > 0 || signals.post_links > 2);

// ---------- browser ----------
async function loadPlaywright() {
  for (const name of ['playwright-core', 'playwright']) { try { return (await import(name)).chromium; } catch { /* next */ } }
  throw new Error('Thiếu thư viện Playwright: chạy "npm install" trong thư mục tool một lần.');
}
async function openBrowser(cfg) {
  const chromium = await loadPlaywright();
  if (cfg.user_data_dir) {
    const dir = path.resolve(toolRoot, cfg.user_data_dir);
    if (dir.startsWith(toolRoot + path.sep)) throw new Error('research.browser.user_data_dir phải nằm ngoài thư mục tool (cookie không bao giờ vào repo).');
    const context = await chromium.launchPersistentContext(dir, { channel: cfg.channel || 'chrome', headless: false, viewport: null });
    return { context, close: () => context.close() };
  }
  const cdp = cfg.cdp || 'http://127.0.0.1:9222';
  let browser;
  try { browser = await chromium.connectOverCDP(cdp, { timeout: 15000 }); } catch (e) {
    throw new Error(`Không nối được Chrome qua ${cdp} (${String(e.message || e).split('\n')[0]}). Mở Chrome với --remote-debugging-port (RUNBOOK "Chrome cho crawl") rồi chạy lại.`);
  }
  const context = browser.contexts()[0];
  if (!context) throw new Error('Chrome không có profile nào mở.');
  return { context, close: async () => {} }; // the user's Chrome stays open; only our tabs are closed
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pause = (range, scale = 1) => sleep(Math.round(1000 * scale * (range[0] + Math.random() * (range[1] - range[0]))));
const feedExpr = (opts) => `(${browserStep})(${extractFeed}, ${JSON.stringify(SELECTORS)}, ${JSON.stringify(opts)})`;
const gridExpr = (scroll) => `(() => { const d = (${extractGrid})(document, ${JSON.stringify(SELECTORS)}); window.scrollBy(0, Math.round(innerHeight * ${scroll})); return d; })()`;
const viewerExpr = () => `(${extractViewer})(document, ${JSON.stringify(SELECTORS)})`;

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
async function download(context, url, fileBase) {
  try {
    const r = await context.request.get(url, { timeout: 30000 });
    if (!r.ok()) return '';
    const ext = EXT[String(r.headers()['content-type'] || '').split(';')[0].trim()];
    if (!ext) return '';
    const file = fileBase + ext;
    fs.writeFileSync(file, await r.body());
    return file;
  } catch { return ''; }
}

function node(script, args) {
  const r = spawnSync(process.execPath, [path.join(toolRoot, 'scripts', script), ...args], { encoding: 'utf8', windowsHide: true, env: process.env });
  try { return JSON.parse(r.stdout); } catch { return { ok: false, error: (r.stdout + r.stderr).slice(0, 500) }; }
}

// One source across passes: its tab(s), cursor and counters stay between passes.
function sourceCrawler({ context, brand, src, mode, cfg, delay, maxSteps, log }) {
  const known = readJson(src.known_file, { count: 0 });
  const cursor = makeCursor({ mode, known });
  const tabs = ['feed', ...[].concat(cfg.fallback_tabs ?? ['posts', 'photos', 'reels'])];
  const s = { page: null, viewer: null, tab: 0, opened: false, seenOnTab: 0, page_info: null, counter: 0, tabsUsed: [], stepsWithout: 0, lastSignals: {} };
  const stallPosts = Number(cfg.stall_posts ?? 5);
  const fast = () => mode.backfill && !cursor.passedOldest;

  async function gotoTab() {
    const name = tabs[s.tab];
    const url = name === 'feed' ? src.url : tabUrl(src.url, name);
    s.page ||= await context.newPage();
    await s.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await pause(delay);
    s.seenOnTab = 0; s.stepsWithout = 0; s.tabsUsed.push(name);
    log(`${src.id}: open ${name} ${url}`);
  }
  // A stalled tab: next tab, or the end of the source.
  async function nextTab(reason) {
    if (s.seenOnTab >= stallPosts || s.tab >= tabs.length - 1) return false;
    log(`${src.id}: ${tabs[s.tab]} stopped loading after ${s.seenOnTab} posts (${reason}); trying ${tabs[s.tab + 1]}`);
    s.tab++;
    await gotoTab();
    return true;
  }

  async function pass(share) {
    const collected = [];
    let state = null, note = '';
    if (!s.opened) { s.opened = true; await gotoTab(); }
    let idle = 0;
    for (let step = 0; step < maxSteps && !state; step++) {
      const mode2 = TAB_MODE[tabs[s.tab]];
      const data = mode2 === 'feed'
        ? await s.page.evaluate(feedExpr({ expand: !fast(), settle_ms: 700, scroll: fast() ? 3 : 1.2 }))
        : await s.page.evaluate(gridExpr(fast() ? 3 : 1.5));
      const why = detectBlock(data.block);
      if (why) { state = 'blocked'; note = why; break; }
      if (data.page && !s.page_info && (data.page.name || data.page.avatar)) s.page_info = data.page;
      let fresh = 0;
      if (mode2 === 'feed') {
        s.lastSignals = data.signals;
        for (const p of data.posts) {
          if (!p.post_url) continue; // its link appears on hover; read on a later step
          const raw = toRawPost(p);
          const v = cursor.take(raw);
          if (v === 'seen') continue;
          fresh++; s.seenOnTab++;
          if (v === 'collect') { collected.push(raw); if (share && collected.length >= share) { state = 'limit'; break; } }
          if (cursor.stop) { state = cursor.stop; break; }
        }
        s.stepsWithout = fresh || s.seenOnTab ? 0 : s.stepsWithout + 1;
        if (!state && !s.seenOnTab && selectorsBroken(s.stepsWithout, data.signals)) { state = 'partial'; note = `error: selectors (page shows ${data.signals.messages} post texts / ${data.signals.post_links} post links, 0 posts read); fix scripts/fb-extract.mjs SELECTORS`; break; }
      } else {
        for (const t of data.tiles) {
          const v = cursor.take({ post_url: t.url, alt_urls: [] });
          if (v === 'seen') continue;
          fresh++; s.seenOnTab++;
          if (v === 'collect') {
            // Open the tile once (its own page) for the caption, date and full image.
            s.viewer ||= await context.newPage();
            await s.viewer.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
            await pause(delay);
            const vw = await s.viewer.evaluate(viewerExpr());
            const vwhy = detectBlock(vw.block);
            if (vwhy) { state = 'blocked'; note = vwhy; break; }
            const raw = toRawPost({ ...vw, post_url: t.url, alt_urls: [...new Set([vw.post_url, ...vw.alt_urls].filter((u) => u && u !== t.url))], images: vw.images.length ? vw.images : t.thumb ? [{ src: t.thumb }] : [], media_type: t.media_type === 'video' ? 'video' : vw.media_type });
            if (mode.since && raw.posted_date && raw.posted_date < mode.since) { if (++cursor.old >= 2) { state = 'since'; break; } continue; }
            cursor.old = 0;
            collected.push(raw);
            if (share && collected.length >= share) { state = 'limit'; break; }
          }
          if (cursor.stop) { state = cursor.stop; break; }
        }
      }
      if (state) break;
      if (!fresh) {
        if (data.signals?.loading) { await sleep(2500 + Math.random() * 2500); idle += 0.5; } else idle++;
        if (idle >= 1 && idle < 3) { // nudge: scroll back a little, then press End (Facebook loads on a real scroll)
          await s.page.evaluate('window.scrollBy(0, -Math.round(innerHeight * 0.6))');
          await sleep(800);
          await s.page.keyboard.press('End').catch(() => {});
        }
        if (idle >= 3) {
          if (await nextTab(`no new posts after ${Math.ceil(idle)} scrolls`)) { idle = 0; continue; }
          state = 'end';
          break;
        }
      } else idle = 0;
      await pause(delay, fast() ? 0.5 : 1);
      if (step === maxSteps - 1) { state = 'partial'; note = `stopped after ${maxSteps} scroll steps (--max-steps)`; }
    }
    return { state: state || 'partial', note, collected, page_info: s.page_info, tabs: [...new Set(s.tabsUsed)] };
  }
  // Only the tabs this crawl opened are closed; the user's own tabs and Chrome stay.
  pass.close = async () => { for (const p of [s.page, s.viewer]) if (p) await p.close().catch(() => {}); };
  return pass;
}

// Downloads one pass's images, writes raw.json { page, posts } (this pass only), ingests -> added.
async function savePass({ context, brand, src, res, n0 }) {
  const rawDir = path.join(src.dir, 'raw');
  fs.mkdirSync(rawDir, { recursive: true });
  let n = n0;
  const posts = [];
  for (const p of res.collected) {
    n++;
    const images = [];
    for (const [k, u] of p.image_urls.entries()) { const f = await download(context, u, path.join(rawDir, `${n}-${k + 1}`)); if (f) images.push(`raw/${path.basename(f)}`); }
    const { image_urls, date_text, ...rest } = p;
    posts.push({ ...rest, images, store: res.page_info?.name || src.name, page_pos: n });
  }
  let page = { name: res.page_info?.name || src.name };
  if (res.page_info?.avatar && !fs.existsSync(path.join(rawDir, 'avatar.jpg'))) {
    const f = await download(context, res.page_info.avatar, path.join(rawDir, 'avatar'));
    if (f) page.avatar = `raw/${path.basename(f)}`;
  } else for (const e of ['.jpg', '.png', '.webp']) if (fs.existsSync(path.join(rawDir, `avatar${e}`))) page.avatar = `raw/avatar${e}`;
  writeJson(src.raw_file, { page, crawled: stamp(), tool: 'crawl-fb', posts });
  const ing = node('research.mjs', ['ingest', '--brand', brand.id, '--source', src.id, '--date', src.run_date]);
  const r = (ing.sources || [])[0] || {};
  return { n, added: r.added || 0, duplicates: r.duplicates || 0, dropped: (r.dropped || []).length, error: ing.ok ? '' : ing.error };
}

async function crawlBrand(args) {
  const brand = loadBrand(need(args, 'brand'));
  const s = settings();
  const { run } = openRun(args, brand);
  const only = args.source && args.source !== true ? String(args.source).split(',').map((x) => x.trim()) : [];
  const sources = run.sources.filter((x) => (!only.length || only.includes(x.id)) && (args.redo || only.length || !x.result)).map((x) => ({ ...x, run_date: run.date }));
  if (!sources.length) return out({ brand: brand.id, date: run.date, sources: [], next: 'Mọi source của lượt này đã có kết quả; chạy research.mjs report.' });
  const cfg = s.research?.browser || {};
  if (args.cdp && args.cdp !== true) cfg.cdp = String(args.cdp);
  const delay = s.research.delay_seconds;
  const maxSteps = Number(args['max-steps']) || Number(cfg.max_scroll_steps) || 300;
  const mode = run.mode || {};
  const logLines = [];
  const log = (m) => { logLines.push(`${stamp()} ${m}`); process.stderr.write(m + '\n'); };
  const { context, close } = await openBrowser(cfg);
  const crawlers = new Map(), stats = new Map();
  const report = {};
  try {
    const rr = await roundRobin(sources, mode.max_posts || 0, async (src, share) => {
      if (!crawlers.has(src.id)) { crawlers.set(src.id, sourceCrawler({ context, brand, src, mode, cfg, delay, maxSteps, log })); stats.set(src.id, { n: 0, collected: 0, added: 0, duplicates: 0, dropped: 0, passes: 0, tabs: [] }); }
      const res = await crawlers.get(src.id)(share);
      const st = stats.get(src.id);
      const saved = res.collected.length ? await savePass({ context, brand, src, res, n0: st.n }) : { n: st.n, added: 0, duplicates: 0, dropped: 0 };
      Object.assign(st, { n: saved.n, collected: st.collected + res.collected.length, added: st.added + saved.added, duplicates: st.duplicates + saved.duplicates, dropped: st.dropped + saved.dropped, passes: st.passes + 1, tabs: res.tabs });
      log(`${src.id}: pass ${st.passes} share ${share || '∞'} -> ${res.collected.length} read, ${saved.added} added, state ${res.state}${res.note ? ` (${res.note})` : ''}`);
      return { added: saved.added, state: saved.error ? 'partial' : res.state, note: saved.error ? `error: ingest ${saved.error}` : res.note };
    });
    for (const src of sources) {
      const x = rr.sources[src.id];
      if (x.state !== 'pending') {
        const r = node('research.mjs', ['result', '--brand', brand.id, '--source', src.id, '--date', run.date, '--state', x.state, ...(x.note ? ['--note', x.note] : [])]);
        if (!r.ok) log(`${src.id}: result failed: ${r.error}`);
      }
      report[src.id] = { state: x.state, note: x.note, ...(stats.get(src.id) || { collected: 0, added: 0 }) };
    }
    fs.writeFileSync(path.join(path.dirname(sources[0].dir), 'crawl-fb.log'), logLines.join('\n') + '\n', { flag: 'a' });
    const blocked = Object.entries(report).filter(([, x]) => x.state === 'blocked');
    const errors = Object.entries(report).filter(([, x]) => /error/i.test(x.note));
    out({ brand: brand.id, date: run.date, mode, sources: report, blocked: blocked.map(([id, x]) => `${id}: ${x.note}`), errors: errors.map(([id, x]) => `${id}: ${x.note}`),
      next: blocked.length ? 'Bị chặn: dừng nghiên cứu (không mở thêm), báo người dùng; rồi research.mjs report.' : errors.length ? 'Có source lỗi: xem note (error: selectors = sửa SELECTORS trong scripts/fb-extract.mjs, hoặc crawl tay theo docs/research.md phần dự phòng); rồi store.mjs classify.' : 'Xong crawl: node scripts/store.mjs classify --brand <id> (RUNBOOK 1.3).' });
  } finally {
    for (const c of crawlers.values()) await c.close();
    await close();
  }
}

if (isMain(import.meta.url)) main(async () => {
  const args = parseArgs();
  await crawlBrand(args);
  process.exit(0); // the CDP connection would keep the process alive
});
