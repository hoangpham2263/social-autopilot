// Social Autopilot's window (ui/) served on localhost, on macOS and Windows alike. A thin layer over scripts/: every
// read and write goes through the same functions the agents run (scripts/*.mjs), so the UI has no workflow
// logic of its own. core/launch.ps1 starts this file with --no-open and finds it by /api/root; each install gets its own
// port from its folder (47000 + hash), SA_PORT overrides.
import { createServer } from "node:http";
import { spawn, execFile } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, statSync, renameSync, appendFileSync, createReadStream } from "node:fs";
import { join, dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createConfigApi } from "../core/setup/config-api.mjs";
import { PWSH, toolEnv, psCommand, appWindow } from "../core/platform.mjs";
import { workspace, discoverBrands, listDrafts, brandAvatar, readJson, rawSettings, saveSettings, settings, brandOverview, metricoolBrands, saveMetricoolBrands, linkMetricool } from "../scripts/lib.mjs";
import { summary } from "../scripts/draft-lib.mjs";
import { previewOf } from "../scripts/preview.mjs";
import { cancel } from "../scripts/finalize.mjs";
import { readSocial, saveSocial, saveOverride } from "../scripts/social.mjs";
import { queueReport, writtenPost } from "../scripts/queue.mjs";
import { listItems, setItemStatus, readProgress, storeDir, storeIdeasFile, duplicatesFile, sourceAvatar } from "../scripts/store.mjs";
import { promptList, skillLine, ALL_BRANDS } from "../scripts/prompts.mjs";
import { listSources, defaultSource } from "../scripts/skills.mjs";
import { REGISTRY as PLATFORM_REGISTRY } from "../scripts/platforms/index.mjs";
import { redeem, tokenFor, MAX_BODY } from "../scripts/collect-transfer.mjs";
import { accounts } from "../core/setup/accounts.mjs";
import { chromeInfo, openChromeProfile, chromeSetupCheck } from "../core/setup/chrome.mjs";
import { listLogs, showLog, DRIED_UP_RUNS } from "../scripts/runlog.mjs";
import { readCheck, checkStatus } from "../scripts/chrome-check.mjs";
import { progressView, newRun } from "../scripts/progress.mjs";
import { researchTimes, dayTimes } from "../scripts/metricool-csv.mjs";
import { findClaude } from "../core/setup/claude-cli.mjs";
import { createAgentRunner } from "../core/setup/agent-run.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const BASE_PORT = Number(process.env.SA_PORT || 47000 + (parseInt(createHash("sha1").update(root).digest("hex").slice(0, 6), 16) % 1000));
let PORT = BASE_PORT;
const logs = join(workspace, "logs");
// Run now: headless Claude for one mode (core/setup/agent-run.mjs); one run at a time, killed when this server stops.
const agentRun = createAgentRunner({ toolRoot: root, workspace, getSettings: () => settings(), findCli: () => findClaude({ settings: rawSettings() }) });
for (const sig of ["exit", "SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { agentRun.shutdown(); if (sig !== "exit") process.exit(0); });
const configApi = createConfigApi({ hubRoot: root, pwsh: PWSH, env: toolEnv });
mkdirSync(logs, { recursive: true });

const logFile = (name) => {
  const file = join(logs, name);
  try { if (statSync(file).size > 1024 * 1024) renameSync(file, file.replace(/\.log$/, ".old.log")); } catch {}
  return file;
};
const logError = (where, text) => {
  try { appendFileSync(logFile("app-errors.log"), `[${new Date().toISOString()}] ${where}\n  ${String(text).trim().replace(/\n/g, "\n  ")}\n\n`); } catch {}
};
process.on("uncaughtException", (e) => { logError("Máy chủ Social Autopilot", e.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => logError("Máy chủ Social Autopilot", e?.stack || e));

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".webp"];
const CORE_ASSETS = ["tool.css", "hub.js"];
const version = () => { try { return readFileSync(join(root, "workspace", "version.txt"), "utf8").trim(); } catch { return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version || ""; } };
const q = (p) => p.replace(/'/g, "''");
const pwshOut = (command, timeout) => new Promise((done, fail) => execFile(PWSH, psCommand(command), { cwd: root, env: toolEnv, timeout, windowsHide: true }, (err, out) => (err ? fail(err) : done(String(out).trim()))));

// ----- data for the pages (all from scripts/) -----
function draftsData(brand, status) {
  return listDrafts(brand || undefined).filter((d) => !status || d.status.status === status).map((d) => ({
    ...summary(d), image_exists: existsSync(join(d.dir, "image.png")), languages: d.draft.languages, language_mode: d.draft.language_mode,
    inspiration_url: d.draft.inspiration.post_url || d.draft.inspiration.source_url, product_image: d.draft.product_image,
    created: d.draft.created, by: d.status.by || "", image_host: d.status.image_host || null, brand_post: d.status.brand_post ? { ...d.status.brand_post, ...writtenPost(d) } : null, error: d.status.error || "", metadata_clean: d.status.metadata_clean || null, watermark: d.status.watermark || null, preview: previewOf(d),
  })).sort((a, b) => String(b.created).localeCompare(String(a.created)));
}
const arr = (v) => (Array.isArray(v) ? v : []);
// The research store (kho) of one brand for the Nghiên cứu tab: items (newest first), counts, crawl progress, ideas.
function storeData(brand, status, source, platform = "") {
  const r = listItems(brand, { status, source, platform });
  const dir = storeDir(brand);
  // Posts not stored because they matched an item (duplicates.json), shown in the item's preview.
  const dups = {};
  for (const x of readJson(duplicatesFile(brand), { duplicates: [] }).duplicates || []) (dups[x.matched] ||= []).push({ at: x.at || "", source: x.source || "", post_url: x.post_url || "", reason: x.reason || x.rule || "", detail: x.detail || "" });
  const items = r.items.slice().reverse().map((i) => ({ ...i, image_paths: i.images.map((f) => join(dir, f)), duplicates: dups[i.id] || [] }));
  const ideas = readJson(storeIdeasFile(brand), { ideas: [] }).ideas;
  // Each reference page's avatar (captured by research ingest), served through /file (workspace images only).
  const avatars = Object.fromEntries(r.sources.map((s) => [s, sourceAvatar(brand, s)]).filter(([, a]) => a));
  // Items per source in the current Show filter (Library Source dropdown).
  const inStatus = listItems(brand, { status }).items;
  const source_counts = Object.fromEntries(r.sources.map((s) => [s, inStatus.filter((i) => i.source_id === s).length]));
  // Items per platform in the current Show filter (Library Platform dropdown).
  const platform_counts = Object.fromEntries(r.platforms.map((p) => [p, inStatus.filter((i) => i.platform === p).length]));
  return { brand, dir, counts: r.counts, sources: r.sources, source_counts, platforms: r.platforms, platform_counts, progress: readProgress(brand).sources || {}, items, ideas, avatars };
}

// ----- HTTP -----
const send = (res, status, data) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(data)); };
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
// A request body: always a JSON object ({} when empty), else a clear message instead of a JavaScript error.
const body = async (req, limit = 2 * 1024 * 1024) => {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw new Error("Request too large."); chunks.push(c); }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("The request is not valid JSON."); }
  if (!isObject(data)) throw new Error("The request must be a JSON object, e.g. {\"id\": \"...\"}.");
  return data;
};
const draftId = (b) => {
  const id = typeof b.id === "string" ? b.id.trim() : "";
  if (!id) throw new Error("Missing draft id (id).");
  return id;
};

