// Platforms that have a direct fetch route (no browser): `collect.mjs fetch --platform <id>`.
import * as reddit from './reddit.mjs';
import * as houzz from './houzz.mjs';
import * as pinterest from './pinterest.mjs';

export const FETCH_ROUTES = { reddit, houzz, pinterest };
export const getFetchRoute = (platform) => FETCH_ROUTES[String(platform || '').toLowerCase()] || null;
// kind: 'query' | 'source' | 'standalone'. Pinterest only has the user/board feed (reference pages).
export const hasFetchRoute = (platform, kind = 'query') => {
  const p = String(platform || '').toLowerCase();
  if (!FETCH_ROUTES[p]) return false;
  return p === 'pinterest' ? kind !== 'query' : true;
};
