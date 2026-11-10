// ideas.mjs init / clean: unfilled ideas never pile up or lock Library items (throw-away workspace + brand).
// node --test tests/ideas-restart.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-restart-'));
const skills = path.join(tmp, 'skills'), ws = path.join(tmp, 'workspace');
const env = { ...process.env, SA_WORKSPACE: ws, SA_SKILLS_ROOT: skills, SA_PROGRESS: 'off' };
const run = (...args) => JSON.parse(spawnSync(process.execPath, [path.join(tool, 'scripts', 'ideas.mjs'), ...args, '--brand', 'fakebrand'], { env, encoding: 'utf8', windowsHide: true, cwd: tool }).stdout);
const write = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
const dir = path.join(skills, 'fakebrand-skills');
test.before(() => {
  write(path.join(dir, 'SKILL.md'), '# Fake\n');
  write(path.join(dir, 'project', 'project.md'), '# Fake\n\n- Website: https://fake.example\n- Hashtag cố định: #fakebrand\n\n## 10. Sản phẩm\nA sign.\n');
  write(path.join(dir, 'project', 'social.json'), JSON.stringify({ brand: 'Fake', enabled: true, channels: [{ network: 'facebook', enabled: true, account: 'Fake', lang: ['en'] }], language_policy: { mode: 'single' }, cadence: { posts_per_day: 1, timezone: 'America/New_York' }, product_images: { ai_scenes_allowed: true, size_source: 'project.md 10' }, research: { sources: [{ id: 'shop-a', url: 'https://www.facebook.com/a', enabled: true }] } }));
  write(path.join(dir, 'scripts', 'check-skill.mjs'), 'process.exit(0);\n');
  const list = [1, 2, 3, 4, 5].map((n) => ({ id: `S000${n}`, source_id: 'shop-a', platform: 'facebook', status: 'new', post_url: `https://www.facebook.com/a/posts/${n}`, posted_date: `2026-11-0${n}`, caption: `Ref ${n}`, images: [`images/S000${n}.png`], uses: [] }));
  write(path.join(ws, 'store', 'fakebrand', 'items.json'), JSON.stringify({ next: 5, items: list }));
});
test('init twice, --reset and clean never pile up ideas', () => {
  assert.equal(run('init', '--count', '2').total, 2);
  const b = run('init', '--count', '2');
  assert.equal(b.total, 2, 'unfilled ideas are replaced, not added');
  assert.equal(b.dropped_unfilled, 2);
  // fill one idea: it survives a plain init, but --reset drops it (no draft was made from it)
  run('set', '--id', b.added[0], '--json', JSON.stringify({ product_type: 'sign', scene: 'cafe', angle: 'eye level', caption_structure: 'hook' }));
  const c = run('init', '--count', '1');
  assert.equal(c.total, 2, 'filled idea kept + 1 new');
  const d = run('init', '--count', '1', '--reset');
  assert.equal(d.total, 1);
  assert.equal(run('clean', '--all').left, 0);
  assert.equal(run('init', '--count', '3').items.length, 3, 'all Library items free again');
});
