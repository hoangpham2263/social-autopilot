// Flow speed + run progress (fixtures only: no Flow, no Chrome, no agent, no live app). Run alone: node --test tests/flow-speed.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildFlowSnippets, writeFlowSnippets, flowSpeedOn } from '../scripts/flow-snippets.mjs';
import { requiredWaitMs } from '../scripts/flow-pace.mjs';
import { toolLabel, friendlyTool, sanitize } from '../core/setup/agent-run.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pace = path.join(root, 'scripts', 'flow-pace.mjs');
const png = (w, h) => { const b = Buffer.alloc(3000); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };

test('snippets compile, carry the ONE upload and the prompt, and never pace or submit in prep', () => {
  const s = buildFlowSnippets({ upload: 'C:/t/workspace/tmp/run-x/flow/sa-ref-x-dv-01-1.png', prompt: 'a "quoted" prompt\nline 2' });
  assert.deepEqual(Object.keys(s), ['ready', 'prep', 'submit', 'collect']);
  for (const [k, code] of Object.entries(s)) {
    assert.equal(typeof new Function('return (' + code + ')')(), 'function', k);
    assert.match(code, /bringToFront/); assert.doesNotMatch(code, /waitForFunction|mouse\.click|flow-pace\.mjs gate|for \(const item/);
  }
  assert.match(s.prep, /sa-ref-x-dv-01-1\.png/); assert.match(s.prep, /a \\"quoted\\" prompt\\nline 2/); assert.ok(s.prep.includes('/Nano Banana 2\\.1/.test(chip) || /Pro/'), 'Nano Banana 2.1 only, never Pro');
  assert.doesNotMatch(s.prep, /press\('Enter'\)/, 'prep never submits');
  assert.match(s.submit, /press\('Enter'\)/);
  assert.doesNotMatch(s.collect, /saveAs/, 'extension mode: the file is taken from Downloads');
  assert.match(buildFlowSnippets({ upload: 'a/sa-ref-1.png', prompt: 'p', own: true, saveAs: 'C:/d/sa-flow-x.jpg' }).collect, /saveAs/);
  assert.throws(() => buildFlowSnippets({ prompt: 'x' }));
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'snip-')), r = writeFlowSnippets({ upload: 'x/sa-ref-1.png', prompt: 'p' }, d, 'dv-01-2');
  for (const p of Object.values(r)) assert.ok(fs.existsSync(p)); assert.ok(fs.existsSync(path.join(d, 'dv-01-2-flow-collect.js'))); fs.rmSync(d, { recursive: true, force: true });
  assert.equal(flowSpeedOn({ SA_RUN_ID: 'old-run' }), false, 'a run of the old app process keeps the old flow');
  assert.equal(flowSpeedOn({ SA_RUN_ID: 'r', SA_FLOW_SPEED: '1' }), true); assert.equal(flowSpeedOn({}), true);
});

test('download-collect moves the new image (not the reference copies), names it <draft>-<n>, validates it and releases the shared lock', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-')), dl = path.join(base, 'Downloads'), dest = path.join(base, 'out'), lock = path.join(base, 'dl.lock');
  fs.mkdirSync(dl);
  for (const n of ['sa-ref-r1-dv-01-1.png', 'pr-ref-005-x-1.png']) fs.writeFileSync(path.join(dl, n), png(10, 10));
  fs.writeFileSync(path.join(dl, 'old.png'), png(5, 5)); fs.utimesSync(path.join(dl, 'old.png'), new Date(Date.now() - 3600e3), new Date(Date.now() - 3600e3));
  fs.writeFileSync(path.join(dl, 'Flow project_ab12cd34.png'), png(1024, 1024));
  const env = { ...process.env, PR_FLOW_DOWNLOAD_LOCK: lock, SA_DOWNLOADS_DIR: dl };
  const acq = JSON.parse(execFileSync('node', [pace, 'download-lock', 'acquire', '--tag', 'dv-01#1'], { env, encoding: 'utf8' }).trim());
  assert.equal(acq.ok, true); assert.ok(fs.existsSync(lock));
  const r = JSON.parse(execFileSync('node', [pace, 'download-collect', '--tag', 'dv-01#1', '--dest', dest, '--wait-s', '5'], { env, encoding: 'utf8' }).trim());
  assert.equal(r.ok, true); assert.equal(r.width, 1024); assert.equal(path.basename(r.path), 'dv-01-1.png');
  assert.match(r.next, /register-image --id dv-01 --n 1 --from/);
  assert.ok(!fs.existsSync(path.join(dl, 'Flow project_ab12cd34.png'))); assert.ok(fs.existsSync(path.join(dl, 'sa-ref-r1-dv-01-1.png'))); assert.ok(!fs.existsSync(lock), 'lock released');
  fs.writeFileSync(lock, JSON.stringify({ tag: 'dv-02#1' }));
  const miss = JSON.parse(execFileSync('node', [pace, 'download-collect', '--tag', 'dv-02#1', '--dest', dest, '--wait-s', '3'], { env, encoding: 'utf8' }).trim());
  assert.equal(miss.ok, false); assert.equal(miss.cause, 'NO_DOWNLOAD'); assert.ok(!fs.existsSync(lock), 'released even without a file');
  fs.rmSync(base, { recursive: true, force: true });
});

