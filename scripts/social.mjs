// A brand's project/social.json, read and saved the safe way (the UI's Brand settings page uses the same functions).
// Save: refuses anything that looks like a token/password/cookie, writes atomically under a lock, then runs the skill's
// own scripts/check-skill.mjs; if the new file brings a new error, the previous file is put back. Then reports what
// check-skill --tool-ready says is still missing.
//   node scripts/social.mjs show --brand <id>
//   node scripts/social.mjs set  --brand <id> --file <new social.json>
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

export function saveSocial(id, social) {
  if (!social || typeof social !== 'object' || Array.isArray(social)) throw new Error('social.json phải là một object JSON.');
  const secrets = secretProblems(social);
  if (secrets.length) throw new Error(`Không lưu: ${secrets.join('; ')}. Không bao giờ ghi token/mật khẩu vào skill.`);
  const dir = brandDir(id);
  const file = path.join(dir, 'project', 'social.json');
  return withLock(file, () => {
    const before = checkSkill(dir);
    const previous = fs.readFileSync(file, 'utf8');
    writeText(file, JSON.stringify(social, null, 2) + '\n');
    const after = checkSkill(dir);
    const added = after.errors.filter((e) => !before.errors.includes(e));
    if (added.length) {
      writeText(file, previous);
      return { saved: false, restored: true, errors: added, missing: after.missing };
    }
    return { saved: true, file, errors_before: before.errors, tool_ready: after.tool_ready, missing: after.missing, warnings: after.warnings };
  });
}

if (isMain(import.meta.url)) main(() => {
  const args = parseArgs();
  const cmd = args._[0];
  if (cmd === 'show') return out(readSocial(need(args, 'brand')));
  if (cmd === 'set') {
    const r = saveSocial(need(args, 'brand'), readJson(path.resolve(need(args, 'file'))));
    if (!r.saved) throw Object.assign(new Error(`Không lưu (đã trả lại file cũ): ${r.errors.join('; ')}`));
    return out(r);
  }
  throw new Error('Lệnh: show | set');
});
