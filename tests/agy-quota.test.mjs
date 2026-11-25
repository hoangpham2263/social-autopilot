// Antigravity image quota stop: only the image-generator answer, an error event of the run or the process stderr count.
// The output of any other tool (run_command, read_file...) that merely contains the 429 text (an old per-item error file echoed by a command) never stops a healthy run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createAgentRunner, agyQuota } from '../core/setup/agent-run.mjs';
import { shortQuota, scrubQuota } from '../scripts/lib.mjs';

const FULL = 'Image failed: HTTP 429 RESOURCE_EXHAUSTED: You have exhausted your capacity on this model. Your quota will reset after 3h27m10s.';
const PROMPT = 'TASK: quota fixture. ' + 'x'.repeat(220);

function fake() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-quota-'));
  let child;
  const runner = createAgentRunner({
    toolRoot: process.cwd(), workspace: ws, graceMs: 20, npxOk: () => true, killTree: () => {},
    getSettings: () => ({ image_engine: 'antigravity', agent: { research: 'claude', create: 'antigravity' } }),
    findCli: () => ({ found: true, path: 'x' }), findAgy: () => ({ found: true, path: 'agy' }),
    agyExec: () => ({ status: 0, stdout: 'NAME TYPE STATUS COMMAND\n', stderr: '' }),
    spawnFn: () => { child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = { end() {}, on() {} }; child.pid = 1; return child; },
  });
  const started = runner.start({ mode: 'create', prompt: PROMPT, imageEngine: 'antigravity' });
  assert.equal(started.ok, true);
  const ev = (o) => child.stdout.emit('data', Buffer.from(JSON.stringify(o) + '\n'));
  const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));
  return { runner, ev, wait, err: (t) => child.stderr.emit('data', Buffer.from(t)), done: () => fs.rmSync(ws, { recursive: true, force: true }) };
}

test('a run_command / read_file output holding the full 429 text does not stop the run', async () => {
  const f = fake();
  f.ev({ event: 'step_update', step_update: { step_index: 3, state: 'DONE', step_type: 'tool', tool_name: 'run_command', tool_info: { parameters: { CommandLine: 'node scripts/pipeline.mjs create --resume' }, output: FULL } } });
  f.ev({ event: 'step_update', step_update: { step_index: 4, state: 'DONE', step_type: 'tool', tool_name: 'read_file', tool_info: { parameters: { Path: 'x' }, output: FULL } } });
  f.ev({ event: 'step_update', step_update: { step_index: 5, state: 'DONE', step_type: 'agent_response', text_delta: 'The old error file says: ' + FULL, usage: {} } });
  await f.wait();
  const st = f.runner.status();
  assert.equal(st.status, 'running'); assert.equal(st.quota, null);
  f.runner.stop(); await f.wait(); f.done();
});

test('the image-generator answer, an error event and stderr with the real 429 text stop the run with the reset time', async () => {
  for (const how of ['subagent', 'error', 'stderr']) {
    const f = fake();
    if (how === 'subagent') f.ev({ event: 'step_update', step_update: { step_index: 3, state: 'DONE', step_type: 'subagent', tool_name: 'invoke_subagent', subagent_info: { subagents: [{ type_name: 'image-generator' }] }, tool_info: { output: FULL } } });
    else if (how === 'error') f.ev({ event: 'result', result: { status: 'ERROR', error: FULL, response: '' } });
    else f.err(FULL.replace('capacity', 'capacity.\n').replace('Your quota', 'Your quota'));
    await f.wait();
    const st = f.runner.status();
    assert.equal(st.status, 'failed', how); assert.ok(st.quota && st.quota.at, how + ': reset time'); assert.match(st.error, /hồi lúc \d\d:\d\d/, how);
    f.done();
  }
});

test('quota regex: needs a real 429 signal AND a detail; stored errors are cut to a short label', () => {
  assert.equal(agyQuota('Image saved. 429 ms to generate'), null);
  assert.equal(agyQuota('see RESOURCE_EXHAUSTED in the docs'), null);
  assert.ok(agyQuota(FULL).at);
  const short = shortQuota('item 7: ' + FULL);
  assert.match(short, /\[CAUSE:QUOTA reset after 3h27m\]/); assert.equal(agyQuota(short), null);
  assert.equal(JSON.stringify(scrubQuota({ problems: ['a', FULL] })).includes('RESOURCE_EXHAUSTED'), false);
});
