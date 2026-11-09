// Mode 1 guards: crawl-fb.mjs --check reports an unreachable crawl Chrome (the run is not started), and research.mjs
// start on the same day keeps the previous run.json in archive/. Temp dirs only.
// npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkChrome } from '../scripts/crawl-fb.mjs';

const tool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-crawlcheck-'));
const skills = path.join(tmp, 'skills'), ws = path.join(tmp, 'workspace'), dir = path.join(skills, 'cc-skills');
const env = { ...process.env, SA_WORKSPACE: ws, SA_SKILLS_ROOT: skills };
const write = (f, x) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof x === 'string' ? x : JSON.stringify(x)); };
const run = (script, ...args) => { const r = spawnSync(process.execPath, [path.join(tool, 'scripts', script), ...args], { env, encoding: 'utf8', windowsHide: true }); try { return JSON.parse(r.stdout); } catch { throw new Error(r.stdout + r.stderr); } };

test('--check: Chrome not reachable -> ok false, with how to start it', async () => {
  const r = await checkChrome('http://127.0.0.1:9');
  assert.equal(r.ok, false);
  assert.equal(r.reachable, false);
  assert.match(r.next, /start-crawl-chrome/);
  const cli = run('crawl-fb.mjs', '--check', '--cdp', 'http://127.0.0.1:9');
  assert.equal(cli.ok, false);
  assert.equal(cli.reachable, false);
});

test('research.mjs start twice the same day: the previous run.json is kept in archive/', () => {
  write(path.join(dir, 'SKILL.md'), '# cc');
  write(path.join(dir, 'project', 'project.md'), '# cc');
  write(path.join(dir, 'project', 'social.json'), { brand: 'CC', enabled: true, channels: [{ network: 'facebook', enabled: true, lang: ['en'] }], cadence: { timezone: 'America/New_York', posts_per_day: 1 }, research: { sources: [{ id: 'a', name: 'A', url: 'https://www.facebook.com/a', enabled: true }] } });
  write(path.join(dir, 'scripts', 'check-skill.mjs'), "console.log('ok')");
  const first = run('research.mjs', 'start', '--brand', 'cc');
  assert.equal(first.ok, true, JSON.stringify(first));
  const second = run('research.mjs', 'start', '--brand', 'cc');
  assert.equal(second.ok, true, JSON.stringify(second));
  const kept = second.archived.find((x) => x.run);
  assert.ok(kept, JSON.stringify(second.archived));
  assert.ok(fs.existsSync(path.join(kept.to, 'run.json')));
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
