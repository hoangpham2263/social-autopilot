// The research STORE (kho) of each brand: every post crawled from the brand's own research sources, kept across crawls,
// separate from the dated crawl logs in workspace/runs/. Mode "Chỉ nghiên cứu" fills it (research.mjs ingest); mode
// "Tạo bài từ kho" reads it (ideas.mjs init takes only items with status "new" and marks them "used").
//   workspace/store/<brand>/items.json      { brand, updated, next, items: [ item ] }
//   workspace/store/<brand>/images/          <item-id>-<n>-<sha8>.<ext> (copies of the downloaded post images)
//   workspace/store/<brand>/progress.json    per source: newest_seen / oldest_seen ({ date, post_id, post_url, item }),
//                                            reached_end (scrolled to the end of the page once), blocked, last_run
//                                            ({ run, mode: new|backfill|full, state, new_on_top, backfilled, at })
//   workspace/store/<brand>/ideas.json       the brand's ideas (ideas.mjs), each tied to one store item
// item: { id: "S0001", source_id, source_url, store, post_url, alt_urls?, post_key(s), post_ids, captured, posted_date,
//         caption, caption_norm, caption_hash, main_product, price_seen, images: ["images/S0001-1-ab12cd34.jpg"],
//         image_sha1: [..], image_phash: [..], status: new|used|rejected, used_by: [idea/draft ids], note, run }
//   workspace/store/<brand>/duplicates.json  every post not stored because it matched an item (rule + item id)
// Brands never mix: each brand has its own folder; a source id belongs to that brand's social.json only.
//   node scripts/store.mjs list    --brand <id> [--status new|used|rejected] [--source <sid>] [--limit n]
//   node scripts/store.mjs show    --brand <id> --id S0001
//   node scripts/store.mjs reject  --brand <id> --id S0001 [--note "..."]      "bỏ": never picked for ideas
//   node scripts/store.mjs restore --brand <id> --id S0001                     rejected -> new
//   node scripts/store.mjs known   --brand <id> [--source <sid>]               post links already in the store
//   node scripts/store.mjs migrate [--brand <id>]                             old runs/<brand>/<date>/<src>/refs.json -> store
import fs from 'node:fs';
import path from 'node:path';
import { main, out, isMain, parseArgs, need, workspace, settings, readJson, writeJson, withLock, stamp, sha1, cleanText } from './lib.mjs';
import { imageHashes, hamming } from './phash.mjs';

export const STATUSES = ['new', 'used', 'rejected'];
const validBrand = (b) => { if (!/^[a-z0-9][a-z0-9-]*$/.test(String(b || ''))) throw new Error('Mã thương hiệu không hợp lệ.'); return String(b); };
export const storeDir = (brand) => path.join(workspace, 'store', validBrand(brand));
// A reference page's avatar, saved by research.mjs ingest: store/<brand>/sources/<source>/avatar.<ext>; '' when none.
export function sourceAvatar(brand, source) {
  const dir = path.join(storeDir(brand), 'sources', String(source || ''));
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(source || ''))) return '';
  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) { const f = path.join(dir, `avatar.${ext}`); if (fs.existsSync(f)) return f; }
  return '';
}
export const itemsFile = (brand) => path.join(storeDir(brand), 'items.json');
export const progressFile = (brand) => path.join(storeDir(brand), 'progress.json');
export const storeIdeasFile = (brand) => path.join(storeDir(brand), 'ideas.json');

export const readStore = (brand) => { const s = readJson(itemsFile(brand), null) || {}; return { brand, updated: s.updated || '', next: s.next || 0, items: Array.isArray(s.items) ? s.items : [] }; };
const saveStore = (brand, s) => { s.updated = stamp(); writeJson(itemsFile(brand), s); };
// Every change of a brand's store runs inside the items.json lock.
export const withStore = (brand, fn) => withLock(itemsFile(brand), () => { const s = readStore(brand); const r = fn(s); saveStore(brand, s); return r; });
export const readProgress = (brand) => readJson(progressFile(brand), { sources: {} });

