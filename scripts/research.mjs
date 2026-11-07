// Step 1: research, per brand, per source. The sources come only from the brand's own project/social.json
// (research.sources[]); the browsing is done by the agent through Playwright (docs/research.md). This script opens a
// run within the limits, then ingests and cleans what the agent saved. Results: workspace/runs/<brand>/<date>/<source-id>/.
//   node scripts/research.mjs start  --brand <id>                      open today's run for the brand (limits enforced)
//   node scripts/research.mjs ingest --brand <id> [--source <sid>] [--date d] [--csv file]   raw.json -> refs.json/csv
//   node scripts/research.mjs clean  --in <file> [--out <file>]        strip U+034F / zero-width / NBSP from CSV or text
//   node scripts/research.mjs limits [--brand <id>]                    what the limits allow now
// Limits (code, not advice): the brand's research.max_per_day runs a day (its social.json; 0 = off, one run folder a
// day); at most max_sources_per_run sources and max_posts_per_source posts per source, and max_posts_per_day_all_brands
// across every brand (one shared Facebook account) (config/settings.json).
import fs from 'node:fs';
import path from 'node:path';
import { main, out, parseArgs, need, settings, loadBrand, workspace, runDir, today, stamp, readJson, writeJson, withLock, cleanText, parseCsv, toCsv, sha1, latestRun, brandSources } from './lib.mjs';

const logFile = () => path.join(workspace, 'research-log.json');
const readLog = () => { const l = readJson(logFile(), {}); return { runs: l.runs || [], collected: l.collected || {} }; };
const DAY = 24 * 3600 * 1000;
const sum = (o, pred = () => true) => Object.entries(o || {}).filter(([k]) => pred(k)).reduce((a, [, v]) => a + v, 0);

function limits(s, brand) {
  const log = readLog();
  const date = today();
  const usedAll = sum(log.collected[date]);
  const result = { date, all_brands: { max_posts_per_day: s.research.max_posts_per_day_all_brands, used_today: usedAll, remaining: Math.max(0, s.research.max_posts_per_day_all_brands - usedAll) } };
  if (brand) {
    // research.max_per_day = research runs a day for this brand (0 = research off). Runs are kept per date
    // (runs/<brand>/<date>/), so a brand has at most one run folder a day; start again the same day reuses it.
    const maxRuns = Number.isInteger(brand.social.research?.max_per_day) ? brand.social.research.max_per_day : 0;
    const runsToday = log.runs.filter((x) => x.brand === brand.id && x.date === date).length;
    const runToday = fs.existsSync(path.join(runDir(brand.id, date), 'run.json'));
    result.brand = { id: brand.id, max_per_day: maxRuns, runs_today: runsToday, run_today: runToday, collected_today: sum(log.collected[date], (k) => k.startsWith(`${brand.id}/`)) };
    result.allowed = runToday || (maxRuns > 0 && runsToday < maxRuns && result.all_brands.remaining > 0);
    if (!result.allowed) result.reason = maxRuns <= 0 ? 'research.max_per_day = 0' : runsToday >= maxRuns ? `đã đủ ${maxRuns} lượt hôm nay` : 'hết hạn mức bài hôm nay của mọi thương hiệu';
  }
  return result;
}

function start(args, s) {
  const brand = loadBrand(need(args, 'brand'));
  const date = today();
  const dir = runDir(brand.id, date);
  const runFile = path.join(dir, 'run.json');
  if (fs.existsSync(runFile)) return out({ reused: true, dir, run: readJson(runFile) });
  const lim = limits(s, brand);
  if (!lim.allowed) throw Object.assign(new Error(`Không mở lượt nghiên cứu cho ${brand.id}: ${lim.reason}.`), { limits: lim });
  const sources = brandSources(brand.social).slice(0, s.research.max_sources_per_run);
  if (!sources.length) throw new Error(`${brand.id}: social.json chưa có research.sources nào bật (có url).`);
  const run = {
    brand: brand.id, date, started: stamp(), status: 'open', fb_account: brand.social.research?.fb_account || '', budget: lim.all_brands.remaining, delay_seconds: s.research.delay_seconds,
    sources: sources.map((x) => ({ ...x, max_posts: s.research.max_posts_per_source, dir: path.join(dir, x.id), raw_file: path.join(dir, x.id, 'raw.json'), downloads: path.join(dir, x.id, 'raw') })),
  };
  for (const x of run.sources) fs.mkdirSync(x.downloads, { recursive: true });
  writeJson(runFile, run);
  const log = readLog();
  log.runs.push({ brand: brand.id, date, started: run.started });
  writeJson(logFile(), log);
  out({ reused: false, dir, run, next: 'Theo docs/research.md: với từng source, tải ảnh vào <source>/raw/, ghi <source>/raw.json, rồi chạy research.mjs ingest.' });
}

