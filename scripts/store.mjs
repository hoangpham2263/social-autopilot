// The research STORE (kho) of each brand: every post crawled from the brand's own research sources, kept across crawls,
// separate from the dated crawl logs in workspace/runs/. Mode "Chỉ nghiên cứu" fills it (research.mjs ingest); mode
// "Tạo bài từ kho" reads it (ideas.mjs init). Items are NOT used up (user, 10/11/2026): every post changes the scene and
// the content, so one item may inspire several posts; each draft adds a use ({ draft, idea, scene, product, sign_text, at })
// and the next idea from that item must take a new angle (reuseProblems: a different scene OR a different sign_text;
// sign_text). Never-used items are picked first, then the least used after a cooldown (settings ideas.reuse_cooldown_days).
// Library states (UI and docs): Available (status new: can still be used; "new" or "used N×") · Removed (status
// rejected: not used anymore, with its reason: the filter's, "used enough" or the user's note; Restore brings it back).
// The old separate "retired" state migrates to rejected (reason kept).
//   workspace/store/<brand>/items.json      { brand, updated, next, items: [ item ] }
//   workspace/store/<brand>/images/          <item-id>-<n>-<sha8>.<ext> (copies of the downloaded post images)
//   workspace/store/<brand>/progress.json    per source: newest_seen / oldest_seen ({ date, post_id, post_url, item }),
//                                            reached_end (scrolled to the end of the page once), blocked, last_run
//                                            ({ run, mode: new|backfill|full, state, new_on_top, backfilled, at })
//   workspace/store/<brand>/ideas.json       the brand's ideas (ideas.mjs), each tied to one store item
// item: { id: "S0001", source_id, source_url, store, post_url, alt_urls?, post_key(s), post_ids, captured, posted_date,
//         caption, caption_norm, caption_hash, main_product, price_seen, images: ["images/S0001-1-ab12cd34.jpg"],
//         image_sha1: [..], image_phash: [..], status: new|rejected (Removed), uses: [{ draft, idea, scene, product, sign_text, at }],
//         last_used, used_by: [draft ids] (history), note, run,
//         platform (facebook|instagram|pinterest|tiktok|reddit|etsy|youtube|houzz), author, found_by ("reference page" |
//         "keyword:<kw>" | "hashtag:<tag>"), product_fit: { type, reason }, query (discovery query id) }
//         (old status "used" is read as new + uses: migrateUses; old items without platform: from the post link)
//   workspace/store/<brand>/rejected.json    posts seen but NOT stored because their product is off-brand (product_fit)
//   workspace/store/<brand>/duplicates.json  every post not stored because it matched an item (rule + item id)
// Brands never mix: each brand has its own folder; a source id belongs to that brand's social.json only.
//   node scripts/store.mjs list    --brand <id> [--status new|rejected] [--source <sid>] [--platform <p>] [--limit n]
//                                            new = Available (can still be used, used before included; each item has used = N)
//   node scripts/store.mjs show    --brand <id> --id S0001
//   node scripts/store.mjs reject  --brand <id> --id S0001 [--note "..."]      "bỏ": never picked for ideas
//   node scripts/store.mjs remove  --brand <id> --id S0001 [--note "used enough"]   = reject: Removed, never picked again
//   node scripts/store.mjs restore --brand <id> --id S0001                     Removed -> Available
//   node scripts/store.mjs migrate-uses [--brand <id>]                        old "used" items -> available, uses filled (saved)
//   node scripts/store.mjs known   --brand <id> [--source <sid>]               post links already in the store
//   node scripts/store.mjs classify --brand <id> [--limit 40] [--source <sid>]   the batch filter (RUNBOOK 1.3): unjudged
//                                            "new" items, compact (id, source, caption excerpt, thumbnail path) + what
//                                            to take per source; the agent judges them in one pass (text + thumbnails)
//   node scripts/store.mjs verdict  --brand <id> --file verdicts.json      [{ id, fit: true|false, reason }]: fit:false
//                                            -> rejected, note "filter: <reason>"; fit:true -> kept (filter recorded)
//   node scripts/store.mjs migrate [--brand <id>]                             old runs/<brand>/<date>/<src>/refs.json -> store
import fs from 'node:fs';
import path from 'node:path';
import { main, out, isMain, parseArgs, need, workspace, settings, readJson, writeJson, withLock, stamp, sha1, cleanText, loadBrand, draftsRoot, brandDiscovery } from './lib.mjs';
import { imageHashes, hamming } from './phash.mjs';

