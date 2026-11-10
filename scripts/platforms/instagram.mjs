// Instagram adapter (status in scripts/platforms/index.mjs; written from knowledge of the site, NOT yet run on a live page).
// Hashtag pages (/explore/tags/<tag>/) and keyword search (/explore/search/keyword/?q=) show a grid of square tiles;
// each tile is a link to /p/<code>/ or /reel/<code>/ holding one thumbnail whose alt text carries a short description.
import { pageWall, gridExtract, stripTracking, makePost, enc, isHashtag, tagOf } from './common.mjs';

// ---- every selector and pattern of this adapter lives in this block ----
export const SELECTORS = {
  link: ['a[href*="/p/"]', 'a[href*="/reel/"]'],
  url_pattern: '^https?://(www\\.)?instagram\\.com/([\\w.]+/)?(p|reel|reels|tv)/[\\w-]{5,}',
  container: '',
  img: ['img'],
  img_skip: ['/rsrc\\.php/', 's150x150', 'profile_pic'],
  caption: [],
  author: [],
  wall: {
    url: ['/accounts/login', '/challenge/', '/accounts/suspended'],
    title: ['^\\s*login\\b'],
    text: ['log in to continue', 'sign up to see photos', 'try again later', 'please wait a few minutes', 'we suspect automated behavior', 'confirm it.s you'],
    login_form: ['form#loginForm', 'input[name="username"][type="text"]'],
    captcha: ['iframe[src*="captcha"]', 'iframe[src*="recaptcha"]'],
    dialog: ['div[role="dialog"] input[name="username"]'],
  },
};

// ---- pure helpers (tests/collect.test.mjs) ----
const ID_RE = /instagram\.com\/(?:[\w.]+\/)?(?:p|reels?|tv)\/([\w-]{5,})/i;
// /p/<code>/ and /reel/<code>/ with the same code are one post.
export const postId = (url) => (String(url || '').match(ID_RE) || [])[1] || '';
export const canonicalUrl = (url) => { const id = postId(url); return id ? `https://www.instagram.com/${/\/(reels?|tv)\//i.test(url) ? 'reel' : 'p'}/${id}/` : stripTracking(url); };
export const authorOf = (url) => { const m = String(url || '').match(/instagram\.com\/([\w.]+)\/(?:p|reels?|tv)\//i); return m && !['explore', 'p', 'reel', 'reels'].includes(m[1]) ? `@${m[1]}` : ''; };
export const searchUrl = (query) => (isHashtag(query) ? `https://www.instagram.com/explore/tags/${enc(tagOf(query))}/` : `https://www.instagram.com/explore/search/keyword/?q=${enc(String(query).trim())}`);
export const toPost = (t, ctx = {}) => makePost({ id: postId(t.url), url: canonicalUrl(t.url), image_urls: t.image_urls, caption: t.caption, author: t.author || authorOf(t.url), found_by: ctx.found_by || '' });

// ---- adapter contract ----
export const isLoginWall = (page) => pageWall(page, SELECTORS);
export const extract = (page, ctx) => gridExtract(page, SELECTORS, toPost, ctx);
