// Registry of the platform adapters used by scripts/collect.mjs (docs/research.md "Adapter workflow").
// status: "untested" (written from knowledge of the site, never run on a live page: the agent verifies it with Playwright
// MCP before trusting it), "ok" (checked on a live page; `checked` = YYYY-MM-DD), "broken" (failed: fix the adapter).
// The agent that verifies or fixes an adapter edits ITS entry here: status "ok" + checked date, or "broken" + note.
import * as instagram from './instagram.mjs';
import * as pinterest from './pinterest.mjs';
import * as tiktok from './tiktok.mjs';
import * as facebook from './facebook.mjs';
import * as reddit from './reddit.mjs';
import * as etsy from './etsy.mjs';
import * as youtube from './youtube.mjs';
import * as houzz from './houzz.mjs';

export const STATUSES = ['untested', 'ok', 'broken'];

export const REGISTRY = {
  instagram: { adapter: instagram, status: 'untested', checked: '', note: 'NEEDS A FRESH BROWSER CHECK: the script changed (cut regex, captcha iframe, compact result); earlier ok result: in-page mode verified live (#neonweddingsign: script -> MCP -> from-page, 5 posts, 5 images; 3 via post page /p/<code>/ fallback). The search page only shows ~5 tiles per keyword; author comes from the post page og:description' },
  pinterest: { adapter: pinterest, status: 'untested', checked: '', note: 'NEEDS A FRESH BROWSER CHECK: the earlier ok predates the three bug fixes (page-script changes); earlier ok result: in-page mode verified live (live edge dining table: 12 pins, 12 images in one MCP call, ~10 s); author is not in the search grid DOM (empty); caption prefixes stripped' },
  tiktok: { adapter: tiktok, status: 'broken', checked: '2026-11-10', note: 'Search page in the Playwright Chrome shows "Something went wrong" with a Log in button, 0 video links after 6 s (not signed in / search needs login). pageScript is written but never produced posts; retry signed in' },
  facebook: { adapter: facebook, status: 'untested', checked: '', note: 'pageScript built; live 2026-11-10 on hineon + duodecor: script -> one MCP call -> from-page (temp workspace) verified:true, 6 posts each, 6/6 images downloaded, captions read, ~100 s/page. NOT ok yet: ids are the photo fbid (timeline permalink stays href="#" after mouseover, so no /posts/pfbid), and known.json stores /posts/pfbid urls, so the known-post stop rule may not match; spot-check only 1/2 per page confirmed (album photos show the photo text, not the post caption); date_text empty' },
  reddit: { adapter: reddit, status: 'broken', checked: '2026-11-10', note: 'BLOCKED: signed-in Chrome via Playwright gets HTTP 403 "You have been blocked by network security" (js_challenge) on /search. pageScript is written but never ran; retry from a normal browser session' },
  etsy: { adapter: etsy, status: 'untested', checked: '', note: 'NEEDS A FRESH BROWSER CHECK: the script changed (cut regex, captcha iframe, compact result); earlier ok result: in-page mode verified live (neon wedding sign: 12 listings in one MCP call, images 765px via card img, spot-check 3/3 id+image+shop). Card alt = "May include: ..." (stripped); sponsored cards appear (author starts with "Ad"); the MCP result is too large to read back by hand, so use browser_evaluate/run_code with a compact return' },
  youtube: { adapter: youtube, status: 'broken', checked: '2026-11-10', note: 'BLOCKED: net::ERR_SSL_PROTOCOL_ERROR on every youtube.com URL in this Playwright browser (network/proxy level), nothing could be inspected. pageScript is written but never ran' },
  houzz: { adapter: houzz, status: 'untested', checked: '', note: 'NEEDS A FRESH BROWSER CHECK: the script changed (cut regex, captcha iframe, compact result); earlier ok result: in-page mode verified live (live edge dining table: 12 photos with author, 1100px images, spot-check 3/3 id+image+author). Photo = img /fimgs/, /simgs/ is the pro avatar; search results are only loosely on topic (rooms), the product-fit look must filter' },
};

export const platformIds = () => Object.keys(REGISTRY);
export const getAdapter = (id) => REGISTRY[String(id || '').toLowerCase()]?.adapter || null;
// { status, checked, note } of a platform; a platform without an adapter is "missing".
export function adapterStatus(id) {
  const e = REGISTRY[String(id || '').toLowerCase()];
  return e ? { status: e.status, checked: e.checked, note: e.note } : { status: 'missing', checked: '', note: 'no adapter: write scripts/platforms/<platform>.mjs and register it here' };
}
// The collector's output is trusted (no hand-driven check needed) only for a verified adapter.
export const isTrusted = (id) => adapterStatus(id).status === 'ok';
