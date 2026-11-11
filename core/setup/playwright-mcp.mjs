// Playwright MCP extension token, set through the official `claude mcp` command (never by editing the MCP config here).
// The token is stored only in workspace/secrets/playwright-mcp.json (gitignored, owner-only) so "Re-apply saved token"
// works; it is never logged, put in a backup, a fixture or an API response or error (reads show "••••" + the last 4
// characters). The only other file touched is the user's own MCP config, copied next to itself as
// <config>.sa-backup-<timestamp> before any change and restored on failure.
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { findTool, onWindows, toolEnv } from "../platform.mjs";

export const TOKEN_KEY = "PLAYWRIGHT_MCP_EXTENSION_TOKEN";
export const PROFILE_KEY = "PLAYWRIGHT_MCP_PROFILE_DIR_NAME";
const SCOPES = ["user", "local", "project"];

export const mask = (v) => { const s = String(v || ""); return s ? "••••" + s.slice(-4) : ""; };
// Replace every occurrence of the secrets in a text (CLI errors, command lines) by their masked form.
export const scrub = (text, secrets = []) => secrets.filter((s) => s && String(s).length >= 4).reduce((t, s) => t.split(String(s)).join(mask(s)), String(text ?? ""));

// ----- the saved token (workspace/secrets/playwright-mcp.json) -----
export const secretFile = (dir) => join(dir, "secrets", "playwright-mcp.json");
export function readSaved(dir) { try { return String(JSON.parse(readFileSync(secretFile(dir), "utf8")).token || ""); } catch { return ""; } }
export function saveToken(dir, token) { const f = secretFile(dir); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify({ token }), { mode: 0o600 }); }
export function forgetToken(dir) { rmSync(secretFile(dir), { force: true }); }

// ----- finding the claude CLI -----
export function findClaude({ override = "", env = toolEnv, home = homedir(), win = onWindows, exists = existsSync, list = readdirSync, which = findTool } = {}) {
  if (override && exists(override)) return override;
  const onPath = which("claude", env);
  if (onPath) return onPath;
  const ext = join(home, ".vscode", "extensions");
  try {
    const dirs = list(ext).filter((d) => /^anthropic\.claude-code-/.test(d)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const d of dirs) { const p = join(ext, d, "resources", "native-binary", win ? "claude.exe" : "claude"); if (exists(p)) return p; }
  } catch {}
  const lad = process.env.LOCALAPPDATA || join(home, "AppData", "Local"), appd = process.env.APPDATA || join(home, "AppData", "Roaming");
  const fixed = win
    ? [join(home, ".local", "bin", "claude.exe"), join(home, ".local", "bin", "claude"), join(home, ".claude", "local", "claude.exe"), join(appd, "npm", "claude.cmd"), join(lad, "AnthropicClaude", "claude.exe"), join(lad, "Programs", "claude", "claude.exe")]
    : [join(home, ".local", "bin", "claude"), join(home, ".claude", "local", "claude"), join(home, ".npm-global", "bin", "claude"), "/usr/local/bin/claude", "/opt/homebrew/bin/claude", "/usr/bin/claude"];
  for (const p of fixed) if (exists(p)) return p;
  return "";
}

// ----- parsing `claude mcp list` (names only, defensive: a line that does not look like "<name>: <rest>" is skipped) -----
export function parseList(text) {
  const names = [];
  for (const l of String(text || "").split(/\r?\n/)) { const m = /^(\S+?):\s+\S/.exec(l.trim()); if (m && /^[A-Za-z0-9_.:@-]+$/.test(m[1]) && !names.includes(m[1])) names.push(m[1]); }
  return names;
}
export const validName = (n) => /^[A-Za-z0-9_-]{1,40}$/.test(String(n || ""));
export const guessServer = (names) => names.find((n) => /playwright/i.test(n)) || "";

