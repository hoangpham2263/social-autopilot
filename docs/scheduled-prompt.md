# Ready-to-paste prompts (3 modes, one per agent)

The only source of the prompts: the app (**Prompt** tab) and `node scripts/prompts.mjs show --mode "<mode>" --agent "<agent>" [--brand <id>]` read this file. Each prompt is a `### <mode> · <agent>` heading with a `text` block. Placeholders: `{{TOOL}}` = this tool's folder on the machine, `{{BRAND}}` = a brand id (example: `dreamyvows`) or "all usable brands", `{{OPTIONS}}` = this run's options (or "defaults"), `{{SKILLS}}` = one line per brand in scope, A-Z: `SKILL: <brand id> → <absolute skill folder> (read its SKILL.md + project/project.md + project/social.json)` (from the brand → skill links, `workspace/metricool-brands.json` `skill_path`).

Every prompt follows ONE fixed template, so every run is the same: `TASK`, `OPTIONS`, `TOOL`, `SKILL` (one per brand), `STEPS` (numbered, one line each, mapping 1:1 to the RUNBOOK.md step numbers of the mode), `STOP IF`, `NEVER`. At most 18 lines (one SKILL line counted). The detail of each step, the rules and the report format live in `RUNBOOK.md`; change a step there and keep the line here in sync. The last two steps of every run are always: write the run log (`scripts/runlog.mjs`), then the report to the user with the fixed headings. Setup runs `node scripts/brands.mjs --run <research|create|publish>` so the run shows in the app's **Run progress** panel (Prompt tab, `scripts/progress.mjs`). Research: one brand and one source at a time. Create & publish / Publish approved: brands may run in parallel (Claude Code, Run in = Sub-agent: one sub-agent per brand); images always run in parallel (`draft.mjs image-batch`, at most `codex.concurrency` Codex runs on the machine).

### Research only · Claude Code

```text
TASK: Research only — brand: {{BRAND}} — agent: Claude Code
OPTIONS: {{OPTIONS}}
TOOL: {{TOOL}}
{{SKILLS}}
STEPS (follow RUNBOOK.md Mode 1; do them in order, do not skip; one brand and one source at a time, never in parallel):
1. Setup: cd {{TOOL}}; read AGENTS.md + RUNBOOK.md "Rules for every run"; for each SKILL line read that skill's SKILL.md + project/project.md; node scripts/brands.mjs --run research.
2. 1.0 Check the crawl Chrome FIRST: node scripts/crawl-fb.mjs --check (not ok → stop, do not start the crawl).
3. 1.1 Open the crawl: node scripts/research.mjs start (with the OPTIONS flags).
4. 1.2 Crawl by script: node scripts/crawl-fb.mjs --brand <id>; step in only on blocked / error.
5. 1.3 Filter in one pass: node scripts/store.mjs classify, judge text + thumbnails, store.mjs verdict --file; repeat until 0 left.
6. 1.4 Report data: node scripts/research.mjs report.
7. 1.5 Write the run log: node scripts/runlog.mjs add --mode research --agent "Claude Code" (always, also after a stop).
8. 1.6 Report to me in Vietnamese with the fixed headings of RUNBOOK 1.6.
STOP IF: --check not ok (Chrome not running or not signed in: tell me how to start it); checkpoint, captcha or login prompt (crawl-fb records "blocked"). Then still do the run log (with the reason) and the report.
NEVER: like, comment, follow or message; make ideas or posts; send anything to Metricool; sign in for me; store cookies.
```

### Research only · Codex

```text
TASK: Research only — brand: {{BRAND}} — agent: Codex
OPTIONS: {{OPTIONS}}
TOOL: {{TOOL}}
{{SKILLS}}
STEPS (follow RUNBOOK.md Mode 1; do them in order, do not skip; one brand and one source at a time, never in parallel):
1. Setup: cd {{TOOL}}; read AGENTS.md + RUNBOOK.md "Rules for every run"; for each SKILL line read that skill's SKILL.md + project/project.md; node scripts/brands.mjs --run research.
2. 1.0 Check the crawl Chrome FIRST: node scripts/crawl-fb.mjs --check (not ok → stop, do not start the crawl).
3. 1.1 Open the crawl: node scripts/research.mjs start (with the OPTIONS flags).
4. 1.2 Crawl by script: node scripts/crawl-fb.mjs --brand <id>; step in only on blocked / error.
5. 1.3 Filter in one pass: node scripts/store.mjs classify, judge text + thumbnails, store.mjs verdict --file; repeat until 0 left.
6. 1.4 Report data: node scripts/research.mjs report.
7. 1.5 Write the run log: node scripts/runlog.mjs add --mode research --agent "Codex" (always, also after a stop).
8. 1.6 Report to me in Vietnamese with the fixed headings of RUNBOOK 1.6.
STOP IF: --check not ok (Chrome not running or not signed in: tell me how to start it); checkpoint, captcha or login prompt (crawl-fb records "blocked"). Then still do the run log (with the reason) and the report.
NEVER: like, comment, follow or message; make ideas or posts; send anything to Metricool; sign in for me; store cookies.
```

### Research only · ChatGPT

```text
TASK: Research only — brand: {{BRAND}} — agent: ChatGPT
This mode runs node commands in {{TOOL}} and drives the Chrome signed into Facebook. If you cannot run commands on this machine, do nothing and reply only: "Research only needs Claude Code or Codex in the social-autopilot folder (it runs node scripts/crawl-fb.mjs against Chrome). Open the social-autopilot folder in one of them and paste the matching prompt from the app's Prompt tab."
```

### Create & publish · Claude Code

