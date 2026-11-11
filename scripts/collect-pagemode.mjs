// The ONE research path (docs/research.md). The agent opens the page with Playwright MCP and scrolls it with normal
// Playwright MCP actions; `collect.mjs script` prints the extract script (browser_run_code_unsafe) that only READS the
// page as it is now and returns at once; `collect.mjs from-page` checks that result (total + checksum + tag), drops posts
// the store already has BEFORE downloading, downloads the images with the platform's referer and ADDS them to raw.json.
// Scroll, extract, scroll, extract: every from-page of the same task accumulates (seen.json in the task folder holds the
// ids and aliases already returned; the next `script` leaves them out). Read only. No cookies or tokens are written.
import fs from 'node:fs';
import path from 'node:path';
import { out, fail, need, settings, loadBrand, readJson, writeJson } from './lib.mjs';
import { track } from './progress.mjs';
import { openRun, timeInfo, brandTotal, TIME_NEXT } from './research.mjs';
import { counters, counterLine, fitStop, progressFile } from './collect.mjs';
import { knownPosts } from './store.mjs';
import { makeCursor } from './cursor.mjs';
import { getAdapter, adapterStatus, isTrusted } from './platforms/index.mjs';
import { checksumOf, unpackB64 } from './platforms/common.mjs';
import { scriptDir, scriptFile, serverBase, resultFile } from './collect-transfer.mjs';
import { resolveTask, toRawPost, rawShape, suggestedState, fileId } from './collect.mjs';

// ---------- pure parts (tests/collect-pagemode.test.mjs) ----------
// Result of the extract script (maybe wrapped in MCP text) -> object.
export function parsePageResult(text) {
  const t = String(text || '');
  const bm = t.match(/"b64"\s*:\s*"([^"]+)"/);
  if (bm && /~[a-z0-9]{4}$/.test(bm[1])) return unpackB64(bm[1]).obj;
  try { return JSON.parse(t); } catch { /* wrapped in MCP output, or cut off */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('Không đọc được kết quả của script trích xuất (không có { ... }): dán nguyên văn giá trị b64 (--b64) hoặc lưu kết quả ra file (--file).');
  try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {
    throw new Error(`Kết quả bị cắt cụt hoặc bị sửa (${String(e.message).slice(0, 80)}): dán lại NGUYÊN VĂN giá trị b64 (--b64) hoặc lưu ra file (--file).`);
  }
}
// One extract result -> verified (tiles.length === total, checksum of the ids). Throws when it was cut off or edited.
// A result without total/checksum (hand-made) is accepted but marked verified:false.
export function verifyPageResult(r) {
  if (!r) throw new Error('Không có kết quả nào để đọc.');
  if (r.loginWall) return { result: r, verified: true };
  const tiles = r.tiles || [];
  if (r.total === undefined && r.checksum === undefined) return { result: { ...r, tiles }, verified: false };
  if (tiles.length !== r.total) throw new Error(`Kết quả BỊ CẮT hoặc bị sửa: có ${tiles.length} tile nhưng script báo total ${r.total}. Dán lại nguyên văn.`);
  const sum = checksumOf(tiles.map((t) => t.id || t.url));
  if (sum !== r.checksum) throw new Error(`Checksum sai (${sum} thay vì ${r.checksum}): id trong kết quả đã bị sửa, bỏ sót hoặc đổi thứ tự. Dán lại nguyên văn, không gõ lại.`);
  return { result: { ...r, tiles }, verified: true };
}
// --b64 <line> | --file <result> | --stdin | --json '<compact>' -> ONE verified result.
export function loadPageResult(args, readStdin = () => fs.readFileSync(0, 'utf8'), autoFile = '') {
  const objs = [];
  let tag = '';
  if (args.file && args.file !== true) objs.push(parsePageResult(fs.readFileSync(path.resolve(String(args.file)), 'utf8')));
  if (args.stdin) objs.push(parsePageResult(readStdin()));
  if (args.json && args.json !== true) objs.push(parsePageResult(String(args.json)));
  if (args.b64 && args.b64 !== true) { const u = unpackB64(String(args.b64)); objs.push(u.obj); tag = u.tag; }
  if (!objs.length && autoFile && fs.existsSync(autoFile)) { const o = JSON.parse(fs.readFileSync(autoFile, 'utf8')); objs.push(o); tag = String(o.tag || ''); }
  if (!objs.length) throw new Error("Thiếu kết quả: --b64 <chuỗi b64 một dòng> | --file <result.json> | --stdin | --json '<compact>'.");
  if (objs.length > 1) throw new Error('Mỗi lần from-page chỉ nhận MỘT kết quả trích xuất (một lần chạy script).');
  return { ...verifyPageResult(objs[0]), ...(tag ? { tag } : {}) };
}
// Ids (and Facebook aliases) of a page result's tiles: what the next extract leaves out.
export const tileKeys = (tiles) => (tiles || []).flatMap((t) => [t.id || t.url, ...[].concat(t.alt || [])]).filter(Boolean).map(String);
// The seen list of a task: --seen <file> (JSON array, or { seen: [] }) or <task dir>/seen.json.
export function readSeen(file) {
  const j = readJson(file, null);
  return [...new Set((Array.isArray(j) ? j : j?.seen || []).map(String))];
}

