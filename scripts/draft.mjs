// Mode "Làm bài & đưa lên", step 2: drafts. One folder per draft in workspace/drafts/<brand>/<id>/: draft.json (what it is), status.json (where it
// is), prompt.txt + codex.log + image.png (the brand's own image, made by Codex CLI from the brand's own product photo),
// brief.md and content-<lang>.txt (captions written by the agent in the brand voice, per social.json). Nothing here
// touches the brand folder; that happens only in finalize.mjs (after every automatic check passed).
//   node scripts/draft.mjs new   --brand <id> --idea I001 --product <brand image> [--scene <mood image>]
//   node scripts/draft.mjs new   --brand <id> --idea I001 --ref-image <workspace/store/<brand>/images/S0001-1-….jpg>
//                                [--brand-can-produce]   scene-swap: opt-in per brand (product_images.reference_redraw)
//        --size "<real size, e.g. 91 cm (36 in) wide>" (required; from the skill: social.json product_images.size_source)
//        --sign-text "<text on the product>" (required when product_images.custom_text: a context text, never the template
//        placeholder; rules in the skill's references/image-guide.md and project.md section 10)
//   node scripts/draft.mjs image-batch --brand <id|all> [--concurrency 3] [--force]
//        the image step for every draft waiting for an image, several Codex processes at once (settings
//        codex.concurrency, default 3; each draft keeps its own codex.log), each cleaned right after; captions can be
//        written meanwhile. A Codex rate-limit/quota error: wait codex.retry_wait_seconds, retry once, then image_failed.
//   node scripts/draft.mjs reprompt --id <draft> [--size ..] [--sign-text ..] [--description "<product description>"]
//        rebuilds prompt.txt from the template (the old description is kept when none is given); then image --force
//   node scripts/draft.mjs confirm-clean --id <draft> --by <name>   scene-swap: looked at image.png, no shop name/logo left
//   node scripts/draft.mjs image --id <draft> [--force]     runs Codex (prompt.txt must be finished: no {{...}} left)
//   node scripts/draft.mjs watermark --id <draft> [--force] logo overlay in a corner, only if social.json
//                                                           product_images.watermark.enabled (default off; needs ffmpeg)
//   node scripts/draft.mjs check --id <draft>               automatic checks of image + captions; passed -> ready
//   node scripts/draft.mjs show  --id <draft>
//   node scripts/draft.mjs list  [--brand <id>] [--status s]
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkDraft, summary, logoWarnings } from './draft-lib.mjs';
import { cleanDraftImage } from './image-clean.mjs';
import { main, out, isMain, parseArgs, need, settings, loadBrand, workspace, toolRoot, readJson, writeJson, today, stamp, inside, sha1, projectSection, projectField, findDraft, setStatus, withLock, listDrafts, draftsRoot, hasHidden, sharedWords } from './lib.mjs';
import { readStore, storeDir, storeIdeasFile, markUsed } from './store.mjs';

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
  // Ideas come from the brand's store (ideas.mjs, workspace/store/<brand>/ideas.json); old "<date>/Ixx" ids are gone.
  const ideaId = need(args, 'idea');
  if (ideaId.includes('/')) throw new Error('Ý giờ lấy từ kho: dùng --idea I001 (ideas.mjs list), không còn dạng <ngày>/Ixx.');
  const ideasFile = storeIdeasFile(brand.id);
  const ideas = readJson(ideasFile, { ideas: [] });
  const idea = ideas.ideas.find((i) => i.id === ideaId);
  if (!idea) throw new Error(`Không có ý ${ideaId} trong ${ideasFile}.`);
  if (idea.status !== 'picked' && !(idea.status === 'drafted' && args.again)) throw new Error(`Ý ${ideaId} đang "${idea.status}"; chỉ ý đã pick mới làm nháp (--again để làm thêm bản).`);
  const store = readStore(brand.id);
  const imagesDir = path.join(storeDir(brand.id), 'images');
  const ref = store.items.find((r) => r.id === idea.item) || {};

  // AI-built scenes are on by default for every brand (never an AI label on the post); only an explicit false stops them.
  if (brand.social.product_images?.ai_scenes_allowed === false) throw new Error('social.json product_images.ai_scenes_allowed = false: thương hiệu tắt dựng cảnh bằng AI.');
  // Default ("brand-image"): the product photo is the brand's own (inside its skill folder or a product_images.sources
  // folder). Opt-in "scene-swap" (--ref-image): a research reference of this brand is the product photo and only the
  // scene changes; only when the brand's social.json has product_images.reference_redraw.enabled: true.
  let product, imageMode = 'brand-image', refUsed = ref;
  if (args['ref-image']) {
    const rr = brand.social.product_images?.reference_redraw || {};
    if (rr.enabled !== true) throw new Error('social.json product_images.reference_redraw.enabled khác true: thương hiệu chỉ dùng ảnh của chính mình (--product).');
    if (args.product) throw new Error('Dùng --product hoặc --ref-image, không cả hai.');
    product = path.resolve(String(args['ref-image']));
    if (!inside(imagesDir, product) || !fs.existsSync(product) || !IMAGE.test(product)) throw new Error(`--ref-image phải là ảnh trong kho của chính thương hiệu này (${imagesDir}).`);
    const hash = sha1(fs.readFileSync(product));
    refUsed = store.items.find((r) => (r.image_sha1 || []).includes(hash));
    if (!refUsed) throw new Error('--ref-image không phải một ảnh đã ingest vào kho (items.json).');
    if (rr.only_if_brand_can_produce !== false && !args['brand-can-produce']) throw new Error('reference_redraw.only_if_brand_can_produce: xác nhận thương hiệu làm được đúng sản phẩm này (project.md mục 5) bằng --brand-can-produce.');
    imageMode = 'scene-swap';
  } else {
    product = path.resolve(need(args, 'product'));
    if (!fs.existsSync(product) || !IMAGE.test(product)) throw new Error('Ảnh sản phẩm không có hoặc không phải PNG/JPEG/WebP.');
    if (!ownImage(brand, product)) throw new Error(`Ảnh sản phẩm phải là ảnh của thương hiệu: trong ${brand.dir} hoặc một thư mục product_images.sources[].path của social.json.`);
  }
  // The second image is only a mood reference, never a competitor's post (anything under workspace/runs/ or store/).
  let scene = '';
  if (args.scene) {
    scene = path.resolve(String(args.scene));
    if (!fs.existsSync(scene) || !IMAGE.test(scene)) throw new Error('Ảnh không khí không có hoặc không phải ảnh.');
    if (inside(path.join(workspace, 'runs'), scene) || inside(path.join(workspace, 'store'), scene)) throw new Error('Ảnh không khí không được là ảnh tham khảo của đối thủ (workspace/runs/, workspace/store/).');
    const hash = sha1(fs.readFileSync(scene));
    if (store.items.some((r) => (r.image_sha1 || []).includes(hash))) throw new Error('Ảnh không khí trùng một ảnh tham khảo của đối thủ.');
  }

  const day = today(brand.timezone).replace(/-/g, '');
  const brandDrafts = path.join(draftsRoot, brand.id);
  fs.mkdirSync(brandDrafts, { recursive: true });
  const n = fs.readdirSync(brandDrafts).filter((d) => d.startsWith(`${brand.id}-${day}-`)).length + 1;
  const id = `${brand.id}-${day}-${String(n).padStart(2, '0')}`;
  const dir = path.join(brandDrafts, id);
  fs.mkdirSync(dir, { recursive: true });

  const mode = brand.social.language_policy?.mode || 'single';
  const networks = (brand.social.channels || []).filter((x) => x.enabled).map((x) => ({ network: x.network, account: x.account || '', url: x.url || '', lang: [].concat(x.lang || []) }));
  const { size: productSize, signText, customText } = sizeAndText(brand, args, idea);
  const draft = {
    id, brand: brand.id, brand_name: brand.brand, brand_dir: brand.dir, created: stamp(), product_size: productSize, ...(signText ? { sign_text: signText } : {}), custom_text: customText,
    idea: { run: 'store', id: idea.id, ...Object.fromEntries(['product_type', 'scene', 'angle', 'props', 'caption_structure', 'hook', 'why'].map((f) => [f, idea[f] || ''])) },
    inspiration: { run: refUsed.run || 'store', ref: refUsed.id || idea.item, store_item: refUsed.id || idea.item, source: refUsed.source_id || '', source_shop: refUsed.store || '', source_url: refUsed.source_url || '', post_url: refUsed.post_url || '' },
    image_mode: imageMode, ...(imageMode === 'scene-swap' ? { reference_image: product, require_logo_removal: brand.social.product_images.reference_redraw.require_logo_removal !== false } : {}),
    product_image: product, scene_image: scene, networks, languages: brand.languages, review_languages: brand.review_languages || [], language_mode: mode,
    // captions: posted languages + reviewer-only languages (language_policy.review_langs; never posted).
    image: 'image.png', captions: Object.fromEntries([...brand.languages, ...(brand.review_languages || [])].map((l) => [l, `content-${l}.txt`])), ai_disclosure: { tool: 'codex' },
  };
  writeJson(path.join(dir, 'draft.json'), draft);
  const second = scene
    ? 'The second attached image is ONLY a mood/lighting reference. Do not copy it and do not take any objects from it.'
    : 'There is no second image.';
  fs.writeFileSync(path.join(dir, 'prompt.txt'), fill(fs.readFileSync(path.join(toolRoot, 'prompts', imageMode === 'scene-swap' ? 'scene-swap.txt' : 'scene-edit.txt'), 'utf8'), {
    SOURCE_SHOP: refUsed.store || refUsed.source_id || 'the source shop',
    SCENE: idea.scene, ANGLE: idea.angle, PROPS: idea.props || 'at most one or two props that fit the scene',
    PRODUCT_RULES: projectSection(brand.project, 10) || '(project.md mục 10 trống)', SECOND_IMAGE: second, OUTPUT: 'image.png',
    ...sizeTextFill(brand, productSize, signText),
  }), 'utf8');
  fs.writeFileSync(path.join(dir, 'brief.md'), fill(fs.readFileSync(path.join(toolRoot, 'prompts', 'caption-brief.md'), 'utf8'), {
    BRAND: brand.brand, SKILL: path.join(brand.dir, 'SKILL.md'), PROJECT: path.join(brand.dir, 'project', 'project.md'),
    SIGN_TEXT_NOTE: signText ? 'Chữ trên bảng là "' + signText + '": caption (mọi ngôn ngữ) nhắc đúng chữ này, không viết chữ mẫu kiểu "Your Names".' : '',
    IDEA: JSON.stringify(draft.idea, null, 2), NETWORKS: networks.map((x) => `- ${x.network} (${x.account || 'chưa có account'}): ${x.lang.join(', ')}`).join('\n') + `\nlanguage_policy.mode: ${mode}${brand.social.language_policy?.note ? ` (${brand.social.language_policy.note})` : ''}`,
    SECTIONS: [].concat(brand.social.caption_rules?.project_md_sections || []).join('; ') || '1, 3, 7, 8, 10, 11',
    FILES: [...brand.languages.map((l) => `- content-${l}.txt`), ...(brand.review_languages || []).map((l) => `- content-${l}.txt (chỉ để người dùng đọc, KHÔNG đăng; cùng giọng thương hiệu, cùng quy tắc)`)].join('\n'),
    WEBSITE: projectField(brand.project, 'Website') || '(chưa có)', HASHTAG: projectField(brand.project, 'Hashtag cố định') || '(chưa có)',
  }), 'utf8');
  withLock(ideasFile, () => {
    const now = readJson(ideasFile);
    const it = now.ideas.find((i) => i.id === idea.id);
    it.status = 'drafted'; it.drafts = [...new Set([...(it.drafts || []), id])]; it.updated = stamp();
    writeJson(ideasFile, now);
  });
  // The store item(s) behind this draft are "used" by it (never picked again for a new idea).
  for (const it of new Set([idea.item, refUsed.id].filter(Boolean))) markUsed(brand.id, it, id);
  const status = setStatus(dir, 'needs_prompt', { image_mode: imageMode, ...(imageMode === 'scene-swap' ? { source_shop: draft.inspiration.source_shop, source_url: draft.inspiration.source_url } : {}) });
  return ({ id, dir, status: status.status, next: `Mở ${path.join(dir, 'prompt.txt')}, thay {{PRODUCT_DESCRIPTION}} bằng mô tả đúng sản phẩm trong ảnh, rồi chạy draft.mjs image --id ${id}. Viết caption theo brief.md.` });
}

