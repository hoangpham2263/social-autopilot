// Social Autopilot's window (ui/) served on localhost, on macOS and Windows alike. A thin layer over scripts/: every
// read and write goes through the same functions the scheduled agent runs (scripts/*.mjs), so the UI has no workflow
// logic of its own. core/launch.ps1 starts this file with --no-open and finds it by /api/root; each install gets its own
// port from its folder (47000 + hash), SA_PORT overrides.
import { createServer } from "node:http";
import { spawn, execFile } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, statSync, renameSync, appendFileSync, createReadStream, readdirSync } from "node:fs";
import { join, dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createConfigApi } from "../core/setup/config-api.mjs";
import { PWSH, toolEnv, psCommand, appWindow } from "../core/platform.mjs";
import { workspace, discoverBrands, listDrafts, latestRun, runDir, readJson, loadRefs, rawSettings, saveSettings, settings, toolRoot, cleanText, brandOverview, metricoolBrands, saveMetricoolBrands } from "../scripts/lib.mjs";
import { summary } from "../scripts/draft-lib.mjs";
import { previewOf } from "../scripts/preview.mjs";
import { approve, reject } from "../scripts/approve.mjs";
import { readSocial, saveSocial } from "../scripts/social.mjs";
import { queueReport } from "../scripts/queue.mjs";
import { publish as hostImage, hostAfterWriteback } from "../scripts/host-image.mjs";

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
    created: d.draft.created, by: d.status.by || "", brand_post: d.status.brand_post ? { ...d.status.brand_post, media_url: mediaUrl(d.status.brand_post) } : null, error: d.status.error || "", metadata_clean: d.status.metadata_clean || null, watermark: d.status.watermark || null, preview: previewOf(d),
  })).sort((a, b) => String(b.created).localeCompare(String(a.created)));
}
function scheduledPrompt() {
  const md = readFileSync(join(toolRoot, "docs", "scheduled-prompt.md"), "utf8");
  return md.match(/```text\r?\n([\s\S]*?)```/)?.[1].trim() || md;
}

// ----- HTTP -----
const send = (res, status, data) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(data)); };
const body = async (req, limit = 2 * 1024 * 1024) => {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw new Error("Dữ liệu quá lớn."); chunks.push(c); }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
};
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

// A page's request: a function from scripts/ that may throw; its message goes back as { error }.
const api = async (res, fn) => { try { send(res, 200, await fn()); } catch (e) { send(res, 400, { error: e.message }); } };

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;
  const get = (k) => url.searchParams.get(k) || "";
  if (path === "/api/root") return send(res, 200, { root, service: "social-autopilot", protocol: 1, version: version(), pid: process.pid });
  if (path === "/api/client-error" && req.method === "POST") {
    const { message = "", stack = "" } = await body(req).catch(() => ({}));
    logError("Giao diện Social Autopilot", [message, stack].filter(Boolean).join("\n").slice(0, 4000));
    return send(res, 200, { ok: true });
  }
  if (path === "/api/brands") return api(res, () => { const found = discoverBrands(); return { ...found, metricool: brandOverview(found) }; });
  if (path === "/api/metricool-brands" && req.method === "GET") return api(res, () => metricoolBrands());
  if (path === "/api/metricool-brands" && req.method === "POST") return api(res, async () => saveMetricoolBrands(await body(req)));
  if (path === "/api/brand" && req.method === "GET") return api(res, () => readSocial(get("id")));
  if (path === "/api/brand" && req.method === "POST") return api(res, async () => saveSocial(get("id"), (await body(req)).social));
  if (path === "/api/runs") return api(res, () => {
    const brands = discoverBrands().brands.map((b) => ({ id: b.id, runs: runsOf(b.id) }));
    const brand = get("brand"), date = get("date") || (brand ? latestRun(brand) : "");
    return { brands, current: brand && date ? runData(brand, date) : null };
  });
  if (path === "/api/drafts") return api(res, () => ({ drafts: draftsData(get("brand"), get("status")) }));
  if (path === "/api/queue") return api(res, () => queueReport({ brand: get("brand") || undefined }));
  // Approve = the same as approve.mjs approve: write-back, then the image goes to the image host (image_host).
  if (path === "/api/approve" && req.method === "POST") return api(res, async () => {
    const b = await body(req);
    const r = approve({ id: b.id, by: String(b.by || "").trim(), note: String(b.note || "") });
    const host = await hostAfterWriteback(r);
    return host ? { ...r, image_host: host } : r;
  });
  // "Đưa ảnh lên": host-image.mjs publish for an approved draft's brand post (it refuses anything not approved).
  if (path === "/api/host-image" && req.method === "POST") return api(res, async () => {
    const b = await body(req);
    const d = listDrafts().find((x) => x.id === b.id);
    if (!d) throw new Error(`Không có bản nháp ${b.id}.`);
    if (d.status.status !== "approved" || !d.status.brand_post?.id) throw new Error("Chỉ đưa ảnh lên cho bài đã duyệt và đã ghi vào thương hiệu.");
    return hostImage({ brand: d.draft.brand, post: d.status.brand_post.id });
  });
  if (path === "/api/reject" && req.method === "POST") return api(res, async () => {
    const b = await body(req);
    if (!String(b.note || "").trim()) throw new Error("Từ chối cần lý do.");
    return reject({ id: b.id, by: String(b.by || "").trim(), note: String(b.note) });
  });
  if (path === "/api/settings" && req.method === "GET") return api(res, () => ({ settings: rawSettings(), skillsRootResolved: settings().skillsRoot, scheduledPrompt: scheduledPrompt() }));
  if (path === "/api/settings" && req.method === "POST") return api(res, async () => ({ settings: saveSettings((await body(req)).settings || {}) }));
  if (path === "/file") return allowedFile(get("path")) ? sendFile(res, resolve(get("path"))) : (res.writeHead(404), res.end());
  // Cấu hình, Cập nhật, Tải lại (core/assets/hub.js).
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
  // Nothing runs in the background here (the scheduled agent does the runs), so closing the window just stops.
  if (path === "/api/run") return send(res, 200, { running: false });
  if (path === "/api/quit" && req.method === "POST") { send(res, 200, { ok: true }); setTimeout(() => process.exit(0), 200); return; }
  if (path === "/icon.svg") return sendFile(res, join(root, "icon.svg"));
  const asset = /^\/core\/assets\/([\w.-]+)$/.exec(path);
  if (asset) return CORE_ASSETS.includes(asset[1]) ? sendFile(res, join(root, "core", "assets", asset[1])) : (res.writeHead(404), res.end());
  const rel = path === "/" ? "index.html" : path.slice(1);
  const file = resolve(root, "ui", rel);
  if (!file.startsWith(resolve(root, "ui") + sep)) { res.writeHead(404); return res.end(); }
  return sendFile(res, file);
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
