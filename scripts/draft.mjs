// Step 3: drafts. One folder per draft in workspace/drafts/<brand>/<id>/: draft.json (what it is), status.json (where it
// is), prompt.txt + codex.log + image.png (the brand's own image, made by Codex CLI from the brand's own product photo),
// brief.md and content-<lang>.txt (captions written by the agent in the brand voice, per social.json). Nothing here
// touches the brand folder; that happens only in approve.mjs.
//   node scripts/draft.mjs new   --brand <id> --idea <date>/<Ixx> --product <brand image> [--scene <mood image>]
//   node scripts/draft.mjs image --id <draft> [--force]     runs Codex (prompt.txt must be finished: no {{...}} left)
//   node scripts/draft.mjs check --id <draft>               checks image + captions; ready -> awaiting_approval
//   node scripts/draft.mjs show  --id <draft>
//   node scripts/draft.mjs list  [--brand <id>] [--status s]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { checkDraft, summary } from './draft-lib.mjs';
import { main, out, parseArgs, need, settings, loadBrand, workspace, toolRoot, runDir, readJson, writeJson, today, stamp, inside, sha1, projectSection, projectField, findDraft, setStatus, loadRefs, listDrafts, draftsRoot, hasHidden, sharedWords } from './lib.mjs';

const IMAGE = /\.(png|jpe?g|webp)$/i;
// The brand's own photo: inside its skill folder, or inside a local folder its social.json lists in
// product_images.sources[].path (an absolute path outside the skill, e.g. an import folder).
function ownImage(brand, file) {
  if (inside(brand.dir, file)) return true;
  return [].concat(brand.social.product_images?.sources || []).some((x) => x?.path && !/^https?:/i.test(x.path) && path.isAbsolute(x.path) && inside(x.path, file));
}
const fill = (tpl, map) => tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in map ? map[k] : m));

function newDraft(args) {
  const brand = loadBrand(need(args, 'brand'));
  const [date, ideaId] = need(args, 'idea').split('/');
  const ideasFile = path.join(runDir(brand.id, date), 'ideas.json');
  const ideas = readJson(ideasFile);
  const idea = ideas.ideas.find((i) => i.id === ideaId);
  if (!idea) throw new Error(`Không có ý ${ideaId} trong ${ideasFile}.`);
  if (idea.status !== 'picked' && !(idea.status === 'drafted' && args.again)) throw new Error(`Ý ${ideaId} đang "${idea.status}"; chỉ ý đã pick mới làm nháp (--again để làm thêm bản).`);
  const refs = loadRefs(brand.id, date);
  const ref = refs.find((r) => r.key === idea.ref) || {};

  // The product photo must be the brand's own: a file inside the brand's skill folder (project/sources/, workspace/).
  const product = path.resolve(need(args, 'product'));
  if (!fs.existsSync(product) || !IMAGE.test(product)) throw new Error('Ảnh sản phẩm không có hoặc không phải PNG/JPEG/WebP.');
  if (!ownImage(brand, product)) throw new Error(`Ảnh sản phẩm phải là ảnh của thương hiệu: trong ${brand.dir} hoặc một thư mục product_images.sources[].path của social.json.`);
  if (brand.social.product_images?.ai_scenes_allowed !== true) throw new Error('social.json product_images.ai_scenes_allowed khác true: thương hiệu chưa cho dựng cảnh bằng AI.');
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
    inspiration: { run: date, ref: idea.ref, source: ref.source || '', source_url: ref.source_url || '', post_url: ref.post_url || '' },
    product_image: product, scene_image: scene, networks, languages: brand.languages, language_mode: mode,
    image: 'image.png', captions: Object.fromEntries(brand.languages.map((l) => [l, `content-${l}.txt`])), ai_disclosure: { label: brand.social.product_images?.ai_disclosure_label || '', tool: 'codex' },
  };
  writeJson(path.join(dir, 'draft.json'), draft);
  const second = scene
    ? 'The second attached image is ONLY a mood/lighting reference. Do not copy it and do not take any objects from it.'
    : 'There is no second image.';
  fs.writeFileSync(path.join(dir, 'prompt.txt'), fill(fs.readFileSync(path.join(toolRoot, 'prompts', 'scene-edit.txt'), 'utf8'), {
    SCENE: idea.scene, ANGLE: idea.angle, PROPS: idea.props || 'at most one or two props that fit the scene',
    PRODUCT_RULES: projectSection(brand.project, 10) || '(project.md mục 10 trống)', SECOND_IMAGE: second, OUTPUT: 'image.png',
  }), 'utf8');
  fs.writeFileSync(path.join(dir, 'brief.md'), fill(fs.readFileSync(path.join(toolRoot, 'prompts', 'caption-brief.md'), 'utf8'), {
    BRAND: brand.brand, SKILL: path.join(brand.dir, 'SKILL.md'), PROJECT: path.join(brand.dir, 'project', 'project.md'),
    IDEA: JSON.stringify(draft.idea, null, 2), NETWORKS: networks.map((x) => `- ${x.network} (${x.account || 'chưa có account'}): ${x.lang.join(', ')}`).join('\n') + `\nlanguage_policy.mode: ${mode}${brand.social.language_policy?.note ? ` (${brand.social.language_policy.note})` : ''}`,
    SECTIONS: [].concat(brand.social.caption_rules?.project_md_sections || []).join('; ') || '1, 3, 7, 8, 10, 11',
    AI_LABEL: brand.social.product_images?.ai_disclosure_label || '(chưa có)',
    FILES: brand.languages.map((l) => `- content-${l}.txt`).join('\n'),
    WEBSITE: projectField(brand.project, 'Website') || '(chưa có)', HASHTAG: projectField(brand.project, 'Hashtag cố định') || '(chưa có)',
  }), 'utf8');
  idea.status = 'drafted'; idea.drafts = [...new Set([...(idea.drafts || []), id])]; idea.updated = stamp();
  writeJson(ideasFile, ideas);
  const status = setStatus(dir, 'needs_prompt');
  out({ id, dir, status: status.status, next: `Mở ${path.join(dir, 'prompt.txt')}, thay {{PRODUCT_DESCRIPTION}} bằng mô tả đúng sản phẩm trong ảnh, rồi chạy draft.mjs image --id ${id}. Viết caption theo brief.md.` });
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

