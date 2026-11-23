// "Run now": starts Claude Code headless (`claude -p`) for one mode and keeps a short, sanitized view of its progress.
// One run at a time (one browser, one agent). The prompt goes to STDIN, never argv. Nothing secret is stored.
// Tool/stream output (inputs and results of tools) is never kept: only assistant text and tool NAMES, scrubbed and cut.
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { platform as osPlatform, homedir } from "node:os";
import { classifyProblem } from "./agent-problems.mjs";
import { browserSettings, WINDOW_SIZE } from "./own-browser.mjs";
import { extensionProfileProblem, extensionToken } from "./chrome.mjs";

export const MODES = ["research", "create", "publish", "sync"]; // sync = refresh the Metricool brand list (short, read only, no browser)
// Hard time limits (minutes) and --max-turns per mode. "create_flow" = Create with image engine Flow (images take 20-30 s each, 3-image albums
// need many turns). Both are settings: agent_run.timeout_minutes.<mode|create_flow>, agent_run.max_turns (a number for all, or an object per mode).
// 0 = no limit (default): a run goes on until it is done or the user presses Stop; set the settings above to bring a limit back.
export const DEFAULT_MINUTES = { research: 0, create: 0, create_flow: 0, publish: 0, sync: 5 };
export const DEFAULT_TURNS = { research: 0, create: 0, create_flow: 0, publish: 0, sync: 25 };
export const MAX_LINE = 300, LOG_LINES = 2000, TAIL_LINES = 30;
const MC = "mcp__claude_ai_Metricool_Social_Media_Management__";
const BASE = ["Bash", "Read", "Write", "Edit", "Glob", "Grep"];
const METRICOOL_READ = ["getBrandSettings", "getBestTimeToPostByNetwork", "getScheduledPosts"].map((n) => MC + n);
export const ALLOWED_TOOLS = {
  research: ["mcp__playwright__*", "Bash", "Read", "Glob", "Grep"],
  create: [...BASE, ...METRICOOL_READ],
  sync: ["Bash", "Read", "Write", MC + "getBrandSettings"], // only reads the brand list; never a Metricool write tool
  publish: [...BASE, ...METRICOOL_READ, MC + "createScheduledPost"], // getBrandSettings, getBestTimeToPostByNetwork, getScheduledPosts + createScheduledPost; Create never gets a Metricool write tool
};

