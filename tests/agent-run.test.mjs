// Run now (core/setup/agent-run.mjs, core/setup/claude-cli.mjs) with a FAKE cli (tests/fake-claude.mjs): lock, validation,
// argv/stdin, sanitising, timeout, stop, MCP config, temp file, no secret in workspace files. Never runs a real claude.
// npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createAgentRunner, sanitize, mcpConfig, validate, ALLOWED_TOOLS, usesFlow, runEngine, limitsFor, addDirs, needsBrowser, MODELS, modelFlag, DEFAULT_MINUTES, DEFAULT_TURNS } from '../core/setup/agent-run.mjs';
import { classifyProblem, MESSAGES } from '../core/setup/agent-problems.mjs';
import { findClaude } from '../core/setup/claude-cli.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fake = path.join(here, 'fake-claude.mjs');
const PROMPT = 'TASK: Research only - brand: demo - agent: Claude Code\n' + 'Collect posts. '.repeat(30);
const wait = async (cond, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (cond()) return; await new Promise((r) => setTimeout(r, 25)); } throw new Error('timeout waiting'); };
const kills = [];
function setup(settings = {}, extra = {}) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-agent-'));
  const out = path.join(ws, 'fake-out.json');
  process.env.FAKE_CLAUDE_OUT = out;
  const runner = createAgentRunner({
    toolRoot: ws, workspace: ws, getSettings: () => ({ skillsRoot: path.join(ws, 'skills'), ...settings }), plat: 'win32',
    findCli: () => ({ found: true, path: fake }), npxOk: () => true, graceMs: 100,
    spawnFn: (cmd, args, opts) => spawn(process.execPath, [cmd, ...args], opts),
    killTree: (child) => { kills.push(child.pid); child.kill('SIGKILL'); }, ...extra,
  });
  return { ws, out, runner };
}
const done = (runner) => wait(() => !runner.isActive());
const recorded = (out) => JSON.parse(fs.readFileSync(out, 'utf8'));

test('prompt validation', () => {
  assert.match(validate({ mode: 'x', prompt: PROMPT }), /mode/);
  assert.match(validate({ mode: 'research', prompt: 5 }), /string/);
  assert.match(validate({ mode: 'research', prompt: 'TASK: short' }), /200/);
  assert.match(validate({ mode: 'research', prompt: 'x'.repeat(300) }), /TASK:/);
  assert.match(validate({ mode: 'research', prompt: 'TASK:' + 'x'.repeat(60001) }), /60000/);
  assert.equal(validate({ mode: 'create', prompt: PROMPT }), '');
});

test('argv has no prompt, stdin gets it, flags and per-mode tools', async () => {
  const { runner, out } = setup({ agent_run: { max_turns: 77 } });
  assert.equal(runner.start({ mode: 'research', prompt: PROMPT }).ok, true);
  await done(runner);
  const rec = recorded(out);
  // A research run started from the app gets the own-browser note in front of the exact prompt the Copy button gives.
  assert.ok(rec.stdin.endsWith(PROMPT), 'stdin ends with the unchanged prompt');
  const note = rec.stdin.slice(0, rec.stdin.length - PROMPT.length);
  assert.ok(note.startsWith('RUN-NOW NOTE'), 'the note comes first');
  assert.ok(note.includes('OWN browser') && !note.includes('Connect click'), 'the note is the own-browser note');
  assert.ok(!rec.args.some((a) => a.includes('TASK:')));
  for (const f of ['-p', '--verbose', '--strict-mcp-config', '--add-dir', '--mcp-config']) assert.ok(rec.args.includes(f), f);
  assert.equal(rec.args[rec.args.indexOf('--output-format') + 1], 'stream-json');
  assert.equal(rec.args[rec.args.indexOf('--permission-mode') + 1], 'default');
  assert.equal(rec.args[rec.args.indexOf('--max-turns') + 1], '77');
  assert.equal(rec.args[rec.args.indexOf('--allowedTools') + 1], ALLOWED_TOOLS.research.join(','));
  const { runner: r2, out: o2 } = setup();
  r2.start({ mode: 'create', prompt: PROMPT }); await done(r2);
  const c = recorded(o2).args;
  assert.ok(!c.includes('--strict-mcp-config'));
  assert.ok(!c[c.indexOf('--allowedTools') + 1].includes('createScheduledPost'));
  const { runner: r3, out: o3 } = setup();
  r3.start({ mode: 'publish', prompt: PROMPT }); await done(r3);
  const p = recorded(o3).args;
  const tools = p[p.indexOf('--allowedTools') + 1];
  for (const n of ['getBrandSettings', 'getBestTimeToPostByNetwork', 'createScheduledPost', 'getScheduledPosts']) assert.ok(tools.includes(n), n);
  assert.ok(!tools.includes('playwright'), 'publish never gets the browser');
  assert.ok(!p.includes('--mcp-config'), 'publish does not start the Playwright MCP');
});