// ----- security: only this app's own window may drive it -----
// DNS rebinding: the Host must be this server's own address. CSRF: every non-GET request needs Content-Type
// application/json (so a browser preflights it, and nothing here answers CORS), a same-origin or absent Origin and
// this run's random token (X-SA-Token), which only the pages served here carry (meta sa-token; ui/index.html call(),
// core/assets/hub.js and core/setup/page.js send it).
const TOKEN = randomBytes(24).toString("hex");
const hosts = () => [`127.0.0.1:${PORT}`, `localhost:${PORT}`];
const BOOT = `<meta name="sa-token" content="${TOKEN}">`;
const withBoot = (html) => (/<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + BOOT) : BOOT + html);
const sameToken = (v) => { const a = Buffer.from(String(v || "")), b = Buffer.from(TOKEN); return a.length === b.length && timingSafeEqual(a, b); };
function refuse(req, path) {
  if (!hosts().includes(String(req.headers.host || "").toLowerCase())) return "This server only accepts requests to its own 127.0.0.1 or localhost address.";
  if (req.method === "GET" || req.method === "HEAD") return "";
  const origin = req.headers.origin;
  if (origin !== undefined && !hosts().map((h) => `http://${h}`).includes(origin)) return "Requests from other pages are blocked.";
  // core/launch.ps1 closes the server with a bare POST /api/quit when the window closes: allowed only from a non-browser
  // client (browsers always send Origin and Sec-Fetch-Site on a POST).
  if (path === "/api/quit" && origin === undefined && !req.headers["sec-fetch-site"]) return "";
  if (!/^application\/json\b/i.test(String(req.headers["content-type"] || ""))) return "Requests must send Content-Type: application/json.";
  if (!sameToken(req.headers["x-sa-token"])) return "Missing or wrong session token (X-SA-Token). Restart the app and try again.";
  return "";
}

