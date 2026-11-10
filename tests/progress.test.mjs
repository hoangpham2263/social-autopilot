// Run progress (scripts/progress.mjs) for the Prompt tab: one small file per mode, workspace/runs/current-<mode>.json.
// The fixed steps match the prompts' numbered steps; the step scripts move it through lib.mjs out()/fail(); Setup
// (brands.mjs --run) takes over the pending run of Copy prompt; runlog.mjs add ends it. Temp dirs only.
// npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-progress-test-'));
const skills = path.join(tmp, 'skills'), ws = path.join(tmp, 'workspace'), brandDir = path.join(skills, 'pb-skills');
const env = { ...process.env, SA_WORKSPACE: ws, SA_SKILLS_ROOT: skills, SA_PROGRESS: '' };
const write = (f, x) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof x === 'string' ? x : JSON.stringify(x)); };
const run = (script, ...args) => { const r = spawnSync(process.execPath, [path.join(tool, 'scripts', script), ...args], { env, encoding: 'utf8', windowsHide: true }); try { return JSON.parse(r.stdout); } catch { throw new Error(r.stdout + r.stderr); } };
const states = (r) => r.steps.map((s) => s.state).join(' ');

write(path.join(brandDir, 'SKILL.md'), '# pb');
write(path.join(brandDir, 'project', 'project.md'), '# pb');
write(path.join(brandDir, 'project', 'social.json'), { brand: 'PB', enabled: true, channels: [{ network: 'facebook', enabled: true, lang: ['en'] }], cadence: { timezone: 'America/New_York' }, research: { sources: [{ id: 'a', name: 'A', url: 'https://x.test/a', enabled: true }] } });
write(path.join(brandDir, 'scripts', 'check-skill.mjs'), "console.log('ok')");

// The module reads SA_WORKSPACE when it loads.
process.env.SA_WORKSPACE = ws; process.env.SA_SKILLS_ROOT = skills; delete process.env.SA_PROGRESS;
const P = await import('../scripts/progress.mjs');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('the fixed steps of each mode match the numbered steps of its prompts', async () => {
  const { promptList } = await import('../scripts/prompts.mjs');
  const name = { research: 'Research only', create: 'Create & publish', publish: 'Publish approved' };
  for (const mode of P.MODES) for (const p of promptList().filter((x) => x.mode === name[mode] && x.agent !== 'ChatGPT')) {
    const numbered = p.text.split('\n').filter((l) => /^\d+\. /.test(l));
    assert.equal(P.STEPS[mode].length, numbered.length, `${mode} · ${p.agent}`);
    assert.match(numbered[0], new RegExp(`brands\\.mjs --run ${mode}`), 'Setup opens the run');
    assert.match(numbered.at(-2), /runlog\.mjs add/);
  }
});

test('a run: steps move forward, the current one closes the earlier one, items add up per brand, the log ends it', () => {
  const r0 = P.newRun('create', { brands: ['a', 'b'] });
  assert.equal(states(r0), 'pending pending pending pending pending pending pending pending');
  assert.equal(P.isActive(r0), true);
  P.track('setup', { mode: 'create' });
  P.track('sync', { detail: 'synced' }); // mode found from the active run that has this step
  let r = P.readRun('create');
  assert.equal(states(r), 'done running pending pending pending pending pending pending');
  assert.equal(r.detail, 'synced');
  // Skipped steps stay pending; a parallel brand's earlier step never moves the run back.
  P.track('make', { brand: 'a', detail: 'image 1', items: { label: 'Images', done: 1, total: 3 } });
  P.track('make', { brand: 'b', items: { label: 'Images', done: 2, total: 2 } });
  P.track('schedule', { brand: 'b', detail: 'late brand' });
  r = P.readRun('create');
  assert.equal(states(r), 'done done pending pending running pending pending pending');
  assert.deepEqual(r.items, { label: 'Images', done: 3, total: 5 });
  assert.equal(r.detail, 'b: late brand');
  assert.deepEqual(r.brands, ['a', 'b']);
  // A failed step, then the log with a reason: running steps "stopped", the run finished.
  P.track('make', { brand: 'a', state: 'failed', detail: 'quota' });
  assert.equal(P.readRun('create').steps[4].state, 'failed');
  P.finishRun('create', { reason: 'codex quota', logId: '20261110-120000-create' });
  r = P.readRun('create');
  assert.equal(r.result, 'stopped');
  assert.equal(states(r), 'done done pending pending failed pending done done');
  assert.equal(P.isActive(r), false);
  assert.ok(r.finished);
  // Nothing active: a create step reports nowhere (no run is guessed).
  assert.equal(P.track('make', { detail: 'x' }), null);
  assert.equal(fs.readdirSync(path.join(ws, 'runs')).filter((f) => f.endsWith('.tmp')).length, 0, 'atomic writes leave no temp file');
});

