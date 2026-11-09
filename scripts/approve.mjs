// Step 4: approval (in chat or the app; nothing is published). A draft is approved only when it is in awaiting_approval
// and passes every check again (image, a caption per posted and reviewer-only language of social.json, the brand's
// footer/hashtag rules, no copied words, no AI label). There is no named approver: whoever approves in chat or the app
// approves; --by is optional free text for the log (default "user"). Then writeback.mjs writes it into the brand folder
// and the CLI hosts the post image (host-image.mjs publish -> media_url in the brand catalog).
// Reject needs a note (the reason, so the next draft is different) and a rejected draft is not rejected again. A person
// may also set "status": "approved"|"rejected" (+ "note") in the draft's status.json by hand; sync applies those with
// the same rules, and a hand-set status that fails them goes back to the status the tool last set.
//   node scripts/approve.mjs approve --id <draft> [--by <name>] [--note ..]
//   node scripts/approve.mjs reject  --id <draft> --note <why> [--by <name>]
//   node scripts/approve.mjs sync      apply status.json files a person edited by hand
import fs from 'node:fs';
import path from 'node:path';
import { main, out, isMain, withLock, parseArgs, need, settings, loadBrand, readJson, stamp, findDraft, setStatus, listDrafts } from './lib.mjs';
import { checkDraft } from './draft-lib.mjs';
import { writeBack } from './writeback.mjs';
import { hostAfterWriteback } from './host-image.mjs';

// Who approved/rejected, for the log only: free text, spaces tidied, default "user".
export const approver = (by) => String(by ?? '').normalize('NFC').replace(/\s+/g, ' ').trim() || 'user';

// One approval at a time per draft (UI button and chat agent at the same moment).
export function approve({ id, by, note = '', s = settings(), fromFile = false }) {
  const { dir } = findDraft(id);
  return withLock(path.join(dir, 'approve'), () => approveInner({ id, by, note, s, fromFile }));
}

function approveInner({ id, by, note, s, fromFile }) {
  const { dir, draft, status } = findDraft(id);
  if (status.brand_post) return { id, status: 'approved', brand_post: status.brand_post, reused: true };
  if (status.status !== 'awaiting_approval' && !(fromFile && status.status === 'approved')) throw new Error(`Bản nháp ${id} đang "${status.status}"; chỉ duyệt được bản awaiting_approval (chạy draft.mjs check trước).`);
  const brand = loadBrand(draft.brand);
  const who = approver(by);
  if (draft.image_mode === 'scene-swap' && brand.social.product_images?.reference_redraw?.enabled !== true) throw new Error('Thương hiệu đã tắt product_images.reference_redraw: không duyệt bản scene-swap.');
  const draftNow = { ...draft, brand_dir: brand.dir };
  const { problems } = checkDraft(dir, draftNow, status);
  if (s.approval.require_image && !fs.existsSync(path.join(dir, 'image.png'))) problems.push('chưa có image.png');
  if (s.approval.require_all_captions) for (const l of [...brand.languages, ...(brand.review_languages || [])]) if (!fs.existsSync(path.join(dir, `content-${l}.txt`))) problems.push(`thiếu content-${l}.txt`);
  if (problems.length) { setStatus(dir, 'needs_caption', { problems }); throw new Error(`Chưa duyệt được: ${[...new Set(problems)].join('; ')}`); }

  setStatus(dir, 'approved', { by: who, note, approved: stamp(), problems: [] });
  return writeBack(id);
}

// Reject: a note (the reason) is required, and a draft already rejected is not rejected again. fromFile = a hand-set "rejected" (sync).
export function reject({ id, by, note, s = settings(), fromFile = false }) {
  const { dir } = findDraft(id);
  return withLock(path.join(dir, 'approve'), () => {
    const { status } = findDraft(id);
    if (status.brand_post) throw new Error(`Bản nháp ${id} đã duyệt và ghi vào thương hiệu; không từ chối được ở đây.`);
    if (status.status === 'rejected' && !fromFile) throw new Error(`Bản nháp ${id} đã bị từ chối${status.rejected ? ` (${status.rejected})` : ''}; không từ chối lại.`);
    const who = approver(by);
    const why = String(note ?? '').trim();
    if (!why) throw new Error('Từ chối cần --note (lý do, để lần sau làm khác).');
    return { id, by: who, status: setStatus(dir, 'rejected', { by: who, note: why, rejected: stamp() }).status };
  });
}

// What sync applies: "approved" without a write-back yet (hand-set, or a write-back to retry), and a hand-set
// "rejected" (it differs from the last status the tool set, tool_status; older files: no rejected stamp).
const toApply = (st) => (st.status === 'approved' ? !st.brand_post : st.status === 'rejected' ? (st.tool_status ? st.tool_status !== 'rejected' : !st.rejected) : false);

// status.json files a person edited by hand ("approved"/"rejected" + "by"), applied with the same rules.
export function sync(s = settings()) {
    const results = [];
    for (const d of listDrafts()) {
      if (d.status.brand_post) continue;
      const set = d.status.status;
      if (!toApply(d.status)) continue;
      try {
        if (set === 'approved') results.push(approve({ id: d.id, by: d.status.by, note: d.status.note || '', s, fromFile: true }));
        else results.push(reject({ id: d.id, by: d.status.by, note: d.status.note, s, fromFile: true }));
      } catch (e) {
        // A hand-set "approved" or "rejected" that fails the rules is not kept: the draft goes back to the status the
        // tool last set (awaiting_approval for older files), with the reason. A status the tool set meanwhile (e.g.
        // needs_caption after failed checks) is left as it is.
        const now = readJson(path.join(d.dir, 'status.json'), {});
        if (now.status === set) setStatus(d.dir, d.status.tool_status && d.status.tool_status !== set ? d.status.tool_status : 'awaiting_approval', { error: e.message });
        results.push({ id: d.id, ok: false, error: e.message });
      }
    }
    return { results };
}

// After a write-back the CLI hosts the image (host-image.mjs publish); errors land in image_host, the approval stays.
// The result is also kept in the draft's status.json (image_host), so queue.mjs can report a host error later.
export async function withHost(r, s) {
  const host = await hostAfterWriteback(r, s);
  if (!host) return r;
  try { const { dir } = findDraft(r.id); setStatus(dir, 'approved', { image_host: { ok: host.ok, at: stamp(), ...(host.url ? { url: host.url } : {}), ...(host.ok ? {} : { error: host.error, next: host.next || '' }) } }); } catch {}
  return { ...r, image_host: host };
}

if (isMain(import.meta.url)) main(async () => {
  const args = parseArgs();
  const s = settings();
  const cmd = args._[0];
  if (cmd === 'approve') return out(await withHost(approve({ id: need(args, 'id'), by: args.by && args.by !== true ? String(args.by) : '', note: args.note ? String(args.note) : '', s }), s));
  if (cmd === 'reject') return out(reject({ id: need(args, 'id'), by: args.by && args.by !== true ? String(args.by) : '', note: args.note === true ? '' : args.note, s }));
  if (cmd === 'sync') { const r = sync(s); for (let i = 0; i < r.results.length; i++) if (r.results[i].brand_post) r.results[i] = await withHost(r.results[i], s); return out(r); }
  throw new Error('Lệnh: approve | reject | sync');
});