test('model: allow-list validation, --model only when not default, state and status', async () => {
  assert.match(validate({ mode: 'research', prompt: PROMPT, model: 'gpt' }), /model/);
  assert.match(validate({ mode: 'research', prompt: PROMPT, model: 5 }), /model/);
  for (const m of [undefined, null, '', 'default', 'haiku', 'sonnet', 'opus']) assert.equal(validate({ mode: 'research', prompt: PROMPT, model: m }), '', String(m));
  assert.deepEqual(MODELS, ['default', 'haiku', 'sonnet', 'opus']);
  assert.equal(modelFlag('default'), '');
  assert.equal(modelFlag('sonnet'), 'sonnet');
  assert.equal(modelFlag('haiku', { agent_run: { model_map: { haiku: 'claude-haiku-5-5' } } }), 'claude-haiku-5-5');
  assert.equal(modelFlag('opus', { agent_run: { model_map: { opus: 'bad id; rm' } } }), 'opus');
  const { runner, out } = setup();
  const bad = runner.start({ mode: 'create', prompt: PROMPT, model: 'nope' });
  assert.equal(bad.ok, false); assert.equal(bad.status, 400);
  assert.equal(runner.start({ mode: 'create', prompt: PROMPT, model: 'sonnet' }).ok, true);
  await done(runner);
  const a = recorded(out).args;
  assert.equal(a[a.indexOf('--model') + 1], 'sonnet');
  assert.equal(runner.status().model, 'sonnet');
  const { runner: r2, out: o2 } = setup();
  r2.start({ mode: 'create', prompt: PROMPT, model: 'default' }); await done(r2);
  assert.ok(!recorded(o2).args.includes('--model'), 'default passes no flag');
  assert.equal(r2.status().model, 'default');
  const { runner: r3, out: o3 } = setup({ agent_run: { model_map: { opus: 'claude-opus-5-5' } } });
  r3.start({ mode: 'publish', prompt: PROMPT, model: 'opus' }); await done(r3);
  const p = recorded(o3).args;
  assert.equal(p[p.indexOf('--model') + 1], 'claude-opus-5-5');
});

test('model: UI select, per-mode memory, sent to the server, shown once in the status line', () => {
  const html = fs.readFileSync(path.join(here, '..', 'ui', 'index.html'), 'utf8');
  assert.match(html, /<select id="prModel">/);
  assert.match(html, /"prModel_" \+ mk/);
  assert.match(html, /"prModel_" \+ modeKey\(prMode\)/);
  assert.match(html, /model: \$\("#prModel"\)\.value/);
  assert.match(html, /r\.model && r\.model !== "default"/);
  assert.match(fs.readFileSync(path.join(here, '..', 'src', 'server.mjs'), 'utf8'), /model: b\.model/);
});

