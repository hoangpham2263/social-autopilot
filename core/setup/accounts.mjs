// Settings, Accounts and Requirements: which accounts are signed in and which tools are installed. Read-only, async.
// Only names are read: the Codex account from the id_token CLAIMS in ~/.codex/auth.json (email, name, plan; the token
// itself is never returned, logged or stored), GitHub from `gh auth status` (login only). Metricool goes through the
// agent's Claude/ChatGPT connector, so only the configured account id and brands are shown.
import { exec, execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { findTool, onWindows, toolEnv } from "../platform.mjs";

const run = (cmd, args, timeout = 15000) => new Promise((done) => {
  if (!cmd) return done({ ok: false, text: "" });
  // A .cmd shim (npm on Windows) runs through the shell; the arguments here are fixed words, never user input.
  const cb = (err, stdout, stderr) => done({ ok: !err, text: `${stdout || ""}\n${stderr || ""}`.replace(/\x1b\[[0-9;]*m/g, "").trim() });
  if (onWindows && /\.(cmd|bat)$/i.test(cmd)) exec(`"${cmd}" ${args.join(" ")}`, { env: toolEnv, timeout, windowsHide: true }, cb);
  else execFile(cmd, args, { env: toolEnv, timeout, windowsHide: true }, cb);
});

// The claims of the Codex sign-in: email, name, ChatGPT plan. Nothing else leaves this function.
export function codexIdentity(file = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "auth.json")) {
  try {
    const auth = JSON.parse(readFileSync(file, "utf8"));
    const claims = JSON.parse(Buffer.from(String(auth.tokens?.id_token || "").split(".")[1] || "", "base64url").toString("utf8") || "{}");
    const plan = claims["https://api.openai.com/auth"]?.chatgpt_plan_type || "";
    return { email: typeof claims.email === "string" ? claims.email : "", name: typeof claims.name === "string" ? claims.name : "", plan: typeof plan === "string" ? plan : "", mode: typeof auth.auth_mode === "string" ? auth.auth_mode : "" };
  } catch { return { email: "", name: "", plan: "", mode: "" }; }
}

export const ghLogin = (text) => String(text).match(/Logged in to (\S+) account (\S+)/)?.slice(1, 3) || null;

export async function accounts({ metricool = {} } = {}) {
  const codex = findTool("codex"), gh = findTool("gh");
  const [codexVersion, codexStatus, ghStatus] = await Promise.all([run(codex, ["--version"]), run(codex, ["login", "status"]), run(gh, ["auth", "status"])]);
  const signedIn = codexStatus.ok && /logged in/i.test(codexStatus.text);
  const who = signedIn ? codexIdentity() : { email: "", name: "", plan: "", mode: "" };
  const gl = ghStatus.text ? ghLogin(ghStatus.text) : null;
  return {
    codex: { installed: !!codex, signed_in: signedIn, email: who.email, name: who.name, plan: who.plan },
    github: { installed: !!gh, signed_in: !!gl, host: gl?.[0] || "", login: gl?.[1] || "" },
    metricool: { user_id: String(metricool.account?.user_id || ""), brands: (metricool.brands || []).map((b) => b.name) },
    requirements: [
      { id: "node", name: "Node.js", ok: true, version: process.version.replace(/^v/, "") },
      { id: "codex", name: "Codex CLI", ok: !!codex, version: codex ? (codexVersion.text.match(/\d+\.\d+\.\d+\S*/)?.[0] || "") : "", action: codex ? "" : "install" },
    ],
  };
}
