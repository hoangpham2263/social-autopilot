// Mode "Làm bài & đưa lên", step 2: drafts. One folder per draft in workspace/drafts/<brand>/<id>/: draft.json (what it is), status.json (where it
// is), prompt.txt + codex.log + image.png (the brand's own image, made by Codex CLI from the brand's own product photo),
// brief.md and content-<lang>.txt (captions written by the agent in the brand voice, per social.json). Nothing here
// touches the brand folder; that happens only in finalize.mjs (after every automatic check passed).
//   node scripts/draft.mjs new   --brand <id> --idea I001 --product <brand image> [--scene <mood image>]
//   node scripts/draft.mjs new   --brand <id> --idea I001 --ref-image <workspace/store/<brand>/images/S0001-1-….jpg>
//                                [--brand-can-produce]   scene-swap: opt-in per brand (product_images.reference_redraw)
//        --ref-mode keep-scene|new-scene (required with --ref-image; the agent LOOKS at the reference first) [--ref-has-face true|false]
//          keep-scene: no human face in the reference: its scene/framing stay, the product gets NEW text: --sign-text (new,
//                      same language/script as the original) and --ref-text (what the reference reads) are required
//          new-scene:  a face / identifiable person: a new real-life scene, every person removed, the product's text kept
//        --size "<real size, e.g. 91 cm (36 in) wide>" (required; from the skill: social.json product_images.size_source)
//        --compare "<comparison object + its real size, e.g. the 4-seat table below, 120 cm (47 in) wide>" (named in the
//        prompt with the proportion limits; tool defaults or social.json product_images.size_limits) [--frame-max N] [--close-up]
//        --sign-text "<text on the product>" (required when product_images.custom_text: a context text, never the template
//        placeholder; rules in the skill's references/image-guide.md and project.md section 10)
//   node scripts/draft.mjs image-batch --brand <id|all> [--concurrency 3] [--force]
//        the image step for every draft waiting for an image, several Codex processes at once (settings
//        codex.concurrency, default 3; each draft keeps its own codex.log), each cleaned right after; captions can be
//        written meanwhile. A Codex rate-limit/quota error: wait codex.retry_wait_seconds, retry once, then image_failed.
//   node scripts/draft.mjs reprompt --id <draft> [--size ..] [--compare ..] [--smaller N] [--sign-text .. | --clear-sign-text] [--description "<product description>"]
//        rebuilds prompt.txt from the template (the old description is kept when none is given); then image --force
//   node scripts/draft.mjs confirm-clean --id <draft> --by <name> [--no-people]   scene-swap: looked at image.png, no shop name/logo
//        left; new-scene also needs --no-people (nobody from the reference, no person at all, in the new image)
//   node scripts/draft.mjs size-check --id <draft> --product-pct N --object-pct N [--wall-pct N] [--accept "<reason>"]
//        measured proportions of the new image (logged in status.json size_check, shown in the app); over a limit: retry once with reprompt --smaller N
//   node scripts/draft.mjs image --id <draft> [--force]     runs Codex (prompt.txt must be finished: no {{...}} left)
//   node scripts/draft.mjs watermark --id <draft> [--force] logo overlay in a corner, only if social.json
//                                                           product_images.watermark.enabled (default off; needs ffmpeg)
//   node scripts/draft.mjs check --id <draft>               automatic checks of image + captions; passed -> ready
//   node scripts/draft.mjs contact-sheet [--ids a,b | --brand <id|all>] [--status needs_caption] [--per-sheet 6] [--out <dir>]
//        one PNG of several draft images (labelled #n + draft id), so every new image is LOOKED at in one read
//        (pure Node; JPEG/WebP via ffmpeg when present). Default: drafts with an image waiting for captions/review.
//   node scripts/draft.mjs show  --id <draft>
//   node scripts/draft.mjs list  [--brand <id>] [--status s]
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkDraft, summary, logoWarnings, REF_MODES, refModeOf, refTemplate, sameSignText, imagesRange, pickImageCount, draftImages, extraShotOf, albumHash } from './draft-lib.mjs';
import { cleanDraftImage, cleanExtraImage } from './image-clean.mjs';
import { main, out, isMain, parseArgs, need, settings, loadBrand, workspace, toolRoot, readJson, writeJson, today, stamp, inside, sha1, projectSection, projectField, findDraft, setStatus, withLock, listDrafts, draftsRoot, hasHidden, sharedWords, readBrandOverride } from './lib.mjs';
import { readStore, storeDir, storeIdeasFile, markUsed, reuseProblems } from './store.mjs';
import { track } from './progress.mjs';
import { contactSheet } from './contact-sheet.mjs';

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
  let product, imageMode = 'brand-image', refUsed = ref, refMode = '', refHasFace = null;
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
    // The agent looked at the reference: a human face -> new-scene, none -> keep-scene (user 10/11/2026).
    refMode = String(args['ref-mode'] && args['ref-mode'] !== true ? args['ref-mode'] : idea.ref_mode || '').trim();
    if (!REF_MODES.includes(refMode)) throw new Error('--ref-mode keep-scene|new-scene: LOOK at the reference first; a human face -> new-scene (new scene, people removed, text kept), no face -> keep-scene (scene kept, new text on the product).');
    const face = args['ref-has-face'] !== undefined ? args['ref-has-face'] : idea.ref_has_face;
    refHasFace = face === undefined || face === null || face === '' ? refMode === 'new-scene' : face === true || String(face) === 'true';
    if (refHasFace !== (refMode === 'new-scene')) throw new Error(`ref_has_face ${refHasFace} does not fit --ref-mode ${refMode}: a face in the reference -> new-scene, no face -> keep-scene.`);
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
  const refInfo = { mode: refMode, text: String(args['ref-text'] && args['ref-text'] !== true ? args['ref-text'] : idea.ref_text || '').trim() };
  let sized;
  try { sized = sizeAndText(brand, args, idea, refInfo); } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); throw e; }
  const { size: productSize, signText, customText } = sized;
  const so = sizeOpts(args, idea);
  // The same library item again only from a new angle: a different scene OR a different sign_text (same scene + text + product = repeat).
  for (const it of new Set([idea.item, refUsed.id].filter(Boolean))) {
    const item = store.items.find((x) => x.id === it);
    const rp = item ? reuseProblems(item, { scene: idea.scene, product, sign_text: signText, idea: idea.id }) : [];
    if (rp.length) { fs.rmSync(dir, { recursive: true, force: true }); throw new Error(`Repeat of an earlier post from the same library item: ${rp.join('; ')}`); }
  }
  const draft = {
    id, brand: brand.id, brand_name: brand.brand, brand_dir: brand.dir, created: stamp(), product_size: productSize, ...(so.compare ? { size_compare: so.compare } : {}), ...(so.frameMax ? { frame_pct_max: so.frameMax } : {}), ...(so.closeUp ? { close_up: true } : {}), ...(signText ? { sign_text: signText } : {}), custom_text: customText,
    idea: { run: 'store', id: idea.id, ...Object.fromEntries(['product_type', 'scene', 'angle', 'props', 'caption_structure', 'hook', 'why'].map((f) => [f, idea[f] || ''])) },
    inspiration: { run: refUsed.run || 'store', ref: refUsed.id || idea.item, store_item: refUsed.id || idea.item, source: refUsed.source_id || '', source_shop: refUsed.store || '', source_url: refUsed.source_url || '', post_url: refUsed.post_url || '' },
    image_mode: imageMode, ...(imageMode === 'scene-swap' ? { reference_image: product, require_logo_removal: brand.social.product_images.reference_redraw.require_logo_removal !== false, ref_mode: refMode, ref_has_face: refHasFace, ...(refInfo.text ? { ref_text: refInfo.text } : {}) } : {}),
    product_image: product, scene_image: scene, networks, languages: brand.languages, review_languages: brand.review_languages || [], language_mode: mode,
    // captions: posted languages + reviewer-only languages (language_policy.review_langs; never posted).
    image: 'image.png', captions: Object.fromEntries([...brand.languages, ...(brand.review_languages || [])].map((l) => [l, `content-${l}.txt`])), ai_disclosure: { tool: 'codex' },
    // Album (user 11/11/2026): a random number of images in posts.images_per_post (tool default, brand override).
    image_count: Number(args.images) >= 1 ? Math.min(10, Math.floor(Number(args.images))) : pickImageCount(imagesRange(settings(), readBrandOverride(brand.id))),
  };
  writeJson(path.join(dir, 'draft.json'), draft);
  const second = scene
    ? 'The second attached image is ONLY a mood/lighting reference. Do not copy it and do not take any objects from it.'
    : 'There is no second image.';
  fs.writeFileSync(path.join(dir, 'prompt.txt'), fill(fs.readFileSync(path.join(toolRoot, 'prompts', refTemplate(draft)), 'utf8'), {
    SOURCE_SHOP: refUsed.store || refUsed.source_id || 'the source shop',
    SCENE: idea.scene, ANGLE: idea.angle, PROPS: idea.props || 'at most one or two props that fit the scene',
    PRODUCT_RULES: projectSection(brand.project, 10) || '(project.md mục 10 trống)', SECOND_IMAGE: second, OUTPUT: 'image.png',
    ...sizeTextFill(brand, productSize, signText, so, refInfo),
  }), 'utf8');
  writeExtraPrompts(dir, draft, brand, sizeTextFill(brand, productSize, signText, so, refInfo));
  fs.writeFileSync(path.join(dir, 'brief.md'), fill(fs.readFileSync(path.join(toolRoot, 'prompts', 'caption-brief.md'), 'utf8'), {
    BRAND: brand.brand, SKILL: path.join(brand.skillRoot || brand.dir, 'SKILL.md'), PROJECT: path.join(brand.dir, 'project', 'project.md'),
    SIGN_TEXT_NOTE: [refNote(refMode, refInfo.text, signText),
      signText ? 'Chữ trên bảng là "' + signText + '": caption (mọi ngôn ngữ) nhắc đúng chữ này, không viết chữ mẫu kiểu "Your Names".' : ''].filter(Boolean).join(' '),
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
  // The store item(s) behind this draft get one more use (scene, product, sign text); they stay available.
  for (const it of new Set([idea.item, refUsed.id].filter(Boolean))) markUsed(brand.id, it, id);
  const status = setStatus(dir, 'needs_prompt', { image_mode: imageMode, ...(imageMode === 'scene-swap' ? { source_shop: draft.inspiration.source_shop, source_url: draft.inspiration.source_url } : {}) });
  return ({ id, dir, status: status.status, ...(refMode ? { ref_mode: refMode, ref_has_face: refHasFace } : {}), ...(so.compare || refMode === 'keep-scene' ? {} : { warnings: ['No --compare: name the comparison object and its real size (e.g. "the 4-seat wooden table below, 120 cm (47 in) wide"); the prompt falls back to a generic furniture line.'] }), next: `Mở ${path.join(dir, 'prompt.txt')}, thay {{PRODUCT_DESCRIPTION}} bằng mô tả đúng sản phẩm trong ảnh, rồi chạy draft.mjs image --id ${id}. Viết caption theo brief.md.` });
}

// The caption brief's note for a reference-based draft (keep-scene / new-scene).
function refNote(mode, refText, signText) {
  if (mode === 'keep-scene') return `Keep-scene (ảnh tham khảo không có mặt người): giữ nguyên cảnh của ảnh tham khảo, chữ trên sản phẩm đã được thay bằng chữ mới "${signText}" (ảnh gốc ghi "${refText}"). Caption nói về chữ mới này, không nhắc chữ cũ, không nhắc ảnh gốc hay shop nguồn.`;
  if (mode === 'new-scene') return 'New-scene (ảnh tham khảo có người): sản phẩm và chữ trên nó giữ nguyên như ảnh tham khảo, đặt vào cảnh mới, không còn người nào. Không bịa nghĩa hay bản dịch của chữ khi không chắc: khi đó gọi là "the characters/lettering on the sign" và tập trung vào thiết kế, cách đặt làm bảng riêng.';
  return '';
}

// The real size (required) and, for custom-text products (social.json product_images.custom_text), the context text
// shown on the product. The rules live in the brand's skill (references/image-guide.md, project.md section 10).
// Reference-based (user 10/11/2026): new-scene keeps the product's text, so --sign-text only records what the reference
// already reads (for the caption check; --clear-sign-text drops it when not readable for sure). keep-scene puts NEW text
// on the product: --sign-text is required and must differ from --ref-text (what the reference reads).
function sizeAndText(brand, args, from = {}, ref = {}) {
  const str = (k) => (args[k] && args[k] !== true ? String(args[k]).trim() : '');
  const size = str('size') || String(from.product_size || '').trim();
  if (!size) throw new Error(`Missing --size: the product's real size (where: ${brand.social.product_images?.size_source || 'project.md mục 5/10'}).`);
  const customText = brand.social.product_images?.custom_text === true;
  const signText = args['clear-sign-text'] ? '' : str('sign-text') || String(from.sign_text || '').trim();
  if (customText && !signText && !ref.mode) throw new Error('This brand has custom-text products (product_images.custom_text): give --sign-text, a text that fits the scene (never the template placeholder).');
  if (signText && PLACEHOLDER.test(signText)) throw new Error(`--sign-text "${signText}" is a template placeholder: choose a text that fits the scene.`);
  if (ref.mode === 'keep-scene') {
    if (!ref.text) throw new Error('keep-scene: give --ref-text, the text the product reads in the reference photo (exactly as seen).');
    if (!signText) throw new Error('keep-scene: give --sign-text, the NEW text for the product (same language/script as the original, fits the scene; no placeholder, no third-party brand, no real customer name).');
    if (sameSignText(signText, ref.text)) throw new Error(`keep-scene: --sign-text "${signText}" is the reference's own text; write a new one.`);
  }
  return { size, signText, customText };
}
export const PLACEHOLDER = /\byour\s+(names?|logo|bar(\s+name)?|business(\s+name)?|name\s+here|text|brand|shop(\s+name)?|company)\b/i;

// Proportions (user 10/11/2026: signs kept coming out too big although the real size was in the prompt). Tool defaults;
// a brand changes or switches off (null) any of them in social.json product_images.size_limits. Percentages of width:
// object = product ÷ the comparison furniture below/next to it, wall = product ÷ visible wall, frame = product ÷ image,
// margin_top = clear wall above the product ÷ product height. A close-up post (--close-up) has no frame limits.
export const SIZE_LIMITS = { object_pct_max: 60, wall_pct_max: 40, frame_pct_max: 35, frame_pct_min: 20, margin_top_pct: 20 };
export function sizeLimits(social = {}, draft = {}) {
  const b = social.product_images?.size_limits || {};
  const l = { ...SIZE_LIMITS };
  for (const k of Object.keys(SIZE_LIMITS)) if (k in b) l[k] = b[k] === null || b[k] === '' ? null : Number(b[k]);
  if (Number(draft.frame_pct_max) > 0) l.frame_pct_max = Number(draft.frame_pct_max);
  if (draft.close_up) { l.frame_pct_max = null; l.frame_pct_min = null; }
  return l;
}
// --compare / --frame-max / --close-up (new, reprompt) or what the idea/draft already has; --smaller N only on reprompt.
function sizeOpts(args, from = {}) {
  const str = (k) => (args[k] && args[k] !== true ? String(args[k]).trim() : '');
  const compare = str('compare') || String(from.size_compare || '').trim();
  const frameMax = Number(str('frame-max')) || Number(from.frame_pct_max) || 0;
  const closeUp = args['close-up'] === true || args['close-up'] === 'true' || (args['close-up'] === undefined && from.close_up === true);
  const smaller = Math.max(0, Math.min(80, Number(str('smaller')) || 0));
  return { compare, frameMax, closeUp, smaller };
}
const DEFAULT_COMPARE = 'the main piece of furniture below or next to it (table, sofa, bed, counter, cabinet), drawn at its real size';
function proportionFill(brand, o = {}, ref = {}) {
  const l = sizeLimits(brand.social, { frame_pct_max: o.frameMax, close_up: o.closeUp });
  const lim = [
    l.object_pct_max != null && `the product is at most ${l.object_pct_max}% as wide as the comparison object below or next to it (clearly narrower than the table, sofa, bed or counter)`,
    l.wall_pct_max != null && `at most ${l.wall_pct_max}% of the visible wall width`,
    l.margin_top_pct != null && `clear wall above it of at least ${l.margin_top_pct}% of its own height, and clear wall on both sides; it never runs from floor to ceiling or edge to edge`,
  ].filter(Boolean);
  const range = l.frame_pct_max != null ? `${l.frame_pct_min != null ? `about ${l.frame_pct_min}-${l.frame_pct_max}%` : `at most ${l.frame_pct_max}%`} of the image width, never more than ${l.frame_pct_max}%` : '';
  const framing = o.closeUp
    ? 'a close-up post: the product may fill most of the frame, but anything shown next to it keeps its real proportions.'
    : `a room / wide shot that shows the surroundings: the product takes ${range || 'a modest part of the image width'}.${ref.mode ? ' The reference photo is a close-up: do NOT keep its frame-filling scale or crop; pull the camera back and show the product at its real size in the room.' : ''}`;
  return {
    COMPARE: o.compare || DEFAULT_COMPARE,
    SIZE_LIMITS: lim.length ? lim.join('; ') + '.' : 'keep the real size against the comparison object.',
    FRAMING: framing,
    SMALLER: o.smaller ? `\n- The previous image drew it too big: make the product about ${o.smaller}% smaller than in that attempt (it was drawn bigger than its real size), well inside the limits above; the room stays the same.` : '',
  };
}
function sizeTextFill(brand, size, signText, o = {}, ref = {}) {
  return {
    SIZE: size,
    ...proportionFill(brand, o, ref),
    SIGN_TEXT_RULE: ref.mode === 'keep-scene'
      ? `The product in the reference reads "${ref.text}". Replace that text ENTIRELY with exactly: "${signText}" (character for character). Write it in the same language and script as the original text, with the product's own lettering style/font, colours, glow, layout, size and number of lines, on the same place of the product. No trace of the old text may remain; no other words, no placeholder, no brand or shop name.`
      : ref.mode
      ? `Keep the product's text EXACTLY as in the reference photo: the same characters/letters, script, orientation, layout, font, colours and number of lines${signText ? ` (it reads: "${signText}")` : ''}. Do not change, translate, correct (not even a character that looks mirrored) or add any text on the product.`
      : signText ? `The customer's own text on the product (where the photo shows template/placeholder text such as "Your Names", "Your Logo", "Your Bar Name") must read exactly: "${signText}". No placeholder text may remain; fixed words of the design stay as they are; keep the product's font style, colours, layout and number of lines.` : 'Keep the product\'s own text exactly as in the photo.',
    IMAGE_GUIDE: path.join(brand.skillRoot || brand.dir, 'references', 'image-guide.md'),
  };
}
// Rebuilds prompt.txt of an existing draft from the template (new size / sign text), keeping its product description.
function reprompt(args) {
  const { dir, draft } = findDraft(need(args, 'id'));
  const brand = loadBrand(draft.brand, { allowDisabled: true });
  const refInfo = { mode: refModeOf(draft), text: String(args['ref-text'] && args['ref-text'] !== true ? args['ref-text'] : draft.ref_text || '').trim() };
  const { size, signText, customText } = sizeAndText(brand, args, { product_size: draft.product_size, sign_text: draft.sign_text }, refInfo);
  const so = sizeOpts(args, draft);
  const old = fs.existsSync(path.join(dir, 'prompt.txt')) ? fs.readFileSync(path.join(dir, 'prompt.txt'), 'utf8') : '';
  const kept = (old.match(/THE PRODUCT[^\n]*\n([\s\S]*?)\n(?:Keep |Real size)/) || [])[1] || '';
  const description = args.description && args.description !== true ? String(args.description).trim() : kept.trim();
  const tpl = fs.readFileSync(path.join(toolRoot, 'prompts', refTemplate(draft)), 'utf8');
  const second = draft.scene_image ? 'The second attached image is ONLY a mood/lighting reference. Do not copy it and do not take any objects from it.' : 'There is no second image.';
  fs.writeFileSync(path.join(dir, 'prompt.txt'), fill(tpl, {
    PRODUCT_DESCRIPTION: description || '{{PRODUCT_DESCRIPTION}}', SOURCE_SHOP: draft.inspiration?.source_shop || 'the source shop',
    SCENE: draft.idea.scene, ANGLE: draft.idea.angle, PROPS: draft.idea.props || 'at most one or two props that fit the scene',
    PRODUCT_RULES: projectSection(brand.project, 10) || '(project.md mục 10 trống)', SECOND_IMAGE: second, OUTPUT: 'image.png',
    ...sizeTextFill(brand, size, signText, so, refInfo),
  }), 'utf8');
  writeExtraPrompts(dir, draft, brand, { ...sizeTextFill(brand, size, signText, so, refInfo), ...(description ? { PRODUCT_DESCRIPTION: description } : {}) });
  const next = { ...draft, product_size: size, custom_text: customText, ...(refInfo.text ? { ref_text: refInfo.text } : {}) };
  for (const [k, v] of [['size_compare', so.compare], ['frame_pct_max', so.frameMax], ['close_up', so.closeUp || undefined], ['size_smaller', so.smaller || undefined]]) if (v) next[k] = v; else delete next[k];
  if (signText) next.sign_text = signText; else delete next.sign_text;
  writeJson(path.join(dir, 'draft.json'), next);
  return { id: draft.id, product_size: size, size_compare: so.compare || null, ...(so.smaller ? { smaller: so.smaller } : {}), sign_text: signText || null, prompt: path.join(dir, 'prompt.txt'), next: description ? `node scripts/draft.mjs image --id ${draft.id} --force` : 'Fill {{PRODUCT_DESCRIPTION}} in prompt.txt, then draft.mjs image --force.' };
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
// A draft left "generating" by a run that died (no update for longer than the Codex timeout) is waiting again.
const deadAfter = (s) => ((Number(s.codex?.timeout_minutes) || 15) * 2 + 5) * 60000;
const busy = (st, s) => st.status === 'generating' && Date.now() - Date.parse(st.updated || 0) < deadAfter(s);
export function waitingForImage(brand, force = false, s = settings()) {
  return listDrafts(brand === 'all' ? undefined : brand).filter((d) => {
    if (d.status.brand_post || ['rejected', 'approved'].includes(d.status.status)) return false;
    if (busy(d.status, s)) return false;
    if (!force && fs.existsSync(path.join(d.dir, 'image.png')) && draftImages(d.draft).every((x) => fs.existsSync(path.join(d.dir, x)))) return false; // album: also when an extra is missing
    return fs.existsSync(path.join(d.dir, 'prompt.txt'));
  });
}
// Codex slots shared by every process on this machine (workspace/tmp/codex-slots/slot-<i>, a folder made atomically):
// at most settings codex.concurrency Codex image runs at once, also when several brands run image-batch in parallel.
// A slot whose process is gone is taken over.
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
export function takeCodexSlot(s = settings(), { waitMs = ((Number(s.codex?.timeout_minutes) || 15) * 2 + 5) * 60000 } = {}) {
  const n = Math.max(1, Number(s.codex?.concurrency) || 3), dir = path.join(workspace, 'tmp', 'codex-slots'), until = Date.now() + waitMs;
  fs.mkdirSync(dir, { recursive: true });
  for (;;) {
    for (let i = 0; i < n; i++) {
      const slot = path.join(dir, `slot-${i}`), pidFile = path.join(slot, 'pid');
      try { fs.mkdirSync(slot); fs.writeFileSync(pidFile, String(process.pid)); return () => fs.rmSync(slot, { recursive: true, force: true }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
      let pid = 0; try { pid = Number(fs.readFileSync(pidFile, 'utf8')) || 0; } catch {}
      let young = false; try { young = Date.now() - fs.statSync(slot).mtimeMs < 60000; } catch {}
      if (pid ? !alive(pid) : !young) { try { if ((Number(fs.readFileSync(pidFile, 'utf8')) || 0) === pid) fs.rmSync(slot, { recursive: true, force: true }); } catch { fs.rmSync(slot, { recursive: true, force: true }); } }
    }
    if (Date.now() > until) throw new Error(`Codex bận: cả ${n} lượt (codex.concurrency) đang chạy quá lâu.`);
    sleepMs(300);
  }
}

// image-batch: one child process per draft (draft.mjs image), at most <concurrency> at once (and never more Codex runs
// on the machine than codex.concurrency: the slots above). Each finished image moves the app's Run progress.
export async function imageBatch(args, s = settings()) {
  const brand = need(args, 'brand');
  const limit = Math.max(1, Number(args.concurrency && args.concurrency !== true ? args.concurrency : s.codex.concurrency || 3));
  const all = waitingForImage(brand, !!args.force, s);
  const todo = [], skipped = [];
  for (const d of all) {
    const left = fs.readFileSync(path.join(d.dir, 'prompt.txt'), 'utf8').match(/\{\{\w+\}\}/g);
    if (left) skipped.push({ id: d.id, reason: `prompt.txt còn ${[...new Set(left)].join(', ')}` }); else todo.push(d);
  }
  const results = [];
  let next = 0;
  const one = (d) => new Promise((done) => {
    // The children leave the Run progress to the batch (SA_PROGRESS=off).
    const p = spawn(process.execPath, [fileURLToPath(import.meta.url), 'image', '--id', d.id, ...(args.force ? ['--force'] : [])], { env: { ...process.env, SA_PROGRESS: 'off' }, windowsHide: true });
    let o = '', e = '';
    p.stdout.on('data', (x) => { o += x; }); p.stderr.on('data', (x) => { e += x; });
    p.on('close', () => { let r; try { r = JSON.parse(o); } catch { r = { ok: false, error: (o + e).trim().slice(0, 500) }; } done({ id: d.id, ...r }); });
  });
  const who = brand === 'all' ? '' : brand;
  const tell = (detail) => track('make', { brand: who, detail, items: { label: 'Images', done: results.filter((r) => r.ok !== false).length, total: todo.length } });
  if (todo.length) tell(`images: ${todo.length} to make, ${Math.min(limit, todo.length)} at once`);
  const worker = async () => { while (next < todo.length) { const d = todo[next++]; const r = await one(d); results.push(r); tell(`image ${d.id} ${r.ok === false ? 'failed' : 'done'} (${results.length}/${todo.length})`); } };
  await Promise.all(Array.from({ length: Math.min(limit, todo.length) }, worker));
  return { brand, concurrency: limit, done: results.filter((r) => r.ok !== false).map((r) => r.id), failed: results.filter((r) => r.ok === false).map((r) => ({ id: r.id, error: r.error })), skipped, results,
    next: 'Xem từng ảnh; ảnh đạt thì viết caption (có thể viết trong lúc ảnh khác đang chạy) rồi draft.mjs check.' };
}

export function image(args, s = settings()) {
  const { dir, draft } = findDraft(need(args, 'id'));
  const target = path.join(dir, 'image.png');
  if (fs.existsSync(target) && !args.force) {
    // Main image made: only the album extras still missing (or all again with --force-extras).
    const album = draftImages(draft).length > 1 ? imageExtras(dir, draft, s, { force: !!args['force-extras'] }) : null;
    return ({ id: draft.id, skipped: !album, image: target, ...(album ? { album } : {}), ...(album?.failed.length ? { ok: false, error: album.failed.map((x) => `${x.file}: ${x.error}`).join('; ') } : {}), note: 'Đã có image.png (thêm --force để làm lại).' });
  }
  const prompt = fs.readFileSync(path.join(dir, 'prompt.txt'), 'utf8');
  const left = prompt.match(/\{\{\w+\}\}/g);
  if (left) throw new Error(`prompt.txt còn chỗ chưa điền: ${[...new Set(left)].join(', ')}`);
  if (!fs.existsSync(draft.product_image)) throw new Error('Ảnh sản phẩm không còn.');
  const brandNow = loadBrand(draft.brand);
  if (draft.image_mode === 'scene-swap') {
    if (brandNow.social.product_images?.reference_redraw?.enabled !== true) throw new Error('Thương hiệu đã tắt reference_redraw: bản nháp scene-swap không tạo ảnh được.');
  } else if (!ownImage(brandNow, draft.product_image)) throw new Error('Ảnh sản phẩm không còn là ảnh của thương hiệu.');
  if (brandNow.social.product_images?.ai_scenes_allowed === false) throw new Error('social.json product_images.ai_scenes_allowed = false: không dựng cảnh AI.');
  // Claimed for this process ("generating", under the status lock): two batches (brands in parallel, --brand all
  // twice) never make the same image; a claim older than the Codex timeout is a dead run's and is taken over.
  const statusFile = path.join(dir, 'status.json');
  withLock(statusFile, () => {
    const st = readJson(statusFile, {});
    if (busy(st, s)) throw new Error(`${draft.id} đang được tạo ảnh ở một tiến trình khác.`);
    writeJson(statusFile, { ...st, status: 'generating', tool_status: 'generating', updated: stamp() });
  });
  // An earlier image is kept aside (image-old-<time>.png); the new Codex output becomes image-generated.png.
  if (args.force) for (const f of ['image-generated.png', 'image.png']) if (fs.existsSync(path.join(dir, f))) fs.renameSync(path.join(dir, f), path.join(dir, `image-old-${Date.now()}-${f}`));
  for (const f of ['image-watermarked.png', 'image-clean-report.json']) fs.rmSync(path.join(dir, f), { force: true });
  // codex exec --skip-git-repo-check -s workspace-write - -i <brand product image> [-i <scene ref>] < prompt.txt
  const codexArgs = ['exec', '--skip-git-repo-check', '-s', 'workspace-write', '-', '-i', draft.product_image, ...(draft.scene_image ? ['-i', draft.scene_image] : [])];
  const c = codexCommand(s);
  const q = (a) => (c.shell ? `"${a}"` : a);
  const before = new Set(fs.readdirSync(dir));
  let r, log = '', retried = false, release;
  try { release = takeCodexSlot(s); } catch (e) { setStatus(dir, 'image_failed', { error: e.message }); throw e; }
  try {
    const runCodex = () => c.shell
    // A .cmd shim needs the shell; it gets one command string (no args array with shell: true, Node DEP0190).
      ? spawnSync([c.file, ...c.pre, ...codexArgs].map(q).join(' '), { cwd: dir, input: prompt, encoding: 'utf8', shell: true, timeout: s.codex.timeout_minutes * 60000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
      : spawnSync(c.file, [...c.pre, ...codexArgs], { cwd: dir, input: prompt, encoding: 'utf8', timeout: s.codex.timeout_minutes * 60000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    // A rate-limit/quota answer: wait (codex.retry_wait_seconds), try once more, then image_failed.
    const wait = Number(process.env.SA_CODEX_RETRY_WAIT_SECONDS ?? s.codex.retry_wait_seconds ?? 60);
    for (let attempt = 1; ; attempt++) {
      r = runCodex();
      log += `$ codex ${codexArgs.join(' ')} < prompt.txt   (attempt ${attempt})\n\n${r.stdout || ''}\n${r.stderr || ''}\n${r.error ? 'ERROR ' + r.error.message : ''}\n`;
      fs.writeFileSync(path.join(dir, 'codex.log'), log, 'utf8');
      if (fs.existsSync(target) || attempt > 1 || !QUOTA.test(`${r.stdout}${r.stderr}`)) break;
      retried = true;
      log += `\n-- rate limit / quota: waiting ${wait}s, then one retry --\n\n`;
      sleepMs(wait * 1000);
    }
  } finally { release(); }
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
  // Album: the extras follow the NEW main image (same scene), so they are made again after every main image.
  const album = draftImages(draft).length > 1 ? imageExtras(dir, draft, s, { force: true }) : null;
  const st2 = readJson(path.join(dir, 'status.json'));
  return ({ id: draft.id, image: target, images: draftImages(draft).map((x) => path.join(dir, x)), ...(album ? { album } : {}), ...(album?.failed.length ? { album_failed: album.failed } : {}), ...(retried ? { retried_after_rate_limit: true } : {}), original: cleaned.original, metadata_removed: cleaned.removed, warnings: logoWarnings(prompt), status: st2.status, next: `Xem ${album ? 'mọi ảnh (image.png là ảnh bìa)' : 'ảnh'}; nếu đạt, viết caption theo brief.md rồi chạy draft.mjs check --id ${draft.id}.` });
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
  if (!wm.file || !inside(brand.dir, logo) || !fs.existsSync(logo)) throw new Error('product_images.watermark.file phải là file logo có thật trong thư mục thương hiệu (project/sources/..., tương đối theo thư mục thương hiệu).');
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
  const noPeople = args['no-people'] === true || args['no-people'] === 'true';
  if (refModeOf(draft) === 'new-scene' && !noPeople) throw new Error('new-scene: LOOK for people too; once no person (face, body, hand, silhouette) is left in image.png add --no-people.');
  const missing = draftImages(draft).filter((x) => !fs.existsSync(path.join(dir, x)));
  if (missing.length) throw new Error(`Album: chưa có ${missing.join(', ')}; xem đủ mọi ảnh rồi xác nhận.`);
  const imageHash = albumHash(dir, draft); // every image of the post (album) or image.png alone
  const st = setStatus(dir, readJson(path.join(dir, 'status.json'), {}).status, { logo_check: { confirmed: stamp(), by: need(args, 'by'), image_sha1: imageHash, ...(noPeople ? { no_people: true } : {}), note: args.note && args.note !== true ? String(args.note) : '' } });
  return { id: draft.id, status: st.status, logo_check: st.logo_check, next: `node scripts/draft.mjs check --id ${draft.id}` };
}

// After every new image the agent MEASURES the product (user 10/11/2026: AI images oversize it) and records it here:
//   --product-pct  product width ÷ image width × 100
//   --object-pct   product width ÷ width of the comparison object (table, sofa, bed, counter) × 100
//   --wall-pct     product width ÷ visible wall width × 100 (optional)
// Over a limit (sizeLimits: tool defaults or social.json product_images.size_limits): regenerate ONCE with
// reprompt --smaller N (suggested below) + image --force, then measure again. Still over: --accept "<reason>" or report it.
// Logged in status.json size_check (+ history); draft check: over the limit for the current image = problem.
export function sizeCheck(args) {
  const { dir, draft, status } = findDraft(need(args, 'id'));
  // keep-scene keeps the reference's own framing: nothing to measure.
  if (refModeOf(draft) === 'keep-scene') return { id: draft.id, skipped: true, framing: 'kept original framing', next: `node scripts/draft.mjs check --id ${draft.id}` };
  const file = path.join(dir, 'image.png');
  if (!fs.existsSync(file)) throw new Error('Chưa có image.png.');
  const num = (k) => (args[k] === undefined || args[k] === true ? null : Number(String(args[k]).replace('%', '')));
  const product = num('product-pct'), object = num('object-pct'), wall = num('wall-pct');
  if (product == null || !(product > 0 && product <= 100)) throw new Error('--product-pct N: product width as % of the image width (1-100).');
  for (const [k, v] of [['object-pct', object], ['wall-pct', wall]]) if (v != null && !(v > 0 && v <= 300)) throw new Error(`--${k} must be a positive percentage.`);
  let social = {}; try { social = loadBrand(draft.brand, { allowDisabled: true }).social; } catch {}
  const limits = sizeLimits(social, draft);
  if (object == null && limits.object_pct_max != null) throw new Error(`--object-pct N: product width as % of the comparison object (${draft.size_compare || 'the furniture below/next to it'}).`);
  const over = [];
  if (limits.frame_pct_max != null && product > limits.frame_pct_max) over.push({ what: 'frame', value: product, max: limits.frame_pct_max });
  if (limits.object_pct_max != null && object != null && object > limits.object_pct_max) over.push({ what: 'object', value: object, max: limits.object_pct_max });
  if (limits.wall_pct_max != null && wall != null && wall > limits.wall_pct_max) over.push({ what: 'wall', value: wall, max: limits.wall_pct_max });
  // Aim at 85% of the limit: a retry lands near the target, not just under the line (AI images drift bigger).
  const ratio = Math.max(1, ...over.map((o) => o.value / (o.max * 0.85)));
  const smaller = over.length ? Math.min(60, Math.max(10, Math.ceil((1 - 1 / ratio) * 100 / 5) * 5)) : 0;
  const accepted = args.accept && args.accept !== true ? String(args.accept) : '';
  const entry = { at: stamp(), by: args.by && args.by !== true ? String(args.by) : 'agent', image_sha1: sha1(fs.readFileSync(file)), product_pct: product, ...(object != null ? { object_pct: object } : {}), ...(wall != null ? { wall_pct: wall } : {}), object: draft.size_compare || '', limits, over, ok: !over.length, ...(accepted ? { accepted } : {}), ...(args.note && args.note !== true ? { note: String(args.note) } : {}) };
  const prev = status.size_check ? (({ history, ...x }) => x)(status.size_check) : null;
  // One entry per image: measuring the same image again replaces its earlier entry.
  const history = [...(status.size_check?.history || []), ...(prev ? [prev] : [])].filter((h) => h.image_sha1 !== entry.image_sha1).slice(-5);
  const st = setStatus(dir, status.status, { size_check: { ...entry, history } });
  const retried = history.some((h) => h.over?.length);  // an earlier image was already too big
  const { history: _h, ...shown } = st.size_check;
  return { id: draft.id, within_limits: entry.ok, over, limits, ...(smaller ? { smaller } : {}), size_check: shown,
    next: entry.ok || accepted ? `node scripts/draft.mjs check --id ${draft.id}`
      : retried ? 'Still too big after a retry: report it (or --accept "<reason>" only for a real close-up); draft check blocks it.'
        : `Regenerate once: node scripts/draft.mjs reprompt --id ${draft.id} --smaller ${smaller}, then draft.mjs image --id ${draft.id} --force; LOOK and size-check again.` };
}

// Contact sheet(s) of draft images: at most perSheet per PNG (3 columns, 512 px tiles), labelled #n + draft id.
export function contactSheets(args, s = settings()) {
  const ids = args.ids && args.ids !== true ? String(args.ids).split(',').map((x) => x.trim()).filter(Boolean) : null;
  const wanted = args.status && args.status !== true ? String(args.status).split(',') : ['needs_caption', 'ready', 'check_failed'];
  const brand = args.brand && args.brand !== true && args.brand !== 'all' ? String(args.brand) : undefined;
  const drafts = ids ? ids.map((id) => findDraft(id)) : listDrafts(brand).filter((d) => wanted.includes(d.status.status));
  const items = drafts.map((d) => ({ id: d.draft?.id || d.id, file: path.join(d.dir, fs.existsSync(path.join(d.dir, 'image-watermarked.png')) ? 'image-watermarked.png' : 'image.png') })).filter((x) => fs.existsSync(x.file));
  const per = Math.max(1, Math.min(12, Number(args['per-sheet']) || 6));
  const outDir = path.resolve(args.out && args.out !== true ? String(args.out) : path.join(workspace, 'pipeline'));
  fs.mkdirSync(outDir, { recursive: true });
  const sheets = [];
  for (let i = 0; i < items.length; i += per) {
    const part = items.slice(i, i + per);
    const r = contactSheet(part.map((x) => ({ file: x.file, label: x.id })), { cols: 3, tw: 512, th: 512, ffmpeg: s.ffmpeg?.command || 'ffmpeg' });
    const file = path.join(outDir, `contact-sheet-${sheets.length + 1}.png`);
    fs.writeFileSync(file, r.png);
    sheets.push({ file, width: r.width, height: r.height, drafts: part.map((x, k) => ({ n: i + k + 1, id: x.id, image: x.file })), missing: r.missing });
  }
  // Older sheets of an earlier, longer run would mislead: drop the extra numbered files.
  for (const f of fs.readdirSync(outDir)) { const m = f.match(/^contact-sheet-(\d+)\.png$/); if (m && Number(m[1]) > sheets.length) fs.unlinkSync(path.join(outDir, f)); }
  return { sheets, count: items.length, without_image: drafts.length - items.length,
    next: items.length ? 'LOOK at every sheet (Read the PNG): product↔setting fit, real size vs surroundings (measure each image: draft.mjs size-check), sign text exact, no logo on the product, no placeholder text. Unsure about one: open its image file.' : 'No draft image to show.' };
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
  if (cmd === 'size-check') return out(sizeCheck(args));
  if (cmd === 'contact-sheet') return out(contactSheets(args, s));
  if (cmd === 'show') return out(summary(findDraft(need(args, 'id'))));
  if (cmd === 'list') return out({ drafts: listDrafts(args.brand && String(args.brand)).filter((d) => !args.status || d.status.status === args.status).map((d) => ({ id: d.id, brand: d.draft.brand, status: d.status.status, dir: d.dir })) });
  throw new Error('Lệnh: new | reprompt | image | image-batch | watermark | confirm-clean | size-check | check | show | list');
});

// Album: one prompt per extra image (prompt-02.txt, ...), filled from prompts/album-extra.txt. {{PRODUCT_DESCRIPTION}}
// stays open like in prompt.txt and is filled with the same text (pipeline fills every prompt*.txt).
const SHOTS = {
  detail: 'detail: a close-up of the product (material, edge, finish, light on it), the same scene softly behind it.',
  wide: 'wide: a wider view or a different angle of the same room/scene, the product at its real size in the same place.',
};
function writeExtraPrompts(dir, draft, brand, sizeFill) {
  const files = draftImages(draft);
  for (let k = 1; k < files.length; k++) {
    fs.writeFileSync(path.join(dir, `prompt-${String(k + 1).padStart(2, '0')}.txt`), fill(fs.readFileSync(path.join(toolRoot, 'prompts', 'album-extra.txt'), 'utf8'), {
      INDEX: String(k + 1), COUNT: String(files.length), MAIN_IMAGE: 'image.png', SHOT: SHOTS[extraShotOf(k)],
      PRODUCT_RULES: projectSection(brand.project, 10) || '(project.md mục 10 trống)', OUTPUT: files[k], ...sizeFill,
    }), 'utf8');
  }
}

// Album extras: each extra is one more Codex run (its own global Codex slot), input = the clean main image.png
// (+ the product photo), output image-0k.png, cleaned by the remove-watermark skill like the main image.
// Status per image in status.json images { <file>: { state: ok|failed, sha1 (clean copy), error } }.
function imageExtras(dir, draft, s, { force = false } = {}) {
  const files = draftImages(draft).slice(1), done = [], failed = [];
  for (const f of files) {
    const target = path.join(dir, f), k = f.match(/(\d+)\.png$/)[1];
    if (fs.existsSync(target) && !force) { done.push(f); continue; }
    const promptFile = path.join(dir, `prompt-${k}.txt`);
    const prompt = fs.existsSync(promptFile) ? fs.readFileSync(promptFile, 'utf8') : '';
    const left = prompt.match(/\{\{\w+\}\}/g);
    const fail = (error) => { failed.push({ file: f, error }); const st = readJson(path.join(dir, 'status.json'), {}); setStatus(dir, st.status, { images: { ...(st.images || {}), [f]: { state: 'failed', error } } }); };
    if (!prompt || left) { fail(`prompt-${k}.txt ${prompt ? `còn ${[...new Set(left)].join(', ')}` : 'không có'}`); continue; }
    const raw = path.join(dir, `image-${k}-generated.png`);
    if (force && fs.existsSync(target)) fs.renameSync(target, path.join(dir, `image-old-${Date.now()}-${f}`));
    fs.rmSync(raw, { force: true });
    const codexArgs = ['exec', '--skip-git-repo-check', '-s', 'workspace-write', '-', '-i', path.join(dir, 'image.png'), '-i', draft.product_image];
    const c = codexCommand(s), q = (a) => (c.shell ? `"${a}"` : a);
    const before = new Set(fs.readdirSync(dir));
    let r, release;
    try { release = takeCodexSlot(s); } catch (e) { fail(e.message); continue; }
    try {
      r = c.shell
        ? spawnSync([c.file, ...c.pre, ...codexArgs].map(q).join(' '), { cwd: dir, input: prompt, encoding: 'utf8', shell: true, timeout: s.codex.timeout_minutes * 60000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
        : spawnSync(c.file, [...c.pre, ...codexArgs], { cwd: dir, input: prompt, encoding: 'utf8', timeout: s.codex.timeout_minutes * 60000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
      fs.appendFileSync(path.join(dir, 'codex.log'), `\n$ codex ${codexArgs.join(' ')} < prompt-${k}.txt\n\n${r.stdout || ''}\n${r.stderr || ''}\n${r.error ? 'ERROR ' + r.error.message : ''}\n`, 'utf8');
    } finally { release(); }
    if (!fs.existsSync(target)) { const fresh = fs.readdirSync(dir).filter((x) => !before.has(x) && /\.png$/i.test(x)); if (fresh.length === 1) fs.renameSync(path.join(dir, fresh[0]), target); }
    if (!fs.existsSync(target)) { fail(QUOTA.test(`${r.stdout}${r.stderr}`) ? 'Codex hết hạn mức ảnh' : `Codex không tạo được ${f} (mã ${r.status})`); continue; }
    fs.renameSync(target, raw);
    try {
      const sha = cleanExtraImage(raw, target, s);
      const st = readJson(path.join(dir, 'status.json'), {});
      setStatus(dir, st.status, { images: { ...(st.images || {}), [f]: { state: 'ok', sha1: sha, updated: stamp() } }, logo_check: null });
      done.push(f);
    } catch (e) { fail(e.message); }
  }
  return { done, failed };
}