// ----- short cache for the slow reads (discovery runs check-skill per brand); any write clears it -----
const CACHE_MS = 20000;
const cache = new Map();
const cached = (key, fn) => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = fn();
  cache.set(key, { at: Date.now(), value });
  return value;
};
const discovered = () => cached("discover", () => discoverBrands());
const sendFile = (res, file) => {
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[extname(file).toLowerCase()] || "application/octet-stream", "content-length": statSync(file).size, "cache-control": "no-store" });
  createReadStream(file).pipe(res);
};
// Only images of this tool's workspace (references, drafts) are served to the window.
const allowedFile = (p) => { const full = resolve(p); return full.startsWith(workspace + sep) && IMAGE_EXT.includes(extname(full).toLowerCase()); };

function restart() {
  const out = openSync(logFile("server.log"), "a");
  spawn(process.execPath, [join(here, "server.mjs"), "--no-open"], { cwd: root, detached: true, windowsHide: true, stdio: ["ignore", out, out], env: { ...process.env, SA_WAIT_PORT: "1" } }).unref();
  setTimeout(() => process.exit(0), 300);
}


// A script of scripts/ in a hidden child process; its one JSON object (or { ok:false, error }).
// early: answer as soon as the script has printed its result (one complete JSON object), without waiting for the process to exit.
// Approve prints right after the push and the short link check, then the same process goes on with the slow GitHub Pages check
// in the background; the page must not wait for that. The process is left to finish (and is still killed at the timeout).
const runScript = (script, args, timeout, { early = false } = {}) => new Promise((done) => {
  let settled = false;
  const finish = (v) => { if (!settled) { settled = true; done(v); } };
  const child = execFile(process.execPath, [join(root, "scripts", script), ...args], { cwd: root, env: process.env, timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
    try { finish(JSON.parse(String(stdout))); } catch { finish({ ok: false, error: err?.killed ? "Timed out." : String(stdout || err?.message || "Failed.").trim().slice(0, 500) }); }
  });
  if (early) {
    let buf = "";
    child.stdout?.on("data", (d) => { buf += d; try { finish(JSON.parse(buf)); } catch { /* not complete yet */ } });
  }
});
const findDraftOrThrow = (id) => { if (!listDrafts().some((d) => d.id === id)) throw new Error(`Unknown post ${id}.`); };

// A page's request: a function from scripts/ that may throw; its message goes back as { error }.
const api = async (res, fn) => { try { send(res, 200, await fn()); } catch (e) { send(res, 400, { error: e.message }); } };

