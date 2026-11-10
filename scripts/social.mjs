// A brand's project/social.json, read only (the UI's Brand panel uses the same function), with what the skill's own
// scripts/check-skill.mjs --tool-ready says is still missing. Skills are READ-ONLY for social-autopilot (user,
// 10/11/2026): the tool never writes into a skill folder, so "set" is refused; edit the skill itself.
//   node scripts/social.mjs show --brand <id>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main, out, isMain, parseArgs, need, discoverBrands, readJson, writeText, withLock, secretProblems } from './lib.mjs';

// Secret detection lives in lib.mjs (shared with metricool-brands.json): only real secret keys (token, secret, password,
// api_key, access_key, x-mc-auth, bearer, ...) and token-looking values; "author" or "session" alone are fine.
export { secretProblems };

function brandDir(id) {
  const { brands, root } = discoverBrands();
  const b = brands.find((x) => x.id === id);
  if (!b) throw new Error(`Không có thương hiệu "${id}" trong ${root}.`);
  return b.dir;
}

// The skill's own check: errors (LỖI), tool-ready missing items, warnings.
export function checkSkill(dir) {
  const run = (args) => spawnSync(process.execPath, [path.join(dir, 'scripts', 'check-skill.mjs'), ...args], { cwd: dir, encoding: 'utf8', windowsHide: true });
  const plain = run([]);
  const ready = run(['--tool-ready']);
  const lines = (r, re) => String(r.stdout).split(/\r?\n/).filter((l) => re.test(l));
  return {
    ok: plain.status === 0,
    errors: lines(plain, /^LỖI /).map((l) => l.slice(4).trim()),
    warnings: lines(plain, /^CẢNH BÁO /).map((l) => l.slice(9).trim()),
    tool_ready: ready.status === 0,
    missing: lines(ready, /^\s+- /).map((l) => l.replace(/^\s+- /, '').trim()),
  };
}

export function readSocial(id) {
  const dir = brandDir(id);
  const file = path.join(dir, 'project', 'social.json');
  return { id, dir, file, social: readJson(file), check: checkSkill(dir) };
}

// Skills are read-only for the tool: saving is refused (kept as a function so the app answers with a clear message).
export function saveSocial(id) {
  brandDir(id);
  throw new Error('Skill chỉ đọc: social-autopilot không bao giờ ghi vào thư mục skill. Sửa project/social.json trong skill (rồi chạy scripts/check-skill.mjs --tool-ready của skill).');
}

if (isMain(import.meta.url)) main(() => {
  const args = parseArgs();
  const cmd = args._[0];
  if (cmd === 'show') return out(readSocial(need(args, 'brand')));
  if (cmd === 'set') return saveSocial(need(args, 'brand'));
  throw new Error('Lệnh: show (skill chỉ đọc: không có set)');
});
