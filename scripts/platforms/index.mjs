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
  instagram: { adapter: instagram, status: 'untested', checked: '', note: 'extract-only rework, needs a browser check: the page script now only reads the page (the agent scrolls); post-page fallback kept (read with a 3 s timeout)' },
  pinterest: { adapter: pinterest, status: 'untested', checked: '', note: 'extract-only rework, needs a browser check: the page script now only reads the page (the agent scrolls); author is not in the search grid DOM; caption prefixes stripped' },
  tiktok: { adapter: tiktok, status: 'broken', checked: '2026-11-10', note: 'Search page in the Playwright Chrome shows "Something went wrong" with a Log in button, 0 video links after 6 s (not signed in / search needs login). pageScript is written but never produced posts; retry signed in' },
  facebook: { adapter: facebook, status: 'untested', checked: '', note: 'extract-only rework, needs a browser check: the page script now only reads the page (no hover, no click); id = the post permalink (/posts/pfbid, story_fbid, /permalink/, reel/video) when the DOM has it, else the photo fbid, with the photo fbids stored as aliases; caption from the post container (not the text of one photo); date from the timestamp aria-label / tooltip / abbr / time, else empty' },
  reddit: { adapter: reddit, status: 'broken', checked: '2026-11-10', note: 'BLOCKED: signed-in Chrome via Playwright gets HTTP 403 "You have been blocked by network security" (js_challenge) on /search. pageScript is written but never ran; retry from a normal browser session' },
  etsy: { adapter: etsy, status: 'untested', checked: '', note: 'extract-only rework, needs a browser check: the page script now only reads the page (the agent scrolls); card alt "May include: ..." stripped; sponsored cards appear (author starts with "Ad")' },
  youtube: { adapter: youtube, status: 'broken', checked: '2026-11-10', note: 'BLOCKED: net::ERR_SSL_PROTOCOL_ERROR on every youtube.com URL in this Playwright browser (network/proxy level), nothing could be inspected. pageScript is written but never ran' },
  houzz: { adapter: houzz, status: 'untested', checked: '', note: 'extract-only rework, needs a browser check: the page script now only reads the page (the agent scrolls); photo = img /fimgs/ (/simgs/ is the pro avatar); results only loosely on topic' },
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
