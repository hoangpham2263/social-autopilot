// Shared skill layout (skills/brand-content-skills/brands/<id>) next to the legacy one (skills/<id>-skills): discovery, shared
// script + --brand, the brand picker, the prompt line and the relink migration. Temp dirs only, no network.
// npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-shared-test-'));
const newRoot = path.join(tmp, 'new', 'skills'), oldRoot = path.join(tmp, 'old', 'skills'), ws = path.join(tmp, 'workspace');
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const social = (brand, blog) => JSON.stringify({ brand, enabled: true, metricool: { blog_id: blog }, cadence: { timezone: 'Asia/Ho_Chi_Minh' }, channels: [{ network: 'facebook', enabled: true, lang: ['en'] }] });
// The shared check-skill needs --brand <id> (as the real one does) and reports OK only for a brand folder that exists.
const CHECK = "const a = process.argv, i = a.indexOf('--brand'); const id = i > 0 ? a[i + 1] : ''; const fs = require('node:fs'), path = require('node:path'); const ok = id && fs.existsSync(path.join(__dirname, '..', 'brands', id, 'project', 'social.json')); console.log(ok ? 'ĐẠT' : '  - missing: --brand'); process.exit(ok ? 0 : 1);\n";
function sharedSkill(root, ids) {
  const s = path.join(root, 'brand-content-skills');
  write(path.join(s, 'SKILL.md'), '---\nname: brand-content-skills\n---\n');
  write(path.join(s, 'scripts', 'check-skill.mjs'), CHECK.replace("require('node:fs')", "(await import('node:fs')).default").replace("require('node:path')", "(await import('node:path')).default").replace('__dirname', "import.meta.dirname"));
  write(path.join(s, 'scripts', 'clean-image.mjs'), "console.log('SẠCH: ok');\n");
  for (const [id, name, blog] of ids) {
    write(path.join(s, 'brands', id, 'project', 'project.md'), '# p\n');
    write(path.join(s, 'brands', id, 'project', 'social.json'), social(name, blog));
  }
  return s;
}
function legacySkill(dir, name, blog) {
  write(path.join(dir, 'SKILL.md'), '---\nname: x\n---\n');
  write(path.join(dir, 'project', 'project.md'), '# p\n');
  write(path.join(dir, 'project', 'social.json'), social(name, blog));
  write(path.join(dir, 'scripts', 'check-skill.mjs'), "console.log('ĐẠT');\n");
}
const skill = sharedSkill(newRoot, [['alpha', 'Alpha', '111'], ['beta', 'Beta', '222']]);
legacySkill(path.join(oldRoot, 'alpha-skills'), 'Alpha', '111');
legacySkill(path.join(oldRoot, 'beta-skills'), 'Beta', '222');
write(path.join(ws, 'metricool-brands.json'), JSON.stringify({ version: 1, account: {}, brands: [
  { name: 'Alpha', blog_id: '111', timezone: 'Asia/Ho_Chi_Minh', networks: ['facebook'], skill_id: 'alpha', skill_path: path.join(oldRoot, 'alpha-skills').split(path.sep).join('/') },
  { name: 'Beta', blog_id: '222', timezone: 'Asia/Ho_Chi_Minh', networks: ['facebook'], skill_id: 'beta', skill_path: path.join(oldRoot, 'beta-skills').split(path.sep).join('/') },
  { name: 'Gamma', blog_id: '333', timezone: 'Asia/Ho_Chi_Minh', networks: ['facebook'], skill_id: null },
] }));

const run = (root, script, ...args) => {
  const r = spawnSync(process.execPath, [path.join(tool, 'scripts', script), ...args], { env: { ...process.env, SA_WORKSPACE: ws, SA_SKILLS_ROOT: root }, encoding: 'utf8', windowsHide: true });
  try { return JSON.parse(r.stdout); } catch { throw new Error(`${script} ${args.join(' ')}: ${r.stdout}${r.stderr}`); }
};
const lib = async () => { process.env.SA_WORKSPACE = ws; return import('../scripts/lib.mjs'); };

test('helpers: skillRoot, shared flag, id, script path and --brand', async () => {
  const L = await lib();
  const b = path.join(skill, 'brands', 'alpha'), l = path.join(oldRoot, 'alpha-skills');
  assert.equal(L.skillRootOf(b), skill);
  assert.equal(L.isSharedLayout(b), true);
  assert.equal(L.skillIdOf(b), 'alpha');
  assert.equal(L.skillScript(b, 'clean-image.mjs'), path.join(skill, 'scripts', 'clean-image.mjs'));
  assert.deepEqual(L.skillScriptArgs(b, ['--tool-ready']), ['--tool-ready', '--brand', 'alpha']);
  assert.equal(L.skillRootOf(l), path.resolve(l));
  assert.equal(L.isSharedLayout(l), false);
  assert.equal(L.skillIdOf(l), 'alpha');
  assert.deepEqual(L.skillScriptArgs(l, ['--tool-ready']), ['--tool-ready']);
  assert.equal(L.isSkillDir(b), true);
  assert.equal(L.isSkillDir(skill), false); // the skill root itself is not a brand
});

