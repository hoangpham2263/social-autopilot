// Mode "Tạo bài từ kho", step 1: ideas. Ideas come only from the brand's STORE (workspace/store/<brand>/, filled by
// mode "Chỉ nghiên cứu"); no browsing. Library items are not used up (user, 10/11/2026): init takes fresh items (never
// used) first, then the least-used items whose cooldown is over (settings ideas.reuse_cooldown_days, default 7); never a
// removed item, never an item that already has an open idea. A reused item must get a NEW angle: the idea
// batch lists its previous uses, and set/pick (scene) and draft.mjs new (scene + product + sign_text) reject a repeat
// (store.mjs reuseProblems: a different scene AND a different product or sign_text). Each idea is ABSTRACT (product type, scene, angle, caption structure)
// for the brand's own product; never the competitor's image, words, logo or shop name (prompts/idea-abstract.md).
// Ideas live in workspace/store/<brand>/ideas.json (ids I001, I002, ... per brand).
//   node scripts/ideas.mjs init   --brand <id> [--count N] [--items S0001,S0002] [--source <sid>]
//                                 N store items (default: what the plan-ahead window still needs: settings
//                                 planning.ahead_days x cadence.posts_per_day, minus posts already approved and not yet
//                                 published and drafts still in work; fresh first, newest first, sources mixed; then reuse)
//                                 --items: exactly these items (a used item is allowed even within the cooldown, with a
//                                 note; a removed item is an error)
//   node scripts/ideas.mjs set    --brand <id> --id I001 --json '{...}' | --file f   fill an idea; checked for copying
//   node scripts/ideas.mjs pick   --brand <id> --id I001              mark for drafting
//   node scripts/ideas.mjs reject --brand <id> --id I001 [--note ..] [--item rejected]   idea dropped; the store item
//                                 stays available (or "rejected" with --item rejected)
//   node scripts/ideas.mjs list   --brand <id> [--status s]
import path from 'node:path';
import { main, out, isMain, parseArgs, need, loadBrand, readJson, writeJson, withLock, stamp, sharedWords, cleanText, settings, listDrafts } from './lib.mjs';
import { postsPerDay } from './metricool-csv.mjs';

// How many new posts the brand still needs to cover the next planning.ahead_days days (default 7) at posts_per_day:
// posts approved but not published, and drafts still being made or waiting for review, already count.
export function postsNeeded(brand, s = settings()) {
  const days = Number.isInteger(s.planning?.ahead_days) && s.planning.ahead_days > 0 ? s.planning.ahead_days : 7;
  const want = days * postsPerDay(brand.social.cadence || {});
  const published = (d) => { const bp = d.status.brand_post; if (!bp) return false; try { return readJson(bp.catalog, { posts: [] }).posts.find((p) => p.id === bp.id)?.status === 'published'; } catch { return false; } };
  const covered = listDrafts(brand.id).filter((d) => d.status.status !== 'rejected' && !['check_failed', 'image_failed'].includes(d.status.status) && !published(d)).length;
  return { days, want, covered, need: Math.max(0, want - covered) };
}
import { readStore, storeDir, storeIdeasFile, setItemStatus, pickItems, fairOrder, availability, reuseProblems, previousUses, usesOf, reuseCooldownDays } from './store.mjs';
// Shown with every reused item in the idea batch.
export const REUSE_RULE = 'This library item was used before (previous_uses): keep only the inspiration and take a NEW angle: a different scene AND a different product or sign_text than every previous use. A repeat is rejected.';
const OPEN = ['todo', 'ready', 'picked'];

// product_size (real size, from the skill's size_source), size_compare (the object it is measured against, with its real
// size) and sign_text (custom-text products) are optional here and
// can be given to draft.mjs new as --size / --compare / --sign-text.
const IDEA_FIELDS = ['product_type', 'scene', 'angle', 'props', 'caption_structure', 'hook', 'why', 'product_size', 'size_compare', 'sign_text'];
const CORE = ['product_type', 'scene', 'angle', 'caption_structure'];

