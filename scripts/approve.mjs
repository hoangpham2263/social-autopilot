// Step 4: approval (in chat; nothing is published). A draft is approved only when it is in awaiting_approval, passes
// every check again (image, a caption per language of social.json, the brand's footer/hashtag rules, no copied words)
// and the approver is the brand's approval.owner (social.json). Then writeback.mjs writes it into the brand folder.
// Reject needs a note. A person may also set "status": "approved"|"rejected" with "by" (and "note") in the draft's
// status.json by hand; sync applies those with the same rules.
//   node scripts/approve.mjs approve --id <draft> --by <name> [--note ..]
//   node scripts/approve.mjs reject  --id <draft> --by <name> --note <why>
//   node scripts/approve.mjs sync      apply status.json files a person edited by hand ("approved"/"rejected" + "by")
import fs from 'node:fs';
import path from 'node:path';
import { main, out, isMain, withLock, parseArgs, need, settings, loadBrand, readJson, writeJson, today, stamp, findDraft, setStatus, listDrafts } from './lib.mjs';
import { checkDraft } from './draft-lib.mjs';
import { writeBack } from './writeback.mjs';

const owners = (brand) => [].concat(brand.social.approval?.owner || []).map((o) => String(o).trim().toLowerCase()).filter(Boolean);

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
  const allowed = owners(brand);
  if (!by) throw new Error('Thiếu người duyệt (--by).');
  if (s.approval.require_owner_match && !allowed.includes(String(by).trim().toLowerCase())) throw new Error(`"${by}" không phải người duyệt của ${brand.brand} (social.json approval.owner: ${allowed.join(', ') || 'chưa khai'}).`);
  if (draft.image_mode === 'scene-swap' && brand.social.product_images?.reference_redraw?.enabled !== true) throw new Error('Thương hiệu đã tắt product_images.reference_redraw: không duyệt bản scene-swap.');
  const draftNow = { ...draft, brand_dir: brand.dir };
  const { problems } = checkDraft(dir, draftNow, status);
  if (s.approval.require_image && !fs.existsSync(path.join(dir, 'image.png'))) problems.push('chưa có image.png');
  if (s.approval.require_all_captions) for (const l of brand.languages) if (!fs.existsSync(path.join(dir, `content-${l}.txt`))) problems.push(`thiếu content-${l}.txt`);
  if (problems.length) { setStatus(dir, 'needs_caption', { problems }); throw new Error(`Chưa duyệt được: ${[...new Set(problems)].join('; ')}`); }

  setStatus(dir, 'approved', { by, note, approved: stamp(), problems: [] });
  return writeBack(id);
}

export function reject({ id, by, note, s = settings() }) {
  const { dir, status } = findDraft(id);
  if (status.brand_post) throw new Error(`Bản nháp ${id} đã duyệt và ghi vào thương hiệu; không từ chối được ở đây.`);
  if (s.approval.reject_requires_note && !String(note || '').trim()) throw new Error('Từ chối cần --note (lý do, để lần sau làm khác).');
  return { id, status: setStatus(dir, 'rejected', { by: by || '', note: note || '', rejected: stamp() }).status };
}

// status.json files a person edited by hand ("approved"/"rejected" + "by"), applied with the same rules.
export function sync(s = settings()) {
    const results = [];
    for (const d of listDrafts()) {
      if (d.status.brand_post) continue;
      try {
        if (d.status.status === 'approved') results.push(approve({ id: d.id, by: d.status.by, note: d.status.note || '', s, fromFile: true }));
        else if (d.status.status === 'rejected' && !d.status.rejected) results.push(reject({ id: d.id, by: d.status.by, note: d.status.note, s }));
      } catch (e) {
        // A hand-set "approved" that fails the rules goes back to waiting, with the reason.
        if (d.status.status === 'approved') setStatus(d.dir, 'awaiting_approval', { error: e.message });
        results.push({ id: d.id, ok: false, error: e.message });
      }
    }
    return { results };
}

if (isMain(import.meta.url)) main(() => {
  const args = parseArgs();
  const s = settings();
  const cmd = args._[0];
  if (cmd === 'approve') return out(approve({ id: need(args, 'id'), by: need(args, 'by'), note: args.note ? String(args.note) : '', s }));
  if (cmd === 'reject') return out(reject({ id: need(args, 'id'), by: args.by ? String(args.by) : '', note: args.note === true ? '' : args.note, s }));
  if (cmd === 'sync') return out(sync(s));
  throw new Error('Lệnh: approve | reject | sync');
});