// Page result tiles -> adapter posts (id from the URL, caption/image cleaning), deduped; posts the store already has
// (any of their links, Facebook photo fbids included) are dropped; `skip` = ids already in raw.json (earlier extracts).
export function pageResultPosts(result, adapter, { cursor = null, max = 0, found_by = '', skip = [] } = {}) {
  const posts = [], seen = new Set(skip.map(String));
  let read = 0, skippedKnown = 0;
  if (result?.loginWall) return { posts, read, skippedKnown, loginWall: true };
  for (const t of result?.tiles || []) {
    const p = adapter.toPost({ id: t.id, alt: t.alt, url: t.url, alt_urls: t.alt_urls || [], image_urls: t.image_urls || [], caption: t.caption || '', author: t.author || '', date_text: t.date_text || '', utime: t.utime || 0 }, { found_by: t.found_by || found_by });
    if (!p || seen.has(p.id) || (p.aliases || []).some((a) => seen.has(a))) continue;
    seen.add(p.id); read++;
    const v = cursor ? cursor.take({ post_url: p.url, alt_urls: p.alt_urls || [] }) : 'collect';
    if (v === 'known') { skippedKnown++; continue; }
    if (v === 'collect') { posts.push(p); if (max && posts.length >= max) break; }
  }
  return { posts, read, skippedKnown, loginWall: false };
}
// research.scroll_wait_seconds[platform] -> [lo, hi] seconds the agent waits between scrolls.
export function scrollWait(platform, cfg = settings().research?.scroll_wait_seconds) {
  const v = cfg?.[String(platform || '').toLowerCase()];
  return Array.isArray(v) && v.length === 2 ? v.map(Number) : ['instagram', 'facebook'].includes(platform) ? [5, 10] : [2, 4];
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
  return { brand, run, task: resolveTask(args, run) };
};
const seenFile = (task) => path.join(task.dir, 'seen.json');
const forArgOf = (task, brand) => `${brand ? `--brand ${brand.id} ` : ''}${task.kind === 'query' ? `--for-query ${task.id}` : task.kind === 'source' ? `--for-source ${task.id}` : `--platform ${task.platform}`}`;

// One scroll wording for every place that prints it (research.mjs next, collect.mjs script). Facebook's feed does not load on End.
export const BROWSER_RULES = "Browser rules: start every browser_run_code_unsafe with `await page.bringToFront();` (a hidden tab never gets animation frames, so rAF-based waits and mouse.wheel hang); work in ONE tab: close tabs left over from earlier runs and open the source in a new tab; never use waitForFunction for page readiness (use waitForLoadState('domcontentloaded') with a short timeout, or waitForTimeout; if waitForFunction is unavoidable use { polling: 250, timeout: 10000 }); any single browser call that takes more than 30 s counts as stuck: stop using it and go on (fallback: read the page yourself). Scrolling: scrollBy first, page.mouse.wheel(0,900) only as fallback AFTER bringToFront (Facebook sometimes needs real scrolling to render its feed).";
export const scrollHint = (platform, lo, hi) => `Playwright MCP: scroll with browser_run_code_unsafe running "async (page) => { await page.bringToFront(); for (let i=0;i<3;i++){ await page.evaluate(() => window.scrollBy(0, 900)); await page.waitForTimeout(1200);} await page.waitForTimeout(3500); }" (no mouse.wheel first: it waits for frames; only if the feed still does not render, page.mouse.wheel(0,900) AFTER bringToFront; the End key does not load the Facebook feed), then wait ${lo}-${hi} s before the next extract`;