const sendHtml = (res, file) => {
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  const html = withBoot(readFileSync(file, "utf8"));
  res.writeHead(200, { "content-type": TYPES[".html"], "content-length": Buffer.byteLength(html), "cache-control": "no-store" });
  res.end(html);
};

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type, x-collect-token", "access-control-allow-private-network": "true", "access-control-max-age": "600", vary: "Origin" };
const reply = (res, status, obj) => { res.writeHead(status, { ...CORS, "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
// One-time token for the extract script's Node side. NO CORS headers (a web page can neither get a token nor read the reply); refused when the
// request carries Sec-Fetch-Site (browser-initiated) or the Host is not the app's loopback address.
function collectToken(req, res, task) {
  const plain = (status, obj) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(obj)); };
  if (!hosts().includes(String(req.headers.host || "").toLowerCase())) return plain(403, { error: "Wrong host." });
  if (req.method !== "GET") return plain(405, { error: "GET only." });
  const r = tokenFor({ headers: req.headers, task });
  return plain(r.status, r.ok ? { token: r.token } : { error: r.error });
}
async function collectResult(req, res, task) {
  if (!hosts().includes(String(req.headers.host || "").toLowerCase())) return reply(res, 403, { error: "Wrong host." });
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); return res.end(); }
  if (req.method !== "POST") return reply(res, 405, { error: "POST only." });
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > MAX_BODY) { req.destroy(); return reply(res, 413, { error: "Body above 512 KB." }); } chunks.push(c); }
  const r = redeem({ token: String(req.headers["x-collect-token"] || ""), task, body: Buffer.concat(chunks) });
  return reply(res, r.status, r.ok ? { ok: true } : { error: r.error });
}

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;
  const get = (k) => url.searchParams.get(k) || "";
  // The extract script (running on facebook.com etc.) sends its result here: its own auth (one-time token), CORS only for this route.
  if (path === "/api/collect-token") return collectToken(req, res, get("task"));
  if (path === "/api/collect-result") return collectResult(req, res, get("task"));
  const refused = refuse(req, path);
  if (refused) return send(res, 403, { error: refused });
  if (req.method !== "GET" && req.method !== "HEAD") { cache.clear(); res.on("finish", () => cache.clear()); }
  if (path === "/api/root") return send(res, 200, { root, service: "social-autopilot", protocol: 1, version: version(), pid: process.pid });
  if (path === "/api/client-error" && req.method === "POST") {
    const { message = "", stack = "" } = await body(req).catch(() => ({}));
    logError("Giao diện Social Autopilot", [message, stack].filter(Boolean).join("\n").slice(0, 4000));
    return send(res, 200, { ok: true });
  }
  if (path === "/api/brands") return api(res, () => cached("brands", () => { const found = discovered(); return { ...found, metricool: brandOverview(found) }; }));
  if (path === "/api/metricool-brands" && req.method === "GET") return api(res, () => metricoolBrands());
  if (path === "/api/metricool-brands" && req.method === "POST") return api(res, async () => saveMetricoolBrands(await body(req)));
  // Tổng quan, Chọn skill / Đổi skill / Kết nối / Ngắt kết nối: { name, skill_path } links a Metricool brand to a skill
  // folder in place (nothing copied); skill_path null = unlink (the folder and the store stay).
  if (path === "/api/metricool-link" && req.method === "POST") return api(res, async () => {
    const b = await body(req);
    try { return linkMetricool(String(b.name ?? ""), b.skill_path ? String(b.skill_path) : null, { confirm: b.confirm === true }); }
    catch (e) { if (e.code === "MISMATCH") return { needs_confirm: true, message: e.message }; throw e; }
  });
  if (path === "/api/brand" && req.method === "GET") return api(res, () => {
    if (!get("id")) throw new Error("Missing brand id (id).");
    return cached(`brand:${get("id")}`, () => readSocial(get("id")));
  });
  if (path === "/api/brand" && req.method === "POST") return api(res, async () => {
    if (!get("id")) throw new Error("Missing brand id (id).");
    const b = await body(req);
    // Brand Edit saves per-brand overrides in the tool (workspace/brands/<id>.json); the skill is never changed.
    if (isObject(b.override)) return saveOverride(get("id"), b.override);
    if (!isObject(b.social)) throw new Error("Missing override or social (override must be a JSON object; social.json itself is read-only).");
    return saveSocial(get("id"), b.social);
  });
  if (path === "/api/store" && req.method === "GET") return api(res, () => {
    const brands = discovered().brands;
    const brand = get("brand"), status = get("status"), source = get("source"), platform = get("platform");
    if (brand && !brands.some((b) => b.id === brand)) throw new Error(`Unknown brand "${brand}".`);
    if (source && !/^[a-z0-9][a-z0-9-]*$/.test(source)) throw new Error("Invalid source.");
    if (platform && !/^[a-z]+$/.test(platform)) throw new Error("Invalid platform.");
    return { brands: brands.map((b) => ({ id: b.id, name: b.brand, counts: listItems(b.id).counts })), current: brand ? storeData(brand, status, source, platform) : null };
  });
  // "Remove" a library item (rejected: never picked for ideas, optional reason) or "Restore": store.mjs remove/restore.
  if (path === "/api/store-item" && req.method === "POST") return api(res, async () => {
    const b = await body(req);
    const brand = String(b.brand ?? ""), id = String(b.id ?? "");
    if (!discovered().brands.some((x) => x.id === brand)) throw new Error(`Unknown brand "${brand}".`);
    if (!/^S\d{4,}$/.test(id)) throw new Error("Invalid library item id (like S0001).");
    return { item: setItemStatus(brand, id, b.status === "new" ? "new" : "rejected", { note: String(b.note ?? ""), by: String(b.by ?? "").trim() || "user" }) };
  });
  // Prompt tab: the ready-to-paste prompts of docs/scheduled-prompt.md (mode x agent) and the brands to fill in.
  // Prompt tab, the counts on the Mode buttons per brand, each the number of items IN that state now: research = library
  // items not used yet; create = the tool's posts to review (made, waiting for Approve; failed checks included, like the
  // Posts tab); publish = the tool's approved posts not sent to Metricool yet. (Posts still needed for Plan ahead: Overview.)
  if (path === "/api/prompt-counts" && req.method === "GET") return api(res, () => {
    const q = queueReport({});
    return { brands: Object.fromEntries(discovered().brands.map((b) => {
      const qb = q.brands.find((x) => x.brand === b.id) || {};
      return [b.id, {
        // Research: Available library items (can still be used, used before included); used / ready (never used or cooldown over)
        // for the tooltip.
        research: listItems(b.id).counts.new || 0, library: (({ used, ready, cooling, cooldown_days }) => ({ used, ready, cooling, cooldown_days }))(listItems(b.id).counts),
        create: listDrafts(b.id).filter((d) => !d.status.brand_post && ["ready", "check_failed", "image_failed"].includes(d.status.status)).length,
        // The same posts metricool-mcp.mjs payload sends: the tool's own approved posts with a hosted image, not sent yet
        // on the brand's channels (skill-owned catalog posts never count); a paused brand sends nothing.
        publish: b.enabled ? (qb.unsent_approved || []).length : 0,
        // Already scheduled on Metricool: payload never sends these again (shown under Publish approved).
        on_metricool: (qb.on_metricool || []).length,
        // Available library items per source (Prompt Sources list).
        sources: listItems(b.id, { status: "new" }).items.reduce((o, i) => { o[i.source_id] = (o[i.source_id] || 0) + 1; return o; }, {}),
      }];
    })) };
  });
  // Research platforms: the adapter registry (status, short note) + the linked brands whose skill enables each platform (same source as /api/prompts discovery_platforms).
  if (path === "/api/research-platforms" && req.method === "GET") return api(res, () => {
    const brands = discovered().brands.filter((b) => b.usable);
    const short = (n) => { const t = String(n || "").split(/[.;]| \(/)[0].trim(); return t.length > 110 ? `${t.slice(0, 107)}...` : t; };
    return { platforms: Object.entries(PLATFORM_REGISTRY).map(([id, e]) => ({ id, name: id.charAt(0).toUpperCase() + id.slice(1), status: e.status, checked: e.checked || "", note: short(e.note), enabled_for: brands.filter((b) => (b.discovery_platforms || []).includes(id)).map((b) => b.id) })), brands: brands.map((b) => ({ id: b.id, name: b.brand })) };
  });
  if (path === "/api/prompts" && req.method === "GET") return api(res, () => ({ prompts: promptList(), all_brands: ALL_BRANDS, tool_root: root, ahead_days: settings().planning?.ahead_days || 7, brands: discovered().brands.map((b) => ({ id: b.id, name: b.brand, usable: b.usable, dir: b.dir, skill_root: b.skillRoot || b.dir, shared: !!b.shared, skill_line: skillLine(b), metricool_timezone: (() => { try { return (metricoolBrands().brands || []).find((m) => m.skill_id === b.id)?.timezone || ""; } catch { return ""; } })(), sources: b.sources || [], discovery_platforms: b.discovery_platforms || [], posts_per_week: b.posts_per_week ?? null, reference_redraw: !!b.reference_redraw })) }));
  // Log tab: the agent runs (scripts/runlog.mjs), newest first; one in full.
  if (path === "/api/runlogs" && req.method === "GET") return api(res, () => ({ dried_up_runs: DRIED_UP_RUNS, logs: listLogs({ brand: get("brand"), mode: get("mode"), limit: Number(get("limit")) || 200 }) }));
  if (path === "/api/runlog" && req.method === "GET") return api(res, () => showLog(get("id")));
  // Prompt tab, Run now: POST starts headless Claude (409 when a run is active), POST /stop kills it, GET = live status (no secrets).
  if (path === "/api/agent-run" && req.method === "GET") return api(res, () => agentRun.status());
  if (path === "/api/agent-run" && req.method === "POST") { const b = await body(req).catch(() => ({})); const r = agentRun.start({ mode: b.mode, prompt: b.prompt, brands: b.brands }); return send(res, r.status, r.ok ? { ok: true, run_id: r.run_id, mode: r.mode, started: r.started } : { error: r.error }); }
  if (path === "/api/agent-run/stop" && req.method === "POST") { const r = agentRun.stop(); return send(res, r.status, r.ok ? { ok: true } : { error: r.error }); }
  // Prompt tab, Run progress (scripts/progress.mjs): the fixed steps of the mode, its current run (workspace/runs/
  // current-<mode>.json) and the last run log of the mode. POST = Copy prompt: a new pending run (resets the panel).
  // Prompt tab, Chrome check line: reads workspace/runs/chrome-check.json only (never touches Chrome).
  if (path === "/api/chrome-check" && req.method === "GET") return api(res, () => { const record = readCheck(); return { record, status: checkStatus(record) }; });
  if (path === "/api/progress" && req.method === "GET") return api(res, () => {
    const view = progressView(get("mode"));
    const last = listLogs({ mode: view.mode, limit: 1 })[0];
    return { ...view, last_log: last ? { id: last.id, ended: last.ended, result: last.result, headline: last.headline } : null };
  });
  if (path === "/api/progress" && req.method === "POST") return api(res, async () => {
    const b = await body(req);
    const known = new Set(discovered().brands.map((x) => x.id));
    const brands = (Array.isArray(b.brands) ? b.brands : []).map(String).filter((x) => known.has(x));
    return { run: newRun(String(b.mode ?? ""), { brands, agent: typeof b.agent === "string" ? b.agent.slice(0, 40) : "" }) };
  });
  if (path === "/api/drafts") return api(res, () => ({ drafts: draftsData(get("brand"), get("status")) }));
  if (path === "/api/queue") return api(res, () => queueReport({ brand: get("brand") || undefined }));
  // Optional "Bỏ" of a generated post before it is written into the brand (finalize.mjs cancel). Nothing waits for it.
  if (path === "/api/cancel" && req.method === "POST") return api(res, async () => {
    const b = await body(req);
    return cancel({ id: draftId(b), note: String(b.note ?? ""), by: String(b.by ?? "").trim() || "user" });
  });
  // Posts -> Preview -> Approve: the post a person approved is saved to the brand and its image hosted (finalize.mjs
  // approve, in a hidden child process); the next Create & publish run schedules it in Metricool.
  if (path === "/api/approve" && req.method === "POST") return api(res, async () => {
    const id = draftId(await body(req));
    findDraftOrThrow(id);
    const r = await runScript("finalize.mjs", ["approve", "--id", id], 15 * 60000, { early: true });
    const x = r.results?.[0];
    if (!r.ok) throw new Error(r.error || "Not approved.");
    if (x && !x.ok) throw new Error(x.error || "Not approved.");
    return { id, brand_post: x?.brand_post || null, image_host: x?.image_host || null };
  });
  // Posts -> Approved / Scheduled -> "Back to review" (finalize.mjs unapprove, hidden child process): the approval is undone, the
  // hosted image removed from the image repo, the post is To review again. Never for a Posted post. A post already
  // scheduled in Metricool needs metricool_deleted: true (the person confirmed they deleted it there).
  if (path === "/api/unapprove" && req.method === "POST") return api(res, async () => {
    const b = await body(req);
    const id = draftId(b);
    findDraftOrThrow(id);
    const r = await runScript("finalize.mjs", ["unapprove", "--id", id, ...(b.metricool_deleted === true ? ["--metricool-deleted"] : [])], 10 * 60000);
    if (!r.ok) throw new Error(r.error || "Not moved back.");
    return { id, status: r.status, post: r.post, archive: r.archive };
  });
  // Brand edit page, "Open skill folder": everything beyond the few fields of the app is edited there.
  if (path === "/api/open-skill" && req.method === "POST") return api(res, async () => {
    const id = String((await body(req)).id || "");
    const b = discovered().brands.find((x) => x.id === id);
    if (!b) throw new Error(`Unknown brand "${id}".`);
    spawn(process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open", [b.dir], { detached: true, stdio: "ignore", windowsHide: false }).unref();
    return { ok: true };
  });
  // Settings summary "Times": primary and backup hours per day of the research table (config/best-times.json, Facebook).
  if (path === "/api/settings" && req.method === "GET") return api(res, () => {
    const fb = researchTimes().networks?.facebook || {};
    const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].filter((d) => fb.days?.[d]);
    const table = days.map((d) => { const t = dayTimes(d, { best: null, research: researchTimes(), network: "facebook" }); return { day: d, primary: t.times.map((x) => x.slice(0, 5)), backup: t.backup.map((x) => x.time.slice(0, 5)), acceptable: t.acceptable.map((x) => x.time.slice(0, 5)) }; });
    const sp = (k) => { const n = table.map((r) => r[k].length); return n.length ? [Math.min(...n), Math.max(...n)] : [0, 0]; };
    return { settings: rawSettings(), skillsRootResolved: settings().skillsRoot, times: { primary: sp("primary"), backup: sp("backup"), acceptable: sp("acceptable"), table } };
  });
  if (path === "/api/settings" && req.method === "POST") return api(res, async () => {
    const b = await body(req);
    if (!isObject(b.settings)) throw new Error("Missing settings (settings must be a JSON object).");
    return { settings: saveSettings(b.settings) };
  });
  // Tổng quan, Chọn skill / Đổi skill: the skill folders found in a source folder (default the vaniecom-workspace skills).
  // POST (session token), so no other page can list folders on this machine.
  // Chrome profiles (read only) and opening a window in one profile (session token via the POST guard, loopback only, no CORS; allow-lists in core/setup/chrome.mjs).
  if (path === "/api/chrome-profiles" && req.method === "GET") return api(res, () => chromeInfo({ settings: settings() }));
  if (path === "/api/chrome-setup-check" && req.method === "GET") return api(res, () => ({ ...chromeSetupCheck({ profile: new URL(req.url, "http://x").searchParams.get("profile") || "", settings: settings() }), last_full_check: readCheck() }));
  if (path === "/api/open-chrome" && req.method === "POST") return api(res, async () => { const b = await body(req); return openChromeProfile({ profile: b.profile, url: b.url, settings: settings() }); });
  // Settings, Accounts and Requirements (core/setup/accounts.mjs): names only, never a token.
  if (path === "/api/accounts" && req.method === "GET") return api(res, () => accounts({ metricool: (() => { try { return metricoolBrands(); } catch { return {}; } })() }));
  if (path === "/api/skills" && req.method === "GET") return api(res, () => ({ default_source: defaultSource() }));
  if (path === "/api/skills/sources" && req.method === "POST") return api(res, async () => listSources(String((await body(req)).from || "").trim() || defaultSource()));
  // A brand's avatar (previews, Overview): only the avatar file inside a linked skill folder (lib.mjs brandAvatar).
  if (path === "/avatar") { const b = discovered().brands.find((x) => x.id === get("brand")); const a = b ? brandAvatar(b.dir) : ""; return a ? sendFile(res, a) : (res.writeHead(404), res.end()); }
  if (path === "/file") return allowedFile(get("path")) ? sendFile(res, resolve(get("path"))) : (res.writeHead(404), res.end());
  // Cấu hình, Cập nhật, Tải lại (core/assets/hub.js). The Cấu hình page gets the session token like the main page.
  if (path === "/setup" && req.method === "GET") return sendHtml(res, join(root, "core", "setup", "page.html"));
  if (await configApi(req, res, path)) return;
  if (path === "/api/update-check") {
    let why = "";
    const out = await pwshOut(`. '${q(join(root, "core", "update.ps1"))}' -NoRun; [pscustomobject]@{ current = (Get-InstalledVersion '${q(root)}'); next = (Get-AppUpdate '${q(root)}') } | ConvertTo-Json -Compress`, 60000).catch((e) => { why = String((e && (e.stderr || e.message)) || "").replace(/\s+/g, " ").trim().slice(0, 300); return ""; });
    res.writeHead(out ? 200 : 502, { "content-type": TYPES[".json"] });
    return res.end(out || JSON.stringify({ error: why || "update check failed" }));
  }
  if (path === "/api/update" && req.method === "POST") {
    const ok = await pwshOut(`. '${q(join(root, "core", "update.ps1"))}' -NoRun; Update-App '${q(root)}'`, 300000).then(() => true, () => false);
    send(res, ok ? 200 : 500, { ok });
    if (ok) setTimeout(() => { server.close(); restart(); }, 300);
    return;
  }
  if (path === "/api/reload" && req.method === "POST") { send(res, 200, { ok: true }); setTimeout(() => { server.close(); restart(); }, 300); return; }
  // The agents do the work (prompts); the app only shows and manages. Closing the window stops the server.
  if (path === "/api/run") return send(res, 200, { running: false });
  if (path === "/api/quit" && req.method === "POST") { send(res, 200, { ok: true }); setTimeout(() => { server.close(); process.exit(0); }, 200); return; }
  if (path === "/icon.svg") return sendFile(res, join(root, "icon.svg"));
  const asset = /^\/core\/assets\/([\w.-]+)$/.exec(path);
  if (asset) return CORE_ASSETS.includes(asset[1]) ? sendFile(res, join(root, "core", "assets", asset[1])) : (res.writeHead(404), res.end());
  const rel = path === "/" ? "index.html" : path.slice(1);
  const file = resolve(root, "ui", rel);
  if (!file.startsWith(resolve(root, "ui") + sep)) { res.writeHead(404); return res.end(); }
  return extname(file).toLowerCase() === ".html" ? sendHtml(res, file) : sendFile(res, file);
}

const server = createServer((req, res) => handle(req, res).catch((e) => send(res, 500, { error: e.message })));
function listen(attempt = 0) {
  server.once("error", (e) => {
    // The old server is still closing after an update or a reload.
    if (e.code === "EADDRINUSE" && process.env.SA_WAIT_PORT && attempt < 50) return setTimeout(() => listen(attempt + 1), 200);
    if (e.code === "EADDRINUSE") {
      // Already running for this folder: just show it. Another program on the port: try the next one.
      return fetch(`http://127.0.0.1:${PORT}/api/root`).then((r) => r.json()).then((info) => {
        if (info.root !== root) throw new Error("other");
        if (!process.argv.includes("--no-open")) appWindow(`http://127.0.0.1:${PORT}/`);
        process.exit(0);
      }).catch(() => {
        if (PORT - BASE_PORT >= 20) throw e;
        PORT++;
        listen(attempt);
      });
    }
    throw e;
  });
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`Social Autopilot: http://127.0.0.1:${PORT}/`);
    if (!process.argv.includes("--no-open")) appWindow(`http://127.0.0.1:${PORT}/`);
  });
}
listen();
