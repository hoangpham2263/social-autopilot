// Step 2: ideas. Each reference post becomes an ABSTRACT idea (product type, scene, angle, caption structure) the brand
// can make with its own product; never the competitor's image, words, logo or shop name (prompts/idea-abstract.md).
//   node scripts/ideas.mjs init   --brand <id> [--date d]          ideas.json with one empty idea per reference (keeps filled ones)
//   node scripts/ideas.mjs set    --brand <id> --id I01 --json '{...}' | --file f   fill an idea; checked for copying
//   node scripts/ideas.mjs pick   --brand <id> --id I01              mark for drafting
//   node scripts/ideas.mjs reject --brand <id> --id I01 [--note ..]
//   node scripts/ideas.mjs list   --brand <id> [--date d] [--status s]
import fs from 'node:fs';
import path from 'node:path';
import { main, out, parseArgs, need, loadBrand, runDir, latestRun, loadRefs, readJson, writeJson, stamp, sharedWords, cleanText } from './lib.mjs';

const IDEA_FIELDS = ['product_type', 'scene', 'angle', 'props', 'caption_structure', 'hook', 'why'];
const CORE = ['product_type', 'scene', 'angle', 'caption_structure'];

function open(args) {
  const brand = loadBrand(need(args, 'brand'));
  const date = args.date ? String(args.date) : latestRun(brand.id);
  if (!date) throw new Error('Chưa có lượt nghiên cứu nào cho ' + brand.id);
  const dir = runDir(brand.id, date);
  return { brand, date, dir, file: path.join(dir, 'ideas.json') };
}

// Words or marks taken from the reference: 6 words in a row, phone numbers, links, the shop's name.
function copyProblems(idea, ref) {
  const text = IDEA_FIELDS.map((f) => idea[f] || '').join('\n');
  const problems = [];
  const hits = sharedWords(text, ref?.caption || '');
  if (hits.length) problems.push(`chép chữ của bài tham khảo: "${hits[0]}"`);
  if (/(\+?\d[\d .-]{7,}\d)/.test(text)) problems.push('có số điện thoại');
  if (/https?:\/\/|www\.|\.vn\b|\.com\b/i.test(text)) problems.push('có link');
  if (ref?.store && ref.store.length > 3 && text.toLowerCase().includes(ref.store.toLowerCase())) problems.push(`có tên shop "${ref.store}"`);
  return problems;
}

main(() => {
  const args = parseArgs();
  const cmd = args._[0];
  const { brand, date, dir, file } = open(args);
  const refs = loadRefs(brand.id, date);
  const data = readJson(file, { brand: brand.id, date, ideas: [] });
  const save = () => writeJson(file, data);
  const find = () => { const id = need(args, 'id'); const i = data.ideas.find((x) => x.id === id); if (!i) throw new Error(`Không có ý ${id}.`); return i; };

  if (cmd === 'init') {
    if (!refs.length) throw new Error('Chưa có refs.json nào trong các source: chạy research.mjs ingest trước.');
    let added = 0;
    for (const r of refs) {
      if (data.ideas.some((i) => i.ref === r.key)) continue;
      data.ideas.push({ id: `I${String(data.ideas.length + 1).padStart(2, '0')}`, ref: r.key, source: r.source, ref_image: r.image, status: 'todo', ...Object.fromEntries(IDEA_FIELDS.map((f) => [f, ''])) });
      added++;
    }
    save();
    return out({ file, added, total: data.ideas.length, next: 'Điền từng ý theo prompts/idea-abstract.md bằng ideas.mjs set.' });
  }
  if (cmd === 'set') {
    const idea = find();
    const patch = args.file ? readJson(path.resolve(String(args.file))) : JSON.parse(need(args, 'json'));
    for (const f of IDEA_FIELDS) if (patch[f] !== undefined) idea[f] = cleanText(patch[f]).text;
    const problems = copyProblems(idea, refs.find((r) => r.key === idea.ref));
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
      const problems = copyProblems(idea, refs.find((r) => r.key === idea.ref));
      const missing = CORE.filter((f) => !idea[f]);
      if (problems.length || missing.length) throw new Error(`Ý ${idea.id} chưa chọn được: ${[...missing.map((m) => 'thiếu ' + m), ...problems].join('; ')}`);
    }
    idea.status = cmd === 'pick' ? 'picked' : 'rejected';
    if (args.note) idea.note = String(args.note);
    idea.updated = stamp();
    save();
    return out({ idea });
  }
  if (cmd === 'list') {
    const list = data.ideas.filter((i) => !args.status || i.status === args.status);
    return out({ file, date, ideas: list.map(({ id, ref, status, product_type, scene, angle, caption_structure }) => ({ id, ref: `${date}/${ref}`, status, product_type, scene, angle, caption_structure })) });
  }
  throw new Error('Lệnh: init | set | pick | reject | list');
});