test('discovery finds the brands of the shared skill (dir = brand folder, skillRoot = skill root) and is usable', () => {
  const r = run(newRoot, 'brands.mjs');
  assert.deepEqual(r.usable.sort(), ['alpha', 'beta']);
  for (const b of r.brands) {
    assert.equal(b.shared, true);
    assert.equal(b.dir, path.join(skill, 'brands', b.id));
    assert.equal(b.skillRoot, skill);
    assert.equal(b.ready, true, JSON.stringify(b.problems));
  }
});

test('the legacy layout still works (dir === skillRoot)', () => {
  const r = run(oldRoot, 'brands.mjs');
  assert.deepEqual(r.usable.sort(), ['alpha', 'beta']);
  for (const b of r.brands) { assert.equal(b.shared, false); assert.equal(b.dir, b.skillRoot); }
});

test('a brand folder whose shared check-skill is not given --brand would fail: the tool passes it', () => {
  const r = spawnSync(process.execPath, [path.join(skill, 'scripts', 'check-skill.mjs'), '--tool-ready'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.equal(run(newRoot, 'social.mjs', 'show', '--brand', 'alpha').check.tool_ready, true);
});

test('list-sources lists the brands inside the shared skill as "brand-content-skills / <id>"; a brand folder path validates', () => {
  const r = run(newRoot, 'skills.mjs', 'list-sources');
  assert.deepEqual(r.sources.map((s) => s.label).sort(), ['brand-content-skills / alpha', 'brand-content-skills / beta']);
  assert.ok(r.sources.every((s) => s.shared && s.ready && s.skillRoot === skill));
  assert.equal(run(newRoot, 'skills.mjs', 'list-sources', '--from', skill).sources.length, 2);
  const v = run(newRoot, 'skills.mjs', 'validate', '--path', path.join(skill, 'brands', 'beta'));
  assert.equal(v.id, 'beta'); assert.equal(v.tool_ready, true);
});

test('link accepts a brand folder of the shared skill; the prompt line names brand folder, skill root and --brand', async () => {
  const copy = path.join(tmp, 'ws-link'); fs.mkdirSync(copy, { recursive: true });
  fs.copyFileSync(path.join(ws, 'metricool-brands.json'), path.join(copy, 'metricool-brands.json'));
  const r = spawnSync(process.execPath, [path.join(tool, 'scripts', 'skills.mjs'), 'link', '--brand', 'Gamma', '--path', path.join(skill, 'brands', 'beta'), '--confirm'], { env: { ...process.env, SA_WORKSPACE: copy, SA_SKILLS_ROOT: newRoot }, encoding: 'utf8' });
  assert.match(r.stdout, /brands\/beta/);
  const { skillLine } = await import('../scripts/prompts.mjs');
  const line = skillLine({ id: 'alpha', dir: path.join(skill, 'brands', 'alpha'), skillRoot: skill, shared: true });
  assert.match(line, /brand folder/); assert.match(line, /skill root/); assert.match(line, /--brand alpha/); assert.match(line, /ONLY this brand/);
  assert.match(skillLine({ id: 'alpha', dir: 'x', skillRoot: 'x', shared: false }), /SKILL: alpha → x \(read its SKILL\.md/);
});

test('relink: dry-run by default, rewrites skill_path <x>-skills to brand-content-skills/brands/<x>, --apply writes a backup', () => {
  const file = path.join(tmp, 'relink', 'metricool-brands.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(path.join(ws, 'metricool-brands.json'), file);
  const before = fs.readFileSync(file, 'utf8');
  const dry = run(newRoot, 'skills.mjs', 'relink', '--from', oldRoot, '--to', newRoot, '--file', file);
  assert.equal(dry.dry_run, true); assert.equal(dry.changed, 2); assert.equal(dry.missing_targets, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), before); // untouched
  assert.equal(dry.changes[0].to, path.join(newRoot, 'brand-content-skills', 'brands', 'alpha').split(path.sep).join('/'));
  const done = run(newRoot, 'skills.mjs', 'relink', '--from', oldRoot, '--to', newRoot, '--file', file, '--apply');
  assert.equal(done.dry_run, false);
  assert.equal(fs.readFileSync(`${file}.bak`, 'utf8'), before);
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(j.brands.map((b) => b.skill_id), ['alpha', 'beta', null]);
  assert.ok(j.brands[0].skill_path.endsWith('/brand-content-skills/brands/alpha'));
  assert.equal(j.brands[2].skill_path, undefined);
  assert.equal(run(newRoot, 'skills.mjs', 'relink', '--from', oldRoot, '--to', newRoot, '--file', file).changed, 0); // idempotent
});

test('relink --apply refuses when a target brand folder is missing', () => {
  const file = path.join(tmp, 'relink2', 'metricool-brands.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(path.join(ws, 'metricool-brands.json'), file);
  const empty = path.join(tmp, 'empty-skills'); fs.mkdirSync(empty, { recursive: true });
  const r = spawnSync(process.execPath, [path.join(tool, 'scripts', 'skills.mjs'), 'relink', '--from', oldRoot, '--to', empty, '--file', file, '--apply'], { env: { ...process.env, SA_WORKSPACE: ws }, encoding: 'utf8' });
  assert.match(r.stdout + r.stderr, /do not exist/);
  assert.ok(!fs.existsSync(`${file}.bak`));
});

// ----- current layout: <repo>/brands/<id> (project + data in one folder), one shared skill in <repo>/skills -----
const repoDir = path.join(tmp, 'cur'), curSkills = path.join(repoDir, 'skills'), curSkill = path.join(curSkills, 'brand-content-skills');
const CUR_CHECK = "import fs from 'node:fs'; import path from 'node:path'; const a = process.argv, i = a.indexOf('--brand'); const id = i > 0 ? a[i + 1] : ''; const ok = id && fs.existsSync(path.join(import.meta.dirname, '..', '..', '..', 'brands', id, 'project', 'social.json')); console.log(ok ? 'ĐẠT' : '  - missing: --brand'); process.exit(ok ? 0 : 1);\n";
write(path.join(curSkill, 'SKILL.md'), '---\nname: brand-content-skills\n---\n');
write(path.join(curSkill, 'scripts', '_brand.mjs'), '// shared\n');
write(path.join(curSkill, 'scripts', 'check-skill.mjs'), CUR_CHECK);
for (const [id, name, blog] of [['alpha', 'Alpha', '111'], ['beta', 'Beta', '222']]) {
  write(path.join(repoDir, 'brands', id, 'project', 'project.md'), '# p\n');
  write(path.join(repoDir, 'brands', id, 'project', 'social.json'), social(name, blog));
  write(path.join(repoDir, 'brands', id, 'catalog.json'), '{"posts":[]}\n');
}

test('current layout: brands/<id> is the brand folder, the shared skill (not a brand) is found beside it', async () => {
  const L = await lib();
  const b = path.join(repoDir, 'brands', 'alpha');
  assert.equal(L.sharedSkillRoot(curSkills), curSkill);
  assert.equal(L.skillRootOf(b), curSkill);
  assert.equal(L.isSharedLayout(b), true);
  assert.equal(L.skillIdOf(b), 'alpha');
  assert.equal(L.isSkillDir(b), true);
  assert.deepEqual(L.skillScriptArgs(b, ['--tool-ready']), ['--tool-ready', '--brand', 'alpha']);
  assert.equal(L.skillLabelOf(b), 'brands / alpha');
  const r = run(curSkills, 'brands.mjs');
  assert.deepEqual(r.usable.sort(), ['alpha', 'beta']);
  assert.deepEqual(r.skipped, []); // the skill folder itself is not reported as a brand
  for (const x of r.brands) { assert.equal(x.dir, path.join(repoDir, 'brands', x.id)); assert.equal(x.skillRoot, curSkill); }
  const s = run(curSkills, 'skills.mjs', 'list-sources');
  assert.deepEqual(s.sources.map((x) => x.label).sort(), ['brands / alpha', 'brands / beta']);
});

test('relink --to-brands: dry-run by default, rewrites old shared and legacy skill_path to <repo>/brands/<id>, --apply writes a backup', () => {
  const file = path.join(tmp, 'relink3', 'metricool-brands.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const old = path.join(curSkill, 'brands', 'alpha').split(path.sep).join('/'), leg = path.join(curSkills, 'beta-skills').split(path.sep).join('/');
  fs.writeFileSync(file, JSON.stringify({ version: 1, account: {}, brands: [{ name: 'Alpha', blog_id: '111', skill_id: 'alpha', skill_path: old }, { name: 'Beta', blog_id: '222', skill_id: 'beta', skill_path: leg }, { name: 'Gamma', blog_id: '333', skill_id: null }] }));
  const before = fs.readFileSync(file, 'utf8'), to = path.join(repoDir, 'brands');
  const env = { ...process.env, SA_WORKSPACE: ws, SA_SKILLS_ROOT: curSkills };
  const go = (...a) => JSON.parse(spawnSync(process.execPath, [path.join(tool, 'scripts', 'skills.mjs'), 'relink', '--to-brands', to, '--file', file, ...a], { env, encoding: 'utf8' }).stdout);
  const dry = go();
  assert.equal(dry.dry_run, true); assert.equal(dry.changed, 2); assert.equal(dry.missing_targets, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(dry.changes[0].to, path.join(to, 'alpha').split(path.sep).join('/'));
  go('--apply');
  assert.equal(fs.readFileSync(`${file}.bak`, 'utf8'), before);
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(j.brands[0].skill_path, path.join(to, 'alpha').split(path.sep).join('/'));
  assert.equal(j.brands[1].skill_path, path.join(to, 'beta').split(path.sep).join('/'));
  assert.equal(go().changed, 0); // idempotent
});