test('single-run lock answers busy, status shows tail', async () => {
  process.env.FAKE_CLAUDE_BEHAVIOR = 'sleep';
  const { runner } = setup();
  assert.equal(runner.start({ mode: 'research', prompt: PROMPT }).ok, true);
  const again = runner.start({ mode: 'create', prompt: PROMPT });
  assert.equal(again.status, 409); assert.match(again.error, /already active/);
  await wait(() => runner.status().tail.some((l) => l.startsWith('tool: ')));
  const st = runner.status();
  assert.equal(st.active, true); assert.equal(st.status, 'running'); assert.equal(st.last_text, 'Opening the first reference page');
  runner.stop(); await done(runner);
  assert.equal(runner.status().status, 'stopped');
  delete process.env.FAKE_CLAUDE_BEHAVIOR;
});

test('timeout kills the process and marks timeout', async () => {
  process.env.FAKE_CLAUDE_BEHAVIOR = 'sleep';
  const before = kills.length;
  const { runner, ws } = setup({ agent_run: { timeout_minutes: { research: 0.01 } } });
  runner.start({ mode: 'research', prompt: PROMPT });
  await done(runner);
  assert.equal(runner.status().status, 'timeout');
  assert.equal(kills.length, before + 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(ws, 'runs', 'agent-run.json'), 'utf8')).status, 'timeout');
  delete process.env.FAKE_CLAUDE_BEHAVIOR;
});

test('stop kills and marks stopped; stop with no run is refused', async () => {
  process.env.FAKE_CLAUDE_BEHAVIOR = 'sleep';
  const { runner } = setup();
  assert.equal(runner.stop().status, 409);
  runner.start({ mode: 'research', prompt: PROMPT });
  const before = kills.length;
  assert.equal(runner.stop().ok, true);
  await done(runner);
  assert.equal(kills.length, before + 1);
  assert.equal(runner.status().status, 'stopped');
  delete process.env.FAKE_CLAUDE_BEHAVIOR;
});

test('non-zero exit is failed with a clean error', async () => {
  process.env.FAKE_CLAUDE_BEHAVIOR = 'fail';
  const { runner } = setup();
  runner.start({ mode: 'create', prompt: PROMPT }); await done(runner);
  const st = runner.status();
  assert.equal(st.status, 'failed');
  assert.ok(!/ERRSECRET/.test(st.error));
  delete process.env.FAKE_CLAUDE_BEHAVIOR;
});

test('tail sanitising and no secret in any workspace file; tool inputs/results never kept', async () => {
  process.env.FAKE_CLAUDE_BEHAVIOR = 'secret';
  const { runner, ws } = setup();
  runner.start({ mode: 'research', prompt: PROMPT });
  await wait(() => runner.status().tail.some((l) => l.includes('Bearer')));
  runner.stop(); await done(runner);
  const all = [];
  const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : all.push(fs.readFileSync(p, 'utf8')); } };
  walk(ws);
  const text = all.join('\n') + JSON.stringify(runner.status());
  for (const s of ['abc.def.ghi', 'zzz9', 'TOPSECRET', 'SECRETVALUE', 'TOOLRESULT-SECRET', 'A'.repeat(60)]) assert.ok(!text.includes(s), s);
  assert.ok(runner.status().tail.every((l) => l.length <= 300));
  assert.ok(sanitize('x'.repeat(500)).length <= 300);
  delete process.env.FAKE_CLAUDE_BEHAVIOR;
});

test('MCP config per platform (own browser only), temp file removed after the run', async () => {
  const own = { userDataDir: '/p/bp', headless: true };
  assert.deepEqual(mcpConfig({ plat: 'win32', own }).mcpServers.playwright.args.slice(0, 3), ['/c', 'npx', '@playwright/mcp@latest']);
  assert.equal(mcpConfig({ plat: 'darwin', own }).mcpServers.playwright.command, 'npx');
  const { runner, ws, out } = setup();
  runner.start({ mode: 'research', prompt: PROMPT }); await done(runner);
  const rec = recorded(out);
  assert.deepEqual(Object.keys(rec.cfg.mcpServers), ['playwright']);
  assert.ok(!rec.cfg.mcpServers.playwright.args.includes('--extension'));
  assert.equal(rec.profile, '');
  assert.ok(!fs.existsSync(rec.cfgPath));
  assert.deepEqual(fs.readdirSync(path.join(ws, 'tmp')).filter((f) => f.endsWith('.json')), []);
});

