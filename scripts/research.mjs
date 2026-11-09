// Mode "Chỉ nghiên cứu" (research only; run on its own, e.g. weekly, by an agent with a logged-in browser). Per brand,
// per enabled source of its own project/social.json (research.sources[]): scripts/crawl-fb.mjs crawls the source's
// posts (or, as a fallback, an agent by hand: docs/research.md), this script opens the crawl, tells the agent where to stop, ingests what it saved into the brand's
// STORE (workspace/store/<brand>/, scripts/store.mjs) and reports. No ideas or drafts in this mode.
//   node scripts/research.mjs start  --brand <id> [--source a,b] [--since YYYY-MM-DD] [--max-posts N] [--full | --backfill]
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
//        how the crawl of a source ended (blocked/partial need --note)
//   node scripts/research.mjs report --brand <id> [--date d]   per source: new on top, backfilled older, reached_end,
//        whether older posts remain; sources done, sources blocked
//   node scripts/research.mjs clean  --in <file> [--out <file>]   strip U+034F / zero-width / NBSP from CSV or text
// The dated folder workspace/runs/<brand>/<date>/ stays as the crawl's log (run.json, known.json, raw.json, raw/,
// ingest.json). No run or post limits unless the user asks (--since / --max-posts); behaviour safety stays: human-like
// random pauses (settings research.delay_seconds) and stopping at any checkpoint/captcha.
import fs from 'node:fs';
import path from 'node:path';
import { main, out, isMain, parseArgs, need, settings, loadBrand, workspace, runDir, today, stamp, readJson, writeJson, withLock, cleanText, parseCsv, toCsv, latestRun, brandSources, inside } from './lib.mjs';
import { addPosts, knownPosts, recordProgress, readProgress, readStore, counts, storeDir } from './store.mjs';

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

function start(args, s) {
  const brand = loadBrand(need(args, 'brand'));
  const date = today(brand.timezone);
  const dir = runDir(brand.id, date);
  const runFile = path.join(dir, 'run.json');
  const only = args.source && args.source !== true ? String(args.source).split(',').map((x) => x.trim()).filter(Boolean) : [];
  const all = brandSources(brand.social);
  if (!all.length) throw new Error(`${brand.id}: social.json chưa có research.sources nào bật (có url).`);
  const bad = only.filter((id) => !all.some((x) => x.id === id));
  if (bad.length) throw new Error(`Source không có hoặc đang tắt trong social.json của ${brand.id}: ${bad.join(', ')}.`);
  const sources = all.filter((x) => !only.length || only.includes(x.id));
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
  writeJson(runFile, run);
  const log = readLog();
  log.runs.push({ brand: brand.id, date, started: stamp(), mode });
  writeJson(logFile(), log);
  const next = !crawl.length ? 'Không còn source nào để backfill (xem run.skipped). Chạy research.mjs report.'
    : (mode.backfill ? 'Backfill: crawl-fb.mjs cuộn nhanh qua bài đã có, bắt đầu lấy sau oldest_seen. ' : '') + 'node scripts/crawl-fb.mjs --brand <id> (crawl bằng script: ingest + result tự chạy; RUNBOOK 1.2), rồi store.mjs classify / verdict (1.3), rồi research.mjs report. Crawl tay (dự phòng): docs/research.md.';
  out({ reused: !!before, archived, dir, run, next });
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

function ingest(args) {
  const brand = loadBrand(need(args, 'brand'));
  const { dir, runFile, run } = openRun(args, brand);
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
    const dropped = [], posts = [];
    for (const [pos, p] of fresh.entries()) {
      const list = [].concat(p.images || p.image || []).filter(Boolean).map((f) => path.resolve(base, String(f)));
      const checked = list.map((f) => ({ f, bad: imageProblem(f, base) }));
      const good = checked.filter((x) => !x.bad).map((x) => x.f);
      if (!good.length) { dropped.push({ post_url: p.post_url || '', image: [].concat(p.images || p.image || []).join(', '), reason: checked[0]?.bad || 'không có file ảnh' }); continue; }
      posts.push({ ...p, images: good, page_pos: p.page_pos ?? pos + 1 });
    }
    // Brand-level cap shared fairly: what is left for the brand, split over this source and the sources not ingested yet.
    const brandNew = run.sources.reduce((a, x) => a + (x.new || 0), 0);
    const waiting = run.sources.filter((x) => x === src || !x.ingested).length || 1;
    const left = mode.max_posts ? Math.min(Math.max(0, mode.max_posts - brandNew), Math.ceil(Math.max(0, mode.max_posts - brandNew) / waiting)) : 0;
    const r = mode.max_posts && !left
      ? { added: [], duplicates: [], unhashed: 0, dropped: posts.map((p) => ({ post_url: p.post_url, reason: 'vượt --max-posts' })), hidden: 0 }
      : addPosts(brand.id, src, posts, { run: run.date, since: mode.since || '', limit: left, crawlMode: crawlMode(mode) });
    src.new = (src.new || 0) + r.added.length;
    src.ingested = true;
    if (mode.backfill) src.backfilled = (src.backfilled || 0) + r.added.length; else src.new_on_top = (src.new_on_top || 0) + r.added.length;
    src.duplicates = (src.duplicates || 0) + r.duplicates.length;
    day[`${brand.id}/${src.id}`] = (day[`${brand.id}/${src.id}`] || 0) + r.added.length;
    const entry = { at: stamp(), raw_posts: raw.length, already_ingested: already, post_urls: fresh.map((p) => String(p.post_url || '')).filter(Boolean), added: r.added, duplicates: r.duplicates, dropped: [...dropped, ...r.dropped], hidden_chars_removed: r.hidden, images_without_phash: r.unhashed };
    writeJson(logPath, { source: src.id, ingests: [...(readJson(logPath, { ingests: [] }).ingests || []), entry] });
    report.push({ source: src.id, added: r.added.length, ...(already ? { already_ingested: already } : {}), new_this_crawl: src.new, ids: r.added, duplicates: r.duplicates.length, duplicate_list: r.duplicates, note: `${r.duplicates.length} bài trùng bỏ qua`, hidden_chars_removed: r.hidden, dropped: entry.dropped, ...(r.unhashed ? { images_without_phash: r.unhashed } : {}),
      // --max-posts: what is left for the brand and the next source's share (a dry source leaves its share to the others).
      ...(mode.max_posts ? (() => { const used = run.sources.reduce((a, x) => a + (x.new || 0), 0), rest = run.sources.filter((x) => !x.ingested).length; return { brand_posts_left: Math.max(0, mode.max_posts - used), next_source_share: rest ? Math.ceil(Math.max(0, mode.max_posts - used) / rest) : 0 }; })() : {}) });
  }
  writeJson(logFile(), log);
  Object.assign(run, { ingested: stamp() });
  writeJson(runFile, run);
  out({ dir, store: storeDir(brand.id), sources: report, next: 'research.mjs result --brand <id> --source <sid> --state <end|known|since|limit|blocked|partial> cho từng source đã xong; cuối cùng research.mjs report.' });
}

