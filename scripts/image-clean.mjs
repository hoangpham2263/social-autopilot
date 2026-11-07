// Image cleaning with the remove-watermark skill (C:\hoangpq\remove-watermark-skill, path in config/settings.json
// remove_watermark.script): a copy of the AI image without metadata chunks (C2PA caBX, EXIF, XMP, text), pixels byte for
// byte the same. Runs right after Codex (draft.mjs image), after a watermark overlay, and again before writeback.
// Rules of that skill (references/rules.md): metadata only, the original kept, no fake EXIF, local only, and never a
// claim that AI detection was bypassed. Removing metadata changes nothing about disclosure: the catalog keeps
// ai_disclosure and the brand's ai_disclosure_label.
// Draft folder: image-generated.png (Codex output, never written again) [-> image-watermarked.png] -> image.png (the post
// image) + image-clean-report.json (the skill's report).
//   node scripts/image-clean.mjs --id <draft>          clean again (idempotent: skipped when image.png is already the clean output)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { main, out, isMain, parseArgs, need, settings, readJson, findDraft, setStatus, stamp } from './lib.mjs';

// Chunks that draw the picture (the skill's KEEP list); anything else left in the output is metadata.
const PICTURE = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'iCCP', 'sRGB', 'gAMA', 'cHRM', 'sBIT', 'cICP', 'mDCV', 'cLLI']);
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export const REPORT = 'image-clean-report.json';

// Which AI made the image -> the skill's provider notes (references/providers/<provider>.md). Codex/GPT images are
// "chatgpt"; other generators get a provider here once the skill has notes for them (references/providers/README.md).
export function providerFor(generator, s = settings()) {
  const provider = (s.remove_watermark?.providers || {})[generator];
  if (!provider) throw new Error(`remove-watermark-skill chưa có provider cho ảnh "${generator}" (settings remove_watermark.providers).`);
  const notes = path.join(path.dirname(path.dirname(scriptPath(s))), 'references', 'providers', `${provider}.md`);
  if (!fs.existsSync(notes)) throw new Error(`remove-watermark-skill chưa hỗ trợ provider "${provider}" (thiếu ${notes}); không đoán cách xử lý.`);
  return { provider, notes };
}
const scriptPath = (s = settings()) => path.resolve(process.env.SA_STRIP_SCRIPT || s.remove_watermark?.script || '');

// The source of image.png: the watermark overlay when one was applied, else the Codex output.
const sourceOf = (dir, status) => path.join(dir, status.watermark && fs.existsSync(path.join(dir, 'image-watermarked.png')) ? 'image-watermarked.png' : 'image-generated.png');

// Is image.png exactly the clean output of its source, with no metadata left and the same pixels? [] = yes.
export function cleanProblems(dir, status = readJson(path.join(dir, 'status.json'), {})) {
  const image = path.join(dir, 'image.png'), reportFile = path.join(dir, REPORT);
  if (!fs.existsSync(path.join(dir, 'image-generated.png'))) return ['thiếu image-generated.png (ảnh gốc của Codex)'];
  if (!fs.existsSync(image)) return ['chưa có image.png'];
  if (!fs.existsSync(reportFile)) return ['chưa làm sạch metadata (image-clean.mjs)'];
  const r = readJson(reportFile);
  const problems = [];
  if (r.imageDataIdentical !== true) problems.push('report làm sạch: điểm ảnh bị đổi');
  const left = [].concat(r.outputChunks || []).filter((c) => !PICTURE.has(c));
  if (left.length) problems.push(`report làm sạch: ảnh còn chunk metadata ${left.join(', ')}`);
  if (r.outputHash !== sha256(image)) problems.push('image.png đã đổi sau khi làm sạch (chạy lại image-clean.mjs)');
  if (r.sourceHash !== sha256(sourceOf(dir, status))) problems.push('report làm sạch không khớp ảnh nguồn hiện tại');
  return problems;
}

export function cleanDraftImage(dir, { generator = 'codex', force = false } = {}, s = settings()) {
  const status = readJson(path.join(dir, 'status.json'), {});
  if (!force && !cleanProblems(dir, status).length) return { skipped: true, image: path.join(dir, 'image.png'), report: readJson(path.join(dir, REPORT)) };
  const script = scriptPath(s);
  if (!fs.existsSync(script)) throw new Error(`Không thấy script của remove-watermark-skill: ${script} (settings remove_watermark.script).`);
  const { provider } = providerFor(generator, s);
  const source = sourceOf(dir, status);
  if (!fs.existsSync(source)) throw new Error(`Thiếu ${path.basename(source)}.`);
  const tmp = path.join(dir, `image.clean.${process.pid}.png`);
  const r = spawnSync(process.execPath, [script, '--in', source, '--out', tmp, '--report', path.join(dir, REPORT)], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0 || !fs.existsSync(tmp)) { fs.rmSync(tmp, { force: true }); throw new Error(`remove-watermark-skill dừng: ${(r.stderr || r.stdout || '').trim().split('\n').pop()}. Giữ ảnh gốc.`); }
  fs.renameSync(tmp, path.join(dir, 'image.png'));
  const report = readJson(path.join(dir, REPORT));
  const problems = cleanProblems(dir, status);
  setStatus(dir, status.status || 'needs_caption', { metadata_clean: { at: stamp(), provider, source: path.basename(source), removed: report.removedChunks, pixels_identical: report.imageDataIdentical === true, problems } });
  if (problems.length) throw new Error(`Làm sạch chưa đạt: ${problems.join('; ')}`);
  // Only what the report says: metadata chunks removed. Not a claim that an AI label or detector is bypassed.
  return { image: path.join(dir, 'image.png'), original: path.join(dir, 'image-generated.png'), provider, removed: report.removedChunks, pixels_identical: true, note: 'Chỉ bỏ metadata; ảnh vẫn là ảnh AI và vẫn khai báo AI.' };
}

if (isMain(import.meta.url)) main(() => {
  const args = parseArgs();
  const { dir } = findDraft(need(args, 'id'));
  out(cleanDraftImage(dir, { force: !!args.force }));
});
