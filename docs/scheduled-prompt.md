# Ready-to-paste prompts (3 modes, one per agent)

The only source of the prompts: the app (**Prompt** tab) and `node scripts/prompts.mjs show --mode "<mode>" --agent "<agent>" [--brand <id>]` read this file. Each prompt is a `### <mode> · <agent>` heading with a `text` block. Placeholders: `{{TOOL}}` = this tool's folder on the machine, `{{BRAND}}` = a brand id (example: `dreamyvows`) or "all usable brands", `{{OPTIONS}}` = this run's options (or "defaults"), `{{SKILLS}}` = one line per brand in scope, A-Z: `SKILL: <brand id> → <absolute skill folder> (read its SKILL.md + project/project.md + project/social.json)` (from the brand → skill links, `workspace/metricool-brands.json` `skill_path`).

Every prompt follows ONE fixed template, so every run is the same: `TASK`, `OPTIONS`, `TOOL`, `SKILL` (one per brand), `STEPS` (numbered, one line each, mapping 1:1 to the RUNBOOK.md step numbers of the mode), `STOP IF`, `NEVER`. At most 18 lines (one SKILL line counted). The detail of each step, the rules and the report format live in `RUNBOOK.md`; change a step there and keep the line here in sync. The last two steps of every run are always: write the run log (`scripts/runlog.mjs`), then the report to the user with the fixed headings. Setup runs `node scripts/brands.mjs --run <research|create|publish>` so the run shows in the app's **Run progress** panel (Prompt tab, `scripts/progress.mjs`). Research: one brand and one reference page / discovery query at a time (research.mjs next). Create & publish / Publish approved use the fast path `scripts/pipeline.mjs` (one pipeline for all brands; it stops only for the agent's judgement: ideas, looking at the images, captions); images always run in parallel (`draft.mjs image-batch`, at most `codex.concurrency` Codex runs on the machine). The step-by-step commands stay in RUNBOOK as the fallback.

### Research only · Claude Code

```text
TASK: Research only — brand: {{BRAND}} — agent: Claude Code
OPTIONS: {{OPTIONS}}
TOOL: {{TOOL}}
{{SKILLS}}
STEPS (follow RUNBOOK.md Mode 1 + docs/research.md; in order, do not skip; one brand and one source/query at a time, never in parallel):
1. Setup: cd {{TOOL}}; read AGENTS.md + RUNBOOK.md "Rules for every run" + docs/research.md; for each SKILL line read that skill's SKILL.md + project/project.md + project/social.json (research.sources, research.discovery: keywords, hashtags, product_fit); node scripts/brands.mjs --run research.
2. 1.0 Check the browser FIRST: Playwright MCP connected to my signed-in Chrome (browser_tabs) → node scripts/research.mjs browser --brand <id> --state ok|fail (fail → stop, do not start).
3. 1.1 Open the run: node scripts/research.mjs start --brand <id> (with the OPTIONS flags); node scripts/store.mjs known --brand <id>.
4. 1.2 Collect, ONE path, one source/query at a time until next says done: node scripts/research.mjs next --brand <id> → open its "open" URL with Playwright MCP (browser_navigate) → loop: node scripts/collect.mjs script (see next.script; it writes extract.js and prints its path) → run that file with ONE browser_run_code_unsafe call using the filename parameter, never paste (it only reads the page now, returns at once) → node scripts/collect.mjs from-page --b64 <the whole b64 line> (never retype; read back the 4-char tag; it skips known posts and adds new ones to raw.json) → scroll as in next.scroll (Facebook: browser_run_code_unsafe with the page.mouse.wheel snippet from next.scroll, wait 3-5 s; End does not load its feed) → LOOK at the images of review[] and run collect.mjs fit at once (every source and query), then read the counters (read, pending_fit, kept, rejected, need, need_more) → extract again, until a stop rule (target = need_more 0 counting KEPT posts, poor_source = read >= 3 x need and still short, 3 extracts with no new posts, all known, login wall / captcha / closed page) → research.mjs ingest → research.mjs result --state <next's states>. Extract misses posts on the page → inspect the DOM, fix the adapter's SELECTORS, extract again (docs/research.md "Adapter").
5. 1.3 Filter in one pass: node scripts/store.mjs classify, judge text + thumbnails against product_fit, store.mjs verdict --file; repeat until 0 left.
6. 1.4 Report data: node scripts/research.mjs report (repeat its line per brand in your final message: target N · kept Y · rejected Z · duplicates D · Library available A).
7. 1.5 Write the run log: node scripts/runlog.mjs add --mode research --agent "Claude Code" (always, also after a stop).
8. 1.6 Report to me in Vietnamese with the fixed headings of RUNBOOK 1.6.
STOP IF: no Playwright MCP or my Chrome is not connected (tell me how to connect it); a login wall, captcha or checkpoint (collect says blocked) → result --state blocked for that platform and go on with the others. Then still do the run log (with the reason) and the report.
NEVER: like, save, follow, comment, message, join groups or post anywhere; sign in for me; store cookies; make ideas or posts; send anything to Metricool.
```