// ----- parsing `claude mcp get <name>` -----
// Env values stay inside `_env` (needed to rebuild the command); callers return publicView() only.
export function parseGet(text) {
  const lines = String(text || "").split(/\r?\n/);
  const field = (name) => { const l = lines.find((x) => new RegExp(`^\\s*${name}:`, "i").test(x)); return l ? l.replace(/^[^:]*:/, "").trim() : ""; };
  const command = field("Command");
  const args = field("Args") ? field("Args").split(/\s+/).filter(Boolean) : [];
  const env = {};
  const at = lines.findIndex((x) => /^\s*Environment:/i.test(x));
  if (at >= 0) for (const l of lines.slice(at + 1)) { const m = /^\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(l); if (!m) break; env[m[1]] = m[2]; }
  let scope = (/ -s (user|local|project)\b/.exec(String(text)) || [])[1] || "";
  if (!scope) { const s = field("Scope").toLowerCase(); scope = /^user/.test(s) ? "user" : /^project/.test(s) ? "project" : /^local/.test(s) ? "local" : ""; }
  return { found: !!command, command, args, scope, _env: env };
}
export function publicView(p, cli = "") {
  const tok = p._env?.[TOKEN_KEY] || "";
  const all = [p.command, ...p.args].join(" ");
  return { found: !!p.found, command: p.command, args: p.args, env_keys: Object.keys(p._env || {}), scope: p.scope, has_token: !!tok, token_tail: mask(tok),
    profile_dir: p._env?.[PROFILE_KEY] || (/--profile-dir-name[= ]?(\S+)/.exec(all) || [])[1] || "", extension_mode: /--extension\b/.test(all) || !!tok, cli };
}

