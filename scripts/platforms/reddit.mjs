// Reddit adapter (status in scripts/platforms/index.mjs; written from knowledge of the site, NOT yet run on a live page).
// Search (/search/?q=&type=posts) lists posts; each has a link to /r/<sub>/comments/<id>/<slug>/ and, for image posts, a
// thumbnail on preview.redd.it / i.redd.it. Text-only posts have no image and are left out by the collector.
import { pageWall, gridExtract, makePost, buildPageScript, enc } from './common.mjs';

// ---- every selector and pattern of this adapter lives in this block ----
export const SELECTORS = {
  link: ['a[href*="/comments/"]'],
  url_pattern: '^https?://(www\\.|old\\.)?reddit\\.com/r/[\\w]+/comments/[a-z0-9]{4,}',
  container: 'search-telemetry-tracker, [data-testid="sdui-post-unit"], shreddit-post, article, div[data-testid="post-container"]',
  img: ['img[src*="redd.it"]', 'img[src*="redditmedia.com"]'],
  img_skip: ['styles\\.redditmedia\\.com', 'communityIcon', 'avatar', 'emoji'],
  caption: ['[slot="title"]', 'a[id^="post-title"]', 'h3'],
  author: ['a[href*="/user/"]', 'a[href^="/r/"]'],
  wall: {
    url: ['/login', '/account/login'],
    title: ['blocked', 'whoa there'],
    text: ['blocked by network security', 'pardon the interruption', 'log in to continue', 'you.ve been blocked'],
    login_form: ['form[action*="/login"]', 'input[name="username"][autocomplete="username"]'],
    captcha: ['iframe[src*="recaptcha"]', 'iframe[src*="captcha"]'],
    dialog: [],
  },
};

// ---- pure helpers (tests/collect.test.mjs) ----
const ID_RE = /reddit\.com\/r\/(\w+)\/comments\/([a-z0-9]{4,})/i;
export const postId = (url) => ((String(url || '').match(ID_RE) || [])[2] || '').toLowerCase();
export const subredditOf = (url) => { const m = String(url || '').match(ID_RE); return m ? `r/${m[1]}` : ''; };
export const canonicalUrl = (url) => { const m = String(url || '').match(ID_RE); return m ? `https://www.reddit.com/r/${m[1]}/comments/${m[2].toLowerCase()}/` : String(url || ''); };
// preview.redd.it/<name>.jpg?width=..&s=.. -> i.redd.it/<name>.jpg (the original); other hosts unchanged.
export const upgradeImage = (u) => { const m = String(u || '').match(/^https?:\/\/preview\.redd\.it\/([\w-]+\.(?:jpe?g|png|webp))/i); return m ? `https://i.redd.it/${m[1]}` : String(u || ''); };
export const searchUrl = (query) => `https://www.reddit.com/search/?q=${enc(String(query).replace(/^#/, '').trim())}&type=posts`;
export const toPost = (t, ctx = {}) => makePost({ id: postId(t.url), url: canonicalUrl(t.url), image_urls: t.image_urls.map(upgradeImage), caption: t.caption, author: subredditOf(t.url) || t.author, found_by: ctx.found_by || '' });

// ---- adapter contract ----
export const isLoginWall = (page) => pageWall(page, SELECTORS);
export const extract = (page, ctx) => gridExtract(page, SELECTORS, toPost, ctx);

// in-page mode (no CDP Chrome): script for Playwright MCP browser_run_code_unsafe
export const pageScript = (o) => buildPageScript(SELECTORS, { platform: 'reddit', steps: 4, max: 12, delay: [5, 15], ...o, id_re: /comments\/([a-z0-9]{4,})/.source });
