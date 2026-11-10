import { postKey, postIds } from './store.mjs';

// Where to stop on one source, post by post (same rules as research.mjs stopRule). take(post) -> 'seen' | 'known' |
// 'skip' (backfill, still above oldest_seen) | 'old' (before --since) | 'collect'; .stop = end state once reached.
export function makeCursor({ mode = {}, known = {} } = {}) {
  const keys = new Set([...(known.brand_post_urls || []), ...(known.post_urls || [])].map(postKey).filter(Boolean));
  const ids = new Set(known.brand_post_ids || []);
  const oldest = known.oldest_seen || null;
  const c = { seen: new Set(), streak: 0, old: 0, stop: null, passedOldest: !mode.backfill || !known.count || !oldest };
  c.take = (p) => {
    const urls = [p.post_url, ...(p.alt_urls || [])].filter(Boolean);
    const pk = urls.map(postKey).filter(Boolean), pid = urls.flatMap(postIds);
    const k = pk[0] || pid[0] || '';
    if (!k || c.seen.has(k) || pk.some((x) => c.seen.has(x))) return 'seen';
    pk.forEach((x) => c.seen.add(x)); c.seen.add(k);
    const isKnown = pk.some((x) => keys.has(x)) || pid.some((x) => ids.has(x));
    if (!c.passedOldest) {
      const atOldest = (oldest.post_id && pid.includes(oldest.post_id)) || (oldest.post_url && pk.includes(postKey(oldest.post_url)));
      const older = p.posted_date && oldest.date && p.posted_date < oldest.date;
      if (atOldest || older) c.passedOldest = true;
      if (!c.passedOldest || isKnown) return isKnown ? 'known' : 'skip';
    }
    if (isKnown) {
      c.streak++;
      if (!mode.backfill && !mode.full && known.count && c.streak >= 3) c.stop = 'known';
      return 'known';
    }
    c.streak = 0;
    if (mode.since && p.posted_date && p.posted_date < mode.since) { if (++c.old >= 2) c.stop = 'since'; return 'old'; }
    c.old = 0;
    return 'collect';
  };
  return c;
}
