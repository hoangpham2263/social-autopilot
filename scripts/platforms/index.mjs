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
  instagram: { adapter: instagram, status: 'broken', checked: '2026-11-10', note: 'hashtag URL redirects to /explore/search/keyword/?q=%23tag; only 5 tiles, 4 without img after 12 s (lazy): needs a longer wait or another source of image/caption; not verified end to end' },
  pinterest: { adapter: pinterest, status: 'untested', checked: '2026-11-10', note: 'extract verified live in Chrome (17 pins, ids, originals images, alt captions; author empty); download + collect.mjs end to end need a CDP Chrome (9222)' },
  tiktok: { adapter: tiktok, status: 'untested', checked: '', note: '' },
  facebook: { adapter: facebook, status: 'untested', checked: '', note: '' },
  reddit: { adapter: reddit, status: 'untested', checked: '', note: '' },
  etsy: { adapter: etsy, status: 'untested', checked: '', note: '' },
  youtube: { adapter: youtube, status: 'untested', checked: '', note: '' },
  houzz: { adapter: houzz, status: 'untested', checked: '', note: '' },
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