// ----- the command lines: remove then add, keeping every existing env var and argument -----
export function buildCommands(p, name, { token = "", profile_dir = "" } = {}, masked = false) {
  const env = { ...p._env };
  if (token) env[TOKEN_KEY] = token;
  if (profile_dir) env[PROFILE_KEY] = profile_dir;
  const eargs = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${masked && k === TOKEN_KEY ? mask(v) : v}`]);
  return { remove: ["mcp", "remove", name, "-s", p.scope], add: ["mcp", "add", name, "-s", p.scope, ...eargs, "--", p.command, ...p.args] };
}

// Fresh entry: claude mcp add <name> -s user [-e ...] -- npx @playwright/mcp@latest --extension (cmd /c npx on Windows).
export function buildAdd(name, { token = "", profile_dir = "" } = {}, masked = false, win = onWindows) {
  const env = [...(token ? [[TOKEN_KEY, masked ? mask(token) : token]] : []), ...(profile_dir ? [[PROFILE_KEY, profile_dir]] : [])];
  return ["mcp", "add", name, "-s", "user", ...env.flatMap(([k, v]) => ["-e", `${k}=${v}`]), "--", ...(win ? ["cmd", "/c", "npx"] : ["npx"]), "@playwright/mcp@latest", "--extension"];
}

// ----- backup of the user's MCP config (next to it, never inside this app) -----
export const configFile = (home = homedir()) => join(home, ".claude.json");
const stamp = () => new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 17);
export function backup(home = homedir(), now = stamp()) {
  const src = configFile(home);
  if (!existsSync(src)) throw new Error("The Claude Code config file (~/.claude.json) was not found, nothing to back up.");
  const dest = `${src}.sa-backup-${now}`;
  copyFileSync(src, dest);
  return dest;
}
export function newestBackup(home = homedir()) {
  const f = basename(configFile(home));
  const names = readdirSync(dirname(configFile(home))).filter((n) => n.startsWith(`${f}.sa-backup-`)).sort();
  return names.length ? join(dirname(configFile(home)), names[names.length - 1]) : "";
}
export function restore(home = homedir()) {
  const b = newestBackup(home);
  if (!b) throw new Error("No backup found next to ~/.claude.json (.sa-backup-*).");
  copyFileSync(b, configFile(home));
  return b;
}

// ----- the API -----
const defaultRun = (cli, args) => new Promise((done) => execFile(cli, args, { windowsHide: true, timeout: 60000, env: toolEnv, maxBuffer: 4 << 20 },
  (err, stdout, stderr) => done({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, out: String(stdout || ""), err: String(stderr || err?.message || "") })));

export function createPlaywrightMcp({ getSettings = () => ({}), run = defaultRun, home = homedir(), workspaceDir, find = findClaude, hasNpx = () => !!findTool("npx", toolEnv) } = {}) {
  let picked = ""; // the server name status/apply work on (set by status({name}) / apply({name}))
  const name = () => picked || String(getSettings().playwright_mcp?.name || "");
  const listServers = async (cli) => { const r = await run(cli, ["mcp", "list"]); return parseList(r.out); };
  const cliPath = () => find({ override: String(getSettings().claudeCli?.command || ""), home });
  const current = async (cli) => { const r = await run(cli, ["mcp", "get", name()]); return { r, p: parseGet(r.out) }; };

  async function status({ name: want = "" } = {}) {
    const saved = mask(readSaved(workspaceDir));
    const cli = cliPath();
    if (!cli) return { found: false, cli: "", servers: [], saved_tail: saved, message: "The claude CLI was not found (PATH, npm global, ~/.local/bin, VS Code extension). Set claudeCli.command in workspace/settings.json." };
    const servers = await listServers(cli);
    if (want && validName(want)) picked = want;
    if (!servers.includes(picked)) { const s = String(getSettings().playwright_mcp?.name || ""); picked = servers.includes(s) ? s : guessServer(servers); }
    const npx = hasNpx();
    if (!picked) return { found: false, cli, servers, name: "", no_playwright: true, npx, default_add_name: "playwright-sa", saved_tail: saved, message: "No Playwright MCP server is configured for the claude CLI. Add one here (Add Playwright MCP) or pick another server." };
    const { r, p } = await current(cli);
    if (r.code !== 0 || !p.found) return { found: false, cli, servers, name: name(), npx, saved_tail: saved, message: `No MCP server "${name()}" found (claude mcp get failed).` };
    return { ...publicView(p, cli), name: name(), servers, npx, saved_tail: saved };
  }

  // token empty: the saved token is used (Re-apply saved token). A new token is saved only after a verified apply.
  async function apply({ token = "", profile_dir = "", confirm = false, dry_run = false, name: want = "" } = {}) {
    if (confirm !== true) throw new Error("Not confirmed (confirm:true is required).");
    if (want) { if (!validName(want)) throw new Error("Invalid server name."); picked = want; }
    if (!name()) throw new Error("Pick the MCP server first (or use Add Playwright MCP).");
    const typed = String(token || "").trim(); profile_dir = String(profile_dir || "").trim();
    const use = typed || readSaved(workspaceDir);
    if (!use && !profile_dir) throw new Error("Enter a token or a Chrome profile folder (no saved token).");
    if (/\s/.test(use) || /[\r\n]/.test(profile_dir)) throw new Error("The token must not contain spaces or line breaks.");
    const secrets = [use];
    try {
      const cli = cliPath();
      if (!cli) throw new Error("The claude CLI was not found. Set claudeCli.command in workspace/settings.json.");
      const { p } = await current(cli);
      if (!p.found) throw new Error(`Cannot read the current "${name()}" MCP definition (no command parsed); nothing was changed.`);
      if (!SCOPES.includes(p.scope)) throw new Error("Cannot tell the scope of the MCP entry; nothing was changed.");
      secrets.push(...Object.values(p._env));
      const cmds = buildCommands(p, name(), { token: use, profile_dir });
      const shown = buildCommands(p, name(), { token: use, profile_dir }, true);
      const line = (a) => [cli, ...a].map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(" ");
      if (dry_run) return { ok: true, dry_run: true, commands: [line(shown.remove), scrub(line(shown.add), secrets)] };
      const bak = backup(home);
      const undo = async (why) => { let restored = false; try { restore(home); restored = true; } catch {} throw new Error(`${why} ${restored ? `The MCP config was restored from ${bak}.` : `Restore FAILED; backup is at ${bak}.`}`); };
      const rm = await run(cli, cmds.remove);
      if (rm.code !== 0) await undo(`claude mcp remove failed: ${rm.err.split(/\r?\n/)[0]}`);
      const add = await run(cli, cmds.add);
      if (add.code !== 0) await undo(`claude mcp add failed: ${add.err.split(/\r?\n/)[0]}`);
      const after = parseGet((await run(cli, ["mcp", "get", name()])).out);
      const want = use || p._env[TOKEN_KEY] || "";
      if (!after.found || (want && mask(after._env[TOKEN_KEY]) !== mask(want)) || (profile_dir && after._env[PROFILE_KEY] !== profile_dir)) await undo("Verification failed after applying.");
      if (typed) saveToken(workspaceDir, typed);
      return { ok: true, backup_path: bak, restart_needed: true, token_tail: mask(after._env[TOKEN_KEY]) };
    } catch (e) { throw new Error(scrub(e.message, secrets)); }
  }

  // New entry when no Playwright server exists. Same safeguards: confirm, preview, config backup, restore on failure, token never echoed.
  async function add({ name: nm = "playwright-sa", token = "", profile_dir = "", confirm = false, dry_run = false } = {}) {
    if (confirm !== true) throw new Error("Not confirmed (confirm:true is required).");
    nm = String(nm || "playwright-sa").trim(); profile_dir = String(profile_dir || "").trim();
    if (!validName(nm)) throw new Error("The server name may only use letters, digits, - and _ (max 40).");
    const typed = String(token || "").trim(); const use = typed || readSaved(workspaceDir);
    if (/\s/.test(use) || /[\r\n]/.test(profile_dir)) throw new Error("The token must not contain spaces or line breaks.");
    const secrets = [use];
    try {
      if (!hasNpx()) throw new Error("npx was not found on PATH. Install Node.js (it includes npx), then try again.");
      const cli = cliPath();
      if (!cli) throw new Error("The claude CLI was not found. Set claudeCli.command in workspace/settings.json.");
      if ((await listServers(cli)).includes(nm)) throw new Error(`An MCP server named "${nm}" already exists; pick another name or use Apply on it.`);
      const line = (a) => [cli, ...a].map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(" ");
      if (dry_run) return { ok: true, dry_run: true, commands: [scrub(line(buildAdd(nm, { token: use, profile_dir }, true)), secrets)], note: `Tools will be named mcp__${nm}__* and may need allow rules.` };
      const bak = existsSync(configFile(home)) ? backup(home) : "";
      const undo = async (why) => { let restored = false; try { if (bak) restore(home); else await run(cli, ["mcp", "remove", nm, "-s", "user"]); restored = true; } catch {} throw new Error(`${why} ${restored ? "The MCP config was restored." : "Restore FAILED" + (bak ? `; backup is at ${bak}` : "") + "."}`); };
      const r = await run(cli, buildAdd(nm, { token: use, profile_dir }));
      if (r.code !== 0) await undo(`claude mcp add failed: ${r.err.split(/\r?\n/)[0]}`);
      const after = parseGet((await run(cli, ["mcp", "get", nm])).out);
      if (!after.found || (use && mask(after._env[TOKEN_KEY]) !== mask(use))) await undo("Verification failed after adding.");
      if (typed) saveToken(workspaceDir, typed);
      picked = nm;
      return { ok: true, backup_path: bak, restart_needed: true, name: nm, token_tail: mask(after._env[TOKEN_KEY]), note: `Tools are named mcp__${nm}__* and may need allow rules.` };
    } catch (e) { throw new Error(scrub(e.message, secrets)); }
  }

  function restoreApi({ confirm = false, dry_run = false } = {}) {
    if (confirm !== true) throw new Error("Not confirmed (confirm:true is required).");
    if (dry_run) return { ok: true, dry_run: true, backup_path: newestBackup(home) };
    return { ok: true, backup_path: restore(home), restart_needed: true };
  }
  const forget = ({ confirm = false } = {}) => { if (confirm !== true) throw new Error("Not confirmed (confirm:true is required)."); forgetToken(workspaceDir); return { ok: true }; };
  return { status, apply, add, restore: restoreApi, forget };
}