export function script(args) {
  const { brand, task } = taskOf(args);
  const adapter = getAdapter(task.platform);
  if (!adapter?.pageScript) throw new Error(`Nền tảng "${task.platform}" chưa có script trích xuất: viết scripts/platforms/${task.platform}.mjs (docs/research.md "Adapter").`);
  const seen = readSeen(args.seen && args.seen !== true ? path.resolve(String(args.seen)) : seenFile(task));
  const max = Number(args.max) > 0 ? Number(args.max) : 0;
  // The script goes to the Playwright MCP's readable folder (research.script_dir, default ~/.playwright-mcp/social-autopilot): one file per
  // task, <brand>-<task id>.js, exactly the async function browser_run_code_unsafe needs. --stdout prints it instead (no token).
  // For a task of an open run it carries the app's loopback address + a ONE-TIME token (research.token_minutes, default 5): the script POSTs its result there and
  // returns only { saved:true, total, tag, bytes }; when that is not possible it returns the b64 as before.
  const base = args.stdout || task.kind === 'standalone' ? '' : serverBase();
  // the file carries no secret: the Node side of the script fetches a one-time token from token_url when it runs
  const post = base ? { url: `${base}/api/collect-result?task=${encodeURIComponent(task.id)}`, token_url: `${base}/api/collect-token?task=${encodeURIComponent(task.id)}` } : null;
  const code = adapter.pageScript({ found_by: task.found_by, max, seen, ...(post ? { post } : {}) });
  if (args.stdout) { process.stdout.write(code + '\n'); return; }
  const dir = scriptDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = scriptFile(brand?.id || task.platform, task.id, dir);
  fs.writeFileSync(file, code + '\n');
  fs.rmSync(resultFile(task.dir), { force: true });
  const [lo, hi] = scrollWait(task.platform);
  process.stdout.write(JSON.stringify({ platform: task.platform, file, chars: code.length, seen_ids: seen.length, transfer: post ? 'post' : 'b64',
    run: post ? 'browser_run_code_unsafe with filename = file (do not paste or copy the script). It reads the page; the Node side of the script posts the result to the app and returns {saved:true,total,tag,bytes}; then run from-page with no --b64. saved:false with HTTP 403: run collect.mjs script again. Other saved:false: use the b64 it returns (pass it as --b64; reason_saved says why).' : 'browser_run_code_unsafe with filename = file (do not paste the script); it returns ONE line {b64, tag}: pass b64 to from-page --b64 (copy it, never retype). '+(args.stdout ? '--stdout: no transfer token, the b64 path is used.' : task.kind === 'standalone' ? 'Standalone task: no transfer token, the b64 path is used.' : 'The app is not running (workspace/server-address.json missing), so the result cannot be sent automatically.'),
    from_page: `node scripts/collect.mjs from-page ${forArgOf(task, brand)}${post ? '' : ' --b64 <b64>'}`, scroll: scrollHint(task.platform, lo, hi), ...timeInfo(task.started) }) + '\n');
}