### Research only · Codex

```text
TASK: Research only — brand: {{BRAND}} — agent: Codex
OPTIONS: {{OPTIONS}}
TOOL: {{TOOL}}
{{SKILLS}}
STEPS (follow RUNBOOK.md Mode 1 + docs/research.md; in order, do not skip; one brand and one source/query at a time, never in parallel):
1. Setup: cd {{TOOL}}; read AGENTS.md + RUNBOOK.md "Rules for every run" + docs/research.md; for each SKILL line read that skill's SKILL.md + project/project.md + project/social.json (research.sources, research.discovery: keywords, hashtags, product_fit); node scripts/brands.mjs --run research.
2. 1.0 Check the browser FIRST: Playwright MCP connected to my signed-in Chrome (browser_tabs) → node scripts/research.mjs browser --brand <id> --state ok|fail (fail → stop, do not start).
3. 1.1 Open the run: node scripts/research.mjs start --brand <id> (with the OPTIONS flags); node scripts/store.mjs known --brand <id>.
4. 1.2 Collect, ONE path, one source/query at a time until next says done: node scripts/research.mjs next --brand <id> → open its "open" URL with Playwright MCP (browser_navigate) → loop: node scripts/collect.mjs script (see next.script; it writes extract.js and prints its path) → run that file with ONE browser_run_code_unsafe call using the filename parameter, never paste (it only reads the page now, returns at once) → node scripts/collect.mjs from-page --b64 <the whole b64 line> (never retype; read back the 4-char tag; it skips known posts and adds new ones to raw.json) → scroll as in next.scroll (Facebook: browser_run_code_unsafe with the page.mouse.wheel snippet from next.scroll, wait 3-5 s; End does not load its feed) → LOOK at the images of review[] and run collect.mjs fit at once (every source and query), then read the counters (read, pending_fit, kept, rejected, need, need_more) → extract again, until a stop rule (target = need_more 0 counting KEPT posts, poor_source = read >= 3 x need and still short, 3 extracts with no new posts, all known, login wall / captcha / closed page) → research.mjs ingest → research.mjs result --state <next's states>. Extract misses posts on the page → inspect the DOM, fix the adapter's SELECTORS, extract again (docs/research.md "Adapter").
5. 1.3 Filter in one pass: node scripts/store.mjs classify, judge text + thumbnails against product_fit, store.mjs verdict --file; repeat until 0 left.
6. 1.4 Report data: node scripts/research.mjs report (repeat its line per brand in your final message: target N · kept Y · rejected Z · duplicates D · Library available A).
7. 1.5 Write the run log: node scripts/runlog.mjs add --mode research --agent "Codex" (always, also after a stop).
8. 1.6 Report to me in Vietnamese with the fixed headings of RUNBOOK 1.6.
STOP IF: no Playwright MCP or my Chrome is not connected (tell me how to connect it); a login wall, captcha or checkpoint (collect says blocked) → result --state blocked for that platform and go on with the others. Then still do the run log (with the reason) and the report.
NEVER: like, save, follow, comment, message, join groups or post anywhere; sign in for me; store cookies; make ideas or posts; send anything to Metricool.
```

### Research only · ChatGPT

```text
TASK: Research only — brand: {{BRAND}} — agent: ChatGPT
This mode runs node commands in {{TOOL}} and drives my signed-in Chrome with Playwright MCP. If you cannot run commands on this machine, do nothing and reply only: "Research only needs Claude Code or Codex in the social-autopilot folder (it runs node scripts/research.mjs and browses with Playwright MCP in your Chrome). Open the social-autopilot folder in one of them and paste the matching prompt from the app's Prompt tab."
```

### Create & publish · Claude Code