test('missing npx or CLI are clear errors', () => {
  const { runner } = setup({}, { npxOk: () => false });
  assert.match(runner.start({ mode: 'research', prompt: PROMPT }).error, /npx/);
  const { runner: r2 } = setup({}, { findCli: () => ({ found: false, path: '' }) });
  assert.match(r2.start({ mode: 'create', prompt: PROMPT }).error, /claudeCli\.command/);
});

test('findClaude order: setting, PATH, newest VS Code extension, fixed folders', () => {
  const home = path.join(path.sep, 'h');
  const ext = (v) => path.join(home, '.vscode', 'extensions', `anthropic.claude-code-${v}-win32-x64`, 'resources', 'native-binary', 'claude.exe');
  const list = () => ['anthropic.claude-code-2.1.9-win32-x64', 'anthropic.claude-code-2.1.10-win32-x64', 'other.thing-9'];
  const has = (...files) => (p) => files.includes(p);
  assert.deepEqual(findClaude({ settings: { claudeCli: { command: 'C:\\x\\claude.exe' } }, plat: 'win32', home, exists: has('C:\\x\\claude.exe', ext('2.1.10')), which: () => '', list }), { found: true, path: 'C:\\x\\claude.exe' });
  assert.deepEqual(findClaude({ settings: { claudeCli: { command: 'C:\\gone.exe' } }, plat: 'win32', home, exists: has(ext('2.1.10')), which: () => '', list }), { found: false, path: '' });
  assert.equal(findClaude({ plat: 'win32', home, exists: has('P:\\claude.exe', ext('2.1.10')), which: () => 'P:\\claude.exe', list }).path, 'P:\\claude.exe');
  assert.equal(findClaude({ plat: 'win32', home, exists: has(ext('2.1.9'), ext('2.1.10')), which: () => '', list }).path, ext('2.1.10'));
  assert.equal(findClaude({ plat: 'win32', home, env: { APPDATA: 'A' }, exists: has(path.join('A', 'npm', 'claude.cmd')), which: () => '', list: () => [] }).path, path.join('A', 'npm', 'claude.cmd'));
  assert.equal(findClaude({ plat: 'darwin', home, exists: has('/opt/homebrew/bin/claude'), which: () => '', list: () => [] }).path, '/opt/homebrew/bin/claude');
  assert.equal(findClaude({ plat: 'linux', home, exists: () => false, which: () => '', list: () => [] }).found, false);
});

test('create with image engine flow: Playwright browser tools allowed, same own-browser note; codex create unchanged', async () => {
  const { runner, out } = setup({ image_engine: 'flow' });
  assert.equal(runner.start({ mode: 'create', prompt: PROMPT }).ok, true);
  await done(runner);
  const rec = recorded(out);
  const tools = rec.args[rec.args.indexOf('--allowedTools') + 1].split(',');
  for (const n of ['browser_tabs', 'browser_navigate', 'browser_snapshot', 'browser_click', 'browser_type', 'browser_press_key', 'browser_wait_for', 'browser_run_code_unsafe', 'browser_take_screenshot', 'browser_evaluate', 'browser_file_upload']) assert.ok(tools.includes('mcp__playwright__' + n), n);
  for (const n of ALLOWED_TOOLS.create) assert.ok(tools.includes(n), n);
  assert.ok(!rec.args.includes('--strict-mcp-config'), 'strict stays research only');
  assert.ok(rec.stdin.startsWith('RUN-NOW NOTE') && rec.stdin.endsWith(PROMPT));
  assert.ok(rec.cfg?.mcpServers?.playwright, 'the temp MCP config has the playwright server');
  const { runner: r2, out: o2 } = setup({ image_engine: 'codex' });
  r2.start({ mode: 'create', prompt: PROMPT }); await done(r2);
  const c = recorded(o2);
  assert.equal(c.args[c.args.indexOf('--allowedTools') + 1], ALLOWED_TOOLS.create.join(','));
  assert.equal(c.stdin, PROMPT);
});

