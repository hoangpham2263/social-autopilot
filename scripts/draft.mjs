// Step 3: drafts. One folder per draft in workspace/drafts/<brand>/<id>/: draft.json (what it is), status.json (where it
// is), prompt.txt + codex.log + image.png (the brand's own image, made by Codex CLI from the brand's own product photo),
// brief.md and content-<lang>.txt (captions written by the agent in the brand voice, per social.json). Nothing here
// touches the brand folder; that happens only in approve.mjs.
//   node scripts/draft.mjs new   --brand <id> --idea <date>/<Ixx> --product <brand image> [--scene <mood image>]
//   node scripts/draft.mjs new   --brand <id> --idea <date>/<Ixx> --ref-image <workspace/runs/<brand>/.../refs/R01-….jpg>
//                                [--brand-can-produce]   scene-swap: opt-in per brand (product_images.reference_redraw)
//   node scripts/draft.mjs confirm-clean --id <draft> --by <name>   scene-swap: looked at image.png, no shop name/logo left
//   node scripts/draft.mjs image --id <draft> [--force]     runs Codex (prompt.txt must be finished: no {{...}} left)
//   node scripts/draft.mjs watermark --id <draft> [--force] logo overlay in a corner, only if social.json
//                                                           product_images.watermark.enabled (default off; needs ffmpeg)
//   node scripts/draft.mjs check --id <draft>               checks image + captions; ready -> awaiting_approval
//   node scripts/draft.mjs show  --id <draft>
//   node scripts/draft.mjs list  [--brand <id>] [--status s]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { checkDraft, summary, logoWarnings } from './draft-lib.mjs';
import { cleanDraftImage } from './image-clean.mjs';
import { main, out, isMain, parseArgs, need, settings, loadBrand, workspace, toolRoot, runDir, readJson, writeJson, today, stamp, inside, sha1, projectSection, projectField, findDraft, setStatus, withLock, loadRefs, listDrafts, draftsRoot, hasHidden, sharedWords } from './lib.mjs';

const IMAGE = /\.(png|jpe?g|webp)$/i;
// The brand's own photo: inside its skill folder, or inside a local folder its social.json lists in
// product_images.sources[].path (a local folder outside the skill, absolute or relative to the skill folder).
function ownImage(brand, file) {
  if (inside(brand.dir, file)) return true;
  return [].concat(brand.social.product_images?.sources || []).some((x) => x?.path && !/^https?:/i.test(x.path) && inside(path.resolve(brand.dir, x.path), file));
}
const fill = (tpl, map) => tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in map ? map[k] : m));

