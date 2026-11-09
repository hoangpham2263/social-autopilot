// Run log (scripts/runlog.mjs): add builds the per-brand report from what the run left (research run.json, drafts and
// Metricool records), list is newest first with the dried-up streak per source, show returns one. Temp dirs only.
// npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-runlog-test-'));
const skills = path.join(tmp, 'skills'), ws = path.join(tmp, 'workspace'), brandDir = path.join(skills, 'rb-skills');
const env = { ...process.env, SA_WORKSPACE: ws, SA_SKILLS_ROOT: skills };
const write = (f, x) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof x === 'string' ? x : JSON.stringify(x)); };
const run = (...args) => { const r = spawnSync(process.execPath, [path.join(tool, 'scripts', 'runlog.mjs'), ...args], { env, encoding: 'utf8', windowsHide: true }); try { return JSON.parse(r.stdout); } catch { throw new Error(r.stdout + r.stderr); } };

write(path.join(brandDir, 'SKILL.md'), '# rb');
write(path.join(brandDir, 'project', 'project.md'), '# rb');
write(path.join(brandDir, 'project', 'social.json'), { brand: 'RB', enabled: true, channels: [{ network: 'facebook', enabled: true, lang: ['en'] }], cadence: { timezone: 'America/New_York' }, research: { sources: [{ id: 'a', name: 'A', url: 'https://x.test/a', enabled: true }] } });
write(path.join(brandDir, 'scripts', 'check-skill.mjs'), "console.log('ok')");
write(path.join(brandDir, 'workspace', 'catalog.json'), { posts: [{ id: 'POST-01', status: 'scheduled', metricool: { facebook: { id: '9', draft: false, publication: '2026-12-01T10:00:00', timezone: 'America/New_York', sent_at: '2099-01-01T00:00:00Z' } } }] });
const crawl = (date, sources) => write(path.join(ws, 'runs', 'rb', date, 'run.json'), { date, status: 'done', mode: {}, sources });

test('research: per source new / dried up / blocked; dried-up streak across runs', () => {
  crawl('2026-11-01', [{ id: 'a', name: 'A', new: 5, duplicates: 1, result: { state: 'known' } }, { id: 'b', name: 'B', new: 0, result: { state: 'known' } }]);
  let r = run('add', '--mode', 'research', '--agent', 'Claude Code', '--started', '2026-11-01T00:00:00Z');
  assert.equal(r.ok, true, JSON.stringify(r));
  const b = r.log.brands[0];
  assert.deepEqual(b.research.sources.map((x) => [x.id, x.new, x.state]), [['a', 5, 'new posts'], ['b', 0, 'dried up']]);
  assert.equal(r.log.headline, '+5 posts · 1 source dried up');
  assert.equal(r.log.result, 'ok');
  // two more runs where B brings nothing and A is blocked
  for (const d of ['2026-11-02', '2026-11-03']) {
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},1100)']); // distinct log ids (1 s resolution)
    crawl(d, [{ id: 'a', name: 'A', new: 0, result: { state: 'blocked', note: 'checkpoint' } }, { id: 'b', name: 'B', new: 0, result: { state: 'known' } }]);
    r = run('add', '--mode', 'research', '--agent', 'Codex');
    assert.equal(r.ok, true);
  }
  assert.equal(r.log.result, 'warning');
  assert.match(r.log.headline, /1 blocked/);
  const list = run('list', '--mode', 'research');
  assert.equal(list.logs.length, 3);
  const full = run('show', '--id', list.logs[0].id).log;
  assert.equal(full.brands[0].research.sources.find((x) => x.id === 'b').dry_runs, 3, 'B dried up 3 runs in a row');
  assert.equal(full.brands[0].research.sources.find((x) => x.id === 'a').dry_runs, 2);
});

test('create: scheduled this run, to review, failed checks count as errors; agent notes kept', () => {
  write(path.join(ws, 'drafts', 'rb', 'rb-20261109-01', 'draft.json'), { id: 'rb-20261109-01', brand: 'rb', brand_dir: brandDir, created: '2099-01-01T00:00:00Z', inspiration: {} });
  write(path.join(ws, 'drafts', 'rb', 'rb-20261109-01', 'status.json'), { status: 'ready' });
  write(path.join(ws, 'drafts', 'rb', 'rb-20261109-02', 'draft.json'), { id: 'rb-20261109-02', brand: 'rb', brand_dir: brandDir, created: '2099-01-01T00:00:00Z', inspiration: {} });
  write(path.join(ws, 'drafts', 'rb', 'rb-20261109-02', 'status.json'), { status: 'check_failed', problems: ['caption has an AI label'] });
  write(path.join(ws, 'drafts', 'rb', 'rb-20261109-03', 'draft.json'), { id: 'rb-20261109-03', brand: 'rb', brand_dir: brandDir, created: '2026-01-01T00:00:00Z', inspiration: {} });
  write(path.join(ws, 'drafts', 'rb', 'rb-20261109-03', 'status.json'), { status: 'approved', brand_post: { id: 'POST-01', folder: brandDir, catalog: path.join(brandDir, 'workspace', 'catalog.json') } });
  const notes = path.join(tmp, 'notes.json');
  write(notes, { notes: 'all good', brands: { rb: { errors: ['image quota used up'] } } });
  const r = run('add', '--mode', 'create', '--agent', 'Claude Code', '--started', '2098-12-31T00:00:00Z', '--file', notes);
  assert.equal(r.ok, true, JSON.stringify(r));
  const c = r.log.brands[0].create;
  assert.deepEqual(c.scheduled.map((x) => x.post), ['POST-01']);
  assert.deepEqual(c.to_review.map((x) => x.id), ['rb-20261109-01']);
  assert.equal(c.failed[0].reason, 'caption has an AI label');
  assert.equal(r.log.headline, '1 scheduled · 1 to review · 2 errors');
  assert.equal(r.log.result, 'error');
  assert.equal(r.log.notes, 'all good');
  assert.equal(run('add', '--mode', 'nope').ok, false);
  assert.equal(run('show', '--id', '../x').ok, false);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('publish (Mode 3): reported like create, without "to review"', () => {
  spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},1100)']);
  const r = run('add', '--mode', 'publish', '--agent', 'Codex', '--started', '2098-12-31T00:00:00Z');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.log.mode, 'publish');
  assert.deepEqual(r.log.brands[0].create.scheduled.map((x) => x.post), ['POST-01']);
  assert.doesNotMatch(r.log.headline, /to review/);
  assert.equal(run('list', '--mode', 'publish').logs.length, 1);
});
