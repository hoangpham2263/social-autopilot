# Ready-to-paste prompts (2 modes, one per agent)

The only source of the prompts: the app (**Prompt** tab) and `node scripts/prompts.mjs show --mode "<mode>" --agent "<agent>" [--brand <id>]` read this file. Each prompt is a `### <mode> · <agent>` heading with a `text` block. Placeholders: `{{TOOL}}` = this tool's folder on the machine, `{{BRAND}}` = a brand id (example: `dreamyvows`) or "all usable brands", `{{OPTIONS}}` = this run's options (or "defaults").

Prompts are SHORT on purpose (5-10 lines): mode, brand(s), options, which agent tools, and "follow RUNBOOK.md Mode N". Every step, rule and report format lives in `RUNBOOK.md` (Mode 1 / Mode 2, "Rules for every run", "Công cụ theo agent") and `AGENTS.md`. Change a step in the RUNBOOK, not here.

### Research only · Claude Code

```text
Mode: RESEARCH ONLY. Brand: {{BRAND}}.
Options: {{OPTIONS}}
Folder: {{TOOL}}. Follow RUNBOOK.md Mode 1 exactly (with AGENTS.md, docs/research.md and "Rules for every run").
Browser: Playwright MCP on the Chrome signed into Facebook. Stop at any checkpoint, captcha or login prompt.
No ideas, no posts, nothing sent to Metricool. Report to me in Vietnamese as RUNBOOK 1.5 says.
```

### Research only · Codex

```text
Mode: RESEARCH ONLY. Brand: {{BRAND}}.
Options: {{OPTIONS}}
Folder: {{TOOL}}. Follow AGENTS.md and RUNBOOK.md Mode 1 exactly (with docs/research.md and "Rules for every run").
First check you have a browser MCP (Playwright on the Chrome signed into Facebook); if not, stop and tell me how to add it (RUNBOOK, "Công cụ theo agent").
No ideas, no posts, nothing sent to Metricool. Report to me in Vietnamese as RUNBOOK 1.5 says.
```

### Research only · ChatGPT

```text
Mode: RESEARCH ONLY. Brand: {{BRAND}}.
This mode runs node commands in {{TOOL}} and drives the Chrome signed into Facebook. If you cannot run commands on this machine, do nothing and reply only: "Research only needs Claude Code (Playwright MCP) or Codex with a browser MCP. Open the social-autopilot folder in one of them and paste the matching prompt from the app's Prompt tab."
```

### Create & publish · Claude Code

```text
Mode: CREATE & PUBLISH. Brand: {{BRAND}}.
Options: {{OPTIONS}}
Folder: {{TOOL}}. Follow RUNBOOK.md Mode 2 exactly (2.0 to 2.8, with AGENTS.md and "Rules for every run").
Tools: the claude.ai Metricool connector (getBrandSettings, createScheduledPost, getScheduledPosts); Codex CLI for images.
Sync Metricool brands first, schedule approved posts not yet sent (never drafts), then make new posts and stop at "To review". Never approve posts yourself.
Report to me in Vietnamese as RUNBOOK 2.8 says.
```

### Create & publish · Codex

```text
Mode: CREATE & PUBLISH. Brand: {{BRAND}}.
Options: {{OPTIONS}}
Folder: {{TOOL}}. Follow AGENTS.md and RUNBOOK.md Mode 2 exactly (2.0 to 2.8, with "Rules for every run").
First check you have the Metricool MCP tools; if not, skip 2.0-2.2, still make the posts, and tell me: codex mcp add metricool --url https://ai.metricool.com/mcp, then codex mcp login metricool.
Sync Metricool brands first, schedule approved posts not yet sent (never drafts), then make new posts and stop at "To review". Never approve posts yourself.
Report to me in Vietnamese as RUNBOOK 2.8 says.
```

### Create & publish · ChatGPT

```text
Mode: CREATE & PUBLISH. Brand: {{BRAND}}.
Follow the ChatGPT part of RUNBOOK.md ("Công cụ theo agent", folder {{TOOL}}). Without a pasted payload JSON below, reply only: "Creating posts needs Claude Code or Codex in the social-autopilot folder. To send approved posts to Metricool, paste the JSON of node scripts/metricool-mcp.mjs payload --brand <id>."
With a payload: send each item with createScheduledPost exactly as given (a scheduled post, never a draft, no AI label), then reply in Vietnamese with the filled record commands.
```
