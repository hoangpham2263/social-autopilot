// Mode "Research only" (run on its own, e.g. weekly). ONE path: Claude opens the page or search URL with Playwright MCP in the
// user's signed-in Chrome, scrolls with normal Playwright MCP actions and decides when to stop; to read the data it runs the
// extract script of scripts/collect.mjs (platform adapters in scripts/platforms/; `next` prints the commands, the scroll wait,
// the target and the stop rules); Claude judges the images and fixes an adapter's SELECTORS when the extract misses posts
// (docs/research.md); this script opens the run, says what to collect next and
// where to stop, ingests what the agent saved into the brand's STORE (workspace/store/<brand>/, scripts/store.mjs) and
// reports. Order (user, 10/11/2026): (1) the brand's reference pages (social.json research.sources[]: new posts not in
// the library yet); (2) when they are done and the run's target is not reached, DISCOVERY by the brand's keywords /
// hashtags (research.discovery), round-robin across its platforms, until the target is met or every query is done.
// Only posts whose PRODUCT is a type the brand sells (research.discovery.product_fit) are stored; off-brand posts are
// logged (store rejected.json) with the reason. No ideas or drafts in this mode.
//   node scripts/research.mjs browser --brand <id> --state ok|fail [--note ..]   step 1.0: the agent's Playwright MCP check
//   node scripts/research.mjs start  --brand <id> [--source a,b|none] [--since YYYY-MM-DD] [--max-posts N] [--full | --backfill]
//        [--platforms a,b|none] [--keywords "k1,k2"] [--hashtags "t1,t2"]
//        --max-posts N = the brand's TARGET of new posts in this run: reference pages first (shared evenly by them), the
//        rest from discovery. --platforms: discovery platforms (default: every enabled platform of the skill; none = no
//        discovery); --keywords / --hashtags override the skill's lists for this run.
//   node scripts/research.mjs next   --brand <id>   what to collect next: a reference page (with its stop rule and share),
//        then a discovery query (platform, keyword/hashtag, search URL, folder, share), or done (target met / all done)
//   node scripts/research.mjs ingest --brand <id> --query <qid>   <run>/discovery/<qid>/raw.json { query, platform, posts[],
//        rejected[] } -> store (product_fit required; dedupe across platforms by link/post id, dHash, caption)
//   node scripts/research.mjs result --brand <id> --query <qid> --state done|limit|empty|blocked|partial [--note ..]
//        (blocked: the platform's other queries are skipped this run)
//        --max-posts N = at most N new posts for the BRAND in this run, shared evenly by its sources: each source gets
//        ceil(left / sources not yet ingested); a source that runs dry leaves its share to the next ones.
//        open (or reopen) today's crawl; writes <source>/known.json (posts already in the store) and each source's stop rule.
//        Default: only new posts on top (stop after 3 known in a row). --backfill: the OLDER posts not crawled yet (the
//        first crawl was cut by --max-posts/--since or stopped early): scroll fast past known posts without opening them,
//        collect once past the source's oldest_seen, until the end of the page / --since / --max-posts. A source whose
//        progress says reached_end is skipped by --backfill (nothing older left).
//   node scripts/research.mjs ingest --brand <id> [--source <sid>] [--date d] [--csv file]
//        <source>/raw.json + downloaded images -> store (U+034F/zero-width cleaned, duplicates across crawls dropped)
//   node scripts/research.mjs result --brand <id> --source <sid> --state end|known|since|limit|blocked|partial [--note ..]
//        how the crawl of a source ended (blocked needs --note; partial: --note optional)
//   node scripts/research.mjs report --brand <id> [--date d]   per source: new on top, backfilled older, reached_end,
//        whether older posts remain; sources done, sources blocked
//   node scripts/research.mjs clean  --in <file> [--out <file>]   strip U+034F / zero-width / NBSP from CSV or text
// The dated folder workspace/runs/<brand>/<date>/ stays as the crawl's log (run.json, known.json, raw.json, raw/,
// ingest.json). No run or post limits unless the user asks (--since / --max-posts); behaviour safety stays: Claude waits
// between scrolls (settings research.scroll_wait_seconds per platform) and stops at any login wall / checkpoint / captcha.
import fs from 'node:fs';
import path from 'node:path';
import { main, out, isMain, parseArgs, need, settings, loadBrand, workspace, runDir, today, stamp, readJson, writeJson, withLock, cleanText, parseCsv, toCsv, latestRun, brandSources, inside, brandDiscovery, DISCOVERY_PLATFORMS, RETIRED_PLATFORMS } from './lib.mjs';
import { adapterStatus } from './platforms/index.mjs';
import { scrollWait, scrollHint, BROWSER_RULES } from './collect-pagemode.mjs';
import { addPosts, knownPosts, recordProgress, readProgress, readStore, counts, storeDir, logRejected, platformOf } from './store.mjs';

const logFile = () => path.join(workspace, 'research-log.json');
const readLog = () => { const l = readJson(logFile(), {}); return { runs: l.runs || [], collected: l.collected || {} }; };
export const STATES = { end: 'cuộn tới hết trang', known: 'dừng ở bài đã có trong kho', since: 'tới mốc --since', limit: 'đủ phần --max-posts của nguồn', blocked: 'bị chặn (checkpoint/captcha/đăng nhập)', partial: 'dừng giữa chừng', skipped: 'không mở: hết phần --max-posts (quota)' };

export const crawlMode = (mode = {}) => (mode.backfill ? 'backfill' : mode.full ? 'full' : 'new');
const seenText = (p) => (p ? [p.date || 'không rõ ngày', p.post_id ? `mã ${p.post_id}` : '', p.post_url || ''].filter(Boolean).join(', ') : 'không rõ');

// Where the crawling agent stops on a source (docs/research.md, "Khi nào dừng").
// share: this source's part of the brand's --max-posts (start: the even split; ingest gives the exact remainder).
export function stopRule(mode, known, share = 0) {
  const rules = [];
  if (mode.backfill && known.count) rules.push(`backfill: cuộn NHANH qua các bài đã có trong known.json (không mở, không tải, chỉ đối chiếu link/mã), bắt đầu lấy khi đã qua bài cũ nhất trong kho (oldest_seen: ${seenText(known.oldest_seen)}); từ đó lấy mọi bài chưa có, cuộn tới hết trang`);
  else if (mode.full || !known.count) rules.push(known.count ? 'cuộn tới hết trang (--full: không dừng ở bài đã có; bài đã có vẫn bị bỏ khi ingest)' : 'kho chưa có bài của nguồn này: cuộn tới hết trang');
  else rules.push(`dừng khi gặp 3 bài liên tiếp đã có trong known.json (bài ghim đầu trang có thể cũ: bỏ qua, đi tiếp); bài mới nhất trong kho: ${known.newest_posted_date || 'không rõ ngày'}`);
  if (mode.since) rules.push(`dừng khi tới bài đăng trước ${mode.since}`);
  if (mode.max_posts) rules.push(`dừng sau ${share || mode.max_posts} bài mới (phần của nguồn này trong tối đa ${mode.max_posts} bài mới cho cả thương hiệu)`);
  return rules.join('; ');
}