// The real size (required) and, for custom-text products (social.json product_images.custom_text), the context text
// shown on the product. The rules live in the brand's skill (references/image-guide.md, project.md section 10).
function sizeAndText(brand, args, from = {}) {
  const str = (k) => (args[k] && args[k] !== true ? String(args[k]).trim() : '');
  const size = str('size') || String(from.product_size || '').trim();
  if (!size) throw new Error(`Missing --size: the product's real size (where: ${brand.social.product_images?.size_source || 'project.md mục 5/10'}).`);
  const customText = brand.social.product_images?.custom_text === true;
  const signText = str('sign-text') || String(from.sign_text || '').trim();
  if (customText && !signText) throw new Error('This brand has custom-text products (product_images.custom_text): give --sign-text, a text that fits the scene (never the template placeholder).');
  if (signText && PLACEHOLDER.test(signText)) throw new Error(`--sign-text "${signText}" is a template placeholder: choose a text that fits the scene.`);
  return { size, signText, customText };
}
export const PLACEHOLDER = /\byour\s+(names?|logo|bar(\s+name)?|business(\s+name)?|name\s+here|text|brand|shop(\s+name)?|company)\b/i;
function sizeTextFill(brand, size, signText) {
  return {
    SIZE: size,
    SIGN_TEXT_RULE: signText ? `The customer's own text on the product (where the photo shows template/placeholder text such as "Your Names", "Your Logo", "Your Bar Name") must read exactly: "${signText}". No placeholder text may remain; fixed words of the design stay as they are; keep the product's font style, colours, layout and number of lines.` : 'Keep the product\'s own text exactly as in the photo.',
    IMAGE_GUIDE: path.join(brand.dir, 'references', 'image-guide.md'),
  };
}
// Rebuilds prompt.txt of an existing draft from the template (new size / sign text), keeping its product description.
function reprompt(args) {
  const { dir, draft } = findDraft(need(args, 'id'));
  const brand = loadBrand(draft.brand, { allowDisabled: true });
  const { size, signText, customText } = sizeAndText(brand, args, { product_size: draft.product_size, sign_text: draft.sign_text });
  const old = fs.existsSync(path.join(dir, 'prompt.txt')) ? fs.readFileSync(path.join(dir, 'prompt.txt'), 'utf8') : '';
  const kept = (old.match(/THE PRODUCT[^\n]*\n([\s\S]*?)\n(?:Keep |Real size)/) || [])[1] || '';
  const description = args.description && args.description !== true ? String(args.description).trim() : kept.trim();
  const tpl = fs.readFileSync(path.join(toolRoot, 'prompts', draft.image_mode === 'scene-swap' ? 'scene-swap.txt' : 'scene-edit.txt'), 'utf8');
  const second = draft.scene_image ? 'The second attached image is ONLY a mood/lighting reference. Do not copy it and do not take any objects from it.' : 'There is no second image.';
  fs.writeFileSync(path.join(dir, 'prompt.txt'), fill(tpl, {
    PRODUCT_DESCRIPTION: description || '{{PRODUCT_DESCRIPTION}}', SOURCE_SHOP: draft.inspiration?.source_shop || 'the source shop',
    SCENE: draft.idea.scene, ANGLE: draft.idea.angle, PROPS: draft.idea.props || 'at most one or two props that fit the scene',
    PRODUCT_RULES: projectSection(brand.project, 10) || '(project.md mục 10 trống)', SECOND_IMAGE: second, OUTPUT: 'image.png',
    ...sizeTextFill(brand, size, signText),
  }), 'utf8');
  const next = { ...draft, product_size: size, custom_text: customText };
  if (signText) next.sign_text = signText; else delete next.sign_text;
  writeJson(path.join(dir, 'draft.json'), next);
  return { id: draft.id, product_size: size, sign_text: signText || null, prompt: path.join(dir, 'prompt.txt'), next: description ? `node scripts/draft.mjs image --id ${draft.id} --force` : 'Fill {{PRODUCT_DESCRIPTION}} in prompt.txt, then draft.mjs image --force.' };
}

