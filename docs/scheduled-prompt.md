# Ready-to-paste prompts (2 modes, one per agent)

The only source of the prompts: the app (**Prompt** tab) and `node scripts/prompts.mjs show --mode "<mode>" --agent "<agent>" [--brand <id>]` read this file. Each prompt is a `### <mode> · <agent>` heading with a `text` block. Placeholders: `{{TOOL}}` = this tool's folder on the machine, `{{BRAND}}` = a brand id (example: `dreamyvows`) or "all usable brands", `{{OPTIONS}}` = this run's options (or "defaults"), `{{SKILLS}}` = one line per brand in scope, A-Z: `SKILL: <brand id> → <absolute skill folder> (read its SKILL.md + project/project.md + project/social.json)` (from the brand → skill links, `workspace/metricool-brands.json` `skill_path`).

Every prompt follows ONE fixed template, so every run is the same: `TASK`, `OPTIONS`, `TOOL`, `SKILL` (one per brand), `STEPS` (numbered, one line each, mapping 1:1 to the RUNBOOK.md step numbers of the mode), `STOP IF`, `NEVER`. At most 18 lines (one SKILL line counted). The detail of each step, the rules and the report format live in `RUNBOOK.md`; change a step there and keep the line here in sync. The last two steps of every run are always: write the run log (`scripts/runlog.mjs`), then the report to the user with the fixed headings.

### Research only · Claude Code

```text
TASK: Research only — brand: {{BRAND}} — agent: Claude Code
OPTIONS: {{OPTIONS}}
TOOL: {{TOOL}}
{{SKILLS}}
STEPS (follow RUNBOOK.md Mode 1; do them in order, do not skip):
1. Setup: cd {{TOOL}}; read AGENTS.md + RUNBOOK.md "Rules for every run"; for each SKILL line read that skill's SKILL.md; node scripts/brands.mjs.
2. 1.1 Open the crawl: node scripts/research.mjs start (with the OPTIONS flags).
3. 1.2 Crawl each source with Playwright MCP (the Chrome signed into Facebook), as docs/research.md says.
4. 1.3 Ingest + 1.4 record how each source ended (research.mjs ingest, research.mjs result).
5. 1.5 Report data: node scripts/research.mjs report.
6. 1.6 Write the run log: node scripts/runlog.mjs add --mode research --agent "Claude Code".
7. 1.7 Report to me in Vietnamese with the fixed headings of RUNBOOK 1.7.
STOP IF: checkpoint, captcha or login prompt (record "blocked", open no other source).
NEVER: make ideas or posts, send anything to Metricool, sign in for me, store cookies.
```

### Research only · Codex

```text
TASK: Research only — brand: {{BRAND}} — agent: Codex
OPTIONS: {{OPTIONS}}
TOOL: {{TOOL}}
{{SKILLS}}
STEPS (follow RUNBOOK.md Mode 1; do them in order, do not skip):
1. Setup: cd {{TOOL}}; read AGENTS.md + RUNBOOK.md "Rules for every run"; for each SKILL line read that skill's SKILL.md; check you have a browser MCP; node scripts/brands.mjs.
2. 1.1 Open the crawl: node scripts/research.mjs start (with the OPTIONS flags).
3. 1.2 Crawl each source with the browser MCP (the Chrome signed into Facebook), as docs/research.md says.
4. 1.3 Ingest + 1.4 record how each source ended (research.mjs ingest, research.mjs result).
5. 1.5 Report data: node scripts/research.mjs report.
6. 1.6 Write the run log: node scripts/runlog.mjs add --mode research --agent "Codex".
7. 1.7 Report to me in Vietnamese with the fixed headings of RUNBOOK 1.7.
STOP IF: no browser MCP (tell me how to add it, RUNBOOK "Công cụ theo agent"); checkpoint, captcha or login prompt.
NEVER: make ideas or posts, send anything to Metricool, sign in for me, store cookies.
```

### Research only · ChatGPT