// <source>/raw.json: [{ post_url, caption, image (path relative to the source folder, or absolute), main_product?, price_seen?, store? }]
// or the neon-competitors CSV (store,page_url,main_product,image_file,content,price_seen,post_url) with --csv.
function readRaw(args, sourceDir) {
  if (args.csv) {
    const file = path.resolve(String(args.csv));
    const [head, ...rows] = parseCsv(fs.readFileSync(file, 'utf8'));
    const col = (r, name) => r[head.indexOf(name)] ?? '';
    return rows.map((r) => ({ store: col(r, 'store'), post_url: col(r, 'post_url'), caption: col(r, 'content'), image: col(r, 'image_file') && path.resolve(path.dirname(file), col(r, 'image_file')), main_product: col(r, 'main_product'), price_seen: col(r, 'price_seen') }));
  }
  const file = path.join(sourceDir, 'raw.json');
  if (!fs.existsSync(file)) return null;
  const raw = readJson(file);
  return Array.isArray(raw) ? raw : raw.posts || [];
}

function ingest(args, s) {
  const brand = loadBrand(need(args, 'brand'));
  const date = args.date ? String(args.date) : latestRun(brand.id);
  const dir = runDir(brand.id, date || today());
  const runFile = path.join(dir, 'run.json');
  if (!date || !fs.existsSync(runFile)) throw new Error('Chưa có lượt nghiên cứu: chạy research.mjs start trước (giới hạn nằm ở đó).');
  const run = readJson(runFile);
  if (args.source && !run.sources.some((x) => x.id === args.source)) throw new Error(`Source "${args.source}" không có trong lượt này (chỉ source bật trong social.json của ${brand.id}).`);
  if (args.csv && !args.source) throw new Error('--csv cần --source.');
  const log = readLog();
  log.collected[run.date] ||= {};
  const day = log.collected[run.date];
  const report = [];
  for (const src of run.sources.filter((x) => !args.source || x.id === args.source)) {
    const key = `${brand.id}/${src.id}`;
    const raw = readRaw(args, src.dir);
    if (!raw) { report.push({ source: src.id, refs: 0, note: 'chưa có raw.json' }); continue; }
    // What this source may still take: its own cap, the brand's budget left after its other sources, and the
    // all-brand daily cap left after everything else collected today.
    const otherAll = sum(day, (k) => k !== key);
    const cap = Math.max(0, Math.min(src.max_posts, s.research.max_posts_per_day_all_brands - otherAll));
    const refsDir = path.join(src.dir, 'refs');
    fs.mkdirSync(refsDir, { recursive: true });
    const refs = [], dropped = [], seenImg = new Set(), seenPost = new Set();
    let hidden = 0;
    for (const p of raw) {
      if (p.post_url && seenPost.has(p.post_url)) { dropped.push({ post_url: p.post_url, reason: 'trùng bài' }); continue; }
      if (refs.length >= cap) { dropped.push({ post_url: p.post_url, reason: `vượt giới hạn (${cap} bài cho source này hôm nay)` }); continue; }
      const img = p.image ? path.resolve(src.dir, String(p.image)) : '';
      if (!img || !fs.existsSync(img)) { dropped.push({ post_url: p.post_url, reason: 'không có file ảnh' }); continue; }
      const data = fs.readFileSync(img);
      const hash = sha1(data);
      if (seenImg.has(hash)) { dropped.push({ post_url: p.post_url, reason: 'trùng ảnh' }); continue; }
      seenImg.add(hash); if (p.post_url) seenPost.add(p.post_url);
      const id = `R${String(refs.length + 1).padStart(2, '0')}`;
      const name = `${id}-${hash.slice(0, 8)}${(path.extname(img) || '.jpg').toLowerCase()}`;
      if (!fs.existsSync(path.join(refsDir, name))) fs.copyFileSync(img, path.join(refsDir, name));
      const caption = cleanText(p.caption);
      hidden += caption.removed + caption.nbsp;
      refs.push({ id, source: src.id, source_url: src.url, store: cleanText(p.store || src.name).text, post_url: p.post_url || '', main_product: cleanText(p.main_product).text, price_seen: cleanText(p.price_seen).text, caption: caption.text, image: `refs/${name}`, image_sha1: hash });
    }
    writeJson(path.join(src.dir, 'refs.json'), { brand: brand.id, date: run.date, source: src.id, refs });
    fs.writeFileSync(path.join(src.dir, 'refs.csv'), toCsv([['id', 'store', 'source_url', 'main_product', 'image_file', 'content', 'price_seen', 'post_url'], ...refs.map((r) => [r.id, r.store, r.source_url, r.main_product, r.image, r.caption, r.price_seen, r.post_url])]), 'utf8');
    day[key] = refs.length;
    report.push({ source: src.id, dir: src.dir, refs: refs.length, cap, hidden_chars_removed: hidden, dropped });
  }
  writeJson(logFile(), log);
  Object.assign(run, { status: 'ingested', ingested: stamp() });
  writeJson(runFile, run);
  out({ dir, sources: report, next: `node scripts/ideas.mjs init --brand ${brand.id}` });
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

main(() => {
  const args = parseArgs();
  const s = settings();
  const cmd = args._[0];
  try {
    if (cmd === 'start') return withLock(logFile(), () => start(args, s));
    if (cmd === 'ingest') return withLock(logFile(), () => ingest(args, s));
    if (cmd === 'clean') return clean(args);
    if (cmd === 'limits') return out({ limits: limits(s, args.brand ? loadBrand(String(args.brand)) : null) });
  } catch (e) {
    if (e.limits) { process.stdout.write(JSON.stringify({ ok: false, error: e.message, limits: e.limits }, null, 2) + '\n'); process.exit(1); }
    throw e;
  }
  throw new Error('Lệnh: start | ingest | clean | limits');
});
