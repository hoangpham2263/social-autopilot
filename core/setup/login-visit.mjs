// "Check by visiting": a throwaway HEADLESS Chrome on the own-browser profile opens ONE login-required page per platform and decides
// ONLY from the FINAL URL (host + path) after redirects. It reads nothing from the page (no DOM, text, screenshot, cookie or storage):
// the final URL comes from the browser's navigation history over CDP. Only ever started by an explicit button press (POST /api/browser-visit).
// Results: { platform, state, source: "visit", checked_at, reason }. URLs and query strings are never stored or returned.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:net";
import { findBrowser } from "./chrome.mjs";
import { browserSettings, profileLocked, profileProblem, PLATFORMS } from "./own-browser.mjs";

// EDITABLE TABLE. Per platform: the login-required page to open, then what the FINAL host + path means.
// out = a known sign-in / checkpoint page (logged out); in = the account page itself (logged in); anything else = unknown.
// confidence: how sure we are that the page behaves this way (nothing here was verified against the live sites yet).
const H = (...hosts) => new RegExp("^(" + hosts.join("|") + ")$");
export const VISIT_PAGES = {
  facebook: { url: "https://www.facebook.com/settings", host: H("(www|m|web|mbasic)\\.facebook\\.com", "facebook\\.com"), out: /^\/(login(\/|\.php)?|checkpoint(\/|$)|recover|two_step_verification|two_factor)/, in: /^\/settings/, confidence: "high", note: "logged out -> /login/?next=...; a checkpoint is treated as logged out" },
  instagram: { url: "https://www.instagram.com/accounts/edit/", host: H("(www\\.)?instagram\\.com"), out: /^\/accounts\/(login|emailsignup|suspended)/, in: /^\/accounts\/edit/, confidence: "high", note: "logged out -> /accounts/login/?next=...; /challenge/ stays unknown" },
  pinterest: { url: "https://www.pinterest.com/settings/", host: H("([a-z]{2,3}\\.|www\\.)?pinterest\\.[a-z.]{2,6}"), out: /^\/(login|signup)(\/|$)/, in: /^\/settings/, confidence: "medium", note: "logged out should go to /login/; if it lands on the home page it stays unknown" },
  etsy: { url: "https://www.etsy.com/your/account", host: H("(www\\.)?etsy\\.com"), out: /^\/(signin|sign-in|login)(\/|$)/, in: /^\/your\/(account|shops|purchases)/, confidence: "medium", note: "logged out -> /signin?redirect_to=...; the bot check page stays unknown" },
  houzz: { url: "https://www.houzz.com/settings", host: H("(www\\.)?houzz\\.com"), out: /^\/(auth|signin|sign-in|login|user\/(login|signin))(\/|$)/, in: /^\/(settings|user\/settings|myhouzz)/, confidence: "low", note: "account page and sign-in address are not confirmed: anything unexpected stays unknown; edit this row once seen" },
  google: { url: "https://myaccount.google.com/", host: H("myaccount\\.google\\.com", "accounts\\.google\\.com"), out: /^\/(v\d\/)?(signin|servicelogin|accountchooser|lifecycle)/i, in: /^\//, confidence: "high", note: "logged out -> accounts.google.com/v3/signin or /ServiceLogin", inHost: /^myaccount\.google\.com$/ },
};
// Pages that are never a verdict (bot checks, error pages).
const NEVER = /(captcha|recaptcha|challenge|unusual|blocked|denied|error|geo\.captcha)/i;

// Pure. finalUrl -> "logged_out" | "logged_in" | "unknown". Uses host + path only.
export function classifyFinalUrl(platform, finalUrl, pages = VISIT_PAGES) {
  const rule = pages[platform];
  if (!rule) return "unknown";
  let u; try { u = new URL(String(finalUrl)); } catch { return "unknown"; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "unknown";
  const host = u.hostname.toLowerCase(), path = u.pathname || "/";
  if (/captcha-delivery\.com$/.test(host) || /^\/(captcha|recaptcha|sorry)/i.test(path)) return "unknown";
  if (!rule.host.test(host)) return "unknown";
  if (rule.out.test(path)) return "logged_out";
  if (NEVER.test(path)) return "unknown";
  if (rule.in.test(path) && (!rule.inHost || rule.inHost.test(host))) return "logged_in";
  return "unknown";
}

const REASONS = {
  logged_out: "The account page redirected to the sign-in page.",
  logged_in: "The account page opened without a sign-in redirect.",
  unknown: "The page ended somewhere unexpected (bot check, error page, timeout or a changed address), so it cannot tell.",
};

const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));