test('per-run image engine: the run choice beats the setting for tools and the own-browser note (create only)', async () => {
  // Setting codex, run choice flow: Playwright browser tools + the wait note.
  const { runner, out } = setup({ image_engine: 'codex' });
  assert.equal(runner.start({ mode: 'create', prompt: PROMPT, imageEngine: 'flow' }).ok, true);
  await done(runner);
  const rec = recorded(out);
  assert.ok(rec.args[rec.args.indexOf('--allowedTools') + 1].split(',').includes('mcp__playwright__browser_navigate'));
  assert.ok(rec.stdin.startsWith('RUN-NOW NOTE') && rec.stdin.endsWith(PROMPT));
  // Setting flow, run choice codex: no browser tools, no note.
  const { runner: r2, out: o2 } = setup({ image_engine: 'flow' });
  r2.start({ mode: 'create', prompt: PROMPT, imageEngine: 'codex' }); await done(r2);
  const c = recorded(o2);
  assert.equal(c.args[c.args.indexOf('--allowedTools') + 1], ALLOWED_TOOLS.create.join(','));
  assert.equal(c.stdin, PROMPT);
  // No choice (or an invalid one): the setting decides. Publish ignores the engine.
  assert.equal(usesFlow('create', { image_engine: 'flow' }, ''), true);
  assert.equal(usesFlow('create', { image_engine: 'flow' }, 'nonsense'), true);
  assert.equal(usesFlow('create', {}, 'flow'), true);
  assert.equal(usesFlow('publish', {}, 'flow'), false);
  assert.equal(runEngine({ image_engine: 'flow' }, 'codex'), 'codex');
});

test('per mode: Metricool write tools only in publish; create never has them; research is browser + shell only', () => {
  const MC = 'mcp__claude_ai_Metricool_Social_Media_Management__';
  assert.ok(!ALLOWED_TOOLS.research.some((t) => t.includes('Metricool')) && ALLOWED_TOOLS.research.includes('mcp__playwright__*'));
  assert.ok(!ALLOWED_TOOLS.create.some((t) => /createScheduledPost|updateScheduledPost|ForReview/.test(t)));
  assert.ok(ALLOWED_TOOLS.create.includes('Bash') && ALLOWED_TOOLS.create.includes('Read') && ALLOWED_TOOLS.create.includes('Write'));
  assert.ok(ALLOWED_TOOLS.publish.includes(MC + 'createScheduledPost') && ALLOWED_TOOLS.publish.includes('Bash'));
  assert.ok(!ALLOWED_TOOLS.publish.includes(MC + 'updateScheduledPost'));
  assert.equal(needsBrowser('research', {}, ''), true);
  assert.equal(needsBrowser('publish', { image_engine: 'flow' }, ''), false);
  assert.equal(needsBrowser('create', {}, 'flow'), true);
  assert.equal(needsBrowser('create', {}, 'codex'), false);
});

test('add-dir: tool root, skills root, and Downloads only with Flow', async () => {
  const d = addDirs({ toolRoot: 'T', settings: { skillsRoot: 'S' }, flow: true, home: 'H' });
  assert.deepEqual(d, ['T', 'S', path.join('H', 'Downloads')]);
  assert.deepEqual(addDirs({ toolRoot: 'T', settings: { skillsRoot: 'S' }, flow: false, home: 'H' }), ['T', 'S']);
  const { runner, out, ws } = setup({ image_engine: 'flow' }, { home: 'HOME' });
  runner.start({ mode: 'create', prompt: PROMPT }); await done(runner);
  const a = recorded(out).args, i = a.indexOf('--add-dir');
  assert.deepEqual(a.slice(i + 1, i + 4), [ws, path.join(ws, 'skills'), path.join('HOME', 'Downloads')]);
});

