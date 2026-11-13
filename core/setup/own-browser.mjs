// Own browser: a dedicated Chrome profile (workspace/browser-profile) the person logs in to ONCE; later headless runs use it.
// Settings: browser.mode "own" (default) | "extension", browser.headless (default true), browser.profile_dir.
// The profile holds the person's logins: never committed (workspace/ is gitignored), never logged, never copied except the
// cookie database METADATA read below (a temp copy, only names/hosts/expiry of allow-listed cookies, never values).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, lstatSync, readlinkSync, copyFileSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { findBrowser } from "./chrome.mjs";

export const BROWSER_MODES = ["own", "extension"];
export const DEFAULT_PROFILE_DIR = "workspace/browser-profile";

// Sites the person logs in to by hand. The launcher only ever opens these fixed URLs (never an arbitrary one).
export const PLATFORMS = [
  { id: "facebook", name: "Facebook", url: "https://www.facebook.com/", required: true },
  { id: "instagram", name: "Instagram", url: "https://www.instagram.com/", required: true },
  { id: "pinterest", name: "Pinterest", url: "https://www.pinterest.com/", required: false },
  { id: "etsy", name: "Etsy", url: "https://www.etsy.com/", required: false },
  { id: "houzz", name: "Houzz", url: "https://www.houzz.com/", required: false },
  { id: "google", name: "Google (Flow)", url: "https://flow.google.com/", required: true },
];
export const LOGIN_URLS = PLATFORMS.map((p) => p.url);

export function browserSettings(settings = {}, toolRoot = process.cwd()) {
  const b = settings?.browser || {};
  const dir = typeof b.profile_dir === "string" && b.profile_dir.trim() ? b.profile_dir.trim() : DEFAULT_PROFILE_DIR;
  return {
    mode: b.mode === "extension" ? "extension" : "own",
    headless: b.headless === false || b.headless === "false" ? false : true,
    profileDir: isAbsolute(dir) ? resolve(dir) : resolve(toolRoot, dir),
  };
}

// Is the profile in use by a running Chrome? Chrome keeps SingletonLock (symlink "host-pid", macOS/Linux) or "lockfile" (Windows).
export function profileLocked(dir, { exists = existsSync, lstat = lstatSync, readlink = readlinkSync, alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } } } = {}) {
  if (exists(join(dir, "lockfile"))) return true;
  try {
    lstat(join(dir, "SingletonLock"));
    const m = /-(\d+)$/.exec(String(readlink(join(dir, "SingletonLock"))));
    return m ? alive(Number(m[1])) : true;
  } catch { return false; }
}

// Pure: why a headless run (or a login window) cannot use the profile now, or "".
export function profileProblem({ dir, locked, exists, windowOpen = false }) {
  if (windowOpen || locked) return "The own browser profile is in use (the login window is open, or another browser holds it). Close that window, then retry.";
  if (!exists) return "The own browser has no profile yet: Run tab > Browser > Open browser to log in, log in to the sites, close the window, then retry.";
  return "";
}

// The command that opens the visible login window. Pure. One tab per site, or just the chosen one.
export function loginCommand({ browser, profileDir, urls = LOGIN_URLS, plat = process.platform }) {
  const tail = [`--user-data-dir=${profileDir}`, "--no-first-run", "--no-default-browser-check", ...urls];
  if (plat === "darwin") {
    const app = { chrome: "Google Chrome", edge: "Microsoft Edge", brave: "Brave Browser" }[browser.kind] || "Google Chrome";
    return { cmd: "open", args: ["-n", "-W", "-a", app, "--args", ...tail] };
  }
  return { cmd: browser.path, args: tail };
}

const stampFile = (workspace) => join(workspace, "runs", "browser-login.json");
export const lastOpened = (workspace, read = (f) => readFileSync(f, "utf8")) => { try { return String(JSON.parse(read(stampFile(workspace))).at || ""); } catch { return ""; } };