export const STATUSES = ['new', 'rejected'];
export const LIST_FILTERS = STATUSES;
export const MEDIA_TYPES = ['photo', 'album', 'video', 'text'];
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

export const readStore = (brand) => { const s = readJson(itemsFile(brand), null) || {}; return { brand, updated: s.updated || '', next: s.next || 0, items: (Array.isArray(s.items) ? s.items : []).map((i) => withUses(brand, i)) }; };

// ----- uses: a library item may inspire several posts, each from a new angle (user, 10/11/2026) -----
// One use per draft, read from the draft's draft.json (scene, product photo, sign text). A draft folder that is gone
// leaves a use with only the draft id (and the item's old used_at).
const DRAFT_ID = /^[a-z0-9][a-z0-9-]*-\d{8}-\d{2,}$/;
export function useFromDraft(brand, draftId, fallbackAt = '') {
  const d = readJson(path.join(draftsRoot, brand, String(draftId), 'draft.json'), null);
  if (!d) return { draft: String(draftId), idea: '', scene: '', product: '', sign_text: '', at: fallbackAt || stamp() };
  return { draft: d.id || String(draftId), idea: d.idea?.id || '', scene: d.idea?.scene || '', product: d.product_image || '', sign_text: d.sign_text || '', ...(d.image_mode === 'scene-swap' ? { image_mode: 'scene-swap' } : {}), at: d.created || fallbackAt || stamp() };
}
const lastOf = (uses) => uses.map((u) => u.at || '').filter(Boolean).sort().at(-1) || '';
// Migration (in memory on every read, saved with the next write or by migrate-uses): status "used" -> "new", uses from
// the draft ids in used_by (idea ids are only history: an idea alone is not a post).
function withUses(brand, it) {
  if (it.status === 'retired') { // the old separate Retired state: Removed with its reason
    const { retired_note, retired_by, retired_at, ...rest } = it;
    it = { ...rest, status: 'rejected', note: retired_note || 'used enough', rejected_by: retired_by || 'user', rejected_at: retired_at || stamp() };
  }
  if (Array.isArray(it.uses) && it.status !== 'used') return it;
  const uses = Array.isArray(it.uses) ? it.uses : [...new Set(it.used_by || [])].filter((x) => DRAFT_ID.test(x)).map((x) => useFromDraft(brand, x, it.used_at));
  return { ...it, status: it.status === 'used' ? 'new' : it.status, uses, last_used: lastOf(uses) };
}
export function migrateUses(brand) {
  const raw = readJson(itemsFile(brand), { items: [] }).items || [];
  const todo = raw.filter((i) => !Array.isArray(i.uses) || ['used', 'retired'].includes(i.status)).map((i) => i.id);
  if (todo.length) withStore(brand, () => null); // readStore already migrated them in memory; saving writes them
  return { brand, migrated: todo.length, items: todo };
}
export const reuseCooldownDays = (s = settings()) => { const d = Number(s.ideas?.reuse_cooldown_days); return Number.isFinite(d) && d >= 0 ? d : 7; };
// settings ideas.suggest_remove_after (default 0 = off): from this many uses an item is only SUGGESTED for Remove.
export const suggestRemoveAfter = (s = settings()) => { const n = Number(s.ideas?.suggest_remove_after); return Number.isInteger(n) && n > 0 ? n : 0; };
export const usesOf = (i) => (Array.isArray(i?.uses) ? i.uses : []);
const lastMs = (i) => { const t = Date.parse(i.last_used || lastOf(usesOf(i))); return Number.isFinite(t) ? t : 0; };
// Available items by kind: fresh (never used), reusable (used before, cooldown over), cooling (used within the cooldown).
// Removed (rejected) items are never available.
export function availability(items, { cooldownDays = reuseCooldownDays(), now = Date.now() } = {}) {
  const cutoff = now - cooldownDays * 86400000;
  const ok = items.filter((i) => i.status === 'new');
  const fresh = ok.filter((i) => !usesOf(i).length), used = ok.filter((i) => usesOf(i).length);
  return { fresh, reusable: used.filter((i) => lastMs(i) <= cutoff), cooling: used.filter((i) => lastMs(i) > cutoff), cooldown_days: cooldownDays };
}
// Fair order: newest first within each source, sources taken in turn.
export function fairOrder(items, n) {
  const by = {};
  for (const i of items) (by[i.source_id] ||= []).push(i);
  for (const list of Object.values(by)) list.sort((a, b) => String(b.posted_date || b.captured).localeCompare(String(a.posted_date || a.captured)) || b.id.localeCompare(a.id));
  const res = [], lists = Object.keys(by).sort().map((k) => by[k]);
  while (res.length < n && lists.some((l) => l.length)) for (const l of lists) if (l.length && res.length < n) res.push(l.shift());
  return res;
}
// What ideas.mjs init picks: fresh items first (fair order), then used items whose cooldown is over, least used first
// (then the longest ago). busy = items with an open idea (not picked twice at once).
export function pickItems(items, n, { source = '', busy = new Set(), cooldownDays = reuseCooldownDays(), now = Date.now() } = {}) {
  const a = availability(items.filter((i) => !busy.has(i.id) && (!source || i.source_id === source)), { cooldownDays, now });
  const res = fairOrder(a.fresh, n);
  if (res.length < n) res.push(...a.reusable.slice().sort((x, y) => usesOf(x).length - usesOf(y).length || lastMs(x) - lastMs(y) || x.id.localeCompare(y.id)).slice(0, n - res.length));
  return res;
}
// A new post from an item must differ from every earlier use (user, 10/11/2026, reference modes): a different scene OR a
// different sign_text. keep-scene reuses keep the scene and change the text; new-scene reuses change the scene and keep
// the text. Blocked = the same scene + the same sign_text + the same product photo as an earlier use. Unknown parts are
// not held against the idea: sign_text undefined (ideas.mjs set: text not chosen yet) = never a repeat yet; product
// undefined = any product. Uses of the same idea/draft are skipped (an idea re-filled, a draft remade).
const normText = (t) => normCaption(t || '');
export const sameScene = (a, b) => { const x = normText(a), y = normText(b); return !!x && !!y && (x === y || captionSimilarity(x, y) >= 0.85); };
const sameFile = (a, b) => !!a && !!b && path.resolve(String(a)).toLowerCase() === path.resolve(String(b)).toLowerCase();
export function reuseProblems(item, { scene, product, sign_text, idea = '', draft = '' } = {}) {
  const problems = [];
  for (const u of usesOf(item)) {
    if ((draft && u.draft === draft) || (idea && u.idea === idea)) continue;
    const by = u.draft || u.idea || 'an earlier post';
    const scenes = sameScene(scene, u.scene) || (!normText(scene) && !normText(u.scene));
    const texts = sign_text !== undefined && normText(sign_text) === normText(u.sign_text);
    const products = product === undefined || !u.product || sameFile(product, u.product);
    if (scenes && texts && products) problems.push(`${item.id} was already used with this scene and this sign text${product !== undefined && u.product ? ' and product' : ''} (${by}: "${u.scene}"${u.sign_text ? `, "${u.sign_text}"` : ''}): change the scene (new-scene) or the sign_text (keep-scene)`);
  }
  return problems;
}
// The earlier uses of an item in short, for the idea batch (the agent picks a new angle).
export const previousUses = (item) => usesOf(item).map((u) => ({ draft: u.draft || '', scene: u.scene || '', product: u.product ? path.basename(u.product) : '', sign_text: u.sign_text || '', ...(u.image_mode ? { image_mode: u.image_mode } : {}), at: String(u.at || '').slice(0, 10) }));
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
  const keep = /facebook\.com$|fb\.com$/.test(host) ? ['fbid', 'story_fbid', 'id', 'v'] : /youtube\.com$/.test(host) ? ['v'] : [];
  const q = keep.filter((k) => u.searchParams.get(k)).map((k) => `${k}=${u.searchParams.get(k)}`).join('&');
  return `${host}${u.pathname.replace(/\/+$/, '')}${q ? '?' + q : ''}`.toLowerCase();
}
// The platform of a link (host), '' when not one of the research platforms.
export const PLATFORM_HOSTS = [['facebook', /(^|\.)(facebook\.com|fb\.com|fb\.watch)$/], ['instagram', /(^|\.)instagram\.com$/], ['pinterest', /(^|\.)pinterest\.[a-z.]+$|^pin\.it$/],
  ['tiktok', /(^|\.)tiktok\.com$/], ['reddit', /(^|\.)(reddit\.com|redd\.it)$/], ['etsy', /(^|\.)etsy\.com$/], ['youtube', /(^|\.)(youtube\.com|youtu\.be)$/], ['houzz', /(^|\.)houzz\.[a-z.]+$/]];
