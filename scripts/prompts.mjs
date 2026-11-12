// The ready-to-paste prompts (mode x agent). docs/scheduled-prompt.md is the only source: each prompt is a
// "### <mode> · <agent>" heading followed by a ```text block; {{BRAND}} is filled with a brand id or "tất cả".
// The app's Prompt tab reads them through /api/prompts; this command prints one.
//   node scripts/prompts.mjs list
//   node scripts/prompts.mjs show --mode "Research only" --agent "Claude Code" [--brand dreamyvows] [--options "..."]
import fs from 'node:fs';
import path from 'node:path';
import { main, out, isMain, parseArgs, need, toolRoot, discoverBrands, imageEngine } from './lib.mjs';

// One at a time or in parallel is said by each mode's STEPS line (Research: one at a time; Create / Publish: may run in
// parallel). Research wording (docs/scheduled-prompt.md): the sources are ALL the enabled ones of the brand (no --source in the Run tab prompt), collected fully by a
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
  'IMAGES: engine = Google Flow (settings image_engine). Do NOT run Codex for images (no draft.mjs image / image-batch); the pipeline stops at "waiting for Flow images". Make each image yourself in Flow in the signed-in Chrome with the Playwright MCP, one at a time (one browser), and follow docs/flow-images.md. The brand rules (no logo on the product, English text on images, album 1-3 images) stay as in the skill and the draft prompt.txt / prompt-0N.txt (those files are the Flow prompts).',
  '  Flow: open https://flow.google.com → "New project" (Dự án mới) → click the bottom prompt box, set via the count chip: Image, the post ratio (1:1 feed), x1 → Escape → CLICK THE BOTTOM PROMPT BOX (not the project-title textbox) and type the prompt → round arrow → wait 20-30 s for the thumbnail → open it → download icon → "1K original size" (JPG lands in the Downloads folder; find the newest <project>_<id>.jpg with node) → node scripts/draft.mjs register-image --id <draft> --n <1|2|3> --from <that file> (converts to PNG, removes the Google sparkle locally, cleans, checks). Reference/product photo: the "+" button at the left of the prompt box. Use text/role locators, adapt to the UI language; never ask Flow to remove a watermark or change a brand name.',
  '  Flow STOP: login wall, captcha, consent dialog you cannot pass, no credits, or a Flow refusal → stop, report, do not retry endlessly.',
].join('\n');
export const imagesText = (engine = imageEngine()) => (engine === 'flow' ? FLOW_IMAGES_TEXT : '');
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
export const fillPrompt = (text, brand, options = 'defaults', skills = skillLines(brand), images = imagesText()) => String(text).replace(/\n?\{\{IMAGES\}\}/g, () => (images ? '\n' + images : '')).replace(/\{\{TOOL\}\}/g, toolRoot).replace(/\{\{BRAND\}\}/g, brand || ALL_BRANDS).replace(/\{\{OPTIONS\}\}/g, options).replace(/\{\{SKILLS\}\}/g, skills);

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