test('research does its brands one after another: the next brand starts its steps over; a stale run is not active', () => {
  assert.equal(P.track('chrome', { state: 'done', start: true }).mode, 'research'); // no Copy: the first Research step opens a run
  for (const k of ['start', 'crawl', 'filter', 'report']) P.track(k, { brand: 'a', state: k === 'start' || k === 'report' ? 'done' : 'running' });
  P.track('start', { brand: 'b', state: 'done' });
  P.track('crawl', { brand: 'b' });
  const r = P.readRun('research');
  assert.equal(states(r), 'pending done done running pending pending pending pending');
  assert.equal(P.isActive(r, Date.parse(r.updated) + P.STALE_MS + 1000), false);
  assert.equal(P.progressView('research', Date.parse(r.updated) + P.STALE_MS + 1000).stale, true);
  assert.throws(() => P.newRun('nope'), /mode must be/);
});

test('the scripts move it: brands.mjs --run takes the pending run, queue.mjs reports, runlog.mjs add finishes; SA_PROGRESS=off writes nothing', () => {
  const copied = P.newRun('publish', { brands: [] }); // the app's Copy prompt
  assert.equal(run('brands.mjs', '--run', 'publish').ok, true);
  let r = P.readRun('publish');
  assert.equal(r.run_id, copied.run_id, 'the pending run of Copy prompt is taken over');
  assert.deepEqual(r.brands, ['pb']);
  assert.equal(states(r), 'running pending pending pending pending pending');
  // A per-brand sub-agent's Setup joins the same run and never moves it back.
  run('queue.mjs');
  assert.equal(run('brands.mjs', '--run', 'publish').ok, true);
  r = P.readRun('publish');
  assert.equal(r.run_id, copied.run_id);
  assert.equal(states(r), 'done pending pending done pending pending');
  // A failing step script marks its step failed.
  assert.equal(run('metricool-mcp.mjs', 'status', '--brand', 'nobody').ok, false);
  assert.equal(P.readRun('publish').steps[3].state, 'failed');
  assert.match(P.readRun('publish').steps[3].detail, /metricool-mcp status/);
  assert.equal(run('runlog.mjs', 'add', '--mode', 'publish', '--agent', 'Codex').ok, true);
  r = P.readRun('publish');
  assert.equal(r.result, 'done');
  assert.match(r.log_id, /-publish$/);
  assert.equal(r.steps.at(-1).state, 'done');
  // Off: a script run changes nothing.
  const before = fs.readFileSync(P.progressFile('publish'), 'utf8');
  P.newRun('create');
  const off = spawnSync(process.execPath, [path.join(tool, 'scripts', 'queue.mjs')], { env: { ...env, SA_PROGRESS: 'off' }, encoding: 'utf8', windowsHide: true });
  assert.equal(JSON.parse(off.stdout).ok, true);
  assert.equal(states(P.readRun('create')), 'pending pending pending pending pending pending pending pending');
  assert.equal(fs.readFileSync(P.progressFile('publish'), 'utf8'), before);
  // The CLI.
  assert.equal(run('progress.mjs', 'show', '--mode', 'create').steps.length, 8);
});
