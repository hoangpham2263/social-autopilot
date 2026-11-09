// The read-only status page: built from a throw-away workspace (two drafts waiting, one scene-swap, one approved), it is
// one self-contained HTML file with the data embedded, images by relative path (no base64) and nothing written to the
// brand folders. Set SA_DASHBOARD_KEEP=1 to keep the demo folder (for a visual check) instead of deleting it.
// npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

// A small valid PNG (solid colour), so clean-image and check-post accept it.
function png(w = 8, h = 8, rgb = [200, 120, 40]) {
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const tool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'social-autopilot-dashboard-'));
const ws = path.join(tmp, 'workspace');
const skills = path.join(tmp, 'skills');
const outFile = path.join(tmp, 'dashboard.html');
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };
const json = (file, data) => write(file, JSON.stringify(data, null, 2));
const realSkills = path.resolve(tool, '..', 'vaniecom-workspace', 'skills');

// Every file of a folder with its size and mtime: the brand folders must be the same after the page is built.
const snapshot = (dir) => fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).sort().map((f) => { const st = fs.statSync(path.join(dir, f)); return `${f} ${st.size} ${st.mtimeMs}`; }).join('\n') : '';

function draft(brand, id, { status, mode = 'brand-image', captions = { vn: 'Caption tiếng Việt.\n#Brand', en: 'English caption.\n#Brand' }, extra = {} }) {
  const dir = path.join(ws, 'drafts', brand, id);
  json(path.join(dir, 'draft.json'), {
    id, brand, created: '2026-11-09T01:00:00.000Z', image_mode: mode, languages: Object.keys(captions),
    idea: { product_type: 'neon chữ để bàn', scene: 'bàn ăn tối', angle: 'ngang tầm mắt' },
    inspiration: { run: '2026-11-09', ref: 'shop-a/R01', post_url: 'https://www.facebook.com/shopa/posts/1', source_shop: mode === 'scene-swap' ? 'Shop A' : '' },
    networks: [{ network: 'facebook' }, { network: 'instagram' }],
    captions: Object.fromEntries(Object.keys(captions).map((l) => [l, `content-${l}.txt`])),
    ...(mode === 'scene-swap' ? { reference_image: path.join(ws, 'runs', brand, '2026-11-09', 'shop-a', 'refs', 'R01-abc.png') } : {}),
  });
  json(path.join(dir, 'status.json'), { status, updated: '2026-11-09T01:30:00.000Z', ...extra });
  write(path.join(dir, 'image.png'), png(64, 64, [230, 120, 60]));
  for (const [l, t] of Object.entries(captions)) write(path.join(dir, `content-${l}.txt`), t);
}

