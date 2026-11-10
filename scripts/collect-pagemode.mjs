// In-page mode of the collector (no CDP Chrome): `collect.mjs script` prints a script the agent runs with ONE Playwright MCP call
// (browser_run_code_unsafe) in the user's signed-in Chrome; `collect.mjs from-page` turns its JSON result into the same raw.json
// the CDP path writes (drops posts the store already has BEFORE downloading, downloads the images with the platform's referer).
// Read only. No cookies or tokens are written; images are fetched without cookies.
import fs from 'node:fs';
import path from 'node:path';
import { out, fail, need, settings, loadBrand, readJson, writeJson } from './lib.mjs';
import { track } from './progress.mjs';
import { openRun } from './research.mjs';
import { knownPosts } from './store.mjs';
import { makeCursor } from './crawl-fb.mjs';
import { getAdapter, adapterStatus, isTrusted } from './platforms/index.mjs';
import { resolveTask, delayRange, toRawPost, rawShape, suggestedState, fileId } from './collect.mjs';

// ---------- pure parts (tests/collect.test.mjs) ----------
// Result of the in-page script (maybe wrapped in MCP text: first { .. last }) -> object.
export function parsePageResult(text) {
  const t = String(text || '');
  try { return JSON.parse(t); } catch { /* wrapped in MCP output */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('Không đọc được JSON kết quả của script trong trang.');
  return JSON.parse(t.slice(a, b + 1));
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
async function downloadPlain(url, fileBase, referer) {
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
  const max = task.max || 12;
  const steps = Number(args['max-steps']) || (task.kind === 'source' ? Math.min(Number(settings().research?.browser?.max_scroll_steps) || 40, 40) : 4);
  process.stdout.write(adapter.pageScript({ url: task.url, found_by: task.found_by, max, steps, delay: [lo, hi] }) + '\n');
  const forArg = task.kind === 'query' ? `--for-query ${task.id}` : task.kind === 'source' ? `--for-source ${task.id}` : `--platform ${task.platform}`;
  process.stderr.write(`# ${task.platform} ${task.url} max ${max}, up to ${steps} steps, pauses ${lo}-${hi}s. Paste into browser_run_code_unsafe, save the JSON result to a file, then: node scripts/collect.mjs from-page ${brand ? `--brand ${brand.id} ` : ''}${forArg} --file <result.json>\n`);
}

export async function fromPage(args) {
  const t0 = Date.now();
  const { brand, task } = taskOf(args);
  const adapter = getAdapter(task.platform);
  if (!adapter) return fail(`Chưa có adapter cho nền tảng "${task.platform}".`, { platform: task.platform });
  const result = parsePageResult(fs.readFileSync(path.resolve(need(args, 'file')), 'utf8'));
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
  const state = suggestedState(task.kind, { blocked, error: /^error/.test(note), limit: !!task.max && r.posts.length >= task.max, read: r.read, stop: '' });
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
    read: r.read, collected: posts.length, skipped_known: r.skippedKnown, dropped_no_image: noImage, via_post_page: (result?.tiles || []).filter((t) => t.via_post_page).length,
    seconds: Math.round((Date.now() - t0) / 1000), suggested_state: state, ...(note ? { note } : {}), raw_file: task.raw_file,
    review: posts.map((p, i) => ({ n: i + 1, id: p.collector_id, url: p.post_url, author: p.author, caption: p.caption.slice(0, 140), image: path.join(task.dir, p.images[0]) })), next });
}
