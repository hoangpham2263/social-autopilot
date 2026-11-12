// Image engine "Google Flow": settings value, prompt text per engine, and draft.mjs register-image (PNG/JPEG download -> sparkle
// removed -> clean copy), run as a child process on a throw-away workspace with a fake remove-watermark skill.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { encodePng } from '../scripts/image/png.mjs';
import { sparkleCover } from '../scripts/image/unsparkle.mjs';
import { fillPrompt, imagesText, FLOW_IMAGES_TEXT, promptList } from '../scripts/prompts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = 640, H = 640;
function picture(star) {
  const data = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; data[i] = 60 + (x * 80) / W; data[i + 1] = 50 + (y * 60) / H; data[i + 2] = 40; data[i + 3] = 255; }
  if (star) { const { cover } = sparkleCover(W, H); for (let p = 0; p < W * H; p++) { const a = 0.32 * cover[p]; if (a) for (let c = 0; c < 3; c++) data[p * 4 + c] = Math.round(data[p * 4 + c] * (1 - a) + 255 * a); } }
  return encodePng({ width: W, height: H, data });
}

test('prompt: empty IMAGES line for codex, the Flow procedure for flow', () => {
  const create = promptList().find((p) => p.mode === 'Create & publish' && p.agent === 'Claude Code');
  assert.ok(create.text.includes('{{IMAGES}}'));
  const codex = fillPrompt(create.text, 'demo', 'defaults', 'SKILL: demo', imagesText('codex'));
  assert.ok(!codex.includes('Google Flow') && !codex.includes('{{IMAGES}}') && !/\n\n/.test(codex));
  const flow = fillPrompt(create.text, 'demo', 'defaults', 'SKILL: demo', imagesText('flow'));
  assert.ok(flow.includes(FLOW_IMAGES_TEXT) && flow.includes('register-image') && flow.includes('docs/flow-images.md'));
  // Other prompts have no IMAGES line.
  for (const p of promptList().filter((x) => x !== create)) assert.ok(!p.text.includes('{{IMAGES}}'));
});

