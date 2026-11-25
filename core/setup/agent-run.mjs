// "Run now": starts Claude Code headless (`claude -p`) for one mode and keeps a short, sanitized view of its progress.
// One run at a time (one browser, one agent). The prompt goes to STDIN, never argv. Nothing secret is stored.
// Tool/stream output (inputs and results of tools) is never kept: only assistant text and tool NAMES, scrubbed and cut.
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync, readdirSync, statSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { platform as osPlatform, homedir, tmpdir } from "node:os";
import { CLAUDE_DEFAULT, CLAUDE_EFFORTS, validClaudeModel, claudeName, agentFor, agyChoice, agyName } from "../../scripts/agent-models.mjs";
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
export const runEngine = (settings = {}, engine = "") => {
  const e = engine === "codex" || engine === "flow" || engine === "antigravity" ? engine : settings?.image_engine === "flow" || settings?.image_engine === "antigravity" ? settings.image_engine : "codex";
  return e; // Flow with an Antigravity Create agent = "Antigravity (Flow)": agy drives Flow through its per-run Playwright MCP
};
// Create with image engine Antigravity (agent.backend antigravity): the agent makes the images with its image-generator subagent: no Flow, no browser, no Playwright MCP.
export const usesAgyImages = (mode, settings = {}, engine = "") => mode === "create" && runEngine(settings, engine) === "antigravity";
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
// First line of every run: the model the CLI reports (init event); provisional from the settings until then.
export const modelLine = (id, effort = "") => { const n = claudeName(id); return `Model in use: ${id}${n.name === "Custom" ? "" : /^[a-z]+$/.test(id) ? ` (${n.name})` : ` (Claude ${n.name})`} · effort: ${effort || "default"}`; };
// A setting that is an alias (haiku, sonnet...) matches any running id of that family.
export const modelMatches = (setting, running) => !setting || !running || running === setting || running.startsWith(setting) || (/^[a-z]+$/.test(setting) && running.includes(setting));
export const modelWarning = (setting, running) => `⚠ Actual model differs from the setting: setting = ${setting}, running = ${running}`;
// Settings > Claude: agent.claude_model (an alias or a model id; default claude-sonnet-4-6) and agent.claude_effort ('' = no flag). Passed as --model as stored.
export const EFFORTS = CLAUDE_EFFORTS;
// The stored setting wins for every run; a model sent with the request (old Run-tab value) is only the fallback when unset.
export const claudeChoice = (settings = {}, requested = "") => {
  const a = settings?.agent || {}, ok = (k) => validClaudeModel(k) && k !== "default";
  const id = ok(a.claude_model) ? a.claude_model : ok(requested) ? requested : CLAUDE_DEFAULT;
  return { key: id, id, effort: EFFORTS.includes(a.claude_effort) ? a.claude_effort : "" };
};
export const allowedTools = (mode, settings = {}, engine = "", threads = 1) => [...ALLOWED_TOOLS[mode], ...(usesFlow(mode, settings, engine) ? FLOW_TOOLS : []), ...((mode === "create" || mode === "research") && threads > 1 ? ["Agent", "Task", ...(mode === "research" ? ["Write"] : [])] : [])]; // Agent: parallel workers for the non-browser steps (Threads > 1); Write: verdict files of the classification workers

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
    const agyImg = /--engine[= ]+antigravity/.test(c); // Antigravity images: never worded as Flow
    if (/draft\.mjs\s+register-image/.test(c)) return m(agyImg ? "Lưu ảnh Antigravity" : "Lưu ảnh Flow");
    if (/draft\.mjs\s+flow-brief/.test(c)) return m(/--safe\b/.test(c) ? (agyImg ? "Ảnh bị từ chối → thử lại 1 lần bằng mô tả an toàn" : "Flow từ chối → thử lại 1 lần bằng mô tả an toàn") : agyImg ? "Chuẩn bị nội dung cho Antigravity tạo ảnh" : "Chuẩn bị nội dung gửi Flow");
    if (/draft\.mjs\s+sign-check/.test(c)) return m("Kiểm chữ trên biển");
    if (/flow-pace\.mjs\s+gate/.test(c)) return m("Chờ nhịp rồi gửi prompt Flow");
    if (/flow-pace\.mjs/.test(c)) return "Đang điều nhịp Flow";
    if (/draft\.mjs/.test(c)) return "Đang xử lý bài nháp";
    if (/(?:research|collect)\.mjs/.test(c)) { const m = /--source[= ]+([a-z0-9][a-z0-9,-]{0,60})/i.exec(c); return m ? `Đang đọc nguồn ${m[1]}` : "Đang đọc nguồn"; }
    if (/host-image|finalize\.mjs\s+approve/.test(c)) return "Đang đưa ảnh lên host";
    if (/queue\.mjs|brands\.mjs/.test(c)) return "Đang kiểm tra trạng thái";
    return "Đang xử lý…";
  }
  if (n === "agy_image") return "Antigravity đang tạo ảnh";
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

