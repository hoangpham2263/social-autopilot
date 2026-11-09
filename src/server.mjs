// Social Autopilot's window (ui/) served on localhost, on macOS and Windows alike. A thin layer over scripts/: every
// read and write goes through the same functions the scheduled agent runs (scripts/*.mjs), so the UI has no workflow
// logic of its own. core/launch.ps1 starts this file with --no-open and finds it by /api/root; each install gets its own
// port from its folder (47000 + hash), SA_PORT overrides.
import { createServer } from "node:http";
import { spawn, execFile } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, statSync, renameSync, appendFileSync, createReadStream, readdirSync } from "node:fs";
import { join, dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createConfigApi } from "../core/setup/config-api.mjs";
import { PWSH, toolEnv, psCommand, appWindow } from "../core/platform.mjs";
import { workspace, discoverBrands, listDrafts, findDraft, withLock, writeJson, stamp, latestRun, runDir, readJson, loadRefs, rawSettings, saveSettings, settings, toolRoot, cleanText, brandOverview, metricoolBrands, saveMetricoolBrands } from "../scripts/lib.mjs";
import { summary } from "../scripts/draft-lib.mjs";
import { previewOf } from "../scripts/preview.mjs";
import { approve, reject } from "../scripts/approve.mjs";
import { readSocial, saveSocial } from "../scripts/social.mjs";
import { queueReport } from "../scripts/queue.mjs";
import { hostConfig, hostAfterWriteback } from "../scripts/host-image.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const BASE_PORT = Number(process.env.SA_PORT || 47000 + (parseInt(createHash("sha1").update(root).digest("hex").slice(0, 6), 16) % 1000));
let PORT = BASE_PORT;
const logs = join(workspace, "logs");
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
function runsOf(brand) {
  const dir = join(workspace, "runs", brand);
  return existsSync(dir) ? readdirSync(dir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse() : [];
}
function runData(brand, date) {
  const dir = runDir(brand, date);
  const run = readJson(join(dir, "run.json"), {});
  const refs = loadRefs(brand, date).map((r) => ({ ...r, image_path: join(dir, r.image) }));
  const ideas = readJson(join(dir, "ideas.json"), { ideas: [] }).ideas;
  return { brand, date, dir, run, refs, ideas };
}
// media_url of an approved post (host-image.mjs) from its brand catalog, read fresh on every request.
function mediaUrl(bp) {
  if (!bp?.catalog) return "";
  try { return readJson(bp.catalog).posts.find((p) => p.id === bp.id)?.media_url || ""; } catch { return ""; }
}
function draftsData(brand, status) {
  return listDrafts(brand || undefined).filter((d) => !status || d.status.status === status).map((d) => ({
    ...summary(d), image_exists: existsSync(join(d.dir, "image.png")), languages: d.draft.languages, language_mode: d.draft.language_mode,
    inspiration_url: d.draft.inspiration.post_url || d.draft.inspiration.source_url, product_image: d.draft.product_image,
    created: d.draft.created, by: d.status.by || "", image_host: d.status.image_host || null, brand_post: d.status.brand_post ? { ...d.status.brand_post, media_url: mediaUrl(d.status.brand_post) } : null, error: d.status.error || "", metadata_clean: d.status.metadata_clean || null, watermark: d.status.watermark || null, preview: previewOf(d),
  })).sort((a, b) => String(b.created).localeCompare(String(a.created)));
}
function scheduledPrompt() {
  const md = readFileSync(join(toolRoot, "docs", "scheduled-prompt.md"), "utf8");
  return md.match(/```text\r?\n([\s\S]*?)```/)?.[1].trim() || md;
}

// ----- HTTP -----
const send = (res, status, data) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(data)); };
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
// A request body: always a JSON object ({} when empty), else a clear message instead of a JavaScript error.
const body = async (req, limit = 2 * 1024 * 1024) => {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw new Error("Dữ liệu quá lớn."); chunks.push(c); }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("Dữ liệu gửi lên không phải JSON hợp lệ."); }
  if (!isObject(data)) throw new Error("Dữ liệu gửi lên phải là một object JSON, ví dụ {\"id\": \"...\"}.");
  return data;
};
const draftId = (b) => {
  const id = typeof b.id === "string" ? b.id.trim() : "";
  if (!id) throw new Error("Thiếu mã bản nháp (id).");
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
  if (!hosts().includes(String(req.headers.host || "").toLowerCase())) return "Máy chủ chỉ nhận yêu cầu gửi tới 127.0.0.1 hoặc localhost của app này.";
  if (req.method === "GET" || req.method === "HEAD") return "";
  const origin = req.headers.origin;
  if (origin !== undefined && !hosts().map((h) => `http://${h}`).includes(origin)) return "Yêu cầu từ trang khác bị chặn.";
  // core/launch.ps1 closes the server with a bare POST /api/quit when the window closes: allowed only from a non-browser
  // client (browsers always send Origin and Sec-Fetch-Site on a POST).
  if (path === "/api/quit" && origin === undefined && !req.headers["sec-fetch-site"]) return "";
  if (!/^application\/json\b/i.test(String(req.headers["content-type"] || ""))) return "Yêu cầu phải gửi Content-Type: application/json.";
  if (!sameToken(req.headers["x-sa-token"])) return "Thiếu hoặc sai mã phiên (X-SA-Token). Mở lại app rồi thử lại.";
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
  setTimeout(() => afterJobs(() => process.exit(0)), 300);
}

