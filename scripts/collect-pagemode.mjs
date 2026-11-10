// In-page mode of the collector: `collect.mjs script` prints a script the agent runs with ONE Playwright MCP call
// (browser_run_code_unsafe) in the user's signed-in Chrome; `collect.mjs from-page` turns its JSON result into the raw.json
// that ingest reads (drops posts the store already has BEFORE downloading, downloads the images with the platform's referer).
// Read only. No cookies or tokens are written; images are fetched without cookies.
import fs from 'node:fs';
import path from 'node:path';
import { out, fail, need, settings, loadBrand, readJson, writeJson } from './lib.mjs';
import { track } from './progress.mjs';
import { openRun } from './research.mjs';
import { knownPosts } from './store.mjs';
import { makeCursor } from './cursor.mjs';
import { getAdapter, adapterStatus, isTrusted } from './platforms/index.mjs';
import { checksumOf, unpackB64 } from './platforms/common.mjs';
import { resolveTask, delayRange, toRawPost, rawShape, suggestedState, fileId } from './collect.mjs';

// ---------- pure parts (tests/collect.test.mjs) ----------
// Result of the in-page script (maybe wrapped in MCP text: first { .. last }) -> object.
export function parsePageResult(text) {
  const t = String(text || '');
  const bm = t.match(/"b64"\s*:\s*"([^"]+)"/);
  if (bm && /~[a-z0-9]{4}$/.test(bm[1])) return unpackB64(bm[1]).obj;
  try { return JSON.parse(t); } catch { /* wrapped in MCP output, or cut off */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('Không đọc được JSON kết quả của script trong trang (không có { ... }): dán nguyên văn kết quả, không gõ lại.');
  try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {
    throw new Error(`JSON kết quả bị cắt cụt hoặc bị sửa (${String(e.message).slice(0, 80)}): dán lại NGUYÊN VĂN kết quả; nếu quá dài, chạy script với --chunk 0, --chunk 1, ... rồi đưa tất cả các file cho from-page.`);
  }
}
// One or several page results (chunks) -> ONE result, verified against the script's own total + checksum of the ids.
// Throws a clear message when the JSON was cut off / edited (tile count or checksum differs) or a chunk is missing.
// A result without total/checksum (old script) is accepted but marked verified:false.
export function mergePageResults(parts) {
  const list = (Array.isArray(parts) ? parts : [parts]).filter(Boolean);
  if (!list.length) throw new Error('Không có kết quả nào để đọc.');
  if (list.some((x) => x.loginWall)) return { result: list.find((x) => x.loginWall), verified: true, chunks: list.length };
  const chunked = list.some((x) => x.chunk);
  if (chunked && !list.every((x) => x.chunk)) throw new Error('Trộn kết quả có --chunk với kết quả không chunk: chạy lại cùng một kiểu.');
  let head = list[0], tiles;
  if (chunked) {
    const of = head.chunk.of;
    const by = new Map();
    for (const x of list) {
      if (x.chunk.of !== of || x.total !== head.total || x.checksum !== head.checksum) throw new Error(`Các chunk không cùng một lần chạy (total/checksum/of khác nhau: ${x.chunk.i} so với ${head.chunk.i}): chạy lại tất cả chunk, trang đã đổi giữa các lần.`);
      by.set(x.chunk.i, x);
    }
    const missing = []; for (let i = 0; i < of; i++) if (!by.has(i)) missing.push(i);
    if (missing.length) throw new Error(`Thiếu chunk ${missing.join(', ')} trên ${of}: chạy script với --chunk ${missing[0]} rồi đưa thêm file đó.`);
    tiles = [...by.keys()].sort((a, b) => a - b).flatMap((i) => by.get(i).tiles || []);
  } else {
    if (list.length > 1) throw new Error('Nhiều kết quả không chunk: chỉ đưa một file, hoặc chạy script với --chunk.');
    tiles = head.tiles || [];
  }
  if (head.total === undefined && head.checksum === undefined) return { result: { ...head, tiles }, verified: false, chunks: list.length };
  if (tiles.length !== head.total) throw new Error(`Kết quả BỊ CẮT hoặc bị sửa: có ${tiles.length} tile nhưng script báo total ${head.total}. Dán lại nguyên văn (hoặc dùng --chunk).`);
  const sum = checksumOf(tiles.map((t) => t.id || t.url));
  if (sum !== head.checksum) throw new Error(`Checksum sai (${sum} thay vì ${head.checksum}): id trong JSON đã bị sửa, bỏ sót hoặc đổi thứ tự. Dán lại nguyên văn, không gõ lại.`);
  return { result: { ...head, tiles }, verified: true, chunks: list.length };
}
// The result text(s) of the command line: --file a.json [b.json ...] | --stdin | --json '<compact>' -> merged + verified.
export function loadPageResults(args, readStdin = () => fs.readFileSync(0, 'utf8')) {
  const texts = [];
  const files = [args.file, ...(args._ || []).slice(1)].filter((x) => x && x !== true);
  for (const f of files) texts.push(fs.readFileSync(path.resolve(String(f)), 'utf8'));
  if (args.stdin) texts.push(readStdin());
  if (args.json && args.json !== true) texts.push(String(args.json));
  const objs = texts.map(parsePageResult);
  let tag = '';
  if (args.b64 && args.b64 !== true) { const u = unpackB64(String(args.b64)); objs.push(u.obj); tag = u.tag; }
  if (!objs.length) throw new Error("Thiếu kết quả: --b64 <chuỗi b64 một dòng> | --file <result.json> [<chunk2.json> ...] | --stdin | --json '<compact>'.");
  return { ...mergePageResults(objs), ...(tag ? { tag } : {}) };
}

