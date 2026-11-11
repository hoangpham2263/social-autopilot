// Page -> tool transfer (scripts/collect-transfer.mjs): one-time token, expiry, task match, size limit, script_dir default, excerpt regex.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { issueToken, redeem, scriptDir, scriptFile, MAX_BODY } from '../scripts/collect-transfer.mjs';

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
  assert.equal(redeem({ token: tok, task: 'q1', body: Buffer.alloc(MAX_BODY + 1, 1), dir, runsRoot }).status, 413);
  assert.equal(redeem({ token: tok, task: 'q1', body, dir, runsRoot }).ok, true);
  assert.ok(fs.existsSync(path.join(task, 'page-result.json')));
  assert.equal(redeem({ token: tok, task: 'q1', body, dir, runsRoot }).status, 403);
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