// ----- image hosting off the request: git pull/commit/push and the wait for the GitHub Pages link take seconds to
// minutes, so they run in a worker thread of this process (no child Node, no window; the server keeps answering). The
// draft's status.json image_host says pending at once; the worker records the outcome there (host-image.mjs) and the
// window shows it on its next reload. One job per draft at a time; quit/reload wait for running jobs.
const HOST_WORKER = new URL("data:text/javascript," + encodeURIComponent(`
import { workerData } from "node:worker_threads";
const { hostAfterWriteback, publish } = await import(workerData.host);
const { findDraft, withLock, readJson, writeJson, stamp } = await import(workerData.lib);
const { mode, result, input, id } = workerData;
const record = (host) => {
  const file = findDraft(id).dir + "/status.json";
  withLock(file, () => writeJson(file, { ...readJson(file, {}), image_host: { ok: !!host.ok, at: stamp(), ...(host.url ? { url: host.url } : {}), ...(host.ok ? {} : { error: host.error || "", next: host.next || "" }) }, updated: stamp() }));
};
if (mode === "after") { const h = await hostAfterWriteback(result); await h?.promise; }
else { try { record({ ok: true, ...(await publish(input)) }); } catch (e) { record({ ok: false, error: e.message, next: "node scripts/host-image.mjs publish --brand " + input.brand + " --post " + input.post }); } }
`));
const HOST_MODULES = { host: pathToFileURL(join(root, "scripts", "host-image.mjs")).href, lib: pathToFileURL(join(root, "scripts", "lib.mjs")).href };
const PENDING = "Đang đưa ảnh lên và chờ link mở được; tải lại sau ít phút.";
const hostJobs = new Map();
const setImageHost = (id, image_host) => {
  const file = join(findDraft(id).dir, "status.json");
  withLock(file, () => writeJson(file, { ...readJson(file, {}), image_host: { ...image_host, at: stamp() }, updated: stamp() }));
};
function hostInBackground(id, data) {
  const pending = { ok: false, pending: true, background: true, error: PENDING };
  if (hostJobs.has(id)) return pending;
  setImageHost(id, { ok: false, pending: true, error: PENDING });
  const job = new Promise((done) => {
    const w = new Worker(HOST_WORKER, { workerData: { ...HOST_MODULES, id, ...data } });
    w.on("error", (e) => {
      logError(`Đưa ảnh lên (${id})`, e?.stack || e);
      try { setImageHost(id, { ok: false, error: e.message }); } catch {}
    });
    w.on("exit", done);
  }).finally(() => hostJobs.delete(id));
  hostJobs.set(id, job);
  return pending;
}
// Quit/reload: running hosting jobs finish first (at most 5 minutes), so no git push is cut halfway.
const afterJobs = (fn) => Promise.race([Promise.allSettled([...hostJobs.values()]), new Promise((r) => setTimeout(r, 5 * 60000))]).then(fn);

// A page's request: a function from scripts/ that may throw; its message goes back as { error }.
const api = async (res, fn) => { try { send(res, 200, await fn()); } catch (e) { send(res, 400, { error: e.message }); } };