export function newDraft(args) {
  const brand = loadBrand(need(args, 'brand'));
  const [date, ideaId] = need(args, 'idea').split('/');
  const ideasFile = path.join(runDir(brand.id, date), 'ideas.json');
  const ideas = readJson(ideasFile);
  const idea = ideas.ideas.find((i) => i.id === ideaId);
  if (!idea) throw new Error(`Không có ý ${ideaId} trong ${ideasFile}.`);
  if (idea.status !== 'picked' && !(idea.status === 'drafted' && args.again)) throw new Error(`Ý ${ideaId} đang "${idea.status}"; chỉ ý đã pick mới làm nháp (--again để làm thêm bản).`);
  const refs = loadRefs(brand.id, date);
  const ref = refs.find((r) => r.key === idea.ref) || {};

  if (brand.social.product_images?.ai_scenes_allowed !== true) throw new Error('social.json product_images.ai_scenes_allowed khác true: thương hiệu chưa cho dựng cảnh bằng AI.');
  // Default ("brand-image"): the product photo is the brand's own (inside its skill folder or a product_images.sources
  // folder). Opt-in "scene-swap" (--ref-image): a research reference of this brand is the product photo and only the
  // scene changes; only when the brand's social.json has product_images.reference_redraw.enabled: true.
  let product, imageMode = 'brand-image', refUsed = ref;
  if (args['ref-image']) {
    const rr = brand.social.product_images?.reference_redraw || {};
    if (rr.enabled !== true) throw new Error('social.json product_images.reference_redraw.enabled khác true: thương hiệu chỉ dùng ảnh của chính mình (--product).');
    if (args.product) throw new Error('Dùng --product hoặc --ref-image, không cả hai.');
    product = path.resolve(String(args['ref-image']));
    if (!inside(path.join(workspace, 'runs', brand.id), product) || !fs.existsSync(product) || !IMAGE.test(product)) throw new Error(`--ref-image phải là ảnh tham khảo của chính thương hiệu này, trong ${path.join(workspace, 'runs', brand.id)}.`);
    const hash = sha1(fs.readFileSync(product));
    refUsed = refs.find((r) => r.image_sha1 === hash);
    if (!refUsed) throw new Error('--ref-image không phải một ảnh đã ingest của lượt này (refs.json).');
    if (rr.only_if_brand_can_produce !== false && !args['brand-can-produce']) throw new Error('reference_redraw.only_if_brand_can_produce: xác nhận thương hiệu làm được đúng sản phẩm này (project.md mục 5) bằng --brand-can-produce.');
    imageMode = 'scene-swap';
  } else {
    product = path.resolve(need(args, 'product'));
    if (!fs.existsSync(product) || !IMAGE.test(product)) throw new Error('Ảnh sản phẩm không có hoặc không phải PNG/JPEG/WebP.');
    if (!ownImage(brand, product)) throw new Error(`Ảnh sản phẩm phải là ảnh của thương hiệu: trong ${brand.dir} hoặc một thư mục product_images.sources[].path của social.json.`);
  }
  // The second image is only a mood reference, never a competitor's post (anything under workspace/runs/).
  let scene = '';
  if (args.scene) {
    scene = path.resolve(String(args.scene));
    if (!fs.existsSync(scene) || !IMAGE.test(scene)) throw new Error('Ảnh không khí không có hoặc không phải ảnh.');
    if (inside(path.join(workspace, 'runs'), scene)) throw new Error('Ảnh không khí không được là ảnh tham khảo của đối thủ (workspace/runs/).');
    const hash = sha1(fs.readFileSync(scene));
    if (refs.some((r) => r.image_sha1 === hash)) throw new Error('Ảnh không khí trùng một ảnh tham khảo của đối thủ.');
  }

  const day = today().replace(/-/g, '');
  const brandDrafts = path.join(draftsRoot, brand.id);
  fs.mkdirSync(brandDrafts, { recursive: true });
  const n = fs.readdirSync(brandDrafts).filter((d) => d.startsWith(`${brand.id}-${day}-`)).length + 1;
  const id = `${brand.id}-${day}-${String(n).padStart(2, '0')}`;
  const dir = path.join(brandDrafts, id);
  fs.mkdirSync(dir, { recursive: true });

  const mode = brand.social.language_policy?.mode || 'single';
  const networks = (brand.social.channels || []).filter((x) => x.enabled).map((x) => ({ network: x.network, account: x.account || '', url: x.url || '', lang: [].concat(x.lang || []) }));
  const draft = {
    id, brand: brand.id, brand_name: brand.brand, brand_dir: brand.dir, created: stamp(),
    idea: { run: date, id: idea.id, ...Object.fromEntries(['product_type', 'scene', 'angle', 'props', 'caption_structure', 'hook', 'why'].map((f) => [f, idea[f] || ''])) },
    inspiration: { run: date, ref: refUsed.key || idea.ref, source: refUsed.source || '', source_shop: refUsed.store || '', source_url: refUsed.source_url || '', post_url: refUsed.post_url || '' },
    image_mode: imageMode, ...(imageMode === 'scene-swap' ? { reference_image: product, require_logo_removal: brand.social.product_images.reference_redraw.require_logo_removal !== false } : {}),
    product_image: product, scene_image: scene, networks, languages: brand.languages, language_mode: mode,
    image: 'image.png', captions: Object.fromEntries(brand.languages.map((l) => [l, `content-${l}.txt`])), ai_disclosure: { tool: 'codex' },
  };
  writeJson(path.join(dir, 'draft.json'), draft);
  const second = scene
    ? 'The second attached image is ONLY a mood/lighting reference. Do not copy it and do not take any objects from it.'
    : 'There is no second image.';
  fs.writeFileSync(path.join(dir, 'prompt.txt'), fill(fs.readFileSync(path.join(toolRoot, 'prompts', imageMode === 'scene-swap' ? 'scene-swap.txt' : 'scene-edit.txt'), 'utf8'), {
    SOURCE_SHOP: refUsed.store || refUsed.source || 'the source shop',
    SCENE: idea.scene, ANGLE: idea.angle, PROPS: idea.props || 'at most one or two props that fit the scene',
    PRODUCT_RULES: projectSection(brand.project, 10) || '(project.md mục 10 trống)', SECOND_IMAGE: second, OUTPUT: 'image.png',
  }), 'utf8');
  fs.writeFileSync(path.join(dir, 'brief.md'), fill(fs.readFileSync(path.join(toolRoot, 'prompts', 'caption-brief.md'), 'utf8'), {
    BRAND: brand.brand, SKILL: path.join(brand.dir, 'SKILL.md'), PROJECT: path.join(brand.dir, 'project', 'project.md'),
    IDEA: JSON.stringify(draft.idea, null, 2), NETWORKS: networks.map((x) => `- ${x.network} (${x.account || 'chưa có account'}): ${x.lang.join(', ')}`).join('\n') + `\nlanguage_policy.mode: ${mode}${brand.social.language_policy?.note ? ` (${brand.social.language_policy.note})` : ''}`,
    SECTIONS: [].concat(brand.social.caption_rules?.project_md_sections || []).join('; ') || '1, 3, 7, 8, 10, 11',
    FILES: brand.languages.map((l) => `- content-${l}.txt`).join('\n'),
    WEBSITE: projectField(brand.project, 'Website') || '(chưa có)', HASHTAG: projectField(brand.project, 'Hashtag cố định') || '(chưa có)',
  }), 'utf8');
  withLock(ideasFile, () => {
    const now = readJson(ideasFile);
    const it = now.ideas.find((i) => i.id === idea.id);
    it.status = 'drafted'; it.drafts = [...new Set([...(it.drafts || []), id])]; it.updated = stamp();
    writeJson(ideasFile, now);
  });
  const status = setStatus(dir, 'needs_prompt', { image_mode: imageMode, ...(imageMode === 'scene-swap' ? { source_shop: draft.inspiration.source_shop, source_url: draft.inspiration.source_url } : {}) });
  return ({ id, dir, status: status.status, next: `Mở ${path.join(dir, 'prompt.txt')}, thay {{PRODUCT_DESCRIPTION}} bằng mô tả đúng sản phẩm trong ảnh, rồi chạy draft.mjs image --id ${id}. Viết caption theo brief.md.` });
}

