// Facebook adapter (status in scripts/platforms/index.mjs). Reuses scripts/fb-extract.mjs (the post selectors, the pure
// feed reader, tested on saved fixtures); only the page-level glue is new, and
// search/hashtag pages (not just a page's own feed) have NOT been run on a live page.
// pageScript (the extract script) only reads: no click, no hover, no scroll (the agent scrolls with Playwright MCP).
import { SELECTORS as FB, extractFeed, extractGrid, parseFbDate, tabUrl } from '../fb-extract.mjs';
import { wallSignals, makePost, enc, isHashtag, tagOf, checksumOf, cutWords, packB64, COMPACT } from './common.mjs';

// ---- every selector and pattern of this adapter lives in this block (the post selectors are FB, in fb-extract.mjs) ----
export const SELECTORS = {
  feed: FB,
  wall: {
    url: ['/login(\\.php|/|\\?|$)', '/checkpoint\\b', '/recover/'],
    title: ['security check'],
    text: ['temporarily blocked', 't.m th.i b. ch.n', 'confirm (it.s|that it.s) you', 'we suspect automated behavior', 'you must log in to continue', 'log into facebook'],
    login_form: FB.login_form,
    captcha: FB.captcha,
    dialog: ['div[role="dialog"] form[action*="/login"]'],
  },
};

// ---- pure helpers (tests/collect.test.mjs) ----
// Every id a Facebook link carries (a post shows under the post id and under each photo's fbid).
export function postIds(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { return []; }
  const ids = new Set();
  for (const k of ['fbid', 'story_fbid', 'v']) { const v = u.searchParams.get(k); if (v && /^(\d{5,}|pfbid\w+)$/.test(v)) ids.add(v); }
  const m = u.pathname.match(/\/(?:posts|photos|videos|reel|permalink)\/(?:[^/]+\/)*?((?:\d{5,})|(?:pfbid\w+))\/?$/i) || u.pathname.match(/\/((?:\d{8,})|(?:pfbid\w{10,}))\/?$/i);
  if (m) ids.add(m[1]);
  return [...ids];
}
export const postId = (url) => postIds(url)[0] || '';
// A post's links -> { id, aliases }. PURE and SELF-CONTAINED except postIds (both are embedded in the extract script).
// id = the real post permalink (/posts/pfbid.., story_fbid, /permalink/, reel / video id) when the DOM has one, else the
// photo fbid; every other id (each photo's fbid) is an alias, so the known-post check matches either form.
export function fbPostKeys(postUrl, altUrls) {
  const urls = [postUrl].concat(altUrls || []).filter(Boolean).map(String);
  const strong = (u) => /\/(posts|permalink|videos|reel)\/|story_fbid=|\/watch\/?\?v=/.test(u);
  // set=pcb.<id> in a photo link is the album / post id: the post key when no real permalink is there (set=a.<id> is the page's album: ignored).
  const pcb = (u) => (String(u).match(/[?&]set=pcb\.(\d{5,})/) || [])[1];
  const ids = [];
  const add = (x) => { if (x && !ids.includes(x)) ids.push(x); };
  for (const u of urls.filter(strong)) for (const x of postIds(u)) add(x);
  for (const u of urls) add(pcb(u));
  for (const u of urls.filter((u) => !strong(u))) for (const x of postIds(u)) add(x);
  return { id: ids[0] || '', aliases: ids.slice(1) };
}
export const searchUrl = (query) => (isHashtag(query) ? `https://www.facebook.com/hashtag/${enc(tagOf(query))}` : `https://www.facebook.com/search/posts/?q=${enc(String(query).trim())}`);
// One post as fb-extract's extractFeed reads it -> the adapter contract.
// Also takes a page-script tile ({ url, image_urls, caption, author }, collect.mjs from-page).
export function toPost(p, ctx = {}) {
  const url = p.post_url || p.url || '';
  const images = p.images ? p.images.map((x) => x.src) : p.image_urls || [];
  const alt = [].concat(p.alt_urls || []);
  const post = makePost({ id: p.id || fbPostKeys(url, alt).id, url, image_urls: images.filter(Boolean), caption: p.caption || '', author: p.author || '', found_by: ctx.found_by || '' });
  const aliases = [].concat(p.alt || fbPostKeys(url, alt).aliases);
  // Every alias (a photo fbid) also becomes a link, so the store's known-post check matches the post under either id.
  for (const x of aliases) if (!alt.some((u) => postIds(u).includes(x)) && /^\d+$/.test(x)) alt.push(`https://www.facebook.com/photo/?fbid=${x}`);
  return post && { ...post, alt_urls: alt, aliases, posted_date: parseFbDate(p.date_text, new Date(), p.utime), media_type: p.media_type || '' };
}