// The brand's date is in its timezone (cadence.timezone), never UTC.
// Why --backfill skips a source ('' = crawl it): the page was already scrolled to the end once, or the oldest post
// in the store is already older than --since.
export function backfillSkip(mode, known, progress = {}) {
  if (!mode.backfill) return '';
  if (progress.reached_end) return 'đã cuộn tới hết trang trước đây (reached_end): không còn bài cũ hơn';
  if (mode.since && known.oldest_seen?.date && known.oldest_seen.date < mode.since) return `bài cũ nhất trong kho (${known.oldest_seen.date}) đã trước --since ${mode.since}`;
  return '';
}

// ----- discovery (research.discovery of the skill): queries, search URLs, what to do next -----
// Hashtag pages exist on these platforms; elsewhere only keywords are searched.
export const HASHTAG_PLATFORMS = ['instagram', 'facebook', 'pinterest'];
const enc = encodeURIComponent;
// The search (or hashtag) page the agent opens for a query.
export function searchUrl(platform, kind, term) {
  const t = String(term || '').trim(), tag = t.replace(/^#/, '');
  const U = {
    instagram: kind === 'hashtag' ? `https://www.instagram.com/explore/tags/${enc(tag.toLowerCase())}/` : `https://www.instagram.com/explore/search/keyword/?q=${enc(t)}`,
    pinterest: `https://www.pinterest.com/search/pins/?q=${enc(kind === 'hashtag' ? '#' + tag : t)}`,
    facebook: kind === 'hashtag' ? `https://www.facebook.com/hashtag/${enc(tag.toLowerCase())}` : `https://www.facebook.com/search/posts/?q=${enc(t)}`,
    etsy: `https://www.etsy.com/search?q=${enc(t)}`,
    houzz: `https://www.houzz.com/photos/query/${enc(t.toLowerCase().replace(/\s+/g, '-'))}`,
  };
  return U[platform] || '';
}
const slug = (x) => String(x).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'q';
// Every query of the run: per platform, keywords and hashtags interleaved (k1, h1, k2, h2, ...); hashtags only where the
// platform has hashtag pages. id = <platform>-<k|h>-<slug>.
export function discoveryQueries(platforms, keywords, hashtags) {
  const list = [];
  for (const p of platforms) {
    const ks = keywords.map((k) => ({ kind: 'keyword', term: k })), hs = HASHTAG_PLATFORMS.includes(p) ? hashtags.map((h) => ({ kind: 'hashtag', term: h.replace(/^#/, '') })) : [];
    const mixed = []; for (let i = 0; i < Math.max(ks.length, hs.length); i++) { if (ks[i]) mixed.push(ks[i]); if (hs[i]) mixed.push(hs[i]); }
    const ids = new Set();
    for (const q of mixed) {
      let id = `${p}-${q.kind === 'hashtag' ? 'h' : 'k'}-${slug(q.term)}`;
      for (let n = 2; ids.has(id); n++) id = `${p}-${q.kind === 'hashtag' ? 'h' : 'k'}-${slug(q.term)}-${n}`;
      ids.add(id);
      list.push({ id, platform: p, kind: q.kind, term: q.term, found_by: `${q.kind}:${q.term}`, url: searchUrl(p, q.kind, q.term), state: 'pending', kept: 0, rejected_off_brand: 0, duplicates: 0, note: '' });
    }
  }
  return list;
}
const listArg = (v) => (v === undefined || v === true ? null : String(v).split(',').map((x) => x.trim()).filter(Boolean));
// New posts of the run so far: reference pages + discovery.
export const brandTotal = (run) => (run.sources || []).reduce((a, x) => a + (x.new || 0), 0) + (run.discovery?.queries || []).reduce((a, q) => a + (q.kept || 0), 0);
// Per platform: kept, queries done/pending, blocked, capped (kept >= max_per_platform).
export function platformStats(d) {
  const per = {};
  for (const p of d?.platforms || []) per[p.id] = { id: p.id, notes: p.notes || '', queries: 0, done: 0, pending: 0, kept: 0, rejected_off_brand: 0, duplicates: 0, blocked: false, capped: false };
  for (const q of d?.queries || []) {
    const s = (per[q.platform] ||= { id: q.platform, notes: '', queries: 0, done: 0, pending: 0, kept: 0, rejected_off_brand: 0, duplicates: 0, blocked: false, capped: false });
    s.queries++; s.kept += q.kept || 0; s.rejected_off_brand += q.rejected_off_brand || 0; s.duplicates += q.duplicates || 0;
    if (q.state === 'pending') s.pending++; else s.done++;
    if (q.state === 'blocked') s.blocked = true;
  }
  for (const s of Object.values(per)) s.capped = !!d?.max_per_platform && s.kept >= d.max_per_platform;
  return per;
}
// What the agent collects next: (1) a reference page without a result (its share of the target); (2) once every
// reference page is done and the target is not met: the next discovery query, round-robin across the platforms (the
// platform with the fewest queries done; not blocked, not capped); (3) done.
// The collector command of a step and the status of the platform's adapter (scripts/platforms/index.mjs).
export function collectInfo(brand, kind, id, platform, share = 0, url = '') {
  const a = adapterStatus(platform);
  const [lo, hi] = scrollWait(platform);
  const f = `--brand ${brand} --for-${kind} ${id}`;
  return { open: url, scroll: scrollHint(platform, lo, hi), scroll_wait_seconds: [lo, hi],
    script: `node scripts/collect.mjs script ${f}`, script_run: 'that command WRITES the extract script to <step dir>/extract.js and prints its path; run it with browser_run_code_unsafe using the filename parameter (never paste it)', from_page: `node scripts/collect.mjs from-page ${f} --b64 <b64>`, target: share || 0,
    stop_rules: 'stop when: the time limit (research.source_minutes, default 3) is over; the target is reached; 3 extracts in a row bring no new posts; every post is already known; a login wall / captcha / checkpoint / closed page shows (result --state blocked|end|known). Fallback: ' + FALLBACK,
    adapter: { platform, ...a } };
}
const doText = (brand, kind, id, extra, states) => `ONE path: open the "open" URL with Playwright MCP (browser_navigate); then loop: run the script command (it writes extract.js and prints its path), run that file with ONE browser_run_code_unsafe call using the filename parameter, never paste (it only reads the page now and returns at once), pass the one-line b64 to from_page AS IS (never retype; it checks total + checksum + tag, skips known posts, downloads images, adds to raw.json and says stop or scroll), scroll as in "scroll", extract again, until a stop rule (stop_rules) holds${extra}; then node scripts/research.mjs ingest --brand ${brand} --${kind} ${id} and result --${kind} ${id} --state <${states}>. When the extract misses posts that are on the page, inspect the DOM, fix the adapter's SELECTORS (docs/research.md "Adapter") and extract again. At most the time limit per source (see time_limit_minutes / elapsed). ${FALLBACK} ${BROWSER_RULES}`;
// Per-source time cap: next stamps issued_at the first time it issues a source/query; every later call prints elapsed and, over the limit, stop "time".
export const sourceMinutes = (cfg = settings().research?.source_minutes) => (Number(cfg) > 0 ? Number(cfg) : 3);
export const TIME_NEXT = "over the time limit: record research.mjs result --state partial --note 'time limit', keep what you already have, and go to the next source";
export function timeInfo(issuedAt, now = Date.now(), limit = sourceMinutes()) {
  const t0 = Date.parse(issuedAt || '');
  if (!Number.isFinite(t0)) return {};
  const sec = Math.max(0, Math.round((now - t0) / 1000)), over = sec >= limit * 60;
  return { time_limit_minutes: limit, started: issuedAt, elapsed: `${Math.floor(sec / 60)}m${String(sec % 60).padStart(2, '0')}s`, ...(over ? { stop: 'time', time_over: true, next: TIME_NEXT } : {}) };
}
const FALLBACK = "If the extract script errors, or returns 0 posts / total_on_page 0 twice in a row on a page that visibly has posts, STOP using the script for that source: read the page yourself (Playwright MCP snapshot, a small browser_evaluate, or a screenshot), write the posts you see in the same small JSON the script returns ({platform, url, tiles:[{id, url, image_urls, caption, author, date_text}]}, no checksum) and pass it to collect.mjs from-page --json '<that>' (the tool downloads the images, skips known posts, writes raw.json; verified:false is expected); then the same loop (look at images, fit, counters, stop rules, time cap).";
export function nextTask(run) {
  const target = run.mode?.max_posts || 0, total = brandTotal(run), left = target ? Math.max(0, target - total) : 0;
  const waiting = (run.sources || []).filter((x) => !x.result);
  if (waiting.length) {
    const src = waiting[0];
    if (target && !left) return { step: 'reference', source: src.id, share: 0, skip: true, total, target, do: `target reached: node scripts/research.mjs result --brand ${run.brand} --source ${src.id} --state skipped` };
    return { step: 'reference', source: src.id, name: src.name, platform: src.platform || platformOf({ source_url: src.url }) || '', url: src.url, what_to_take: src.what_to_take || '', dir: src.dir, raw_file: src.raw_file, downloads: src.downloads, known_file: src.known_file, stop_rule: src.stop_rule, share: target ? Math.ceil(left / waiting.length) : 0, total, target,
      found_by: 'reference page', ...collectInfo(run.brand, 'source', src.id, src.platform || platformOf({ source_url: src.url }) || '', target ? Math.ceil(left / waiting.length) : 0, src.url),
      ...timeInfo(src.issued_at, undefined, undefined), do: doText(run.brand, 'source', src.id, '', 'end|known|since|limit|blocked|partial') };
  }
  if (target && !left) return { step: 'done', reason: `target reached (${total}/${target})`, total, target };
  const d = run.discovery;
  if (!d?.queries?.length) return { step: 'done', reason: 'reference pages done; no discovery in this run', total, target };
  const per = platformStats(d);
  const cands = (d.platforms || []).map((p) => per[p.id]).filter((s) => s && s.pending && !s.blocked && !s.capped);
  if (!cands.length) return { step: 'done', reason: d.queries.some((q) => q.state === 'pending') ? 'every platform with queries left is capped (max_per_platform) or blocked' : 'every discovery query is done', total, target };
  const pick = cands.reduce((a, b) => (b.done < a.done ? b : a));
  const q = d.queries.find((x) => x.platform === pick.id && x.state === 'pending');
  const share = Math.max(0, Math.min(d.max_per_platform - pick.kept, target ? left : Infinity));
  return { step: 'discovery', query: q.id, platform: q.platform, kind: q.kind, term: q.term, found_by: q.found_by, url: q.url, dir: q.dir, raw_file: q.raw_file, downloads: q.downloads, share, platform_notes: pick.notes, product_fit: d.product_fit, total, target, ...collectInfo(run.brand, 'query', q.id, q.platform, share, q.url),
    ...timeInfo(q.issued_at), do: doText(run.brand, 'query', q.id, `; LOOK at the images and keep only posts whose product is one of product_fit.types (collect.mjs fit; from-page downloads at most ${share} posts)`, 'done|limit|empty|blocked|partial') };
}

function start(args, s) {
  const brand = loadBrand(need(args, 'brand'));
  const date = today(brand.timezone);
  const dir = runDir(brand.id, date);
  const runFile = path.join(dir, 'run.json');
  const only = args.source && args.source !== true ? String(args.source).split(',').map((x) => x.trim()).filter(Boolean) : [];
  const noRef = only.length === 1 && only[0] === 'none';
  const all = brandSources(brand.social);
  // Discovery: the skill's enabled platforms (or --platforms, only among them), keywords / hashtags (or the overrides).
  const disc = brandDiscovery(brand.social);
  const askedPlatforms = listArg(args.platforms);
  const unknownPlatforms = (askedPlatforms || []).filter((p) => p !== 'none' && !DISCOVERY_PLATFORMS.includes(p) && !RETIRED_PLATFORMS.includes(p));
  const retiredNotes = [...new Set([...(disc.retired || []), ...(askedPlatforms || []).filter((p) => RETIRED_PLATFORMS.includes(p))])].map((p) => `${p}: not supported, skipped`);
  if (unknownPlatforms.length) throw new Error(`--platforms: không biết ${unknownPlatforms.join(', ')} (chỉ ${DISCOVERY_PLATFORMS.join(', ')}, hoặc none).`);
  const skillPlatforms = disc.platforms.map((p) => p.id);
  const platforms = askedPlatforms ? (askedPlatforms.includes('none') ? [] : askedPlatforms.filter((p) => skillPlatforms.includes(p))) : skillPlatforms;
  const platformsIgnored = (askedPlatforms || []).filter((p) => p !== 'none' && !skillPlatforms.includes(p) && !RETIRED_PLATFORMS.includes(p));
  const keywords = listArg(args.keywords) || disc.keywords, hashtags = (listArg(args.hashtags) || disc.hashtags).map((h) => h.replace(/^#/, ''));
  const queries = discoveryQueries(platforms, keywords, hashtags);
  if (!all.length && !queries.length) throw new Error(`${brand.id}: không có research.sources nào bật (có url) và không có truy vấn discovery (research.discovery tắt, không có nền tảng hoặc từ khoá).`);
  const bad = only.filter((id) => id !== 'none' && !all.some((x) => x.id === id));
  if (bad.length) throw new Error(`Source không có hoặc đang tắt trong social.json của ${brand.id}: ${bad.join(', ')}.`);
  const sources = noRef ? [] : all.filter((x) => !only.length || only.includes(x.id));
  if (args.since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(args.since))) throw new Error('--since cần dạng YYYY-MM-DD.');
  if (args['max-posts'] !== undefined && !(Number.isInteger(Number(args['max-posts'])) && Number(args['max-posts']) > 0)) throw new Error('--max-posts cần số nguyên dương.');
  if (args.full && args.backfill) throw new Error('--full và --backfill không dùng cùng lúc.');
  const mode = { since: args.since ? String(args.since) : '', max_posts: args['max-posts'] ? Number(args['max-posts']) : 0, full: !!args.full, backfill: !!args.backfill };
  const before = readJson(runFile, null);
  const progress = readProgress(brand.id).sources || {};
  const skipped = [];
  const crawl = sources.map((x) => ({ x, known: knownPosts(brand.id, x.id) })).filter(({ x, known }) => {
    const why = backfillSkip(mode, known, progress[x.id]);
    if (why) skipped.push({ id: x.id, name: x.name, reason: why, oldest_seen: known.oldest_seen });
    return !why;
  });
  // Reopened the same day: the earlier crawl's raw.json / raw/ / ingest.json of each source move to
  // <source>/archive/<time>/, so a new crawl never re-ingests old posts (they would count as fake duplicates).
  const archived = [];
  // The previous run.json of the day is kept too (runs/<brand>/<date>/archive/<time>/run.json).
  if (before) {
    const to = path.join(dir, 'archive', stamp().replace(/[:.]/g, '-'));
    fs.mkdirSync(to, { recursive: true });
    fs.copyFileSync(runFile, path.join(to, 'run.json'));
    archived.push({ run: true, to });
  }
  // Discovery folders of the earlier run of the day move to archive/ too.
  if (before && fs.existsSync(path.join(dir, 'discovery'))) {
    const to = path.join(dir, 'archive', stamp().replace(/[:.]/g, '-'), 'discovery');
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(path.join(dir, 'discovery'), to);
    archived.push({ discovery: true, to });
  }
  if (before) for (const { x } of crawl) {
    const sdir = path.join(dir, x.id);
    const moving = ['raw.json', 'raw', 'ingest.json'].filter((f) => fs.existsSync(path.join(sdir, f)));
    if (!moving.length) continue;
    const to = path.join(sdir, 'archive', stamp().replace(/[:.]/g, '-'));
    fs.mkdirSync(to, { recursive: true });
    for (const f of moving) fs.renameSync(path.join(sdir, f), path.join(to, f));
    archived.push({ source: x.id, to });
  }
  const run = {
    ...(before || {}), brand: brand.id, date, started: before?.started || stamp(), restarted: before ? stamp() : undefined, status: crawl.length ? 'open' : 'done', mode, crawl_mode: crawlMode(mode),
    fb_account: brand.social.research?.fb_account || '', delay_seconds: s.research.delay_seconds, store: storeDir(brand.id), skipped,
    sources: crawl.map(({ x, known }) => {
      const sdir = path.join(dir, x.id);
      fs.mkdirSync(path.join(sdir, 'raw'), { recursive: true });
      const knownFile = path.join(sdir, 'known.json');
      // known.json: this source's links (stop rule) + every link and Facebook id of the brand's store (skip before downloading).
      writeJson(knownFile, { brand: brand.id, source: x.id, written: stamp(), ...known });
      return { ...x, dir: sdir, raw_file: path.join(sdir, 'raw.json'), downloads: path.join(sdir, 'raw'), known_file: knownFile, known_count: known.count,
        reached_end_before: !!progress[x.id]?.reached_end, newest_seen: known.newest_seen, oldest_seen: known.oldest_seen,
        stop_rule: stopRule(mode, known, mode.max_posts ? Math.ceil(mode.max_posts / crawl.length) : 0), result: null, new: 0, new_on_top: 0, backfilled: 0, duplicates: 0 }; // each start is a new crawl of the source
    }),
  };
  delete run.budget;
  // Discovery queue of this run (each start is a new queue). Folders are made by next.
  run.discovery = queries.length ? {
    platforms: disc.platforms.filter((p) => platforms.includes(p.id)), keywords, hashtags, max_per_platform: disc.max_per_platform, product_fit: disc.product_fit, target: mode.max_posts,
    ...(platformsIgnored.length ? { platforms_ignored: platformsIgnored } : {}),
    queries: queries.map((q) => ({ ...q, dir: path.join(dir, 'discovery', q.id), raw_file: path.join(dir, 'discovery', q.id, 'raw.json'), downloads: path.join(dir, 'discovery', q.id, 'raw') })),
  } : null;
  if (!crawl.length && queries.length) run.status = 'open';
  writeJson(runFile, run);
  const log = readLog();
  log.runs.push({ brand: brand.id, date, started: stamp(), mode });
  writeJson(logFile(), log);
  const next = !crawl.length && !queries.length ? 'Không còn source nào để backfill (xem run.skipped). Chạy research.mjs report.'
    : `Lặp: node scripts/research.mjs next --brand ${brand.id} → lấy đúng nguồn/truy vấn đó bằng Playwright MCP (docs/research.md) → ingest → result, tới khi next trả "done" (RUNBOOK 1.2). Trang tham khảo trước (${crawl.length}), rồi ${queries.length} truy vấn discovery xoay vòng ${platforms.length} nền tảng.${mode.backfill ? ' Backfill: cuộn nhanh qua bài đã có, bắt đầu lấy sau oldest_seen.' : ''}`;
  out({ reused: !!before, archived, dir, run: { ...run, discovery: run.discovery ? { ...run.discovery, queries: run.discovery.queries.length } : null }, discovery: run.discovery ? { platforms, keywords, hashtags, queries: queries.length, max_per_platform: disc.max_per_platform, ...(platformsIgnored.length ? { platforms_ignored: platformsIgnored } : {}) } : null, ...(retiredNotes.length ? { notes: retiredNotes } : {}), next });
}

// The source page's profile picture: raw.json as an object may carry { page: { name, avatar: "raw/avatar.jpg" } } (or
// page_avatar at the top). ingest copies a valid image to store/<brand>/sources/<source>/avatar.<ext> (Library previews).
function readPageAvatar(sourceDir) {
  const raw = readJson(path.join(sourceDir, 'raw.json'), null);
  const f = raw && !Array.isArray(raw) ? raw.page?.avatar || raw.page_avatar : '';
  return f ? path.resolve(sourceDir, String(f)) : '';
}

// <source>/raw.json: [{ post_url, caption, images: ["raw/1.jpg", ...] (or image: "raw/1.jpg"), posted_date?: YYYY-MM-DD,
// main_product?, price_seen?, store? }] or the neon-competitors CSV (store,page_url,main_product,image_file,content,
// price_seen,post_url) with --csv.
function readRaw(args, sourceDir) {
  if (args.csv) {
    const file = path.resolve(String(args.csv));
    const [head, ...rows] = parseCsv(fs.readFileSync(file, 'utf8'));
    const col = (r, name) => r[head.indexOf(name)] ?? '';
    return rows.map((r) => ({ store: col(r, 'store'), post_url: col(r, 'post_url'), caption: col(r, 'content'), image: col(r, 'image_file') && path.resolve(path.dirname(file), col(r, 'image_file')), main_product: col(r, 'main_product'), price_seen: col(r, 'price_seen'), posted_date: col(r, 'posted_date') }));
  }
  const file = path.join(sourceDir, 'raw.json');
  if (!fs.existsSync(file)) return null;
  const raw = readJson(file);
  return Array.isArray(raw) ? raw : raw.posts || [];
}

// A post image must be a real JPEG/PNG/WebP file (extension and file signature) inside the crawl's source folder
// (where the agent saves downloads, <source>/raw/); anything else is dropped with the reason.
const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
export function imageProblem(file, sourceDir) {
  if (!file) return 'không có file ảnh';
  if (!inside(sourceDir, file)) return 'ảnh phải nằm trong thư mục source của lượt này (<source>/raw/)';
  if (!IMAGE_EXT.test(file)) return 'không phải ảnh jpg/jpeg/png/webp';
  let st; try { st = fs.statSync(file); } catch { return 'không có file ảnh'; }
  if (!st.isFile()) return 'không phải file';
  const head = Buffer.alloc(12);
  const fd = fs.openSync(file, 'r'); try { fs.readSync(fd, head, 0, 12, 0); } finally { fs.closeSync(fd); }
  const isPng = head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const isWebp = head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP';
  return isPng || isJpg || isWebp ? '' : 'nội dung file không phải ảnh jpg/png/webp';
}

export function openRun(args, brand) {
  const date = args.date ? String(args.date) : latestRun(brand.id);
  const dir = runDir(brand.id, date || today(brand.timezone));
  const runFile = path.join(dir, 'run.json');
  if (!date || !fs.existsSync(runFile)) throw new Error('Chưa có lượt nghiên cứu: chạy research.mjs start trước.');
  return { date, dir, runFile, run: readJson(runFile) };
}

// Images of a raw post list: real files inside the folder; posts without a usable image are dropped with the reason.
function checkImages(list, base) {
  const dropped = [], posts = [];
  for (const [pos, p] of list.entries()) {
    const files = [].concat(p.images || p.image || []).filter(Boolean).map((f) => path.resolve(base, String(f)));
    const checked = files.map((f) => ({ f, bad: imageProblem(f, base) }));
    const good = checked.filter((x) => !x.bad).map((x) => x.f);
    if (!good.length) { dropped.push({ post_url: p.post_url || '', image: [].concat(p.images || p.image || []).join(', '), reason: checked[0]?.bad || 'không có file ảnh' }); continue; }
    posts.push({ ...p, images: good, page_pos: p.page_pos ?? pos + 1 });
  }
  return { dropped, posts };
}
// raw.json rejected[]: posts the agent SAW but did not take because the product is off-brand (never downloaded).
const seenRejected = (raw, extra = {}) => (raw && !Array.isArray(raw) && Array.isArray(raw.rejected) ? raw.rejected : []).filter((x) => x && typeof x === 'object')
  .map((x) => ({ post_url: String(x.post_url || ''), author: cleanText(x.author || '').text, reason: `off-brand: ${cleanText(String(x.reason || 'not a product the brand sells')).text.replace(/^off-brand:\s*/, '').slice(0, 200)}`, ...extra }));

// One discovery query: <run>/discovery/<qid>/raw.json -> store. Every post needs product_fit.type (one of the brand's
// product types); cap = what is left of the platform's max_per_platform and of the run's target.
function ingestQuery(args, brand, { dir, runFile, run }) {
  const qid = String(args.query);
  const d = run.discovery, q = d?.queries?.find((x) => x.id === qid);
  if (!q) throw new Error(`Truy vấn "${qid}" không có trong lượt này (research.mjs next cho biết truy vấn tiếp theo).`);
  const rawPath = path.join(q.dir, 'raw.json');
  if (!fs.existsSync(rawPath)) return out({ dir, query: qid, added: 0, note: 'chưa có raw.json' });
  const raw = readJson(rawPath);
  const list = (Array.isArray(raw) ? raw : raw.posts || []).map((p) => ({ ...p, platform: q.platform, found_by: q.found_by }));
  const logPath = path.join(q.dir, 'ingest.json');
  const before = new Set((readJson(logPath, { ingests: [] }).ingests || []).flatMap((e) => e.post_urls || []));
  const fresh = list.filter((p) => !p.post_url || !before.has(String(p.post_url)));
  const { dropped, posts } = checkImages(fresh, q.dir);
  const per = platformStats(d)[q.platform] || { kept: 0 };
  const target = run.mode?.max_posts || 0, left = target ? Math.max(0, target - brandTotal(run)) : Infinity;
  const cap = Math.max(0, Math.min(d.max_per_platform - per.kept, left));
  const src = { id: `discovery-${q.platform}`, url: q.url, name: q.platform, platform: q.platform, found_by: q.found_by, query: q.id };
  const r = cap > 0 ? addPosts(brand.id, src, posts, { run: run.date, limit: cap, productFit: d.product_fit, requireFit: true })
    : { added: [], duplicates: [], unhashed: 0, hidden: 0, rejected: [], dropped: posts.map((p) => ({ post_url: p.post_url, reason: 'vượt max_per_platform / mục tiêu của lượt' })) };
  const seen = before.size ? [] : seenRejected(raw, { platform: q.platform, found_by: q.found_by });
  logRejected(brand.id, seen, { source: src.id, run: run.date, query: q.id });
  q.kept = (q.kept || 0) + r.added.length; q.rejected_off_brand = (q.rejected_off_brand || 0) + r.rejected.length + seen.length; q.duplicates = (q.duplicates || 0) + r.duplicates.length; q.ingested = stamp();
  const entry = { at: stamp(), raw_posts: list.length, already_ingested: list.length - fresh.length, post_urls: fresh.map((p) => String(p.post_url || '')).filter(Boolean), added: r.added, duplicates: r.duplicates, rejected_off_brand: [...r.rejected, ...seen], dropped: [...dropped, ...r.dropped] };
  writeJson(logPath, { query: q.id, ingests: [...(readJson(logPath, { ingests: [] }).ingests || []), entry] });
  writeJson(runFile, run);
  out({ dir, query: q.id, platform: q.platform, found_by: q.found_by, added: r.added.length, ids: r.added, duplicates: r.duplicates.length, duplicate_list: r.duplicates, rejected_off_brand: entry.rejected_off_brand.length, rejected_list: entry.rejected_off_brand, dropped: entry.dropped,
    platform_kept: per.kept + r.added.length, max_per_platform: d.max_per_platform, brand_total: brandTotal(run), target, next: `node scripts/research.mjs result --brand ${brand.id} --query ${q.id} --state <done|limit|empty|blocked|partial>, then research.mjs next` });
}

function ingest(args) {
  const brand = loadBrand(need(args, 'brand'));
  const opened = openRun(args, brand);
  if (args.query && args.query !== true) return ingestQuery(args, brand, opened);
  const { dir, runFile, run } = opened;
  const productFit = brandDiscovery(brand.social).product_fit;
  if (args.source && !run.sources.some((x) => x.id === args.source)) throw new Error(`Source "${args.source}" không có trong lượt này (chỉ source bật trong social.json của ${brand.id}).`);
  if (args.csv && !args.source) throw new Error('--csv cần --source.');
  const mode = run.mode || {};
  const log = readLog();
  log.collected[run.date] ||= {};
  const day = log.collected[run.date];
  const report = [];
  for (const src of run.sources.filter((x) => !args.source || x.id === args.source)) {
    const raw = readRaw(args, src.dir);
    if (!raw) { report.push({ source: src.id, added: 0, note: 'chưa có raw.json' }); continue; }
    const base = args.csv ? path.dirname(path.resolve(String(args.csv))) : src.dir;
    const avatar = args.csv ? '' : readPageAvatar(src.dir);
    if (avatar && !imageProblem(avatar, src.dir)) {
      const to = path.join(storeDir(brand.id), 'sources', src.id, `avatar${path.extname(avatar).toLowerCase().replace('.jpeg', '.jpg')}`);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      for (const ext of ['.jpg', '.png', '.webp']) if (path.join(path.dirname(to), `avatar${ext}`) !== to) fs.rmSync(path.join(path.dirname(to), `avatar${ext}`), { force: true });
      fs.copyFileSync(avatar, to);
    }
    // Posts this source folder already ingested (an earlier ingest of the same raw.json) are skipped, not counted
    // as duplicates.
    const logPath = path.join(src.dir, 'ingest.json');
    const before = new Set((readJson(logPath, { ingests: [] }).ingests || []).flatMap((e) => e.post_urls || []));
    const fresh = args.csv ? raw : raw.filter((p) => !p.post_url || !before.has(String(p.post_url)));
    const already = raw.length - fresh.length;
    const { dropped, posts: checkedPosts } = checkImages(fresh, base);
    const posts = checkedPosts.map((p) => ({ ...p, found_by: 'reference page' }));
    const rawObj = args.csv ? null : readJson(path.join(src.dir, 'raw.json'), null);
    const seen = already ? [] : seenRejected(rawObj, { platform: src.platform || '', found_by: 'reference page' });
    logRejected(brand.id, seen, { source: src.id, run: run.date });
    // Brand-level cap shared fairly: what is left for the brand, split over this source and the sources not ingested yet.
    const brandNew = run.sources.reduce((a, x) => a + (x.new || 0), 0);
    const waiting = run.sources.filter((x) => x === src || !x.ingested).length || 1;
    const left = mode.max_posts ? Math.min(Math.max(0, mode.max_posts - brandNew), Math.ceil(Math.max(0, mode.max_posts - brandNew) / waiting)) : 0;
    const r = mode.max_posts && !left
      ? { added: [], duplicates: [], unhashed: 0, dropped: posts.map((p) => ({ post_url: p.post_url, reason: 'vượt --max-posts' })), hidden: 0, rejected: [] }
      : addPosts(brand.id, { ...src, found_by: 'reference page' }, posts, { run: run.date, since: mode.since || '', limit: left, crawlMode: crawlMode(mode), productFit });
    src.rejected_off_brand = (src.rejected_off_brand || 0) + r.rejected.length + seen.length;
    src.new = (src.new || 0) + r.added.length;
    src.ingested = true;
    if (mode.backfill) src.backfilled = (src.backfilled || 0) + r.added.length; else src.new_on_top = (src.new_on_top || 0) + r.added.length;
    src.duplicates = (src.duplicates || 0) + r.duplicates.length;
    day[`${brand.id}/${src.id}`] = (day[`${brand.id}/${src.id}`] || 0) + r.added.length;
    const entry = { at: stamp(), raw_posts: raw.length, already_ingested: already, post_urls: fresh.map((p) => String(p.post_url || '')).filter(Boolean), added: r.added, duplicates: r.duplicates, dropped: [...dropped, ...r.dropped], hidden_chars_removed: r.hidden, images_without_phash: r.unhashed };
    writeJson(logPath, { source: src.id, ingests: [...(readJson(logPath, { ingests: [] }).ingests || []), entry] });
    report.push({ source: src.id, added: r.added.length, rejected_off_brand: r.rejected.length + seen.length, ...(r.rejected.length + seen.length ? { rejected_list: [...r.rejected, ...seen] } : {}), ...(already ? { already_ingested: already } : {}), new_this_crawl: src.new, ids: r.added, duplicates: r.duplicates.length, duplicate_list: r.duplicates, note: `${r.duplicates.length} bài trùng bỏ qua`, hidden_chars_removed: r.hidden, dropped: entry.dropped, ...(r.unhashed ? { images_without_phash: r.unhashed } : {}),
      // --max-posts: what is left for the brand and the next source's share (a dry source leaves its share to the others).
      ...(mode.max_posts ? (() => { const used = run.sources.reduce((a, x) => a + (x.new || 0), 0), rest = run.sources.filter((x) => !x.ingested).length; return { brand_posts_left: Math.max(0, mode.max_posts - used), next_source_share: rest ? Math.ceil(Math.max(0, mode.max_posts - used) / rest) : 0 }; })() : {}) });
  }
  writeJson(logFile(), log);
  Object.assign(run, { ingested: stamp() });
  writeJson(runFile, run);
  out({ dir, store: storeDir(brand.id), sources: report, next: 'research.mjs result --brand <id> --source <sid> --state <end|known|since|limit|blocked|partial> cho từng source đã xong; cuối cùng research.mjs report.' });
}

export const QUERY_STATES = { done: 'đã xem hết kết quả hợp', limit: 'đủ phần của truy vấn', empty: 'không có bài hợp', blocked: 'bị chặn (đăng nhập/captcha/checkpoint)', partial: 'dừng giữa chừng', skipped: 'bỏ qua' };
// The run is done when every reference page has a result and no discovery query is pending.
const runDone = (run) => (run.sources || []).every((x) => x.result) && !(run.discovery?.queries || []).some((q) => q.state === 'pending');
const runStatus = (run) => (runDone(run) ? ((run.sources || []).some((x) => x.result?.state === 'blocked') || (run.discovery?.queries || []).some((q) => q.state === 'blocked') ? 'done-with-blocked' : 'done') : run.status);
function queryResult(args, brand, runFile, run) {
  const q = run.discovery?.queries?.find((x) => x.id === String(args.query));
  if (!q) throw new Error(`Truy vấn "${args.query}" không có trong lượt này.`);
  const state = need(args, 'state');
  if (!QUERY_STATES[state]) throw new Error(`--state (truy vấn) phải là: ${Object.keys(QUERY_STATES).join(', ')}.`);
  const note = args.note && args.note !== true ? cleanText(args.note).text : '';
  if (state === 'blocked' && !note) throw new Error(`--state ${state} cần --note "<lý do>".`);
  Object.assign(q, { state, label: QUERY_STATES[state], note, at: stamp() });
  // A login wall / captcha on a platform: its other queries are skipped this run (other platforms go on).
  const skipped = [];
  if (state === 'blocked') for (const x of run.discovery.queries) if (x.platform === q.platform && x.state === 'pending') { Object.assign(x, { state: 'skipped', label: QUERY_STATES.skipped, note: `${q.platform} blocked`, at: stamp() }); skipped.push(x.id); }
  run.status = runStatus(run);
  writeJson(runFile, run);
  out({ query: q.id, platform: q.platform, state, label: q.label, note, kept: q.kept || 0, skipped, run_status: run.status, next: state === 'blocked' ? `${q.platform} bị chặn: không mở lại trong lượt này; research.mjs next (nền tảng khác vẫn tiếp tục).` : 'node scripts/research.mjs next' });
}

function result(args) {
  const brand = loadBrand(need(args, 'brand'));
  const { runFile, run } = openRun(args, brand);
  if (args.query && args.query !== true) return queryResult(args, brand, runFile, run);
  const sid = need(args, 'source');
  const src = run.sources.find((x) => x.id === sid);
  if (!src) throw new Error(`Source "${sid}" không có trong lượt này.`);
  const state = need(args, 'state');
  if (!STATES[state]) throw new Error(`--state phải là: ${Object.keys(STATES).join(', ')}.`);
  const note = args.note && args.note !== true ? cleanText(args.note).text : '';
  if (state === 'blocked' && !note) throw new Error(`--state ${state} cần --note "<lý do>".`);
  if (state === 'known' && run.mode?.backfill) throw new Error('Lượt --backfill không dừng ở bài đã có: dùng end (hết trang), since, limit, partial hoặc blocked.');
  src.result = { state, label: STATES[state], note, ...(/time limit/i.test(note) ? { time_limited: true } : {}), reached_end: state === 'end', new: src.new || 0, new_on_top: src.new_on_top || 0, backfilled: src.backfilled || 0, at: stamp() };
  const progress = recordProgress(brand.id, sid, src.result, { date: run.date, mode: crawlMode(run.mode) });
  run.status = runStatus(run);
  writeJson(runFile, run);
  out({ source: sid, result: src.result, progress, run_status: run.status, next: state === 'blocked' ? 'Trang tham khảo Facebook bị chặn: không mở trang Facebook nào nữa trong lượt này (các trang còn lại: result --state skipped); nền tảng khác vẫn theo research.mjs next.' : 'node scripts/research.mjs next' });
}

// What to collect next (nextTask), with the query's folders made.
function next(args) {
  const brand = loadBrand(need(args, 'brand'));
  const { runFile, run } = openRun(args, brand);
  let task = nextTask(run);
  // first issue of a source / query: stamp the moment (it stays in the run file)
  const item = task.step === 'reference' && !task.skip ? run.sources.find((x) => x.id === task.source) : task.step === 'discovery' ? run.discovery.queries.find((x) => x.id === task.query) : null;
  if (item && !item.issued_at) { item.issued_at = new Date().toISOString(); writeJson(runFile, run); task = nextTask(run); }
  if (task.step === 'discovery') fs.mkdirSync(task.downloads, { recursive: true });
  if (task.step === 'done' && runDone(run)) { run.status = runStatus(run); writeJson(runFile, run); }
  out({ brand: brand.id, ...task, ...(task.step === 'done' ? { do: `node scripts/store.mjs classify --brand ${brand.id} (1.3), then research.mjs report` } : {}) });
}
// Step 1.0 (the agent's own check: Playwright MCP connected to the user's Chrome) shown in Run progress.
function browser(args) {
  const state = need(args, 'state');
  if (!['ok', 'fail'].includes(state)) throw new Error('--state ok|fail');
  const note = args.note && args.note !== true ? cleanText(args.note).text : '';
  if (state === 'fail' && !note) throw new Error('--state fail cần --note "<lý do>".');
  out({ brand: args.brand && args.brand !== true ? String(args.brand) : '', browser: state, note, next: state === 'ok' ? 'node scripts/research.mjs start --brand <id> (+ OPTIONS)' : 'STOP: không mở lượt; vẫn ghi nhật ký (runlog --reason) và báo cáo.' });
}

// kept / filtered / unfiltered of some store items; low_keep when at least LOW_KEEP.min were judged and fewer than
// LOW_KEEP.rate of them kept (a source that mostly brings off-topic posts: check its what_to_take or replace it).
export const LOW_KEEP = { min: 5, rate: 0.3 };
export function filterCounts(items) {
  const kept = items.filter((i) => i.filter?.fit === true).length, filtered = items.filter((i) => i.filter?.fit === false).length;
  const judged = kept + filtered;
  return { kept, filtered, unfiltered: items.filter((i) => i.status === 'new' && !i.filter).length, keep_rate: judged ? Math.round((kept / judged) * 100) / 100 : null, low_keep: judged >= LOW_KEEP.min && kept / judged < LOW_KEEP.rate };
}

// The end-of-crawl report: new posts per source, sources done, blocked, not finished; store totals.
// One summary line per brand for the final message: target N · kept Y · rejected Z · duplicates D · Library available A
const sidList = (xs) => xs.map((x) => x.id).join(',');
export const reportLine = (r) => `target ${r.target || 0} · kept ${r.kept_total ?? 0} · rejected ${r.rejected_off_brand_total ?? 0} · duplicates ${r.duplicates_total ?? 0} · Library available ${r.store?.ready ?? 0}${(r.time_limited || []).length ? ` · time-limited ${sidList(r.time_limited)}` : ''}${(r.skipped_sources || []).length ? ` · skipped ${sidList(r.skipped_sources)}` : ''}`;
export function researchReport(brandId, date) {
  const r = researchReportBase(brandId, date);
  return { ...r, summary_line: reportLine(r) };
}
function researchReportBase(brandId, date) {
  const day = date || latestRun(brandId);
  const run = day ? readJson(path.join(runDir(brandId, day), 'run.json'), null) : null;
  const store = readStore(brandId);
  const progress = readProgress(brandId).sources || {};
  if (!run) return { brand: brandId, date: null, store: counts(store.items), sources: [], skipped: [], done: [], blocked: [], pending: [] };
  const left = (p) => (p?.reached_end ? 'đã lấy tới bài cũ nhất của trang' : 'còn bài cũ hơn chưa lấy: chạy research.mjs start --backfill');
  // Batch filter (store.mjs classify / verdict) of the posts this crawl added: kept (fit) / filtered (dropped).
  const mine = (id) => store.items.filter((i) => i.source_id === id && i.run === run.date);
  const sources = run.sources.map((x) => ({
    ...filterCounts(mine(x.id)),
    id: x.id, name: x.name, url: x.url, crawl_mode: crawlMode(run.mode), new: x.new || 0, new_on_top: x.new_on_top || 0, backfilled: x.backfilled || 0,
    state: x.result?.state || 'pending', label: x.result?.label || 'chưa xong', note: x.result?.note || '',
    duplicates: x.duplicates || 0, duplicates_text: `${x.duplicates || 0} bài trùng bỏ qua`, reached_end: !!progress[x.id]?.reached_end, reached_end_text: progress[x.id]?.reached_end ? 'có' : 'chưa',
    older_posts: left(progress[x.id]), oldest_seen: progress[x.id]?.oldest_seen || null, store_items: store.items.filter((i) => i.source_id === x.id).length,
  }));
  for (const x of sources) x.rejected_off_brand = run.sources.find((s) => s.id === x.id)?.rejected_off_brand || 0;
  // Discovery: per platform and per query, kept / rejected off-brand / duplicates (+ kept / filtered by the filter step).
  const d = run.discovery;
  const discovery = d ? {
    target: d.target || 0, max_per_platform: d.max_per_platform, keywords: d.keywords, hashtags: d.hashtags,
    platforms: Object.values(platformStats(d)).map((p) => { const fc = filterCounts(store.items.filter((i) => i.run === run.date && i.source_id === `discovery-${p.id}`)); return { ...p, kept_filter: fc.kept, filtered: fc.filtered, unfiltered: fc.unfiltered, low_keep: fc.low_keep }; }),
    queries: d.queries.map((q) => ({ id: q.id, platform: q.platform, found_by: q.found_by, url: q.url, state: q.state, note: q.note || '', kept: q.kept || 0, rejected_off_brand: q.rejected_off_brand || 0, duplicates: q.duplicates || 0 })),
  } : null;
  const discKept = d ? d.queries.reduce((a, q) => a + (q.kept || 0), 0) : 0;
  return {
    brand: brandId, date: day, status: run.status, mode: run.mode || {}, crawl_mode: crawlMode(run.mode), skipped: run.skipped || [], discovery,
    target: run.mode?.max_posts || 0, discovery_kept_total: discKept,
    rejected_off_brand_total: sources.reduce((a, x) => a + x.rejected_off_brand, 0) + (d ? d.queries.reduce((a, q) => a + (q.rejected_off_brand || 0), 0) : 0),
    new_on_top_total: sources.reduce((a, x) => a + x.new_on_top, 0), backfilled_total: sources.reduce((a, x) => a + x.backfilled, 0), new_total: sources.reduce((a, x) => a + x.new, 0) + discKept, kept_total: sources.reduce((a, x) => a + x.kept, 0) + (discovery ? discovery.platforms.reduce((a, p) => a + p.kept_filter, 0) : 0), filtered_total: sources.reduce((a, x) => a + x.filtered, 0) + (discovery ? discovery.platforms.reduce((a, p) => a + p.filtered, 0) : 0), low_keep: sources.filter((x) => x.low_keep).map((x) => x.id), duplicates_total: sources.reduce((a, x) => a + x.duplicates, 0), store: counts(store.items), sources,
    time_limited: sources.filter((x) => run.sources.find((s) => s.id === x.id)?.result?.time_limited).map((x) => ({ id: x.id, note: x.note })),
    skipped_sources: sources.filter((x) => ['skipped', 'blocked'].includes(x.state)).map((x) => ({ id: x.id, state: x.state, note: x.note })),
    done: sources.filter((x) => !['pending', 'blocked', 'partial'].includes(x.state)).map((x) => x.id),
    blocked: sources.filter((x) => x.state === 'blocked').map((x) => `${x.id}: ${x.note}`),
    pending: [...sources.filter((x) => ['pending', 'partial'].includes(x.state)).map((x) => x.id), ...(d ? d.queries.filter((q) => q.state === 'pending').map((q) => q.id) : [])],
  };
}

function clean(args) {
  const file = path.resolve(need(args, 'in'));
  const text = fs.readFileSync(file, 'utf8');
  const target = args.out ? path.resolve(String(args.out)) : path.join(workspace, 'temp', path.basename(file).replace(/(\.\w+)?$/, '.clean$1'));
  if (target === file && !args['in-place']) throw new Error('--out trùng --in; thêm --in-place nếu muốn ghi đè.');
  let removed = 0, nbsp = 0, cells = 0, rows = 0, written;
  if (/\.csv$/i.test(file)) {
    const table = parseCsv(text).map((r) => r.map((c) => { const x = cleanText(c); removed += x.removed; nbsp += x.nbsp; if (x.removed || x.nbsp || x.text !== c) cells++; return x.text; }));
    rows = table.length - 1;
    written = toCsv(table);
  } else {
    const x = cleanText(text); removed = x.removed; nbsp = x.nbsp; written = x.text + '\n';
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, written, 'utf8');
  out({ in: file, out: target, rows, hidden_chars_removed: removed, nbsp_replaced: nbsp, cells_changed: cells });
}

if (isMain(import.meta.url)) main(() => {
  const args = parseArgs();
  const s = settings();
  const cmd = args._[0];
  if (cmd === 'start') return withLock(logFile(), () => start(args, s));
  if (cmd === 'ingest') return withLock(logFile(), () => ingest(args));
  if (cmd === 'result') return withLock(logFile(), () => result(args));
  if (cmd === 'next') return withLock(logFile(), () => next(args));
  if (cmd === 'browser') return browser(args);
  if (cmd === 'report') { const b = loadBrand(need(args, 'brand')); return out(researchReport(b.id, args.date ? String(args.date) : '')); }
  if (cmd === 'clean') return clean(args);
  throw new Error('Lệnh: browser | start | next | ingest | result | report | clean');
});