test('limits per mode: timeouts (create with Flow 45) and max turns, as settings', () => {
  assert.deepEqual(DEFAULT_MINUTES, { research: 30, create: 30, create_flow: 45, publish: 15 });
  assert.equal(limitsFor('research', {}).limitMin, 30);
  assert.equal(limitsFor('create', {}, false).limitMin, 30);
  assert.equal(limitsFor('create', {}, true).limitMin, 45);
  assert.equal(limitsFor('publish', {}).limitMin, 15);
  assert.equal(limitsFor('create', { agent_run: { timeout_minutes: { create: 60 } } }, true).limitMin, 60);
  assert.equal(limitsFor('create', { agent_run: { timeout_minutes: { create_flow: 50 } } }, true).limitMin, 50);
  assert.equal(limitsFor('create', {}, true).maxTurns, DEFAULT_TURNS.create_flow);
  assert.ok(DEFAULT_TURNS.create_flow > DEFAULT_TURNS.create && DEFAULT_TURNS.create > DEFAULT_TURNS.publish);
  assert.equal(limitsFor('publish', { agent_run: { max_turns: 77 } }).maxTurns, 77);
  assert.equal(limitsFor('publish', { agent_run: { max_turns: { publish: 55 } } }).maxTurns, 55);
});

test('turns and limit reach argv and status per mode', async () => {
  const { runner, out } = setup({ image_engine: 'flow' });
  runner.start({ mode: 'create', prompt: PROMPT }); await done(runner);
  const a = recorded(out).args;
  assert.equal(a[a.indexOf('--max-turns') + 1], String(DEFAULT_TURNS.create_flow));
  const st = runner.status();
  assert.equal(st.limit_min, 45); assert.equal(st.flow, true);
});

test('auth problem: Not logged in is classified live, fails with an actionable message, run log hook called', async () => {
  process.env.FAKE_CLAUDE_BEHAVIOR = 'notloggedin';
  const ended = [];
  const { runner } = setup({}, { onEnd: (st) => ended.push(st) });
  runner.start({ mode: 'research', prompt: PROMPT }); await done(runner);
  const st = runner.status();
  assert.equal(st.status, 'failed');
  assert.equal(st.problem.kind, 'auth');
  assert.equal(st.error, MESSAGES.auth);
  assert.match(st.error, /run `claude` once in a terminal/);
  assert.equal(ended.length, 1); assert.equal(ended[0].status, 'failed');
  delete process.env.FAKE_CLAUDE_BEHAVIOR;
});

test('metricool problem in publish; no browser problem for a publish run', async () => {
  process.env.FAKE_CLAUDE_BEHAVIOR = 'metricool';
  const { runner } = setup();
  runner.start({ mode: 'publish', prompt: PROMPT }); await done(runner);
  assert.equal(runner.status().problem.kind, 'metricool');
  assert.match(runner.status().error, /Metricool/);
  process.env.FAKE_CLAUDE_BEHAVIOR = 'noconnect';
  const { runner: r3 } = setup({}, {});
  r3.start({ mode: 'publish', prompt: PROMPT }); await done(r3);
  assert.equal(r3.status().problem, null, 'a publish run never reports a browser problem');
  delete process.env.FAKE_CLAUDE_BEHAVIOR;
});

test('classifyProblem: patterns and scope', () => {
  for (const t of ['Not logged in · Please run /login', 'API Error: authentication_failed', 'Login required']) assert.equal(classifyProblem(t, { mode: 'create' })?.kind, 'auth', t);
  assert.equal(classifyProblem('Metricool needs you to sign in again', { mode: 'publish' })?.kind, 'metricool');
  assert.equal(classifyProblem('Metricool needs you to sign in again', { mode: 'research' }), null);
  assert.equal(classifyProblem('Flow: please sign in again to Google', { mode: 'create' }), null, 'a Google sign-in is not Metricool');
  assert.equal(classifyProblem('the browser did not connect', { mode: 'create', needsBrowser: true }), null, 'no extension hint any more');
  assert.equal(classifyProblem('the browser did not connect', { mode: 'create', needsBrowser: false }), null);
  assert.equal(classifyProblem('browser not connected', { mode: 'research', needsBrowser: true, kinds: ['auth', 'metricool'] }), null, 'live scan skips browser');
  assert.equal(classifyProblem('All done', { mode: 'research', needsBrowser: true }), null);
});

