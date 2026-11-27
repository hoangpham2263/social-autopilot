// Captions in parallel with the images (src/caption-pump.mjs + scripts/caption-worker.mjs): fixtures + a FAKE caption CLI
// (tests/fake-caption-cli.mjs) and a simulated image agent that registers images one by one. No Flow, no Chrome, no AI, no live app.
// Run alone: node --test tests/caption-workers.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fakeCli = path.join(root, 'tests', 'fake-caption-cli.mjs');
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-capw-'));
process.env.SA_WORKSPACE = ws; // before the tool modules load (lib.mjs reads it once)
const { createCaptionPump, captionChoice } = await import('../src/caption-pump.mjs');
const { needsCaptions, staleCaptions } = await import('../scripts/caption-worker.mjs');
const { findDraft } = await import('../scripts/lib.mjs');
const { progressOf } = await import('../src/run-progress.mjs');
const { createAgentRunner, CAPTION_NOTE } = await import('../core/setup/agent-run.mjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const png = () => { const b = Buffer.alloc(3000); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(64, 16); b.writeUInt32BE(64, 20); return b; };
const brandDir = path.join(ws, 'brand-demo');
fs.mkdirSync(path.join(brandDir, 'project'), { recursive: true });
fs.writeFileSync(path.join(brandDir, 'project', 'project.md'), '# Demo\n- Website: https://demo.test\n- Hashtag cố định: #DemoShop\n');
function makeDraft(id, sign) {
  const dir = path.join(ws, 'drafts', 'demo', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'draft.json'), JSON.stringify({ id, brand: 'demo', brand_dir: brandDir, image_count: 2, sign_text: sign, sign_mode: 'scene', idea: { hook: 'h' }, inspiration: {}, networks: [], captions: { en: 'content-en.txt', vi: 'content-vi.txt' } }));
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify({ status: 'needs_caption' }));
  fs.writeFileSync(path.join(dir, 'brief.md'), '# Brief caption: demo\n');
  return dir;
}
const calls = (dir) => (fs.existsSync(path.join(dir, 'calls.jsonl')) ? fs.readFileSync(path.join(dir, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

test('captions start as soon as a cover image exists, run while the images go on (2 threads, Flow not counted), retry, resume-safe, run ends with every caption', async () => {
  const pipe = 'p1', run = 'r1', ids = ['demo-20261127-01', 'demo-20261127-02', 'demo-20261127-03', 'demo-20261127-04'];
  const dirs = ids.map((id, k) => makeDraft(id, ['Mia & Jake', 'Ann & Bo', 'Cy & Di', 'Ed & Flo'][k]));
  // Resume case: post 02 already has its captions from the earlier run: never rewritten, no CLI call for it.
  for (const l of ['en', 'vi']) fs.writeFileSync(path.join(dirs[1], `content-${l}.txt`), `kept ${l} "Ann & Bo"\n🌐 Website: https://demo.test\n#DemoShop\n`);
  fs.mkdirSync(path.join(ws, 'pipeline', pipe), { recursive: true });
  fs.writeFileSync(path.join(ws, 'pipeline', pipe, 'create.json'), JSON.stringify({ drafts: ids, stage: 'images', image_engine: 'flow', run_started: new Date().toISOString(), scope: ['demo'], agent: 'Claude Code', redos: {} }));
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-capcli-'));
  const started = new Date(Date.now() - 1000).toISOString();
  const notes = [];
  const state = { active: true, mode: 'create', status: 'running', caption_workers: true, caption_threads: 2, threads: 1, flow: true, pipe_id: pipe, run_id: run, started };
  const agentRun = { status: () => ({ ...state }), note: (t) => notes.push(t) };
  const env = { ...process.env, SA_CAPTION_WAITS: '50', FAKE_CAPTION_DIR: logDir, FAKE_CAPTION_DELAY_MS: '1500', FAKE_CAPTION_FLAKY: ids[2], FAKE_CAPTION_BADFIRST: ids[3] };
  const pump = createCaptionPump({ agentRun, toolRoot: root, workspace: ws, getSettings: () => ({ agent: { create: 'claude', claude_model: 'claude-haiku-4-5' } }), findCli: () => ({ found: true, path: fakeCli }), findAgy: () => ({ found: false }), env });
  const tickFor = async (ms) => { const end = Date.now() + ms; while (Date.now() < end) { pump.tick(); await sleep(60); } };

  // Nothing before a cover image exists.
  await tickFor(300);
  assert.equal(calls(logDir).length, 0, 'no caption before image 1 is registered');
  // The image agent: one image at a time (cover, then the extra) for each post, ~0.3 s per image (captions take 1.5 s: they overlap).
  const imageAt = {}, seenDuring = [];
  for (const [k, id] of ids.entries()) {
    for (const f of ['image.png', 'image-02.png']) {
      fs.writeFileSync(path.join(dirs[k], f), png()); if (f === 'image.png') imageAt[id] = Date.now();
      await tickFor(300);
      const p = progressOf(state, ['demo']);
      seenDuring.push(p.label);
    }
  }
  const imagesDoneAt = Date.now();
  const midLabels = seenDuring.slice(0, -1).filter((l) => !/Caption 0\//.test(l));
  assert.ok(midLabels.length, 'Caption x/N rises while images are still being made: ' + seenDuring.join(' | '));
  // Let the last workers finish (the agent is still active at Stage C, waiting for them).
  const end = Date.now() + 20000;
  while ((pump.busy() || ids.some((id) => needsCaptions(findDraft(id)))) && Date.now() < end) { pump.tick(); await sleep(60); }
  const c = calls(logDir);
  assert.ok(ids.every((id) => !needsCaptions(findDraft(id))), 'every caption written');
  for (const id of [ids[0], ids[2], ids[3]]) assert.ok(c.filter((x) => x.id === id).every((x) => x.start >= imageAt[id]), `${id}: started only after its cover`);
  const firstDone = Math.min(...c.filter((x) => x.behavior === 'ok').map((x) => x.end));
  assert.ok(firstDone < imagesDoneAt, 'the first caption was done before the last image');
  assert.equal(c.filter((x) => x.id === ids[1]).length, 0, 'resume: the post that already had captions is not written again');
  assert.match(fs.readFileSync(path.join(dirs[1], 'content-en.txt'), 'utf8'), /^kept en/);
  assert.equal(c.filter((x) => x.id === ids[2]).length, 2, 'a dropped connection is retried');
  const bad = c.filter((x) => x.id === ids[3]);
  assert.equal(bad.length, 2); assert.equal(bad[1].repair, true, 'an answer that breaks a rule is asked again naming the problem');
  assert.match(fs.readFileSync(path.join(dirs[3], 'content-en.txt'), 'utf8'), /"Ed & Flo"[\s\S]*#DemoShop\s*$/);
  assert.ok(c.every((x) => x.model === 'claude-haiku-4-5' && !x.agy), 'backend + model of the Create agent setting');
  // At most 2 CLI calls at the same time (Run tab Threads 2), never 1 because of Flow.
  const peak = Math.max(...c.map((x) => c.filter((y) => y.start <= x.start && y.end > x.start).length)); // calls running at each call start
  assert.ok(peak <= 2, 'peak ' + peak); assert.equal(peak, 2, 'two workers ran together');
  assert.ok(notes.some((n) => /song song với tạo ảnh, 2 luồng/.test(n)) && notes.some((n) => /caption xong/.test(n)));
  for (const d of dirs) assert.ok(!fs.existsSync(path.join(d, 'caption-claim.json')) && !fs.existsSync(path.join(d, 'captions.lock')), 'claims and locks released');
  // The run's progress is complete -> the app counts the run as done (not "unfinished").
  const p = progressOf(state, ['demo']);
  assert.match(p.label, /Caption 4\/4 · Ảnh 8\/8/); assert.equal(p.done, p.total);
  // Stage C (the agent, app run): no wait, captions prefilled, nothing failed.
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'pipeline.mjs'), 'create', '--resume', '--caption-wait-minutes', '0.05'], { encoding: 'utf8', cwd: root, env: { ...process.env, SA_WORKSPACE: ws, SA_PIPE_ID: pipe, SA_CAPTION_WORKERS: '1' } });
  const out = JSON.parse(r.stdout);
  assert.equal(out.stage, 'C done', r.stdout.slice(0, 400)); assert.equal(out.captions_by_app, true); assert.deepEqual(out.captions_failed, []);
  assert.match(out.next.join(' '), /do NOT change them/);
  const todo = JSON.parse(fs.readFileSync(path.join(ws, 'pipeline', pipe, 'captions-todo.json'), 'utf8'));
  for (const id of ids) for (const l of ['en', 'vi']) assert.ok(todo.drafts[id].captions[l].trim(), `${id} ${l} prefilled`);
  // A redo with a new sign wording makes the worker-written set stale (written again); the kept set (not a worker's) is not.
  const dj = path.join(dirs[0], 'draft.json'), d0 = JSON.parse(fs.readFileSync(dj, 'utf8'));
  fs.writeFileSync(dj, JSON.stringify({ ...d0, sign_text: 'Mia & Leo' }));
  assert.equal(staleCaptions(findDraft(ids[0])), true); assert.equal(needsCaptions(findDraft(ids[0])), true);
  assert.equal(staleCaptions(findDraft(ids[1])), false);
  // The person stops the run: no new worker starts.
  state.active = false; state.status = 'stopped';
  const n = calls(logDir).length; await tickFor(400); assert.equal(calls(logDir).length, n);
  fs.rmSync(logDir, { recursive: true, force: true });
});

test('quota / login of the caption CLI stops the workers for the run; Stage C hands those posts to the agent at once', async () => {
  const pipe = 'p2', id = 'demo-20261127-11', dir = makeDraft(id, 'Zoe & Al');
  fs.writeFileSync(path.join(dir, 'image.png'), png()); fs.writeFileSync(path.join(dir, 'image-02.png'), png());
  fs.mkdirSync(path.join(ws, 'pipeline', pipe), { recursive: true });
  fs.writeFileSync(path.join(ws, 'pipeline', pipe, 'create.json'), JSON.stringify({ drafts: [id], stage: 'images', image_engine: 'flow', run_started: new Date().toISOString(), scope: ['demo'], redos: {} }));
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-capcli-'));
  const state = { active: true, mode: 'create', status: 'running', caption_workers: true, caption_threads: 3, pipe_id: pipe, run_id: 'r2', started: new Date().toISOString() };
  const pump = createCaptionPump({ agentRun: { status: () => state, note: () => {} }, toolRoot: root, workspace: ws, getSettings: () => ({ agent: { create: 'antigravity' } }), findCli: () => ({ found: false }), findAgy: () => ({ found: true, path: fakeCli }), env: { ...process.env, FAKE_CAPTION_DIR: logDir, FAKE_CAPTION_QUOTA: '1', SA_CAPTION_WAITS: '20' } });
  const end = Date.now() + 10000;
  while (!pump.status().fatal && Date.now() < end) { pump.tick(); await sleep(50); }
  assert.equal(pump.status().fatal, 'QUOTA');
  assert.equal(calls(logDir).length, 1, 'no retry on a quota answer');
  assert.equal(calls(logDir)[0].agy, true); assert.equal(calls(logDir)[0].model, 'gemini-3.8-flash-medium', 'Antigravity without a chosen model: its fast default for light steps');
  assert.deepEqual(captionChoice({ agent: { create: 'antigravity', agy_model: 'gemini-4-neon-high' } }), { backend: 'antigravity', model: 'gemini-4-neon-high', effort: '' });
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'pipeline.mjs'), 'create', '--resume'], { encoding: 'utf8', cwd: root, env: { ...process.env, SA_WORKSPACE: ws, SA_PIPE_ID: pipe, SA_CAPTION_WORKERS: '1' } });
  const out = JSON.parse(r.stdout);
  assert.ok(Date.now() - t0 < 15000, 'no long wait'); assert.deepEqual(out.captions_failed, [id]); assert.match(out.next.join(' '), /ONLY for captions_failed/);
  fs.rmSync(logDir, { recursive: true, force: true });
});

