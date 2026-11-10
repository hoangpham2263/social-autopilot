// Etsy adapter (status in scripts/platforms/index.mjs; written from knowledge of the site, NOT yet run on a live page).
// Search (/search?q=) lists listings; each card links to /listing/<id>/<slug> and holds an image
// (https://i.etsystatic.com/<shop>/r/il/<hash>/<n>/il_340x270.<n>_xxxx.jpg). Sponsored cards ("Ad by") are not skipped here:
// the product-fit look at the images drops them if off type.
import { pageWall, gridExtract, makePost, enc } from './common.mjs';

// ---- every selector and pattern of this adapter lives in this block ----
export const SELECTORS = {
  link: ['a[href*="/listing/"]'],
  url_pattern: '^https?://(www\\.)?etsy\\.com/([a-z]{2}(-[a-z]{2})?/)?listing/\\d{5,}',
  container: 'li, div[data-appears-component-name], div.v2-listing-card',
  img: ['img[src*="etsystatic.com"]', 'img'],
  img_skip: ['/iusa_', 'avatar', 'isla/', '_75x75'],
  caption: ['h3', 'h2', 'a[title]'],
  author: ['p.wt-text-caption', '[data-shop-name]', 'span.wt-text-caption'],
  wall: {
    url: ['/signin', '/captcha'],
    title: ['robot', 'access denied'],
    text: ["we need to make sure you.re not a robot", 'press (&|and) hold', 'sign in to continue'],
    login_form: ['form#join-neu-form', 'form[action*="/signin"]'],
    captcha: ['iframe[src*="captcha-delivery.com"]', 'iframe[src*="geo.captcha"]', '#captcha-container', 'iframe[src*="recaptcha"]'],
    dialog: [],
  },
};

// ---- pure helpers (tests/collect.test.mjs) ----
export const postId = (url) => (String(url || '').match(/\/listing\/(\d{5,})/) || [])[1] || '';
export const canonicalUrl = (url) => { const id = postId(url); return id ? `https://www.etsy.com/listing/${id}` : String(url || ''); };
// il_340x270.123_ab.jpg -> il_794xN.123_ab.jpg
export const upgradeImage = (u) => String(u || '').replace(/il_\d+x(?:\d+|N)\./, 'il_794xN.');
export const searchUrl = (query) => `https://www.etsy.com/search?q=${enc(String(query).replace(/^#/, '').trim())}`;
export const toPost = (t, ctx = {}) => makePost({ id: postId(t.url), url: canonicalUrl(t.url), image_urls: t.image_urls.map(upgradeImage), caption: t.caption, author: t.author, found_by: ctx.found_by || '' });

// ---- adapter contract ----
export const isLoginWall = (page) => pageWall(page, SELECTORS);
export const extract = (page, ctx) => gridExtract(page, SELECTORS, toPost, ctx);