test('final report: newlines kept, secrets hidden, 12000 cap with notice, saved next to the status', async () => {
  try {
    process.env.FAKE_CLAUDE_BEHAVIOR = 'report';
    const a = setup();
    assert.equal(a.runner.start({ mode: 'publish', prompt: PROMPT }).ok, true);
    await done(a.runner);
    const st = a.runner.status();
    assert.match(st.report, /^## Report\n\n\*\*Done:\*\* two drafts\.\n\n- first bullet\n- second bullet/);
    assert.ok(!st.report.includes('zzz9') && !st.report.includes('abc.def.ghi'));
    assert.match(st.report, /\[hidden\]|X-Collect-Token \[hidden\]/);
    assert.ok(!st.last_text.includes('\n') && st.last_text.length <= 300, 'headline stays one short line');
    const saved = JSON.parse(fs.readFileSync(path.join(a.ws, 'runs', 'agent-run.json'), 'utf8'));
    assert.equal(saved.report, st.report);
    process.env.FAKE_CLAUDE_BEHAVIOR = 'bigreport';
    const b = setup();
    assert.equal(b.runner.start({ mode: 'publish', prompt: PROMPT }).ok, true);
    await done(b.runner);
    const big = b.runner.status().report;
    assert.ok(big.includes('\n') && big.endsWith('\n(report shortened)'));
    assert.ok(big.length <= 12000 + '\n(report shortened)'.length);
    assert.ok(big.length > 11000);
  } finally { delete process.env.FAKE_CLAUDE_BEHAVIOR; }
});

test('friendly live lines: Vietnamese mapping, repeat counter, no tool names or paths', async () => {
  process.env.FAKE_CLAUDE_BEHAVIOR = 'friendly';
  const { runner } = setup();
  try {
    assert.equal(runner.start({ mode: 'publish', prompt: PROMPT }).ok, true);
    await done(runner);
    const st = runner.status(), texts = st.friendly.map((f) => f.text);
    assert.ok(st.friendly.every((f) => typeof f.t === 'string' && typeof f.n === 'number'));
    assert.equal(texts[0], 'Bắt đầu chạy: Publish');
    assert.deepEqual(st.friendly.find((f) => f.text === 'Đang tạo bài (pipeline create)').n, 3);
    for (const want of ['Đang đăng ký ảnh vào bài nháp', 'Đang viết nội dung (caption/ý tưởng)', 'Đang xem ảnh', 'Đang gửi/hẹn giờ bài trên Metricool', 'Đang xử lý…', 'Đang mở x.test']) assert.ok(texts.includes(want) || want === 'Đang mở x.test', want);
    assert.equal(texts.at(-1), 'Hoàn tất');
    assert.ok(!JSON.stringify(st.friendly).match(/mcp__|Bash|C:|SECRETVALUE/));
    assert.ok(st.tail.some((l) => l.startsWith('tool: ')), 'raw tail kept');
  } finally { delete process.env.FAKE_CLAUDE_BEHAVIOR; }
});

// ----- own browser (the only mode): dedicated profile, headless, no extension, no Connect note -----
test('mcpConfig: own browser flags, headless on/off, no extension, no profile env', () => {
  const own = { userDataDir: '/p/browser-profile', headless: true, outputDir: '/p/out' };
  const a = mcpConfig({ plat: 'linux', own }).mcpServers.playwright;
  assert.deepEqual(a.args, ['@playwright/mcp@latest', '--browser', 'chrome', '--user-data-dir', '/p/browser-profile', '--headless', '--viewport-size', '1280x800', '--output-dir', '/p/out']);
  assert.equal(a.command, 'npx'); assert.equal(a.env, undefined); assert.ok(!a.args.includes('--extension'));
  const w = mcpConfig({ plat: 'win32', own: { ...own, headless: false } }).mcpServers.playwright;
  assert.deepEqual(w.args.slice(0, 3), ['/c', 'npx', '@playwright/mcp@latest']); assert.ok(!w.args.includes('--headless'));
});

test('own mode run: config with the profile dir, own note (no Connect), no profile env; refusals with injectable fakes', async () => {
  const { runner, out, ws } = setup({ browser: { mode: 'own', headless: true, profile_dir: 'bp' } });
  assert.equal(runner.start({ mode: 'research', prompt: PROMPT }).ok, true); await done(runner);
  const rec = recorded(out), srv = rec.cfg.mcpServers.playwright;
  assert.ok(srv.args.includes('--user-data-dir') && srv.args.includes(path.join(ws, 'bp')) && srv.args.includes('--headless') && !srv.args.includes('--extension'));
  assert.ok(rec.stdin.startsWith('RUN-NOW NOTE') && rec.stdin.endsWith(PROMPT));
  const note = rec.stdin.slice(0, rec.stdin.length - PROMPT.length);
  assert.ok(note.includes('OWN browser') && note.includes('waitForEvent') && note.includes('saveAs') && !note.includes('chrome-connect.mjs'));
  assert.equal(rec.profile, '', 'no extension profile env in own mode');
  const r1 = setup({ browser: { mode: 'own' } }, { loginWindowOpen: () => true }).runner.start({ mode: 'research', prompt: PROMPT });
  assert.equal(r1.ok, false); assert.match(r1.error, /login window/);
  const r2 = setup({ browser: { mode: 'own' } }, { browserCheck: () => 'no profile yet' }).runner.start({ mode: 'research', prompt: PROMPT });
  assert.equal(r2.ok, false); assert.equal(r2.error, 'no profile yet');
  // Publish never needs the browser: neither refusal applies.
  const r3 = setup({ browser: { mode: 'own' } }, { loginWindowOpen: () => true, browserCheck: () => 'x' });
  assert.equal(r3.runner.start({ mode: 'publish', prompt: PROMPT }).ok, true); await done(r3.runner);
});

test('login wall becomes the log-in-again hint', () => {
  const t = 'Facebook showed a login wall, so I stopped.';
  assert.equal(classifyProblem(t, { mode: 'research', needsBrowser: true, own: true, kinds: ['login'] }).kind, 'login');
  assert.match(MESSAGES.login, /Open browser to log in/);
  assert.equal(classifyProblem('Instagram checkpoint', { mode: 'research', needsBrowser: true, own: true, kinds: ['login'] }).kind, 'login');
  assert.equal(classifyProblem(t, { mode: 'research', needsBrowser: true, own: false, kinds: ['login'] }), null);
  assert.equal(classifyProblem('login required', { mode: 'research', needsBrowser: true, own: true, kinds: ['login'] }), null, 'bare login required is Claude auth');
  assert.equal(classifyProblem('The user data directory is already in use', { mode: 'research', needsBrowser: true, own: true, kinds: ['login', 'profile'] }).kind, 'profile');
  assert.equal(classifyProblem('browser not connected', { mode: 'research', needsBrowser: true, own: true }), null, 'no extension hint in own mode');
});

// Run lock (ui/index.html): one central function, the guard text, and the server refusing a restart during a run.
test('run lock: central function and guard text in the UI', () => {
  const html = fs.readFileSync(path.join(here, '..', 'ui', 'index.html'), 'utf8');
  assert.match(html, /function setRunLock\(/);
  assert.match(html, /function applyRunLock\(/);
  assert.match(html, /MutationObserver/);
  assert.match(html, /A run is active: wait for it to finish or press Stop/);
  assert.match(html, /A run is active: stop it or wait for it to finish/);
  assert.match(html, /controls are locked until it finishes/);
  assert.match(html, /arFails < 3/);
  for (const needle of ['#brandSave', '[data-act=approve]', '[data-restore]', '#settingsSave', '[data-recrawl]']) assert.ok(html.includes(needle), needle);
  assert.ok((html.match(/if \(runGuard\(\)\) return/g) || []).length >= 10);
  const server = fs.readFileSync(path.join(here, '..', 'src', 'server.mjs'), 'utf8');
  assert.match(server, /A run is active: stop it or wait for it to finish/);
});
