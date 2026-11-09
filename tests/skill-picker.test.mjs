// Skill picker (Tổng quan, Chọn skill / Đổi skill): list-sources searches 2 levels deep and reports readiness per folder;
// a link is by path, and a renamed/moved folder shows as missing (no fallback to another folder). Temp dirs only.
// npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-picker-test-'));
const top = path.join(tmp, 'vaniecom-workspace'), skills = path.join(top, 'skills'), ws = path.join(tmp, 'workspace');
const env = { ...process.env, SA_WORKSPACE: ws, SA_SKILLS_ROOT: skills };
const run = (script, ...args) => {
  const r = spawnSync(process.execPath, [path.join(tool, 'scripts', script), ...args], { env, encoding: 'utf8', windowsHide: true });
  try { return JSON.parse(r.stdout); } catch { throw new Error(`${script} ${args.join(' ')}: ${r.stdout}${r.stderr}`); }
};
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
// ready: check-skill exits 0 and enabled; otherwise it prints the skill's "  - <item>" lines and exits 1.
function fakeSkill(dir, { enabled = true, ok = true } = {}) {
  write(path.join(dir, 'SKILL.md'), '---\nname: x\n---\n');
  write(path.join(dir, 'project', 'project.md'), '# p\n');
  write(path.join(dir, 'project', 'social.json'), JSON.stringify({ brand: path.basename(dir), enabled }));
  write(path.join(dir, 'scripts', 'check-skill.mjs'), ok ? "console.log('ĐẠT');\n" : "console.log('CHƯA SẴN SÀNG\\n  - nguồn tham khảo\\n  - kênh');\nprocess.exit(1);\n");
}
fakeSkill(path.join(skills, 'good-skills'));
fakeSkill(path.join(skills, 'half-skills'), { ok: false });
fakeSkill(path.join(skills, 'off-skills'), { enabled: false });
fakeSkill(path.join(top, 'node_modules', 'pkg-skills'));
fakeSkill(path.join(top, 'a', 'b', 'deep-skills')); // 3 levels: not found
write(path.join(ws, 'metricool-brands.json'), JSON.stringify({ version: 1, account: {}, brands: [{ name: 'Good MC', blog_id: '1', timezone: 'Asia/Ho_Chi_Minh', networks: [], skill_id: null }] }));

test('list-sources finds skills 2 levels deep, skips node_modules, reports readiness', () => {
  const r = run('skills.mjs', 'list-sources', '--from', top);
  assert.equal(r.ok, true, JSON.stringify(r));
  const by = Object.fromEntries(r.sources.map((x) => [x.id, x]));
  assert.deepEqual(Object.keys(by).sort(), ['good', 'half', 'off']);
  assert.equal(by.good.ready, true);
  assert.equal(by.half.ready, false);
  assert.deepEqual(by.half.problems, ['missing: nguồn tham khảo', 'missing: kênh']);
  assert.equal(by.off.ready, false);
  assert.ok(by.off.problems.some((p) => /Not enabled/.test(p)));
});

test('link is by path; a renamed folder shows as missing, with no fallback', () => {
  const dir = path.join(skills, 'good-skills');
  assert.equal(run('skills.mjs', 'link', '--brand', 'Good MC', '--path', dir).ok, true);
  const m = JSON.parse(fs.readFileSync(path.join(ws, 'metricool-brands.json'), 'utf8')).brands[0];
  assert.equal(path.resolve(m.skill_path), dir);
  assert.equal(run('skills.mjs', 'list-sources', '--from', skills).sources.find((x) => x.id === 'good').linked_to, 'Good MC');
  // Rename the linked folder: the brand shows the folder as missing (skill_path_missing) and its skill is gone.
  fs.renameSync(dir, path.join(skills, 'good-renamed'));
  const brands = run('brands.mjs');
  assert.ok(!brands.brands.some((b) => b.id === 'good'));
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', "import { brandOverview } from './scripts/lib.mjs'; console.log(JSON.stringify(brandOverview().brands[0]));"], { cwd: tool, env, encoding: 'utf8', windowsHide: true });
  const o = JSON.parse(r.stdout);
  assert.equal(o.skill_path_missing, true);
  assert.equal(o.skill, null);
  // Đổi skill: re-point to the renamed folder (its id is now "good-renamed").
  assert.equal(run('skills.mjs', 'link', '--brand', 'Good MC', '--path', path.join(skills, 'good-renamed')).ok, true);
  assert.ok(run('brands.mjs').brands.some((b) => b.id === 'good-renamed'));
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