// ----- Threads (Run tab "Threads" 1-4, Create only): what may run in parallel -----
// Parallel (safe): Antigravity images (a group of up to N image-generator subagents in ONE turn), Codex images (image-batch slots = max(codex.concurrency, N) via SA_THREADS),
// Claude drafting text for several posts (N sub-agents, disjoint drafts, one writer per draft). Never parallel: Google Flow (pacing gate per profile), Research (one
// source at a time in one tab: the state machine, tokens and blocked-platform skipping), Publish and Sync (Metricool).
export const threadsFor = (mode, threads) => (mode === "create" || mode === "research" ? Math.min(4, Math.max(1, Math.trunc(Number(threads)) || 1)) : 1);
export function threadsNote(mode, n, { agy = false, engine = "codex" } = {}) {
  // THREADS drives the steps that use NO browser, nothing else. n may be the placeholder "{N}" (the copy prompt of the Run tab fills it in).
  // Nothing is added for N = 1, Publish, Sync, a Flow run (any agent: pacing, the pages are Playwright) or an Antigravity Research run (it may call no subagent).
  if ((mode !== "create" && mode !== "research") || (n !== "{N}" && !(Number(n) >= 2))) return "";
  if (engine === "flow" && mode === "create") return "";
  if (agy && mode === "research") return "";
  const t = `THREADS: ${n}\n`, parts = [];
  if (mode === "research") {
    parts.push(`CLASSIFICATION IN PARALLEL (step 1.3 only, the posts the browser already collected): when many posts wait for a verdict you may start up to ${n} sub-agents (Agent tool), each on a DISJOINT slice of the posts that store.mjs classify lists; each judges its slice against product_fit and writes ITS OWN verdict file, then runs store.mjs verdict --file <its file> (the store locks its writes). Sub-agents use NO browser tool and open nothing. You run every other command; wait for all of them before store.mjs classify again.`);
    return t + parts.join("\n") + "\n";
  }
  if (engine === "antigravity") parts.push(`IMAGES IN PARALLEL: make the pictures in GROUPS of up to ${n}: in ONE turn call invoke_subagent once per image of the group (type_name "image-generator", nothing else), wait for all, then LOOK at each and run its register-image one after the other. A group is either the covers (image 1) of up to ${n} DIFFERENT posts, or the extras (image 2..4) of ONE post whose cover is already registered. Never two registers of the same draft at the same time; one failing image never blocks its group.`);
  else parts.push(`Codex images: the tool runs up to ${n} at once by itself (draft.mjs image-batch); nothing to do for it.`);
  if (!agy) parts.push(`WORKERS (steps without a browser): up to ${n} sub-agents (Agent tool) on DISJOINT draft ids: captions, image prompt files, register-image and the checks of different drafts; each writes only its own drafts' files (one writer per draft; shared files go through the tool's locked commands). Keep for YOURSELF what must stay consistent across posts: the ideas list (ideas differ from each other), the sign wording (differs per post), every pipeline.mjs / queue / publish command. Sub-agents use no browser tool. Wait for all of them before the next pipeline step.`);
  else parts.push("Draft text stays one post after another (Antigravity may call no subagent except image-generator).");
  return t + parts.join("\n") + "\n";
}