// Page result tiles -> adapter posts (id from the URL, caption/image cleaning), deduped; posts the store already has are dropped.
export function pageResultPosts(result, adapter, { cursor = null, max = 0, found_by = '' } = {}) {
  const posts = [], seen = new Set();
  let read = 0, skippedKnown = 0;
  if (result?.loginWall) return { posts, read, skippedKnown, loginWall: true };
  for (const t of result?.tiles || []) {
    const p = adapter.toPost({ url: t.url, image_urls: t.image_urls || [], caption: t.caption || '', author: t.author || '' }, { found_by: t.found_by || found_by });
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id); read++;
    const v = cursor ? cursor.take({ post_url: p.url, alt_urls: p.alt_urls || [] }) : 'collect';
    if (v === 'known') { skippedKnown++; continue; }
    if (v === 'collect') { posts.push(p); if (max && posts.length >= max) break; }
  }
  return { posts, read, skippedKnown, loginWall: false };
}

// ---------- commands ----------
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const IMG_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
export async function downloadPlain(url, fileBase, referer) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: referer, Accept: 'image/*' }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) return '';
    const ext = IMG_EXT[String(r.headers.get('content-type') || '').split(';')[0].trim()];
    if (!ext) return '';
    fs.writeFileSync(fileBase + ext, Buffer.from(await r.arrayBuffer()));
    return fileBase + ext;
  } catch { return ''; }
}
const taskOf = (args) => {
  const brand = args.brand && args.brand !== true ? loadBrand(String(args.brand)) : null;
  const run = args['for-query'] || args['for-source'] ? openRun(args, brand || loadBrand(need(args, 'brand'))).run : null;
  return { brand, task: resolveTask(args, run) };
};