export async function fromPage(args) {
  const t0 = Date.now();
  const { brand, task, run } = taskOf(args);
  const adapter = getAdapter(task.platform);
  if (!adapter) return fail(`Chưa có adapter cho nền tảng "${task.platform}".`, { platform: task.platform });
  let loaded;
  try { loaded = loadPageResult(args, undefined, resultFile(task.dir)); } catch (e) { return fail(String(e.message || e), { verified: false }); }
  const result = loaded.result;
  fs.rmSync(resultFile(task.dir), { force: true }); // spent: the next extract sends a new one
  // Accumulate across extracts of the same task: earlier posts stay in raw.json, earlier ids are skipped.
  const prevRaw = readJson(task.raw_file, null);
  const prevSeen = readSeen(seenFile(task));
  const state0 = readJson(path.join(task.dir, 'extracts.json'), { extracts: 0, idle: 0 });
  const prevPosts = prevRaw?.posts || [];
  const known = task.known_file ? readJson(task.known_file, { count: 0 }) : brand ? knownPosts(brand.id) : { count: 0 };
  const prog0 = readJson(progressFile(task), { read: prevPosts.length + (prevRaw?.rejected || []).length });
  const factor = Math.max(1, Number(settings().research?.max_read_factor) || 3);
  // download cap = what may still be READ (factor x need), not the need: rejected posts must not use up the share
  const left = task.max ? Math.max(0, factor * task.max - prog0.read) : 0;
  const r = pageResultPosts(result, adapter, { cursor: makeCursor({ mode: task.mode, known }), max: task.max ? left : 0, found_by: task.found_by, skip: [...prevSeen, ...prevPosts.map((p) => p.collector_id)] });
  const rawDir = path.join(task.dir, 'raw');
  fs.mkdirSync(rawDir, { recursive: true });
  const perPost = Math.max(1, Number(args.images) || 4);
  const posts = [];
  let noImage = 0;
  if (!r.loginWall && (!task.max || left > 0)) {
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
  const all = [...prevPosts, ...posts];
  const seen = [...new Set([...prevSeen, ...tileKeys(result?.tiles)])];
  writeJson(seenFile(task), seen);
  const idle = posts.length ? 0 : state0.idle + 1;
  const extracts = state0.extracts + 1;
  writeJson(path.join(task.dir, 'extracts.json'), { extracts, idle });
  const st = adapterStatus(task.platform);
  const blocked = !!r.loginWall;
  const reason = String(result?.reason || '');
  const allKnown = !blocked && r.read > 0 && r.skippedKnown === r.read && !posts.length;
  const note = blocked ? `${reason || 'login wall / block page'}: ${String(result?.signals?.url || result?.url || '').slice(0, 80)}` : !all.length && !r.read && !(result?.total_on_page) ? 'error: 0 posts on the page (page empty or selectors no longer fit)' : noImage && !posts.length && r.read ? 'error: posts read but no image could be downloaded' : '';
  writeJson(task.raw_file, { ...rawShape(task, all, { rejected: prevRaw?.rejected || [] }) });
  const cnt = counters({ posts: all, rejected: prevRaw?.rejected || [] }, prog0.read + posts.length, task.max);
  writeJson(progressFile(task), { read: cnt.read, need: cnt.need });
  const fs0 = task.max ? fitStop(cnt, factor) : '';
  const target = fs0 === 'target';
  const poor = fs0 === 'poor_source';
  const summary = counterLine(cnt, { target: run?.mode?.max_posts || 0, kept: (run ? brandTotal(run) : 0) + cnt.kept });
  const stop = blocked ? 'blocked' : target ? 'target' : poor ? 'poor_source' : allKnown ? 'known' : idle >= 3 ? 'no_new' : result?.closed && !r.read ? 'end' : '';
  const tm = timeInfo(task.started);
  const state = blocked ? 'blocked' : suggestedState(task.kind, { blocked, error: /^error/.test(note), limit: target, read: all.length, stop: task.kind === 'source' ? (allKnown ? 'known' : stop === 'no_new' ? 'end' : '') : '' });
  const idArg = task.kind === 'query' ? `--query ${task.id}` : task.kind === 'source' ? `--source ${task.id}` : '';
  const b = brand?.id || '<id>';
  const trust = isTrusted(task.platform) && !/^error/.test(note);
  const done = task.kind === 'query' ? `Nhìn ảnh review[].image, ghi decisions: node scripts/collect.mjs fit --brand ${b} --for-query ${task.id} --file <decisions.json>; node scripts/research.mjs ingest --brand ${b} ${idArg}; node scripts/research.mjs result --brand ${b} ${idArg} --state ${state}`
    : `node scripts/research.mjs ingest --brand ${b} ${idArg}; node scripts/research.mjs result --brand ${b} ${idArg} --state ${state}`;
  const [lo, hi] = scrollWait(task.platform);
  const next = blocked ? `Bị chặn (${reason || 'login wall'}): node scripts/research.mjs result --brand ${b} ${idArg} --state blocked --note "${note.replace(/"/g, "'")}" (dừng nền tảng này).`
    : tm.time_over && !stop ? (cnt.pending_fit > 0 && task.max ? 'Nhìn ảnh review[] và chạy collect.mjs fit ngay, rồi: ' : '') + TIME_NEXT
    : !blocked && cnt.pending_fit > 0 && task.max ? `Nhìn ảnh review[] rồi chạy ngay: node scripts/collect.mjs fit --brand ${b} ${task.kind === 'query' ? '--for-query' : '--for-source'} ${task.id} --file <decisions.json>, rồi đọc need_more (run collect.mjs fit on review[], then check need_more).`
      : stop ? `Dừng (${stop}): ${done}`
      : `Cuộn tiếp (scrollBy của next.scroll 1-2 lần, chờ ${lo}-${hi} s), rồi chạy lại script (node scripts/collect.mjs script ${forArgOf(task, brand)}) và from-page.${trust ? '' : ` Adapter ${st.status}: so kết quả với trang thật trước khi tin.`}`;
  if (task.kind !== 'standalone') track('crawl', { brand: b, detail: `${task.id}: extract ${extracts}, +${posts.length} · ${summary}` });
  out({ brand: brand?.id || '', platform: task.platform, kind: task.kind, [task.kind === 'source' ? 'source' : 'query']: task.id, url: task.url, adapter: st, trusted: trust,
    verified: loaded.verified, ...(loaded.tag ? { tag: loaded.tag } : {}), extract: extracts, extracts_without_new: idle, total_on_page: result?.total_on_page ?? null, read: r.read, added: posts.length, collected: all.length, target: task.max || 0, counters: cnt, summary,
    ...(loaded.verified ? {} : { warning: 'hand-made result (no total/checksum): not verified, check the posts against the page' }), ...(tm.started ? { time_limit_minutes: tm.time_limit_minutes, started: tm.started, elapsed: tm.elapsed } : {}), skipped_known: r.skippedKnown, dropped_no_image: noImage, seconds: Math.round((Date.now() - t0) / 1000), stop: stop || (tm.time_over ? 'time' : ''), suggested_state: state, ...(note ? { note } : {}), raw_file: task.raw_file,
    review: posts.map((p, i) => ({ n: prevPosts.length + i + 1, id: p.collector_id, url: p.post_url, author: p.author, date: p.posted_date, caption: p.caption.slice(0, 140), image: path.join(task.dir, p.images[0]) })), next });
}