test('register-image: Flow JPG/PNG becomes image.png / image-02.png, sparkle removed, originals kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-flow-'));
  try {
    const skill = path.join(dir, 'skill');
    fs.mkdirSync(path.join(skill, 'scripts'), { recursive: true }); fs.mkdirSync(path.join(skill, 'references', 'providers'), { recursive: true });
    fs.writeFileSync(path.join(skill, 'references', 'providers', 'chatgpt.md'), 'x');
    fs.writeFileSync(path.join(skill, 'scripts', 'strip.mjs'), "import fs from 'node:fs'; import crypto from 'node:crypto'; const a = process.argv, g = (n) => a[a.indexOf(n) + 1]; const b = fs.readFileSync(g('--in')); fs.writeFileSync(g('--out'), b); const h = crypto.createHash('sha256').update(b).digest('hex'); fs.writeFileSync(g('--report'), JSON.stringify({ imageDataIdentical: true, outputChunks: [], removedChunks: [], sourceHash: h, outputHash: h }));");
    const id = 'demo-20261112-01', draftDir = path.join(dir, 'ws', 'drafts', 'demo', id);
    fs.mkdirSync(draftDir, { recursive: true });
    fs.writeFileSync(path.join(draftDir, 'draft.json'), JSON.stringify({ id, brand: 'demo', brand_dir: path.join(dir, 'none'), image_count: 2, idea: {}, inspiration: {}, networks: [], captions: {} }));
    fs.writeFileSync(path.join(draftDir, 'status.json'), JSON.stringify({ status: 'needs_caption' }));
    const run = (...a) => { const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'draft.mjs'), 'register-image', '--id', id, ...a], { encoding: 'utf8', env: { ...process.env, SA_WORKSPACE: path.join(dir, 'ws'), SA_STRIP_SCRIPT: path.join(skill, 'scripts', 'strip.mjs') } }); return JSON.parse(r.stdout); };
    const star = path.join(dir, 'download.png'), plain = path.join(dir, 'plain.png');
    fs.writeFileSync(star, picture(true)); fs.writeFileSync(plain, picture(false));
    const one = run('--from', star, '--n', '1');
    assert.equal(one.ok, true); assert.equal(one.sparkle, 'removed');
    assert.ok(fs.existsSync(path.join(draftDir, 'image.png')) && fs.existsSync(path.join(draftDir, 'image-generated.png')) && fs.existsSync(path.join(draftDir, 'image-generated-flow-original.png')));
    assert.deepEqual(one.images_missing, ['image-02.png']);
    const two = run('--from', plain, '--n', '2');
    assert.equal(two.sparkle, 'none');
    assert.ok(fs.existsSync(path.join(draftDir, 'image-02.png')) && fs.existsSync(path.join(draftDir, 'image-02-flow-original.png')));
    const st = JSON.parse(fs.readFileSync(path.join(draftDir, 'status.json'), 'utf8'));
    assert.equal(st.image_engine, 'flow'); assert.equal(st.sparkle, 'removed'); assert.equal(st.flow_images['image-02.png'].sparkle, 'none');
    assert.ok(fs.readFileSync(star).equals(picture(true)), 'the download is only read');
    // Not an image / out of range.
    fs.writeFileSync(path.join(dir, 'bad.txt'), 'hello');
    const bad = spawnSync(process.execPath, [path.join(root, 'scripts', 'draft.mjs'), 'register-image', '--id', id, '--from', path.join(dir, 'bad.txt')], { encoding: 'utf8', env: { ...process.env, SA_WORKSPACE: path.join(dir, 'ws') } });
    assert.match(JSON.parse(bad.stdout).error, /PNG or JPEG/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// 1K and 2K Flow downloads have the star at different distances from the corner (103/97 and 120/120); with no remove-watermark skill
// folder on the machine the built-in cleaner is used and says so.
test('register-image: star at the 1K and 2K places, built-in cleaner when the skill script is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-flow2-'));
  try {
    const starAt = (right, bottom) => {
      const data = Buffer.alloc(W * H * 4);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; data[i] = 60 + (x * 80) / W; data[i + 1] = 50 + (y * 60) / H; data[i + 2] = 40; data[i + 3] = 255; }
      const { cover } = sparkleCover(W, H, W - right, H - bottom);
      for (let p = 0; p < W * H; p++) { const a = 0.32 * cover[p]; if (a) for (let c = 0; c < 3; c++) data[p * 4 + c] = Math.round(data[p * 4 + c] * (1 - a) + 255 * a); }
      return encodePng({ width: W, height: H, data });
    };
    const id = 'demo-20261112-02', draftDir = path.join(dir, 'ws', 'drafts', 'demo', id);
    fs.mkdirSync(draftDir, { recursive: true });
    fs.writeFileSync(path.join(draftDir, 'draft.json'), JSON.stringify({ id, brand: 'demo', brand_dir: path.join(dir, 'none'), image_count: 2, idea: {}, inspiration: {}, networks: [], captions: {} }));
    fs.writeFileSync(path.join(draftDir, 'status.json'), JSON.stringify({ status: 'needs_caption' }));
    const run = (...a) => { const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'draft.mjs'), 'register-image', '--id', id, ...a], { encoding: 'utf8', env: { ...process.env, SA_WORKSPACE: path.join(dir, 'ws'), SA_STRIP_SCRIPT: path.join(dir, 'no-such-skill', 'strip-png-metadata.mjs') } }); return JSON.parse(r.stdout); };
    const k1 = path.join(dir, '1k.png'), k2 = path.join(dir, '2k.png');
    fs.writeFileSync(k1, starAt(103, 97)); fs.writeFileSync(k2, starAt(120, 120));
    const one = run('--from', k1, '--n', '1');
    assert.equal(one.ok, true, JSON.stringify(one)); assert.equal(one.sparkle, 'removed');
    const two = run('--from', k2, '--n', '2');
    assert.equal(two.sparkle, 'removed', JSON.stringify(two));
    const st = JSON.parse(fs.readFileSync(path.join(draftDir, 'status.json'), 'utf8'));
    assert.equal(st.metadata_clean.cleaner, 'built-in');
    const rep = JSON.parse(fs.readFileSync(path.join(draftDir, 'image-clean-report.json'), 'utf8'));
    assert.equal(rep.cleaner, 'built-in'); assert.equal(rep.imageDataIdentical, true); assert.deepEqual(rep.outputChunks, []);
    assert.ok(fs.existsSync(path.join(draftDir, 'image-generated-flow-original.png')), 'the original is kept');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Run tab Images option: the prompt gets the chosen engine and the pipeline command --image-engine', () => {
  const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');
  assert.ok(html.includes('id="prImages"') && html.includes('data-opt="create"'));
  assert.ok(html.includes('--image-engine ${chosenEngine()}') && html.includes('image_engine: chosenEngine()'));
  const pipe = fs.readFileSync(path.join(root, 'scripts', 'pipeline.mjs'), 'utf8');
  assert.ok(pipe.includes("args['image-engine']") && pipe.includes('image_engine_choice'));
  // The setting stays the default holder: the UI never saves the per-run choice.
  assert.ok(!/postJson\("\/api\/settings"[^)]*prImages/.test(html));
});

