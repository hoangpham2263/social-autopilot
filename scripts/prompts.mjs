// The ready-to-paste prompts (mode x agent). docs/scheduled-prompt.md is the only source: each prompt is a
// "### <mode> · <agent>" heading followed by a ```text block; {{BRAND}} is filled with a brand id or "tất cả".
// The app's Prompt tab reads them through /api/prompts; this command prints one.
//   node scripts/prompts.mjs list
//   node scripts/prompts.mjs show --mode "Research only" --agent "Claude Code" [--brand dreamyvows] [--options "..."]
import fs from 'node:fs';
import path from 'node:path';
import { main, out, isMain, parseArgs, need, toolRoot } from './lib.mjs';

export const ALL_BRANDS = 'all usable brands (one at a time, not in parallel)';
export function promptList(md = fs.readFileSync(path.join(toolRoot, 'docs', 'scheduled-prompt.md'), 'utf8')) {
  const list = [];
  const re = /^###\s+(.+?)\s+·\s+(.+?)\s*\r?\n[\s\S]*?```text\r?\n([\s\S]*?)```/gm;
  for (let m; (m = re.exec(md));) list.push({ mode: m[1].trim(), agent: m[2].trim(), text: m[3].trim() });
  return list;
}
// {{TOOL}} = this tool's folder (never a fixed path), {{BRAND}} = the brand or all, {{OPTIONS}} = this run's options.
export const fillPrompt = (text, brand, options = 'defaults') => String(text).replace(/\{\{TOOL\}\}/g, toolRoot).replace(/\{\{BRAND\}\}/g, brand || ALL_BRANDS).replace(/\{\{OPTIONS\}\}/g, options);

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
