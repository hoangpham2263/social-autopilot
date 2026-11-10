# MAP: social-autopilot in one page

Making posts (ideas, images, captions): read `docs/LESSONS.md` first (lessons learned, read before making posts).
Read this first when working ON the tool (code, tests, UI). Running the tool (research, posts) follows `RUNBOOK.md`; rules for every agent are in `AGENTS.md`.

## Folders
- `scripts/` every step, one Node script each; each command prints ONE JSON (`ok: true|false`) via `lib.mjs out()/fail()`.
- `scripts/collect-pagemode.mjs` in-page mode (`collect.mjs script` prints a Playwright MCP script, `collect.mjs from-page` turns its JSON into raw.json; tests `tests/collect-pagemode.test.mjs`).
- `scripts/collect-fetch.mjs` + `scripts/platforms/fetch/*.mjs` direct fetch routes without a browser (`collect.mjs fetch`: reddit Atom RSS, houzz curl HTML, pinterest user/board RSS; polite throttle, 429/403 = blocked; tests `tests/collect-fetch.test.mjs`, fixtures `tests/fixtures/fetch-*`). `from-page` checks the compact result `total` + `checksum` and merges `--chunk` results.
- `scripts/collect.mjs` generic collector + `scripts/platforms/<platform>.mjs` adapters (`index.mjs` registry: `status` untested|ok|broken + `checked` date; selectors only in each file's `SELECTORS` block; `common.mjs` generic tile/wall readers). Tests: `tests/collect.test.mjs` (pure parts + HTML fixtures `tests/fixtures/collect-*.html`, no browser).
- `scripts/lib.mjs` shared core: settings, brand discovery (`discoverBrands`, `loadBrand`, `brandSocial`), Metricool brand list, `withLock` + atomic `writeJson`, `cleanText`, `parseArgs`.
- `src/server.mjs` local app server (127.0.0.1, port from the folder hash, `SA_PORT` overrides) + `ui/index.html` (one file: HTML, CSS, JS). The app only calls functions of `scripts/`.
- `core/` launcher shell (Windows WebView2 / macOS), setup page, update.
- `config/` defaults (`settings.json`, `best-times.json`, examples). `prompts/` Codex image prompts, caption brief, idea rules.
- `docs/` `scheduled-prompt.md` (the ONLY source of the Prompt tab texts), `research.md`, `metricool.md`, `LESSONS.md` (lessons for making posts), this map.
- `tests/` `node:test`, one file per area; `fake-codex.mjs` stands in for Codex (`SA_CODEX`).
- `workspace/` (git-ignored, all state; see below).

## Data flow
1. Brand = Metricool brand linked to a skill folder (`workspace/metricool-brands.json` `skill_path`). The skill is READ-ONLY: rules, product photos, `project/social.json`. Tool-side overrides: `workspace/brands/<id>.json` (Brand Edit), merged by `brandSocial()`.
2. Research (Mode 1): the script `collect.mjs` reads each step from the user's signed-in Chrome (platform adapters in `scripts/platforms/`), the agent only judges images and writes/fixes adapters (Playwright MCP by hand only when an adapter is `untested`/failing): `research.mjs start` (reference pages + discovery queue from `research.discovery`: platforms, keywords, hashtags, `product_fit`, `max_per_platform`; `--platforms/--keywords/--max-posts` = target) → loop `research.mjs next` (reference pages first, then discovery round-robin across platforms) → `collect.mjs --for-query|--for-source` writes raw.json (agent looks at the images: `collect.mjs fit`) → `research.mjs ingest --source|--query` (`store.mjs addPosts`: `fitProblem` rejects off-brand into rejected.json; dedupe across platforms: `postIds` per platform, dHash, caption) → `result` → `store.mjs classify/verdict`. `crawl-fb.mjs` (CDP, crawl Chrome :9222) = optional fast path for Facebook reference pages.
3. Create (Mode 2): `ideas.mjs` (store items → abstract ideas; items are reusable (Library states Available · Removed; Available shows "new" or "used N×", Removed keeps its reason): never-used first, then least used after `ideas.reuse_cooldown_days`; each draft adds `uses[]` to its item; a reuse needs a different scene OR a different sign_text (keep-scene changes the text, new-scene the scene; same scene + text + product = blocked), `store.mjs reuseProblems`; Removed never picked; `--items` picks exact items, also through `pipeline.mjs create --items`) → `draft.mjs new` (draft folder, prompt.txt) → `draft.mjs image-batch` (Codex, parallel, global slots) → `image-clean.mjs` (metadata) → LOOK + `draft.mjs size-check` (measured proportions; over the limit: one `reprompt --smaller N` retry) → captions → `draft.mjs check` → **To review**. The prompt always carries real size + comparison object (`--compare`) + limits (`sizeLimits`: defaults, `product_images.size_limits`); scene-swap (reference photo = the product, foreign marks removed) has two modes the agent picks by looking at the reference (`ref_has_face`, `ref_mode` in the ideas file + draft.json; `draft-lib.mjs refModeOf/refTemplate`): `keep-scene` (no face: scene and framing kept, NEW `sign_text` ≠ `ref_text`, same language; prompt `prompts/ref-keep-scene.txt`, no size-check) and `new-scene` (face: new real-life scene, people removed, text kept, proportion rules; `prompts/ref-new-scene.txt`, `confirm-clean --no-people`).
4. Approve (user, app only): `finalize.mjs approve` → `writeback.mjs` → register `workspace/posts/<brand>/` (catalog.json + POST-xx folder, `media_alt`) → `host-image.mjs` (public repo clone `workspace/image-host`).
5. Publish (Mode 2/3): `metricool-mcp.mjs payload` (exact `createScheduledPost` args; agent calls MCP) → `record` → `status` (agent `getScheduledPosts`) → `posts.mjs mark-published` / `unsend`. Never twice: payload only takes `approved` posts with no live Metricool id (`sentNetworks`); `record` refuses a second id for a post unless it was `unsend`-ed.

User-visible states (Posts tab, in order): **To review** (draft `ready`) · **Approved** (in the register, no live Metricool id: waiting to send) · **Scheduled** (live Metricool id, not published) · **Posted** (published). `queue.mjs` `catalogPosts` gives `state` approved/scheduled/posted, `unsent_approved` (= Publish approved count) and `on_metricool`.
6. Every run: `brands.mjs --run <mode>` opens the Run progress (`progress.mjs`, `workspace/runs/current-<mode>.json`); `runlog.mjs add` closes it (`workspace/logs/runs/`).

## Main commands per mode
- Mode 1 Research: `research.mjs browser --state ok` → `research.mjs start` → loop `research.mjs next` (prints `collect` + `adapter.status`) → `collect.mjs` (hand-driven fallback: docs/research.md) → `collect.mjs fit` → `research.mjs ingest --source|--query` → `result` → `store.mjs classify|verdict` → `research.mjs report` → `runlog.mjs add --mode research`. Optional FB fast path: `crawl-fb.mjs --check` + `crawl-fb.mjs --brand <id>`.
- Mode 2 Create (fast path): `pipeline.mjs mcp-plan` → MCP calls → `pipeline.mjs create --brand <id|all> --brand-settings … --best-times-dir …` → ideas file → `--resume --ideas f` → `--resume` (contact sheet) → captions file → `--resume --captions f` (checks, queue, run log). Step-by-step fallback: RUNBOOK 2.0-2.10.
- Mode 3 Publish: `pipeline.mjs publish --brand … [--limit|--window|--start today]` → MCP sends + record → `pipeline.mjs publish --resume`.
- Look at images: `draft.mjs contact-sheet [--ids a,b]` (pure-Node PNG; ffmpeg only for JPEG/WebP).
- Brand overrides: `social.mjs show|override --brand <id>`.

## Where state lives (workspace/)
| Path | What |
|---|---|
| `settings.json` | machine settings (relative paths; never secrets) |
| `metricool-brands.json` | synced Metricool brands + skill links |
| `brands/<id>.json` | Brand Edit overrides (posts_per_day, paused, sources_add, sources_disabled) |
| `store/<brand>/` | research store: items carry `platform`, `source_url`, `author`, `found_by` (reference page \| keyword:<kw> \| hashtag:<tag>), `product_fit`; rejected.json = off-brand posts not stored; items.json (status new\|rejected = Available/Removed, `uses[]`, `last_used`; old "used" migrates in memory, `store.mjs migrate-uses` saves), images/, ideas.json, progress.json, duplicates.json |
| `runs/<brand>/<date>/` | crawl logs; `runs/current-<mode>.json` Run progress |
| `drafts/<brand>/<draft>/` | draft.json, status.json, prompt.txt, image*.png, content-<lang>.txt, codex.log |
| `posts/<brand>/` | the tool's post register (catalog.json, POST-xx/, archive/) |
| `pipeline/` | pipeline state (create.json, publish-run.json) + files for the agent |
| `image-host/` | clone of the public image repo (own git) |
| `logs/<date>.log`, `logs/runs/` | command log, run logs (Log tab) |
| `tmp/` | MCP answers, codex-slots/ |

## Rules (never break)
- Skills are read-only: never write into a skill folder (overrides go to `workspace/brands/`).
- The tool posts only through Metricool MCP, always real scheduled posts (`draft: false`); never Metricool drafts, never post directly, never `createScheduledPostForReview`.
- Agents never approve (`finalize.mjs approve` is the user's, in the app).
- No AI labels anywhere in a post; `instagramData.isAiGenerated` false.
- No logo on the product (prompt keeps NO LOGO; a corner watermark only when the brand turns it on).
- Never competitor images/words/shop names in posts; references are inspiration only.
- One browser = one agent; never drive the crawl Chrome (:9222) from tests or UI checks. `collect.mjs` is read only (scroll + read), pauses never below 5-15 s, stops on a login wall/captcha.
- Commits: user identity only, no co-author lines. Every `child_process` has `windowsHide: true`. Shared files only via `withLock` + atomic write.

## Tests
- All: `npm test` (~80 s). Focused: `node --test tests/<file>.test.mjs` (e.g. `tests/pipeline.test.mjs`, `tests/metricool-mcp.test.mjs`, `tests/library-reuse.test.mjs`).
- Tests set `SA_WORKSPACE`, `SA_SKILLS_ROOT`, `SA_CODEX` (fake Codex) to temp folders; some copy real skills from `../vaniecom-workspace/skills` and skip without them.
- Pure helpers import the module after setting env (`process.env.SA_WORKSPACE = …; await import('../scripts/lib.mjs')`): the workspace path is read at load time.
- `SA_PROGRESS=off` silences Run progress writes when running scripts by hand.

## Common pitfalls
- `String.replace(x, "…$$…")`: `$$` becomes `$` (and `$&` the match). Use a function replacement: `.replace(x, () => text)`.
- Patching files from a bash heredoc: quotes, `$`, emoji and `rm`-like text get mangled or flagged; write the patch script to a file (scratchpad) and run it with node.
- `src/server.mjs` (and scripts it imported) changes need a server restart (app: Reload / restart; tests start their own).
- `ui/index.html` is cached nowhere (no-store); just reload the page.
- `parseArgs`: `--key value`, `--key=value` (values may start with `-`), bare `--flag` = true.
- Times: brands plan in their Metricool timezone (usually ET); the user reads VN time. Label times (ET/VN); dates are local, never UTC.
- Prompt texts: tests check shape (≤18 lines, numbered steps = progress steps, runlog second to last).
- Windows: Git Bash paths `/c/...`; `node --check file` before running edited scripts.