// ----- Antigravity backend (agent.backend = "antigravity", CLI `agy`) -----
// Same runner, other CLI: `agy -p= --input-format stream-json --output-format stream-json` reads the prompt as one NDJSON message on STDIN
// ({"event":"user","message":{"content":...}}, checked with agy 1.5.16) and prints NDJSON events: init, step_update (agent_response with text_delta,
// tool with tool_name/tool_info.parameters), result. agy has no Metricool connector: agentFor() always returns Claude for Publish and Sync.
const AGY_SERVER_RE = /^sa-pw-[A-Za-z0-9-]+$/;
export const agyServerName = (runId) => `sa-pw-${String(runId).replace(/[^A-Za-z0-9-]/g, "")}`;
// agy only knows MCP servers from its GLOBAL config (~/.gemini/config/mcp_config.json; --settings has no mcpServers key), so the run's Playwright MCP is
// added under a unique name before the run and removed after it, even on failure (finish, shutdown, and a sweep of leftovers at the next start).
export function agyMcpAddArgs(name, server) {
  const env = Object.entries(server.env || {}).filter(([, v]) => v !== undefined && v !== "").flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  return ["mcp", "add", ...env, name, "--", server.command, ...(server.args || [])];
}
// "NAME TYPE STATUS COMMAND" table of `agy mcp list` -> server names.
export const parseAgyMcpList = (text) => String(text).split(/\r?\n/).slice(1).map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 3 && /^[A-Za-z0-9._-]{1,80}$/.test(p[0])).map((p) => p[0]);
// Session-only settings of agy (--settings): every OTHER configured MCP server (for example the global "playwright" one) is denied by a permission rule,
// so the run can only reach its own Playwright MCP (rule syntax mcp(server/*) checked: it blocks even with --dangerously-skip-permissions).
export const agySettings = (servers = [], own = "") => ({ permissions: { deny: servers.filter((n) => n !== own).map((n) => `mcp(${n}/*)`) } });
export const agyModelLine = (id, effort = "") => `Model in use: ${id ? `${id} (Antigravity ${agyName(id)}; the model you chose, agy does not report the running model)` : "Antigravity default model (none chosen; agy does not report it)"} · effort: ${effort || "default"}`;
// What the prompt must say for agy: its own tool names, and that ONLY the run's Playwright MCP may touch Chrome / Flow / social pages.
export const agyNote = (server = "", browser = false, images = false) => `ANTIGRAVITY NOTE: you run in Antigravity (agy), not Claude Code. Tool names differ: run shell commands (node scripts/...) with run_command, read files with read_file, write files with write_to_file.
${browser ? `BROWSER: the ONLY browser you may use is the Playwright MCP server named "${server}". It is not a direct tool: call it with call_mcp_tool(ServerName="${server}", ToolName=<tool>, Arguments={...}). Wherever this prompt says browser_tabs, browser_navigate, browser_snapshot, browser_click, browser_type, browser_press_key, browser_wait_for, browser_run_code_unsafe, browser_take_screenshot, browser_evaluate, browser_file_upload it means that ToolName of the server "${server}" (read ~/.gemini/antigravity-cli/mcp/${server}/<tool>.json first when unsure about its Arguments).
NEVER use your own built-in browser tools (browser_subagent, open_browser_url, browser_click_element, browser_input, browser_get_dom, execute_browser_javascript, capture_browser_screenshot, read_browser_page, list_browser_pages and the like) and never another MCP server: they do not drive the signed-in Chrome of this run and would break the login and social-page rules of this run. Do not use generate_image either, and call no subagent.
` : "No browser is needed for this run: do not open any browser.\n"}${images ? 'IMAGES: you make the post images yourself with your image-generator subagent: call invoke_subagent with type_name "image-generator" (this is the ONLY subagent you may call) as the prompt describes. Never use browser_*/web tools, Google Flow or any other subagent.\n' : ""}
`;
// Antigravity image quota (the real answer: HTTP 429 + resource exhausted + "exhausted your capacity ... reset after XhYm") -> { reset_at, at: "HH:mm" } ("" when no reset time), else null.
const QUOTA_RE = /\bRESOURCE_EXHAUSTED\b|\bHTTP\/?[\d.]*\s*429\b|\b429\s+Too Many Requests\b/i, QUOTA_DETAIL_RE = /exhausted your capacity|reset(?:s)? after|quota (?:will )?reset|quota exceeded/i; // both kinds of words: "429 ms to generate" or a file that names the error is not a quota stop
const RESET_RE = /reset(?:s)?\s+after\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?/i;
export function agyQuota(text, nowMs = Date.now()) {
  const t = String(text || ""); if (!QUOTA_RE.test(t) || !QUOTA_DETAIL_RE.test(t)) return null;
  const m = RESET_RE.exec(t), sec = m ? (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0) : 0;
  if (!sec) return { reset_at: "", at: "" };
  const d = new Date(nowMs + sec * 1000);
  return { reset_at: d.toISOString(), at: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` };
}
// agy tool call -> the Claude-style (name, input) that friendlyTool() already words in Vietnamese. foreign = not the run's own Playwright MCP / a built-in browser or image tool.
export function agyToolCall(name, p = {}, own = "", subagents = null, allowImages = false) {
  const n = String(name || ""), i = p && typeof p === "object" ? p : {};
  if (n === "call_mcp_tool") return i.ServerName === own ? { name: "mcp__playwright__" + String(i.ToolName || ""), input: i.Arguments || {}, foreign: false } : { name: `MCP server "${String(i.ServerName || "?")}" (${String(i.ToolName || "?")})`, input: {}, foreign: true };
  if (n === "run_command") return { name: "Bash", input: { command: String(i.CommandLine || "") }, foreign: false };
  if (n === "read_file" || n === "view_file") return { name: "Read", input: { file_path: i.Path || i.AbsolutePath || "" }, foreign: false };
  if (["write_to_file", "replace_file_content", "multi_replace_file_content", "sed_file"].includes(n)) return { name: "Write", input: { file_path: i.TargetFile || i.Path || "" }, foreign: false };
  if (["grep_search", "find_by_name", "list_dir"].includes(n)) return { name: "Grep", input: {}, foreign: false };
  if (n === "invoke_subagent" && Array.isArray(subagents) && subagents.length) return allowImages && subagents.every((x) => /^image-generator$/i.test(String(x?.type_name || ""))) ? { name: "agy_image", input: {}, foreign: false } : { name: "subagent:" + subagents.map((x) => x?.type_name || "?").join(","), input: {}, foreign: true }; // a list of image-generator subagents in one turn is allowed, anything else is not
  if (n === "invoke_subagent") { const t = String(i.type_name || i.TypeName || i.SubagentType || i.subagent_type || ""); return !t || (allowImages && t === "image-generator") ? { name: "agy_image", input: {}, foreign: false } : { name: "subagent:" + (t || "?"), input: {}, foreign: true }; } // only the image-generator subagent is allowed
  if (["manage_subagents", "schedule", "wait", "wait_5_seconds"].includes(n)) return { name: "agy_image", input: {}, foreign: false }; // waiting for the image-generator subagent
  if (/browser|generate_image|define_subagent/.test(n)) return { name: n, input: {}, foreign: true };
  return { name: n, input: {}, foreign: false };
}

export function validate({ mode, prompt, model, threads }) {
  if (threads !== undefined && threads !== null && threads !== "" && !(Number.isInteger(Number(threads)) && Number(threads) >= 1 && Number(threads) <= 4)) return "threads must be a whole number from 1 to 4.";
  if (!MODES.includes(mode)) return "mode must be research, create, publish or sync.";
  if (model !== undefined && model !== null && model !== "" && !MODELS.includes(model) && !(typeof model === "string" && /^[A-Za-z0-9._\-\[\]]{1,80}$/.test(model))) return "model must be default, a Claude alias / id or an Antigravity model id."; // a resume sends the key the run stored (a Claude or agy model id)
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

const defaultAgyExec = (file, args, opts = {}) => spawnSync(file, args, { encoding: "utf8", windowsHide: true, timeout: 30000, ...opts });
export function createAgentRunner({ toolRoot, workspace, getSettings = () => ({}), findCli, findAgy = () => ({ found: false, path: "" }), agyExec = defaultAgyExec, plat = osPlatform(), spawnFn = spawn, killTree = (c) => defaultKill(c, plat), npxOk = () => defaultNpx(plat), now = () => Date.now(), graceMs = 4000, onEnd = null, home = homedir(), browserCheck = () => "", loginWindowOpen = () => false }) {
  const runsDir = join(workspace, "runs"), tmpDir = join(workspace, "tmp");
  // Every app window (process) has its OWN run files (agent-run-<instance>.*): a window never reads or overwrites another's live run. agent-run.json is only a mirror
  // of the last write (other tools / tests). When a window starts, it adopts the newest run of a window that is gone (so the last result and Resume survive a restart).
  const instance = randomBytes(3).toString("hex");
  const stateFile = join(runsDir, `agent-run-${instance}.json`), logFile = join(runsDir, `agent-run-${instance}.log`), inputFile = join(runsDir, `agent-run-${instance}-input.json`), legacyState = join(runsDir, "agent-run.json");
  const aliveApp = (pid) => { if (!pid || pid === process.pid) return !!pid; try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
  const stateFilesOfOthers = () => { // [{ file, st, inst }]: every state file in runs/ (instance files + the legacy mirror)
    const out = [];
    try { for (const n of readdirSync(runsDir)) { const m = /^agent-run-([0-9a-f]{6})\.json$/.exec(n) || (n === "agent-run.json" ? [n, ""] : null); if (!m || m[1] === instance) continue; try { out.push({ file: join(runsDir, n), st: JSON.parse(readFileSync(join(runsDir, n), "utf8")), inst: m[1] }); } catch {} } } catch {}
    return out;
  };
  (function adoptPrevious() {
    try {
      mkdirSync(runsDir, { recursive: true });
      const dead = stateFilesOfOthers().filter((x) => !aliveApp(x.st?.app_pid)).sort((a, b) => String(b.st?.updated).localeCompare(String(a.st?.updated)));
      const best = dead[0]; if (!best) return;
      const sib = (suffix) => join(runsDir, best.inst ? `agent-run-${best.inst}${suffix}` : `agent-run${suffix}`);
      copyFileSync(best.file, stateFile);
      for (const [from, to] of [[sib(".log"), logFile], [sib("-input.json"), inputFile], [sib("-friendly.json"), join(runsDir, `agent-run-${instance}-friendly.json`)]]) { try { if (existsSync(from)) copyFileSync(from, to); } catch {} }
      // files of windows that are gone and older than a week
      for (const x of dead.slice(1)) { try { if (x.inst && Date.now() - statSync(x.file).mtimeMs > 7 * 86400000) for (const sfx of [".json", ".log", "-input.json", "-friendly.json"]) rmSync(join(runsDir, `agent-run-${x.inst}${sfx}`), { force: true }); } catch {} }
    } catch {}
  })();
  let cur = null; // the active run
  let last = null; // the finished run's state (this process)

  const friendlyFile = join(runsDir, `agent-run-${instance}-friendly.json`);
  const saveFriendly = (run) => { try { mkdirSync(runsDir, { recursive: true }); writeFileSync(friendlyFile, JSON.stringify(run.friendly)); } catch {} };
  const friendlyView = (list) => (Array.isArray(list) ? list : []).slice(-FRIENDLY_LINES).map((f) => ({ t: f.t || "", text: String(f.text || ""), n: f.n || 1 }));
  const say = (run, text) => {
    const t = sanitize(text, 160); if (!t) return;
    const last = run.friendly.at(-1);
    if (last && last.text === t) { last.n++; last.t = new Date(now()).toISOString(); } else { run.friendly.push({ t: new Date(now()).toISOString(), text: t, n: 1 }); if (run.friendly.length > 200) run.friendly.splice(0, run.friendly.length - 200); }
    saveFriendly(run);
  };
  // A sa-pw-<run id> server belongs to a live run when the state file says that run is still running and its process is alive.
  // Registry of live runs shared by every window of every workspace on this machine (os temp / social-autopilot-live / <run id>.json: app pid, workspace),
  // written when a run adds its MCP server and removed when it ends. The sweep removes a sa-pw-<run id> server ONLY when it is provably dead; when unsure it skips.
  const REG = join(tmpdir(), "social-autopilot-live");
  const registerLive = (run) => { try { mkdirSync(REG, { recursive: true }); writeFileSync(join(REG, `${run.state.run_id}.json`), JSON.stringify({ run_id: run.state.run_id, app_pid: process.pid, child_pid: run.state.pid ?? null, workspace, started: run.state.started })); } catch {} };
  const unregisterLive = (run) => { try { rmSync(join(REG, `${run.state.run_id}.json`), { force: true }); } catch {} };
  const provablyDead = (name) => {
    const runId = name.slice("sa-pw-".length);
    if (cur && cur.state.run_id === runId) return false;
    try { const e = JSON.parse(readFileSync(join(REG, `${runId}.json`), "utf8")); return !aliveApp(e.app_pid) && !aliveApp(e.child_pid); } catch (e) { if (e?.code !== "ENOENT") return false; }
    const mine = stateFilesOfOthers().find((x) => x.st?.run_id === runId);
    if (mine) return !(mine.st.status === "running" && aliveApp(mine.st.app_pid || mine.st.pid));
    // known to nobody (an older version, or another workspace without a registry entry): dead only when its start time (the run id) is over a day old
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})-/.exec(runId);
    return !!m && Date.now() - Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`) > 86400000;
  };
  const ownedByLiveRun = (name) => {
    if (cur && agyServerName(cur.state.run_id) === name) return true;
    // another window's run: its state says running and that window's process is alive
    return stateFilesOfOthers().some(({ st }) => st?.status === "running" && st.run_id && agyServerName(st.run_id) === name && aliveApp(st.app_pid || st.pid));
  };
  const readState = () => { try { return JSON.parse(readFileSync(stateFile, "utf8")); } catch { return null; } };
  const saveState = (st) => { try { mkdirSync(runsDir, { recursive: true }); st.app_pid = process.pid; const txt = JSON.stringify(st, null, 2); writeFileSync(stateFile, txt); try { writeFileSync(legacyState, txt); } catch {} } catch {} };
  const touch = (run, patch = {}) => { Object.assign(run.state, patch, { updated: new Date(now()).toISOString() }); saveState(run.state); };
  const addLine = (run, text) => {
    const line = sanitize(text); if (!line) return;
    run.lines.push(line); if (run.lines.length > LOG_LINES) run.lines.splice(0, run.lines.length - LOG_LINES);
    // Rotating: the file is rewritten from the last 2000 lines every 500 lines.
    try { mkdirSync(runsDir, { recursive: true }); if (++run.written % 500 === 0) writeFileSync(logFile, run.lines.join("\n") + "\n"); else appendFileSync(logFile, line + "\n"); } catch {}
  };
  // Auth / Metricool problems are visible at once (live); login / profile problems only from the final text.
  const scan = (run, text, kinds = run.own ? ["metricool"] : ["auth", "metricool"]) => { if (run.state.problem) return; const p = classifyProblem(text, { mode: run.state.mode, needsBrowser: run.browser, own: run.own, kinds }); if (p) touch(run, { problem: p }); };
  // Antigravity events (see the AGY block above): init, step_update (agent_response / tool), result.
  // A quota answer of the image generator stops the run cleanly (the rest would fail too) and says when it resets.
  const quotaCheck = (run, text) => {
    if (!run.agyImages || run.state.quota || typeof text !== "string" || !text) return;
    const q = agyQuota(text, now()); if (!q) return;
    run.state.quota = q;
    run.guardError = `Antigravity hết hạn mức tạo ảnh${q.at ? ` (hồi lúc ${q.at})` : ""}. Chọn Images: Antigravity (Flow) hoặc Codex rồi chạy tiếp.`;
    addLine(run, "! " + run.guardError); say(run, run.guardError); run.guardSaid = true;
    if (!run.forced && !run.ended) { run.forced = "failed"; run.killed = true; killTree(run.child); setTimeout(() => finish(run, null), graceMs).unref?.(); }
  };
  const handleAgy = (run, ev) => {
    if (ev.event === "init") { if (typeof ev.init?.model === "string" && ev.init.model) handleLine(run, JSON.stringify({ type: "system", subtype: "init", model: ev.init.model })); return; } // agy 1.5.16 sends no model; used when a later version does
    if (ev.event === "step_update" && ev.step_update) {
      const su = ev.step_update, k = su.step_index;
      if (su.step_type === "agent_response") {
        run.agyText[k] = (run.agyText[k] || "") + (typeof su.text_delta === "string" ? su.text_delta : "");
        if (su.state === "DONE") {
          const text = (run.agyText[k] || "").trim(); delete run.agyText[k];
          run.state.turns = (run.state.turns || 0) + 1;
          const u = su.usage; if (u && typeof u === "object") { const t = run.state.usage ||= { input_tokens: 0, output_tokens: 0, total_tokens: 0 }; for (const key of Object.keys(t)) t[key] += Number(u[key]) || 0; }
          if (text) { addLine(run, "A: " + text); say(run, text.replace(/\s+/g, " ")); scan(run, text); const t = sanitize(text); if (t) run.state.last_text = t; run.lastRaw = text; }
          touch(run);
        }
      } else if ((su.step_type === "tool" || su.step_type === "subagent") && su.tool_name) {
        // Every event of the step is judged again: subagent_info / parameters can appear after the first event.
        const first = !run.agyTools.has(k); run.agyTools.add(k);
        const c = agyToolCall(su.tool_name, su.tool_info?.parameters, run.mcpName, su.subagent_info?.subagents, run.agyImages);
        if (su.tool_name === "invoke_subagent" && su.state === "DONE" && !(su.subagent_info?.subagents || []).length && !(su.tool_info?.parameters?.type_name) && !run.agyWarned?.has(k)) { (run.agyWarned ||= new Set()).add(k); addLine(run, "! subagent step ended without type info (could not check it)"); }
        if (su.state === "DONE" && su.tool_name === "invoke_subagent") quotaCheck(run, su.tool_info?.output); // the subagent's answer only: never the output of reading a file or running a command
        if (first) addLine(run, "tool: " + c.name);
        if (c.foreign) { // a built-in browser/web tool, a subagent other than image-generator, or an MCP server other than this run's own: the run is stopped
          run.guardError = `Antigravity used ${c.name}, which this run does not allow: stopped.`;
          addLine(run, "! " + run.guardError); say(run, "Dừng: agent gọi công cụ không được phép"); run.guardSaid = true;
          if (!run.forced) { run.forced = "failed"; run.killed = true; killTree(run.child); setTimeout(() => finish(run, null), graceMs).unref?.(); }
        } else if (first) say(run, friendlyTool(c.name, c.input));
        if (first) touch(run);
      }
    } else if (ev.event === "result" && ev.result) {
      const r = ev.result, ok = r.status === "SUCCESS";
      run.result = { is_error: !ok, subtype: String(r.status || "").toLowerCase(), error: ok ? "" : sanitize(r.error || "") };
      if (typeof r.num_turns === "number" && r.num_turns > 0) run.state.turns = r.num_turns;
      if (typeof r.response === "string" && r.response.trim()) { run.state.last_text = sanitize(r.response); run.state.report = sanitizeReport(r.response); if (!ok) scan(run, r.response); }
      if (!ok && r.error) scan(run, String(r.error));
      quotaCheck(run, String(r.error || "")); if (!ok) quotaCheck(run, String(r.response || ""));
      addLine(run, `result: ${run.result.subtype}${ok ? "" : " (error)"}`);
      touch(run);
    }
  };
  const handleLine = (run, raw) => {
    let ev; try { ev = JSON.parse(raw); } catch { addLine(run, raw); return; }
    if (run.killed) return; // the run was stopped by the guard / quota stop: later events of the dying process are ignored
    if (run.backend === "antigravity" && typeof ev.event === "string") return handleAgy(run, ev);
    if (ev.type === "system" && ev.subtype === "init" && typeof ev.model === "string" && ev.model) {
      const id = sanitize(ev.model, 80), line = run.backend === "antigravity" ? agyModelLine(id, run.effort).replace("the model you chose, agy does not report the running model", "reported by agy") : modelLine(id, run.effort), ok = modelMatches(run.settingModel, id), t = new Date(now()).toISOString();
      run.state.model_in_use = id;
      if (run.lines[0]?.startsWith("Model in use:")) run.lines[0] = line; else run.lines.unshift(line);
      if (!ok) run.lines.splice(1, 0, modelWarning(run.settingModel, id));
      try { writeFileSync(logFile, run.lines.join("\n") + "\n"); } catch {}
      if (run.friendly[0]?.text?.startsWith("Model in use:")) run.friendly[0].text = line; else run.friendly.unshift({ t, text: line, n: 1 });
      if (!ok) run.friendly.splice(1, 0, { t, text: modelWarning(run.settingModel, id), n: 1 });
      saveFriendly(run); touch(run);
    } else if (ev.type === "assistant" && Array.isArray(ev.message?.content)) {
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
  // Removes what a run left outside the tool: its temp config and, for agy, the Playwright MCP server added to agy's global config.
  const cleanupRun = (run) => {
    try { rmSync(run.cfg, { force: true }); } catch {}
    // This run's own leftovers only (its run id is in every name): temp folder with the settings snapshot, Codex slots, Flow reference copies in Downloads (sa-ref-<run id>-*).
    if (run.state?.run_id && !run.tmpGone) { run.tmpGone = true; unregisterLive(run); for (const d of [join(tmpDir, `run-${run.state.run_id}`), join(tmpDir, "codex-slots", run.state.run_id)]) { try { rmSync(d, { recursive: true, force: true }); } catch {} } try { const dl = join(home, "Downloads"), pre = `sa-ref-${run.state.run_id}-`; for (const n of readdirSync(dl)) if (n.startsWith(pre)) rmSync(join(dl, n), { force: true }); } catch {} }
    if (run.mcpName && !run.mcpGone) { run.mcpGone = true; try { agyExec(run.agyPath, ["mcp", "remove", run.mcpName]); } catch {} }
  };
  const finish = (run, code, err) => {
    if (run.ended) return; run.ended = true;
    clearTimeout(run.timer);
    if (run.buf.trim()) handleLine(run, run.buf.trim());
    cleanupRun(run);
    const status = run.forced || (code === 0 && !run.result?.is_error ? "done" : "failed");
    // Last look for an actionable cause: the exit text, stderr, the final text (login / profile problems only count here).
    if (status !== "stopped") {
      const text = [err, ...run.stderr, run.state.last_text].filter(Boolean).join(" | ");
      const p = run.state.problem || classifyProblem(text, { mode: run.state.mode, needsBrowser: run.browser, own: run.own, kinds: run.own ? (status === "failed" ? ["login", "profile", "auth", "metricool"] : ["login", "profile"]) : status === "failed" ? ["auth", "metricool"] : [] });
      if (p) run.state.problem = p;
    }
    if (!run.state.report && run.lastRaw) run.state.report = sanitizeReport(run.lastRaw);
    const problem = run.state.problem;
    const error = status === "failed" ? (problem ? problem.message : sanitize(run.guardError || err || run.stderr.at(-1) || (run.result?.is_error ? `${run.label} reported ${run.result.error || run.result.subtype || "an error"}.` : `${run.label} exited with code ${code}.`)))
      : status === "timeout" ? `Stopped after the ${run.limitMin}-minute limit.${problem ? " " + problem.message : ""}` : status === "done" && problem ? problem.message : "";
    if (!(status === "failed" && run.guardSaid)) say(run, status === "failed" ? `Lỗi: ${error}` : status === "stopped" ? "Bị dừng" : status === "timeout" ? "Hết thời gian" : problem ? `Hoàn tất, nhưng cần xem: ${problem.message}` : "Hoàn tất");
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

  function start({ mode, prompt, brands, imageEngine, model, threads, resume = false } = {}) {
    let prefix = "", from = "", resumedPipe = "";
    if (resume) {
      if (cur) return { ok: false, status: 409, error: `A ${cur.state.mode} run is already active (started ${cur.state.started}). Only one run at a time: wait for it or press Stop.` };
      const ri = resumeInfo();
      if (!ri.available) return { ok: false, status: 409, error: "There is no stopped run to continue." };
      const inp = readInput();
      ({ mode, prompt, brands, model } = inp); imageEngine = inp.image_engine || ""; threads = inp.threads;
      prefix = continueLine(mode, ri); from = ri.run_id; resumedPipe = inp.pipe_id || ri.run_id;
    }
    const bad = validate({ mode, prompt, model, threads });
    if (bad) return { ok: false, status: 400, error: bad };
    if (cur) return { ok: false, status: 409, error: `A ${cur.state.mode} run is already active (started ${cur.state.started}). Only one run at a time: wait for it or press Stop.` };
    const s = getSettings() || {};
    const backend = agentFor(s, mode), agy = backend === "antigravity", label = agy ? "Antigravity" : "Claude"; // one agent per task (Run tab Agent); publish and sync are always Claude
    if (mode === "create" && runEngine(s, imageEngine) === "antigravity" && !agy) return { ok: false, status: 400, error: "Tạo ảnh = Antigravity cần agent Tạo bài = Antigravity (Run tab: Agent and Images)." };

    const found = agy ? findAgy() : findCli();
    if (!found?.found) return { ok: false, status: 400, error: agy ? "Antigravity CLI (agy) not found: install it or add it to PATH." : "Claude CLI not found: set claudeCli.command in workspace/settings.json." };
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
    const nThreads = usesFlow(mode, s, imageEngine) || (agy && mode === "research") ? 1 : threadsFor(mode, threads); // Create and Research (classification) only; Flow runs, Publish and Sync always 1
    const runId = `${new Date(now()).toISOString().replace(/\D/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;
    const pipeId = resumedPipe || runId; // the pipeline folder of this run (a resumed run keeps the one of the run it continues)
    mkdirSync(tmpDir, { recursive: true }); mkdirSync(runsDir, { recursive: true });
    const cfg = join(tmpDir, `mcp-${runId}.json`);
    // The Playwright MCP is only configured for runs that need the browser: Publish and Create with Codex never start it.
    const mcp = browser ? mcpConfig({ plat, profile, own: own ? { userDataDir: bs.profileDir, headless: bs.headless, outputDir: join(tmpDir, "playwright-output") } : null, background: !flow, snapshot: mode === "research" ? "none" : "" }) : null;
    const extTok = browser && !own && profile ? extensionToken(workspace, profile) : "";
    const choice = agy ? agyChoice(s) : claudeChoice(s, model), modelKey = agy ? choice.id || "default" : choice.key;
    let mcpName = "";
    if (agy) {
      // agy: the run's Playwright MCP goes into agy's global config under a unique name (removed in cleanupRun); every other configured server is denied for this run.
      const ex = (a) => agyExec(found.path, a), listed = ex(["mcp", "list"]);
      if (listed?.error || listed?.status !== 0) return { ok: false, status: 500, error: sanitize(`Could not read the MCP servers of Antigravity: ${listed?.error?.message || listed?.stderr || listed?.status}`) };
      const names = parseAgyMcpList(listed.stdout);
      for (const n of names.filter((n) => AGY_SERVER_RE.test(n) && provablyDead(n))) ex(["mcp", "remove", n]); // leftovers of provably dead runs only; a live run (any window, any workspace) or an unsure case is left alone
      if (browser) {
        mcpName = agyServerName(runId);
        const srv = mcp.mcpServers.playwright, added = ex(agyMcpAddArgs(mcpName, { ...srv, env: {} })); // no -e: PLAYWRIGHT_MCP_EXTENSION_TOKEN / PROFILE_DIR_NAME reach the server through the environment of the agy process (checked: an MCP server inherits it), so no token sits in argv or in agy's mcp_config.json
        if (added?.error || added?.status !== 0) { try { ex(["mcp", "remove", mcpName]); } catch {} return { ok: false, status: 500, error: sanitize(`Could not add the Playwright MCP to Antigravity: ${added?.error?.message || added?.stderr || added?.stdout || added?.status}`) }; }
      }
      try { writeFileSync(cfg, JSON.stringify(agySettings(names.filter((n) => !AGY_SERVER_RE.test(n)), mcpName))); }
      catch (e) { if (mcpName) { try { ex(["mcp", "remove", mcpName]); } catch {} } return { ok: false, status: 500, error: sanitize(e.message) }; }
    } else if (browser) writeFileSync(cfg, JSON.stringify(mcp));
    const args = agy ? ["--input-format", "stream-json", "--output-format", "stream-json", "-p=", "--dangerously-skip-permissions", "--settings", cfg, ...(choice.id ? ["--model", choice.id] : []), ...(choice.effort ? ["--effort", choice.effort] : []), ...(limitMin > 0 ? ["--print-timeout", `${limitMin}m`] : []), ...addDirs({ toolRoot, settings: s, flow, home }).flatMap((d) => ["--add-dir", d])] : ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "default", ...(maxTurns > 0 ? ["--max-turns", String(maxTurns)] : []), "--allowedTools", allowedTools(mode, s, imageEngine, nThreads).join(","), "--add-dir", ...addDirs({ toolRoot, settings: s, flow, home })];
    if (!agy) {
      args.push("--model", choice.id);
      if (choice.effort) args.push("--effort", choice.effort);
      if (browser) args.push("--mcp-config", cfg);
      if (mode === "research") args.push("--strict-mcp-config");
    }
    const snapDir = join(tmpDir, `run-${runId}`); try { mkdirSync(snapDir, { recursive: true }); writeFileSync(join(snapDir, "settings.json"), JSON.stringify(s)); } catch {}
    const env = { ...process.env, SA_RUN_ID: runId, SA_PIPE_ID: pipeId, SA_SETTINGS: join(snapDir, "settings.json"), ...(agy ? { SA_AGENT: "antigravity" } : {}), ...(nThreads > 1 ? { SA_THREADS: String(nThreads) } : {}), ...(profile && !own ? { PLAYWRIGHT_MCP_PROFILE_DIR_NAME: profile } : {}), ...(extTok ? { PLAYWRIGHT_MCP_EXTENSION_TOKEN: extTok } : {}) };
    const cmd = plat === "win32" && /\.(cmd|bat)$/i.test(found.path) ? ["cmd", ["/c", found.path, ...args]] : [found.path, args];
    let child;
    try { child = spawnFn(cmd[0], cmd[1], { cwd: toolRoot, env, windowsHide: true, detached: false, stdio: ["pipe", "pipe", "pipe"] }); }
    catch (e) { cleanupRun({ cfg, mcpName, agyPath: found.path }); return { ok: false, status: 500, error: sanitize(e.message) }; }
    const started = new Date(now()).toISOString();
    const run = {
      child, cfg, backend, label, mcpName, agyImages: usesAgyImages(mode, s, imageEngine), mcpGone: false, agyPath: found.path, agyText: {}, agyTools: new Set(), settingModel: choice.id, effort: choice.effort, lines: [], buf: "", written: 0, stderr: [], limitMin, browser, own, ended: false, forced: "", result: null, timer: null,
      state: { run_id: runId, mode, pid: child.pid ?? null, started, updated: started, status: "running", backend, threads: nThreads, pipe_id: pipeId, exit_code: null, last_text: "", report: "", turns: 0, error: "", problem: null, flow, model: modelKey, limit_min: limitMin, max_turns: maxTurns, brands: Array.isArray(brands) ? brands.filter((b) => typeof b === "string").slice(0, 50) : [], ...(from ? { resumed_from: from } : {}) },
    };
    // The inputs of this run, for a later "continue" (the original prompt, without the continue line).
    try { writeFileSync(inputFile, JSON.stringify({ run_id: runId, mode, prompt, brands: run.state.brands, model: modelKey, image_engine: ["codex", "flow", "antigravity"].includes(imageEngine) ? imageEngine : "", threads: nThreads, pipe_id: pipeId })); } catch {}
    cur = run;
    if (mcpName) registerLive(run);
    try { writeFileSync(logFile, ""); } catch {}
    run.friendly = [];
    { const ml = agy ? agyModelLine(choice.id, choice.effort) : modelLine(choice.id, choice.effort); addLine(run, ml); say(run, ml); }
    say(run, `Bắt đầu chạy: ${MODE_VI[mode] || mode}`);
    addLine(run, `start: ${mode} run ${runId}`);
    saveState(run.state);
    child.stdout?.on("data", (c) => feed(run, c));
    child.stderr?.on("data", (c) => { run.stderrAll = ((run.stderrAll || "") + "\n" + c.toString("utf8")).slice(-4000); quotaCheck(run, run.stderrAll); // the whole chunk: the reset time is on a later line than the error
      for (const l of c.toString("utf8").split(/\r?\n/)) { const t = sanitize(l); if (t) { run.stderr.push(t); if (run.stderr.length > 20) run.stderr.shift(); addLine(run, "! " + t); } } });
    child.on("error", (e) => finish(run, null, e.message));
    child.on("close", (code) => finish(run, code));
    child.stdin?.on("error", () => {});
    // This text is prepended to the same prompt Copy prompt gives; Copy prompt is not changed.
    const note = own ? ownNote(bs.headless) : browser ? (flow ? flowExtensionNote : extensionNote) : "";
    // agy reads the prompt as ONE NDJSON user message on stdin (never argv: no length limit, nothing in the process list).
    const text = note + threadsNote(mode, nThreads, { agy, engine: runEngine(s, imageEngine) }) + (agy ? agyNote(mcpName, browser, usesAgyImages(mode, s, imageEngine)) : "") + prefix + prompt;
    try { child.stdin?.end(agy ? JSON.stringify({ event: "user", message: { content: text } }) + String.fromCharCode(10) : text); } catch {}
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
    cleanupRun(cur);
    touch(cur, { status: "stopped" });
  }

  function status() {
    const run = cur, st = run ? run.state : last || readState();
    const cli = findCli(), agyCli = findAgy();
    // A state file left "running" by an app that closed is not an active run.
    const shown = st && !run && st.status === "running" ? { ...st, status: "failed", error: "The app closed while this run was active." } : st;
    const lines = run ? run.lines : (() => { try { return readFileSync(logFile, "utf8").split("\n").filter(Boolean); } catch { return []; } })();
    return {
      active: !!run, status: shown?.status || "idle", mode: shown?.mode || "", started: shown?.started || "",
      elapsed_s: shown?.started ? Math.max(0, Math.round(((run ? now() : Date.parse(shown.updated) || now()) - Date.parse(shown.started)) / 1000)) : 0,
      backend: shown?.backend || "claude", pipe_id: shown?.pipe_id || "", quota: shown?.quota || null, threads: shown?.threads || 1, usage: shown?.usage || null, last_text: shown?.last_text || "", report: typeof shown?.report === "string" ? shown.report : "", turns: shown?.turns || 0, error: shown?.error || "", problem: shown?.problem || null, flow: !!shown?.flow, model: validClaudeModel(shown?.model) ? shown.model : "default", model_in_use: shown?.model_in_use || "", limit_min: shown?.limit_min || 0, max_turns: shown?.max_turns || 0, brands: shown?.brands || [], resumed_from: shown?.resumed_from || "",
      resume: resumeInfo(),
      tail: lines.slice(-TAIL_LINES),
      friendly: run ? friendlyView(run.friendly) : friendlyView((() => { try { return JSON.parse(readFileSync(friendlyFile, "utf8")); } catch { return []; } })()),
      cli: { found: !!cli?.found, path: cli?.path || "" }, agy: { found: !!agyCli?.found },
    };
  }
  return { start, stop, status, shutdown, isActive: () => !!cur, browserActive: () => !!cur?.browser && !!cur?.own };
}
