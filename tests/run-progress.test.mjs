// GET /api/run-progress (src/run-progress.mjs): read-only counters of the current run. Not run by the agent; npm test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runProgress } from '../src/run-progress.mjs';

test('run progress: shape per mode, no files needed', () => {
  const r = runProgress({ mode: 'research', started: '2999-01-01T00:00:00Z', active: true, brands: ['nobody'] });
  assert.equal(r.mode, 'research');
  assert.deepEqual(r.research.rows.map((x) => [x.brand, x.kept, x.target]), [['nobody', 0, 0]]);
  assert.equal(runProgress({ mode: 'create', started: '2999-01-01T00:00:00Z' }).create, null);
  assert.equal(runProgress({}).mode, '');
});
