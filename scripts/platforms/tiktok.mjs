// TikTok adapter (status in scripts/platforms/index.mjs; written from knowledge of the site, NOT yet run on a live page).
// Tag pages (/tag/<tag>) and search (/search?q=) list video cards; each card links to /@<user>/video/<id> (or /photo/<id>)
// and holds a cover image. No video is downloaded, only the cover.
import { pageWall, gridExtract, makePost, enc, isHashtag, tagOf } from './common.mjs';

// ---- every selector and pattern of this adapter lives in this block ----
export const SELECTORS = {
  link: ['a[href*="/video/"]', 'a[href*="/photo/"]'],
  url_pattern: '^https?://(www\\.)?tiktok\\.com/@[\\w.-]+/(video|photo)/\\d{8,}',
  container: '[data-e2e="challenge-item"], [data-e2e="search_top-item"], [data-e2e="search-card-item"], div[class*="DivItemContainer"]',
  img: ['img'],
  img_skip: ['avatar', 'tiktokcdn\\.com/obj/tos-.*100x100'],
  caption: ['[data-e2e="challenge-item-desc"]', '[data-e2e="search-card-desc"]', 'a[title]'],
  author: [],
  wall: {
    url: ['/login', '/captcha'],
    title: [],
    text: ['verify to continue', 'log in to tiktok', 'drag the slider', 'something went wrong', 'maximum number of attempts'],
    login_form: ['form[data-e2e="login-form"]'],
    captcha: ['#captcha-verify-image', '.captcha_verify_container', '#tiktok-verify-ele', '[class*="captcha-verify"]'],
    dialog: ['[data-e2e="login-modal"]', 'div[id="login-modal"]'],
  },
};

// ---- pure helpers (tests/collect.test.mjs) ----
export const postId = (url) => (String(url || '').match(/\/(?:video|photo)\/(\d{8,})/) || [])[1] || '';
export const authorOf = (url) => { const m = String(url || '').match(/tiktok\.com\/(@[\w.-]+)\//i); return m ? m[1] : ''; };
export const canonicalUrl = (url) => { const id = postId(url), a = authorOf(url); return id && a ? `https://www.tiktok.com/${a}/${/\/photo\//.test(url) ? 'photo' : 'video'}/${id}` : String(url || ''); };
export const searchUrl = (query) => (isHashtag(query) ? `https://www.tiktok.com/tag/${enc(tagOf(query))}` : `https://www.tiktok.com/search?q=${enc(String(query).trim())}`);
export const toPost = (t, ctx = {}) => makePost({ id: postId(t.url), url: canonicalUrl(t.url), image_urls: t.image_urls, caption: t.caption, author: authorOf(t.url) || t.author, found_by: ctx.found_by || '' });

// ---- adapter contract ----
export const isLoginWall = (page) => pageWall(page, SELECTORS);
export const extract = (page, ctx) => gridExtract(page, SELECTORS, toPost, ctx);
