// Posting times: posts_per_day a day at Metricool's best times (sync-times), else the research table
// (config/best-times.json); several posts a day at least 3 hours apart; taken times never reused. Pure functions.
// npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { timePicker, postsPerDay, dayTimes, researchTimes } from '../scripts/metricool-csv.mjs';
import { parseBestTimes } from '../scripts/metricool-mcp.mjs';

const NOW = new Date('2026-11-09T12:00:00Z'); // Monday 07:00 in New York
const TZ = 'America/New_York';

test('postsPerDay: posts_per_day, else ceil(posts_per_week / 7), else 1', () => {
  assert.equal(postsPerDay({ posts_per_day: 2 }), 2);
  assert.equal(postsPerDay({ posts_per_week: 3 }), 1);
  assert.equal(postsPerDay({ posts_per_week: 10 }), 2);
  assert.equal(postsPerDay({}), 1);
});

test('research default: one post a day, every day from tomorrow, the best hour of each weekday', () => {
  const research = researchTimes();
  const pick = timePicker({ brandId: 'x', network: 'Facebook', perDay: 1, audienceTz: TZ, taken: new Set(), now: NOW, best: null, research });
  const got = Array.from({ length: 7 }, () => pick());
  assert.deepEqual(got.map((x) => x.date), ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16']);
  assert.ok(got.every((x) => x.source === 'research default'));
  assert.equal(got[0].time, `${research.networks.facebook.days.tue[0]}:00`, 'Tuesday: its best hour');
  assert.equal(got[6].time, `${research.networks.facebook.days.mon[0]}:00`, 'Monday: its best hour');
});

test('two posts a day: at least 3 hours apart; an already taken day counts toward its posts', () => {
  const taken = new Set(['2026-11-10 12:30:00']); // Tuesday already has one post
  const pick = timePicker({ brandId: 'x', network: 'Facebook', perDay: 2, audienceTz: TZ, taken, now: NOW, best: null, research: researchTimes() });
  const a = pick(), b = pick(), c = pick();
  assert.equal(a.date, '2026-11-10');
  assert.ok(Math.abs(Number(a.time.slice(0, 2)) * 60 - (12 * 60 + 30)) >= 180, `${a.time} is 3h from 12:30`);
  assert.equal(b.date, '2026-11-11', 'Tuesday is full with 2');
  assert.equal(c.date, '2026-11-11');
  assert.ok(Math.abs(Number(b.time.slice(0, 2)) - Number(c.time.slice(0, 2))) >= 3);
});

test('Metricool best times win when there is enough data; parsed from any shape', () => {
  const slots = parseBestTimes({ data: [
    { day: 2, hour: 14, value: 90 }, { day: 2, hour: 9, value: 40 }, { day: 3, hour: 19, value: 80 }, { day: 4, hour: 7, value: 70 },
    { day: 5, hour: 11, value: 60 }, { day: 6, hour: 10, value: 50 }, { day: 0, hour: 16, value: 30 }, { day: 1, hour: 13, value: 20 },
  ] });
  assert.equal(slots[0].day, 'tue'); assert.equal(slots[0].time, '14:00');
  const best = { timezone: TZ, slots };
  assert.deepEqual(dayTimes('tue', { best, research: researchTimes(), network: 'facebook' }), { times: ['14:00:00', '09:00:00'], tz: TZ, source: 'Metricool best time' });
  const pick = timePicker({ brandId: 'x', network: 'Facebook', perDay: 1, audienceTz: TZ, taken: new Set(), now: NOW, best, research: researchTimes() });
  assert.deepEqual(pick(), { date: '2026-11-10', time: '14:00:00', source: 'Metricool best time' });
  // too little data: the research table
  assert.equal(dayTimes('tue', { best: { timezone: TZ, slots: slots.slice(0, 2) }, research: researchTimes(), network: 'facebook' }).source, 'research default');
  // a matrix shape
  assert.deepEqual(parseBestTimes({ monday: { 9: 5, 18: 7 } }).map((x) => `${x.day} ${x.time}`), ['mon 18:00', 'mon 09:00']);
});
