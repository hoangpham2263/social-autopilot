// Pure helpers of the backfill mode: newest/oldest post of a source, the backfill stop rule, when backfill skips a source.
// npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceBounds } from '../scripts/store.mjs';
import { stopRule, backfillSkip, crawlMode } from '../scripts/research.mjs';

const item = (id, posted_date, run, n) => ({ id, posted_date, run, post_url: `https://www.facebook.com/x/posts/${n}`, post_ids: [String(n)] });

test('sourceBounds: by posted_date; undated stores fall back to crawl order', () => {
  assert.deepEqual(sourceBounds([]), { newest_seen: null, oldest_seen: null });
  const dated = sourceBounds([item('S1', '2026-11-05', '2026-11-06', 50000005), item('S2', '2026-11-01', '2026-11-06', 50000001), item('S3', '', '2026-11-06', 50000003)]);
  assert.deepEqual([dated.newest_seen.item, dated.oldest_seen.item, dated.oldest_seen.post_id, dated.oldest_seen.date], ['S1', 'S2', '50000001', '2026-11-01']);
  // Undated: the first crawl scrolled new -> old, so its last item is the oldest; the latest crawl's first is the newest.
  const undated = sourceBounds([item('S1', '', '2026-11-01', 1000001), item('S2', '', '2026-11-01', 1000002), item('S3', '', '2026-11-08', 1000003)]);
  assert.deepEqual([undated.newest_seen.item, undated.oldest_seen.item, undated.oldest_seen.date], ['S3', 'S2', '']);
});

test('stopRule and backfillSkip', () => {
  const known = { count: 2, newest_posted_date: '2026-11-05', oldest_seen: { date: '2026-11-01', post_id: '50000001', post_url: 'https://www.facebook.com/x/posts/50000001' } };
  assert.equal(crawlMode({}), 'new');
  assert.equal(crawlMode({ full: true }), 'full');
  assert.equal(crawlMode({ backfill: true }), 'backfill');
  assert.match(stopRule({}, known), /3 bài liên tiếp/);
  const rule = stopRule({ backfill: true, max_posts: 20 }, known);
  assert.match(rule, /cuộn NHANH/);
  assert.match(rule, /2026-11-01, mã 50000001/);
  assert.match(rule, /20 bài mới/);
  assert.doesNotMatch(rule, /3 bài liên tiếp/);
  assert.match(stopRule({ backfill: true }, { count: 0 }), /kho chưa có bài/);
  assert.equal(backfillSkip({}, known, { reached_end: true }), '');
  assert.match(backfillSkip({ backfill: true }, known, { reached_end: true }), /reached_end/);
  assert.equal(backfillSkip({ backfill: true }, known, {}), '');
  assert.match(backfillSkip({ backfill: true, since: '2026-11-03' }, known, {}), /--since/);
  assert.equal(backfillSkip({ backfill: true, since: '2026-10-01' }, known, {}), '');
});
