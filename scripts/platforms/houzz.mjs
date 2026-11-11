// Houzz adapter (status in scripts/platforms/index.mjs; written from knowledge of the site, NOT yet run on a live page).
// Photo search (/photos/query/<kw-with-dashes>) is a grid of room photos; each card links to a photo page
// (/photos/<title>-phvw-vp~<id>) and holds a thumbnail on st.hzcdn.com. Only meaningful for furniture/home brands.
import { makePost, buildPageScript, enc } from './common.mjs';

// ---- every selector and pattern of this adapter lives in this block ----
export const SELECTORS = {
  link: ['a[href*="/photos/"]'],
  url_pattern: '^https?://(www\\.)?houzz\\.com/photos/[^?#]*?(phvw-vp)?~\\d{5,}',
  container: 'div[class*="space-card"], div[class*="hz-photo-card"], div[class*="PhotoCard"], [data-testid*="photo-card"], li',
  img: ['img[src*="hzcdn.com/fimgs/"]'], // /fimgs/ = the photo; /simgs/ = the professional's avatar
  img_skip: ['/avatar', 'profile', 'logo', '/simgs/'],
  caption: ['[class*="hz-photo-card__title"]', 'h3', 'a[title]'],
  author: ['[class*="hz-photo-card__author"]', 'a[href*="/professionals/"]'],
  wall: {
    url: ['/captcha', '/signin', '/login'],
    title: ['access denied', 'just a moment'],
    text: ['press (&|and) hold', 'verify you are human', 'access to this page has been denied'],
    login_form: ['form[action*="/login"]'],
    captcha: ['#px-captcha', 'iframe[src*="captcha"]'],
    dialog: [],
  },
};

// ---- pure helpers (tests/collect.test.mjs) ----
export const postId = (url) => (String(url || '').match(/~(\d{5,})/) || [])[1] || '';
export const canonicalUrl = (url) => { try { const u = new URL(url); u.search = ''; u.hash = ''; return u.href; } catch { return String(url || ''); } };
// ...-w360-h360-b0-p0... -> ...-w1000-h1000-b0-p0...
export const upgradeImage = (u) => String(u || '').replace(/-w\d+-h\d+(-b\d)/, '-w1000-h1000$1');
export const searchUrl = (query) => `https://www.houzz.com/photos/query/${enc(String(query).replace(/^#/, '').trim().toLowerCase().replace(/\s+/g, '-'))}`;
export const toPost = (t, ctx = {}) => makePost({ id: postId(t.url), url: canonicalUrl(t.url), image_urls: t.image_urls.map(upgradeImage), caption: t.caption, author: t.author, found_by: ctx.found_by || '' });


// extract script (Playwright MCP browser_run_code_unsafe): reads the page as it is now
export const pageScript = (o) => buildPageScript(SELECTORS, { platform: 'houzz', max: 0, ...o, id_re: /~(\d{5,})/.source });