```text
TASK: Create & publish — brand: {{BRAND}} — agent: Claude Code
OPTIONS: {{OPTIONS}}
TOOL: {{TOOL}}
{{SKILLS}}
STEPS (follow RUNBOOK.md Mode 2; do them in order, do not skip; brands may run in parallel: one sub-agent per brand when Run in = Sub-agent):
1. Setup: cd {{TOOL}}; read AGENTS.md + RUNBOOK.md "Rules for every run"; for each SKILL line read that skill's SKILL.md; node scripts/brands.mjs --run create.
2. 2.0 Sync Metricool brands and best times: getBrandSettings → sync-brands; getBestTimeToPostByNetwork → sync-times.
3. 2.1 Schedule approved posts not yet sent at the best times (payload → createScheduledPost → record).
4. 2.2 Reconcile sent posts (status → getScheduledPosts).
5. 2.3-2.6 Make enough new posts for the next days: ideas → drafts → all images at once (draft.mjs image-batch, in the background) → captions meanwhile → checks.
6. 2.7 Stop at "To review"; 2.8 report data: node scripts/queue.mjs.
7. 2.9 Write the run log: node scripts/runlog.mjs add --mode create --agent "Claude Code".
8. 2.10 Report to me in Vietnamese with the fixed headings of RUNBOOK 2.10.
STOP IF: a Metricool tool error (record nothing for that post), Codex image quota still used up after image-batch's retry (image_failed). Then still do the run log (with the reason) and the report.
NEVER: approve posts, make Metricool drafts, set posting times by hand, add AI labels, put logos on products, use another blogId.
```

### Create & publish · Codex

```text
TASK: Create & publish — brand: {{BRAND}} — agent: Codex
OPTIONS: {{OPTIONS}}
TOOL: {{TOOL}}
{{SKILLS}}
STEPS (follow RUNBOOK.md Mode 2; do them in order, do not skip; brands one at a time):
1. Setup: cd {{TOOL}}; read AGENTS.md + RUNBOOK.md "Rules for every run"; for each SKILL line read that skill's SKILL.md; check the Metricool MCP tools; node scripts/brands.mjs --run create.
2. 2.0 Sync Metricool brands and best times: getBrandSettings → sync-brands; getBestTimeToPostByNetwork → sync-times.
3. 2.1 Schedule approved posts not yet sent at the best times (payload → createScheduledPost → record).
4. 2.2 Reconcile sent posts (status → getScheduledPosts).
5. 2.3-2.6 Make enough new posts for the next days: ideas → drafts → all images at once (draft.mjs image-batch) → captions → checks.
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

### Publish approved · Claude Code

```text
TASK: Publish approved — brand: {{BRAND}} — agent: Claude Code
OPTIONS: {{OPTIONS}}
TOOL: {{TOOL}}
{{SKILLS}}
STEPS (follow RUNBOOK.md Mode 3; do them in order, do not skip; brands may run in parallel: one sub-agent per brand when Run in = Sub-agent):
1. Setup: cd {{TOOL}}; read AGENTS.md + RUNBOOK.md "Rules for every run"; for each SKILL line read that skill's SKILL.md; node scripts/brands.mjs --run publish.
2. 2.0 Sync Metricool brands and best times: getBrandSettings → sync-brands; getBestTimeToPostByNetwork → sync-times.
3. 2.1 Schedule every approved post not yet sent at the best times (payload → createScheduledPost → record).
4. 2.2 Reconcile sent posts (status → getScheduledPosts); 2.8 report data: node scripts/queue.mjs.
5. 3.1 Write the run log: node scripts/runlog.mjs add --mode publish --agent "Claude Code".
6. 3.2 Report to me in Vietnamese with the fixed headings of RUNBOOK 3.2.
STOP IF: a Metricool tool error (record nothing for that post). Then still do the run log (with the reason) and the report.
NEVER: make ideas or posts, open a browser, approve posts, make Metricool drafts, set posting times by hand, use another blogId.
```

### Publish approved · Codex

```text
TASK: Publish approved — brand: {{BRAND}} — agent: Codex
OPTIONS: {{OPTIONS}}
TOOL: {{TOOL}}
{{SKILLS}}
STEPS (follow RUNBOOK.md Mode 3; do them in order, do not skip; brands one at a time):
1. Setup: cd {{TOOL}}; read AGENTS.md + RUNBOOK.md "Rules for every run"; for each SKILL line read that skill's SKILL.md; check the Metricool MCP tools; node scripts/brands.mjs --run publish.
2. 2.0 Sync Metricool brands and best times: getBrandSettings → sync-brands; getBestTimeToPostByNetwork → sync-times.
3. 2.1 Schedule every approved post not yet sent at the best times (payload → createScheduledPost → record).
4. 2.2 Reconcile sent posts (status → getScheduledPosts); 2.8 report data: node scripts/queue.mjs.
5. 3.1 Write the run log: node scripts/runlog.mjs add --mode publish --agent "Codex".
6. 3.2 Report to me in Vietnamese with the fixed headings of RUNBOOK 3.2.
STOP IF: no Metricool MCP tools (tell me: codex mcp add metricool --url https://ai.metricool.com/mcp; codex mcp login metricool).
NEVER: make ideas or posts, open a browser, approve posts, make Metricool drafts, set posting times by hand, use another blogId.
```

### Publish approved · ChatGPT

```text
TASK: Publish approved — brand: {{BRAND}} — agent: ChatGPT
Follow the ChatGPT part of RUNBOOK.md ("Công cụ theo agent", folder {{TOOL}}). Without a pasted payload JSON below, reply only: "To send approved posts to Metricool, paste the JSON of node scripts/metricool-mcp.mjs payload --brand <id>."
With a payload: send each item with createScheduledPost exactly as given (a scheduled post, never a draft, no AI label), then reply in Vietnamese with the filled record commands.
```