function image(args, s) {
  const { dir, draft } = findDraft(need(args, 'id'));
  const target = path.join(dir, 'image.png');
  if (fs.existsSync(target) && !args.force) return out({ id: draft.id, skipped: true, image: target, note: 'Đã có image.png (thêm --force để làm lại).' });
  const prompt = fs.readFileSync(path.join(dir, 'prompt.txt'), 'utf8');
  const left = prompt.match(/\{\{\w+\}\}/g);
  if (left) throw new Error(`prompt.txt còn chỗ chưa điền: ${[...new Set(left)].join(', ')}`);
  if (!fs.existsSync(draft.product_image)) throw new Error('Ảnh sản phẩm không còn.');
  const brandNow = loadBrand(draft.brand);
  if (!ownImage(brandNow, draft.product_image)) throw new Error('Ảnh sản phẩm không còn là ảnh của thương hiệu.');
  if (brandNow.social.product_images?.ai_scenes_allowed !== true) throw new Error('social.json product_images.ai_scenes_allowed khác true: không dựng cảnh AI.');
  if (args.force && fs.existsSync(target)) fs.renameSync(target, path.join(dir, `image-old-${Date.now()}.png`));
  // codex exec --skip-git-repo-check -s workspace-write - -i <brand product image> [-i <scene ref>] < prompt.txt
  const codexArgs = ['exec', '--skip-git-repo-check', '-s', 'workspace-write', '-', '-i', draft.product_image, ...(draft.scene_image ? ['-i', draft.scene_image] : [])];
  const c = codexCommand(s);
  const q = (a) => (c.shell ? `"${a}"` : a);
  const before = new Set(fs.readdirSync(dir));
  setStatus(dir, 'generating');
  const r = spawnSync(c.shell ? `"${c.file}"` : c.file, [...c.pre, ...codexArgs].map(q), { cwd: dir, input: prompt, encoding: 'utf8', shell: c.shell, timeout: s.codex.timeout_minutes * 60000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
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
  const st = setStatus(dir, 'needs_caption', { error: '' });
  out({ id: draft.id, image: target, status: st.status, next: `Xem ảnh; nếu đạt, viết caption theo brief.md rồi chạy draft.mjs check --id ${draft.id}.` });
}

function check(args) {
  const { dir, draft, status } = findDraft(need(args, 'id'));
  if (['approved', 'rejected'].includes(status.status)) return out({ id: draft.id, status: status.status, note: 'Đã xử lý, không kiểm lại.' });
  const { problems } = checkDraft(dir, draft);
  const next = problems.length ? (fs.existsSync(path.join(dir, 'image.png')) ? 'needs_caption' : status.status) : 'awaiting_approval';
  const st = setStatus(dir, next, { problems });
  out({ id: draft.id, status: st.status, problems });
}

main(() => {
  const args = parseArgs();
  const s = settings();
  const cmd = args._[0];
  if (cmd === 'new') return newDraft(args);
  if (cmd === 'image') return image(args, s);
  if (cmd === 'check') return check(args);
  if (cmd === 'show') return out(summary(findDraft(need(args, 'id'))));
  if (cmd === 'list') return out({ drafts: listDrafts(args.brand && String(args.brand)).filter((d) => !args.status || d.status.status === args.status).map((d) => ({ id: d.id, brand: d.draft.brand, status: d.status.status, dir: d.dir })) });
  throw new Error('Lệnh: new | image | check | show | list');
});