```text
TASK: Create & publish — brand: {{BRAND}} — agent: Claude Code
OPTIONS: {{OPTIONS}}
TOOL: {{TOOL}}
{{SKILLS}}
STEPS (follow RUNBOOK.md Mode 2, fast path "pipeline.mjs"; in order, do not skip; ONE pipeline for all brands, no per-brand agents):
1. Setup: cd {{TOOL}}; read AGENTS.md + RUNBOOK.md "Rules for every run" + "Mode 2 fast path"; for each SKILL line read that skill's SKILL.md + project/project.md + references/image-guide.md; node scripts/brands.mjs --run create.
2. 2.0 node scripts/pipeline.mjs mcp-plan --brand <id|all> → make its Metricool MCP calls in parallel, save each answer to its save_to file.
3. 2.1 node scripts/pipeline.mjs create --brand <id|all> --brand-settings workspace/tmp/brand-settings.json --best-times-dir workspace/tmp (OPTIONS: --count N = N posts per brand, min(N, available Library items); a brand with stop "needs research" (0 available Library items): run Research for that brand first, the other brands continue) → send each workspace/pipeline/publish.json item now (createScheduledPost exactly, then its record command).
4. 2.2 Reconcile: each status_queries entry → getScheduledPosts; PUBLISHED → posts.mjs mark-published; ERROR → report.
5. 2.3-2.6 STOP (i) fill workspace/pipeline/ideas-todo.json (all brands, one pass) → pipeline.mjs create --resume --ideas <file> → pipeline.mjs create --resume → LOOK at every contact sheet (rules: docs/LESSONS.md) → STOP (ii) all captions + size_check per draft (or "redo", "smaller": N when too big) in captions-todo.json → pipeline.mjs create --resume --captions <file> until all ready.
6. 2.7 Stop at "To review" (never approve); 2.8 report data: printed by the last resume (queue.mjs).
7. 2.9 Run log: the last resume writes it (runlog.mjs add --mode create); a run that stops early: node scripts/runlog.mjs add --mode create --agent "Claude Code" --reason "<why>".
8. 2.10 Report to me in Vietnamese with the fixed headings of RUNBOOK 2.10.
STOP IF: a Metricool tool error (record nothing for that post), Codex image quota used up (image_failed after the retry); pipeline.mjs itself fails → continue with the step-by-step fallback (RUNBOOK 2.3-2.6). Then still the run log (with the reason) and the report.
NEVER: approve posts, write into a skill folder, send a post that already has a Metricool id, make Metricool drafts, set posting times by hand, add AI labels, put logos on products, use another blogId, skip looking at an image.
```

### Create & publish · Codex

```text
TASK: Create & publish — brand: {{BRAND}} — agent: Codex
OPTIONS: {{OPTIONS}}
TOOL: {{TOOL}}
{{SKILLS}}
STEPS (follow RUNBOOK.md Mode 2, fast path "pipeline.mjs"; in order, do not skip; ONE pipeline for all brands, no per-brand agents):
1. Setup: cd {{TOOL}}; read AGENTS.md + RUNBOOK.md "Rules for every run" + "Mode 2 fast path"; for each SKILL line read that skill's SKILL.md + project/project.md + references/image-guide.md; node scripts/brands.mjs --run create.
2. 2.0 node scripts/pipeline.mjs mcp-plan --brand <id|all> → make its Metricool MCP calls, save each answer to its save_to file.
3. 2.1 node scripts/pipeline.mjs create --brand <id|all> --brand-settings workspace/tmp/brand-settings.json --best-times-dir workspace/tmp (OPTIONS: --count N = N posts per brand, min(N, available Library items); a brand with stop "needs research" (0 available Library items): run Research for that brand first, the other brands continue) → send each workspace/pipeline/publish.json item now (createScheduledPost exactly, then its record command).
4. 2.2 Reconcile: each status_queries entry → getScheduledPosts; PUBLISHED → posts.mjs mark-published; ERROR → report.
5. 2.3-2.6 STOP (i) fill workspace/pipeline/ideas-todo.json (all brands, one pass) → pipeline.mjs create --resume --ideas <file> → pipeline.mjs create --resume → LOOK at every contact sheet (rules: docs/LESSONS.md) → STOP (ii) all captions + size_check per draft (or "redo", "smaller": N when too big) in captions-todo.json → pipeline.mjs create --resume --captions <file> until all ready.
6. 2.7 Stop at "To review" (never approve); 2.8 report data: printed by the last resume (queue.mjs).
7. 2.9 Run log: the last resume writes it (runlog.mjs add --mode create); a run that stops early: node scripts/runlog.mjs add --mode create --agent "Codex" --reason "<why>".
8. 2.10 Report to me in Vietnamese with the fixed headings of RUNBOOK 2.10.
STOP IF: a Metricool tool error (record nothing for that post), Codex image quota used up (image_failed after the retry), no Metricool MCP tools (skip 2.0-2.2: create without --brand-settings; tell me: codex mcp add metricool --url https://ai.metricool.com/mcp; codex mcp login metricool); pipeline.mjs itself fails → continue with the step-by-step fallback (RUNBOOK 2.3-2.6). Then still the run log (with the reason) and the report.
NEVER: approve posts, write into a skill folder, send a post that already has a Metricool id, make Metricool drafts, set posting times by hand, add AI labels, put logos on products, use another blogId, skip looking at an image.
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
STEPS (follow RUNBOOK.md Mode 3, fast path "pipeline.mjs publish"; in order, do not skip):
1. Setup: cd {{TOOL}}; read AGENTS.md + RUNBOOK.md "Rules for every run"; for each SKILL line read that skill's SKILL.md; node scripts/brands.mjs --run publish.
2. 2.0 node scripts/pipeline.mjs mcp-plan --brand <id|all> → make its Metricool MCP calls, save each answer to its save_to file.
3. 2.1 node scripts/pipeline.mjs publish --brand <id|all> --brand-settings workspace/tmp/brand-settings.json --best-times-dir workspace/tmp (+ OPTIONS flags) → send each item NOW (createScheduledPost exactly, then its record command; past send_before → payload again).
4. 2.2 Reconcile: each status_query → getScheduledPosts (PUBLISHED → posts.mjs mark-published); 2.8: node scripts/pipeline.mjs publish --resume (queue + run log).
5. 3.1 Run log: written by publish --resume (runlog.mjs add --mode publish); stopped early: node scripts/runlog.mjs add --mode publish --agent "Claude Code" --reason "<why>".
6. 3.2 Report to me in Vietnamese with the fixed headings of RUNBOOK 3.2.
STOP IF: a Metricool tool error (record nothing for that post). Then still the run log (with the reason) and the report.
NEVER: make ideas or posts, open a browser, approve posts, write into a skill folder, send a post that already has a Metricool id (Scheduled), make Metricool drafts, add AI labels, set posting times by hand, use another blogId.
```