test('the pace gate is unchanged: 5-12 s inside a group, 20-45 s after a group, max 8 per 2 minutes', () => {
  const now = Date.now();
  for (let i = 0; i < 30; i++) {
    const a = requiredWaitMs({ times: [now], in_group: 1, group_size: 3 }, now), b = requiredWaitMs({ times: [now], in_group: 3, group_size: 3 }, now);
    assert.ok(a >= 5000 && a <= 12000); assert.ok(b >= 20000 && b <= 45000);
  }
  assert.ok(requiredWaitMs({ times: Array.from({ length: 8 }, (_, i) => now - 110000 + i * 1000), in_group: 1, group_size: 3 }, now) >= 10000);
});

test('tool names in the details are readable, never [hidden]; snippet and download steps have friendly words', () => {
  const l = sanitize('tool: ' + toolLabel('mcp__playwright__browser_run_code_unsafe', { filename: 'C:/w/tmp/run-x/flow/dreamyvows-20261125-03-2-flow-prep.js' }));
  assert.doesNotMatch(l, /\[hidden\]/); assert.match(l, /browser_run_code_unsafe · Bài dreamyvows-20261125-03 · ảnh 2 · Flow: tải ảnh tham chiếu/);
  assert.doesNotMatch(sanitize('tool: ' + toolLabel('mcp__claude_ai_Metricool_Social_Media_Management__getBrandSettings', {})), /\[hidden\]/);
  assert.equal(friendlyTool('Bash', { command: 'node scripts/flow-pace.mjs download-collect --tag dv-01#3' }), 'Bài dv-01 · ảnh 3 · Lấy ảnh vừa tải về');
  assert.equal(toolLabel('Read', {}), 'Read · Đang đọc tài liệu');
});

test('run progress: per-post rows, current item, time left from the images of THIS run, resumed run (own pipeline folder)', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-prog-'));
  process.env.SA_WORKSPACE = ws;
  const { progressOf } = await import('../src/run-progress.mjs?ws=' + encodeURIComponent(ws));
  const pipe = 'p-1', started = new Date(Date.now() - 20 * 60000).toISOString();
  fs.mkdirSync(path.join(ws, 'pipeline', pipe), { recursive: true });
  const ids = ['b-01', 'b-02', 'b-03'];
  fs.writeFileSync(path.join(ws, 'pipeline', pipe, 'create.json'), JSON.stringify({ drafts: ids, stage: 'images' }));
  const old = new Date(Date.now() - 2 * 86400000);
  fs.utimesSync(path.join(ws, 'pipeline', pipe, 'create.json'), old, old); // a resumed run: the state file is older than this start
  const mk = (id, count, imgs, caption, status = 'needs_caption') => {
    const d = path.join(ws, 'drafts', 'b', id); fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'draft.json'), JSON.stringify({ id, brand: 'b', image_count: count, captions: caption ? { facebook: 'cap.txt' } : {} }));
    fs.writeFileSync(path.join(d, 'status.json'), JSON.stringify({ status }));
    if (caption) fs.writeFileSync(path.join(d, 'cap.txt'), 'x');
    imgs.forEach(([f, minAgo]) => { fs.writeFileSync(path.join(d, f), 'x'); const t = new Date(Date.now() - minAgo * 60000); fs.utimesSync(path.join(d, f), t, t); });
  };
  mk('b-01', 2, [['image.png', 60 * 24], ['image-02.png', 15]], true); // cover from an earlier run, extra from this one
  mk('b-02', 3, [['image.png', 10], ['image-02.png', 5]], false);
  mk('b-03', 1, [], false, 'image_failed');
  const st = { mode: 'create', active: true, started, pipe_id: pipe, friendly: [{ text: 'Bài b-02 · ảnh 3 · Chờ nhịp rồi gửi prompt Flow' }] };
  const p = progressOf(st);
  assert.ok(p, 'a resumed run counts from its own pipeline folder');
  assert.match(p.label, /Ảnh 4\/6/);
  assert.deepEqual(p.posts.map((x) => [x.id, x.images, x.total, x.caption, x.state]), [['b-01', 2, 2, true, 'done'], ['b-02', 2, 3, false, 'partial'], ['b-03', 0, 1, false, 'failed']]);
  assert.equal(p.images_run, 3, 'the cover of an earlier run is not part of this run\'s pace');
  assert.equal(p.eta_min, 13, '20 min / 3 images x 2 missing');
  assert.equal(p.current, 'Bài b-02 · ảnh 3 · Chờ nhịp rồi gửi prompt Flow');
  assert.equal(progressOf({ ...st, friendly: [] }).current, 'Bài b-02 · ảnh 3');
  assert.equal(progressOf({ ...st, active: false }).eta_min, 0);
  delete process.env.SA_WORKSPACE;
  fs.rmSync(ws, { recursive: true, force: true });
});
