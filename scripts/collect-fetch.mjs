// Direct fetch mode of the collector (no browser): `collect.mjs fetch --platform <reddit|houzz|pinterest> ...` reads the public
// feed / HTML of ONE keyword or reference page with a polite single request, drops posts the store already has BEFORE downloading,
// downloads the images politely and writes the same raw.json as the other modes (then `collect.mjs fit`, `research.mjs ingest`).
//   node scripts/collect.mjs fetch --brand <id> (--for-query <qid> | --for-source <sid>) [--max N] [--images N]
//   node scripts/collect.mjs fetch --platform <id> (--query <kw> | --url <page>) [--brand <id>] [--max N] [--out <dir>]
//   --from-file <saved feed/html>  parse a saved response instead of requesting (debugging, no network, no throttle)
// Blocked (HTTP 429/403, captcha page) = stop at once, state blocked, the host is refused for 30 min (workspace/tmp/fetch-throttle.json).
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { out, fail, need, loadBrand, readJson, writeJson, workspace } from './lib.mjs';
import { track } from './progress.mjs';
import { openRun } from './research.mjs';
import { knownPosts } from './store.mjs';
import { makeCursor } from './crawl-fb.mjs';
import { adapterStatus } from './platforms/index.mjs';
import { getFetchRoute, hasFetchRoute, FETCH_ROUTES } from './platforms/fetch/index.mjs';
import { makeLimiter, politeGet, BlockedError, UA, hostOf } from './platforms/fetch/common.mjs';
import { resolveTask, toRawPost, rawShape, suggestedState, fileId } from './collect.mjs';
import { pageResultPosts, downloadPlain } from './collect-pagemode.mjs';

const IMG_GAP_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The real network: node fetch, or curl for routes that say so (curl.exe on Windows). -> { status, text }
export async function netGet(req) {
  if (req.via === 'curl') {
    const bin = process.platform === 'win32' ? 'curl.exe' : 'curl';
    const stdout = await new Promise((res, rej) => execFile(bin, ['-s', '-L', '-m', '25', '-A', UA, '-w', '\n%{http_code}', req.url], { maxBuffer: 1e8, windowsHide: true }, (e, o) => (e && !o ? rej(e) : res(String(o)))));
    const i = stdout.lastIndexOf('\n');
    return { status: Number(stdout.slice(i + 1)) || 0, text: stdout.slice(0, i) };
  }
  const r = await fetch(req.url, { headers: { 'User-Agent': UA, Accept: 'application/atom+xml, application/rss+xml, text/html;q=0.8, */*;q=0.5' }, signal: AbortSignal.timeout(25000) });
  return { status: r.status, text: await r.text() };
}

// The throttle state is a small file so separate commands keep the gap and the block memory.
export function fileLimiter(file = path.join(workspace, 'tmp', 'fetch-throttle.json')) {
  const state = readJson(file, {}) || {};
  return makeLimiter({ state, save: (s) => { try { writeJson(file, s); } catch { /* best effort */ } } });
}

// Pure core: route + task + response text -> posts (dedup, known dropped, max). tiles go through the platform adapter's toPost.
export function fetchPosts(route, text, task, { cursor = null } = {}) {
  const tiles = route.parse(text, task);
  const r = pageResultPosts({ tiles }, route.adapter, { cursor, max: task.max, found_by: task.found_by });
  return { ...r, parsed: tiles.length };
}