// ----- duplicates: the store never keeps the same post twice (user, 09/11/2026) -----
// (1) same post: normalized link (host without www./m./web., Facebook ids kept, tracking parameters dropped) or any
//     Facebook id of the post (fbid, story_fbid, /posts/<id>, /photos/.../<id>, /videos/<id>, pfbid...). Facebook shows
//     one post under several ids (the post and each photo's fbid): raw.json may list every link it saw in alt_urls.
// (2) same caption: hash of the normalized caption (lowercase, no hidden characters, emoji, hashtags, links, phone
//     numbers, punctuation, spaces), and near-identical captions (character-trigram similarity >= caption_similarity).
// (3) same image: SHA-1 of the file, or perceptual hash (dHash 256 bits, scripts/phash.mjs) within image_distance bits,
//     across ALL sources of the brand (a photo reposted by another shop or later is still one post).
// Every duplicate is logged in workspace/store/<brand>/duplicates.json with the item it matched and the rule.
export function postKey(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  let u; try { u = new URL(raw); } catch { return raw.toLowerCase(); }
  const host = u.hostname.toLowerCase().replace(/^(www|m|web|mbasic|mobile)\./, '');
  const keep = /facebook\.com$|fb\.com$/.test(host) ? ['fbid', 'story_fbid', 'id', 'v'] : [];
  const q = keep.filter((k) => u.searchParams.get(k)).map((k) => `${k}=${u.searchParams.get(k)}`).join('&');
  return `${host}${u.pathname.replace(/\/+$/, '')}${q ? '?' + q : ''}`.toLowerCase();
}
// The post ids inside a Facebook link (several per link possible); other sites: none.
export function postIds(url) {
  let u; try { u = new URL(String(url || '').trim()); } catch { return []; }
  if (!/(^|\.)(facebook\.com|fb\.com|fb\.watch)$/i.test(u.hostname)) return [];
  const ids = new Set();
  for (const k of ['fbid', 'story_fbid', 'v']) { const v = u.searchParams.get(k); if (v && /^(\d{5,}|pfbid\w+)$/.test(v)) ids.add(v); }
  const m = u.pathname.match(/\/(?:posts|photos|videos|reel|permalink)\/(?:[^/]+\/)*?((?:\d{5,})|(?:pfbid\w+))\/?$/i) || u.pathname.match(/\/((?:\d{8,})|(?:pfbid\w{10,}))\/?$/i);
  if (m) ids.add(m[1]);
  return [...ids];
}
export function normCaption(text) {
  return cleanText(text).text.toLowerCase().normalize('NFC')
    .replace(/https?:\/\/\S+|www\.\S+/g, ' ').replace(/#[\p{L}\p{N}_]+/gu, ' ').replace(/\+?\d[\d .-]{7,}\d/g, ' ')
    .replace(/\p{Extended_Pictographic}|\p{Emoji_Modifier}|‍|️/gu, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
const trigrams = (t) => { const g = new Set(); for (let i = 0; i + 3 <= t.length; i++) g.add(t.slice(i, i + 3)); return g; };
export function captionSimilarity(a, b) {
  const x = trigrams(a), y = trigrams(b);
  if (!x.size || !y.size) return 0;
  let n = 0; for (const g of x) if (y.has(g)) n++;
  return (2 * n) / (x.size + y.size);
}
const MIN_CAPTION = 40; // shorter normalized captions ("đèn neon giá rẻ") are too common to call a duplicate
const dedupeSettings = () => { const d = settings().research?.dedupe || {}; return { image_distance: Number.isFinite(d.image_distance) ? d.image_distance : 20, caption_similarity: Number.isFinite(d.caption_similarity) ? d.caption_similarity : 0.9 }; };

// The first rule a post breaks against the store (or posts added earlier in the same call): { item, rule, detail }.
export function findDuplicate(post, items, cfg = dedupeSettings()) {
  const keys = [post.post_url, ...[].concat(post.alt_urls || [])].map(postKey).filter(Boolean);
  const ids = [post.post_url, ...[].concat(post.alt_urls || [])].flatMap(postIds);
  for (const it of items) {
    const k = keys.find((x) => (it.post_keys || [it.post_key]).includes(x));
    if (k) return { item: it.id, rule: 'post_url', detail: k };
    const id = ids.find((x) => (it.post_ids || []).includes(x));
    if (id) return { item: it.id, rule: 'post_id', detail: id };
  }
  for (const it of items) {
    const h = post.sha1.find((x) => (it.image_sha1 || []).includes(x));
    if (h) return { item: it.id, rule: 'image_sha1', detail: h.slice(0, 12) };
  }
  for (const it of items) for (const a of post.phash.filter(Boolean)) for (const b of it.image_phash || []) {
    const d = hamming(a, b);
    if (d <= cfg.image_distance) return { item: it.id, rule: 'image_phash', detail: `khác ${d}/256 bit` };
  }
  if (post.caption_norm.length >= MIN_CAPTION) {
    for (const it of items) if (it.caption_hash && it.caption_hash === post.caption_hash) return { item: it.id, rule: 'caption', detail: 'caption giống hệt' };
    for (const it of items) {
      if (!it.caption_norm || it.caption_norm.length < MIN_CAPTION) continue;
      const sim = captionSimilarity(post.caption_norm, it.caption_norm);
      if (sim >= cfg.caption_similarity) return { item: it.id, rule: 'caption_similar', detail: `giống ${Math.round(sim * 100)}%` };
    }
  }
  return null;
}
const RULE_TEXT = { post_url: 'trùng link bài', post_id: 'trùng mã bài Facebook', image_sha1: 'trùng file ảnh', image_phash: 'trùng ảnh (gần giống)', caption: 'trùng caption', caption_similar: 'caption gần giống' };
const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
export const duplicatesFile = (brand) => path.join(storeDir(brand), 'duplicates.json');

// Adds crawled posts of one source to the brand's store. posts: [{ post_url, alt_urls?, caption, images: [abs path],
// posted_date?, main_product?, price_seen?, store? }], images already checked by the caller. A duplicate (rules above)
// is not stored; it is logged with the item it matched. since = drop posts dated before it; limit = at most that many
// new. Returns { added: [ids], duplicates: [..], dropped: [..], hidden, unhashed }.
export function addPosts(brand, src, posts, { run = '', since = '', limit = 0, log = true } = {}) {
  const cfg = dedupeSettings();
  const phashes = imageHashes(posts.flatMap((p) => p.images), { ffmpeg: process.env.SA_FFMPEG || settings().ffmpeg?.command || '' });
  const result = withStore(brand, (s) => {
    const dir = path.join(storeDir(brand), 'images');
    fs.mkdirSync(dir, { recursive: true });
    const added = [], dropped = [], duplicates = [];
    let hidden = 0, unhashed = 0;
    for (const p of posts) {
      if (since && validDate(p.posted_date) && p.posted_date < since) { dropped.push({ post_url: p.post_url, reason: `đăng trước --since ${since}` }); continue; }
      const files = p.images.map((f) => { const data = fs.readFileSync(f); return { f, data, sha1: sha1(data), phash: phashes.get(f) || '' }; })
        .filter((x, i, all) => all.findIndex((y) => y.sha1 === x.sha1) === i);
      unhashed += files.filter((x) => !x.phash).length;
      const caption = cleanText(p.caption);
      const norm = normCaption(caption.text);
      const cand = { post_url: p.post_url, alt_urls: p.alt_urls, sha1: files.map((x) => x.sha1), phash: files.map((x) => x.phash), caption_norm: norm, caption_hash: norm ? sha1(norm) : '' };
      const dup = findDuplicate(cand, s.items, cfg);
      if (dup) { duplicates.push({ post_url: p.post_url || '', matched: dup.item, rule: dup.rule, reason: RULE_TEXT[dup.rule], detail: dup.detail }); continue; }
      if (limit && added.length >= limit) { dropped.push({ post_url: p.post_url, reason: 'vượt --max-posts' }); continue; }
      const id = `S${String(++s.next).padStart(4, '0')}`;
      const images = files.map((x, n) => {
        const name = `${id}-${n + 1}-${x.sha1.slice(0, 8)}${(path.extname(x.f) || '.jpg').toLowerCase().replace('.jpeg', '.jpg')}`;
        fs.writeFileSync(path.join(dir, name), x.data);
        return `images/${name}`;
      });
      const urls = [p.post_url, ...[].concat(p.alt_urls || [])].filter(Boolean).map(String);
      hidden += caption.removed + caption.nbsp;
      s.items.push({
        id, source_id: src.id, source_url: src.url || '', store: cleanText(p.store || src.name || src.id).text,
        post_url: String(p.post_url || ''), ...(urls.length > 1 ? { alt_urls: urls.slice(1) } : {}), post_key: postKey(p.post_url), post_keys: [...new Set(urls.map(postKey).filter(Boolean))], post_ids: [...new Set(urls.flatMap(postIds))],
        captured: p.captured || stamp(), posted_date: validDate(p.posted_date) ? p.posted_date : '',
        caption: caption.text, caption_norm: norm, caption_hash: cand.caption_hash, main_product: cleanText(p.main_product).text, price_seen: cleanText(p.price_seen).text,
        images, image_sha1: cand.sha1, image_phash: cand.phash, status: 'new', used_by: [], run,
      });
      added.push(id);
    }
    return { added, dropped, duplicates, hidden, unhashed };
  });
  if (log && result.duplicates.length) {
    const file = duplicatesFile(brand);
    withLock(file, () => { const log = readJson(file, { duplicates: [] }); log.duplicates.push(...result.duplicates.map((d) => ({ at: stamp(), source: src.id, run, ...d }))); writeJson(file, log); });
  }
  return result;
}

// The newest and the oldest post of a source in the store: { date, post_id, post_url, item } (null when none). By
// posted_date; on equal dates (and for undated stores) the crawl order decides: a crawl scrolls from new to old, so
// the first item stored is the newest and the last one the oldest.
export function sourceBounds(items) {
  if (!items.length) return { newest_seen: null, oldest_seen: null };
  const pick = (i) => ({ date: validDate(i.posted_date) ? i.posted_date : '', post_id: (i.post_ids || [])[0] || '', post_url: i.post_url || '', item: i.id });
  const dated = items.filter((i) => validDate(i.posted_date));
  if (dated.length) {
    const max = dated.reduce((m, i) => (i.posted_date > m ? i.posted_date : m), dated[0].posted_date);
    const min = dated.reduce((m, i) => (i.posted_date < m ? i.posted_date : m), dated[0].posted_date);
    return { newest_seen: pick(dated.find((i) => i.posted_date === max)), oldest_seen: pick(dated.findLast((i) => i.posted_date === min)) };
  }
  const runs = items.map((i) => String(i.run || '')).sort();
  return { newest_seen: pick(items.find((i) => String(i.run || '') === runs.at(-1))), oldest_seen: pick(items.findLast((i) => String(i.run || '') === runs[0])) };
}

// What the crawling agent needs to know where to stop on a source: links already in the store, the newest and the
// oldest post of the source (oldest_seen: where a backfill starts collecting).
export function knownPosts(brand, sourceId) {
  const items = readStore(brand).items.filter((i) => !sourceId || i.source_id === sourceId);
  const dates = items.map((i) => i.posted_date).filter(Boolean).sort();
  // Duplicates are checked across every source of the brand, so the ids/links to skip before downloading are brand-wide.
  const all = readStore(brand).items;
  return { source: sourceId || null, count: items.length, newest_posted_date: dates.at(-1) || '', oldest_posted_date: dates[0] || '', ...sourceBounds(items), post_urls: items.map((i) => i.post_url).filter(Boolean),
    brand_post_urls: all.flatMap((i) => [i.post_url, ...(i.alt_urls || [])]).filter(Boolean), brand_post_ids: [...new Set(all.flatMap((i) => i.post_ids || []))] };
}

export function counts(items) {
  const c = { total: items.length, new: 0, used: 0, rejected: 0 };
  for (const i of items) c[i.status] = (c[i.status] || 0) + 1;
  return c;
}
export function listItems(brand, { status = '', source = '' } = {}) {
  if (status && !STATUSES.includes(status)) throw new Error(`Trạng thái phải là ${STATUSES.join(', ')}.`);
  const all = readStore(brand).items;
  const sources = [...new Set(all.map((i) => i.source_id))].sort();
  const items = all.filter((i) => (!status || i.status === status) && (!source || i.source_id === source));
  return { brand, dir: storeDir(brand), counts: counts(all), sources, items };
}
export const findItem = (brand, id) => { const i = readStore(brand).items.find((x) => x.id === id); if (!i) throw new Error(`Kho ${brand} không có ${id}.`); return i; };

// "Bỏ" (rejected: never picked for ideas) and "khôi phục" (back to new). A used item keeps its history (used_by).
export function setItemStatus(brand, id, status, { note = '', by = 'user' } = {}) {
  if (!['rejected', 'new'].includes(status)) throw new Error('Chỉ đổi được sang rejected (bỏ) hoặc new (khôi phục).');
  return withStore(brand, (s) => {
    const it = s.items.find((x) => x.id === id);
    if (!it) throw new Error(`Kho ${brand} không có ${id}.`);
    if (status === 'rejected' && it.status === 'rejected') throw new Error(`${id} đã bỏ rồi.`);
    if (status === 'new' && it.status !== 'rejected') throw new Error(`Chỉ khôi phục được bài đã bỏ (${id} đang "${it.status}").`);
    it.status = status;
    if (status === 'rejected') Object.assign(it, { note: String(note || '').trim(), rejected_by: String(by || 'user').trim() || 'user', rejected_at: stamp() });
    else { delete it.note; delete it.rejected_by; delete it.rejected_at; }
    return { ...it };
  });
}

// Marks items used by an idea or a draft (ideas.mjs init, draft.mjs new); used items are never picked again.
export function markUsed(brand, ids, by) {
  return withStore(brand, (s) => {
    for (const id of [].concat(ids)) {
      const it = s.items.find((x) => x.id === id);
      if (!it) throw new Error(`Kho ${brand} không có ${id}.`);
      it.status = 'used';
      it.used_by = [...new Set([...(it.used_by || []), by])];
      it.used_at ||= stamp();
    }
  });
}

// Per-source crawl outcome (research.mjs result) kept with the store, so the next crawl knows what happened:
// newest_seen / oldest_seen (from the store), reached_end (once true it stays: the oldest post was reached), last_run.
// result: { state, label?, note?, reached_end, new, new_on_top?, backfilled? }; run: { date, mode }.
export function recordProgress(brand, sourceId, result, run = {}) {
  const file = progressFile(brand);
  return withLock(file, () => {
    const p = readJson(file, { sources: {} });
    const before = p.sources[sourceId] || {};
    const k = knownPosts(brand, sourceId);
    p.sources[sourceId] = {
      ...before, last_crawl: stamp(), last_result: result,
      reached_end: !!(before.reached_end || result.reached_end), ...(result.reached_end ? { reached_end_at: stamp() } : {}),
      blocked: result.state === 'blocked' ? result.note || 'checkpoint/captcha' : '',
      items: k.count, newest_posted_date: k.newest_posted_date, oldest_posted_date: k.oldest_posted_date,
      newest_seen: k.newest_seen, oldest_seen: k.oldest_seen,
      last_run: { run: run.date || '', mode: run.mode || 'new', state: result.state, note: result.note || '', new_on_top: result.new_on_top || 0, backfilled: result.backfilled || 0, at: stamp() },
    };
    writeJson(file, p);
    return p.sources[sourceId];
  });
}

// Old dated runs (workspace/runs/<brand>/<date>/<source>/refs.json, before the store existed) into the store, oldest
// run first, duplicates dropped. Ideas of those runs that became drafts mark their reference "used" (used_by = drafts).
// Run again any time: nothing is added twice.
export function migrateRuns(brand) {
  const root = path.join(workspace, 'runs', validBrand(brand));
  const report = { brand, runs: [], added: 0, duplicates: 0, used: 0 };
  if (!fs.existsSync(root)) return report;
  for (const date of fs.readdirSync(root).filter((d) => validDate(d)).sort()) {
    const dir = path.join(root, date);
    const map = {};
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const refsFile = path.join(dir, e.name, 'refs.json');
      if (!e.isDirectory() || !fs.existsSync(refsFile)) continue;
      const refs = (readJson(refsFile, { refs: [] }).refs || []).filter((r) => r?.image && fs.existsSync(path.join(dir, e.name, r.image)));
      const posts = refs.map((r) => ({ post_url: r.post_url, caption: r.caption, images: [path.join(dir, e.name, r.image)], main_product: r.main_product, price_seen: r.price_seen, store: r.store, captured: `${date}T00:00:00.000Z` }));
      const r = addPosts(brand, { id: e.name, url: refs[0]?.source_url || '', name: refs[0]?.store || e.name }, posts, { run: date, log: false }); // re-running the migration is not a crawl: no duplicate log
      // Map every ref (added or duplicate) to its store item by post link or image, so drafted ideas find their item.
      const s = readStore(brand);
      for (const ref of refs) {
        const key = postKey(ref.post_url);
        const it = s.items.find((x) => (key && (x.post_keys || [x.post_key]).includes(key)) || (x.image_sha1 || []).includes(ref.image_sha1));
        if (it) map[`${e.name}/${ref.id}`] = it.id;
      }
      report.added += r.added.length; report.duplicates += r.duplicates.length;
      report.runs.push({ date, source: e.name, refs: refs.length, added: r.added.length, duplicates: r.duplicates.length });
    }
    for (const idea of readJson(path.join(dir, 'ideas.json'), { ideas: [] }).ideas || []) {
      const id = map[idea.ref];
      if (!id || !(idea.drafts || []).length) continue;
      for (const d of idea.drafts) markUsed(brand, id, d);
      report.used++;
    }
  }
  return report;
}

const brandsInWorkspace = () => { const d = path.join(workspace, 'runs'); return fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && /^[a-z0-9][a-z0-9-]*$/.test(e.name)).map((e) => e.name) : []; };

if (isMain(import.meta.url)) main(() => {
  const args = parseArgs();
  const cmd = args._[0];
  if (cmd === 'migrate') return out({ brands: (args.brand ? [String(args.brand)] : brandsInWorkspace()).map(migrateRuns) });
  const brand = need(args, 'brand');
  if (cmd === 'list') {
    const r = listItems(brand, { status: args.status ? String(args.status) : '', source: args.source ? String(args.source) : '' });
    const limit = Number(args.limit) || 0;
    return out({ ...r, items: (limit ? r.items.slice(-limit) : r.items).map(({ id, source_id, status, posted_date, post_url, main_product, images, used_by }) => ({ id, source_id, status, posted_date, post_url, main_product, images: images.map((f) => path.join(storeDir(brand), f)), used_by })) });
  }
  if (cmd === 'show') { const it = findItem(brand, need(args, 'id')); return out({ item: { ...it, image_paths: it.images.map((f) => path.join(storeDir(brand), f)) } }); }
  if (cmd === 'reject') return out({ item: setItemStatus(brand, need(args, 'id'), 'rejected', { note: args.note === true ? '' : args.note, by: args.by === true ? '' : args.by }) });
  if (cmd === 'restore') return out({ item: setItemStatus(brand, need(args, 'id'), 'new') });
  if (cmd === 'known') { const k = knownPosts(brand, args.source ? String(args.source) : ''); return out(k); }
  throw new Error('Lệnh: list | show | reject | restore | known | migrate');
});
