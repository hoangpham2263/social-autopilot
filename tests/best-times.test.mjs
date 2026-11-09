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
  const tue = dayTimes('tue', { best, research: researchTimes(), network: 'facebook' });
  assert.deepEqual({ times: tue.times, tz: tue.tz, source: tue.source }, { times: ['14:00:00', '09:00:00'], tz: TZ, source: 'Metricool best time' });
  assert.equal(tue.backup[0].source, 'research backup', 'two Metricool slots are both primary; backups from the research table');
  const pick = timePicker({ brandId: 'x', network: 'Facebook', perDay: 1, audienceTz: TZ, taken: new Set(), now: NOW, best, research: researchTimes() });
  assert.deepEqual(pick(), { date: '2026-11-10', time: '14:00:00', source: 'Metricool best time' });
  // too little data: the research table
  assert.equal(dayTimes('tue', { best: { timezone: TZ, slots: slots.slice(0, 2) }, research: researchTimes(), network: 'facebook' }).source, 'research default');
  // a matrix shape
  assert.deepEqual(parseBestTimes({ monday: { 9: 5, 18: 7 } }).map((x) => `${x.day} ${x.time}`), ['mon 18:00', 'mon 09:00']);
});

test('--window: the best time inside the window, else its midpoint hour; --start today: at least 1 hour ahead', () => {
  const research = researchTimes();
  const pick = timePicker({ brandId: 'x', network: 'Facebook', perDay: 1, audienceTz: TZ, taken: new Set(), now: NOW, best: null, research, window: 'evening' });
  const a = pick();
  assert.equal(a.source, 'research default in window');
  const h = Number(a.time.slice(0, 2));
  assert.ok(h >= 18 && h < 21, a.time);
  assert.equal(a.time, '19:00:00', 'Tuesday evening: the table has 19:00');
  // Wednesday's table has 18:00; a window without data: its midpoint (morning 8-11 -> 10:00 on a day with no 8-11 hour)
  const morning = timePicker({ brandId: 'x', network: 'Facebook', perDay: 1, audienceTz: TZ, taken: new Set(), now: NOW, best: null, research: { networks: { facebook: { timezone: TZ, days: { tue: ['19:00'], wed: ['19:00'], thu: ['19:00'], fri: ['19:00'], sat: ['19:00'], sun: ['19:00'], mon: ['19:00'] } } } }, window: 'morning' });
  assert.equal(morning().time, '10:00:00');
  assert.throws(() => timePicker({ brandId: 'x', audienceTz: TZ, taken: new Set(), now: NOW, best: null, research, window: 'night' }), /--window/);
  // today, now 07:00 in New York: Monday's 09:00 is >= 1 h ahead
  const today = timePicker({ brandId: 'x', network: 'Facebook', perDay: 1, audienceTz: TZ, taken: new Set(), now: NOW, best: null, research, allowToday: true, leadMinutes: 60 });
  const t = today();
  assert.equal(t.date, '2026-11-09');
  assert.ok(Number(t.time.slice(0, 2)) * 60 >= 8 * 60, t.time);
});

test('backup hours: primary times first; when they cannot hold posts_per_day 3 h apart, backups 3 h apart, then backups 2 h apart, before the next day', () => {
  const day = () => Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, ['09:00']]));
  const research = { networks: { facebook: { timezone: TZ, days: day(), backup: {}, acceptable_curve: ['10:00', '21:00'] } } };
  research.networks.facebook.days.tue = ['12:00', '13:00'];
  research.networks.facebook.backup.tue = ['14:00', '17:00', '19:00'];
  const pick = timePicker({ brandId: 'x', network: 'Facebook', perDay: 6, audienceTz: TZ, taken: new Set(), now: NOW, best: null, research });
  const got = Array.from({ length: 6 }, () => pick());
  assert.deepEqual(got.map((x) => `${x.date} ${x.time} ${x.source}`), [
    '2026-11-10 12:00:00 research default',
    '2026-11-10 17:00:00 research backup', // 13:00 and 14:00 are under 3 h from 12:00
    '2026-11-10 21:00:00 research acceptable', // no backup 3 h from both; the acceptable 21:00 is
    '2026-11-10 14:00:00 research backup', // then 2 h apart: backups first (best ranked first)
    '2026-11-10 19:00:00 research backup',
    '2026-11-10 10:00:00 research acceptable', // then acceptable hours 2 h apart
  ]);
  assert.equal(pick().date, '2026-11-11', 'Tuesday full: the next day');
  // Metricool: its lower-scored slots of the day are backups, before the research backups
  const slots = [['tue', '10:00', 90], ['tue', '11:00', 80], ['tue', '12:00', 70], ['tue', '12:30', 60], ['tue', '16:00', 50], ['wed', '10:00', 90], ['thu', '10:00', 90]].map(([d, t, s]) => ({ day: d, time: t, score: s }));
  const t2 = dayTimes('tue', { best: { timezone: TZ, slots }, research, network: 'facebook' });
  assert.deepEqual(t2.times, ['10:00:00', '11:00:00', '12:00:00', '12:30:00']);
  assert.deepEqual(t2.backup.map((x) => `${x.time} ${x.source}`), ['16:00:00 Metricool backup', '14:00:00 research backup', '17:00:00 research backup', '19:00:00 research backup']);
  assert.deepEqual(t2.acceptable.map((x) => x.time), ['21:00:00'], 'acceptable: curve hours that are neither primary nor backup');
  const mp = timePicker({ brandId: 'x', network: 'Facebook', perDay: 2, audienceTz: TZ, taken: new Set(), now: NOW, best: { timezone: TZ, slots }, research });
  assert.deepEqual([mp(), mp()].map((x) => `${x.time} ${x.source}`), ['10:00:00 Metricool best time', '16:00:00 Metricool backup']);
});

test('the research table: every weekday has primary and backup hours, none shared, all HH:MM; with acceptable hours at least 6 spare hours a day', () => {
  const fb = researchTimes().networks.facebook;
  assert.equal(new Set(fb.acceptable_curve).size, 16, 'acceptable_curve: every hour 07:00-22:00 once');
  for (const d of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
    const t = dayTimes(d, { best: null, research: researchTimes(), network: 'facebook' });
    assert.ok(t.backup.length + t.acceptable.length >= 6, d);
    assert.equal(t.times.length + t.backup.length + t.acceptable.length, 16, `${d}: the three tiers cover 07:00-22:00 once`);
    const curve = fb.acceptable_curve.map((h) => `${h}:00`);
    assert.deepEqual(t.acceptable.map((x) => x.time), curve.filter((h) => t.acceptable.some((x) => x.time === h)), `${d}: acceptable keeps curve order`);
  }
  for (const d of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
    assert.ok(fb.days[d].length >= 1 && fb.backup[d].length >= 1, d);
    assert.ok([...fb.days[d], ...fb.backup[d]].every((t) => /^\d{2}:\d{2}$/.test(t)));
    assert.ok(!fb.backup[d].some((t) => fb.days[d].includes(t)), `${d}: a backup is not a primary hour`);
  }
});
