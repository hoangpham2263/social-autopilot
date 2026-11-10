// Facebook adapter (status in scripts/platforms/index.mjs). Reuses scripts/fb-extract.mjs (the post selectors, the pure
// feed reader, tested on saved fixtures); only the page-level glue is new, and
// search/hashtag pages (not just a page's own feed) have NOT been run on a live page.
// The one click is the existing "See more" inside a post's own text (browserStep, expand); nothing is liked, followed, shared.
// pageScript (in-page mode) never clicks: it scrolls, reads, and dispatches mouseover on timestamps.
import { SELECTORS as FB, extractFeed, extractGrid, browserStep, parseFbDate, tabUrl } from '../fb-extract.mjs';
import { pageWall, wallSignals, makePost, enc, isHashtag, tagOf, checksumOf, packB64, COMPACT } from './common.mjs';

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
export const searchUrl = (query) => (isHashtag(query) ? `https://www.facebook.com/hashtag/${enc(tagOf(query))}` : `https://www.facebook.com/search/posts/?q=${enc(String(query).trim())}`);
// One post as fb-extract's extractFeed reads it -> the adapter contract.
// Also takes a page-script tile ({ url, image_urls, caption, author }, collect.mjs from-page).
export function toPost(p, ctx = {}) {
  const url = p.post_url || p.url || '';
  const images = p.images ? p.images.map((x) => x.src) : p.image_urls || [];
  const post = makePost({ id: postId(url) || postIds((p.alt_urls || [])[0])[0] || '', url, image_urls: images.filter(Boolean), caption: p.caption || '', author: p.author || '', found_by: ctx.found_by || '' });
  return post && { ...post, alt_urls: p.alt_urls || [], posted_date: parseFbDate(p.date_text, new Date(), p.utime), media_type: p.media_type || '' };
}

// ---- adapter contract ----
export const isLoginWall = (page) => pageWall(page, SELECTORS);
export async function extract(page, ctx) {
  const opts = { expand: true, settle_ms: 700, scroll: 0 }; // the collector scrolls
  const d = await page.evaluate(`(${browserStep})(${extractFeed}, ${JSON.stringify(FB)}, ${JSON.stringify(opts)})`);
  return (d.posts || []).map((p) => toPost(p, ctx)).filter(Boolean);
}

// ---- in-page mode (Playwright MCP browser_run_code_unsafe) ----
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