// Opens the login window. Refuses when a headless run holds the profile or the window is already open. Returns { ok, ... }.
export function openLoginBrowser({ platform = "", settings = {}, toolRoot, workspace, runActive = false, plat = process.platform, env = process.env, exists = existsSync, which, start, locked = profileLocked, now = () => Date.now() } = {}) {
  const bs = browserSettings(settings, toolRoot);
  if (runActive) throw new Error("A run is using the own browser right now (headless): wait for it to finish or press Stop, then open the login window.");
  const target = platform ? PLATFORMS.find((p) => p.id === platform) : null;
  if (platform && !target) throw new Error("Unknown platform.");
  if (locked(bs.profileDir)) throw new Error("The login window is already open (or the profile is held by another browser). Use that window, or close it first.");
  const r = settings.research || {};
  const browser = findBrowser({ override: String(r.chrome_path || ""), plat, env, exists, ...(which ? { which } : {}) });
  if (!browser.found) throw new Error("No Chrome (or Edge/Brave) was found. Install Google Chrome, or set research.chrome_path in workspace/settings.json.");
  mkdirSync(bs.profileDir, { recursive: true });
  const { cmd, args } = loginCommand({ browser, profileDir: bs.profileDir, urls: target ? [target.url] : LOGIN_URLS, plat });
  const go = start || ((c, a) => { const p = spawn(c, a, { detached: true, stdio: "ignore" }); p.on("error", () => {}); p.unref(); });
  go(cmd, args);
  const at = new Date(now()).toISOString();
  try { mkdirSync(join(workspace, "runs"), { recursive: true }); writeFileSync(stampFile(workspace), JSON.stringify({ at })); } catch {}
  return { ok: true, browser: browser.kind, platform: target?.id || "", opened: (target ? [target.url] : LOGIN_URLS).length, at };
}

export function browserInfo({ settings = {}, toolRoot, workspace, runActive = false, exists = existsSync, locked = profileLocked } = {}) {
  const bs = browserSettings(settings, toolRoot);
  const has = exists(bs.profileDir);
  return { mode: bs.mode, headless: bs.headless, profile_dir: bs.profileDir, profile_exists: has, last_opened: lastOpened(workspace), window_open: has && locked(bs.profileDir), run_active: !!runActive };
}

// ----- login status from the cookie database METADATA (names, hosts, expiry; never values) -----
// platform -> rules. A rule is a list of cookie names that must ALL be present (not expired) on a host ending with `host`.
// Etsy and Houzz: login cookie names are not confirmed, so they are always Unknown (never guessed).
export const LOGIN_COOKIES = {
  facebook: { host: "facebook.com", any: [["c_user", "xs"]] },
  instagram: { host: "instagram.com", any: [["sessionid"]] },
  pinterest: { host: "pinterest.com", any: [["_pinterest_sess"]] },
  google: { host: "google.com", any: [["SID"], ["__Secure-1PSID"]] },
};
const ALLOWED_NAMES = [...new Set(Object.values(LOGIN_COOKIES).flatMap((r) => r.any.flat()))];
const WIN_EPOCH_US = 11644473600 * 1e6; // Chrome expires_utc: microseconds since 1601-01-01; 0 = session cookie

export const cookieDbPath = (profileDir, exists = existsSync) => [join(profileDir, "Default", "Network", "Cookies"), join(profileDir, "Default", "Cookies")].find((p) => exists(p)) || "";