```text
TASK: Research only — brand: {{BRAND}} — agent: ChatGPT
This mode runs node commands in {{TOOL}} and drives the Chrome signed into Facebook. If you cannot run commands on this machine, do nothing and reply only: "Research only needs Claude Code (Playwright MCP) or Codex with a browser MCP. Open the social-autopilot folder in one of them and paste the matching prompt from the app's Prompt tab."
```

### Create & publish · Claude Code

```text
TASK: Create & publish — brand: {{BRAND}} — agent: Claude Code
OPTIONS: {{OPTIONS}}
TOOL: {{TOOL}}
{{SKILLS}}
STEPS (follow RUNBOOK.md Mode 2; do them in order, do not skip):
1. Setup: cd {{TOOL}}; read AGENTS.md + RUNBOOK.md "Rules for every run"; for each SKILL line read that skill's SKILL.md; node scripts/brands.mjs.
2. 2.0 Sync Metricool brands and best times: getBrandSettings → sync-brands; getBestTimeToPostByNetwork → sync-times.
3. 2.1 Schedule approved posts not yet sent at the best times (payload → createScheduledPost → record).
4. 2.2 Reconcile sent posts (status → getScheduledPosts).
5. 2.3-2.6 Make enough new posts for the next days: ideas → drafts and images (Codex CLI) → captions → checks.
6. 2.7 Stop at "To review"; 2.8 report data: node scripts/queue.mjs.
7. 2.9 Write the run log: node scripts/runlog.mjs add --mode create --agent "Claude Code".
8. 2.10 Report to me in Vietnamese with the fixed headings of RUNBOOK 2.10.
STOP IF: a Metricool tool error (record nothing for that post), Codex image quota is used up.
NEVER: approve posts, make Metricool drafts, set posting times by hand, add AI labels, put logos on products, use another blogId.
```

### Create & publish · Codex

```text
TASK: Create & publish — brand: {{BRAND}} — agent: Codex
OPTIONS: {{OPTIONS}}
TOOL: {{TOOL}}
{{SKILLS}}
STEPS (follow RUNBOOK.md Mode 2; do them in order, do not skip):
1. Setup: cd {{TOOL}}; read AGENTS.md + RUNBOOK.md "Rules for every run"; for each SKILL line read that skill's SKILL.md; check the Metricool MCP tools; node scripts/brands.mjs.
2. 2.0 Sync Metricool brands and best times: getBrandSettings → sync-brands; getBestTimeToPostByNetwork → sync-times.
3. 2.1 Schedule approved posts not yet sent at the best times (payload → createScheduledPost → record).
4. 2.2 Reconcile sent posts (status → getScheduledPosts).
5. 2.3-2.6 Make enough new posts for the next days: ideas → drafts and images → captions → checks.
6. 2.7 Stop at "To review"; 2.8 report data: node scripts/queue.mjs.
7. 2.9 Write the run log: node scripts/runlog.mjs add --mode create --agent "Codex".
8. 2.10 Report to me in Vietnamese with the fixed headings of RUNBOOK 2.10.
STOP IF: no Metricool MCP tools (skip 2.0-2.2, still make posts, tell me: codex mcp add metricool --url https://ai.metricool.com/mcp; codex mcp login metricool).
NEVER: approve posts, make Metricool drafts, set posting times by hand, add AI labels, put logos on products, use another blogId.
```

### Create & publish · ChatGPT

```text
TASK: Create & publish — brand: {{BRAND}} — agent: ChatGPT
Follow the ChatGPT part of RUNBOOK.md ("Công cụ theo agent", folder {{TOOL}}). Without a pasted payload JSON below, reply only: "Creating posts needs Claude Code or Codex in the social-autopilot folder. To send approved posts to Metricool, paste the JSON of node scripts/metricool-mcp.mjs payload --brand <id>."
With a payload: send each item with createScheduledPost exactly as given (a scheduled post, never a draft, no AI label), then reply in Vietnamese with the filled record commands.
```
