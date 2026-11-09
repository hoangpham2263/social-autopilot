// Step 1: research, per brand, per source. The sources come only from the brand's own project/social.json
// (research.sources[]); the browsing is done by the agent through Playwright (docs/research.md). This script opens a
// run, then ingests and cleans what the agent saved. Results: workspace/runs/<brand>/<date>/<source-id>/.
//   node scripts/research.mjs start  --brand <id>                      open (or reopen) today's run for the brand
//   node scripts/research.mjs ingest --brand <id> [--source <sid>] [--date d] [--csv file]   raw.json -> refs.json/csv
//   node scripts/research.mjs clean  --in <file> [--out <file>]        strip U+034F / zero-width / NBSP from CSV or text
// No run or post limits (user, 2026-11-09): a brand's research can be started any number of times a day; each run of
// the day goes into the day's folder and ingest appends the new posts to the refs already there (duplicates dropped by
// post link and image). What stays is behaviour safety: human-like random pauses between page actions
// (settings research.delay_seconds) and stopping at any checkpoint/captcha (docs/research.md).
import fs from 'node:fs';
import path from 'node:path';
import { main, out, isMain, parseArgs, need, settings, loadBrand, workspace, runDir, today, stamp, readJson, writeJson, withLock, cleanText, parseCsv, toCsv, sha1, latestRun, brandSources, inside } from './lib.mjs';

const logFile = () => path.join(workspace, 'research-log.json');
const readLog = () => { const l = readJson(logFile(), {}); return { runs: l.runs || [], collected: l.collected || {} }; };

// The brand's date is in its timezone (cadence.timezone), never UTC.
function start(args, s) {
  const brand = loadBrand(need(args, 'brand'));
  const date = today(brand.timezone);
  const dir = runDir(brand.id, date);
  const runFile = path.join(dir, 'run.json');
  const sources = brandSources(brand.social);
  if (!sources.length) throw new Error(`${brand.id}: social.json chưa có research.sources nào bật (có url).`);
  const before = readJson(runFile, null);
  const run = {
    ...(before || {}), brand: brand.id, date, started: before?.started || stamp(), restarted: before ? stamp() : undefined, status: 'open',
    fb_account: brand.social.research?.fb_account || '', delay_seconds: s.research.delay_seconds,
    sources: sources.map((x) => ({ ...x, dir: path.join(dir, x.id), raw_file: path.join(dir, x.id, 'raw.json'), downloads: path.join(dir, x.id, 'raw') })),
  };
  delete run.budget;
  for (const x of run.sources) fs.mkdirSync(x.downloads, { recursive: true });
  writeJson(runFile, run);
  const log = readLog();
  log.runs.push({ brand: brand.id, date, started: stamp() });
  writeJson(logFile(), log);
  out({ reused: !!before, dir, run, next: 'Theo docs/research.md: với từng source, tải ảnh vào <source>/raw/, ghi <source>/raw.json (bài mới của lượt này), rồi chạy research.mjs ingest (bài mới được nối thêm, bài trùng bị bỏ).' });
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

// A reference image must be a real JPEG/PNG/WebP file (extension and file signature) inside the run's source folder
// (where the agent saves downloads, <source>/raw/); anything else is dropped with the reason.
const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
export function imageProblem(file, sourceDir, { allowRefs = false } = {}) {
  if (!file) return 'không có file ảnh';
  if (!inside(sourceDir, file) || (!allowRefs && inside(path.join(sourceDir, 'refs'), file))) return 'ảnh phải nằm trong thư mục source của lượt này (<source>/raw/)';
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

function ingest(args, s) {
  const brand = loadBrand(need(args, 'brand'));
  const date = args.date ? String(args.date) : latestRun(brand.id);
  const dir = runDir(brand.id, date || today(brand.timezone));
  const runFile = path.join(dir, 'run.json');
  if (!date || !fs.existsSync(runFile)) throw new Error('Chưa có lượt nghiên cứu: chạy research.mjs start trước.');
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
    const refsDir = path.join(src.dir, 'refs');
    fs.mkdirSync(refsDir, { recursive: true });
    // Refs of earlier runs today stay (ids and idea links keep working) when their image is still a valid file in
    // refs/; new posts are appended; duplicates (same post link or same image) are dropped.
    const old = readJson(path.join(src.dir, 'refs.json'), { refs: [] }).refs || [];
    const refs = old.filter((r) => r?.image && !imageProblem(path.join(src.dir, r.image), src.dir, { allowRefs: true }));
    const dropped = [], seenImg = new Set(refs.map((r) => r.image_sha1)), seenPost = new Set(refs.map((r) => r.post_url).filter(Boolean));
    let next = Math.max(0, ...refs.map((r) => Number(/^R(\d+)$/.exec(r.id)?.[1] || 0)));
    let hidden = 0, added = 0;
    for (const p of raw) {
      if (p.post_url && seenPost.has(p.post_url)) { dropped.push({ post_url: p.post_url, reason: 'trùng bài' }); continue; }
      const img = p.image ? path.resolve(args.csv ? path.dirname(path.resolve(String(args.csv))) : src.dir, String(p.image)) : '';
      const bad = imageProblem(img, src.dir);
      if (bad) { dropped.push({ post_url: p.post_url, image: p.image || '', reason: bad }); continue; }
      const data = fs.readFileSync(img);
      const hash = sha1(data);
      if (seenImg.has(hash)) { dropped.push({ post_url: p.post_url, reason: 'trùng ảnh' }); continue; }
      seenImg.add(hash); if (p.post_url) seenPost.add(p.post_url);
      const id = `R${String(++next).padStart(2, '0')}`;
      added++;
      const name = `${id}-${hash.slice(0, 8)}${(path.extname(img) || '.jpg').toLowerCase()}`;
      if (!fs.existsSync(path.join(refsDir, name))) fs.copyFileSync(img, path.join(refsDir, name));
      const caption = cleanText(p.caption);
      hidden += caption.removed + caption.nbsp;
      refs.push({ id, source: src.id, source_url: src.url, store: cleanText(p.store || src.name).text, post_url: p.post_url || '', main_product: cleanText(p.main_product).text, price_seen: cleanText(p.price_seen).text, caption: caption.text, image: `refs/${name}`, image_sha1: hash });
    }
    // Files in refs/ that refs.json no longer lists (an earlier ingest's leftovers, invalid images) are removed.
    const keep = new Set(refs.map((r) => path.basename(r.image)));
    const stale = fs.readdirSync(refsDir).filter((f) => !keep.has(f));
    for (const f of stale) fs.rmSync(path.join(refsDir, f), { recursive: true, force: true });
    writeJson(path.join(src.dir, 'refs.json'), { brand: brand.id, date: run.date, source: src.id, refs });
    fs.writeFileSync(path.join(src.dir, 'refs.csv'), toCsv([['id', 'store', 'source_url', 'main_product', 'image_file', 'content', 'price_seen', 'post_url'], ...refs.map((r) => [r.id, r.store, r.source_url, r.main_product, r.image, r.caption, r.price_seen, r.post_url])]), 'utf8');
    day[key] = refs.length;
    report.push({ source: src.id, dir: src.dir, refs: refs.length, added, hidden_chars_removed: hidden, dropped, stale_removed: stale.length });
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

if (isMain(import.meta.url)) main(() => {
  const args = parseArgs();
  const s = settings();
  const cmd = args._[0];
  if (cmd === 'start') return withLock(logFile(), () => start(args, s));
  if (cmd === 'ingest') return withLock(logFile(), () => ingest(args, s));
  if (cmd === 'clean') return clean(args);
  throw new Error('Lệnh: start | ingest | clean');
});