// Reads [{host, name, expires}] (expires in ms since 1970, 0 = session) for the allow-listed names only. Throws when it cannot read.
export function readCookieMeta(profileDir, { exists = existsSync, copy = copyFileSync, sqlite, tmp = tmpdir } = {}) {
  const src = cookieDbPath(profileDir, exists);
  if (!src) return null; // no cookie file yet
  const Db = sqlite || globalThis.__sa_sqlite;
  if (!Db) throw new Error("node:sqlite is not available in this Node.js");
  const dir = mkdtempSync(join(tmp(), "sa-cookies-"));
  try {
    const file = join(dir, "c.sqlite");
    copy(src, file);
    for (const ext of ["-wal", "-journal"]) if (exists(src + ext)) { try { copy(src + ext, file + ext); } catch {} }
    const db = new Db(file, { readOnly: true });
    try {
      const rows = db.prepare(`SELECT host_key, name, CAST(expires_utc / 1000000 AS INTEGER) AS expires_s FROM cookies WHERE name IN (${ALLOWED_NAMES.map(() => "?").join(",")})`).all(...ALLOWED_NAMES);
      // expires_utc is ~1.3e16 (above 2^53): the SQL divides to seconds first so no precision error or RangeError.
      return rows.map((r) => { const e = Number(r.expires_s); return { host: String(r.host_key), name: String(r.name), expires: e > 0 ? (e - WIN_EPOCH_US / 1e6) * 1000 : 0 }; });
    } finally { db.close(); }
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
}

let sqliteLoaded;
export async function loadSqlite() {
  if (sqliteLoaded !== undefined) return sqliteLoaded;
  try { sqliteLoaded = (await import("node:sqlite")).DatabaseSync; } catch { sqliteLoaded = null; }
  globalThis.__sa_sqlite = sqliteLoaded;
  return sqliteLoaded;
}

// Pure mapping: cookie metadata (or null / Error) -> state per platform. Never reads a value.
export function mapLogins(meta, { profileExists = true, now = Date.now(), failed = "" } = {}) {
  return PLATFORMS.map((p) => {
    const base = { platform: p.id, name: p.name, required: p.required };
    const rule = LOGIN_COOKIES[p.id];
    if (!profileExists) return { ...base, state: "logged_out", reason: "no own-browser profile yet" };
    if (!rule) return { ...base, state: "unknown", reason: "login cookie not confirmed for this site" };
    if (failed) return { ...base, state: "unknown", reason: failed };
    if (!meta) return { ...base, state: "logged_out", reason: "no cookies yet" };
    const live = meta.filter((c) => (c.host === rule.host || c.host.endsWith("." + rule.host)) && (c.expires === 0 || c.expires > now));
    const ok = rule.any.some((names) => names.every((n) => live.some((c) => c.name === n)));
    return { ...base, state: ok ? "logged_in" : "logged_out", reason: ok ? "login cookie present" : "login cookie missing or expired" };
  });
}

// Status per platform. `read` is injectable (tests); default reads the real cookie metadata. Never throws.
export async function loginStatus({ settings = {}, toolRoot, read = null, exists = existsSync, now = Date.now() } = {}) {
  const bs = browserSettings(settings, toolRoot);
  if (!exists(bs.profileDir)) return mapLogins(null, { profileExists: false, now });
  try {
    if (!read) { if (!(await loadSqlite())) return mapLogins(null, { now, failed: "node:sqlite is not available (Node.js 22.5 or newer)" }); }
    const meta = read ? await read(bs.profileDir) : readCookieMeta(bs.profileDir, { exists });
    return mapLogins(meta, { now });
  } catch { return mapLogins(null, { now, failed: "could not read the browser's cookie file (it may be busy)" }); }
}

// Tiny cache so the Run tab polling does not copy the cookie file every second.
export function cachedLoginStatus(opts = {}, ttlMs = 5000, clock = Date.now) {
  const c = cachedLoginStatus.cache;
  if (!opts.fresh && c && c.dir === (opts.settings?.browser?.profile_dir || "") && clock() - c.at < ttlMs) return c.p;
  const p = loginStatus(opts);
  cachedLoginStatus.cache = { at: clock(), dir: opts.settings?.browser?.profile_dir || "", p };
  return p;
}
cachedLoginStatus.cache = null;

// Strict check of the settings block `browser` (used by saveSettings). Returns the merged block; throws on a wrong value.
export function validateBrowserSettings(input, cur = {}) {
  if (input === undefined) return undefined;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("browser phải là object.");
  const out = { mode: cur.mode || "own", headless: cur.headless ?? true, profile_dir: cur.profile_dir || DEFAULT_PROFILE_DIR };
  if (input.mode !== undefined) { if (!BROWSER_MODES.includes(input.mode)) throw new Error("browser.mode phải là own hoặc extension."); out.mode = input.mode; }
  if (input.headless !== undefined) { if (input.headless === true || input.headless === "true") out.headless = true; else if (input.headless === false || input.headless === "false") out.headless = false; else throw new Error("browser.headless phải là true hoặc false."); }
  if (input.profile_dir !== undefined) {
    const v = typeof input.profile_dir === "string" ? input.profile_dir.trim() : "";
    if (!v || v.length > 300 || /[\0"<>|*?]/.test(v) || /token|secret|password/i.test(v)) throw new Error("browser.profile_dir không hợp lệ.");
    out.profile_dir = v;
  }
  return out;
}
