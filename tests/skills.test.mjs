// Skill folders are linked in place (never copied): scripts/skills.mjs list-sources / validate / link / unlink, discovery
// of a skill linked by path outside skillsRoot, and the Metricool refusal after Ngắt kết nối. Temp dirs only.
// npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-skills-test-'));
const skills = path.join(tmp, 'skills'), other = path.join(tmp, 'elsewhere'), ws = path.join(tmp, 'workspace');
const env = { ...process.env, SA_WORKSPACE: ws, SA_SKILLS_ROOT: skills };
const run = (script, ...args) => {
  const r = spawnSync(process.execPath, [path.join(tool, 'scripts', script), ...args], { env, encoding: 'utf8', windowsHide: true });
  try { return JSON.parse(r.stdout); } catch { throw new Error(`${script} ${args.join(' ')}: ${r.stdout}${r.stderr}`); }
};
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
function fakeSkill(dir, brand, blog) {
  write(path.join(dir, 'SKILL.md'), '---\nname: x\n---\nbody\n');
  write(path.join(dir, 'project', 'project.md'), '# p\n');
  write(path.join(dir, 'project', 'social.json'), JSON.stringify({ brand, enabled: true, metricool: { blog_id: blog }, cadence: { timezone: 'Asia/Ho_Chi_Minh' }, channels: [{ network: 'facebook', enabled: true, lang: ['en'] }] }));
  write(path.join(dir, 'scripts', 'check-skill.mjs'), "console.log('ĐẠT');\n");
}
fakeSkill(path.join(skills, 'alpha-skills'), 'Alpha', '111');
fakeSkill(path.join(other, 'beta-skills'), 'Beta', '222');
write(path.join(other, 'notaskill', 'README.md'), 'x');
write(path.join(ws, 'metricool-brands.json'), JSON.stringify({ version: 1, account: {}, brands: [
  { name: 'Alpha MC', blog_id: '111', timezone: 'Asia/Ho_Chi_Minh', networks: ['facebook'], skill_id: 'alpha' },
  { name: 'Beta MC', blog_id: '222', timezone: 'Asia/Ho_Chi_Minh', networks: ['facebook'], skill_id: null },
] }));
const ids = () => run('brands.mjs').brands.map((b) => b.id).sort();
const mc = () => JSON.parse(fs.readFileSync(path.join(ws, 'metricool-brands.json'), 'utf8')).brands;

test('list-sources finds valid skill folders, with the brand each is linked to', () => {
  const r = run('skills.mjs', 'list-sources', '--from', other);
  assert.equal(r.ok, true);
  assert.deepEqual(r.sources.map((x) => x.id), ['beta']);
  assert.equal(r.sources[0].linked_to, null);
  assert.ok(!r.sources.some((x) => x.dir.endsWith('notaskill')));
  assert.equal(run('skills.mjs', 'list-sources', '--from', skills).sources[0].linked_to, 'Alpha MC');
  assert.equal(run('skills.mjs', 'validate', '--path', path.join(other, 'notaskill')).ok, false);
  assert.equal(run('skills.mjs', 'validate', '--path', path.join(other, 'beta-skills')).tool_ready, true);
});

test('link points a Metricool brand to a folder in place (no copy); unlink keeps the folder', () => {
  assert.deepEqual(ids(), ['alpha']);
  const r = run('skills.mjs', 'link', '--brand', 'Beta MC', '--path', path.join(other, 'beta-skills'));
  assert.equal(r.ok, true, JSON.stringify(r));
  const beta = mc().find((b) => b.name === 'Beta MC');
  assert.equal(beta.skill_id, 'beta');
  assert.equal(path.resolve(beta.skill_path), path.join(other, 'beta-skills'));
  assert.deepEqual(ids(), ['alpha', 'beta']);
  assert.equal(run('brands.mjs').brands.find((b) => b.id === 'beta').dir, path.join(other, 'beta-skills'));
  assert.ok(!fs.existsSync(path.join(skills, 'beta-skills')), 'nothing copied');
  // A skill already linked to another brand is refused.
  assert.equal(run('skills.mjs', 'link', '--brand', 'Beta MC', '--path', path.join(skills, 'alpha-skills')).ok, false);
  // Links are by path: skill_path is stored for a skillsRoot folder too.
  assert.equal(run('skills.mjs', 'unlink', '--brand', 'Alpha MC').ok, true);
  assert.equal(run('skills.mjs', 'link', '--brand', 'Alpha MC', '--path', path.join(skills, 'alpha-skills')).ok, true);
  assert.equal(path.resolve(mc().find((b) => b.name === 'Alpha MC').skill_path), path.join(skills, 'alpha-skills'));
  // Unlink: mapping cleared, folder untouched, linked-by-path skill no longer discovered.
  const u = run('skills.mjs', 'unlink', '--brand', 'Beta MC');
  assert.equal(u.ok, true);
  assert.equal(mc().find((b) => b.name === 'Beta MC').skill_id, null);
  assert.equal(mc().find((b) => b.name === 'Beta MC').skill_path, undefined);
  assert.ok(fs.existsSync(path.join(other, 'beta-skills', 'project', 'social.json')));
  assert.deepEqual(ids(), ['alpha']);
});

test('after Ngắt kết nối nothing of that brand goes to Metricool', () => {
  run('skills.mjs', 'unlink', '--brand', 'Alpha MC');
  const r = run('metricool-csv.mjs', 'export', '--brand', 'alpha', '--out', path.join(tmp, 'out.csv'));
  assert.equal(r.ok, false);
  assert.match(r.error, /không nối với bộ skill alpha/);
  run('skills.mjs', 'link', '--brand', 'Alpha MC', '--path', path.join(skills, 'alpha-skills'));
  assert.doesNotMatch(run('metricool-csv.mjs', 'export', '--brand', 'alpha', '--out', path.join(tmp, 'out.csv')).error || '', /không nối/);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
