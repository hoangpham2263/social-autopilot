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
import { createAgentRunner, sanitize, mcpConfig, validate, ALLOWED_TOOLS } from '../core/setup/agent-run.mjs';
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
  // A research run started from the app gets the wait-for-Connect note in front of the exact prompt the Copy button gives.
  assert.ok(rec.stdin.endsWith(PROMPT), 'stdin ends with the unchanged prompt');
  const note = rec.stdin.slice(0, rec.stdin.length - PROMPT.length);
  assert.ok(note.startsWith('RUN-NOW NOTE'), 'the note comes first');
  assert.ok(note.includes('chrome-connect.mjs'), 'the note brings the connect page in front of the person');
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
  assert.ok(tools.includes('createScheduledPost') && tools.includes('updateScheduledPost'));
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
  process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN = 'ENVTOKEN-123456';
  const { runner, ws } = setup();
  runner.start({ mode: 'research', prompt: PROMPT });
  await wait(() => runner.status().tail.some((l) => l.includes('Bearer')));
  runner.stop(); await done(runner);
  const all = [];
  const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : all.push(fs.readFileSync(p, 'utf8')); } };
  walk(ws);
  const text = all.join('\n') + JSON.stringify(runner.status());
  for (const s of ['abc.def.ghi', 'zzz9', 'TOPSECRET', 'ENVTOKEN', 'SECRETVALUE', 'TOOLRESULT-SECRET', 'A'.repeat(60)]) assert.ok(!text.includes(s), s);
  assert.ok(runner.status().tail.every((l) => l.length <= 300));
  assert.ok(sanitize('x'.repeat(500)).length <= 300);
  delete process.env.FAKE_CLAUDE_BEHAVIOR; delete process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN;
});

test('MCP config per platform, profile env only, temp file removed after the run', async () => {
  assert.deepEqual(mcpConfig({ plat: 'win32' }).mcpServers.playwright, { command: 'cmd', args: ['/c', 'npx', '@playwright/mcp@latest', '--extension'] });
  assert.deepEqual(mcpConfig({ plat: 'darwin' }).mcpServers.playwright, { command: 'npx', args: ['@playwright/mcp@latest', '--extension'] });
  assert.deepEqual(mcpConfig({ plat: 'linux', profile: 'Profile 2' }).mcpServers.playwright.env, { PLAYWRIGHT_MCP_PROFILE_DIR_NAME: 'Profile 2' });
  const { runner, ws, out } = setup({ research: { chrome_profile: 'Profile 2' } });
  runner.start({ mode: 'research', prompt: PROMPT }); await done(runner);
  const rec = recorded(out);
  assert.deepEqual(Object.keys(rec.cfg.mcpServers), ['playwright']);
  assert.equal(rec.cfg.mcpServers.playwright.env.PLAYWRIGHT_MCP_PROFILE_DIR_NAME, 'Profile 2');
  assert.equal(rec.profile, 'Profile 2');
  assert.ok(!fs.existsSync(rec.cfgPath));
  assert.deepEqual(fs.readdirSync(path.join(ws, 'tmp')), []);
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
