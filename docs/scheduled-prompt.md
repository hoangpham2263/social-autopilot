# Ready-to-paste prompts (2 modes, one per agent)

The only source of the prompts: the app (**Prompt** tab) and `node scripts/prompts.mjs show --mode "<mode>" --agent "<agent>" [--brand <id>]` read this file. Each prompt is a `### <mode> · <agent>` heading with a `text` block. `{{BRAND}}` becomes a brand id (e.g. `dreamyvows`) or "all usable brands"; `{{OPTIONS}}` becomes this run's options (or "defaults").

Prompts are SHORT on purpose: every step, rule and report format lives in `RUNBOOK.md` (Mode 1 / Mode 2 and "Rules for every run") and `AGENTS.md`. A prompt only says the mode, the brand(s), the options and which agent tools to use. Change a step in the RUNBOOK, not here.

Agents: every step is a `node scripts/...` command that prints JSON, so any agent can run it. Only the outside tools differ:
- **Claude Code**: Playwright MCP (Chrome signed into Facebook) for research; claude.ai "Metricool" connector; Codex CLI for images.
- **Codex** (CLI / app): reads `AGENTS.md`. Research needs a browser MCP in `~/.codex/config.toml` (`[mcp_servers.playwright]`, `npx -y @playwright/mcp@latest --extension`). Metricool: `codex mcp add metricool --url https://ai.metricool.com/mcp` + `codex mcp login metricool`.
- **ChatGPT** (web/desktop): cannot run commands on this machine. It can only send finished posts to Metricool from a pasted `metricool-mcp.mjs payload` JSON (RUNBOOK, "ChatGPT").

### Research only · Claude Code

```text
Mode: RESEARCH ONLY. Brand: {{BRAND}}.
Options: {{OPTIONS}}
Folder: C:\hoangpq\social-autopilot. Follow RUNBOOK.md Mode 1 exactly (with AGENTS.md and docs/research.md) and its "Rules for every run".
Browser: Playwright MCP on the Chrome signed into Facebook. Stop at any checkpoint, captcha or login prompt.
No ideas, no posts, nothing sent to Metricool. Report to me in Vietnamese as RUNBOOK 1.5 says.
```

### Research only · Codex

```text
Mode: RESEARCH ONLY. Brand: {{BRAND}}.
Options: {{OPTIONS}}
Folder: C:\hoangpq\social-autopilot. Follow AGENTS.md and RUNBOOK.md Mode 1 exactly (with docs/research.md) and its "Rules for every run".
First check you have a browser MCP (Playwright on the Chrome signed into Facebook); if not, stop and tell me how to add it (RUNBOOK Mode 1).
No ideas, no posts, nothing sent to Metricool. Report to me in Vietnamese as RUNBOOK 1.5 says.
```

### Research only · ChatGPT

```text
Mode: RESEARCH ONLY. Brand: {{BRAND}}.
This mode runs node commands in C:\hoangpq\social-autopilot and drives the Chrome signed into Facebook. If you cannot run commands on this machine, do nothing and reply only: "Research only needs Claude Code (Playwright MCP) or Codex with a browser MCP. Open the social-autopilot folder in one of them and paste the matching prompt from the app's Prompt tab."
```

### Create & publish · Claude Code

```text
Mode: CREATE & PUBLISH (from the library; no Facebook, no approval step). Brand: {{BRAND}}.
Options: {{OPTIONS}}
Folder: C:\hoangpq\social-autopilot. Follow RUNBOOK.md Mode 2 exactly (2.0 to 2.7, with AGENTS.md) and its "Rules for every run".
Tools: Codex CLI for images; the claude.ai Metricool connector (createScheduledPost, getScheduledPosts).
Report to me in Vietnamese as RUNBOOK 2.7 says.
```

### Create & publish · Codex

```text
Mode: CREATE & PUBLISH (from the library; no Facebook, no approval step). Brand: {{BRAND}}.
Options: {{OPTIONS}}
Folder: C:\hoangpq\social-autopilot. Follow AGENTS.md and RUNBOOK.md Mode 2 exactly (2.0 to 2.7) and its "Rules for every run".
First check whether you have the Metricool MCP tools; without them make and write the posts but send nothing (RUNBOOK Mode 2).
Report to me in Vietnamese as RUNBOOK 2.7 says.
```

### Create & publish · ChatGPT

```text
Mode: CREATE & PUBLISH. Brand: {{BRAND}}.
Follow the "ChatGPT" part of RUNBOOK.md (C:\hoangpq\social-autopilot). Without a pasted payload JSON below, reply only: "Creating posts needs Claude Code or Codex in the social-autopilot folder. To send finished posts to Metricool, paste the JSON of node scripts/metricool-mcp.mjs payload --brand <id>." With a payload: send each item with createScheduledPost exactly as given, then reply in Vietnamese with the filled record commands.
```