// Create with image engine Google Flow: the agent drives Flow in the signed-in Chrome, so the Playwright browser tools are added.
export const FLOW_TOOLS = ["browser_tabs", "browser_navigate", "browser_snapshot", "browser_click", "browser_type", "browser_press_key", "browser_wait_for", "browser_run_code_unsafe", "browser_take_screenshot", "browser_evaluate", "browser_file_upload"].map((n) => "mcp__playwright__" + n);
// The engine of a run: the one chosen for this run (Run tab "Images", per run only) when valid, else the tool setting image_engine.
export const runEngine = (settings = {}, engine = "") => (engine === "codex" || engine === "flow" ? engine : settings?.image_engine === "flow" ? "flow" : "codex");
export const usesFlow = (mode, settings = {}, engine = "") => mode === "create" && runEngine(settings, engine) === "flow";
// Which runs drive the browser (Playwright MCP): Research, and Create with Flow. Publish and Create with Codex never touch it.
export const needsBrowser = (mode, settings = {}, engine = "") => mode === "research" || usesFlow(mode, settings, engine);
// Folders the agent may read/write: the tool, the skills root (brand-content-skills), the optional brandsRoot, and Downloads for Flow (it moves downloaded images from there).
export const addDirs = ({ toolRoot, settings = {}, flow = false, home = homedir() }) => [...new Set([toolRoot, settings.skillsRoot, settings.brandsRoot, flow ? join(home, "Downloads") : ""].filter((d) => typeof d === "string" && d))];
export const limitsFor = (mode, settings = {}, flow = false) => {
  const key = flow ? "create_flow" : mode, ar = settings.agent_run || {};
  const m = Number(ar.timeout_minutes?.[key]) > 0 ? Number(ar.timeout_minutes[key]) : flow && Number(ar.timeout_minutes?.create) > 0 ? Math.max(Number(ar.timeout_minutes.create), DEFAULT_MINUTES.create_flow) : DEFAULT_MINUTES[key];
  const mt = ar.max_turns, pick = (v) => (Number.isInteger(v) && v > 0 ? v : 0);
  const turns = pick(mt && typeof mt === "object" ? mt[key] ?? (flow ? mt.create : undefined) : mt) || DEFAULT_TURNS[key];
  return { limitMin: m, maxTurns: turns };
};
// Model of a run (Run tab "Model"): default = no flag (Claude Code's own default); haiku | sonnet | opus = `--model <alias>` (aliases checked with `claude --help`).
// Setting agent_run.model_map {haiku, sonnet, opus} may map an alias to a full model id; otherwise the alias itself is passed.
export const MODELS = ["default", "haiku", "sonnet", "opus"];
export const modelFlag = (model, settings = {}) => {
  if (!model || model === "default") return "";
  const custom = settings?.agent_run?.model_map?.[model];
  return typeof custom === "string" && /^[A-Za-z0-9._:\[\]-]{1,80}$/.test(custom.trim()) ? custom.trim() : model;
};
// Settings > Claude: agent.claude_model (haiku default) and agent.claude_effort ('' = no flag). The CLI accepts the exact ids.
export const CLAUDE_MODEL_IDS = { haiku: "claude-haiku-5-5", sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5" };
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
// The stored setting wins for every run; a model sent with the request (old Run-tab value) is only the fallback when unset.
export const claudeChoice = (settings = {}, requested = "") => {
  const a = settings?.agent || {}, ok = (k) => k === "haiku" || k === "sonnet" || k === "opus";
  const key = ok(a.claude_model) ? a.claude_model : ok(requested) ? requested : "haiku";
  const custom = settings?.agent_run?.model_map?.[key];
  const id = typeof custom === "string" && /^[A-Za-z0-9._:[]-]{1,80}$/.test(custom.trim()) ? custom.trim() : CLAUDE_MODEL_IDS[key];
  return { key, id, effort: EFFORTS.includes(a.claude_effort) ? a.claude_effort : "" };
};
export const allowedTools = (mode, settings = {}, engine = "") => [...ALLOWED_TOOLS[mode], ...(usesFlow(mode, settings, engine) ? FLOW_TOOLS : [])];

// Anything that looks like a secret is replaced before a line is kept.
const SCRUBS = [
  [/\bBearer\s+\S+/gi, "Bearer [hidden]"],
  [/X-Collect-Token\s*[:=]?\s*\S+/gi, "X-Collect-Token [hidden]"],
  [/\b[\w-]*(?:token|secret|password|passwd|api[_-]?key|authorization)[\w-]*\s*[:=]\s*\S+/gi, "[hidden]"],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, "[hidden]"],
  [/[A-Za-z0-9+/_=-]{40,}/g, "[hidden]"],
];
export function sanitize(text, max = MAX_LINE) {
  let s = String(text ?? "").replace(/\s+/g, " ").trim();
  for (const [re, to] of SCRUBS) s = s.replace(re, to);
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// The final report keeps its line breaks (markdown) and is cut only at REPORT_MAX characters.
export const REPORT_MAX = 12000;
export function sanitizeReport(text, max = REPORT_MAX) {
  let s = String(text ?? "").replace(/\r\n?/g, "\n").split("\n").map((l) => {
    let t = l.replace(/[ \t]+/g, " ").replace(/\s+$/, "");
    for (const [re, to] of SCRUBS) t = t.replace(re, to);
    return t;
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (s.length > max) s = s.slice(0, max).replace(/\s+$/, "") + "\n(report shortened)";
  return s;
}

// Playwright MCP of a run (own = { userDataDir, headless, outputDir }): the tool's own Chrome profile, already logged in by the person; headless unless own.headless is false.
// Flags (checked with `npx @playwright/mcp@latest --help`): --browser chrome, --user-data-dir <path>, --headless, --viewport-size WxH, --output-dir <path>.
// ----- friendly live lines (Vietnamese, for the person): built from tool NAMES and a few safe words of the input (a draft id and image number for per-image steps); never a path, token or JSON -----
export const FRIENDLY_LINES = 40;
const MODE_VI = { research: "Research", create: "Create", publish: "Publish", sync: "Đồng bộ Metricool" };
const baseName = (f) => String(f || "").split(/[\\/]/).pop().toLowerCase();
export function friendlyTool(name, input = {}) {
  const n = String(name || ""), i = input && typeof input === "object" ? input : {};
  if (n === "Bash") {
    const c = String(i.command || "");
    if (/pipeline\.mjs\s+create/.test(c)) return "Đang tạo bài (pipeline create)";
    if (/pipeline\.mjs/.test(c)) return "Đang chạy quy trình bài đăng";
    // Per-image steps name the draft and image ("Bài <draft> · ảnh 2 · ..."): a draft id is a plain name, never a secret.
    const did = (/--id[= ]+["']?([a-z0-9][a-z0-9-]{2,60})/i.exec(c) || /--tag[= ]+["']?([a-z0-9][a-z0-9-]{2,60})#/i.exec(c) || [])[1];
    const num = (/--n[= ]+["']?(\d)/i.exec(c) || /--tag[= ]+["']?[a-z0-9-]+#(\d)/i.exec(c) || [])[1];
    const m = (t) => (did ? `Bài ${did}${num ? ` · ảnh ${num}` : ""} · ${t}` : t);
    if (/draft\.mjs\s+register-image/.test(c)) return m("Lưu ảnh Flow");
    if (/draft\.mjs\s+flow-brief/.test(c)) return m(/--safe\b/.test(c) ? "Flow từ chối → thử lại 1 lần bằng mô tả an toàn" : "Chuẩn bị nội dung gửi Flow");
    if (/draft\.mjs\s+sign-check/.test(c)) return m("Kiểm chữ trên biển");
    if (/flow-pace\.mjs\s+gate/.test(c)) return m("Chờ nhịp rồi gửi prompt Flow");
    if (/flow-pace\.mjs/.test(c)) return "Đang điều nhịp Flow";
    if (/draft\.mjs/.test(c)) return "Đang xử lý bài nháp";
    if (/(?:research|collect)\.mjs/.test(c)) { const m = /--source[= ]+([a-z0-9][a-z0-9,-]{0,60})/i.exec(c); return m ? `Đang đọc nguồn ${m[1]}` : "Đang đọc nguồn"; }
    if (/host-image|finalize\.mjs\s+approve/.test(c)) return "Đang đưa ảnh lên host";
    if (/queue\.mjs|brands\.mjs/.test(c)) return "Đang kiểm tra trạng thái";
    return "Đang xử lý…";
  }
  if (n === "Write" || n === "Edit") return /caption|idea/.test(baseName(i.file_path)) ? "Đang viết nội dung (caption/ý tưởng)" : "Đang ghi dữ liệu";
  if (n === "Read") return /\.(png|jpe?g|webp|gif)$/.test(baseName(i.file_path)) ? "Đang xem ảnh" : "Đang đọc tài liệu";
  if (n === "Glob" || n === "Grep") return "Đang tìm dữ liệu";
  if (n === "mcp__playwright__browser_navigate") { try { return `Đang mở ${new URL(String(i.url)).hostname}`; } catch { return "Đang mở trang web"; } }
  if (/^mcp__playwright__browser_(click|type|press_key|run_code_unsafe|fill_form|select_option|file_upload|evaluate)$/.test(n)) return "Đang thao tác trên trình duyệt";
  if (/^mcp__playwright__/.test(n)) return "Đang xem trang trên trình duyệt";
  if (n.startsWith("mcp__claude_ai_Metricool")) return /create|update|send/i.test(n) ? "Đang gửi/hẹn giờ bài trên Metricool" : "Đang đọc cài đặt Metricool";
  return "Đang xử lý…";
}

export function mcpArgs(own = null, profile = "") {
  // --session-name / --session-color: title and color of the Chrome tab group of this run, so the tool's tabs are easy to tell apart.
  // Background mode (PLAYWRIGHT_MCP_BACKGROUND=1 in mcpConfig, = the --background flag of Playwright MCP 0.0.86+, checked in its
  // cdpRelay/browserModel source; the env var is used because an older cached version would refuse an unknown flag): the relay turns Page.bringToFront and
  // Target.activateTarget into no-ops (so page.bringToFront() and browser_tabs select never raise Chrome), new tabs open with
  // active:false, the extension skips its chrome.windows.update({ focused: true }) after Connect, and with a token the Connect page opens
  // with --open-in-background. Without it every run pulled Chrome to the front while the person worked in other apps.
  if (!own) return ["@playwright/mcp@latest", "--extension", ...(profile ? ["--profile-dir-name", profile] : []), "--session-name", "Social Autopilot", "--session-color", "orange"];
  // Own browser: the page size of the tool's window (WINDOW_SIZE of own-browser.mjs: compact, never below ~1024x700 or sites go mobile).
  return ["@playwright/mcp@latest", "--browser", "chrome", "--user-data-dir", own.userDataDir, ...(own.headless === false ? [] : ["--headless"]), "--viewport-size", `${WINDOW_SIZE.width}x${WINDOW_SIZE.height}`, ...(own.outputDir ? ["--output-dir", own.outputDir] : [])];
}
// background: kept only for callers; no run uses Playwright MCP background mode since 2026-11-23 (hidden tabs broke Flow and FB/IG).
// snapshot "none" (Research): Playwright MCP 0.0.86+ stops appending the whole page tree to every tool answer. On a Facebook feed that
// tree was ~15k tokens per extract call and research runs stopped after a few minutes for budget (2026-11-23); browser_snapshot still works when asked.
export function mcpConfig({ plat = osPlatform(), profile = "", own = null, background = true, snapshot = "" } = {}) {
  const a = [...mcpArgs(own, profile), ...(snapshot ? ["--snapshot-mode", snapshot] : [])];
  const server = plat === "win32" ? { command: "cmd", args: ["/c", "npx", ...a] } : { command: "npx", args: a };
  if (!own) server.env = { ...(profile ? { PLAYWRIGHT_MCP_PROFILE_DIR_NAME: profile } : {}), };  // background mode removed 2026-11-23 (user request): hidden tabs broke Flow and FB/IG
  return { mcpServers: { playwright: server } };
}

// Extension mode (browser.mode "extension"): the person's everyday Chrome. The person is at the screen and clicks Connect.
export const extensionNote = "RUN-NOW NOTE: this run uses the person's everyday Chrome through the Playwright extension, so the person is at the computer and will click Connect in Chrome.\nIf browser_tabs shows only a Welcome / connect.html tab, or the browser tools fail: the Playwright MCP has ALREADY opened that page, do NOT open a second copy; bring it to the front with browser_run_code_unsafe: async (page) => { await page.bringToFront(); } and tell the person in one line to click Connect. Then wait up to 3 minutes, calling browser_tabs about every 15 seconds, until a real page tab appears. If nothing connects, stop and report that Chrome did not connect.\nDownloads: this mode cannot use download.saveAs; click the download button, then take the newest file from the Downloads folder.\n\n";

// Every run keeps its tab visible since 2026-11-23 (background mode removed), so the Flow note is the same note.
export const flowExtensionNote = extensionNote;

// Own-browser note put in front of the prompt of a run that uses the browser.
export const ownNote = (headless = true) => `RUN-NOW NOTE: this run uses the tool's OWN browser (a dedicated Chrome profile the person already logged in to${headless ? ", running in the background (headless)" : ""}). There is no Connect step and no extension: ignore any instruction to click Connect, run chrome-connect.mjs or wait for the person; start with browser_tabs or browser_navigate.
Downloads: in browser_run_code_unsafe you can capture a download with const [d] = await Promise.all([page.waitForEvent('download'), <click that starts it>]); await d.saveAs(<absolute path under the draft folder or the Downloads folder>); (this works here, unlike in extension mode).
If a site shows a login wall, a checkpoint / security check or a captcha: STOP, do not try to log in, and report it in one line (name the site and say "login wall" or "checkpoint"): the person must re-open the login window (Run tab > Browser > Open browser to log in).

`;

export function validate({ mode, prompt, model }) {
  if (!MODES.includes(mode)) return "mode must be research, create, publish or sync.";
  if (model !== undefined && model !== null && model !== "" && !MODELS.includes(model)) return "model must be default, haiku, sonnet or opus.";
  if (typeof prompt !== "string") return "prompt must be a string.";
  if (prompt.length < 200 || prompt.length > 60000) return "prompt must be 200 to 60000 characters.";
  if (!prompt.startsWith("TASK:")) return "prompt must start with TASK:.";
  return "";
}

// "Chạy tiếp lượt trước": a run that stopped midway (stopped / failed / timeout) can be started again with the SAME inputs
// (prompt, brands, model, image engine: kept in runs/agent-run-input.json) plus this one line in front of the prompt.
export const RESUMABLE = ["stopped", "failed", "timeout"];
const CONTINUE_HINT = {
  research: "a brand whose research run of today already exists: go on with node scripts/research.mjs next instead of research.mjs start",
  create: "node scripts/pipeline.mjs create --resume",
  publish: "posts the stopped run already sent are on Metricool and count toward its Posts limit: send only the rest, then node scripts/pipeline.mjs publish --resume",
};
export const continueLine = (mode, prev = {}) => `CONTINUE: this run continues the previous ${mode} run that ${prev.status === "timeout" ? "hit its time limit" : prev.status === "stopped" ? "was stopped" : "failed"} midway, same task: check what already exists and only do what is missing, never redo finished work (${CONTINUE_HINT[mode] || "check the state first"}).

`;

const defaultKill = (child, plat) => {
  if (!child?.pid) return;
  if (plat === "win32") { try { spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 10000, stdio: "ignore" }); } catch {} return; }
  try { child.kill("SIGTERM"); } catch {}
  const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 3000); t.unref?.();
};
const defaultNpx = (plat) => {
  try {
    if (plat === "win32") execFileSync("cmd", ["/c", "npx", "--version"], { windowsHide: true, timeout: 20000, stdio: "ignore" });
    else execFileSync("npx", ["--version"], { timeout: 20000, stdio: "ignore" });
    return true;
  } catch { return false; }
};

export function createAgentRunner({ toolRoot, workspace, getSettings = () => ({}), findCli, plat = osPlatform(), spawnFn = spawn, killTree = (c) => defaultKill(c, plat), npxOk = () => defaultNpx(plat), now = () => Date.now(), graceMs = 4000, onEnd = null, home = homedir(), browserCheck = () => "", loginWindowOpen = () => false }) {
  const runsDir = join(workspace, "runs"), tmpDir = join(workspace, "tmp");
  const stateFile = join(runsDir, "agent-run.json"), logFile = join(runsDir, "agent-run.log"), inputFile = join(runsDir, "agent-run-input.json");
  let cur = null; // the active run
  let last = null; // the finished run's state (this process)

  const friendlyFile = join(runsDir, "agent-run-friendly.json");
  const saveFriendly = (run) => { try { mkdirSync(runsDir, { recursive: true }); writeFileSync(friendlyFile, JSON.stringify(run.friendly)); } catch {} };
  const friendlyView = (list) => (Array.isArray(list) ? list : []).slice(-FRIENDLY_LINES).map((f) => ({ t: f.t || "", text: String(f.text || ""), n: f.n || 1 }));
  const say = (run, text) => {
    const t = sanitize(text, 160); if (!t) return;
    const last = run.friendly.at(-1);
    if (last && last.text === t) { last.n++; last.t = new Date(now()).toISOString(); } else { run.friendly.push({ t: new Date(now()).toISOString(), text: t, n: 1 }); if (run.friendly.length > 200) run.friendly.splice(0, run.friendly.length - 200); }
    saveFriendly(run);
  };
  const readState = () => { try { return JSON.parse(readFileSync(stateFile, "utf8")); } catch { return null; } };
  const saveState = (st) => { try { mkdirSync(runsDir, { recursive: true }); writeFileSync(stateFile, JSON.stringify(st, null, 2)); } catch {} };
  const touch = (run, patch = {}) => { Object.assign(run.state, patch, { updated: new Date(now()).toISOString() }); saveState(run.state); };
  const addLine = (run, text) => {
    const line = sanitize(text); if (!line) return;
    run.lines.push(line); if (run.lines.length > LOG_LINES) run.lines.splice(0, run.lines.length - LOG_LINES);
    // Rotating: the file is rewritten from the last 2000 lines every 500 lines.
    try { mkdirSync(runsDir, { recursive: true }); if (++run.written % 500 === 0) writeFileSync(logFile, run.lines.join("\n") + "\n"); else appendFileSync(logFile, line + "\n"); } catch {}
  };
  // Auth / Metricool problems are visible at once (live); login / profile problems only from the final text.
  const scan = (run, text, kinds = run.own ? ["metricool"] : ["auth", "metricool"]) => { if (run.state.problem) return; const p = classifyProblem(text, { mode: run.state.mode, needsBrowser: run.browser, own: run.own, kinds }); if (p) touch(run, { problem: p }); };
  const handleLine = (run, raw) => {
    let ev; try { ev = JSON.parse(raw); } catch { addLine(run, raw); return; }
    if (ev.type === "assistant" && Array.isArray(ev.message?.content)) {
      run.state.turns = (run.state.turns || 0) + 1;
      if (typeof ev.error === "string") scan(run, ev.error);
      for (const c of ev.message.content) {
        if (c.type === "text" && c.text) { addLine(run, "A: " + c.text); say(run, c.text.replace(/\s+/g, " ").trim()); scan(run, c.text); const t = sanitize(c.text); if (t) run.state.last_text = t; run.lastRaw = c.text; }
        else if (c.type === "tool_use" && typeof c.name === "string") { addLine(run, "tool: " + c.name); say(run, friendlyTool(c.name, c.input)); }
      }
      touch(run);
    } else if (ev.type === "result") {
      run.result = { is_error: !!ev.is_error, subtype: String(ev.subtype || "") };
      if (typeof ev.num_turns === "number") run.state.turns = ev.num_turns;
      if (typeof ev.result === "string" && ev.result) { run.state.last_text = sanitize(ev.result); run.state.report = sanitizeReport(ev.result); if (run.result.is_error) scan(run, ev.result); }
      addLine(run, `result: ${run.result.subtype}${run.result.is_error ? " (error)" : ""}`);
      touch(run);
    }
  };
  const feed = (run, chunk) => {
    run.buf += chunk.toString("utf8");
    let i;
    while ((i = run.buf.indexOf("\n")) >= 0) { const l = run.buf.slice(0, i).trim(); run.buf = run.buf.slice(i + 1); if (l) handleLine(run, l); }
    if (run.buf.length > 1e6) run.buf = "";
  };
  const finish = (run, code, err) => {
    if (run.ended) return; run.ended = true;
    clearTimeout(run.timer);
    if (run.buf.trim()) handleLine(run, run.buf.trim());
    try { rmSync(run.cfg, { force: true }); } catch {}
    const status = run.forced || (code === 0 && !run.result?.is_error ? "done" : "failed");
    // Last look for an actionable cause: the exit text, stderr, the final text (login / profile problems only count here).
    if (status !== "stopped") {
      const text = [err, ...run.stderr, run.state.last_text].filter(Boolean).join(" | ");
      const p = run.state.problem || classifyProblem(text, { mode: run.state.mode, needsBrowser: run.browser, own: run.own, kinds: run.own ? (status === "failed" ? ["login", "profile", "auth", "metricool"] : ["login", "profile"]) : status === "failed" ? ["auth", "metricool"] : [] });
      if (p) run.state.problem = p;
    }
    if (!run.state.report && run.lastRaw) run.state.report = sanitizeReport(run.lastRaw);
    const problem = run.state.problem;
    const error = status === "failed" ? (problem ? problem.message : sanitize(err || run.stderr.at(-1) || (run.result?.is_error ? `Claude reported ${run.result.subtype || "an error"}.` : `Claude exited with code ${code}.`)))
      : status === "timeout" ? `Stopped after the ${run.limitMin}-minute limit.${problem ? " " + problem.message : ""}` : status === "done" && problem ? problem.message : "";
    say(run, status === "failed" ? `Lỗi: ${error}` : status === "stopped" ? "Bị dừng" : status === "timeout" ? "Hết thời gian" : problem ? `Hoàn tất, nhưng cần xem: ${problem.message}` : "Hoàn tất");
    addLine(run, `end: ${status}${code === null || code === undefined ? "" : " (exit " + code + ")"}`);
    try { writeFileSync(logFile, run.lines.join("\n") + "\n"); } catch {}
    touch(run, { status, exit_code: code ?? null, error });
    last = run.state; cur = null;
    // The run result goes to the run log like a prompt run (the server writes it, only when the agent did not).
    try { onEnd?.({ ...run.state }); } catch {}
  };

  const readInput = () => { try { return JSON.parse(readFileSync(inputFile, "utf8")); } catch { return null; } };
  // Whether the last run can be continued: it ended midway (or the app closed while it ran) and its inputs were kept. Never the prompt itself.
  function resumeInfo() {
    if (cur) return { available: false };
    const st = last || readState(); if (!st) return { available: false };
    const status = st.status === "running" ? "failed" : st.status, inp = readInput();
    const available = RESUMABLE.includes(status) && st.mode !== "sync" && !!inp && inp.run_id === st.run_id && inp.mode === st.mode && typeof inp.prompt === "string";
    return available ? { available, run_id: st.run_id, mode: st.mode, status, brands: Array.isArray(inp.brands) ? inp.brands : [], model: inp.model || "default", image_engine: inp.image_engine || "", started: st.started || "", ended: st.updated || "" } : { available: false };
  }

  function start({ mode, prompt, brands, imageEngine, model, resume = false } = {}) {
    let prefix = "", from = "";
    if (resume) {
      if (cur) return { ok: false, status: 409, error: `A ${cur.state.mode} run is already active (started ${cur.state.started}). Only one run at a time: wait for it or press Stop.` };
      const ri = resumeInfo();
      if (!ri.available) return { ok: false, status: 409, error: "There is no stopped run to continue." };
      const inp = readInput();
      ({ mode, prompt, brands, model } = inp); imageEngine = inp.image_engine || "";
      prefix = continueLine(mode, ri); from = ri.run_id;
    }
    const bad = validate({ mode, prompt, model });
    if (bad) return { ok: false, status: 400, error: bad };
    if (cur) return { ok: false, status: 409, error: `A ${cur.state.mode} run is already active (started ${cur.state.started}). Only one run at a time: wait for it or press Stop.` };
    const found = findCli();
    if (!found?.found) return { ok: false, status: 400, error: "Claude CLI not found: set claudeCli.command in workspace/settings.json." };
    const s = getSettings() || {};
    const flow = usesFlow(mode, s, imageEngine);
    if ((mode === "research" || flow) && !npxOk()) return { ok: false, status: 400, error: "npx is not available (it comes with Node.js): the Playwright MCP cannot start." };
    const profile = String(s.research?.chrome_profile || "").trim();
    const browser = needsBrowser(mode, s, imageEngine);
    const bs = browserSettings(s, toolRoot), own = browser && bs.mode === "own";
    if (own) {
      if (loginWindowOpen()) return { ok: false, status: 409, error: "The login window of the own browser is open: close it first (a run needs the profile), then press Run now." };
      const why = browserCheck(bs.profileDir); if (why) return { ok: false, status: 409, error: why };
    }
    if (browser && !own) {
      const why = extensionProfileProblem(s, { flow }); if (why) return { ok: false, status: 409, error: why };
    }
    const { limitMin, maxTurns } = limitsFor(mode, s, flow);
    const runId = `${new Date(now()).toISOString().replace(/\D/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;
    mkdirSync(tmpDir, { recursive: true }); mkdirSync(runsDir, { recursive: true });
    const cfg = join(tmpDir, `mcp-${runId}.json`);
    // The Playwright MCP is only configured for runs that need the browser: Publish and Create with Codex never start it.
    if (browser) writeFileSync(cfg, JSON.stringify(mcpConfig({ plat, profile, own: own ? { userDataDir: bs.profileDir, headless: bs.headless, outputDir: join(tmpDir, "playwright-output") } : null, background: !flow, snapshot: mode === "research" ? "none" : "" })));
    const args = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "default", ...(maxTurns > 0 ? ["--max-turns", String(maxTurns)] : []), "--allowedTools", allowedTools(mode, s, imageEngine).join(","), "--add-dir", ...addDirs({ toolRoot, settings: s, flow, home })];
    const choice = claudeChoice(s, model), modelKey = choice.key;
    args.push("--model", choice.id);
    if (choice.effort) args.push("--effort", choice.effort);
    if (browser) args.push("--mcp-config", cfg);
    if (mode === "research") args.push("--strict-mcp-config");
    const extTok = browser && !own && profile ? extensionToken(workspace, profile) : "";
    const env = { ...process.env, ...(profile && !own ? { PLAYWRIGHT_MCP_PROFILE_DIR_NAME: profile } : {}), ...(extTok ? { PLAYWRIGHT_MCP_EXTENSION_TOKEN: extTok } : {}) };
    const cmd = plat === "win32" && /\.(cmd|bat)$/i.test(found.path) ? ["cmd", ["/c", found.path, ...args]] : [found.path, args];
    let child;
    try { child = spawnFn(cmd[0], cmd[1], { cwd: toolRoot, env, windowsHide: true, detached: false, stdio: ["pipe", "pipe", "pipe"] }); }
    catch (e) { try { rmSync(cfg, { force: true }); } catch {} return { ok: false, status: 500, error: sanitize(e.message) }; }
    const started = new Date(now()).toISOString();
    const run = {
      child, cfg, lines: [], buf: "", written: 0, stderr: [], limitMin, browser, own, ended: false, forced: "", result: null, timer: null,
      state: { run_id: runId, mode, pid: child.pid ?? null, started, updated: started, status: "running", exit_code: null, last_text: "", report: "", turns: 0, error: "", problem: null, flow, model: modelKey, limit_min: limitMin, max_turns: maxTurns, brands: Array.isArray(brands) ? brands.filter((b) => typeof b === "string").slice(0, 50) : [], ...(from ? { resumed_from: from } : {}) },
    };
    // The inputs of this run, for a later "continue" (the original prompt, without the continue line).
    try { writeFileSync(inputFile, JSON.stringify({ run_id: runId, mode, prompt, brands: run.state.brands, model: modelKey, image_engine: imageEngine === "codex" || imageEngine === "flow" ? imageEngine : "" })); } catch {}
    cur = run;
    try { writeFileSync(logFile, ""); } catch {}
    run.friendly = [];
    say(run, `Bắt đầu chạy: ${MODE_VI[mode] || mode}`);
    addLine(run, `start: ${mode} run ${runId}`);
    saveState(run.state);
    child.stdout?.on("data", (c) => feed(run, c));
    child.stderr?.on("data", (c) => { for (const l of c.toString("utf8").split(/\r?\n/)) { const t = sanitize(l); if (t) { run.stderr.push(t); if (run.stderr.length > 20) run.stderr.shift(); addLine(run, "! " + t); } } });
    child.on("error", (e) => finish(run, null, e.message));
    child.on("close", (code) => finish(run, code));
    child.stdin?.on("error", () => {});
    // This text is prepended to the same prompt Copy prompt gives; Copy prompt is not changed.
    const note = own ? ownNote(bs.headless) : browser ? (flow ? flowExtensionNote : extensionNote) : "";
    try { child.stdin?.end(note + prefix + prompt); } catch {}
    // Hard time limit: the whole process tree is killed.
    if (limitMin > 0) run.timer = setTimeout(() => { if (run.ended) return; run.forced = "timeout"; killTree(child); setTimeout(() => finish(run, null), graceMs).unref?.(); }, limitMin * 60000);
    run.timer?.unref?.();
    return { ok: true, status: 200, run_id: runId, mode, started, brands: run.state.brands, resumed: !!from };
  }

  function stop() {
    if (!cur) return { ok: false, status: 409, error: "No run is active." };
    const run = cur; run.forced = "stopped"; killTree(run.child);
    setTimeout(() => finish(run, null), graceMs).unref?.();
    return { ok: true, status: 200, run_id: run.state.run_id };
  }
  function shutdown() {
    if (!cur) return;
    cur.forced = cur.forced || "stopped"; killTree(cur.child);
    try { rmSync(cur.cfg, { force: true }); } catch {}
    touch(cur, { status: "stopped" });
  }

  function status() {
    const run = cur, st = run ? run.state : last || readState();
    const cli = findCli();
    // A state file left "running" by an app that closed is not an active run.
    const shown = st && !run && st.status === "running" ? { ...st, status: "failed", error: "The app closed while this run was active." } : st;
    const lines = run ? run.lines : (() => { try { return readFileSync(logFile, "utf8").split("\n").filter(Boolean); } catch { return []; } })();
    return {
      active: !!run, status: shown?.status || "idle", mode: shown?.mode || "", started: shown?.started || "",
      elapsed_s: shown?.started ? Math.max(0, Math.round(((run ? now() : Date.parse(shown.updated) || now()) - Date.parse(shown.started)) / 1000)) : 0,
      last_text: shown?.last_text || "", report: typeof shown?.report === "string" ? shown.report : "", turns: shown?.turns || 0, error: shown?.error || "", problem: shown?.problem || null, flow: !!shown?.flow, model: MODELS.includes(shown?.model) ? shown.model : "default", limit_min: shown?.limit_min || 0, max_turns: shown?.max_turns || 0, brands: shown?.brands || [], resumed_from: shown?.resumed_from || "",
      resume: resumeInfo(),
      tail: lines.slice(-TAIL_LINES),
      friendly: run ? friendlyView(run.friendly) : friendlyView((() => { try { return JSON.parse(readFileSync(friendlyFile, "utf8")); } catch { return []; } })()),
      cli: { found: !!cli?.found, path: cli?.path || "" },
    };
  }
  return { start, stop, status, shutdown, isActive: () => !!cur, browserActive: () => !!cur?.browser && !!cur?.own };
}
