// Brand skill folders stay where they are; the tool only POINTS to them (nothing is copied). A Metricool brand is linked
// to one skill folder (Tổng quan: Chọn skill / Đổi skill / Ngắt kết nối); the tool then reads and writes that folder.
// node scripts/skills.mjs list-sources [--from <dir>]          valid skill folders in <dir> (2 levels deep), with readiness
// node scripts/skills.mjs validate --path <skill-dir>           is it a skill folder; its check-skill --tool-ready
// node scripts/skills.mjs link --brand "<Metricool brand>" --path <skill-dir>
// node scripts/skills.mjs unlink --brand "<Metricool brand>"   the folder is never touched
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { main, out, parseArgs, need, isMain, settings, readJson, SKILL_FILES, isSkillDir, skillIdOf, inspectBrand, metricoolBrands, linkMetricool, linkedDir } from './lib.mjs';

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
  const checker = path.join(dir, 'scripts', 'check-skill.mjs');
  if (!fs.existsSync(checker)) return Promise.resolve({ ready: false, enabled, problems: ['skill thiếu scripts/check-skill.mjs'] });
  return new Promise((done) => {
    let text = '';
    const c = spawn(process.execPath, [checker, '--tool-ready'], { cwd: dir, windowsHide: true });
    c.stdout.on('data', (d) => { text += d; });
    c.on('error', (e) => done({ ready: false, enabled, problems: [e.message] }));
    c.on('close', (code) => {
      const problems = String(text).split(/\r?\n/).filter((l) => /^\s+- |^LỖI /.test(l)).map((l) => l.replace(/^\s+- /, 'missing: ').trim());
      if (!enabled) problems.unshift('Not enabled (social.json: enabled)');
      done({ ready: code === 0 && enabled, enabled, problems });
    });
  });
}

// Valid skill folders in <from>: <from> itself when it is one, else its sub-folders and their sub-folders (2 levels, so
// a workspace folder finds its skills sub-folders), each with its readiness and the Metricool brand linked to that folder.
export async function listSources(from = '') {
  const dir = path.resolve(String(from || defaultSource()));
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`Folder not found: ${dir}`);
  let links = [];
  try { links = metricoolBrands().brands || []; } catch {}
  const found = [], skipped = [];
  if (isSkillDir(dir)) found.push(dir);
  else for (const d of subdirs(dir)) {
    if (isSkillDir(d)) { found.push(d); continue; }
    const deeper = subdirs(d).filter(isSkillDir);
    if (deeper.length) found.push(...deeper); else if (fs.existsSync(path.join(d, 'SKILL.md'))) skipped.push({ dir: d, reason: `thiếu ${SKILL_FILES.filter((f) => !fs.existsSync(path.join(d, f))).join(', ')}` });
  }
  const sources = await Promise.all(found.map(async (d) => {
    const id = skillIdOf(d);
    const linked = links.find((m) => m.skill_id && path.resolve(linkedDir(m)).toLowerCase() === path.resolve(d).toLowerCase());
    return { id, dir: d, brand: brandName(d), valid_id: ID.test(id), linked_to: linked?.name || null, ...(await readiness(d)) };
  }));
  return { from: dir, sources, skipped };
}

export function validate(dir) {
  const full = path.resolve(String(dir || ''));
  if (!isSkillDir(full)) throw new Error(`${full} is not a skill folder (needs ${SKILL_FILES.join(', ')}).`);
  const b = inspectBrand(full);
  return { id: b.id, dir: full, brand: b.brand || '', enabled: b.enabled, tool_ready: b.ready, problems: b.problems };
}

if (isMain(import.meta.url)) main(async () => {
  const args = parseArgs();
  const cmd = args._[0];
  if (cmd === 'list-sources') return out(await listSources(args.from && args.from !== true ? String(args.from) : defaultSource()));
  if (cmd === 'validate') return out(validate(need(args, 'path')));
  if (cmd === 'link') return out({ metricool: linkMetricool(need(args, 'brand'), need(args, 'path')) });
  if (cmd === 'unlink') return out({ metricool: linkMetricool(need(args, 'brand'), null) });
  throw new Error('Lệnh: list-sources [--from <dir>] | validate --path <dir> | link --brand <tên> --path <dir> | unlink --brand <tên>');
});