// Batch + album (4 images): register-image --n 2..4, flow-brief, the run option --images in the pipeline/UI/prompt text.
test('flow batch: register-image --n 2/3/4, flow-brief for the extras, --images wiring, batch text', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-flow4-'));
  try {
    const id = 'demo-20261112-03', draftDir = path.join(dir, 'ws', 'drafts', 'demo', id);
    fs.mkdirSync(draftDir, { recursive: true });
    fs.writeFileSync(path.join(draftDir, 'draft.json'), JSON.stringify({ id, brand: 'demo', brand_dir: path.join(dir, 'none'), image_count: 4, sign_text: 'Mia & Leo', product_size: '60 cm wide', idea: { scene: 'a cosy bedroom wall' }, inspiration: {}, networks: [], captions: {} }));
    fs.writeFileSync(path.join(draftDir, 'status.json'), JSON.stringify({ status: 'needs_caption' }));
    const env = { ...process.env, SA_WORKSPACE: path.join(dir, 'ws'), HOME: dir, USERPROFILE: dir };
    const draft = (...a) => JSON.parse(spawnSync(process.execPath, [path.join(root, 'scripts', 'draft.mjs'), ...a], { encoding: 'utf8', env }).stdout);
    const file = path.join(dir, 'd.png'); fs.writeFileSync(file, picture(false));
    for (const n of [1, 2, 3, 4]) draft('register-image', '--id', id, '--n', String(n), '--from', file);
    for (const f of ['image.png', 'image-02.png', 'image-03.png', 'image-04.png']) assert.ok(fs.existsSync(path.join(draftDir, f)), f);
    const st = JSON.parse(fs.readFileSync(path.join(draftDir, 'status.json'), 'utf8'));
    assert.equal(st.images['image-04.png'].state, 'ok'); assert.equal(st.flow_images['image-04.png'].sparkle, 'none');
    assert.equal(draft('register-image', '--id', id, '--n', '5', '--from', file).ok, false);
    const b2 = draft('flow-brief', '--id', id, '--n', '2'), b3 = draft('flow-brief', '--id', id, '--n', '3');
    assert.equal(b2.needs_image1_as_reference, true); assert.equal(b2.aspect, '1:1');
    assert.match(b2.prompt, /different camera shot: detail/); assert.match(b3.prompt, /different camera shot: wide/);
    assert.ok(!/Save the result/.test(b2.prompt) && b2.register.includes('--n 2'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.ok(FLOW_IMAGES_TEXT.includes('BATCH') && FLOW_IMAGES_TEXT.includes('WAIT ONCE') && FLOW_IMAGES_TEXT.includes('Thêm vào câu lệnh') && FLOW_IMAGES_TEXT.includes('flow-brief') && FLOW_IMAGES_TEXT.includes('1-4'));
  const pipe = fs.readFileSync(path.join(root, 'scripts', 'pipeline.mjs'), 'utf8');
  assert.ok(pipe.includes("args.images") && pipe.includes('images_choice') && pipe.includes("'--images'") && pipe.includes('needs_image1_as_reference'));
  const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');
  assert.ok(html.includes('id="prImgCount"') && html.includes('--images') && html.includes('setIppMin'));
});
