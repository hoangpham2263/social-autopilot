// Brand skill folders stay where they are; the tool only POINTS to them (nothing is copied). A Metricool brand is linked
// to one brand folder (Tổng quan: Chọn skill / Đổi skill / Ngắt kết nối); the tool then reads that folder. Two layouts:
//   legacy  skills/<id>-skills            (the skill folder is the brand folder)
//   shared  skills/brand-content-skills/brands/<id>   (one skill, one folder per brand; shared scripts at the skill root)
// node scripts/skills.mjs list-sources [--from <dir>]          valid brand folders in <dir> (2 levels deep; shared skills list their brands/*), with readiness
// node scripts/skills.mjs validate --path <brand-or-skill-dir>  is it a brand/skill folder; its check-skill --tool-ready
// node scripts/skills.mjs link --brand "<Metricool brand>" --path <brand-or-skill-dir>
// node scripts/skills.mjs unlink --brand "<Metricool brand>"   the folder is never touched
// node scripts/skills.mjs relink --from <oldSkillsRoot> --to <newSkillsRoot> [--file <metricool-brands.json>] [--apply]
//   migration to the shared layout: rewrites skill_path values <from>/<x>-skills -> <to>/brand-content-skills/brands/<x>;
//   dry-run unless --apply (a .bak copy is written next to the file); --skill <name> picks another shared skill folder name.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { main, out, parseArgs, need, isMain, settings, readJson, SKILL_FILES, isSkillDir, skillIdOf, skillRootOf, isSharedLayout, skillLabelOf, sharedBrandDirs, skillScript, skillScriptArgs, inspectBrand, metricoolBrands, metricoolFile, linkMetricool, linkedDir } from './lib.mjs';

// Where Find looks first: the skills folder of the settings (skillsRoot); any other folder can be typed in.
export const defaultSource = () => settings().skillsRoot;
const ID = /^[a-z0-9][a-z0-9-]*$/;
const brandName = (dir) => { try { return readJson(path.join(dir, 'project', 'social.json')).brand || ''; } catch { return ''; } };

// Never searched: dependencies, git, a skill's own workspace, hidden folders.
const SKIP = new Set(['node_modules', '.git', 'workspace']);
const subdirs = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name)).map((e) => path.join(dir, e.name)); } catch { return []; } };

// The skill's own check, async (so many folders are checked in parallel): enabled + check-skill --tool-ready.
function readiness(dir) {
  let enabled = false;
  try { enabled = readJson(path.join(dir, 'project', 'social.json')).enabled === true; } catch {}
  const checker = skillScript(dir, 'check-skill.mjs'); // shared layout: at the skill root, called with --brand <id>
  if (!fs.existsSync(checker)) return Promise.resolve({ ready: false, enabled, problems: ['skill thiếu scripts/check-skill.mjs'] });
  return new Promise((done) => {
    let text = '';
    const c = spawn(process.execPath, [checker, ...skillScriptArgs(dir, ['--tool-ready'])], { cwd: skillRootOf(dir), windowsHide: true });
    c.stdout.on('data', (d) => { text += d; });
    c.on('error', (e) => done({ ready: false, enabled, problems: [e.message] }));
    c.on('close', (code) => {
      const problems = String(text).split(/\r?\n/).filter((l) => /^\s+- |^LỖI /.test(l)).map((l) => l.replace(/^\s+- /, 'missing: ').trim());
      if (!enabled) problems.unshift('Not enabled (social.json: enabled)');
      done({ ready: code === 0 && enabled, enabled, problems });
    });
  });
}

// Valid brand folders in <from>: <from> itself when it is one, else its sub-folders and their sub-folders (2 levels, so
// a workspace folder finds its skills sub-folders), each with its readiness and the Metricool brand linked to that folder.
// A shared skill (SKILL.md + brands/) lists its brands (label "brand-content-skills / dreamyvows"), never the skill itself.
export async function listSources(from = '') {
  const dir = path.resolve(String(from || defaultSource()));
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`Folder not found: ${dir}`);
  let links = [];
  try { links = metricoolBrands().brands || []; } catch {}
  const found = [], skipped = [];
  const brandsOf = (d) => sharedBrandDirs(d).filter(isSkillDir);
  if (isSkillDir(dir)) found.push(dir);
  else if (sharedBrandDirs(dir).length) found.push(...brandsOf(dir));
  else for (const d of subdirs(dir)) {
    if (isSkillDir(d)) { found.push(d); continue; }
    if (sharedBrandDirs(d).length) { found.push(...brandsOf(d)); continue; }
    const deeper = subdirs(d).flatMap((x) => isSkillDir(x) ? [x] : brandsOf(x));
    if (deeper.length) found.push(...deeper); else if (fs.existsSync(path.join(d, 'SKILL.md'))) skipped.push({ dir: d, reason: `thiếu ${SKILL_FILES.filter((f) => !fs.existsSync(path.join(d, f))).join(', ')}` });
  }
  const sources = await Promise.all(found.map(async (d) => {
    const id = skillIdOf(d);
    const linked = links.find((m) => m.skill_id && path.resolve(linkedDir(m)).toLowerCase() === path.resolve(d).toLowerCase());
    return { id, dir: d, skillRoot: skillRootOf(d), shared: isSharedLayout(d), label: skillLabelOf(d), brand: brandName(d), valid_id: ID.test(id), linked_to: linked?.name || null, ...(await readiness(d)) };
  }));
  return { from: dir, sources, skipped };
}

