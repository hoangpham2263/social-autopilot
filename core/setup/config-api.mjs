// Cấu hình, served by Social Autopilot's server: Node.js, Codex CLI and its sign-in.
//   GET /setup[?back=<path>]        the Cấu hình page (page.html, page.js; tool.css from core/assets)
//   POST /api/setup                 the steps (setup-check.ps1 -AsJson)
//   POST /api/setup-step {step}     install: Codex CLI via npm; login: codex login with a one-time code, typed on the
//                                   sign-in page opened in the user's Chrome
//   GET /api/setup-login            { code } while a sign-in waits for it
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findTool, runTool, psFile, onWindows, killTree, openChrome } from "../platform.mjs";
import { createSetupReader } from "./setup-report.mjs";

const here = dirname(fileURLToPath(import.meta.url));

export function createConfigApi({ hubRoot, pwsh, env = process.env }) {
  const readSetup = createSetupReader({ hubRoot, pwsh, args: psFile(join(here, "setup-check.ps1"), ["-AsJson"]), env });
  const json = (res, status, data) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(data)); };
  const body = (req) => new Promise((done) => { const chunks = []; req.on("data", (c) => chunks.push(c)); req.on("end", () => { try { done(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { done({}); } }); });
  // codex login opens the system's default browser; with --device-auth it prints a page and a code instead, so the
  // page opens in Chrome and Cấu hình shows the code to type there.
  // Đăng nhập again while one waits: that one stops (its answer says so) and a new code comes.
  let loginCode = "", login = null;
  const codexLogin = (codex, done) => {
    if (login) { const old = login; login = null; loginCode = ""; killTree(old.child); old.done({ superseded: true }); }
    const child = spawn(onWindows && /\.cmd$/i.test(codex) ? `"${codex}"` : codex, ["login", "--device-auth"], { cwd: hubRoot, env, windowsHide: true, detached: !onWindows, shell: onWindows && /\.cmd$/i.test(codex) });
    const timer = setTimeout(() => killTree(child), 15 * 60000);
    let out = "", opened = false;
    login = { child, done };
    const current = () => login?.child === child;
    const read = (chunk) => {
      out = (out + chunk).replace(/\x1b\[[0-9;]*m/g, "");
      const url = out.match(/https:\/\/\S+\/device\b\S*/)?.[0], code = out.match(/\b[A-Z0-9]{4,}-[A-Z0-9]{4,}\b/)?.[0];
      if (opened || !url || !code || !current()) return;
      opened = true;
      loginCode = code;
      openChrome(url).then((error) => { if (error) { loginCode = ""; killTree(child); done({ error }); } });
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("error", (e) => { clearTimeout(timer); if (!current()) return; login = null; loginCode = ""; done({ error: e.message }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (!current()) return;
      login = null;
      loginCode = "";
      done(code === 0 ? { ok: true } : { error: (out.trim().split(/\r?\n/).pop() || "Chưa đăng nhập được ChatGPT.").slice(0, 300) });
    });
  };

  const PAGE = { "/setup": [join(here, "page.html"), "text/html"], "/setup/page.js": [join(here, "page.js"), "text/javascript"], "/setup/tool.css": [join(here, "..", "assets", "tool.css"), "text/css"] };
  return async function handle(req, res, path) {
    if (PAGE[path] && req.method === "GET") {
      res.writeHead(200, { "content-type": `${PAGE[path][1]}; charset=utf-8`, "cache-control": "no-store" });
      res.end(readFileSync(PAGE[path][0]));
      return true;
    }
    if (path === "/api/setup" && req.method === "POST") {
      const { status, report } = await readSetup();
      json(res, status, report);
      return true;
    }
    if (path === "/api/setup-login") {
      json(res, 200, { code: loginCode });
      return true;
    }
    if (path === "/api/setup-step" && req.method === "POST") {
      const { step } = await body(req);
      if (step === "login") {
        const codex = findTool("codex");
        if (!codex) { json(res, 400, { error: "Chưa cài Codex." }); return true; }
        let answered = false;
        codexLogin(codex, (r) => { if (!answered) { answered = true; json(res, r.error ? 500 : 200, r); } });
        return true;
      }
      if (step !== "install") { json(res, 400, { error: "Bước không hỗ trợ." }); return true; }
      const npm = findTool("npm");
      if (!npm) { json(res, 400, { error: "Chưa có Node.js. Mở lại start-app để cài." }); return true; }
      runTool(npm, ["install", "-g", "@openai/codex"], { timeout: 10 * 60000, env, windowsHide: true }, (err) => json(res, err ? 500 : 200, err ? { error: "Chưa cài được Codex CLI." } : { ok: true }));
      return true;
    }
    return false;
  };
}