// Visits the pages one after another through an injected CDP page: cdp.navigate(url) -> { errorText }, cdp.currentUrl() -> string.
// Pure of processes; fully fakeable. Returns [{ platform, state, source, checked_at, reason }].
export async function visitPlatforms({ platforms, cdp, pages = VISIT_PAGES, sleep = sleepReal, now = () => Date.now(), capMs = 90000, pauseMs = 2000, settleMinMs = 6000, settleMaxMs = 12000, stepMs = 1000, onProgress = () => {} }) {
  const out = [], t0 = now();
  for (let i = 0; i < platforms.length; i++) {
    const p = platforms[i], rule = pages[p];
    const at = () => new Date(now()).toISOString();
    if (!rule) { out.push({ platform: p, state: "unknown", source: "visit", checked_at: at(), reason: "No page is defined for this site." }); continue; }
    if (now() - t0 + settleMinMs > capMs) { out.push({ platform: p, state: "unknown", source: "visit", checked_at: at(), reason: "Skipped: the 90 second limit of one check was reached." }); continue; }
    onProgress({ current: p, done: out.map((r) => r.platform) });
    let state = "unknown", reason = REASONS.unknown;
    try {
      const nav = await cdp.navigate(rule.url);
      const start = now(); let last = "", url = "";
      for (;;) {
        await sleep(stepMs);
        url = await cdp.currentUrl();
        const el = now() - start;
        if (el >= settleMaxMs || now() - t0 >= capMs) break;
        if (el >= settleMinMs && url && url === last) break;
        last = url;
      }
      if (nav?.errorText && !/^https?:/i.test(url)) reason = "The page did not load (" + String(nav.errorText).replace(/[^\w: ]/g, "").slice(0, 40) + ").";
      else { state = classifyFinalUrl(p, url, pages); reason = REASONS[state]; }
    } catch (e) { reason = "The check could not read this page (" + String(e.message || e).replace(/[^\w :.-]/g, "").slice(0, 60) + ")."; }
    out.push({ platform: p, state, source: "visit", checked_at: at(), reason });
    if (i < platforms.length - 1) await sleep(pauseMs);
  }
  onProgress({ current: "", done: out.map((r) => r.platform) });
  return out;
}

// In-memory results for this session + progress for the UI hint.
const cache = new Map();
export const visitResults = () => Object.fromEntries(cache);
export const clearVisitResults = (platform = "") => { if (platform) cache.delete(platform); else cache.clear(); };
let busy = false, progress = { active: false, current: "", done: [] };
export const visitActive = () => busy;
export const visitProgress = () => ({ ...progress, done: [...progress.done] });

// Small local file: timestamps and states only (never URLs).
export const checksFile = (workspace) => join(workspace, "runs", "login-checks.json");
export function readChecks(workspace, read = (f) => readFileSync(f, "utf8")) { try { const j = JSON.parse(read(checksFile(workspace))); return j && typeof j === "object" ? j : {}; } catch { return {}; } }
export function saveChecks(workspace, results, { write = writeFileSync, mkdir = mkdirSync, read } = {}) {
  const cur = readChecks(workspace, read);
  for (const r of results) cur[r.platform] = { state: r.state, login_checked_at: r.checked_at };
  try { mkdir(join(workspace, "runs"), { recursive: true }); write(checksFile(workspace), JSON.stringify(cur, null, 1)); } catch {}
  return cur;
}