export function validate(dir) {
  const full = path.resolve(String(dir || ''));
  if (!isSkillDir(full)) throw new Error(`${full} is not a brand/skill folder (needs ${SKILL_FILES.join(', ')}; shared layout: SKILL.md two levels above the brand folder).`);
  const b = inspectBrand(full);
  return { id: b.id, dir: full, skillRoot: b.skillRoot, shared: b.shared, brand: b.brand || '', enabled: b.enabled, tool_ready: b.ready, problems: b.problems };
}

// Migration to the shared layout. relinkPaths is pure on the parsed config; relinkFile does the file work.
// Every skill_path inside <from> shaped <from>/<x>-skills becomes <to>/<skill>/brands/<x>; skill_id stays (x is the same id).
export function relinkPaths(cfg, from, to, skill = 'brand-content-skills') {
  const norm = (p) => path.resolve(p).split(path.sep).join('/').replace(/\/+$/, '');
  const f = norm(from).toLowerCase(), changes = [];
  const brands = (cfg.brands || []).map((b) => {
    if (!b.skill_path) return b;
    const p = norm(b.skill_path), m = p.toLowerCase().startsWith(f + '/') && p.slice(f.length + 1).match(/^([^/]+)-skills$/i);
    if (!m) return b;
    const next = `${norm(to)}/${skill}/brands/${m[1]}`;
    changes.push({ name: b.name, skill_id: b.skill_id, from: b.skill_path, to: next, target_exists: isSkillDir(next) });
    return { ...b, skill_path: next };
  });
  return { cfg: { ...cfg, brands }, changes };
}
export function relinkFile({ file, from, to, skill, apply = false }) {
  const cfg = readJson(file);
  if (!cfg || !Array.isArray(cfg.brands)) throw new Error(`${file} is not a metricool-brands.json (no brands[]).`);
  const { cfg: next, changes } = relinkPaths(cfg, from, to, skill);
  const missing = changes.filter((c) => !c.target_exists).length;
  if (apply) {
    if (missing) throw new Error(`${missing} target brand folder(s) do not exist under ${to}; nothing written (run without --apply to see them).`);
    if (changes.length) { fs.copyFileSync(file, `${file}.bak`); fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n'); }
  }
  return { file, dry_run: !apply, changed: changes.length, missing_targets: missing, changes, ...(apply && changes.length ? { backup: `${file}.bak` } : {}) };
}

if (isMain(import.meta.url)) main(async () => {
  const args = parseArgs();
  const cmd = args._[0];
  if (cmd === 'list-sources') return out(await listSources(args.from && args.from !== true ? String(args.from) : defaultSource()));
  if (cmd === 'validate') return out(validate(need(args, 'path')));
  if (cmd === 'link') return out({ metricool: linkMetricool(need(args, 'brand'), need(args, 'path'), { confirm: args.confirm === true }) });
  if (cmd === 'unlink') return out({ metricool: linkMetricool(need(args, 'brand'), null) });
  if (cmd === 'relink') return out(relinkFile({ file: args.file && args.file !== true ? path.resolve(String(args.file)) : metricoolFile(), from: need(args, 'from'), to: need(args, 'to'), skill: args.skill && args.skill !== true ? String(args.skill) : undefined, apply: args.apply === true }));
  throw new Error('Lệnh: list-sources [--from <dir>] | validate --path <dir> | link --brand <tên> --path <dir> [--confirm] | unlink --brand <tên> | relink --from <skillsRoot cũ> --to <skillsRoot mới> [--file <json>] [--apply] (mặc định chỉ xem trước)');
});
