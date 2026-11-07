// The state of every brand for the cycle report: today's research run, ideas, drafts by status, and the drafts waiting
// for approval with their image path and captions (what the agent posts in chat for the human). Read-only.
// node scripts/queue.mjs [--brand <id>]
import fs from 'node:fs';
import path from 'node:path';
import { main, out, isMain, parseArgs, discoverBrands, latestRun, runDir, readJson, listDrafts, workspace, today } from './lib.mjs';
import { summary } from './draft-lib.mjs';

export function queueReport(args = {}) {
  const { root, brands } = discoverBrands();
  const log = readJson(path.join(workspace, 'research-log.json'), {});
  const report = brands.filter((b) => !args.brand || b.id === args.brand).map((b) => {
    const date = latestRun(b.id);
    const run = date ? readJson(path.join(runDir(b.id, date), 'run.json'), {}) : {};
    const ideas = date ? readJson(path.join(runDir(b.id, date), 'ideas.json'), { ideas: [] }).ideas : [];
    const drafts = listDrafts(b.id);
    const count = (list, key) => list.reduce((o, x) => { const k = key(x); o[k] = (o[k] || 0) + 1; return o; }, {});
    return {
      brand: b.id, usable: b.usable, problems: b.problems,
      research: { latest: date || null, status: run.status || null, today: date === today(), collected_today: Object.entries(log.collected?.[today()] || {}).filter(([k]) => k.startsWith(`${b.id}/`)).reduce((a, [, v]) => a + v, 0) },
      ideas: count(ideas, (i) => i.status),
      drafts: count(drafts, (d) => d.status.status),
      awaiting_approval: drafts.filter((d) => d.status.status === 'awaiting_approval').map(summary),
      in_progress: drafts.filter((d) => ['needs_prompt', 'generating', 'image_failed', 'needs_caption'].includes(d.status.status)).map((d) => ({ id: d.id, status: d.status.status, dir: d.dir, error: d.status.error || '', problems: d.status.problems || [] })),
      approved: drafts.filter((d) => d.status.brand_post).map((d) => ({ id: d.id, post: d.status.brand_post.id, folder: d.status.brand_post.folder, publish: 'chưa đăng: Publish (later: Metricool)' })),
    };
  });
  return { skillsRoot: root, date: today(), brands: report, publish: 'Publish (later: Metricool): chưa có, không bài nào được đăng.' };
}

if (isMain(import.meta.url)) main(() => out(queueReport(parseArgs())));