export function platformOfUrl(url) {
  let u; try { u = new URL(String(url || '').trim()); } catch { return ''; }
  const host = u.hostname.toLowerCase();
  return (PLATFORM_HOSTS.find(([, re]) => re.test(host)) || [''])[0];
}
// An item's platform: stored, else from its post link, else from its source page.
export const platformOf = (i) => i?.platform || platformOfUrl(i?.post_url) || platformOfUrl(i?.source_url) || '';
// Post ids of the other platforms, prefixed (the same post under another link form is one post): Instagram /p/ = /reel/,
// YouTube watch?v= = /shorts/ = youtu.be, Pinterest /pin/<slug>--<id>, TikTok /video/<id>, Reddit /comments/<id>,
// Etsy /listing/<id>, Houzz photo ids.
function otherIds(u) {
  const host = u.hostname.toLowerCase(), p = u.pathname;
  let m;
  if (/(^|\.)instagram\.com$/.test(host)) return (m = p.match(/\/(?:p|reels?|tv)\/([\w-]{5,})/)) ? [`ig:${m[1]}`] : [];
  if (/(^|\.)pinterest\.[a-z.]+$/.test(host)) return (m = p.match(/\/pin\/(?:[\w-]*?--)?(\d{6,})/)) ? [`pin:${m[1]}`] : [];
  if (/(^|\.)tiktok\.com$/.test(host)) return (m = p.match(/\/(?:video|photo)\/(\d{8,})/)) ? [`tt:${m[1]}`] : [];
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) { const v = u.searchParams.get('v') || (/youtu\.be$/.test(host) ? p.slice(1).split('/')[0] : (p.match(/\/(?:shorts|embed|live)\/([\w-]{6,})/) || [])[1]); return v ? [`yt:${v}`] : []; }
  if (/(^|\.)reddit\.com$/.test(host)) return (m = p.match(/\/comments\/([a-z0-9]{4,})/i)) ? [`reddit:${m[1].toLowerCase()}`] : [];
  if (/(^|\.)etsy\.com$/.test(host)) return (m = p.match(/\/listing\/(\d{5,})/)) ? [`etsy:${m[1]}`] : [];
  if (/(^|\.)houzz\.[a-z.]+$/.test(host)) return (m = p.match(/(?:~|phvw-vp~)(\d{5,})/)) ? [`houzz:${m[1]}`] : [];
  return [];
}
// The post ids inside a link: Facebook ids (several per link possible), other platforms prefixed (otherIds).
export function postIds(url) {
  let u; try { u = new URL(String(url || '').trim()); } catch { return []; }
  if (!/(^|\.)(facebook\.com|fb\.com|fb\.watch)$/i.test(u.hostname)) return otherIds(u);
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
export const rejectedFile = (brand) => path.join(storeDir(brand), 'rejected.json');

// Product fit (research.discovery.product_fit of the skill, user 10/11/2026): a post is stored only when its product is a
// type the brand actually sells. On a post: product_fit { type, reason } (the agent judged it: kept) or { fit: false,
// reason } (seen, off-brand). required = the post must carry a type (every post the agent captures; a post without one is judged by the filter step). Returns the reason it is off-brand, '' when it fits.
export function fitProblem(post, rules = {}, { required = false } = {}) {
  const pf = post?.product_fit && typeof post.product_fit === 'object' ? post.product_fit : null;
  if (pf && pf.fit === false) return `off-brand: ${cleanText(String(pf.reason || 'not a product the brand sells')).text.trim().slice(0, 200)}`;
  const type = pf && typeof pf.type === 'string' ? pf.type.trim() : '';
  if (!type) return required ? "off-brand: no product_fit.type (one of the brand's product types)" : '';
  const types = (rules.types || []).map((x) => String(x).trim().toLowerCase());
  if (types.length && !types.includes(type.toLowerCase())) return `off-brand: "${type}" is not one of the brand's product types (${(rules.types || []).join(', ')})`;
  return '';
}
// Off-brand posts are never stored; they are logged (rejected.json) with the reason.
export function logRejected(brand, list, extra = {}) {
  if (!list.length) return;
  const file = rejectedFile(brand);
  withLock(file, () => { const log = readJson(file, { rejected: [] }); log.rejected.push(...list.map((x) => ({ at: stamp(), ...extra, ...x }))); writeJson(file, log); });
}

// Adds crawled posts of one source to the brand's store. posts: [{ post_url, alt_urls?, caption, images: [abs path],
// posted_date?, main_product?, price_seen?, store? }], images already checked by the caller. A duplicate (rules above)
// is not stored; it is logged with the item it matched. since = drop posts dated before it; limit = at most that many
// new. Returns { added: [ids], duplicates: [..], dropped: [..], hidden, unhashed }.
// src may carry platform, found_by ("reference page" | "keyword:<kw>" | "hashtag:<tag>") and query (discovery query id);
// a post may carry its own platform, author, product_fit, likes. productFit = the skill's product_fit rules; requireFit =
// a post without product_fit.type is off-brand. Off-brand posts are not stored (rejected[], logged in rejected.json).
export function addPosts(brand, src, posts, { run = '', since = '', limit = 0, log = true, crawlMode = '', productFit = null, requireFit = false } = {}) {
  const rejected = [];
  posts = posts.filter((p) => {
    const why = productFit || requireFit || p.product_fit ? fitProblem(p, productFit || {}, { required: requireFit }) : '';
    if (why) rejected.push({ post_url: String(p.post_url || ''), author: cleanText(p.author || '').text, platform: p.platform || src.platform || platformOfUrl(p.post_url), found_by: p.found_by || src.found_by || 'reference page', reason: why });
    return !why;
  });
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
        // Image-only posts are kept; caption_empty tells the filter step (classify) there is no text to judge.
        ...(caption.text.trim() ? {} : { caption_empty: true }),
        ...(MEDIA_TYPES.includes(p.media_type) ? { media_type: p.media_type } : {}),
        ...(crawlMode ? { crawl_mode: crawlMode } : {}), ...(Number.isInteger(p.page_pos) ? { page_pos: p.page_pos } : {}),
        platform: p.platform || src.platform || platformOfUrl(p.post_url) || platformOfUrl(src.url) || '',
        found_by: cleanText(p.found_by || src.found_by || 'reference page').text,
        ...(cleanText(p.author || '').text ? { author: cleanText(p.author).text.slice(0, 120) } : {}),
        ...(typeof p.product_fit?.type === 'string' && p.product_fit.type.trim() ? { product_fit: { type: p.product_fit.type.trim(), reason: cleanText(String(p.product_fit.reason || '')).text.trim().slice(0, 300) } } : {}),
        ...(src.query ? { query: src.query } : {}), ...(Number.isFinite(Number(p.likes)) && p.likes !== '' && p.likes !== null && p.likes !== undefined ? { likes: Number(p.likes) } : {}),
      });
      added.push(id);
    }
    return { added, dropped, duplicates, hidden, unhashed, rejected };
  });
  if (log) logRejected(brand, rejected, { source: src.id, run, ...(src.query ? { query: src.query } : {}) });
  if (log && result.duplicates.length) {
    const file = duplicatesFile(brand);
    withLock(file, () => { const log = readJson(file, { duplicates: [] }); log.duplicates.push(...result.duplicates.map((d) => ({ at: stamp(), source: src.id, run, ...d }))); writeJson(file, log); });
  }
  return result;
}