test.before(() => {
  fs.mkdirSync(skills, { recursive: true });
  for (const name of ['dreamyvows-skills', 'grenheim-skills']) {
    const src = path.join(realSkills, name);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(skills, name), { recursive: true, filter: (s) => !/[\\/]workspace[\\/]local([\\/]|$)|[\\/]\.git([\\/]|$)/.test(s) });
  }
  json(path.join(ws, 'runs', 'dreamyvows', '2026-11-09', 'run.json'), { brand: 'dreamyvows', date: '2026-11-09', status: 'ingested', sources: [{ id: 'shop-a', name: 'Shop A', url: 'https://www.facebook.com/shopa' }, { id: 'shop-b', name: 'Shop B', url: 'https://www.facebook.com/shopb' }] });
  json(path.join(ws, 'runs', 'dreamyvows', '2026-11-09', 'shop-a', 'refs.json'), { refs: [{ id: 'R01', caption: 'x', image: 'refs/R01-abc.png' }, { id: 'R02', caption: 'y', image: 'refs/R02-def.png' }] });
  write(path.join(ws, 'runs', 'dreamyvows', '2026-11-09', 'shop-a', 'raw.json'), '[]');
  write(path.join(ws, 'runs', 'dreamyvows', '2026-11-09', 'shop-a', 'refs', 'R01-abc.png'), png(64, 64, [40, 90, 200]));
  json(path.join(ws, 'runs', 'dreamyvows', '2026-11-09', 'ideas.json'), { ideas: [{ id: 'I01', status: 'drafted' }, { id: 'I02', status: 'todo' }, { id: 'I03', status: 'rejected' }] });
  draft('dreamyvows', 'dreamyvows-20261109-01', { status: 'awaiting_approval', captions: { vn: 'Đèn neon "Love" </script><b>x</b>\n🌐 Website: https://dreamyvows.com/\n#DreamyVows', en: 'Neon "Love".\n#DreamyVows' } });
  draft('dreamyvows', 'dreamyvows-20261109-02', { status: 'awaiting_approval', mode: 'scene-swap', extra: { logo_check: { by: 'agent', confirmed: '2026-11-09T01:20:00.000Z' } } });
  // Approved: one with a hosted image link (media_url in its catalog), one without.
  const catalog = path.join(tmp, 'catalog.json');
  json(catalog, { posts: [{ id: 'POST-07', status: 'approved', media_url: 'https://raw.githubusercontent.com/x/y/main/dreamyvows/2026/11/post-07.png' }, { id: 'POST-08', status: 'approved' }] });
  draft('dreamyvows', 'dreamyvows-20261109-03', { status: 'approved', extra: { by: 'Hoang', approved: '2026-11-09T01:40:00.000Z', brand_post: { id: 'POST-07', folder: 'workspace/posts/POST-07-neon-love', catalog } } });
  draft('dreamyvows', 'dreamyvows-20261109-05', { status: 'approved', extra: { by: 'Hoang', approved: '2026-11-09T01:50:00.000Z', brand_post: { id: 'POST-08', folder: 'workspace/posts/POST-08-neon', catalog } } });
  draft('dreamyvows', 'dreamyvows-20261109-04', { status: 'image_failed', extra: { error: 'Codex hết lượt' } });
  // One error now (counted), one long ago (not counted: only the last 24 hours).
  const now = new Date().toISOString();
  write(path.join(ws, 'logs', `${now.slice(0, 10)}.log`), `[2020-01-01T00:00:00.000Z] brands.mjs  -> error: old\n[${now}] research.mjs start --brand grenheim -> error: research.max_per_day = 0.\n` +
    // Mistyped commands and non-pipeline scripts: not counted.
    `[${now}] draft.mjs nwe --brand x -> error: Lệnh: new | image | watermark | confirm-clean | check | show | list\n[${now}] research.mjs start -> error: Thiếu --brand.\n[${now}] draft.mjs show --id zz -> error: Không có bản nháp zz.\n[${now}] brands.mjs  -> error: something\n`);
});
test.after(() => { if (process.env.SA_DASHBOARD_KEEP) console.log(`dashboard demo kept: ${outFile}`); else fs.rmSync(tmp, { recursive: true, force: true }); });

