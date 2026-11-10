// Fixes from the first real Publish approved run (10/11/2026): primary-only times at 1 post a day, --key=value args
// (negative uuid), run start from the Run progress, alt text at Approve. node --test tests/publish-fixes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-pubfix-'));
process.env.SA_WORKSPACE = path.join(tmp, 'workspace');
process.env.SA_SKILLS_ROOT = path.join(tmp, 'skills');
const { timePicker, START_TODAY_LEAD_MINUTES } = await import('../scripts/metricool-csv.mjs');
const { parseArgs } = await import('../scripts/lib.mjs');
const { newRun, track } = await import('../scripts/progress.mjs');
const { runStarted, addLog } = await import('../scripts/runlog.mjs');
const { altText } = await import('../scripts/writeback.mjs');

const TZ = 'America/New_York';
const days = (t) => Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [t]]));
const research = { networks: { facebook: { timezone: TZ, days: days('09:00'), backup: days('22:00'), acceptable_curve: ['10:00', '21:00'] } } };
const pick = (now, perDay = 1) => timePicker({ brandId: 'x', network: 'Facebook', perDay, audienceTz: TZ, taken: new Set(), now, best: null, research, allowToday: true, leadMinutes: START_TODAY_LEAD_MINUTES })();

test('1 post a day: only primary times; --start today after the primary passed -> tomorrow primary, never tonight backup', () => {
  const t = pick(new Date('2026-11-10T02:45:00Z')); // Monday 21:45 New York: primary 09:00 passed, backup 22:00 is 15 min away
  assert.deepEqual([t.date, t.time], ['2026-11-10', '09:00:00']);
  assert.ok(!/backup|acceptable/.test(t.source), t.source);
  // A primary slot less than 15 min away is skipped (comfortable margin).
  const near = pick(new Date('2026-11-09T13:50:00Z')); // Monday 08:50: 09:00 is 10 min away
  assert.equal(near.date, '2026-11-10');
  // A primary slot well ahead today is taken.
  const ahead = pick(new Date('2026-11-09T12:00:00Z')); // Monday 07:00
  assert.deepEqual([ahead.date, ahead.time], ['2026-11-09', '09:00:00']);
  // --start today with 3 a day: today still only primary (tonight's backup never), so the first goes to tomorrow.
  const three = pick(new Date('2026-11-10T02:45:00Z'), 3);
  assert.deepEqual([three.date, three.time], ['2026-11-10', '09:00:00']);
  // Two posts a day may use the backup hours.
  const two = timePicker({ brandId: 'x', network: 'Facebook', perDay: 2, audienceTz: TZ, taken: new Set(), now: new Date('2026-11-09T12:00:00Z'), best: null, research });
  const got = [two(), two()];
  assert.ok(got.some((x) => /backup|acceptable/.test(x.source)), JSON.stringify(got));
});

test('args: --key=value (negative numbers too) and --key -123', () => {
  const a = parseArgs(['record', '--uuid=-7086123', '--id', '-42', '--planner-url=https://x.test/?a=b', '--force']);
  assert.equal(a.uuid, '-7086123');
  assert.equal(a.id, '-42');
  assert.equal(a['planner-url'], 'https://x.test/?a=b');
  assert.equal(a.force, true);
});

test('run log: started comes from the open Run progress (first step), never a date-only value or 24 h back', () => {
  newRun('publish', { brands: [] });
  track('setup', { mode: 'publish', detail: 'brands.mjs' });
  const s = runStarted('publish');
  assert.match(s, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  assert.ok(Date.now() - Date.parse(s) < 60000);
  const log = addLog({ mode: 'publish', agent: 'Test', started: '2026-11-09' });
  assert.ok(log.duration_s < 120, `duration ${log.duration_s}`);
  assert.match(log.times.started.et, / ET$/);
  assert.match(log.times.ended.vn, / VN$/);
});

test('alt text at Approve: from the idea, short, no AI label, no source shop', () => {
  const alt = altText({ idea: { product_type: 'live-edge walnut coffee table', scene: 'in a sunlit living room', props: 'a linen sofa and a mug' }, inspiration: { source_shop: 'Shop A' } });
  assert.equal(alt, 'Live-edge walnut coffee table in a sunlit living room with a linen sofa and a mug.');
  assert.match(altText({ idea: { product_type: 'neon sign', scene: 'wedding backdrop' }, sign_text: 'Anna & Ben' }), /reading "Anna & Ben"/);
  assert.equal(altText({ idea: { product_type: 'oak sign', scene: 'AI generated room' } }), 'Oak sign.');
  assert.equal(altText({ idea: {} }), 'Product photo.');
  assert.ok(altText({ idea: { product_type: 'x'.repeat(400) } }).length <= 241);
});
