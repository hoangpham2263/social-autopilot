// Review step (user, 09/11/2026: the tool schedules REAL posts, so a person approves each one). A draft that passed
// every automatic check (status "ready") waits as "Needs review". Approve (app, Posts -> Preview -> Approve, or this
// command) checks it once more (image clean, captions per posted and reviewer-only language, the brand's footer/hashtag,
// no copied words, no AI label, NO LOGO prompt, scene-swap logo check), then writes it into the tool's own post register
// (writeback.mjs -> workspace/posts/<brand>/: catalog entry "approved", approval.by "user", posts.mjs checkPost; the
// brand skill is never written) and hosts its image
// (host-image.mjs -> media_url). The next Create & publish run schedules it in Metricool (metricool-mcp.mjs payload).
// A draft that fails stops there with its problems (status "check_failed"). Agents never approve on their own.
//   node scripts/finalize.mjs approve --id <draft>                   one post a person approved
//   node scripts/finalize.mjs cancel  --id <draft> [--note ..]       "Drop": drop a draft before it is approved
//   node scripts/finalize.mjs unapprove --id <draft> [--metricool-deleted]   "Back to review" for a Queued post (never Posted):
//        the register entry and post folder go to workspace/posts/<brand>/archive/<POST-xx>-<time>/, the hosted image is
//        removed from the image repo (git rm + push), the draft is To review again; its store item stays used. A post
//        already scheduled in Metricool needs --metricool-deleted (the person deleted it in Metricool first); the old
//        Metricool id stays in the draft's history (status.json reverted[]) and the reconcile step ignores it.
import fs from 'node:fs';
import path from 'node:path';
import { main, out, isMain, withLock, parseArgs, need, settings, loadBrand, stamp, findDraft, setStatus, readJson, writeJson } from './lib.mjs';
import { checkDraft } from './draft-lib.mjs';
import { writeBack } from './writeback.mjs';
import { postsCatalogFile, postsArchiveDir, postFolder } from './posts.mjs';
import { hostAfterWriteback, remove as hostRemove } from './host-image.mjs';

export const APPROVER = 'user';

// One draft: check again, then write-back. Throws with the problems when a check fails (status check_failed).
export function finalize(id, by = APPROVER) {
  const { dir } = findDraft(id);
  return withLock(path.join(dir, 'finalize'), () => {
    const { draft, status } = findDraft(id);
    if (status.brand_post) return { id, status: 'approved', brand_post: status.brand_post, reused: true };
    if (status.status === 'rejected') throw new Error(`Bản nháp ${id} đã bỏ.`);
    if (!['ready', 'check_failed', 'approved'].includes(status.status)) throw new Error(`Bản nháp ${id} đang "${status.status}"; chạy draft.mjs check trước (cần "ready").`);
    const brand = loadBrand(draft.brand);
    const problems = [];
    if (draft.image_mode === 'scene-swap' && brand.social.product_images?.reference_redraw?.enabled !== true) problems.push('thương hiệu đã tắt product_images.reference_redraw: không dùng bản scene-swap');
    problems.push(...checkDraft(dir, { ...draft, brand_dir: brand.dir }, status).problems);
    for (const l of [...brand.languages, ...(brand.review_languages || [])]) if (!fs.existsSync(path.join(dir, `content-${l}.txt`))) problems.push(`thiếu content-${l}.txt`);
    if (problems.length) { setStatus(dir, 'check_failed', { problems: [...new Set(problems)] }); throw new Error(`Kiểm tra tự động không đạt: ${[...new Set(problems)].join('; ')}`); }
    setStatus(dir, 'approved', { by, note: '', approved: stamp(), problems: [] });
    return writeBack(id);
  });
}

// After a write-back the image goes to the image host; errors land in image_host and never undo the write-back.
export async function withHost(r, s = settings()) {
  const host = await hostAfterWriteback(r, s);
  return host ? { ...r, image_host: host } : r;
}

// The given drafts (each approved by a person), one after another; a failure stops only that draft.
export async function finalizeAll({ id = '' }, s = settings()) {
  if (!id) throw new Error('Approve one post at a time: --id <draft> (Posts tab, Preview, Approve).');
  const ids = [id];
  const results = [];
  for (const x of ids) {
    try { results.push({ ok: true, ...(await withHost(finalize(x), s)) }); } catch (e) { results.push({ ok: false, id: x, error: e.message }); }
  }
  return { results, done: results.filter((r) => r.ok).map((r) => r.id), failed: results.filter((r) => !r.ok).map((r) => r.id), next: 'Lượt Create & publish sau: node scripts/metricool-mcp.mjs payload --brand <id> (hẹn giờ thật trên Metricool)' };
}

// "Bỏ" before the draft reaches the brand folder (optional; nothing waits for it).
export function cancel({ id, note = '', by = 'user' }) {
  const { dir } = findDraft(id);
  return withLock(path.join(dir, 'finalize'), () => {
    const { status } = findDraft(id);
    if (status.brand_post) throw new Error(`Bản nháp ${id} đã ghi vào thương hiệu (${status.brand_post.id}); nếu đã gửi Metricool thì xoá nháp trong Metricool.`);
    if (status.status === 'rejected') throw new Error(`Bản nháp ${id} đã bỏ rồi.`);
    return { id, status: setStatus(dir, 'rejected', { by: String(by || 'user').trim() || 'user', note: String(note || '').trim(), rejected: stamp() }).status };
  });
}

