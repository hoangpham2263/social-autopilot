// Network git calls of the image host: transient errors are retried with a backoff, a refused push or an auth error is not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gitNet } from '../scripts/host-image.mjs';

const ok = { status: 0, stdout: 'done\n' }, net = { status: 1, stderr: 'fatal: unable to access x: Could not resolve host: github.com' };
const seq = (list) => { let n = 0; const f = () => list[Math.min(n++, list.length - 1)]; f.calls = () => n; return f; };

test('a transient network error is retried, then succeeds', () => {
  const run = seq([net, net, ok]);
  assert.equal(gitNet('.', ['push'], { waits: [1, 1, 1], run }), 'done'); assert.equal(run.calls(), 3);
});
test('a refused push and an auth error are not retried', () => {
  for (const stderr of ['! [rejected] main -> main (non-fast-forward)', 'fatal: Authentication failed for x']) { const run = seq([{ status: 1, stderr }]); assert.throws(() => gitNet('.', ['push'], { waits: [1, 1, 1], run })); assert.equal(run.calls(), 1); }
});
test('gives up after the last backoff with the git error', () => {
  const run = seq([net]);
  assert.throws(() => gitNet('.', ['pull'], { waits: [1, 1, 1], run }), /Could not resolve host/); assert.equal(run.calls(), 4);
});