### Publish approved · Codex

```text
TASK: Publish approved — brand: {{BRAND}} — agent: Codex
OPTIONS: {{OPTIONS}}
TOOL: {{TOOL}}
{{SKILLS}}
STEPS (follow RUNBOOK.md Mode 3, fast path "pipeline.mjs publish"; in order, do not skip):
1. Setup: cd {{TOOL}}; read AGENTS.md + RUNBOOK.md "Rules for every run"; for each SKILL line read that skill's SKILL.md; node scripts/brands.mjs --run publish.
2. 2.0 node scripts/pipeline.mjs mcp-plan --brand <id|all> → make its Metricool MCP calls, save each answer to its save_to file.
3. 2.1 node scripts/pipeline.mjs publish --brand <id|all> --brand-settings workspace/tmp/brand-settings.json --best-times-dir workspace/tmp (+ OPTIONS flags) → send each item NOW (createScheduledPost exactly, then its record command; past send_before → payload again).
4. 2.2 Reconcile: each status_query → getScheduledPosts (PUBLISHED → posts.mjs mark-published); 2.8: node scripts/pipeline.mjs publish --resume (queue + run log).
5. 3.1 Run log: written by publish --resume (runlog.mjs add --mode publish); stopped early: node scripts/runlog.mjs add --mode publish --agent "Codex" --reason "<why>".
6. 3.2 Report to me in Vietnamese with the fixed headings of RUNBOOK 3.2.
STOP IF: a Metricool tool error (record nothing for that post); no Metricool MCP tools (tell me: codex mcp add metricool --url https://ai.metricool.com/mcp; codex mcp login metricool). Then still the run log (with the reason) and the report.
NEVER: make ideas or posts, open a browser, approve posts, write into a skill folder, send a post that already has a Metricool id (Scheduled), make Metricool drafts, add AI labels, set posting times by hand, use another blogId.
```

### Publish approved · ChatGPT

```text
TASK: Publish approved — brand: {{BRAND}} — agent: ChatGPT
Follow the ChatGPT part of RUNBOOK.md ("Công cụ theo agent", folder {{TOOL}}). Without a pasted payload JSON below, reply only: "To send approved posts to Metricool, paste the JSON of node scripts/metricool-mcp.mjs payload --brand <id>."
With a payload: send each item with createScheduledPost exactly as given (a scheduled post, never a draft, no AI label), then reply in Vietnamese with the filled record commands.
```