// Metricool posts of a catalog entry that are real scheduled posts (not an old Metricool draft): id, time, network.
export function scheduledIn(entry) {
  const mc = entry?.metricool && typeof entry.metricool === 'object' && !Array.isArray(entry.metricool) ? entry.metricool : {};
  return Object.entries(mc).filter(([, v]) => v && typeof v === 'object' && v.id && v.draft !== true)
    .map(([network, v]) => ({ network, id: String(v.id), publication: v.publication || entry.schedule?.publication || '', timezone: v.timezone || '', planner_url: v.planner_url || '' }));
}

// "Back to review": undo the approval of a Queued post. Posted (published) posts never go back.
export function backToReview({ id, metricoolDeleted = false, by = 'user' }, s = settings()) {
  const { dir } = findDraft(id);
  return withLock(path.join(dir, 'finalize'), () => {
    const { draft, status } = findDraft(id);
    const bp = status.brand_post;
    if (!bp?.id) throw new Error(`Bản nháp ${id} chưa được duyệt (không ở Queued): không có gì để đưa về To review.`);
    const brand = loadBrand(draft.brand, { allowDisabled: true });
    const catalogFile = postsCatalogFile(brand.id);
    const entry = (readJson(catalogFile, { posts: [] }).posts || []).find((p) => p.id === bp.id);
    if (entry && entry.source !== `social-autopilot ${draft.id}`) throw new Error(`${bp.id} trong catalog không phải bài tool ghi cho ${draft.id}: không đụng tới.`);
    if (entry && (entry.status === 'published' || Object.values(entry.metricool || {}).some((v) => v && (v.published || v.status === 'published')))) throw new Error(`${bp.id} đã đăng (Posted): không đưa về To review.`);
    const scheduled = scheduledIn(entry);
    if (scheduled.length && !metricoolDeleted) {
      const e = new Error(`${bp.id} đã hẹn giờ trên Metricool (${scheduled.map((m) => `${m.network} id ${m.id}${m.publication ? `, ${String(m.publication).slice(0, 16).replace('T', ' ')}` : ''}`).join('; ')}). Xoá bài đó trong Metricool trước, rồi chạy lại với --metricool-deleted.`);
      e.code = 'METRICOOL_SCHEDULED';
      throw e;
    }
    // 1. Hosted image/video out of the image repo (git rm + push), like host-image.mjs remove.
    let host = null;
    if (entry) {
      const hosted = [entry.media_url, entry.video_url, entry.thumbnail_url].flat().filter(Boolean).length > 0;
      try { host = hostRemove({ brand: brand.id, post: bp.id, force: true }, s); }
      catch (err) { if (hosted) throw new Error(`Gỡ ảnh khỏi repo ảnh lỗi (chưa đổi gì trong catalog): ${err.message}`); host = { removed: false, skipped: err.message }; }
    }
    // 2. Register entry + post folder into workspace/posts/<brand>/archive/ (never deleted; the number is not used again).
    const at = stamp();
    const archive = path.join(postsArchiveDir(brand.id), `${bp.id}-${at.replace(/[:.]/g, '-')}`);
    fs.mkdirSync(archive, { recursive: true });
    withLock(catalogFile, () => {
      const catalog = readJson(catalogFile, { posts: [] });
      const cur = (catalog.posts || []).find((p) => p.id === bp.id);
      if (cur) {
        writeJson(path.join(archive, 'entry.json'), { ...cur, reverted: { at, by, draft: draft.id } });
        catalog.posts = catalog.posts.filter((p) => p.id !== bp.id);
        writeJson(catalogFile, catalog);
      }
    });
    const folder = entry?.folder ? postFolder(brand.id, entry) : bp.folder;
    if (folder && fs.existsSync(folder)) fs.renameSync(folder, path.join(archive, path.basename(folder)));
    // 3. The draft is To review again; the old post id, Metricool ids and hosted links stay in its history.
    const file = path.join(dir, 'status.json');
    const next = withLock(file, () => {
      const cur = readJson(file, {});
      const { brand_post, image_host, approved, by: _by, note: _note, ...rest } = cur;
      const history = [...(cur.reverted || []), { at, by, post: bp.id, archive, metricool: entry?.metricool || null, schedule: entry?.schedule || null, media_url: entry?.media_url || null, metricool_deleted: scheduled.length ? true : undefined }];
      const v = { ...rest, status: 'ready', tool_status: 'ready', reverted: history, problems: [], error: '', updated: at };
      writeJson(file, v);
      return v;
    });
    return { id, status: next.status, post: bp.id, archive, host, metricool_ignored: scheduled.map((m) => m.id) };
  });
}

// Metricool ids of posts sent back to review (drafts' status.json reverted[]): the reconcile step ignores them.
export function revertedIds(drafts) {
  const ids = [];
  for (const d of drafts) for (const r of d.status?.reverted || []) for (const v of Object.values(r.metricool || {})) if (v?.id) ids.push(String(v.id));
  return [...new Set(ids)];
}

if (isMain(import.meta.url)) main(async () => {
  const args = parseArgs();
  const cmd = args._[0];
  if (cmd === 'approve' || cmd === 'run') {
    if (args.brand) throw new Error('No bulk approval: a person approves each post (--id <draft>, or the Posts tab).');
    return out(await finalizeAll({ id: args.id && args.id !== true ? String(args.id) : '' }));
  }
  if (cmd === 'unapprove' || cmd === 'back-to-review') return out(backToReview({ id: need(args, 'id'), metricoolDeleted: args['metricool-deleted'] === true }));
  if (cmd === 'cancel') return out(cancel({ id: need(args, 'id'), note: args.note === true ? '' : args.note, by: args.by === true ? '' : args.by }));
  throw new Error('Lệnh: approve --id <draft> | cancel --id <draft> | unapprove --id <draft> [--metricool-deleted]');
});
