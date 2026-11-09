// The state of every brand, for the end-of-run report and the app's Tổng quan: the research store (kho) and its last
// crawl (new, duplicates skipped, blocked sources), ideas, drafts by status, posts written into the brand with their
// hosted image and Metricool state (draft / scheduled / published / error as last recorded). Read-only.
// node scripts/queue.mjs [--brand <id>]
import path from 'node:path';
import { main, out, isMain, parseArgs, discoverBrands, readJson, listDrafts, workspace, today } from './lib.mjs';
import { summary } from './draft-lib.mjs';
import { readStore, counts, storeIdeasFile } from './store.mjs';
import { researchReport } from './research.mjs';

// Metricool state of a catalog entry, from what metricool-mcp.mjs record / mark-published wrote.
export function metricoolState(entry) {
  if (!entry) return { state: 'none', sent: [] };
  const sent = Object.entries(entry.metricool || {}).map(([network, m]) => ({ network, ...m }));
  if (entry.status === 'published') return { state: 'published', sent };
  if (sent.some((m) => m.error)) return { state: 'error', sent };
  if (!sent.length) return { state: 'not_sent', sent };
  return { state: sent.every((m) => m.draft) ? 'draft' : 'scheduled', sent };
}

// A post written into the brand: POST-xx, folder, hosted image link (catalog media_url) or the host error + command,
// and its Metricool state.
export function writtenPost(d) {
  const bp = d.status.brand_post;
  let entry = null;
  try { entry = readJson(bp.catalog, { posts: [] }).posts.find((p) => p.id === bp.id) || null; } catch {}
  const media = entry ? [].concat(entry.media_url || []).filter(Boolean) : [];
  const host = d.status.image_host || null;
  const mc = metricoolState(entry);
  return {
    id: d.id, post: bp.id, folder: bp.folder, catalog_status: entry?.status || null,
    media_url: media.length ? (media.length === 1 ? media[0] : media) : null,
    image_link: media.length ? media.join(', ') : host?.pending ? 'đang đưa ảnh lên' : 'chưa có link',
    ...(!media.length && !host?.pending ? { host_error: host && !host.ok ? host.error || 'lỗi không rõ' : (entry ? 'chưa đưa ảnh lên repo ảnh' : 'không thấy bài trong catalog'), next: host?.next || `node scripts/host-image.mjs publish --brand ${d.draft.brand} --post ${bp.id}` } : {}),
    metricool: mc.state, metricool_sent: mc.sent.map(({ network, draft, publication, timezone, planner_url, id }) => ({ network, draft, publication, timezone, planner_url, id })),
  };
}

export function queueReport(args = {}) {
  const { root, brands } = discoverBrands();
  const log = readJson(path.join(workspace, 'research-log.json'), {});
  const report = brands.filter((b) => !args.brand || b.id === args.brand).map((b) => {
    const day = today(b.timezone);
    const crawl = researchReport(b.id);
    const ideas = readJson(storeIdeasFile(b.id), { ideas: [] }).ideas;
    const drafts = listDrafts(b.id);
    const count = (list, key) => list.reduce((o, x) => { const k = key(x); o[k] = (o[k] || 0) + 1; return o; }, {});
    const written = drafts.filter((d) => d.status.brand_post).map(writtenPost);
    return {
      brand: b.id, name: b.brand, enabled: b.enabled, usable: b.usable, problems: b.problems,
      store: counts(readStore(b.id).items),
      research: { latest: crawl.date, status: crawl.status || null, today: crawl.date === day, new_last_crawl: crawl.new_total || 0, duplicates_last_crawl: crawl.duplicates_total || 0, sources: crawl.sources, done: crawl.done, blocked: crawl.blocked, pending: crawl.pending, collected_today: Object.entries(log.collected?.[day] || {}).filter(([k]) => k.startsWith(`${b.id}/`)).reduce((a, [, v]) => a + v, 0) },
      ideas: count(ideas, (i) => i.status),
      drafts: count(drafts, (d) => d.status.status),
      // Passed every automatic check, not yet written into the brand (finalize.mjs run).
      ready: drafts.filter((d) => d.status.status === 'ready' && !d.status.brand_post).map(summary),
      failed: drafts.filter((d) => ['check_failed', 'image_failed'].includes(d.status.status)).map((d) => ({ id: d.id, status: d.status.status, dir: d.dir, error: d.status.error || '', problems: d.status.problems || [] })),
      in_progress: drafts.filter((d) => ['needs_prompt', 'generating', 'needs_caption'].includes(d.status.status)).map((d) => ({ id: d.id, status: d.status.status, dir: d.dir, error: d.status.error || '', problems: d.status.problems || [] })),
      written,
      metricool: count(written, (w) => w.metricool),
    };
  });
  return { skillsRoot: root, date: today(), brands: report };
}

if (isMain(import.meta.url)) main(() => out(queueReport(parseArgs())));