function codexCommand(s) {
  const cmd = process.env.SA_CODEX || s.codex.command;
  if (/\.m?js$/i.test(cmd)) return { file: process.execPath, pre: [path.resolve(toolRoot, cmd)], shell: false };
  if (process.platform === 'win32' && !path.isAbsolute(cmd)) {
    try {
      const found = execFileSync('where', [cmd], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const pick = found.find((f) => /\.(cmd|exe)$/i.test(f)) || found[0];
      return { file: pick, pre: [], shell: /\.cmd$/i.test(pick) };
    } catch { throw new Error('Không tìm thấy Codex CLI (codex). Cài và đăng nhập Codex trước.'); }
  }
  return { file: cmd, pre: [], shell: false };
}

const QUOTA = /usage limit|rate[ -]?limit|quota|too many requests|\b429\b/i;

// Drafts waiting for an image: prompt filled, no image.png yet (or every draft with --force), not dropped/approved.
export function waitingForImage(brand, force = false) {
  return listDrafts(brand === 'all' ? undefined : brand).filter((d) => {
    if (d.status.brand_post || ['rejected', 'approved', 'generating'].includes(d.status.status)) return false;
    if (!force && fs.existsSync(path.join(d.dir, 'image.png'))) return false;
    return fs.existsSync(path.join(d.dir, 'prompt.txt'));
  });
}
// image-batch: one child process per draft (draft.mjs image), at most <concurrency> at once.
export async function imageBatch(args, s = settings()) {
  const brand = need(args, 'brand');
  const limit = Math.max(1, Number(args.concurrency && args.concurrency !== true ? args.concurrency : s.codex.concurrency || 3));
  const all = waitingForImage(brand, !!args.force);
  const todo = [], skipped = [];
  for (const d of all) {
    const left = fs.readFileSync(path.join(d.dir, 'prompt.txt'), 'utf8').match(/\{\{\w+\}\}/g);
    if (left) skipped.push({ id: d.id, reason: `prompt.txt còn ${[...new Set(left)].join(', ')}` }); else todo.push(d);
  }
  const results = [];
  let next = 0;
  const one = (d) => new Promise((done) => {
    const p = spawn(process.execPath, [fileURLToPath(import.meta.url), 'image', '--id', d.id, ...(args.force ? ['--force'] : [])], { env: process.env, windowsHide: true });
    let o = '', e = '';
    p.stdout.on('data', (x) => { o += x; }); p.stderr.on('data', (x) => { e += x; });
    p.on('close', () => { let r; try { r = JSON.parse(o); } catch { r = { ok: false, error: (o + e).trim().slice(0, 500) }; } done({ id: d.id, ...r }); });
  });
  const worker = async () => { while (next < todo.length) { const d = todo[next++]; results.push(await one(d)); } };
  await Promise.all(Array.from({ length: Math.min(limit, todo.length) }, worker));
  return { brand, concurrency: limit, done: results.filter((r) => r.ok !== false).map((r) => r.id), failed: results.filter((r) => r.ok === false).map((r) => ({ id: r.id, error: r.error })), skipped, results,
    next: 'Xem từng ảnh; ảnh đạt thì viết caption (có thể viết trong lúc ảnh khác đang chạy) rồi draft.mjs check.' };
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
  if (brandNow.social.product_images?.ai_scenes_allowed === false) throw new Error('social.json product_images.ai_scenes_allowed = false: không dựng cảnh AI.');
  // An earlier image is kept aside (image-old-<time>.png); the new Codex output becomes image-generated.png.
  if (args.force) for (const f of ['image-generated.png', 'image.png']) if (fs.existsSync(path.join(dir, f))) fs.renameSync(path.join(dir, f), path.join(dir, `image-old-${Date.now()}-${f}`));
  for (const f of ['image-watermarked.png', 'image-clean-report.json']) fs.rmSync(path.join(dir, f), { force: true });
  // codex exec --skip-git-repo-check -s workspace-write - -i <brand product image> [-i <scene ref>] < prompt.txt
  const codexArgs = ['exec', '--skip-git-repo-check', '-s', 'workspace-write', '-', '-i', draft.product_image, ...(draft.scene_image ? ['-i', draft.scene_image] : [])];
  const c = codexCommand(s);
  const q = (a) => (c.shell ? `"${a}"` : a);
  const before = new Set(fs.readdirSync(dir));
  setStatus(dir, 'generating');
  const runCodex = () => c.shell
  // A .cmd shim needs the shell; it gets one command string (no args array with shell: true, Node DEP0190).
    ? spawnSync([c.file, ...c.pre, ...codexArgs].map(q).join(' '), { cwd: dir, input: prompt, encoding: 'utf8', shell: true, timeout: s.codex.timeout_minutes * 60000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
    : spawnSync(c.file, [...c.pre, ...codexArgs], { cwd: dir, input: prompt, encoding: 'utf8', timeout: s.codex.timeout_minutes * 60000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  // A rate-limit/quota answer: wait (codex.retry_wait_seconds), try once more, then image_failed.
  const wait = Number(process.env.SA_CODEX_RETRY_WAIT_SECONDS ?? s.codex.retry_wait_seconds ?? 60);
  let r, log = '', retried = false;
  for (let attempt = 1; ; attempt++) {
    r = runCodex();
    log += `$ codex ${codexArgs.join(' ')} < prompt.txt   (attempt ${attempt})\n\n${r.stdout || ''}\n${r.stderr || ''}\n${r.error ? 'ERROR ' + r.error.message : ''}\n`;
    fs.writeFileSync(path.join(dir, 'codex.log'), log, 'utf8');
    if (fs.existsSync(target) || attempt > 1 || !QUOTA.test(`${r.stdout}${r.stderr}`)) break;
    retried = true;
    log += `\n-- rate limit / quota: waiting ${wait}s, then one retry --\n\n`;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait * 1000);
  }
  if (!fs.existsSync(target)) {
    // Codex sometimes names the file differently: take the one new PNG it saved.
    const fresh = fs.readdirSync(dir).filter((f) => !before.has(f) && /\.png$/i.test(f));
    if (fresh.length === 1) fs.renameSync(path.join(dir, fresh[0]), target);
  }
  if (!fs.existsSync(target)) {
    const quota = QUOTA.test(`${r.stdout}${r.stderr}`);
    setStatus(dir, 'image_failed', { error: quota ? `Codex hết hạn mức ảnh${retried ? ' (đã chờ và thử lại 1 lần)' : ''}` : `Codex không tạo được image.png (mã ${r.status})` });
    throw new Error(`${quota ? 'Codex hết hạn mức ảnh.' : 'Codex không tạo được image.png.'} Xem ${path.join(dir, 'codex.log')}`);
  }
  // Codex's file is the original (image-generated.png, never written again); image.png is the metadata-clean copy from
  // the remove-watermark skill. A new image drops an earlier watermark overlay and logo check.
  fs.renameSync(target, path.join(dir, 'image-generated.png'));
  setStatus(dir, 'needs_caption', { error: '', watermark: null, logo_check: null, metadata_clean: null });
  const cleaned = cleanDraftImage(dir, { generator: 'codex', force: true }, s);
  const st = readJson(path.join(dir, 'status.json'));
  return ({ id: draft.id, image: target, ...(retried ? { retried_after_rate_limit: true } : {}), original: cleaned.original, metadata_removed: cleaned.removed, warnings: logoWarnings(prompt), status: st.status, next: `Xem ảnh; nếu đạt, viết caption theo brief.md rồi chạy draft.mjs check --id ${draft.id}.` });
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
  const next = problems.length ? (fs.existsSync(path.join(dir, 'image.png')) ? 'needs_caption' : status.status) : 'ready';
  const st = setStatus(dir, next, { problems });
  return ({ id: draft.id, status: st.status, problems, warnings });
}

if (isMain(import.meta.url)) main(async () => {
  const args = parseArgs();
  const s = settings();
  const cmd = args._[0];
  if (cmd === 'new') return out(newDraft(args));
  if (cmd === 'image') return out(image(args, s));
  if (cmd === 'image-batch') return out(await imageBatch(args, s));
  if (cmd === 'reprompt') return out(reprompt(args));
  if (cmd === 'check') return out(check(args));
  if (cmd === 'watermark') return out(watermark(args, s));
  if (cmd === 'confirm-clean') return out(confirmClean(args));
  if (cmd === 'show') return out(summary(findDraft(need(args, 'id'))));
  if (cmd === 'list') return out({ drafts: listDrafts(args.brand && String(args.brand)).filter((d) => !args.status || d.status.status === args.status).map((d) => ({ id: d.id, brand: d.draft.brand, status: d.status.status, dir: d.dir })) });
  throw new Error('Lệnh: new | reprompt | image | image-batch | watermark | confirm-clean | check | show | list');
});