function codexCommand(s) {
  const cmd = process.env.SA_CODEX || s.codex.command;
  if (/\.m?js$/i.test(cmd)) return { file: process.execPath, pre: [path.resolve(toolRoot, cmd)], shell: false };
  if (process.platform === 'win32' && !path.isAbsolute(cmd)) {
    try {
      const found = execFileSync('where', [cmd], { encoding: 'utf8' }).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const pick = found.find((f) => /\.(cmd|exe)$/i.test(f)) || found[0];
      return { file: pick, pre: [], shell: /\.cmd$/i.test(pick) };
    } catch { throw new Error('Không tìm thấy Codex CLI (codex). Cài và đăng nhập Codex trước.'); }
  }
  return { file: cmd, pre: [], shell: false };
}

export function image(args, s = settings()) {
  const { dir, draft } = findDraft(need(args, 'id'));
  const target = path.join(dir, 'image.png');
  if (fs.existsSync(target) && !args.force) return ({ id: draft.id, skipped: true, image: target, note: 'Đã có image.png (thêm --force để làm lại).' });
  const prompt = fs.readFileSync(path.join(dir, 'prompt.txt'), 'utf8');
  const left = prompt.match(/\{\{\w+\}\}/g);
  if (left) throw new Error(`prompt.txt còn chỗ chưa điền: ${[...new Set(left)].join(', ')}`);
  if (!fs.existsSync(draft.product_image)) throw new Error('Ảnh sản phẩm không còn.');
  const brandNow = loadBrand(draft.brand);
  if (draft.image_mode === 'scene-swap') {
    if (brandNow.social.product_images?.reference_redraw?.enabled !== true) throw new Error('Thương hiệu đã tắt reference_redraw: bản nháp scene-swap không tạo ảnh được.');
  } else if (!ownImage(brandNow, draft.product_image)) throw new Error('Ảnh sản phẩm không còn là ảnh của thương hiệu.');
  if (brandNow.social.product_images?.ai_scenes_allowed !== true) throw new Error('social.json product_images.ai_scenes_allowed khác true: không dựng cảnh AI.');
  // An earlier image is kept aside (image-old-<time>.png); the new Codex output becomes image-generated.png.
  if (args.force) for (const f of ['image-generated.png', 'image.png']) if (fs.existsSync(path.join(dir, f))) fs.renameSync(path.join(dir, f), path.join(dir, `image-old-${Date.now()}-${f}`));
  for (const f of ['image-watermarked.png', 'image-clean-report.json']) fs.rmSync(path.join(dir, f), { force: true });
  // codex exec --skip-git-repo-check -s workspace-write - -i <brand product image> [-i <scene ref>] < prompt.txt
  const codexArgs = ['exec', '--skip-git-repo-check', '-s', 'workspace-write', '-', '-i', draft.product_image, ...(draft.scene_image ? ['-i', draft.scene_image] : [])];
  const c = codexCommand(s);
  const q = (a) => (c.shell ? `"${a}"` : a);
  const before = new Set(fs.readdirSync(dir));
  setStatus(dir, 'generating');
  // A .cmd shim needs the shell; it gets one command string (no args array with shell: true, Node DEP0190).
  const r = c.shell
    ? spawnSync([c.file, ...c.pre, ...codexArgs].map(q).join(' '), { cwd: dir, input: prompt, encoding: 'utf8', shell: true, timeout: s.codex.timeout_minutes * 60000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
    : spawnSync(c.file, [...c.pre, ...codexArgs], { cwd: dir, input: prompt, encoding: 'utf8', timeout: s.codex.timeout_minutes * 60000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  fs.writeFileSync(path.join(dir, 'codex.log'), `$ codex ${codexArgs.join(' ')} < prompt.txt\n\n${r.stdout || ''}\n${r.stderr || ''}\n${r.error ? 'ERROR ' + r.error.message : ''}`, 'utf8');
  if (!fs.existsSync(target)) {
    // Codex sometimes names the file differently: take the one new PNG it saved.
    const fresh = fs.readdirSync(dir).filter((f) => !before.has(f) && /\.png$/i.test(f));
    if (fresh.length === 1) fs.renameSync(path.join(dir, fresh[0]), target);
  }
  if (!fs.existsSync(target)) {
    const quota = /usage limit|rate limit|quota|429/i.test(`${r.stdout}${r.stderr}`);
    setStatus(dir, 'image_failed', { error: quota ? 'Codex hết hạn mức ảnh' : `Codex không tạo được image.png (mã ${r.status})` });
    throw new Error(`${quota ? 'Codex hết hạn mức ảnh.' : 'Codex không tạo được image.png.'} Xem ${path.join(dir, 'codex.log')}`);
  }
  // Codex's file is the original (image-generated.png, never written again); image.png is the metadata-clean copy from
  // the remove-watermark skill. A new image drops an earlier watermark overlay and logo check.
  fs.renameSync(target, path.join(dir, 'image-generated.png'));
  setStatus(dir, 'needs_caption', { error: '', watermark: null, logo_check: null, metadata_clean: null });
  const cleaned = cleanDraftImage(dir, { generator: 'codex', force: true }, s);
  const st = readJson(path.join(dir, 'status.json'));
  return ({ id: draft.id, image: target, original: cleaned.original, metadata_removed: cleaned.removed, warnings: logoWarnings(prompt), status: st.status, next: `Xem ảnh; nếu đạt, viết caption theo brief.md rồi chạy draft.mjs check --id ${draft.id}.` });
}

// Optional post-processing, default off: the brand's logo as a small overlay in one corner of the finished image, never
// on the product. Only when the brand's social.json has product_images.watermark { enabled: true, position
// (top-left|top-right|bottom-left|bottom-right), opacity (0-1), file (logo inside the skill folder) }. The Codex image
// goes on image-generated.png into image-watermarked.png, then image.png is cleaned again from it. Needs ffmpeg
// (settings.ffmpeg.command).
export function watermark(args, s = settings()) {
  const { dir, draft, status } = findDraft(need(args, 'id'));
  const brand = loadBrand(draft.brand);
  const wm = brand.social.product_images?.watermark;
  if (!wm?.enabled) return { id: draft.id, skipped: true, note: 'social.json không bật product_images.watermark: không chèn logo.' };
  if (status.watermark && !args.force) return { id: draft.id, skipped: true, note: 'Đã chèn watermark (--force để làm lại).' };
  const raw = path.join(dir, 'image-generated.png'), overlaid = path.join(dir, 'image-watermarked.png');
  if (!fs.existsSync(raw)) throw new Error('Chưa có image-generated.png (chạy draft.mjs image trước).');
  const logo = path.resolve(brand.dir, String(wm.file || ''));
  if (!wm.file || !inside(brand.dir, logo) || !fs.existsSync(logo)) throw new Error('product_images.watermark.file phải là file logo có thật trong thư mục skill của thương hiệu.');
  const head = fs.readFileSync(raw).subarray(0, 24);
  const width = head.subarray(1, 4).toString('latin1') === 'PNG' ? head.readUInt32BE(16) : 1024;
  const position = ['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(wm.position) ? wm.position : 'bottom-right';
  const opacity = Math.min(1, Math.max(0, Number(wm.opacity ?? 0.6)));
  const w = Math.max(16, Math.round(width * 0.12)), m = Math.round(width * 0.03);
  const x = position.endsWith('right') ? `W-w-${m}` : String(m), y = position.startsWith('bottom') ? `H-h-${m}` : String(m);
  const tmp = path.join(dir, 'image.watermark.png');
  const r = spawnSync(process.env.SA_FFMPEG || s.ffmpeg?.command || 'ffmpeg', ['-y', '-v', 'error', '-i', raw, '-i', logo, '-filter_complex', `[1:v]scale=${w}:-1,format=rgba,colorchannelmixer=aa=${opacity}[wm];[0:v][wm]overlay=${x}:${y}`, '-frames:v', '1', tmp], { encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0 || !fs.existsSync(tmp)) throw new Error(`Không chèn được watermark: ${r.error?.code === 'ENOENT' ? 'chưa có ffmpeg (settings.ffmpeg.command)' : (r.stderr || '').trim().slice(0, 300)}`);
  fs.renameSync(tmp, overlaid);
  setStatus(dir, status.status, { watermark: { applied: stamp(), position, opacity, file: wm.file }, logo_check: null });
  const cleaned = cleanDraftImage(dir, { generator: 'codex', force: true }, s);
  return { id: draft.id, image: cleaned.image, original: raw, overlaid, watermark: readJson(path.join(dir, 'status.json')).watermark };
}

// Scene-swap only: the agent (or a person) looked at image.png and confirms no source-shop name, logo, watermark,
// badge, size label or phone/website text is left. A new image (draft.mjs image) clears it.
export function confirmClean(args) {
  const { dir, draft } = findDraft(need(args, 'id'));
  if (draft.image_mode !== 'scene-swap') return { id: draft.id, skipped: true, note: 'Chỉ cần cho bản nháp scene-swap.' };
  if (!fs.existsSync(path.join(dir, 'image.png'))) throw new Error('Chưa có image.png.');
  const imageHash = sha1(fs.readFileSync(path.join(dir, 'image.png')));
  const st = setStatus(dir, readJson(path.join(dir, 'status.json'), {}).status, { logo_check: { confirmed: stamp(), by: need(args, 'by'), image_sha1: imageHash, note: args.note ? String(args.note) : '' } });
  return { id: draft.id, status: st.status, logo_check: st.logo_check, next: `node scripts/draft.mjs check --id ${draft.id}` };
}

export function check(args) {
  const { dir, draft, status } = findDraft(need(args, 'id'));
  if (['approved', 'rejected'].includes(status.status)) return ({ id: draft.id, status: status.status, note: 'Đã xử lý, không kiểm lại.' });
  const { problems, warnings } = checkDraft(dir, draft, status);
  const next = problems.length ? (fs.existsSync(path.join(dir, 'image.png')) ? 'needs_caption' : status.status) : 'awaiting_approval';
  const st = setStatus(dir, next, { problems });
  return ({ id: draft.id, status: st.status, problems, warnings });
}

if (isMain(import.meta.url)) main(() => {
  const args = parseArgs();
  const s = settings();
  const cmd = args._[0];
  if (cmd === 'new') return out(newDraft(args));
  if (cmd === 'image') return out(image(args, s));
  if (cmd === 'check') return out(check(args));
  if (cmd === 'watermark') return out(watermark(args, s));
  if (cmd === 'confirm-clean') return out(confirmClean(args));
  if (cmd === 'show') return out(summary(findDraft(need(args, 'id'))));
  if (cmd === 'list') return out({ drafts: listDrafts(args.brand && String(args.brand)).filter((d) => !args.status || d.status.status === args.status).map((d) => ({ id: d.id, brand: d.draft.brand, status: d.status.status, dir: d.dir })) });
  throw new Error('Lệnh: new | image | watermark | confirm-clean | check | show | list');
});
