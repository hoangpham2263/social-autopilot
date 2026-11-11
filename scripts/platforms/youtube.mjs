// YouTube adapter (status in scripts/platforms/index.mjs; written from knowledge of the site, NOT yet run on a live page).
// Hashtag pages (/hashtag/<tag>/shorts) and search results (/results?search_query=, Shorts filter) list video/short cards;
// each links to /shorts/<id> or /watch?v=<id>. The image is built from the id (i.ytimg.com), so lazy thumbnails never matter.
import { makePost, buildPageScript, enc, isHashtag, tagOf } from './common.mjs';

// ---- every selector and pattern of this adapter lives in this block ----
export const SELECTORS = {
  link: ['a[href*="/shorts/"]', 'a[href*="/watch?v="]'],
  url_pattern: '^https?://(www\\.|m\\.)?youtube\\.com/(shorts/[\\w-]{6,}|watch\\?v=[\\w-]{6,})',
  container: 'ytd-video-renderer, ytd-reel-item-renderer, ytm-shorts-lockup-view-model, ytd-rich-item-renderer, ytd-grid-video-renderer, ytm-shorts-lockup-view-model-v2',
  img: [],
  img_skip: [],
  caption: ['#video-title', 'h3', 'a#video-title-link', 'a[title]', 'span.yt-core-attributed-string'],
  author: ['ytd-channel-name a', '#channel-name a', 'a[href^="/@"]'],
  wall: {
    url: ['consent\\.youtube\\.com', '/sorry/', 'accounts\\.google\\.com'],
    title: ['before you continue'],
    text: ["sign in to confirm you.re not a bot", 'before you continue to youtube', 'our systems have detected unusual traffic'],
    login_form: ['form[action*="ServiceLogin"]'],
    captcha: ['iframe[src*="recaptcha"]', '#recaptcha'],
    dialog: ['tp-yt-paper-dialog ytd-consent-bump-v2-lightbox', 'ytd-consent-bump-v2-lightbox'],
  },
};

// ---- pure helpers (tests/collect.test.mjs) ----
// /shorts/<id> = watch?v=<id> = youtu.be/<id>: one post.
export function postId(url) {
  const s = String(url || '');
  return (s.match(/[?&]v=([\w-]{6,})/) || s.match(/\/shorts\/([\w-]{6,})/) || s.match(/youtu\.be\/([\w-]{6,})/) || [])[1] || '';
}
export const canonicalUrl = (url) => { const id = postId(url); return id ? (/\/shorts\//.test(url) ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`) : String(url || ''); };
export const thumbnailUrl = (id) => (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '');
export const searchUrl = (query) => (isHashtag(query) ? `https://www.youtube.com/hashtag/${enc(tagOf(query))}/shorts` : `https://www.youtube.com/results?search_query=${enc(String(query).trim())}&sp=EgIYAQ%253D%253D`);
export const toPost = (t, ctx = {}) => { const id = postId(t.url); return makePost({ id, url: canonicalUrl(t.url), image_urls: [thumbnailUrl(id)], caption: t.caption, author: t.author, found_by: ctx.found_by || '' }); };


// extract script (Playwright MCP browser_run_code_unsafe): reads the page as it is now
export const pageScript = (o) => buildPageScript(SELECTORS, { platform: 'youtube', max: 0, ...o, id_re: /(?:[?&]v=|\/shorts\/)([\w-]{6,})/.source });
