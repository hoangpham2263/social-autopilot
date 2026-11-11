// Portable Chrome helpers: find the browser, list its profiles (Local State only), open a window in one profile.
// Nothing here reads cookies, passwords or any other profile data. No shell strings: argument arrays only.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform as osPlatform } from "node:os";

const KINDS = ["chrome", "edge", "brave"];
const PROFILE_RE = /^(Default|Profile \d+|Guest Profile|System Profile)$/;
const URL_RE = /^chrome-extension:\/\/[a-z]{32}\/connect\.html\?mcpRelayUrl=([^&]+)(&.*)?$/;

const defaultWhich = (name, plat) => { try { const out = execFileSync(plat === "win32" ? "where" : "which", [name], { encoding: "utf8", windowsHide: true, timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }); return out.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || ""; } catch { return ""; } };

// Candidate executables per platform and browser kind.
export function candidates(kind, { plat = osPlatform(), env = process.env, home = homedir() } = {}) {
  if (plat === "win32") {
    const roots = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(Boolean);
    const rel = { chrome: ["Google", "Chrome", "Application", "chrome.exe"], edge: ["Microsoft", "Edge", "Application", "msedge.exe"], brave: ["BraveSoftware", "Brave-Browser", "Application", "brave.exe"] }[kind];
    return roots.map((r) => join(r, ...rel));
  }
  if (plat === "darwin") {
    const app = { chrome: ["Google Chrome.app", "Google Chrome"], edge: ["Microsoft Edge.app", "Microsoft Edge"], brave: ["Brave Browser.app", "Brave Browser"] }[kind];
    return ["/Applications", join(home, "Applications")].map((r) => join(r, app[0], "Contents", "MacOS", app[1]));
  }
  return [];
}
const LINUX_NAMES = { chrome: ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"], edge: ["microsoft-edge", "microsoft-edge-stable"], brave: ["brave-browser", "brave"] };
const WHERE_NAMES = { chrome: "chrome", edge: "msedge", brave: "brave" };

export function findBrowser({ override = "", plat = osPlatform(), env = process.env, home = homedir(), exists = existsSync, which = defaultWhich } = {}) {
  if (override) return exists(override) ? { found: true, path: override, kind: "custom" } : { found: false, path: "", kind: "" };
  for (const kind of KINDS) {
    for (const p of candidates(kind, { plat, env, home })) if (exists(p)) return { found: true, path: p, kind };
    if (plat === "win32") { const w = which(WHERE_NAMES[kind], plat); if (w && exists(w)) return { found: true, path: w, kind }; }
    if (plat === "linux") for (const n of LINUX_NAMES[kind]) { const w = which(n, plat); if (w) return { found: true, path: w, kind }; }
  }
  return { found: false, path: "", kind: "" };
}

// Where the browser keeps `Local State` (the profile list lives there).
export function userDataDirs({ plat = osPlatform(), env = process.env, home = homedir() } = {}) {
  if (plat === "win32") { const l = env.LOCALAPPDATA || join(home, "AppData", "Local"); return { chrome: join(l, "Google", "Chrome", "User Data"), edge: join(l, "Microsoft", "Edge", "User Data"), brave: join(l, "BraveSoftware", "Brave-Browser", "User Data") }; }
  if (plat === "darwin") { const a = join(home, "Library", "Application Support"); return { chrome: join(a, "Google", "Chrome"), edge: join(a, "Microsoft Edge"), brave: join(a, "BraveSoftware", "Brave-Browser") }; }
  const c = env.XDG_CONFIG_HOME || join(home, ".config");
  return { chrome: join(c, "google-chrome"), edge: join(c, "microsoft-edge"), brave: join(c, "BraveSoftware", "Brave-Browser"), chromium: join(c, "chromium") };
}

// Pure: Local State JSON text -> [{ folder, name, email }]. Tolerates missing or corrupt input.
export function parseProfiles(text) {
  try {
    const cache = JSON.parse(String(text)).profile?.info_cache;
    if (!cache || typeof cache !== "object") return [];
    return Object.entries(cache).map(([folder, v]) => ({ folder, name: String(v?.name || v?.gaia_name || ""), email: String(v?.user_name || "") }))
      .sort((a, b) => (a.folder === "Default" ? -1 : b.folder === "Default" ? 1 : a.folder.localeCompare(b.folder, undefined, { numeric: true })));
  } catch { return []; }
}

export function listProfiles({ browser, userDataDir = "", plat = osPlatform(), env = process.env, home = homedir(), read = (f) => readFileSync(f, "utf8") } = {}) {
  const dirs = userDataDirs({ plat, env, home });
  const kind = browser?.kind in dirs ? browser.kind : "chrome";
  const order = userDataDir ? [userDataDir] : [kind, ...Object.keys(dirs).filter((k) => k !== kind)].map((k) => dirs[k]);
  for (const d of order) {
    try { const ps = parseProfiles(read(join(d, "Local State"))); if (ps.length) return { dir: d, profiles: ps }; } catch {}
  }
  return { dir: order[0], profiles: [] };
}

// Pure allow-lists.
export function validProfile(name, profiles = []) {
  const s = String(name ?? "").trim();
  return !!s && (PROFILE_RE.test(s) || profiles.some((p) => p.folder === s));
}
export function validConnectUrl(url) {
  const s = String(url ?? "").trim();
  const m = URL_RE.exec(s);
  if (!m || /[\s"'<>`\\]/.test(s)) return false;
  let relay;
  try { relay = decodeURIComponent(m[1]); } catch { return false; }
  return /^ws:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?(\/[A-Za-z0-9._~\/-]*)?$/.test(relay);
}

// Pure: the command that opens the browser. Returns { cmd, args }.
export function openCommand({ browser, profile, url = "", plat = osPlatform() }) {
  const tail = [`--profile-directory=${profile}`, ...(url ? [url] : [])];
  if (plat === "darwin") {
    const app = { chrome: "Google Chrome", edge: "Microsoft Edge", brave: "Brave Browser" }[browser.kind] || "Google Chrome";
    return { cmd: "open", args: ["-na", app, "--args", ...tail] };
  }
  return { cmd: browser.path, args: tail };
}

export function openChromeProfile({ profile = "", url = "", settings = {}, plat = osPlatform(), env = process.env, home = homedir(), exists = existsSync, which = defaultWhich, read, start } = {}) {
  const r = settings.research || {};
  const browser = findBrowser({ override: String(r.chrome_path || ""), plat, env, home, exists, which });
  if (!browser.found) throw new Error("No Chrome (or Edge/Brave) was found. Install Google Chrome, or set research.chrome_path in workspace/settings.json.");
  const { profiles } = listProfiles({ browser, userDataDir: String(r.chrome_user_data_dir || ""), plat, env, home, ...(read ? { read } : {}) });
  const chosen = String(profile || r.chrome_profile || "").trim();
  if (!validProfile(chosen, profiles)) throw new Error(chosen ? "Unknown Chrome profile folder." : "Choose a Chrome profile first (Prompt tab) or pass --profile.");
  const u = String(url || "").trim();
  if (u && !validConnectUrl(u)) throw new Error("Only a chrome-extension://<id>/connect.html?mcpRelayUrl=ws://<loopback> URL is accepted.");
  // With no url Chrome opens a NEW WINDOW of the profile, and the new-tab page counts as "no url" too; an explicit page
  // (about:blank) is added as a TAB to the profile's existing window.
  const target = u || "about:blank";
  const { cmd, args } = openCommand({ browser, profile: chosen, url: target, plat });
  const go = start || ((c, a) => { const p = spawn(c, a, { detached: true, stdio: "ignore" }); p.on("error", () => {}); p.unref(); });
  go(cmd, args);
  return { ok: true, profile: chosen, browser: browser.kind, url: u };
}

// Read-only summary for the app: browser found, profiles, selected.
export function chromeInfo({ settings = {}, ...rest } = {}) {
  const r = settings.research || {};
  const browser = findBrowser({ override: String(r.chrome_path || ""), ...rest });
  const { profiles } = listProfiles({ browser, userDataDir: String(r.chrome_user_data_dir || ""), ...rest });
  return { browser, profiles, selected: String(r.chrome_profile || "") };
}

// Extension id of "Playwright MCP Bridge" in the Chrome Web Store (same on every machine).
export const BRIDGE_EXTENSION_ID = "mmlmfjhmonkocbjadbfplnigmagldckm";

// Instant read-only setup check: browser found, profile listed, and whether <profile>/Extensions/<bridge id> exists.
// Reads only Local State and that one directory's existence; nothing else inside the profile.
export function chromeSetupCheck({ profile = "", settings = {}, ...rest } = {}) {
  const r = settings.research || {};
  const exists = rest.exists || existsSync;
  const browser = findBrowser({ override: String(r.chrome_path || ""), ...rest });
  const { dir, profiles } = listProfiles({ browser, userDataDir: String(r.chrome_user_data_dir || ""), ...rest });
  const chosen = String(profile || r.chrome_profile || "").trim();
  const ok = validProfile(chosen, profiles);
  const info = ok ? profiles.find((p) => p.folder === chosen) : null;
  const known = ok && (!!info || exists(join(dir, chosen)));
  return {
    browser,
    profile: { folder: ok ? chosen : "", exists: known, name: info?.name || "", email: info?.email || "" },
    extension: { id: BRIDGE_EXTENSION_ID, installed: known && exists(join(dir, chosen, "Extensions", BRIDGE_EXTENSION_ID)) },
  };
}
