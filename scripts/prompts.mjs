// The ready-to-paste prompts (mode x agent). docs/scheduled-prompt.md is the only source: each prompt is a
// "### <mode> · <agent>" heading followed by a ```text block; {{BRAND}} is filled with a brand id or "tất cả".
// The app's Prompt tab reads them through /api/prompts; this command prints one.
//   node scripts/prompts.mjs list
//   node scripts/prompts.mjs show --mode "Research only" --agent "Claude Code" [--brand dreamyvows] [--options "..."]
import fs from 'node:fs';
import path from 'node:path';
import { main, out, isMain, parseArgs, need, toolRoot, discoverBrands, imageEngine } from './lib.mjs';

// One at a time or in parallel is said by each mode's STEPS line (Research: one at a time; Create / Publish: may run in
// parallel). Research wording (docs/scheduled-prompt.md): the sources are ALL the enabled ones of the brand by default (no --source); the Run tab Sources picker adds --source a,b only when a subset is ticked, and the Platforms picker adds --platforms a,b (discovery) and drops the sources of unticked platforms, collected fully by a
// smart crawl decided from the registry (new/partial to the end of the page, complete = top check, resumable time budget); Discovery only
// when OPTIONS say so; the extract script scrolls by itself (one browser call per round).
export const ALL_BRANDS = 'all usable brands';
export function promptList(md = fs.readFileSync(path.join(toolRoot, 'docs', 'scheduled-prompt.md'), 'utf8')) {
  const list = [];
  const re = /^###\s+(.+?)\s+·\s+(.+?)\s*\r?\n[\s\S]*?```text\r?\n([\s\S]*?)```/gm;
  for (let m; (m = re.exec(md));) list.push({ mode: m[1].trim(), agent: m[2].trim(), text: m[3].trim() });
  return list;
}
// {{IMAGES}} = the image engine lines (settings image_engine): empty for codex (nothing changes), the Google Flow procedure for flow.
// The full procedure with pitfalls is docs/flow-images.md; this is the short form every Create prompt carries.
export const FLOW_IMAGES_TEXT = [
  'IMAGES: engine = Google Flow (Run tab > Images). Do NOT run Codex for images (no draft.mjs image / image-batch); the pipeline stops at "waiting for Flow images" and lists, per draft, EVERY image (image.png, image-02.png ... up to image-04.png) with its prompt file, whether it needs image 1 as reference, and its register command. Make the images yourself in Flow in the signed-in Chrome with the Playwright MCP and follow docs/flow-images.md. Posts have 1-4 images of the SAME scene (random 1-4 unless the OPTIONS line says otherwise): image 1 = cover, extras = same product/scene/text/light with another camera shot. Brand rules (no logo on the product, English text on images) stay as in the skill and the draft prompt files; paste a CONDENSED English prompt into Flow (node scripts/draft.mjs flow-brief --id <draft> [--n k] prints it), not the whole Codex prompt file.',
  '  Flow BATCH (never sit idle, one image takes 20-30 s; parallelism is inside Flow, you are the only agent on the browser; the batching rules are in the skill image-guide, "Tạo nhiều ảnh song song"; node scripts/draft.mjs flow-queue lists every missing image in submission order with a tag <draft>#<n>, and node scripts/draft.mjs register-batch --map map.json registers all downloads at once): open https://flow.google.com → "Dự án mới" (New project) once per run → count chip: Image, ratio 1:1, x1 → Escape. SUBMIT PHASE: for every image 1 of every draft: CLICK THE BOTTOM PROMPT BOX (not the project-title textbox), paste the condensed prompt, attach the reference photo with "+" if any (flow-brief copies it to C:\Users\Admin\Downloads for the file chooser), press the round arrow, do NOT wait, next prompt. WAIT ONCE until all thumbnails are ready. Then every extra image (2..4): "+" → pick that draft\'s image 1 thumbnail in the project (Tất cả / Hình ảnh) → "Thêm vào câu lệnh" → send the album prompt (flow-brief --n k prints the prompt of the album type of that post: angle = same scene other shot, scene = same product in another scene), no waiting; wait once more. DOWNLOAD PHASE: open each thumbnail, check its prompt in the detail view, download icon (top right) → "1K Kích thước gốc" (Chrome saves a JPG named from Flow\'s own title, newest file in Downloads), match it to its draft/image number, then node scripts/draft.mjs register-image --id <draft> --n <1..4> --from <that file>. The count chip x2-x4 only for variants of the same prompt. Then pipeline.mjs create --resume.',
  '  Flow project: set up ONCE and reuse: node scripts/flow-pace.mjs project get; a returned url = open that project directly (its Hình ảnh / Nano Banana 2.1 / 1:1 / x1 settings are kept, check the chip); only when none is saved or it fails to open, create one, set it up once and run node scripts/flow-pace.mjs project set --url <project url>. Group the posts by image ratio, and change the ratio only when the group changes.',
  '  Flow UI: READ docs/flow-ui-notes.md and workspace/flow-ui-lessons.md BEFORE opening Flow and follow them; when you find a faster or more reliable way, or a pitfall that cost you more than 3 steps, APPEND one short line to workspace/flow-ui-lessons.md (UI element as shown + what to do; no personal data; no duplicates; create the file with a one-line header if missing).',
  '  Flow STOP: login wall, captcha, consent dialog you cannot pass, no credits, or "unusual activity" → stop, report, do not retry endlessly. Never ask Flow to remove a watermark or change a brand name.',
  '  Flow ONE IMAGE REFUSED (Flow says the request may violate its policy): retry THAT image ONCE with node scripts/draft.mjs flow-brief --id <draft> --n <k> --safe (a human figure on the product is described as printed artwork; same gate, same reference); refused again -> skip that image, report it, go on with the next one; never stop the run for it.',
  '  Flow STATUS LINES (the person reads them in the app while the run goes): one short Vietnamese sentence, post and image first, then the result, e.g. "Bài signlurex-20261123-01 ảnh 1: đã gửi Flow", "Bài signlurex-20261123-01 ảnh 1: ảnh đạt, chữ Mia & Jake", "Bài signlurex-20261123-01 ảnh 2: Flow từ chối, thử lại mô tả an toàn", "Bài signlurex-20261123-01 ảnh 2: bỏ qua (Flow từ chối 2 lần)". No English, no CLI names or CAUSE codes in these lines.',
].join('\n');
// Antigravity as the agent: the images are made by the agent itself with its built-in image-generator subagent (no Flow, no Chrome, no flow-pace gate).
// Same pipeline stop and the same register-image bookkeeping as Flow; every image rule (sign wording, no logo, scene-fitting text) stays in the skill and the prompt files.
export const AGY_IMAGES_TEXT = [
  'IMAGES: engine = Antigravity (no Google Flow, no browser, no Chrome tab or profile for the images; Run tab > Images). Do NOT run Codex for images (no draft.mjs image / image-batch); the pipeline stops at "waiting for Antigravity images" and lists, per draft, EVERY image (image.png, image-02.png ... up to image-04.png) with its prompt file, whether it needs image 1 as reference, and its register command. You make them yourself: posts have 1-4 images of the SAME scene (random 1-4 unless the OPTIONS line says otherwise): image 1 = cover, extras = same product/scene/text/light with another camera shot or scene. Brand rules (no logo on the product, English text on images, sign wording, scene-fitting text) stay as in the skill and the draft prompt files.',
  '  PER IMAGE: node scripts/draft.mjs flow-brief --id <draft> --n <k> --engine antigravity prints the condensed English prompt, the aspect, image_paths (the reference: the brand/product photo for image 1, image 1 of the post for extras) and image_name. Then call invoke_subagent with type_name "image-generator" (the ONLY subagent you may call) and give it exactly: Prompt = that prompt, ImagePaths = image_paths (none for an empty list), AspectRatio = aspect, ImageName = image_name. It takes about 80 s per image and saves a JPG under ~/.gemini/antigravity-cli/brain/<conversation>/<name>_<time>.jpg. LOOK at the picture (check the sign wording and that no logo sits on the product), then node scripts/draft.mjs register-image --id <draft> --n <k> --engine antigravity --from <that jpg> (the tool converts the jpg, cleans metadata, adds the watermark when the brand has it and checks it). Go in order, a cover before its extras; node scripts/draft.mjs flow-queue --engine antigravity lists every missing image in that order. THREADS (the THREADS line of this run, default 1): with THREADS N > 1 work in GROUPS of up to N images, calling invoke_subagent once per image of the group in ONE turn (only image-generator); a group is the covers of up to N different posts, or the extras of ONE post whose cover is registered; then LOOK at and register each image one after the other. Then node scripts/pipeline.mjs create --resume.',
  '  QUOTA: when the image generator answers with a quota-exceeded error (HTTP 429, a reset time in hours and minutes), STOP making images at once: do not retry, skip the rest, say in your report when it resets (HH:mm) and that the person can choose Images: Antigravity (Flow) or Codex and continue.',
  '  ONE IMAGE REFUSED or failed: retry THAT image ONCE with node scripts/draft.mjs flow-brief --id <draft> --n <k> --engine antigravity --safe (a human figure on the product is described as printed artwork; same reference); failed again -> skip that image, report it, go on with the next one; never stop the run for it, never drop an item for quality.',
  '  STATUS LINES (the person reads them in the app while the run goes): one short Vietnamese sentence, post and image first, then the result, e.g. "Bài signlurex-20261123-01 ảnh 1: Antigravity đang tạo ảnh", "Bài signlurex-20261123-01 ảnh 1: ảnh đạt, chữ Mia & Jake", "Bài signlurex-20261123-01 ảnh 2: bị từ chối, thử lại mô tả an toàn", "Bài signlurex-20261123-01 ảnh 2: bỏ qua (từ chối 2 lần)". No English, no CLI names or CAUSE codes in these lines.',
].join('\n');
export const imagesText = (engine = imageEngine()) => (engine === 'flow' ? FLOW_IMAGES_TEXT : engine === 'antigravity' ? AGY_IMAGES_TEXT : '');
// {{EXTERNAL}} = the extra Research step "External sources": filled ONLY when a brand has nothing left to crawl (every enabled source fully
// crawled, no suggestion pending); the Run tab then adds "external sources for: <brands>" to OPTIONS. Empty otherwise (the line disappears).
// The wording is documented in docs/scheduled-prompt.md and docs/research.md.
export const EXTERNAL_TEXT = 'EXTRA STEP 1.4b External sources (do it after 1.4 and before the run log; ONLY for the brands named in OPTIONS "external sources for", one brand at a time): every source of that brand is fully crawled and no suggestion is pending, so look OUTSIDE my list for NEW pages and only SUGGEST them. Run node scripts/sources.mjs queries --brand <id> (add --platforms a,b when OPTIONS has --platforms): it prints the search pages built from the skill research.discovery keywords/hashtags/platforms, used even if discovery.enabled is false and narrowed by the Platforms option (nothing printed: take the product types from project.md). Open each search page with Playwright MCP (one tab, same pace and login/stop rules as 1.2) and look for PAGES (Facebook pages/groups, Instagram accounts, Pinterest boards/profiles, Etsy shops, Houzz pros) whose products fit the brand product_fit. For each good candidate (max 5 per brand per run) record a suggestion and do NOT crawl it: node scripts/sources.mjs suggest --brand <id> --url <page url> --name "<page name>" --platform <instagram|pinterest|facebook|etsy|houzz> --reason "<why it fits, short>" (it refuses a bad URL and skips pages that are already a source, already suggested or dismissed: added:false is fine, go on). Public business pages only: never a private or personal profile, never a competitor personal account; no like, follow or join. Nothing from a suggested page is ingested in this run (I choose in the Run tab or the brand Edit page). List the suggestions (name, platform, reason) in the 1.6 report.';
export const externalText = (on = false) => (on ? EXTERNAL_TEXT : '');
// {{TOOL}} = this tool's folder (never a fixed path), {{BRAND}} = the brand or all, {{OPTIONS}} = this run's options.
// One SKILL line per brand in scope (all usable brands when none is given), A-Z, with its linked skill folder: the
// terminal agent cannot pick a skill, so the prompt says where each one is.
// Legacy brand skill (<id>-skills): everything is in its folder. Shared skill (current layout): the skill root
// holds SKILL.md, references/, scripts/ once for all brands; each brand is ONE folder <skillsRoot>/<skill>/brands/<id>/ inside the skill with its project/
// and its working data (posts, published, covers, catalog.json, context.md, local) side by side; the agent reads ONLY that folder
// and runs shared scripts with --brand <id>.
export function skillLine(b) {
  if (!b.shared) return `SKILL: ${b.id} → ${b.dir} (read its SKILL.md + project/project.md + project/social.json)`;
  const sh = (f) => path.join(b.skillRoot, f);
  return `SKILL: ${b.id} → brand folder ${b.dir}; skill root ${b.skillRoot}. Read ${sh('SKILL.md')} and ${sh('references')} (shared rules), then ONLY this brand's folder: ${path.join(b.dir, 'project', 'project.md')}, project/social.json, and its working data (posts/, published/, covers/, catalog.json, context.md) in the same folder ${b.dir}. Never read another brand's folder. Run shared scripts from the skill root with --brand ${b.id}, e.g. node ${sh('scripts/check-skill.mjs')} --brand ${b.id} --tool-ready (clean-image.mjs takes no --brand).`;
}
export function skillLines(brand = '', brands = discoverBrands().brands) {
  const list = brands.filter((b) => (brand ? b.id === brand : b.usable)).sort((a, b) => a.id.localeCompare(b.id));
  return list.map(skillLine).join('\n') || 'SKILL: (no linked, usable brand)';
}
export const fillPrompt = (text, brand, options = 'defaults', skills = skillLines(brand), images = imagesText(), external = '') => String(text).replace(/\n?\{\{IMAGES\}\}/g, () => (images ? '\n' + images : '')).replace(/\n?\{\{EXTERNAL\}\}/g, () => (external ? '\n' + external : '')).replace(/\{\{TOOL\}\}/g, toolRoot).replace(/\{\{BRAND\}\}/g, brand || ALL_BRANDS).replace(/\{\{OPTIONS\}\}/g, options).replace(/\{\{SKILLS\}\}/g, skills);

if (isMain(import.meta.url)) main(() => {
  const args = parseArgs();
  const list = promptList();
  if (args._[0] === 'list') return out({ prompts: list.map(({ mode, agent }) => ({ mode, agent })) });
  if (args._[0] === 'show') {
    const p = list.find((x) => x.mode === need(args, 'mode') && x.agent === need(args, 'agent'));
    if (!p) throw new Error('Không có prompt cho mode/agent này (xem prompts.mjs list).');
    return out({ ...p, text: fillPrompt(p.text, args.brand && args.brand !== true ? String(args.brand) : '') });
  }
  throw new Error('Lệnh: list | show');
});