export async function runFetch(args, deps = {}) {
  const t0 = Date.now();
  const brand = args.brand && args.brand !== true ? loadBrand(String(args.brand)) : null;
  const run = args['for-query'] || args['for-source'] ? openRun(args, brand || loadBrand(need(args, 'brand'))).run : null;
  const task = resolveTask(args, run);
  const route = getFetchRoute(task.platform);
  if (!route || !hasFetchRoute(task.platform, task.kind)) return fail(`Nền tảng "${task.platform}" không có đường fetch cho ${task.kind === 'source' ? 'trang tham chiếu' : 'từ khoá'} (có: ${Object.keys(FETCH_ROUTES).join(', ')}; Pinterest chỉ trang tham chiếu): dùng in-page script (collect.mjs script).`, { platform: task.platform });
  const fromFile = args['from-file'] && args['from-file'] !== true ? path.resolve(String(args['from-file'])) : '';
  const limiter = deps.limiter || (fromFile ? makeLimiter({ gapMs: 0, now: () => 0, sleep: async () => {} }) : fileLimiter());
  const get = deps.get || netGet;
  let text = '', state = '', note = '', req = null;
  try {
    req = route.requestFor(task);
    text = fromFile ? fs.readFileSync(fromFile, 'utf8') : await politeGet(req, get, { limiter });
  } catch (e) {
    if (e instanceof BlockedError) { state = 'blocked'; note = e.message; } else { state = 'partial'; note = `error: ${String(e.message || e).slice(0, 160)}`; }
  }
  const known = task.known_file ? readJson(task.known_file, { count: 0 }) : brand ? knownPosts(brand.id) : { count: 0 };
  const r = state ? { posts: [], read: 0, skippedKnown: 0, parsed: 0 } : fetchPosts(route, text, task, { cursor: makeCursor({ mode: task.mode, known }) });
  const rawDir = path.join(task.dir, 'raw');
  fs.mkdirSync(rawDir, { recursive: true });
  const perPost = Math.max(1, Number(args.images) || 2);
  const posts = [];
  let noImage = 0, first = true;
  for (const p of r.posts) {
    const images = [];
    for (const [k, u] of (p.image_urls || []).slice(0, perPost).entries()) {
      if (!first && !fromFile) await sleep(deps.imageGapMs ?? IMG_GAP_MS);
      first = false;
      const f = await (deps.download || downloadPlain)(u, path.join(rawDir, `${fileId(p.id)}-${k + 1}`), p.url);
      if (f) images.push(`raw/${path.basename(f)}`);
    }
    if (!images.length) { noImage++; continue; }
    posts.push(toRawPost(p, images, task.platform));
  }
  if (!state && !r.parsed) { state = 'partial'; note = 'error: 0 posts parsed (feed empty, stub page, or the parser no longer fits)'; }
  else if (!state && noImage && !posts.length) { state = 'partial'; note = 'error: posts parsed but no image could be downloaded'; }
  writeJson(task.raw_file, rawShape(task, posts, { rejected: [] }));
  const blocked = state === 'blocked';
  const sug = suggestedState(task.kind, { blocked, error: state === 'partial', limit: !!task.max && r.posts.length >= task.max, read: r.read, stop: '' });
  const idArg = task.kind === 'query' ? `--query ${task.id}` : task.kind === 'source' ? `--source ${task.id}` : '';
  const forArg = task.kind === 'query' ? `--for-query ${task.id}` : `--for-source ${task.id}`;
  const b = brand?.id || '<id>';
  const next = blocked ? `Bị chặn (${note}): node scripts/research.mjs result --brand ${b} ${idArg} --state blocked --note "${note.replace(/"/g, "'").slice(0, 120)}" — dừng nền tảng này, KHÔNG thử lại, KHÔNG vòng bằng proxy/cookie.`
    : state === 'partial' ? `Lỗi (${note.slice(0, 80)}): thử in-page script (collect.mjs script) hoặc lấy tay (docs/research.md).`
      : task.kind === 'query' ? `Nhìn ảnh review[].image, ghi decisions: node scripts/collect.mjs fit --brand ${b} ${forArg} --file <decisions.json>; node scripts/research.mjs ingest --brand ${b} ${idArg}; node scripts/research.mjs result --brand ${b} ${idArg} --state ${sug}`
        : `node scripts/research.mjs ingest --brand ${b} ${idArg}; node scripts/research.mjs result --brand ${b} ${idArg} --state ${sug}`;
  if (task.kind !== 'standalone') track('crawl', { brand: b, detail: `${task.id}: fetch ${posts.length} (${sug})` });
  out({ brand: brand?.id || '', platform: task.platform, kind: task.kind, [task.kind === 'source' ? 'source' : 'query']: task.id, mode: 'fetch', request: req ? `${req.via} ${hostOf(req.url)}` : '', url: task.url,
    parsed: r.parsed, read: r.read, collected: posts.length, skipped_known: r.skippedKnown, dropped_no_image: noImage, seconds: Math.round((Date.now() - t0) / 1000),
    state: state || 'ok', suggested_state: sug, ...(note ? { note } : {}), raw_file: task.raw_file, adapter: adapterStatus(task.platform),
    review: posts.map((p, i) => ({ n: i + 1, id: p.collector_id, url: p.post_url, author: p.author, caption: p.caption.slice(0, 140), image: path.join(task.dir, p.images[0]) })), next });
}