test('builds one self-contained, read-only status page', () => {
  const before = snapshot(skills);
  const r = spawnSync(process.execPath, [path.join(tool, 'scripts', 'dashboard.mjs'), '--out', outFile], { env: { ...process.env, SA_WORKSPACE: ws, SA_SKILLS_ROOT: skills }, encoding: 'utf8' });
  const res = JSON.parse(r.stdout);
  assert.equal(res.ok, true, r.stdout + r.stderr);
  assert.equal(res.awaiting_approval, 2);
  assert.equal(snapshot(skills), before, 'no brand file written');

  const html = fs.readFileSync(outFile, 'utf8');
  assert.ok(!/data:image\/(png|jpe?g|webp)/.test(html), 'images are referenced, not embedded');
  assert.ok(!/<script[^>]+src=/i.test(html), 'no external script');
  assert.equal((html.match(/<\/script>/g) || []).length, 2, 'a caption cannot close the data block');
  const data = JSON.parse(/<script id="sa-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.equal(data.refresh, 'node scripts/dashboard.mjs');
  assert.ok(data.generated_at);

  const waiting = data.drafts.filter((d) => d.status === 'awaiting_approval');
  assert.equal(waiting.length, 2);
  const first = waiting.find((d) => d.id === 'dreamyvows-20261109-01');
  assert.match(first.image, /^workspace\/drafts\/dreamyvows\/dreamyvows-20261109-01\/image\.png$/);
  assert.deepEqual(first.captions.map((c) => c.lang).sort(), ['en', 'vn']);
  assert.equal(first.inspiration, 'https://www.facebook.com/shopa/posts/1');
  const swap = waiting.find((d) => d.image_mode === 'scene-swap');
  assert.match(swap.reference_image, /refs\/R01-abc\.png$/);
  assert.equal(swap.source_shop, 'Shop A');
  const approved = data.drafts.filter((d) => d.brand_post);
  assert.equal(approved.find((d) => d.brand_post.id === 'POST-07').brand_post.media_url, 'https://raw.githubusercontent.com/x/y/main/dreamyvows/2026/11/post-07.png');
  assert.equal(approved.find((d) => d.brand_post.id === 'POST-08').brand_post.media_url, '');
  assert.equal(res.approved, 2);
  assert.equal(res.hosted, 1);
  assert.match(html, /chưa có link/);

  // Only the main sections: no research runs, settings or error table; errors are just a count.
  assert.deepEqual(Object.keys(data).sort(), ['brands', 'drafts', 'errors', 'generated_at', 'metricool', 'refresh', 'skills_root']);
  assert.equal(data.errors.count, 1);
  assert.equal(res.errors_24h, 1);
  // Xem trước Facebook on each waiting draft: the same preview data as the app (scripts/preview.mjs), media by relative path.
  assert.ok(waiting.every((d) => d.preview && d.preview.posts.length), 'preview on every waiting draft');
  const fb = first.preview.posts.find((p) => p.network === 'facebook');
  assert.ok(fb.texts.some((t) => /Đèn neon "Love"/.test(t.text)), 'caption text in the preview');
  assert.equal(first.preview.media[0].url, first.image);
  assert.ok(data.drafts.filter((d) => d.status !== 'awaiting_approval').every((d) => d.preview === null), 'preview only for waiting drafts');
  assert.match(html, /Xem trước Facebook/);
  // Metricool brands from config/metricool-brands.json via brandOverview: Fortera has no skill.
  const fortera = data.metricool.brands.find((b) => /Fortera/.test(b.name));
  if (fortera) { assert.equal(fortera.skill_id, null); assert.equal(fortera.skill, null); }
  assert.ok(data.metricool.brands.every((b) => typeof b.tz_mismatch === 'boolean'));
  assert.ok(data.metricool.brands.filter((b) => b.skill).every((b) => b.skill.missing.every((m) => !/[a-z_]+\.[a-z_]+/.test(m))), 'plain words');
  assert.match(html, /Chưa có bộ skill/);
  if (fs.existsSync(path.join(skills, 'grenheim-skills'))) {
    const g = data.brands.find((b) => b.id === 'grenheim');
    assert.ok(g, 'brand from skillsRoot');
    assert.equal(typeof g.sources, 'number');
    assert.ok(g.missing.every((m) => typeof m === 'string' && !/[a-z_]+\.[a-z_]+/.test(m)), `plain words, no field names: ${g.missing}`);
  }
});

test('without --out, a run with SA_WORKSPACE writes inside that workspace, never the tool root', () => {
  const real = path.join(tool, 'dashboard.html');
  const before = fs.existsSync(real) ? fs.statSync(real).mtimeMs : null;
  const r = spawnSync(process.execPath, [path.join(tool, 'scripts', 'dashboard.mjs')], { env: { ...process.env, SA_WORKSPACE: ws, SA_SKILLS_ROOT: skills }, encoding: 'utf8' });
  const res = JSON.parse(r.stdout);
  assert.equal(res.ok, true, r.stdout + r.stderr);
  assert.equal(path.resolve(res.file), path.resolve(ws, 'dashboard.html'));
  assert.ok(fs.existsSync(path.join(ws, 'dashboard.html')));
  assert.equal(fs.existsSync(real) ? fs.statSync(real).mtimeMs : null, before, 'real dashboard.html untouched');
});

test('error count: only pipeline failures, not mistyped commands', async () => {
  const { isPipelineError } = await import('../scripts/dashboard.mjs');
  const t = '[2026-11-09T01:00:00.000Z] ';
  assert.equal(isPipelineError(t + 'draft.mjs image --id x -> error: Codex hết lượt'), true);
  assert.equal(isPipelineError(t + 'host-image.mjs publish --post POST-01 -> error: git push lỗi'), true);
  assert.equal(isPipelineError(t + 'draft.mjs nwe -> error: Lệnh: new | image'), false);
  assert.equal(isPipelineError(t + 'research.mjs start -> error: Thiếu --brand.'), false);
  assert.equal(isPipelineError(t + 'draft.mjs image --id zz -> error: Không có bản nháp zz.'), false);
  assert.equal(isPipelineError(t + 'brands.mjs  -> error: x'), false);
  assert.equal(isPipelineError(t + 'draft.mjs image -> ok'), false);
});

test('missing items read in plain Vietnamese', async () => {
  const { plainProblem } = await import('../scripts/dashboard.mjs');
  assert.equal(plainProblem('thiếu approval.owner (người duyệt)'), 'Chưa có người duyệt');
  assert.equal(plainProblem('thiếu cadence.slots: ít nhất 1 giờ đăng'), 'Chưa có giờ đăng');
  assert.equal(plainProblem('thiếu điều gì đó lạ'), 'Thiếu điều gì đó lạ');
});