// A page source -> its timeline, then /photos_by and /reels grids when the timeline gave fewer than `min_feed` posts (as fb-extract did).
// Read only: scroll, read the DOM, dispatch mouseover on timestamps so their permalink appears. No click, no typing.
// opts: { url, found_by, max, steps, delay:[lo,hi], deadline, chunk, min_feed }
export function pageScript(opts) {
  const o = { platform: 'facebook', steps: 12, max: 8, delay: [5, 15], deadline: 120, compact: COMPACT, b64: true, min_feed: 4, ...opts, sel: FB,
    wall: { login_form: SELECTORS.wall.login_form, captcha: SELECTORS.wall.captcha, dialog: SELECTORS.wall.dialog },
    tabs: { photos: tabUrl(opts.url, 'photos'), reels: tabUrl(opts.url, 'reels') }, blocks: BLOCK_REASONS };
  return `async (page) => {
  const packB64 = ${packB64};
  const checksumOf = ${checksumOf};
  const o = ${JSON.stringify(o)};
  const t0 = Date.now();
  const isBlock = (r) => o.blocks.includes(r);
  const run = async (url, mode, have) => {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    return page.evaluate(async ([o, mode, have, t0]) => {
      const extractFeed = ${extractFeed};
      const extractGrid = ${extractGrid};
      const wallSignals = ${wallSignals};
      const fbReason = ${fbReason};
      const postIds = ${postIds};
      const isClosedPage = ${isClosedPage};
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const pause = () => sleep(1000 * (o.delay[0] + Math.random() * (o.delay[1] - o.delay[0])));
      const over = () => Date.now() - t0 > o.deadline * 1000;
      const seen = new Set(have), out = [];
      let steps = 0, idle = 0, reason = '', partial = false;
      await pause();
      for (; steps < o.steps; steps++) {
        if (over()) { partial = true; break; }
        const r = fbReason(wallSignals(document, o.wall), 1);
        if (r) { reason = r; break; }
        let fresh = 0;
        if (mode === 'feed') {
          for (const a of document.querySelectorAll(o.sel.hover.join(','))) { if (a.closest('[' + o.sel.done_attr + ']')) continue; for (const t of ['mouseover', 'mouseenter', 'focus']) a.dispatchEvent(new Event(t, { bubbles: true })); }
          await sleep(700);
          for (const p of extractFeed(document, o.sel).posts) {
            const id = postIds(p.post_url)[0] || postIds(p.alt_urls[0])[0] || '';
            if (!id || seen.has(id)) continue;
            seen.add(id); fresh++;
            out.push({ id, url: p.post_url, image_urls: p.images.map((x) => x.src), caption: p.caption, date_text: /\\d/.test(p.date_text) ? p.date_text : '', utime: p.utime });
          }
        } else {
          for (const t of extractGrid(document, o.sel).tiles) {
            const id = postIds(t.url)[0] || '';
            if (!id || seen.has(id)) continue;
            seen.add(id); fresh++;
            out.push({ id, url: t.url, image_urls: t.thumb ? [t.thumb] : [], caption: '', date_text: '', utime: 0, via: mode });
          }
        }
        if (have.length + out.length >= o.max) break;
        idle = fresh ? 0 : idle + 1;
        if (idle >= 3) break;
        window.scrollBy(0, Math.round(innerHeight * 0.9));
        await pause();
      }
      const sig = wallSignals(document, o.wall);
      const h1 = document.querySelector('[role="main"] h1') || document.querySelector('h1');
      return { out, steps, partial, reason: reason || fbReason(sig, out.length + have.length), closed: isClosedPage(sig.text), author: (h1 && h1.textContent.trim()) || (location.pathname.split('/').filter(Boolean)[0] || ''), url: location.href, title: document.title };
    }, [o, mode, have, t0]);
  };
  let list = [], steps = 0, partial = false, reason = '', closed = false, author = '', last = null;
  const via = [];
  const phases = [[o.url, 'feed'], [o.tabs.photos, 'photos'], [o.tabs.reels, 'reels']];
  for (let i = 0; i < phases.length; i++) {
    if (i > 0 && (list.length >= o.min_feed || list.length >= o.max || partial || isBlock(reason))) break;
    last = await run(phases[i][0], phases[i][1], list.map((t) => t.id));
    steps += last.steps; partial = partial || last.partial; closed = closed || last.closed; author = author || last.author; reason = last.reason;
    if (last.out.length) via.push(phases[i][1]);
    list = list.concat(last.out.map((t) => ({ ...t, author: last.author })));
    if (isBlock(reason)) break;
  }
  list = list.slice(0, o.max);
  if (list.length && !isBlock(reason)) reason = '';
  const cut = (x, n) => String(x || '').replace(/\\s+/g, ' ').trim().slice(0, n);
  const C = o.compact, total = list.length, checksum = checksumOf(list.map((t) => t.id || t.url));
  let part = list, chunk = null;
  if (o.chunk !== undefined && o.chunk !== null) { part = list.slice(o.chunk * C.chunk_size, (o.chunk + 1) * C.chunk_size); chunk = { i: o.chunk, size: C.chunk_size, of: Math.max(1, Math.ceil(total / C.chunk_size)) }; }
  const loginWall = isBlock(reason);
  const r = { platform: 'facebook', url: o.url, loginWall, ...(loginWall ? { signals: { url: last && last.url, title: last && last.title } } : {}), reason, ...(closed ? { closed: true } : {}), via, steps, seconds: Math.round((Date.now() - t0) / 1000),
    note: partial ? 'deadline ' + o.deadline + ' s reached' : reason, ...(partial ? { partial: true } : {}), total, checksum, ...(chunk ? { chunk } : {}),
    tiles: part.map((t) => ({ id: t.id, url: t.url, image_urls: t.image_urls.slice(0, C.images), caption: cut(t.caption, C.caption), author: cut(t.author, C.author), date_text: cut(t.date_text, 40), ...(t.utime ? { utime: t.utime } : {}), ...(t.via ? { via: t.via } : {}) })) };
  if (o.b64) { const p = packB64(r); return { platform: 'facebook', total: r.total, reason: r.reason, loginWall, partial: !!r.partial, seconds: r.seconds, tag: p.tag, b64: p.line }; }
  return r;
}`;
}
