// Pinterest adapter (status in scripts/platforms/index.mjs; written from knowledge of the site, NOT yet run on a live page).
// Search (/search/pins/?q=) is a masonry grid; each pin is a link to /pin/<id>/ with an <img> (236x / 474x / 736x in the URL).
import { makePost, enc, isHashtag, buildPageScript } from './common.mjs';

// ---- every selector and pattern of this adapter lives in this block ----
export const SELECTORS = {
  link: ['a[href*="/pin/"]'],
  url_pattern: '^https?://([\\w-]+\\.)?pinterest\\.[a-z.]+/pin/(?:[\\w-]*?--)?\\d{6,}',
  container: '[data-test-id="pin"], [data-grid-item], div[role="listitem"]',
  img: ['img[src*="pinimg.com"]', 'img'],
  img_skip: ['/75x75', '/30x30', '/60x60', 'avatars', 'default_'],
  caption: ['[data-test-id="pin-title"]', 'h3'],
  author: ['[data-test-id="pinrep-footer"] a', '[data-test-id="pin-author"]'],
  caption_strip: /^\s*This (?:may contain|contains)(?: an image of)?:\s*/i.source, // author: not in the search grid DOM (verified live 2026-11-10); only on the pin page
  wall: {
    url: ['/login/?', '/login$', '/signup'],
    title: [],
    text: ['log in to see more', 'sign up to see more', 'continue to see more'],
    login_form: ['form[data-test-id="login-form"]', 'input[name="id"][type="email"]'],
    captcha: ['iframe[src*="captcha"]'],
    dialog: ['[data-test-id="giftWrap"]', 'div[data-test-id="login-modal"]'],
  },
};

// ---- pure helpers (tests/collect.test.mjs) ----
export const postId = (url) => (String(url || '').match(/\/pin\/(?:[\w-]*?--)?(\d{6,})/) || [])[1] || '';
export const canonicalUrl = (url) => { const id = postId(url); return id ? `https://www.pinterest.com/pin/${id}/` : String(url || ''); };
// Thumbnail -> the 736x version (originals/ is not always there).
export const upgradeImage = (u) => String(u || '').replace(/\/(?:\d{2,3}x(?:\d+)?|236x|474x|564x)\//, '/736x/');
export const searchUrl = (query) => `https://www.pinterest.com/search/pins/?q=${enc(isHashtag(query) ? `#${String(query).trim().replace(/^#+/, '')}` : String(query).trim())}`;
export const stripCaption = (c) => String(c || '').replace(new RegExp(SELECTORS.caption_strip, 'i'), '').trim();
export const toPost = (t, ctx = {}) => makePost({ id: postId(t.url), url: canonicalUrl(t.url), image_urls: t.image_urls.map(upgradeImage), caption: stripCaption(t.caption), author: t.author, found_by: ctx.found_by || '' });


// extract script (Playwright MCP browser_run_code_unsafe): reads the page as it is now
export const pageScript = (o) => buildPageScript(SELECTORS, { platform: 'pinterest', max: 0, ...o, id_re: /\/pin\/(?:[\w-]*?--)?(\d{6,})/.source });