// ----- CDP over a WebSocket, no libraries -----
async function freePort() {
  return new Promise((res, rej) => { const s = createServer(); s.on("error", rej); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });
}
async function jsonRetry(url, tries = 60, init) {
  for (let i = 0; i < tries; i++) { try { const r = await fetch(url, init); if (r.ok) return await r.json(); } catch {} await sleepReal(250); }
  throw new Error("Chrome did not answer");
}
async function openCdp(port) {
  let list = await jsonRetry(`http://127.0.0.1:${port}/json/list`);
  let page = list.find((t) => t.type === "page");
  if (!page) page = await jsonRetry(`http://127.0.0.1:${port}/json/new?about:blank`, 8, { method: "PUT" });
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error("no devtools connection")); });
  let id = 0; const pend = new Map();
  ws.onmessage = (m) => { try { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } } catch {} };
  const send = (method, params = {}) => new Promise((r, no) => { const i = ++id; const t = setTimeout(() => { pend.delete(i); no(new Error("devtools timeout")); }, 15000); pend.set(i, (d) => { clearTimeout(t); r(d); }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable");
  return {
    navigate: async (url) => { const d = await send("Page.navigate", { url }); return { errorText: d.result?.errorText || "" }; },
    // The URL of the current history entry: the navigation state, not the page content.
    currentUrl: async () => { const d = await send("Page.getNavigationHistory"); const h = d.result; return h?.entries?.[h.currentIndex]?.url || ""; },
    close: () => { try { ws.close(); } catch {} },
  };
}

const killTreeDefault = (child, plat = process.platform) => {
  if (!child?.pid) return;
  if (plat === "win32") { try { spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => {}); } catch {} return; }
  try { child.kill("SIGKILL"); } catch {}
};

// Sites the check by visiting never opens: optional (they read fine signed out) and some show a bot-protection page ("Access is temporarily
// restricted") after automated visits. They keep only the quiet cookie hint, or "unknown".
export const NEVER_VISIT = new Set(["etsy", "houzz", "pinterest"]);

// Runs one check. Throws Error(message) when it must not run (same refusals as the login window and runs). Never leaves Chrome running.
export async function runVisitCheck({ platforms = [], settings = {}, toolRoot, workspace, runActive = false, loginWindowOpen = false, plat = process.platform, env = process.env, exists = existsSync, which, locked = profileLocked, spawnFn = spawn, killTree = killTreeDefault, connect = openCdp, getPort = freePort, sleep = sleepReal, now = () => Date.now(), capMs = 90000, pauseMs = 2000, settleMinMs = 6000, settleMaxMs = 12000, pages = VISIT_PAGES } = {}) {
  const bs = browserSettings(settings, toolRoot);
  const wanted = [...new Set(platforms)].filter((p) => PLATFORMS.some((x) => x.id === p));
  if (!wanted.length) throw new Error("No site selected to check.");
  const ids = wanted.filter((p) => !NEVER_VISIT.has(p)); // optional sites are never visited (bot protection); cookies are their only hint
  if (!ids.length) throw new Error("Nothing to check by visiting: the selected sites (Etsy, Houzz, Pinterest) are optional, work signed out and are never visited.");
  if (busy) throw new Error("A login check is already running.");
  if (runActive) throw new Error("A run is using the own browser right now (headless): wait for it to finish or press Stop, then check the logins.");
  const why = profileProblem({ dir: bs.profileDir, locked: !!locked(bs.profileDir), exists: exists(bs.profileDir), windowOpen: !!loginWindowOpen });
  if (why) throw new Error(why);
  const browser = findBrowser({ override: String(settings.research?.chrome_path || ""), plat, env, exists, ...(which ? { which } : {}) });
  if (!browser.found) throw new Error("No Chrome (or Edge/Brave) was found. Install Google Chrome, or set research.chrome_path in workspace/settings.json.");
  busy = true; progress = { active: true, current: "", done: [] };
  let child = null, cdp = null;
  try {
    const port = await getPort();
    const args = ["--headless=new", `--user-data-dir=${bs.profileDir}`, `--remote-debugging-port=${port}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank"];
    child = spawnFn(browser.path, args, { stdio: "ignore", windowsHide: true });
    child.on?.("error", () => {});
    cdp = await connect(port);
    const results = await visitPlatforms({ platforms: ids, cdp, pages, sleep, now, capMs, pauseMs, settleMinMs, settleMaxMs, onProgress: (p) => { progress = { active: true, ...p }; } });
    for (const r of results) cache.set(r.platform, r);
    saveChecks(workspace, results);
    return { ok: true, results, leftover: false };
  } finally {
    try { cdp?.close?.(); } catch {}
    let leftover = false;
    if (child) {
      try { killTree(child, plat); } catch {}
      // Wait for the profile lock to disappear (Chrome gone); report when it does not.
      for (let i = 0; i < 12 && locked(bs.profileDir); i++) await sleep(500);
      leftover = !!locked(bs.profileDir);
      if (leftover) { try { killTree(child, plat); } catch {} }
    }
    busy = false; progress = { ...progress, active: false, current: "" };
  }
}

// ----- merging and the text shown to the person -----
const short = (n) => String(n || "").replace(/\s*\(.*\)\s*/, "");
export function mergeLogins(cookieRows, visits = {}) {
  return cookieRows.map((r) => {
    const v = visits[r.platform];
    if (v && v.state !== "unknown") return { ...r, state: v.state, reason: v.reason, source: "visit", checked_at: v.checked_at, cookie_state: r.state };
    if (r.state === "unknown" && NEVER_VISIT.has(r.platform)) return { ...r, reason: `Not checked on purpose: ${short(r.name)} is optional and works signed out; opening it from a background browser can trigger its bot protection.`, source: "cookies", checked_at: "" };
    if (r.state === "unknown") {
      const base = /not confirmed/.test(r.reason || "") ? `Cookies cannot tell for ${short(r.name)}: use Check by visiting.` : `${r.reason || "Could not tell"}. Use Check by visiting.`;
      return { ...r, reason: v ? `${base} The last visit could not tell either.` : base, source: v ? "visit" : "cookies", checked_at: v?.checked_at || "" };
    }
    return { ...r, source: "cookies", checked_at: "" };
  });
}

const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
// rows = the rows the person sees. Returns { line, toast }.
export function buildSummary(rows, { source = "cookies", at = new Date() } = {}) {
  const line = `Checked ${hhmm(at)} (${source === "visit" ? "visited the pages" : "cookies"})`;
  if (!rows.length) return { line, toast: "Nothing to check: no site is selected." };
  const group = (s) => rows.filter((r) => r.state === s).map((r) => short(r.name)).join(", ");
  const parts = [];
  const a = group("logged_in"), b = group("logged_out"), c = group("unknown");
  if (a) parts.push(`${a}: logged in`);
  if (b) parts.push(`${b}: not logged in`);
  if (c) parts.push(`${c}: ${source === "visit" ? "could not tell (open the login window)" : "could not tell (use Check by visiting)"}`);
  return { line, toast: parts.join(" · ") };
}
