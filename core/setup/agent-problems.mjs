// Turns the text a headless Claude run leaves behind (stream-json assistant/result text, stderr, exit text) into ONE actionable
// problem, or null. Pure: no I/O. Kinds: auth (Claude Code not logged in), metricool (connector missing / sign in again),
// login / profile (own browser: login wall, profile in use). Messages are shown in the live panel and as a toast.
export const MESSAGES = {
  auth: "Claude Code is not logged in: run `claude` once in a terminal and log in, then retry.",
  metricool: "The Metricool connector is missing or needs you to sign in again: open claude.ai > Settings > Connectors, connect Metricool (sign in again), then retry.",
  login: "Log in again: Run tab > Browser > Open browser to log in (a site showed a login wall or checkpoint in the own browser).",
  profile: "The own browser profile is missing or in use: Run tab > Browser > Open browser to log in (log in, then close that window), make sure no other browser or login window uses it, then retry.",
};
const RX = {
  // The agent's final text reports a login wall / checkpoint (never a bare "login required": that is Claude Code's own auth).
  login: /login wall|log(?:ged)?[ -]?in (?:again|first|is required|wall)|(?:need|needs|requires?|required to) (?:to )?(?:log|sign)[ -]?in|(?:logged|signed) out|sign[- ]in wall|checkpoint|security check|captcha|not logged in to (?:facebook|instagram|pinterest|etsy|houzz|google|flow)/i,
  profile: /user data directory is already in use|profile (?:is )?(?:locked|in use|missing)|singletonlock|processsingleton|browser is already running for/i,
  auth: /not logged in|authentication[_ ]failed|please run \/login|login required|invalid (?:x-)?api[ _-]?key|oauth token (?:has )?expired|\b401\b.{0,40}(?:unauthorized|authenticat)/i,
  metricool: /metricool[\s\S]{0,160}(?:sign in again|needs you to sign in|not connected|not available|unauthori[sz]ed|authenticat|no such tool|tool not found)|(?:sign in again|needs you to sign in)[\s\S]{0,160}metricool/i,
};
// kinds: which kinds to look for (live scanning uses auth + metricool only).
export function classifyProblem(text, { mode = "", needsBrowser = false, own = false, kinds = ["auth", "metricool"] } = {}) {
  const t = String(text ?? "");
  if (!t) return null;
  for (const kind of kinds) {
    if (kind === "metricool" && mode !== "publish" && mode !== "create") continue;
    if ((kind === "login" || kind === "profile") && !(needsBrowser && own)) continue;
    if (RX[kind].test(t)) return { kind, message: MESSAGES[kind] };
  }
  return null;
}
