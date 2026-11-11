// Finds the Claude Code CLI on any machine, without hard-coded user names. Order: the setting claudeCli.command, PATH,
// the newest VS Code extension binary, then the usual install folders. Only looks at files; never runs anything but `where`/`which`.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform as osPlatform } from "node:os";

const defaultWhich = (name, plat) => { try { const out = execFileSync(plat === "win32" ? "where" : "which", [name], { encoding: "utf8", windowsHide: true, timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }); return out.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || ""; } catch { return ""; } };
const versionOf = (name) => (/claude-code-(\d+(?:\.\d+)*)/.exec(name)?.[1] || "0").split(".").map(Number);
export const compareVersions = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; };

// Extension folders (newest first): <home>/.vscode/extensions/anthropic.claude-code-<version>[-platform]/resources/native-binary/claude(.exe)
export function vscodeBinaries({ plat, home, exists, list }) {
  const dir = join(home, ".vscode", "extensions");
  let names = [];
  try { names = list(dir); } catch {}
  const exe = plat === "win32" ? "claude.exe" : "claude";
  return names.filter((n) => /^anthropic\.claude-code-\d/.test(n)).sort((a, b) => compareVersions(versionOf(b), versionOf(a)))
    .map((n) => join(dir, n, "resources", "native-binary", exe)).filter((p) => exists(p));
}

export function findClaude({ settings = {}, plat = osPlatform(), env = process.env, home = homedir(), exists = existsSync, which = defaultWhich, list = (d) => readdirSync(d) } = {}) {
  const set = String(settings?.claudeCli?.command || "").trim();
  if (set) { const w = which(set, plat); const hit = exists(set) ? set : w && exists(w) ? w : ""; return hit ? { found: true, path: hit } : { found: false, path: "" }; }
  const w = which("claude", plat);
  if (w && exists(w)) return { found: true, path: w };
  const ext = vscodeBinaries({ plat, home, exists, list })[0];
  if (ext) return { found: true, path: ext };
  const fixed = plat === "win32"
    ? [env.APPDATA && join(env.APPDATA, "npm", "claude.cmd"), env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Programs", "claude", "claude.exe"), join(home, ".local", "bin", "claude.exe"), join(home, ".claude", "local", "claude.exe")]
    : [join(home, ".local", "bin", "claude"), join(home, ".claude", "local", "claude"), "/usr/local/bin/claude", "/opt/homebrew/bin/claude"];
  for (const p of fixed.filter(Boolean)) if (exists(p)) return { found: true, path: p };
  return { found: false, path: "" };
}
