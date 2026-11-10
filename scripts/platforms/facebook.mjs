// Facebook adapter (status in scripts/platforms/index.mjs). Reuses scripts/fb-extract.mjs (the post selectors, the pure
// feed reader, tested on saved fixtures); only the page-level glue is new, and
// search/hashtag pages (not just a page's own feed) have NOT been run on a live page.
// The one click is the existing "See more" inside a post's own text (browserStep, expand); nothing is liked, followed, shared.
import { SELECTORS as FB, extractFeed, browserStep, parseFbDate } from '../fb-extract.mjs';
import { pageWall, makePost, enc, isHashtag, tagOf } from './common.mjs';

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
export function toPost(p, ctx = {}) {
  const url = p.post_url || '';
  const post = makePost({ id: postId(url) || postIds((p.alt_urls || [])[0])[0] || '', url, image_urls: (p.images || []).map((x) => x.src).filter(Boolean), caption: p.caption || '', author: p.author || '', found_by: ctx.found_by || '' });
  return post && { ...post, alt_urls: p.alt_urls || [], posted_date: parseFbDate(p.date_text, new Date(), p.utime), media_type: p.media_type || '' };
}

// ---- adapter contract ----
export const isLoginWall = (page) => pageWall(page, SELECTORS);
export async function extract(page, ctx) {
  const opts = { expand: true, settle_ms: 700, scroll: 0 }; // the collector scrolls
  const d = await page.evaluate(`(${browserStep})(${extractFeed}, ${JSON.stringify(FB)}, ${JSON.stringify(opts)})`);
  return (d.posts || []).map((p) => toPost(p, ctx)).filter(Boolean);
}
