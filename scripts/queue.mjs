// The state of every brand for the cycle report: today's research run, ideas, drafts by status, and the drafts waiting
// for approval with their image path and captions (what the agent posts in chat for the human). Read-only.
// node scripts/queue.mjs [--brand <id>]
import fs from 'node:fs';
import path from 'node:path';
import { main, out, isMain, parseArgs, discoverBrands, latestRun, runDir, readJson, listDrafts, workspace, today } from './lib.mjs';
import { summary } from './draft-lib.mjs';

// An approved post as RUNBOOK step 6 reports it: POST-xx, folder, and its hosted image link (catalog media_url) or
// "chưa có link" with the image host's error and the command to run again.
function approvedPost(d) {
  const bp = d.status.brand_post;
  let entry = null;
  try { entry = readJson(bp.catalog, { posts: [] }).posts.find((p) => p.id === bp.id) || null; } catch {}
  const media = entry ? [].concat(entry.media_url || []).filter(Boolean) : [];
  const host = d.status.image_host || null;
  return {
    id: d.id, post: bp.id, folder: bp.folder,
    media_url: media.length ? (media.length === 1 ? media[0] : media) : null,
    image_link: media.length ? media.join(', ') : 'chưa có link',
    ...(!media.length ? { host_error: host && !host.ok ? host.error || 'lỗi không rõ' : (entry ? 'chưa đưa ảnh lên repo ảnh' : 'không thấy bài trong catalog'), next: host?.next || `node scripts/host-image.mjs publish --brand ${d.draft.brand} --post ${bp.id}` } : {}),
    publish: 'chưa đăng: Publish (later: Metricool)',
  };
}

export function queueReport(args = {}) {
  const { root, brands } = discoverBrands();
  const log = readJson(path.join(workspace, 'research-log.json'), {});
  const report = brands.filter((b) => !args.brand || b.id === args.brand).map((b) => {
    const date = latestRun(b.id);
    const day = today(b.timezone);
    const run = date ? readJson(path.join(runDir(b.id, date), 'run.json'), {}) : {};
    const ideas = date ? readJson(path.join(runDir(b.id, date), 'ideas.json'), { ideas: [] }).ideas : [];
    const drafts = listDrafts(b.id);
    const count = (list, key) => list.reduce((o, x) => { const k = key(x); o[k] = (o[k] || 0) + 1; return o; }, {});
    return {
      brand: b.id, usable: b.usable, problems: b.problems,
      research: { latest: date || null, status: run.status || null, today: date === day, collected_today: Object.entries(log.collected?.[day] || {}).filter(([k]) => k.startsWith(`${b.id}/`)).reduce((a, [, v]) => a + v, 0) },
      ideas: count(ideas, (i) => i.status),
      drafts: count(drafts, (d) => d.status.status),
      awaiting_approval: drafts.filter((d) => d.status.status === 'awaiting_approval').map(summary),
      in_progress: drafts.filter((d) => ['needs_prompt', 'generating', 'image_failed', 'needs_caption'].includes(d.status.status)).map((d) => ({ id: d.id, status: d.status.status, dir: d.dir, error: d.status.error || '', problems: d.status.problems || [] })),
      approved: drafts.filter((d) => d.status.brand_post).map(approvedPost),
    };
  });
  return { skillsRoot: root, date: today(), brands: report, publish: 'Publish (later: Metricool): chưa có, không bài nào được đăng.' };
}

if (isMain(import.meta.url)) main(() => out(queueReport(parseArgs())));