// The newest and the oldest post of a source in the store: { date, post_id, post_url, item } (null when none).
// By posted_date. Without dates, by the post's place on the page (page_pos, crawl order as fallback): a crawl scrolls
// from new to old. A backfill only ever brings OLDER posts, so a backfilled item is never the newest while the source
// has other items (an undated top post must not lose "newest" to a dated backfilled one), and the oldest comes from
// the backfilled items when there are any.
export function sourceBounds(items) {
  if (!items.length) return { newest_seen: null, oldest_seen: null };
  const pick = (i) => ({ date: validDate(i.posted_date) ? i.posted_date : '', post_id: (i.post_ids || [])[0] || '', post_url: i.post_url || '', item: i.id });
  const order = items.map((i, n) => ({ i, n, run: String(i.run || ''), pos: Number.isInteger(i.page_pos) ? i.page_pos : n, date: validDate(i.posted_date) ? i.posted_date : '' }));
  const higher = (a, b) => (a.run !== b.run ? (a.run > b.run ? -1 : 1) : a.pos - b.pos || a.n - b.n); // newer on the page first
  const top = order.filter((x) => x.i.crawl_mode !== 'backfill'), back = order.filter((x) => x.i.crawl_mode === 'backfill');
  const pool = top.length ? top : order, dated = pool.filter((x) => x.date);
  const newest = dated.length ? dated.slice().sort((a, b) => (a.date !== b.date ? (a.date > b.date ? -1 : 1) : higher(a, b)))[0] : pool.slice().sort(higher)[0];
  const oldPool = back.length ? back : order, datedOld = oldPool.filter((x) => x.date);
  // Undated: the lowest post of the first crawl (of the latest backfill when there are backfilled items).
  const lowest = (a, b) => (a.run !== b.run ? ((back.length ? a.run > b.run : a.run < b.run) ? -1 : 1) : b.pos - a.pos || b.n - a.n);
  const oldest = datedOld.length ? datedOld.slice().sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : b.pos - a.pos || b.n - a.n))[0] : oldPool.slice().sort(lowest)[0];
  return { newest_seen: pick(newest.i), oldest_seen: pick(oldest.i) };
}

