// Pure tests for core/setup/playwright-mcp.mjs: fake claude CLI and temp home/workspace, no real MCP config, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseGet, publicView, buildCommands, mask, scrub, newestBackup, createPlaywrightMcp, secretFile, readSaved, findClaude } from '../core/setup/playwright-mcp.mjs';

const tool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'tok_SECRET_abcd1234';
const SAMPLE = `playwright:
  Scope: User config (available in all your projects)
  Status: ✓ Connected
  Type: stdio
  Command: npx
  Args: @playwright/mcp@latest --extension
  Environment:
    PLAYWRIGHT_MCP_EXTENSION_TOKEN=${TOKEN}
    OTHER_VAR=keepme

To remove this server, run: claude mcp remove "playwright" -s user
`;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sa-pw-'));

test('parseGet keeps command, args, scope, env; publicView never holds the token', () => {
  const p = parseGet(SAMPLE);
  assert.equal(p.command, 'npx'); assert.deepEqual(p.args, ['@playwright/mcp@latest', '--extension']); assert.equal(p.scope, 'user');
  const v = publicView(p, 'claude');
  assert.equal(v.token_tail, '••••1234'); assert.equal(v.has_token, true); assert.equal(v.extension_mode, true);
  assert.ok(!JSON.stringify(v).includes(TOKEN));
});
test('masking and scrub', () => {
  assert.equal(mask(TOKEN), '••••1234'); assert.equal(mask(''), '');
  assert.ok(!scrub(`failed with ${TOKEN}`, [TOKEN]).includes(TOKEN));
});
test('buildCommands keeps existing args and env, masks on request', () => {
  const p = parseGet(SAMPLE);
  const c = buildCommands(p, 'playwright', { token: 'NEWTOKEN9999', profile_dir: 'Profile 2' });
  assert.deepEqual(c.remove, ['mcp', 'remove', 'playwright', '-s', 'user']);
  assert.ok(c.add.includes('OTHER_VAR=keepme')); assert.ok(c.add.includes('PLAYWRIGHT_MCP_EXTENSION_TOKEN=NEWTOKEN9999'));
  assert.ok(c.add.includes('PLAYWRIGHT_MCP_PROFILE_DIR_NAME=Profile 2'));
  assert.deepEqual(c.add.slice(c.add.indexOf('--')), ['--', 'npx', '@playwright/mcp@latest', '--extension']);
  assert.ok(!buildCommands(p, 'playwright', { token: 'NEWTOKEN9999' }, true).add.join(' ').includes('NEWTOKEN9999'));
});
test('refuses without confirm, and when no command can be parsed', async () => {
  const home = tmp(), ws = tmp();
  const api = createPlaywrightMcp({ home, workspaceDir: ws, find: () => 'claude', run: async () => ({ code: 1, out: '', err: 'nope' }) });
  await assert.rejects(api.apply({ token: TOKEN }), /confirm/);
  await assert.rejects(api.apply({ token: TOKEN, confirm: true }), /Cannot read the current/);
  await assert.rejects(async () => api.restore({}), /confirm/);
});
test('dry run shows masked command line and changes nothing', async () => {
  const home = tmp(), ws = tmp();
  const api = createPlaywrightMcp({ home, workspaceDir: ws, find: () => 'claude', run: async () => ({ code: 0, out: SAMPLE, err: '' }) });
  const r = await api.apply({ token: 'NEWTOKEN9999', confirm: true, dry_run: true });
  assert.ok(!JSON.stringify(r).includes('NEWTOKEN9999') && !JSON.stringify(r).includes(TOKEN));
  assert.deepEqual(fs.readdirSync(home), []); assert.equal(readSaved(ws), '');
});
test('apply: backup, token saved only in workspace/secrets, restore on failure', async () => {
  const home = tmp(), ws = tmp();
  fs.writeFileSync(path.join(home, '.claude.json'), '{"orig":true}');
  let state = SAMPLE;
  const run = (fail) => async (cli, args) => {
    if (args[1] === 'get') return { code: 0, out: state, err: '' };
    if (args[1] === 'remove') { fs.writeFileSync(path.join(home, '.claude.json'), '{}'); return { code: 0, out: '', err: '' }; }
    if (fail) return { code: 1, out: '', err: `boom ${args.join(' ')}` };
    state = SAMPLE.replace(TOKEN, 'NEWTOKEN9999'); return { code: 0, out: '', err: '' };
  };
  const bad = createPlaywrightMcp({ home, workspaceDir: ws, find: () => 'claude', run: run(true) });
  await assert.rejects(bad.apply({ token: 'NEWTOKEN9999', confirm: true }), (e) => !e.message.includes('NEWTOKEN9999') && /restored/.test(e.message));
  assert.equal(fs.readFileSync(path.join(home, '.claude.json'), 'utf8'), '{"orig":true}');
  assert.equal(readSaved(ws), '');
  const good = createPlaywrightMcp({ home, workspaceDir: ws, find: () => 'claude', run: run(false) });
  const r = await good.apply({ token: 'NEWTOKEN9999', confirm: true });
  assert.ok(r.ok && r.restart_needed && !JSON.stringify(r).includes('NEWTOKEN9999'));
  assert.equal(readSaved(ws), 'NEWTOKEN9999');
  const st = await good.status();
  assert.ok(!JSON.stringify(st).includes('NEWTOKEN9999')); assert.equal(st.saved_tail, '••••9999');
  good.forget({ confirm: true }); assert.equal(readSaved(ws), '');
  for (const f of fs.readdirSync(home)) assert.ok(!fs.readFileSync(path.join(home, f), 'utf8').includes('NEWTOKEN9999'));
});
test('restore picks the newest backup', () => {
  const home = tmp();
  for (const t of ['20260101000000000', '20260301000000000', '20260201000000000']) fs.writeFileSync(path.join(home, `.claude.json.sa-backup-${t}`), t);
  assert.ok(newestBackup(home).endsWith('20260301000000000'));
});
test('the token lives only under workspace/secrets, which git ignores', () => {
  const ws = tmp();
  assert.equal(secretFile(ws), path.join(ws, 'secrets', 'playwright-mcp.json'));
  const out = execFileSync('git', ['check-ignore', 'workspace/secrets/playwright-mcp.json'], { cwd: tool, encoding: 'utf8' });
  assert.match(out, /playwright-mcp\.json/);
  assert.match(fs.readFileSync(path.join(tool, '.gitignore'), 'utf8'), /^workspace\/secrets\/$/m);
});
test('findClaude: override, PATH, newest VS Code extension', () => {
  const ext = (v) => path.normalize(`/h/.vscode/extensions/anthropic.claude-code-${v}-win32-x64/resources/native-binary/claude.exe`);
  const ex = new Set([path.normalize('/ov'), ext('2.1.322'), ext('2.1.9')]);
  const base = { home: '/h', win: true, exists: (p) => ex.has(path.normalize(p)), which: () => '', list: () => ['anthropic.claude-code-2.1.9-win32-x64', 'anthropic.claude-code-2.1.322-win32-x64'] };
  assert.equal(findClaude({ ...base, override: '/ov' }), '/ov');
  assert.equal(findClaude({ ...base, which: () => '/bin/claude' }), '/bin/claude');
  assert.match(findClaude(base), /2\.1\.322/);
});