function result(args) {
  const brand = loadBrand(need(args, 'brand'));
  const { runFile, run } = openRun(args, brand);
  const sid = need(args, 'source');
  const src = run.sources.find((x) => x.id === sid);
  if (!src) throw new Error(`Source "${sid}" không có trong lượt này.`);
  const state = need(args, 'state');
  if (!STATES[state]) throw new Error(`--state phải là: ${Object.keys(STATES).join(', ')}.`);
  const note = args.note && args.note !== true ? cleanText(args.note).text : '';
  if (['blocked', 'partial'].includes(state) && !note) throw new Error(`--state ${state} cần --note "<lý do>".`);
  if (state === 'known' && run.mode?.backfill) throw new Error('Lượt --backfill không dừng ở bài đã có: dùng end (hết trang), since, limit, partial hoặc blocked.');
  src.result = { state, label: STATES[state], note, reached_end: state === 'end', new: src.new || 0, new_on_top: src.new_on_top || 0, backfilled: src.backfilled || 0, at: stamp() };
  const progress = recordProgress(brand.id, sid, src.result, { date: run.date, mode: crawlMode(run.mode) });
  if (run.sources.every((x) => x.result)) run.status = run.sources.some((x) => x.result.state === 'blocked') ? 'done-with-blocked' : 'done';
  writeJson(runFile, run);
  out({ source: sid, result: src.result, progress, run_status: run.status, next: state === 'blocked' ? 'Dừng nghiên cứu ngay (không mở source nào nữa trong lượt này), chạy research.mjs report.' : 'Sang source tiếp theo, hoặc research.mjs report khi xong.' });
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
export function researchReport(brandId, date) {
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
  return {
    brand: brandId, date: day, status: run.status, mode: run.mode || {}, crawl_mode: crawlMode(run.mode), skipped: run.skipped || [],
    new_on_top_total: sources.reduce((a, x) => a + x.new_on_top, 0), backfilled_total: sources.reduce((a, x) => a + x.backfilled, 0), new_total: sources.reduce((a, x) => a + x.new, 0), kept_total: sources.reduce((a, x) => a + x.kept, 0), filtered_total: sources.reduce((a, x) => a + x.filtered, 0), low_keep: sources.filter((x) => x.low_keep).map((x) => x.id), duplicates_total: sources.reduce((a, x) => a + x.duplicates, 0), store: counts(store.items), sources,
    done: sources.filter((x) => !['pending', 'blocked', 'partial'].includes(x.state)).map((x) => x.id),
    blocked: sources.filter((x) => x.state === 'blocked').map((x) => `${x.id}: ${x.note}`),
    pending: sources.filter((x) => ['pending', 'partial'].includes(x.state)).map((x) => x.id),
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
  if (cmd === 'report') { const b = loadBrand(need(args, 'brand')); return out(researchReport(b.id, args.date ? String(args.date) : '')); }
  if (cmd === 'clean') return clean(args);
  throw new Error('Lệnh: start | ingest | result | report | clean');
});