// What the crawling agent needs to know where to stop on a source: links already in the store, the newest and the
// oldest post of the source (oldest_seen: where a backfill starts collecting).
// Items stored before crawl_mode was recorded: a run date on which this brand only ran --backfill crawls
// (workspace/research-log.json) marks its items as backfilled.
function withCrawlMode(brand, items) {
  const runs = (readJson(path.join(workspace, 'research-log.json'), {}).runs || []).filter((r) => r.brand === brand);
  const back = new Set(runs.filter((r) => r.mode?.backfill).map((r) => r.date).filter((d) => !runs.some((r) => r.date === d && !r.mode?.backfill)));
  return items.map((i) => (i.crawl_mode || !back.has(i.run) ? i : { ...i, crawl_mode: 'backfill' }));
}
export function knownPosts(brand, sourceId) {
  const items = withCrawlMode(brand, readStore(brand).items.filter((i) => !sourceId || i.source_id === sourceId));
  const dates = items.map((i) => i.posted_date).filter(Boolean).sort();
  // Duplicates are checked across every source of the brand, so the ids/links to skip before downloading are brand-wide.
  const all = readStore(brand).items;
  return { source: sourceId || null, count: items.length, newest_posted_date: dates.at(-1) || '', oldest_posted_date: dates[0] || '', ...sourceBounds(items), post_urls: items.map((i) => i.post_url).filter(Boolean),
    brand_post_urls: all.flatMap((i) => [i.post_url, ...(i.alt_urls || [])]).filter(Boolean), brand_post_ids: [...new Set(all.flatMap((i) => i.post_ids || []))] };
}