test('agent run: Create sets the caption workers (Run tab Threads, not cut by Flow) and tells the agent not to write captions', async () => {
  const w = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-capagent-')), outFile = path.join(w, 'fake-out.json');
  process.env.FAKE_CLAUDE_OUT = outFile;
  const runner = createAgentRunner({ toolRoot: w, workspace: w, getSettings: () => ({ image_engine: 'flow', research: { chrome_profile: 'Profile 1' } }), plat: 'win32', findCli: () => ({ found: true, path: path.join(root, 'tests', 'fake-claude.mjs') }), npxOk: () => true, graceMs: 50, spawnFn: (cmd, args, opts) => spawn(process.execPath, [cmd, ...args], opts), killTree: (c) => c.kill('SIGKILL') });
  const r = runner.start({ mode: 'create', prompt: 'TASK: Create & publish - brand: demo\n' + 'Make posts. '.repeat(30), threads: 3 });
  if (!r.ok) { console.log('agent start refused:', r.error); assert.match(r.error, /Chrome|profile|extension/i); return; } // the Flow extension check may refuse on a machine without the profile; the rest is covered above
  const st = runner.status();
  assert.equal(st.threads, 1, 'the Flow agent stays one'); assert.equal(st.caption_threads, 3); assert.equal(st.caption_workers, true);
  const end = Date.now() + 8000; while (runner.isActive() && Date.now() < end) await sleep(25);
  assert.ok(JSON.parse(fs.readFileSync(outFile, 'utf8')).stdin.includes(CAPTION_NOTE.trim()));
  assert.equal(JSON.parse(fs.readFileSync(path.join(w, 'runs', fs.readdirSync(path.join(w, 'runs')).find((n) => /-input\.json$/.test(n))), 'utf8')).caption_threads, 3);
  fs.rmSync(w, { recursive: true, force: true });
});

test.after(() => { try { fs.rmSync(ws, { recursive: true, force: true }); } catch {} });