export function script(args) {
  const { brand, task } = taskOf(args);
  const adapter = getAdapter(task.platform);
  if (!adapter?.pageScript) throw new Error(`Nền tảng "${task.platform}" chưa có pageScript (in-page): lái tay bằng Playwright MCP (docs/research.md).`);
  const [lo, hi] = delayRange(settings().research?.delay_seconds);
  const max = Number(args.max) > 0 ? Number(args.max) : Math.min(task.max || 8, 8);
  const deadline = Number(args.deadline) > 0 ? Number(args.deadline) : 120;
  const chunk = args.chunk !== undefined && args.chunk !== true && Number.isFinite(Number(args.chunk)) ? Number(args.chunk) : undefined;
  const steps = Number(args['max-steps']) || (task.kind === 'source' ? Math.min(Number(settings().research?.browser?.max_scroll_steps) || 40, 40) : 4);
  process.stdout.write(adapter.pageScript({ url: task.url, found_by: task.found_by, max, steps, delay: [lo, hi], deadline, ...(chunk !== undefined ? { chunk } : {}) }) + '\n');
  const forArg = task.kind === 'query' ? `--for-query ${task.id}` : task.kind === 'source' ? `--for-source ${task.id}` : `--platform ${task.platform}`;
  process.stderr.write(`# ${task.platform} ${task.url} max ${max}, up to ${steps} steps, deadline ${deadline} s, pauses ${lo}-${hi}s. Paste into browser_run_code_unsafe${chunk !== undefined ? ` (CHUNK ${chunk}: tiles ${chunk * 6}.., run again with --chunk ${chunk + 1} until the result's chunk.of is reached)` : ''}; the result is ONE line {b64, tag}: paste the whole b64 value with --b64 (or save the result to a file, --file), never retype JSON; read back its 4-character tag, then: node scripts/collect.mjs from-page ${brand ? `--brand ${brand.id} ` : ''}${forArg} --file <result.json> [<chunk2.json> ...] | --stdin | --json '<compact>'\n`);
}

export async function fromPage(args) {
  const t0 = Date.now();
  const { brand, task } = taskOf(args);
  const adapter = getAdapter(task.platform);
  if (!adapter) return fail(`Chưa có adapter cho nền tảng "${task.platform}".`, { platform: task.platform });
  let merged;
  try { merged = loadPageResults(args); } catch (e) { return fail(String(e.message || e), { verified: false }); }
  const result = merged.result;
  const known = task.known_file ? readJson(task.known_file, { count: 0 }) : brand ? knownPosts(brand.id) : { count: 0 };
  const r = pageResultPosts(result, adapter, { cursor: makeCursor({ mode: task.mode, known }), max: task.max, found_by: task.found_by });
  const rawDir = path.join(task.dir, 'raw');
  fs.mkdirSync(rawDir, { recursive: true });
  const perPost = Math.max(1, Number(args.images) || 4);
  const posts = [];
  let noImage = 0;
  if (!r.loginWall) {
    for (const p of r.posts) {
      const images = [];
      for (const [k, u] of (p.image_urls || []).slice(0, perPost).entries()) {
        const f = await downloadPlain(u, path.join(rawDir, `${fileId(p.id)}-${k + 1}`), p.url);
        if (f) images.push(`raw/${path.basename(f)}`);
      }
      if (!images.length) { noImage++; continue; }
      posts.push(toRawPost(p, images, task.platform));
    }
  }
  const st = adapterStatus(task.platform);
  const blocked = r.loginWall;
  const suspect = !blocked && !r.read;
  const note = blocked ? `login wall / block page: ${String(result?.signals?.url || result?.url || '').slice(0, 80)}` : suspect ? 'error: 0 posts in the page result (page empty or selectors no longer fit)' : noImage && !posts.length ? 'error: posts read but no image could be downloaded' : '';
  writeJson(task.raw_file, rawShape(task, posts, { rejected: [] }));
  const partialRun = !blocked && (result?.partial === true || !merged.verified);
  const warning = partialRun ? (result?.partial ? `partial: the page script stopped at its time limit (${result?.note || 'deadline'}); only what was gathered is here` : 'result has no total/checksum (old script or hand-made): cannot tell if it is complete') : '';
  const state = suggestedState(task.kind, { blocked, error: /^error/.test(note) || partialRun, limit: !!task.max && r.posts.length >= task.max, read: r.read, stop: '' });
  const idArg = task.kind === 'query' ? `--query ${task.id}` : task.kind === 'source' ? `--source ${task.id}` : '';
  const forArg = task.kind === 'query' ? `--for-query ${task.id}` : `--for-source ${task.id}`;
  const b = brand?.id || '<id>';
  const trust = isTrusted(task.platform) && !suspect && !/^error/.test(note);
  const next = blocked ? `Bị chặn: node scripts/research.mjs result --brand ${b} ${idArg} --state blocked --note "${note.replace(/"/g, "'")}" (dừng nền tảng này).`
    : !trust ? `Chưa tin được kết quả (adapter ${st.status}${note ? `, ${note.slice(0, 80)}` : ''}): so với trang thật, sửa adapter hoặc lấy tay (docs/research.md).`
      : task.kind === 'query' ? `Nhìn ảnh review[].image, ghi decisions: node scripts/collect.mjs fit --brand ${b} ${forArg} --file <decisions.json>; node scripts/research.mjs ingest --brand ${b} ${idArg}; node scripts/research.mjs result --brand ${b} ${idArg} --state ${state}`
        : `node scripts/research.mjs ingest --brand ${b} ${idArg}; node scripts/research.mjs result --brand ${b} ${idArg} --state ${state}`;
  if (task.kind !== 'standalone') track('crawl', { brand: b, detail: `${task.id}: from-page ${posts.length} (${state})` });
  out({ brand: brand?.id || '', platform: task.platform, kind: task.kind, [task.kind === 'source' ? 'source' : 'query']: task.id, url: task.url, adapter: st, trusted: trust,
    verified: merged.verified, ...(merged.tag ? { tag: merged.tag } : {}), ...(warning ? { warning } : {}), chunks: merged.chunks, read: r.read, collected: posts.length, skipped_known: r.skippedKnown, dropped_no_image: noImage, via_post_page: (result?.tiles || []).filter((t) => t.via_post_page).length,
    seconds: Math.round((Date.now() - t0) / 1000), suggested_state: state, ...(note ? { note } : {}), raw_file: task.raw_file,
    review: posts.map((p, i) => ({ n: i + 1, id: p.collector_id, url: p.post_url, author: p.author, caption: p.caption.slice(0, 140), image: path.join(task.dir, p.images[0]) })), next });
}