const sendHtml = (res, file) => {
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  const html = withBoot(readFileSync(file, "utf8"));
  res.writeHead(200, { "content-type": TYPES[".html"], "content-length": Buffer.byteLength(html), "cache-control": "no-store" });
  res.end(html);
};

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;
  const get = (k) => url.searchParams.get(k) || "";
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
  if (path === "/api/brand" && req.method === "GET") return api(res, () => {
    if (!get("id")) throw new Error("Thiếu mã thương hiệu (id).");
    return cached(`brand:${get("id")}`, () => readSocial(get("id")));
  });
  if (path === "/api/brand" && req.method === "POST") return api(res, async () => {
    if (!get("id")) throw new Error("Thiếu mã thương hiệu (id).");
    const b = await body(req);
    if (!isObject(b.social)) throw new Error("Thiếu nội dung social.json (social phải là một object JSON).");
    return saveSocial(get("id"), b.social);
  });
  if (path === "/api/runs") return api(res, () => {
    const ids = discovered().brands.map((b) => b.id);
    const brand = get("brand"), date = get("date");
    if (brand && !ids.includes(brand)) throw new Error(`Không có thương hiệu "${brand}".`);
    if (date && !/^d{4}-d{2}-d{2}$/.test(date)) throw new Error("Ngày không hợp lệ (cần dạng YYYY-MM-DD).");
    const day = date || (brand ? latestRun(brand) : "");
    return { brands: ids.map((id) => ({ id, runs: runsOf(id) })), current: brand && day ? runData(brand, day) : null };
  });
  if (path === "/api/drafts") return api(res, () => ({ drafts: draftsData(get("brand"), get("status")) }));
  if (path === "/api/queue") return api(res, () => queueReport({ brand: get("brand") || undefined }));
  // Approve = the same as approve.mjs approve: write-back in this process, then the image goes to the image host in
  // the background (image_host pending in the answer and in status.json; the outcome lands in status.json).
  if (path === "/api/approve" && req.method === "POST") return api(res, async () => {
    const b = await body(req);
    // No named approver: the app's user approves ("user" unless a name is sent).
    const id = draftId(b), by = String(b.by ?? "").trim() || "user";
    const r = approve({ id, by, note: String(b.note ?? "") });
    if (!r?.brand_post?.id || r.reused) return r;
    let h;
    try { h = hostConfig(); } catch { return { ...r, image_host: await hostAfterWriteback(r) }; } // records the settings error; no git runs
    if (!h.auto) return r;
    return { ...r, image_host: hostInBackground(r.id || id, { mode: "after", result: r }) };
  });
  // "Đưa ảnh lên": host-image.mjs publish for an approved draft's brand post (it refuses anything not approved), in the
  // background like an approval: the answer says pending at once.
  if (path === "/api/host-image" && req.method === "POST") return api(res, async () => {
    const id = draftId(await body(req));
    const d = listDrafts().find((x) => x.id === id);
    if (!d) throw new Error(`Không có bản nháp ${id}.`);
    if (d.status.status !== "approved" || !d.status.brand_post?.id) throw new Error("Chỉ đưa ảnh lên cho bài đã duyệt và đã ghi vào thương hiệu.");
    hostConfig(); // a settings problem is answered now, not later in the background
    return { id, pending: true, image_host: hostInBackground(id, { mode: "publish", input: { brand: d.draft.brand, post: d.status.brand_post.id } }) };
  });
  if (path === "/api/reject" && req.method === "POST") return api(res, async () => {
    const b = await body(req);
    const id = draftId(b);
    if (!String(b.note ?? "").trim()) throw new Error("Từ chối cần lý do.");
    return reject({ id, by: String(b.by ?? "").trim() || "user", note: String(b.note) });
  });
  if (path === "/api/settings" && req.method === "GET") return api(res, () => ({ settings: rawSettings(), skillsRootResolved: settings().skillsRoot, scheduledPrompt: scheduledPrompt() }));
  if (path === "/api/settings" && req.method === "POST") return api(res, async () => {
    const b = await body(req);
    if (!isObject(b.settings)) throw new Error("Thiếu cài đặt (settings phải là một object JSON).");
    return { settings: saveSettings(b.settings) };
  });
  if (path === "/file") return allowedFile(get("path")) ? sendFile(res, resolve(get("path"))) : (res.writeHead(404), res.end());
  // Cấu hình, Cập nhật, Tải lại (core/assets/hub.js). The Cấu hình page gets the session token like the main page.
  if (path === "/setup" && req.method === "GET") return sendHtml(res, join(root, "core", "setup", "page.html"));
  if (await configApi(req, res, path)) return;
  if (path === "/api/update-check") {
    const out = await pwshOut(`. '${q(join(root, "core", "update.ps1"))}' -NoRun; [pscustomobject]@{ current = (Get-InstalledVersion '${q(root)}'); next = (Get-AppUpdate '${q(root)}') } | ConvertTo-Json -Compress`, 60000).catch(() => "");
    res.writeHead(out ? 200 : 502, { "content-type": TYPES[".json"] });
    return res.end(out || "{}");
  }
  if (path === "/api/update" && req.method === "POST") {
    const ok = await pwshOut(`. '${q(join(root, "core", "update.ps1"))}' -NoRun; Update-App '${q(root)}'`, 300000).then(() => true, () => false);
    send(res, ok ? 200 : 500, { ok });
    if (ok) setTimeout(() => { server.close(); restart(); }, 300);
    return;
  }
  if (path === "/api/reload" && req.method === "POST") { send(res, 200, { ok: true }); setTimeout(() => { server.close(); restart(); }, 300); return; }
  // The scheduled agent does the runs; closing the window stops the server once any image hosting has finished.
  if (path === "/api/run") return send(res, 200, { running: false });
  if (path === "/api/quit" && req.method === "POST") { send(res, 200, { ok: true }); setTimeout(() => { server.close(); afterJobs(() => process.exit(0)); }, 200); return; }
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
