// Page -> tool transfer (scripts/collect-transfer.mjs): one-time token, expiry, task match, size limit, script_dir default, excerpt regex.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { issueToken, redeem, scriptDir, scriptFile, MAX_BODY, TOKEN_TTL_MS, ttlMs, maskToken } from '../scripts/collect-transfer.mjs';

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-'));
  const runsRoot = path.join(root, 'runs'), task = path.join(runsRoot, 'b', 'q1'), dir = path.join(root, 'tok');
  fs.mkdirSync(task, { recursive: true });
  return { runsRoot, task, dir };
};
const body = Buffer.from(JSON.stringify({ total: 0, tiles: [] }));

test('token: valid once, wrong task / bad token / oversize / expired are refused', () => {
  const { runsRoot, task, dir } = setup();
  const tok = issueToken(task, 'q1', Date.now(), dir);
  assert.equal(redeem({ token: 'bad', task: 'q1', body, dir, runsRoot }).status, 403);
  assert.equal(redeem({ token: tok, task: 'q2', body, dir, runsRoot }).status, 403);
  const tok2 = issueToken(task, 'q1', Date.now(), dir); // a wrong-task attempt spends the token, so each step gets its own
  assert.equal(redeem({ token: tok2, task: 'q1', body: Buffer.alloc(MAX_BODY + 1, 1), dir, runsRoot }).status, 413);
  const tok3 = issueToken(task, 'q1', Date.now(), dir);
  assert.equal(redeem({ token: tok3, task: 'q1', body, dir, runsRoot }).ok, true);
  assert.ok(fs.existsSync(path.join(task, 'page-result.json')));
  assert.equal(redeem({ token: tok3, task: 'q1', body, dir, runsRoot }).status, 403);
  const old = issueToken(task, 'q1', Date.now() - 20 * 60000, dir);
  assert.equal(redeem({ token: old, task: 'q1', body, dir, runsRoot }).status, 403);
});
test('token: a task dir outside workspace/runs is refused', () => {
  const { runsRoot, dir } = setup();
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'other-'));
  const tok = issueToken(other, 'q1', Date.now(), dir);
  assert.equal(redeem({ token: tok, task: 'q1', body, dir, runsRoot }).status, 404);
});
test('script_dir default sits under the home .playwright-mcp', () => {
  assert.equal(scriptDir(undefined, '/h'), path.resolve('/h', '.playwright-mcp', 'social-autopilot'));
  assert.equal(path.basename(scriptFile('grenheim', 'q-1', '/x')), 'grenheim-q-1.js');
});
test('token: default validity is 5 minutes (research.token_minutes)', () => {
  assert.equal(TOKEN_TTL_MS, 5 * 60 * 1000);
  assert.equal(ttlMs(2), 2 * 60 * 1000);
  assert.equal(ttlMs(undefined), 5 * 60 * 1000);
  const { runsRoot, task, dir } = setup();
  const t6 = issueToken(task, 'q1', Date.now() - 6 * 60000, dir);
  assert.match(redeem({ token: t6, task: 'q1', body, dir, runsRoot }).error, /run `collect.mjs script` again/);
  const t4 = issueToken(task, 'q1', Date.now() - 4 * 60000, dir);
  assert.equal(redeem({ token: t4, task: 'q1', body, dir, runsRoot }).ok, true);
});
test('token: a rejected attempt for another task spends it; masked form hides the token', () => {
  const { runsRoot, task, dir } = setup();
  const tok = issueToken(task, 'q1', Date.now(), dir);
  assert.equal(redeem({ token: tok, task: 'q2', body, dir, runsRoot }).status, 403);
  const again = redeem({ token: tok, task: 'q1', body, dir, runsRoot });
  assert.equal(again.status, 403);
  assert.match(again.error, /already used or expired/);
  assert.equal(maskToken('abcdef123456'), '****3456');
});
