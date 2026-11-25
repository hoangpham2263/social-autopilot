// A dropped Antigravity connection ("the connection to the agent was interrupted ... subscriber fell behind updates") is transient: the SAME run starts again by itself
// (backoff, at most 5 in a row, count reset by progress), status stays running while it waits, the per-run MCP server is added and removed for every launch, a Stop never
// relaunches. Quota text is never transient. Fake agy process, no real run.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

process.env.SA_NET_WAITS = '40';
const { createAgentRunner, isTransientAgyError } = await import('../core/setup/agent-run.mjs');
const DROP = 'the connection to the agent was interrupted before the response finished: conversation update stream lost: subscriber fell behind updates, stalled for 10s';
const QUOTA = 'HTTP 429 RESOURCE_EXHAUSTED: You have exhausted your capacity on this model. Your quota will reset after 3h27m. connection reset';
const PROMPT = 'TASK: transient fixture. ' + 'x'.repeat(220);

test('what counts as transient', () => {
  assert.equal(isTransientAgyError(DROP), true);
  assert.equal(isTransientAgyError('read ECONNRESET'), true);
  assert.equal(isTransientAgyError(QUOTA), false);
  assert.equal(isTransientAgyError('Please sign in'), false);
});

// outcomes[i] = what launch i does: 'ok' | an error text through the result event | 'stderr:<text>' (dies with only stderr) ; steps = events before the end (progress)
function setup(outcomes, { steps = 8, mode = 'create', hold = false } = {}) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-net-'));
  let spawns = 0; const calls = []; const kids = [];
  const spawnFn = () => {
    const kid = new EventEmitter(); kid.stdout = new PassThrough(); kid.stderr = new PassThrough(); kid.stdin = new PassThrough(); kid.pid = ++spawns; kids.push(kid);
    const o = outcomes[Math.min(spawns - 1, outcomes.length - 1)];
    if (hold && spawns === 1) return kid; // never ends by itself
    setTimeout(() => {
      for (let i = 1; i <= steps; i++) kid.stdout.write(JSON.stringify({ event: 'step_update', step_update: { step_index: i, state: 'DONE', step_type: 'tool', tool_name: 'run_command', tool_info: { parameters: { CommandLine: 'echo' }, output: 'x' } } }) + '\n');
      if (o.startsWith('stderr:')) { kid.stderr.write(o.slice(7) + '\n'); setTimeout(() => kid.emit('close', 1), 5); return; }
      kid.stdout.write(JSON.stringify({ event: 'result', result: o === 'ok' ? { status: 'SUCCESS', response: 'ok', num_turns: 1 } : { status: 'ERROR', error: o } }) + '\n');
      setTimeout(() => kid.emit('close', o === 'ok' ? 0 : 1), 5);
    }, 10);
    return kid;
  };
  const runner = createAgentRunner({
    toolRoot: process.cwd(), workspace: ws, graceMs: 10, npxOk: () => true, killTree: (c) => { c?.emit?.('close', null); },
    getSettings: () => ({ image_engine: 'codex', agent: { research: 'antigravity', create: 'antigravity' }, browser: { mode: 'own', headless: true, profile_dir: path.join(ws, 'prof') } }),
    findCli: () => ({ found: true, path: 'x' }), findAgy: () => ({ found: true, path: 'agy' }),
    agyExec: (f, a) => { calls.push(a.slice(0, 2).join(' ') + ' ' + (a[2] || '')); return { status: 0, stdout: 'NAME TYPE STATUS COMMAND\n', stderr: '' }; },
    spawnFn,
  });
  const r = runner.start({ mode, prompt: PROMPT, brands: [] });
  assert.equal(r.ok, true, r.error);
  return { runner, spawns: () => spawns, calls, kids, done: () => { runner.stop(); fs.rmSync(ws, { recursive: true, force: true }); } };
}
const until = async (f, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (f()) return true; await new Promise((r) => setTimeout(r, 15)); } return false; };

test('a dropped connection (error event) is relaunched: running while it waits, log kept, run completes', async () => {
  const f = setup([DROP, 'ok']);
  assert.ok(await until(() => /tự chạy lại/.test(f.runner.status().tail.join('\n'))));
  assert.equal(f.runner.status().status, 'running'); assert.equal(f.runner.status().active, true);
  assert.ok(await until(() => !f.runner.isActive()));
  const st = f.runner.status();
  assert.equal(st.status, 'done'); assert.equal(f.spawns(), 2);
  assert.ok(st.tail.some((l) => /Mất kết nối với Antigravity, tự chạy lại \(lần 1\/5/.test(l)));
  assert.ok(st.tail.some((l) => l.startsWith('start:')) || st.tail.length > 0);
  f.done();
});

test('a process that dies with only a transient stderr is relaunched too', async () => {
  const f = setup(['stderr:' + DROP, 'ok']);
  assert.ok(await until(() => !f.runner.isActive()));
  assert.equal(f.runner.status().status, 'done'); assert.equal(f.spawns(), 2);
  f.done();
});

test('quota text and ordinary failures are not relaunched', async () => {
  for (const o of [QUOTA, 'Something else went wrong']) {
    const f = setup([o]);
    assert.ok(await until(() => !f.runner.isActive()));
    assert.equal(f.runner.status().status, 'failed'); assert.equal(f.spawns(), 1);
    f.done();
  }
});

test('retries are bounded (5 in a row) and the run then fails with its original error', async () => {
  const f = setup([DROP], { steps: 0 }); // no progress in any launch
  assert.ok(await until(() => !f.runner.isActive(), 6000));
  const st = f.runner.status();
  assert.equal(st.status, 'failed'); assert.equal(f.spawns(), 6); assert.match(st.error, /connection to the agent was interrupted/);
  f.done();
});

test('progress resets the count: more than 5 drops with progress in between still go on', async () => {
  const f = setup([DROP, DROP, DROP, DROP, DROP, DROP, 'ok'], { steps: 8 });
  assert.ok(await until(() => !f.runner.isActive(), 8000));
  assert.equal(f.runner.status().status, 'done'); assert.equal(f.spawns(), 7);
  f.done();
});

test('a Stop never relaunches (during the run and while waiting) and the MCP server is added and removed per launch', async () => {
  const w = setup([DROP], { steps: 0, mode: 'research' });
  assert.ok(await until(() => f0(w)));
  function f0(x) { return /tự chạy lại/.test(x.runner.status().tail.join('\n')); }
  w.runner.stop(); // while waiting for the relaunch
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(w.runner.status().status, 'stopped'); assert.equal(w.spawns(), 1);
  const adds = w.calls.filter((c) => c.startsWith('mcp add')).length, removes = w.calls.filter((c) => c.startsWith('mcp remove')).length;
  assert.equal(adds, 1); assert.ok(removes >= 1, 'the server of the dropped launch was removed');
  w.done();
  const m = setup([DROP, 'ok'], { steps: 0, mode: 'research' });
  assert.ok(await until(() => !m.runner.isActive()));
  const a2 = m.calls.filter((c) => c.startsWith('mcp add')).length, r2 = m.calls.filter((c) => c.startsWith('mcp remove')).length;
  assert.equal(a2, 2); assert.ok(r2 >= 2, 'one server per launch, each removed (no leak, no duplicate)');
  m.done();
});