// Words or marks taken from the reference: 6 words in a row, phone numbers, links, the shop's name.
export function copyProblems(idea, item) {
  const text = IDEA_FIELDS.map((f) => idea[f] || '').join('\n');
  const problems = [];
  const hits = sharedWords(text, item?.caption || '');
  if (hits.length) problems.push(`chép chữ của bài tham khảo: "${hits[0]}"`);
  if (/(\+?\d[\d .-]{7,}\d)/.test(text)) problems.push('có số điện thoại');
  if (/https?:\/\/|www\.|\.vn\b|\.com\b/i.test(text)) problems.push('có link');
  if (item?.store && item.store.length > 3 && text.toLowerCase().includes(item.store.toLowerCase())) problems.push(`có tên shop "${item.store}"`);
  return problems;
}

// Never-used store items in a fair order: newest first within each source, sources taken in turn.
export const pickNew = (items, n, source = '') => fairOrder(items.filter((x) => x.status === 'new' && !usesOf(x).length && (!source || x.source_id === source)), n);

if (isMain(import.meta.url)) main(() => {
  const args = parseArgs();
  const brand = loadBrand(need(args, 'brand'));
  const file = storeIdeasFile(brand.id);
  return withLock(file, () => run(args, args._[0], brand, file));
});

function run(args, cmd, brand, file) {
  const store = readStore(brand.id);
  const itemOf = (idea) => store.items.find((x) => x.id === idea.item);
  const data = readJson(file, { brand: brand.id, next: 0, ideas: [] });
  const save = () => writeJson(file, data);
  const find = () => { const id = need(args, 'id'); const i = data.ideas.find((x) => x.id === id); if (!i) throw new Error(`Không có ý ${id}.`); return i; };

  if (cmd === 'init') {
    if (!store.items.length) throw new Error(`Kho ${brand.id} trống: chạy chế độ "Chỉ nghiên cứu" (research.mjs) trước.`);
    let chosen;
    const notes = [];
    const openIdea = (itemId) => data.ideas.find((i) => i.item === itemId && OPEN.includes(i.status));
    const cooldown = reuseCooldownDays();
    if (args.items && args.items !== true) {
      chosen = [];
      for (const id of [...new Set(String(args.items).split(',').map((x) => x.trim()).filter(Boolean))]) {
        const it = store.items.find((x) => x.id === id);
        if (!it) throw new Error(`Kho ${brand.id} không có ${id}.`);
        if (it.status !== 'new') throw new Error(`${id} is removed${it.note ? ' (' + it.note + ')' : ''}: restore it in the Library first (store.mjs restore) or pick another item.`);
        const open = openIdea(id);
        if (open) { notes.push(`${id} already has open idea ${open.id} (${open.status}): fill that one (no second idea made).`); continue; }
        if (usesOf(it).length && availability([it], { cooldownDays: cooldown }).cooling.length) notes.push(`${id} was used ${usesOf(it).length}x, last ${String(it.last_used).slice(0, 10)} (within the ${cooldown}-day cooldown): allowed because you picked it; take a new angle.`);
        chosen.push(it);
      }
    } else {
      const n = Number(args.count) > 0 ? Number(args.count) : postsNeeded(brand).need;
      if (!n) return out({ brand: brand.id, added: [], note: `The next ${postsNeeded(brand).days} days are already covered: no new posts needed.` });
      const busy = new Set(data.ideas.filter((i) => OPEN.includes(i.status)).map((i) => i.item));
      chosen = pickItems(store.items, n, { source: args.source && args.source !== true ? String(args.source) : '', busy, cooldownDays: cooldown });
    }
    const added = [];
    for (const it of chosen) {
      const id = `I${String(++data.next).padStart(3, '0')}`;
      data.ideas.push({ id, item: it.id, source: it.source_id, ref_image: path.join(storeDir(brand.id), it.images[0]), post_url: it.post_url, status: 'todo', created: stamp(), ...(usesOf(it).length ? { reuse: usesOf(it).length } : {}), ...Object.fromEntries(IDEA_FIELDS.map((f) => [f, ''])) });
      added.push(id);
    }
    save();
    // Left for the next batches: fresh items + used items past the cooldown, minus what this run (and open ideas) took.
    const taken = new Set([...chosen.map((x) => x.id), ...data.ideas.filter((i) => OPEN.includes(i.status)).map((i) => i.item)]);
    const a = availability(store.items.filter((x) => !taken.has(x.id)), { cooldownDays: cooldown });
    const left = a.fresh.length + a.reusable.length;
    // Library low: fewer fresh + reusable posts than twice what this run took -> run Research soon (also in the run log).
    const low = left < Math.max(1, chosen.length) * 2;
    const prev = Object.fromEntries(chosen.filter((x) => usesOf(x).length).map((x) => [x.id, previousUses(x)]));
    return out({ file, added, items: chosen.map((x) => x.id), total: data.ideas.length, store_new_left: a.fresh.length, store_ready_left: left,
      ...(Object.keys(prev).length ? { previous_uses: prev, reuse_rule: REUSE_RULE } : {}), ...(notes.length ? { notes } : {}),
      ...(low ? { warning: `Library low: ${left} available posts ready (${a.fresh.length} never used, ${a.reusable.length} reusable after the ${cooldown}-day cooldown); run Research.` } : {}),
      next: added.length ? 'Điền từng ý theo prompts/idea-abstract.md bằng ideas.mjs set.' : 'Kho không còn bài Available dùng được (chưa dùng hoặc hết cooldown): chạy chế độ "Chỉ nghiên cứu" để lấy thêm.' });
  }
  if (cmd === 'set') {
    const idea = find();
    const patch = args.file ? readJson(path.resolve(String(args.file))) : JSON.parse(need(args, 'json'));
    for (const f of IDEA_FIELDS) if (patch[f] !== undefined) idea[f] = cleanText(patch[f]).text;
    const problems = [...copyProblems(idea, itemOf(idea)), ...reuseProblems(itemOf(idea), { scene: idea.scene, idea: idea.id })];
    const missing = CORE.filter((f) => !idea[f]);
    idea.problems = problems;
    if (!['picked', 'rejected', 'drafted'].includes(idea.status)) idea.status = problems.length || missing.length ? 'todo' : 'ready';
    idea.updated = stamp();
    save();
    return out({ idea, missing, problems });
  }
  if (cmd === 'pick' || cmd === 'reject') {
    const idea = find();
    if (cmd === 'pick') {
      const problems = [...copyProblems(idea, itemOf(idea)), ...reuseProblems(itemOf(idea), { scene: idea.scene, idea: idea.id })];
      const missing = CORE.filter((f) => !idea[f]);
      if (problems.length || missing.length) throw new Error(`Ý ${idea.id} chưa chọn được: ${[...missing.map((m) => 'thiếu ' + m), ...problems].join('; ')}`);
    }
    idea.status = cmd === 'pick' ? 'picked' : 'rejected';
    if (args.note && args.note !== true) idea.note = String(args.note);
    idea.updated = stamp();
    save();
    if (cmd === 'reject' && args.item === 'rejected' && itemOf(idea)?.status !== 'rejected') setItemStatus(brand.id, idea.item, 'rejected', { note: idea.note || `ý ${idea.id} bị bỏ` });
    return out({ idea });
  }
  if (cmd === 'list') {
    const list = data.ideas.filter((i) => !args.status || i.status === args.status);
    return out({ file, ideas: list.map(({ id, item, status, product_type, scene, angle, caption_structure, drafts }) => ({ id, item, status, product_type, scene, angle, caption_structure, drafts: drafts || [] })) });
  }
  throw new Error('Lệnh: init | set | pick | reject | list');
}
