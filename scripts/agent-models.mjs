// Models and effort levels the tool offers for Claude Code and Codex (Settings > Claude / Codex). Pure data and helpers, no side effects.
// Claude ids were checked with `claude --model <id>` (CLI 2.1.323). Not offered: claude-opus-4-1, claude-opus-4-0, claude-sonnet-4-0, claude-haiku-3-5 (the CLI remaps or rejects them).
export const CLAUDE_DEFAULT = "claude-sonnet-4-6";
export const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
export const CLAUDE_OTHER_RE = /^[A-Za-z0-9._\-\[\]]{1,60}$/;
const fam = (family, versions) => versions.map(([id, v]) => ({ id, family, name: `${family} ${v}` }));
// Aliases pick the latest of the family.
export const CLAUDE_GROUPS = [
  { family: "Aliases", note: "Latest of each family", models: ["haiku", "sonnet", "opus", "fable"].map((id) => ({ id, family: "Alias", name: `${id[0].toUpperCase()}${id.slice(1)} (latest)` })) },
  { family: "Fable", note: "Most capable, for the hardest and longest tasks", models: fam("Fable", [["claude-fable-5-2", "5.2"], ["claude-fable-5-1", "5.1"], ["claude-fable-5", "5"]]) },
  { family: "Opus", note: "Best for everyday complex tasks", models: fam("Opus", [["claude-opus-5-5", "5.5"], ["claude-opus-5", "5"], ["claude-opus-4-8", "4.8"], ["claude-opus-4-7", "4.7"], ["claude-opus-4-6", "4.6"], ["claude-opus-4-5", "4.5"]]) },
  { family: "Sonnet", note: "Efficient for routine tasks", models: fam("Sonnet", [["claude-sonnet-5-5", "5.5"], ["claude-sonnet-5", "5"], ["claude-sonnet-4-6", "4.6"], ["claude-sonnet-4-5", "4.5"]]) },
  { family: "Haiku", note: "Efficient for routine tasks, cheapest", models: fam("Haiku", [["claude-haiku-5-5", "5.5"], ["claude-haiku-4-5", "4.5"]]) },
];
export const CLAUDE_MODELS = CLAUDE_GROUPS.flatMap((g) => g.models);
// Friendly name of a stored value: a known model, or the typed id as is.
export const claudeName = (id) => { const m = CLAUDE_MODELS.find((x) => x.id === id); return m ? { name: m.name, id: m.id } : { name: "Custom", id }; };
export const validClaudeModel = (v) => typeof v === "string" && (CLAUDE_MODELS.some((m) => m.id === v) || CLAUDE_OTHER_RE.test(v));

// Codex: `codex debug models` is the live list; this is the cached fallback (taken 2026-11-23) for when the CLI is missing.
const E = ["low", "medium", "high", "xhigh", "max"], EU = [...E, "ultra"];
const cm = (slug, name, def, efforts, hidden = false) => ({ slug, name, hidden, default_effort: def, efforts });
export const CODEX_FALLBACK = [
  cm("gpt-6.2-sol", "GPT-6.2-Sol", "medium", EU), cm("gpt-6.2-astra", "GPT-6.2-Astra", "low", EU), cm("gpt-6.1-terra", "GPT-6.1 Terra", "low", EU),
  cm("gpt-reserve", "GPT-Reserve", "medium", E, true), cm("gpt-6.1-sol", "GPT-6.1-Sol", "medium", EU), cm("gpt-6-astra", "GPT-6-Astra", "low", EU),
  cm("gpt-6-sol", "GPT-6-Sol", "medium", EU), cm("gpt-6-luna", "GPT-6-Luna", "medium", E), cm("gpt-5.6-sol", "GPT-5.6-Sol", "medium", EU),
  cm("gpt-5.6-terra", "GPT-5.6-Terra", "medium", EU), cm("gpt-5.6-luna", "GPT-5.6-Luna", "medium", E), cm("codex-auto-review", "Codex Auto Review", "medium", E, true),
];
// Parse the JSON printed by `codex debug models`; null when it is not that shape.
export function parseCodexModels(text) {
  try {
    const t = String(text), j = JSON.parse(t.slice(t.indexOf("{")));
    const out = (j.models || []).filter((m) => typeof m?.slug === "string").map((m) => ({
      slug: m.slug, name: m.display_name || m.slug, hidden: m.visibility === "hide", default_effort: m.default_reasoning_level || "",
      efforts: (m.supported_reasoning_levels || []).map((x) => x.effort).filter(Boolean),
    }));
    return out.length ? out : null;
  } catch { return null; }
}
export const validCodexValue = (v) => v === "" || (typeof v === "string" && /^[A-Za-z0-9._\-]{1,60}$/.test(v));
// Extra `codex exec` arguments from Settings (agent.codex_model, agent.codex_effort); only what is set.
// The effort goes unquoted (Codex reads an unparsable -c value as a plain string), so it survives the Windows .cmd shell quoting.
export const codexModelArgs = (settings = {}) => {
  const a = settings?.agent || {}, out = [];
  if (a.codex_model && validCodexValue(a.codex_model)) out.push("-m", a.codex_model);
  if (a.codex_effort && validCodexValue(a.codex_effort)) out.push("-c", `model_reasoning_effort=${a.codex_effort}`);
  return out;
};