// new = Available (can still be used, used before included); fresh = never used; used = used before (available); ready = fresh + reusable
// now (cooldown over: what the next idea batch can take); cooling = used within the cooldown; removed (= rejected) = not
// used anymore; uses = posts made from the library; remove_suggested = available items with at least
// ideas.suggest_remove_after uses (only a suggestion; off by default).
export function counts(items, opts) {
  const a = availability(items, opts), after = suggestRemoveAfter();
  return { total: items.length, new: a.fresh.length + a.reusable.length + a.cooling.length, fresh: a.fresh.length, used: a.reusable.length + a.cooling.length,
    removed: items.filter((i) => i.status === 'rejected').length, rejected: items.filter((i) => i.status === 'rejected').length,
    ready: a.fresh.length + a.reusable.length, cooling: a.cooling.length, uses: items.reduce((n, i) => n + usesOf(i).length, 0), cooldown_days: a.cooldown_days,
    ...(after ? { remove_suggested: items.filter((i) => i.status === 'new' && usesOf(i).length >= after).map((i) => i.id) } : {}) };
}
const inFilter = (i, status) => !status || i.status === status;
// Every item carries its platform (old items: from the post link) and found_by ("reference page" when not recorded).
export function listItems(brand, { status = '', source = '', platform = '' } = {}) {
  if (status && !LIST_FILTERS.includes(status)) throw new Error(`Trạng thái phải là ${LIST_FILTERS.join(', ')}.`);
  const all = readStore(brand).items.map((i) => ({ ...i, platform: platformOf(i), found_by: i.found_by || 'reference page' }));
  const sources = [...new Set(all.map((i) => i.source_id))].sort();
  const platforms = [...new Set(all.map((i) => i.platform).filter(Boolean))].sort();
  const items = all.filter((i) => inFilter(i, status) && (!source || i.source_id === source) && (!platform || i.platform === platform));
  return { brand, dir: storeDir(brand), counts: counts(all), sources, platforms, items };
}
export const findItem = (brand, id) => { const i = readStore(brand).items.find((x) => x.id === id); if (!i) throw new Error(`Kho ${brand} không có ${id}.`); return i; };

