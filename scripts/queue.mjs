// The state of every brand, for the end-of-run report and the app's Tổng quan: the research store (kho) and its last
// crawl (new, duplicates skipped, blocked sources), ideas, drafts by status, posts written into the brand with their
// hosted image and Metricool state (draft / scheduled / published / error as last recorded). Read-only.
// node scripts/queue.mjs [--brand <id>]
import fs from 'node:fs';
import path from 'node:path';
import { main, out, isMain, parseArgs, discoverBrands, readJson, listDrafts, workspace, today } from './lib.mjs';
import { summary } from './draft-lib.mjs';
import { readStore, counts, storeIdeasFile } from './store.mjs';
import { researchReport } from './research.mjs';
import { sentNetworks } from './metricool-csv.mjs';
import { postsNeeded } from './ideas.mjs';
import { readPosts, postFolder, findPost } from './posts.mjs';

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
  try { entry = findPost(d.draft.brand, bp.id); } catch {}
  const media = entry ? [].concat(entry.media_url || []).filter(Boolean) : [];
  const host = d.status.image_host || null;
  const mc = metricoolState(entry);
  return {
    id: d.id, post: bp.id, folder: bp.folder, catalog_status: entry?.status || null,
    media_url: media.length ? (media.length === 1 ? media[0] : media) : null,
    image_link: media.length ? media.join(', ') : host?.pending ? 'đang đưa ảnh lên' : 'chưa có link',
    ...(!media.length && !host?.pending ? { host_error: host && !host.ok ? host.error || 'lỗi không rõ' : (entry ? 'chưa đưa ảnh lên repo ảnh' : 'không thấy bài trong catalog'), next: host?.next || `node scripts/host-image.mjs publish --brand ${d.draft.brand} --post ${bp.id}` } : {}),
    metricool: mc.state, metricool_sent: mc.sent.map(({ network, draft, publication, timezone, planner_url, id, uuid, sent_at, time_source, replaced_draft }) => ({ network, draft, publication, timezone, planner_url, id, uuid, sent_at, time_source, replaced_draft })),
    // History: Metricool ids the post had and lost (posts.mjs unsend), published info, approval.
    metricool_history: (entry?.metricool_history || []).map(({ network, id, draft, publication, timezone, sent_at, unsent_at, reason, replaced_draft }) => ({ network, id, draft, publication, timezone, sent_at, unsent_at, reason, replaced_draft })),
    published: entry?.published || null, approval: entry?.approval || null,
  };
}

// The tool's own posts: its register workspace/posts/<brand>/catalog.json (scripts/posts.mjs). Skill catalogs are never
// read here: the skill's posts are its private data, never counted, listed or sent.
// unsent = approved, hosted image, not sent yet on the brand's channels: exactly what Publish approved sends.
export function catalogPosts(b, drafts = listDrafts(b.id)) {
  const linked = new Set(drafts.filter((d) => d.status.brand_post).map((d) => d.status.brand_post.id));
  let posts = [];
  try { posts = readPosts(b.id).posts || []; } catch {}
  const channels = (b.channels || []).map((n) => String(n).toLowerCase());
  return posts.filter((p) => p && p.id).map((p) => {
    const mc = metricoolState(p);
    const media = [].concat(p.media_url || [], p.video_url || []).filter(Boolean);
    const folder = postFolder(b.id, p);
    const image = folder && p.image && fs.existsSync(path.join(folder, p.image)) ? path.join(folder, p.image) : '';
    const sent = sentNetworks(p).some((n) => channels.includes(n));
    // approved = waiting to send (no live Metricool id); scheduled = on Metricool (live id, not published yet).
    const live = sentNetworks(p).length > 0;
    const state = mc.state === 'published' ? 'posted' : !['approved', 'scheduled'].includes(p.status) ? 'other' : live ? 'scheduled' : 'approved';
    return {
      post: p.id, group: p.group || '', status: p.status || '', in_app: linked.has(p.id), state, metricool: mc.state,
      metricool_sent: mc.sent.map(({ network, draft, publication, timezone, planner_url, id, sent_at, time_source }) => ({ network, draft, publication, timezone, planner_url, id, sent_at, time_source })),
      media_url: media.length ? media[0] : null, image, folder, captions: p.captions || {}, created: p.created || '',
      unsent: p.status === 'approved' && !!media.length && !sent,
      on_metricool: state === 'scheduled',
    };
  });
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
    const catalog = catalogPosts(b, drafts);
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
      // The tool's approved posts Publish approved would send (metricool-mcp.mjs payload).
      // Plan ahead: days x posts per day, how many the tool's posts already cover, how many Create & publish still makes.
      plan: postsNeeded({ id: b.id, social: { cadence: { posts_per_day: b.posts_per_day } } }),
      unsent_approved: catalog.filter((c) => c.unsent).map((c) => c.post),
      // Already on Metricool (live id, not published): never sent again by payload.
      on_metricool: catalog.filter((c) => c.on_metricool).map((c) => c.post),
    };
  });
  // date = the tool's day in ET (brands' Metricool timezone); date_vn = the user's day in Vietnam (differs in the VN morning).
  return { skillsRoot: root, date: today(), date_tz: 'ET (America/New_York)', date_vn: today('Asia/Ho_Chi_Minh'), brands: report };
}

if (isMain(import.meta.url)) main(() => out(queueReport(parseArgs())));
