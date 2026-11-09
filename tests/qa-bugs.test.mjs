// QA regression tests (2026-11-09): each test pins a rule the user set (AI labels never on a post, settings saved
// without dropping or resetting keys). Throw-away folders only; never the real brand skills or workspace.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateRows, templateHeader } from '../scripts/metricool-csv.mjs';
import { checkDraft } from '../scripts/draft-lib.mjs';

const tool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'social-autopilot-qa-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const AI_LABELS = ['Ảnh tạo bằng AI #AIgenerated', 'Made with AI', '#madewithai', 'AI-generated image'];

// User rule: never any AI label in captions/CSV. validate only checks the 4 AI-label columns, not Text.
test('QA: metricool validate refuses an AI label inside Text', () => {
  const header = templateHeader();
  const tomorrow = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
  for (const label of AI_LABELS) {
    const row = Object.fromEntries(header.map((h) => [h, '']));
    Object.assign(row, { Text: `Biển neon cho quán.\n${label}`, Date: tomorrow, Time: '10:00:00', Draft: 'false', Facebook: 'true', 'Picture Url 1': 'https://raw.example.invalid/a.png', 'Brand name': 'Dreamy Vows' });
    const v = validateRows([row], { brands: [{ brand_name: 'Dreamy Vows', brand_name_configured: true, timezone: 'Indian/Christmas' }], brand: null, allowToday: false, now: new Date() });
    assert.ok(v.errors.some((e) => e.field === 'Text'), `Text "${label}" passed validate`);
  }
});

// Same rule at draft check: a caption with an AI label must not reach ready (nor the brand, nor Metricool).
test('QA: draft check flags an AI label in a caption', () => {
  const brandDir = path.join(tmp, 'brand');
  fs.mkdirSync(path.join(brandDir, 'project'), { recursive: true });
  fs.writeFileSync(path.join(brandDir, 'project', 'project.md'), '# x\n');
  fs.writeFileSync(path.join(brandDir, 'project', 'social.json'), '{}');
  const dir = path.join(tmp, 'draft');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'content-en.txt'), 'Neon for your shop.\nMade with AI #AIgenerated\n');
  const draft = { id: 'x-20261109-01', brand: 'x', brand_dir: brandDir, captions: { en: 'content-en.txt' }, inspiration: { run: '2026-11-09', ref: '' }, image_mode: 'brand-image' };
  const { problems } = checkDraft(dir, draft, {});
  assert.ok(problems.some((p) => /AI/i.test(p) && /content-en/.test(p)), `no AI-label problem: ${problems.join('; ')}`);
});

// Saving settings with only some keys (API, or a future form without a field) must keep this machine's other values,
// not reset them to config/settings.json (seen: imageHost.path jumped back to the real social-autopilot-sources repo).
test('QA: saveSettings keeps machine values for keys not sent', () => {
  const ws = path.join(tmp, 'ws');
  fs.mkdirSync(ws, { recursive: true });
  const host = path.join(tmp, 'host');
  fs.mkdirSync(host, { recursive: true });
  fs.writeFileSync(path.join(ws, 'settings.json'), JSON.stringify({ imageHost: { type: 'github-repo', path: host, rawBase: 'https://raw.example.invalid/x/main', verify: { attempts: 1, delay_seconds: 0 } } }));
  const code = `import('${path.join(tool, 'scripts', 'lib.mjs').replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:')}').then((m) => { m.saveSettings({ metricool: { default_mode: 'draft' } }); });`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, SA_WORKSPACE: ws, SA_SKILLS_ROOT: tmp }, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  const saved = JSON.parse(fs.readFileSync(path.join(ws, 'settings.json'), 'utf8'));
  assert.equal(path.resolve(saved.imageHost.path), path.resolve(host), 'imageHost.path reset to the default repo');
  assert.equal(saved.imageHost.verify.attempts, 1, 'imageHost.verify reset to defaults');
});
