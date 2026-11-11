// Registry of the platform adapters used by scripts/collect.mjs (docs/research.md "Adapter workflow").
// status: "untested" (written from knowledge of the site, never run on a live page: the agent verifies it with Playwright
// MCP before trusting it), "ok" (checked on a live page; `checked` = YYYY-MM-DD), "broken" (failed: fix the adapter).
// The agent that verifies or fixes an adapter edits ITS entry here: status "ok" + checked date, or "broken" + note.
import * as instagram from './instagram.mjs';
import * as pinterest from './pinterest.mjs';
import * as facebook from './facebook.mjs';
import * as reddit from './reddit.mjs';
import * as etsy from './etsy.mjs';
import * as youtube from './youtube.mjs';
import * as houzz from './houzz.mjs';

export const STATUSES = ['untested', 'ok', 'broken'];

export const REGISTRY = {
  instagram: { adapter: instagram, status: 'ok', checked: '2026-11-11', note: 'live run 2026-11-11: hashtag neonweddingsign, 4 posts; author read from the post page (handle from og:description, else the name from og:title), spot-check matched; the grid has no date' },
  pinterest: { adapter: pinterest, status: 'ok', checked: '2026-11-11', note: 'live run 2026-11-11: pins, ids and images verified against the pin page; author is not in the search grid (empty) and the caption is the grid alt text, which can differ from the pin title' },
  facebook: { adapter: facebook, status: 'ok', checked: '2026-11-11', note: 'live run 2026-11-11: page feed, date_text read from the aria-labelledby target of the scrambled timestamp link (all posts), ids typed (kind post / photo), stable across extracts; search/hashtag pages and sponsored posts without any link not covered' },
  reddit: { adapter: reddit, status: 'broken', checked: '2026-11-10', note: 'BLOCKED: signed-in Chrome via Playwright gets HTTP 403 "You have been blocked by network security" (js_challenge) on /search. pageScript is written but never ran; retry from a normal browser session' },
  etsy: { adapter: etsy, status: 'ok', checked: '2026-11-11', note: 'live run 2026-11-11: listing ids, shop author, caption (May include prefix stripped) and image verified against the listing page' },
  youtube: { adapter: youtube, status: 'broken', checked: '2026-11-10', note: 'BLOCKED: net::ERR_SSL_PROTOCOL_ERROR on every youtube.com URL in this Playwright browser (network/proxy level), nothing could be inspected. pageScript is written but never ran' },
  houzz: { adapter: houzz, status: 'ok', checked: '2026-11-11', note: 'live run 2026-11-11: photo ids, pro author, caption and image verified against the photo page; results only loosely on topic' },
};

export const platformIds = () => Object.keys(REGISTRY);
export const getAdapter = (id) => REGISTRY[String(id || '').toLowerCase()]?.adapter || null;
// { status, checked, note } of a platform; a platform without an adapter is "missing".
export function adapterStatus(id) {
  const e = REGISTRY[String(id || '').toLowerCase()];
  return e ? { status: e.status, checked: e.checked, note: e.note } : { status: 'missing', checked: '', note: 'no adapter: write scripts/platforms/<platform>.mjs and register it here' };
}
// The collector's output is trusted (no extra check against the live page needed) only for a verified adapter.
export const isTrusted = (id) => adapterStatus(id).status === 'ok';