// ---- reason codes (used by the extract script) ----
// Why a page gave nothing -> a reason code ('' = fine). PURE and SELF-CONTAINED (embedded in the page script, tested on fixtures).
// sig: wallSignals() of the page; n: posts/tiles read so far. Codes: checkpoint, login_wall, captcha, blocked, unavailable, no_posts.
export function fbReason(sig = {}, n = 0) {
  const url = String(sig.url || ''), hay = `${sig.title || ''} ${sig.text || ''}`;
  if (/\/checkpoint\b/i.test(url) || /security check|kiểm tra bảo mật|confirm (it.s|that it.s) you|xác nhận (danh tính|đó là bạn)/i.test(hay)) return 'checkpoint';
  if (/\/login(\.php|\/|\?|$)|\/recover\//i.test(url) || sig.login_form || sig.dialog || /you must log in|log in to continue|log into facebook|bạn phải đăng nhập|đăng nhập để tiếp tục/i.test(hay)) return 'login_wall';
  if (sig.captcha) return 'captcha';
  if (/temporarily blocked|tạm thời bị chặn|we suspect automated behavior/i.test(hay)) return 'blocked';
  if (/this content isn.t available|this page isn.t available|nội dung này hiện không (hiển thị|khả dụng)|trang này không (hiển thị|khả dụng)|link you followed may be broken/i.test(hay)) return 'unavailable';
  return n ? '' : 'no_posts';
}
export const BLOCK_REASONS = ['checkpoint', 'login_wall', 'captcha', 'blocked'];
// "Permanently closed" is information, not an error: the page still shows its old posts.
export const isClosedPage = (text) => /permanently closed|đã đóng cửa vĩnh viễn|ngừng hoạt động vĩnh viễn/i.test(String(text || ''));

// ---- extract script (Playwright MCP browser_run_code_unsafe): reads the page as it is now ----
// The agent opens the page (timeline, /photos_by or /reels tab, search) and scrolls with Playwright MCP; this script only
// READS the posts on the page now and returns at once: no navigation, no scroll, no pause, no click, no hover, no DOM marks.
// Timeline/search -> extractFeed (post permalink id, photo fbids as aliases, caption of the post container, date text);
// photos/reels tab -> extractGrid. opts: { found_by, max, seen[] (ids AND aliases already returned) }.
export function pageScript(opts) {
  const o = { platform: 'facebook', max: 0, seen: [], compact: COMPACT, ...opts, sel: { ...FB, done_attr: '' },
    wall: { login_form: SELECTORS.wall.login_form, captcha: SELECTORS.wall.captcha, dialog: SELECTORS.wall.dialog }, blocks: BLOCK_REASONS };
  return `async (page) => {
  const packB64 = ${packB64};
  const o = ${JSON.stringify(o)};
  const r = await page.evaluate((o) => {
    const cutWords = ${cutWords};
    const checksumOf = ${checksumOf}; // inside evaluate: the browser cannot see the outer script scope
    const extractFeed = ${extractFeed};
    const extractGrid = ${extractGrid};
    const wallSignals = ${wallSignals};
    const fbReason = ${fbReason};
    const postIds = ${postIds};
    const fbPostKeys = ${fbPostKeys};
    const isClosedPage = ${isClosedPage};
    const sig = wallSignals(document, o.wall);
    const block = fbReason(sig, 1);
    const grid = /\\/(photos|photos_by|reels|videos)\\/?$/.test(location.pathname);
    const seen = new Set(o.seen || []);
    const all = [];
    if (!o.blocks.includes(block)) {
      if (grid) for (const t of extractGrid(document, o.sel).tiles) { const id = postIds(t.url)[0] || ''; if (id) all.push({ id, alt: [], url: t.url, image_urls: t.thumb ? [t.thumb] : [], caption: '', date_text: '', utime: 0 }); }
      else for (const p of extractFeed(document, o.sel).posts) { const k = fbPostKeys(p.post_url, p.alt_urls); if (k.id) all.push({ id: k.id, alt: k.aliases, alt_urls: p.alt_urls, url: p.post_url, image_urls: p.images.map((x) => x.src), caption: p.caption, date_text: p.date_text, utime: p.utime }); }
    }
    const byId = new Map(); for (const t of all) if (!byId.has(t.id)) byId.set(t.id, t);
    let list = [...byId.values()].filter((t) => !seen.has(t.id) && !t.alt.some((a) => seen.has(a)));
    if (o.max) list = list.slice(0, o.max);
    const h1 = document.querySelector('[role="main"] h1') || document.querySelector('h1');
    const author = (h1 && h1.textContent.trim()) || (location.pathname.split('/').filter(Boolean)[0] || '');
    const reason = o.blocks.includes(block) ? block : fbReason(sig, byId.size);
    const cut = (x, n) => String(x || '').replace(/\\s+/g, ' ').trim().slice(0, n);
    const C = o.compact;
    return { platform: 'facebook', url: location.href, loginWall: o.blocks.includes(reason), reason, ...(isClosedPage(sig.text) ? { closed: true } : {}), view: grid ? 'grid' : 'feed',
      total: list.length, total_on_page: byId.size, checksum: checksumOf(list.map((t) => t.id)),
      tiles: list.map((t) => ({ id: t.id, ...(t.alt.length ? { alt: t.alt } : {}), url: t.url, ...(t.alt_urls && t.alt_urls.length ? { alt_urls: t.alt_urls.slice(0, 4) } : {}), image_urls: t.image_urls.slice(0, C.images), caption: cutWords(t.caption, C.caption), author: cut(author, C.author), date_text: cut(t.date_text, 40), ...(t.utime ? { utime: t.utime } : {}) })) };
  }, o);
  const p = packB64(r);
  return { platform: 'facebook', total: r.total, total_on_page: r.total_on_page, reason: r.reason, ...(r.closed ? { closed: true } : {}), tag: p.tag, b64: p.line };
}`;
}
