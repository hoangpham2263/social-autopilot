// Turns the text a headless Claude run leaves behind (stream-json assistant/result text, stderr, exit text) into ONE actionable
// problem, or null. Pure: no I/O. Kinds: auth (Claude Code not logged in), metricool (connector missing / sign in again),
// browser (Playwright extension not connected). Messages are shown in the live panel and as a toast.
export const MESSAGES = {
  auth: "Claude Code is not logged in: run `claude` once in a terminal and log in, then retry.",
  metricool: "The Metricool connector is missing or needs you to sign in again: open claude.ai > Settings > Connectors, connect Metricool (sign in again), then retry.",
  browser: "The Playwright extension did not connect: in the chosen Chrome profile open the Welcome page the run opened (or Run tab > Chrome > Open) and click Connect, then retry.",
};
const RX = {
  auth: /not logged in|authentication[_ ]failed|please run \/login|login required|invalid (?:x-)?api[ _-]?key|oauth token (?:has )?expired|\b401\b.{0,40}(?:unauthorized|authenticat)/i,
  metricool: /metricool[\s\S]{0,160}(?:sign in again|needs you to sign in|not connected|not available|unauthori[sz]ed|authenticat|no such tool|tool not found)|(?:sign in again|needs you to sign in)[\s\S]{0,160}metricool/i,
  browser: /(?:playwright|browser|chrome|extension)[^\n.]{0,80}(?:not connected|did not connect|didn't connect|could not connect|never connected|connection (?:timed out|failed|refused))|no (?:chrome )?tab (?:is )?connected|extension (?:is )?not connected/i,
};
// kinds: which kinds to look for (live scanning uses auth + metricool only: an agent saying "browser not connected yet, waiting" is normal).
export function classifyProblem(text, { mode = "", needsBrowser = false, kinds = ["auth", "metricool", "browser"] } = {}) {
  const t = String(text ?? "");
  if (!t) return null;
  for (const kind of kinds) {
    if (kind === "metricool" && mode !== "publish" && mode !== "create") continue;
    if (kind === "browser" && !needsBrowser) continue;
    if (RX[kind].test(t)) return { kind, message: MESSAGES[kind] };
  }
  return null;
}
