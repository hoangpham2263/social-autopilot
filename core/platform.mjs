// What the Node server (src/server.mjs) does differently on macOS and Windows: the
// same pages and servers run on both; on Windows the window is core/launch.ps1's WebView2 app window.
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { homedir } from "node:os";
import { appProfile, executable as toolsChrome } from "./browser.mjs";

export const onWindows = process.platform === "win32";

// Node, npm and codex: Homebrew or the npm prefix on macOS (Finder-launched apps miss them in PATH), the Node
// installer's folder and %APPDATA%\npm on Windows.
const extraPath = onWindows
  ? [join(process.env.ProgramFiles || "C:\\Program Files", "nodejs"), join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "npm")]
  : ["/opt/homebrew/bin", "/usr/local/bin", join(homedir(), ".npm-global", "bin"), join(homedir(), ".dotnet", "tools")];
export const toolEnv = { ...process.env, PATH: [...new Set([...(process.env.PATH || "").split(delimiter), ...extraPath, dirname(process.execPath)])].filter(Boolean).join(delimiter) };
export const findTool = (name, env = toolEnv) => String(env.PATH || env.Path || "").split(delimiter).filter(Boolean)
  .flatMap((d) => (onWindows ? [".cmd", ".exe", ""] : [""]).map((ext) => join(d, name + ext))).find((p) => existsSync(p));
// npm and codex are .cmd files on Windows, which Node only starts through the shell. Never a console window.
export function runTool(cmd, args, options, done) {
  if (onWindows && /\.cmd$/i.test(cmd)) return execFile(`"${cmd}"`, args, { ...options, shell: true, windowsHide: true }, done);
  return execFile(cmd, args, { ...options, windowsHide: true }, done);
}

// Windows PowerShell 5.1 is on every Windows; pwsh 7 on macOS.
export const PWSH = process.env.PR_PWSH || (onWindows ? "powershell.exe"
  : [...(process.env.PATH || "").split(delimiter).map((d) => join(d, "pwsh")), "/opt/homebrew/bin/pwsh", "/usr/local/bin/pwsh",
    join(homedir(), ".dotnet", "tools", "pwsh"), "/usr/local/microsoft/powershell/7/pwsh"].find((p) => existsSync(p)) || "pwsh");
// Arguments for a PowerShell command, and for a script with its parameters ("-Name", value, …). On Windows both run
// past the execution policy, never prompt or show a window (callers also pass windowsHide: true) and talk UTF-8 on
// stdin/stdout (5.1 uses the console code page otherwise).
const utf8 = "[Console]::InputEncoding=[Console]::OutputEncoding=New-Object Text.UTF8Encoding $false; ";
const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;
export const psCommand = (command) => (onWindows ? ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-Command", utf8 + command] : ["-NoProfile", "-Command", command]);
export const psFile = (file, args = []) => (onWindows
  ? psCommand(`& ${quote(file)} ${args.map((a) => (/^-[A-Za-z]+$/.test(a) ? a : quote(a))).join(" ")}; exit $LASTEXITCODE`)
  : ["-NoProfile", "-File", file, ...args]);

// Stop a process and everything it started (a Codex sign-in and its children). On macOS the process
// was started detached, so it leads its own group.
export function killTree(proc) {
  if (onWindows) return execFile("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { windowsHide: true }, () => {});
  try { process.kill(-proc.pid, "SIGKILL"); } catch { try { proc.kill("SIGKILL"); } catch {} }
}

// The user's own Chrome, where ChatGPT is signed in: started, or a page opened in it. background: Chrome is not brought
// to the front.
export function openChrome(url = "", { background = false } = {}) {
  return new Promise((resolve) => {
    const done = (err) => resolve(err ? "Không mở được Google Chrome. Cài Google Chrome rồi thử lại." : "");
    if (onWindows) return execFile("cmd", ["/c", "start", "", "chrome", ...(url ? [url] : [])], { windowsHide: true }, done);
    execFile("open", [...(background ? ["-g"] : []), "-a", "Google Chrome", ...(url ? [url] : [])], { windowsHide: true }, done);
  });
}

// A window of its own on macOS: Chrome for Testing (core/browser.mjs) in app mode (no tabs or address bar); before
// it is downloaded, the user's Chrome, else the default browser. On Windows the app window (core/launch.ps1) shows the
// pages, so nothing opens here.
export function appWindow(url, size = "1120,840") {
  if (onWindows) return;
  const args = [`--app=${url}`, `--window-size=${size}`];
  if (existsSync(toolsChrome)) {
    return spawn(toolsChrome, [`--user-data-dir=${appProfile}`, "--no-first-run", "--no-default-browser-check", "--disable-infobars", ...args], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  }
  execFile("open", ["-na", "Google Chrome", "--args", ...args], { windowsHide: true }, (err) => { if (err) execFile("open", [url], { windowsHide: true }, () => {}); });
}