// Antigravity (`agy`, Google): `agy models` is the live list (tab separated "<id>\t<name>"); this is the cached fallback (taken 2026-11-25, agy 1.5.16)
// for when the CLI is missing or not signed in. The effort level of some models is part of the id (-high, -low); --effort is a separate flag.
// agy rejects "max" on its default model ("gemini-4-neon has no max effort"): never offered, a stored max counts as unset.
export const AGY_EFFORTS = ["low", "medium", "high", "xhigh"];
const am = (id, name) => ({ id, name });
export const AGY_FALLBACK = [
  am("gemini-4-neon-high", "Gemini 4 Neon (High)"), am("gemini-4-neon-xhigh", "Gemini 4 Neon (XHigh)"), am("gemini-4-neon-medium", "Gemini 4 Neon (Medium)"), am("gemini-4-neon-low", "Gemini 4 Neon (Low)"),
  am("gemini-4-carbon-medium", "Gemini 4 Carbon (Medium)"), am("gemini-4-carbon-high", "Gemini 4 Carbon (High)"), am("gemini-4-carbon-low", "Gemini 4 Carbon (Low)"),
  am("gemini-4-argon-medium", "Gemini 4 Argon (Medium)"), am("gemini-4-argon-high", "Gemini 4 Argon (High)"), am("gemini-4-argon-low", "Gemini 4 Argon (Low)"),
  am("gemini-4-hydrogen-high", "Gemini 4 Hydrogen (High)"), am("gemini-4-hydrogen-xhigh", "Gemini 4 Hydrogen (XHigh)"), am("gemini-4-hydrogen-medium", "Gemini 4 Hydrogen (Medium)"), am("gemini-4-hydrogen-low", "Gemini 4 Hydrogen (Low)"),
  am("gemini-pro-orchestrator-neon", "Orchestrator (Neon)"), am("gemini-pro-orchestrator", "Orchestrator (Carbon)"), am("gemini-pro-orchestrator-argon", "Orchestrator (Argon)"),
  am("gemini-3.8-flash-high", "Gemini 3.8 Flash (High)"), am("gemini-3.8-flash-medium", "Gemini 3.8 Flash (Medium)"), am("gemini-3.8-flash-low", "Gemini 3.8 Flash (Low)"),
  am("claude-sonnet-4-6", "Claude Sonnet 4.6 (Thinking)"), am("claude-opus-4-6-thinking", "Claude Opus 4.6 (Thinking)"), am("gpt-oss-120b-medium", "GPT-OSS 120B (Medium)"),
];
export const validAgyValue = (v) => v === "" || (typeof v === "string" && /^[A-Za-z0-9._\-]{1,60}$/.test(v));
// Parse the output of `agy models` ("Fetching available models..." then "<id>\t<name>" lines); null when nothing looks like a model line (for example "please sign in").
export function parseAgyModels(text) {
  const out = String(text).split(/\r?\n/).map((l) => l.split("\t")).filter((p) => p.length >= 2 && /^[A-Za-z0-9._\-]{1,60}$/.test(p[0].trim()))
    .map((p) => ({ id: p[0].trim(), name: p.slice(1).join(" ").trim() || p[0].trim() }));
  return out.length ? out : null;
}
// Groups for the picker: one group per model name without its "(Level)" part, so the variants of a model sit together; list order is kept.
export function agyGroups(models = AGY_FALLBACK) {
  const groups = [];
  for (const m of models) {
    const family = m.name.replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+\(Thinking\)$/, "") || m.name;
    let g = groups.find((x) => x.family === family);
    if (!g) groups.push((g = { family, models: [] }));
    g.models.push(m);
  }
  return groups;
}
export const agyName = (id, models = AGY_FALLBACK) => models.find((m) => m.id === id)?.name || id;
// Antigravity model + effort of every agent run (Settings > Antigravity); '' = agy's own default (no flag). The backend choice itself is agent.backend: "claude" (default) or "antigravity".
export const AGENT_BACKENDS = ["claude", "antigravity"];
// One AI choice per task (Run tab, Agent): agent.research and agent.create (the drafts' text AND, with image engine antigravity, their images) are claude | antigravity.
// Publish and Sync are always Claude (Antigravity has no Metricool connector). The old single choice agent.backend still counts when agent.research/create are not set.
export const AGENT_PICK = ["claude", "antigravity"];
export const agentFor = (settings = {}, task = "create") => {
  if (task === "publish" || task === "sync") return "claude";
  const a = settings?.agent || {}, v = a[task === "research" ? "research" : "create"];
  return AGENT_PICK.includes(v) ? v : a.backend === "antigravity" ? "antigravity" : "claude";
};
export const agentBackend = (settings = {}) => (settings?.agent?.backend === "antigravity" ? "antigravity" : "claude");
export const agyChoice = (settings = {}) => {
  const a = settings?.agent || {};
  const id = validAgyValue(a.agy_model) ? a.agy_model || "" : "";
  // A model id that already ends in its level (gemini-4-neon-high) takes no --effort.
  return { id, effort: AGY_EFFORTS.includes(a.agy_effort) && !/-(low|medium|high|xhigh)$/.test(id) ? a.agy_effort : "" };
};
