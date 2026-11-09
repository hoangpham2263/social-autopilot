// Mode "Làm bài & đưa lên", after draft.mjs check: no human approval step (user, 09/11/2026). A draft that passed
// every automatic check (status "ready") is checked once more (image clean, captions per posted and reviewer-only
// language, the brand's footer/hashtag, no copied words, no AI label, NO LOGO prompt, scene-swap logo check), then
// written into the brand's skill folder (writeback.mjs: catalog entry "approved", approval.by "auto", the skill's
// check-post.mjs) and its image hosted (host-image.mjs -> media_url). A draft that fails stops there with its problems
// (status "check_failed"); the other drafts go on. Sending to Metricool is the next step (metricool-mcp.mjs payload).
//   node scripts/finalize.mjs run    --id <draft> | --brand <id>     every "ready" draft of the brand, one after another
//   node scripts/finalize.mjs cancel --id <draft> [--note ..]        "Bỏ": drop a draft before it is written into the brand
import fs from 'node:fs';
import path from 'node:path';
import { main, out, isMain, withLock, parseArgs, need, settings, loadBrand, stamp, findDraft, setStatus, listDrafts } from './lib.mjs';
import { checkDraft } from './draft-lib.mjs';
import { writeBack } from './writeback.mjs';
import { hostAfterWriteback } from './host-image.mjs';

export const AUTO = 'auto';

// One draft: check again, then write-back. Throws with the problems when a check fails (status check_failed).
export function finalize(id) {
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
    setStatus(dir, 'approved', { by: AUTO, note: '', approved: stamp(), problems: [] });
    return writeBack(id);
  });
}

// After a write-back the image goes to the image host; errors land in image_host and never undo the write-back.
export async function withHost(r, s = settings()) {
  const host = await hostAfterWriteback(r, s);
  return host ? { ...r, image_host: host } : r;
}

// Every given draft (or every "ready" draft of a brand), one after another; a failure stops only that draft.
export async function finalizeAll({ id = '', brand = '' }, s = settings()) {
  const ids = id ? [id] : listDrafts(brand).filter((d) => d.status.status === 'ready').map((d) => d.id);
  const results = [];
  for (const x of ids) {
    try { results.push({ ok: true, ...(await withHost(finalize(x), s)) }); } catch (e) { results.push({ ok: false, id: x, error: e.message }); }
  }
  return { results, done: results.filter((r) => r.ok).map((r) => r.id), failed: results.filter((r) => !r.ok).map((r) => r.id), next: 'node scripts/metricool-mcp.mjs payload --brand <id> (gửi Metricool, mặc định nháp)' };
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

if (isMain(import.meta.url)) main(async () => {
  const args = parseArgs();
  const cmd = args._[0];
  if (cmd === 'run') {
    if (!args.id && !args.brand) throw new Error('Thiếu --id hoặc --brand.');
    const r = await finalizeAll({ id: args.id && args.id !== true ? String(args.id) : '', brand: args.brand && args.brand !== true ? String(args.brand) : '' });
    return out(r);
  }
  if (cmd === 'cancel') return out(cancel({ id: need(args, 'id'), note: args.note === true ? '' : args.note, by: args.by === true ? '' : args.by }));
  throw new Error('Lệnh: run | cancel');
});