// "Remove" (rejected: not used anymore, with an optional reason) and "Restore" (back to Available). An item keeps its
// uses either way.
export function setItemStatus(brand, id, status, { note = '', by = 'user' } = {}) {
  if (status === 'removed') status = 'rejected';
  if (!['rejected', 'new'].includes(status)) throw new Error('Chỉ đổi được sang rejected (Remove) hoặc new (Restore).');
  return withStore(brand, (s) => {
    const it = s.items.find((x) => x.id === id);
    if (!it) throw new Error(`Kho ${brand} không có ${id}.`);
    if (status === 'rejected' && it.status === 'rejected') throw new Error(`${id} is already removed.`);
    if (status === 'new' && it.status !== 'rejected') throw new Error(`Only a removed item can be restored (${id} is "${it.status}").`);
    it.status = status;
    if (status === 'rejected') Object.assign(it, { note: String(note || '').trim(), rejected_by: String(by || 'user').trim() || 'user', rejected_at: stamp() });
    else { delete it.note; delete it.rejected_by; delete it.rejected_at; if (it.filter) it.filter = { ...it.filter, restored_at: stamp() }; } // a restored filtered post is not judged again
    return { ...it };
  });
}

// ----- batch filter after the crawl ("crawl everything fast, then filter") -----
// classify: the next batch of "new" items without a verdict (item.filter), compact for one agent pass; with the brand's
// rules: research.sources[].what_to_take and the project.md path (product scope). verdict: applies the agent's
// [{ id, fit, reason }]: fit:false -> status rejected, note "filter: <reason>", rejected_by "filter"; fit:true -> stays
// new with filter { fit: true }. Items already used/rejected or unknown are reported, the rest applied.
export const RULES_OF_THUMB = [
  'drop recruitment / job posts (tuyển dụng)',
  'drop contests, minigames, giveaways',
  'drop text-only posts and posts whose image is only text (no product)',
  'drop reshares without the product in the media',
  "drop products outside the brand's category (project.md product scope, the source's what_to_take)",
  "drop when the product is not one of product_fit.types, misses product_fit.must_have or matches product_fit.must_not (off-brand: reason starts with \"off-brand:\")",
  "keep: a real product photo of the brand's category, a usable scene / angle / caption structure",
];
const excerpt = (t, n = 220) => { const x = String(t || '').replace(/s+/g, ' ').trim(); return x.length > n ? x.slice(0, n - 1) + '…' : x; };
export function classifyBatch(brand, { limit = 40, source = '' } = {}) {
  const all = readStore(brand).items.filter((i) => i.status === 'new' && !i.filter && (!source || i.source_id === source));
  let rules = { project_md: '', sources: {}, product_fit: null };
  try { const b = loadBrand(brand, { allowDisabled: true }); rules = { project_md: path.join(b.dir, 'project', 'project.md'), product_fit: brandDiscovery(b.social).product_fit, sources: Object.fromEntries((b.social.research?.sources || []).map((x) => [x.id, { name: x.name || x.id, what_to_take: x.what_to_take || '', notes: x.notes || '' }])) }; } catch { /* brand not linked: rules from the agent's skill */ }
  const batch = all.slice(0, limit > 0 ? limit : all.length);
  return {
    brand, total_unjudged: all.length, batch_size: batch.length, remaining_after: all.length - batch.length,
    project_md: rules.project_md, sources: Object.fromEntries([...new Set(batch.map((i) => i.source_id))].map((id) => [id, rules.sources[id] || { name: id, what_to_take: '' }])),
    product_fit: rules.product_fit, rules_of_thumb: RULES_OF_THUMB,
    items: batch.map((i) => ({ id: i.id, source: i.source_id, platform: platformOf(i), found_by: i.found_by || 'reference page', ...(i.author ? { author: i.author } : {}), ...(i.product_fit ? { product_fit: i.product_fit } : {}), posted: i.posted_date || '', media: i.media_type || '', images: i.images.length, caption: i.caption_empty || !String(i.caption || '').trim() ? '(no caption)' : excerpt(i.caption), thumb: i.images[0] ? path.join(storeDir(brand), i.images[0]) : '' })),
    next: all.length ? 'Judge every item (open the thumbs), write [{ "id": "S0001", "fit": true|false, "reason": "..." }] to a file, then store.mjs verdict --brand <id> --file <file>; repeat classify until total_unjudged is 0.' : 'Nothing left to judge.',
  };
}
export function applyVerdicts(brand, list) {
  if (!Array.isArray(list)) throw new Error('verdicts phải là mảng [{ id, fit, reason }].');
  return withStore(brand, (s) => {
    const kept = [], filtered = [], skipped = [];
    for (const v of list) {
      const it = s.items.find((x) => x.id === v?.id);
      const reason = cleanText(String(v?.reason ?? '')).text.trim().slice(0, 300);
      if (!it) { skipped.push({ id: v?.id ?? null, reason: 'không có trong kho' }); continue; }
      if (typeof v.fit !== 'boolean') { skipped.push({ id: it.id, reason: 'fit phải là true hoặc false' }); continue; }
      if (it.status !== 'new') { skipped.push({ id: it.id, reason: `đang "${it.status}"` }); continue; }
      if (!v.fit && !reason) { skipped.push({ id: it.id, reason: 'fit:false cần reason' }); continue; }
      it.filter = { fit: v.fit, reason, at: stamp() };
      if (v.fit) kept.push(it.id);
      else { Object.assign(it, { status: 'rejected', note: `filter: ${reason}`, rejected_by: 'filter', rejected_at: stamp() }); filtered.push(it.id); }
    }
    return { kept, filtered, skipped };
  });
}

// One more use of an item by a draft (draft.mjs new, after draft.json is written): uses gets the draft's scene, product
// and sign text; the item stays available (status unchanged). A draft is counted once.
export function markUsed(brand, ids, by) {
  return withStore(brand, (s) => {
    for (const id of [].concat(ids)) {
      const it = s.items.find((x) => x.id === id);
      if (!it) throw new Error(`Kho ${brand} không có ${id}.`);
      it.used_by = [...new Set([...(it.used_by || []), by])];
      it.uses = usesOf(it);
      if (DRAFT_ID.test(by) && !it.uses.some((u) => u.draft === by)) it.uses.push(useFromDraft(brand, by));
      it.last_used = lastOf(it.uses);
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
// run first, duplicates dropped. Ideas of those runs that became drafts add a use to their reference (uses = drafts).
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
  if (cmd === 'migrate-uses') return out({ brands: (args.brand ? [String(args.brand)] : (fs.existsSync(path.join(workspace, 'store')) ? fs.readdirSync(path.join(workspace, 'store')).filter((d) => /^[a-z0-9][a-z0-9-]*$/.test(d) && fs.existsSync(itemsFile(d))) : [])).map(migrateUses) });
  if (cmd === 'migrate') return out({ brands: (args.brand ? [String(args.brand)] : brandsInWorkspace()).map(migrateRuns) });
  const brand = need(args, 'brand');
  if (cmd === 'list') {
    const r = listItems(brand, { status: args.status ? String(args.status) : '', source: args.source ? String(args.source) : '', platform: args.platform && args.platform !== true ? String(args.platform) : '' });
    const limit = Number(args.limit) || 0;
    return out({ ...r, items: (limit ? r.items.slice(-limit) : r.items).map(({ id, source_id, status, posted_date, post_url, main_product, images, uses, last_used, platform, found_by }) => ({ id, source_id, platform, found_by, status, posted_date, post_url, main_product, images: images.map((f) => path.join(storeDir(brand), f)), used: (uses || []).length, last_used: last_used || '', uses: previousUses({ uses }) })) });
  }
  if (cmd === 'show') { const it = findItem(brand, need(args, 'id')); return out({ item: { ...it, image_paths: it.images.map((f) => path.join(storeDir(brand), f)) } }); }
  if (cmd === 'reject' || cmd === 'remove') return out({ item: setItemStatus(brand, need(args, 'id'), 'rejected', { note: args.note === true ? '' : args.note, by: args.by === true ? '' : args.by }) });
  if (cmd === 'restore') return out({ item: setItemStatus(brand, need(args, 'id'), 'new') });
  if (cmd === 'classify') return out(classifyBatch(brand, { limit: args.limit === undefined ? 40 : Number(args.limit) || 0, source: args.source && args.source !== true ? String(args.source) : '' }));
  if (cmd === 'verdict') { const r = applyVerdicts(brand, readJson(path.resolve(need(args, 'file')))); return out({ ...r, left: classifyBatch(brand, { limit: 0 }).total_unjudged }); }
  if (cmd === 'known') { const k = knownPosts(brand, args.source ? String(args.source) : ''); return out(k); }
  throw new Error('Lệnh: list | show | remove (reject) | restore | classify | verdict | known | migrate | migrate-uses');
});
