// Library items are not used up (user, 10/11/2026): the same reference may inspire several posts, each from a new
// angle (a different scene OR a different sign_text; same scene + text + product = repeat). Fresh items first, then the least used after a
// cooldown; Removed items (filtered, not suitable or used enough) are never picked; old "used" items migrate back to available with
// their uses; --items picks exact items (ideas.mjs init and pipeline.mjs create pass it through).
// node --test tests/library-reuse.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { encodePng } from '../scripts/contact-sheet.mjs';

const png = (w, h, rgb) => { const b = Buffer.alloc(w * h * 3); for (let i = 0; i < w * h; i++) b.set(rgb, i * 3); return encodePng(w, h, b); };
const tool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-reuse-'));
const skills = path.join(tmp, 'skills'), ws = path.join(tmp, 'workspace');
const env = { ...process.env, SA_WORKSPACE: ws, SA_SKILLS_ROOT: skills, SA_CODEX: path.join(tool, 'tests', 'fake-codex.mjs'), SA_PROGRESS: 'off' };
const run = (script, ...args) => {
  const r = spawnSync(process.execPath, [path.join(tool, 'scripts', script), ...args], { env, encoding: 'utf8', windowsHide: true, cwd: tool });
  try { return JSON.parse(r.stdout); } catch { throw new Error(`${script} ${args.join(' ')}: ${r.stdout}${r.stderr}`); }
};
const write = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
const dir = path.join(skills, 'fakebrand-skills');
const product = path.join(dir, 'product.png'), product2 = path.join(dir, 'product-2.png');
const items = () => JSON.parse(fs.readFileSync(path.join(ws, 'store', 'fakebrand', 'items.json'), 'utf8')).items;
const size = ['--size', '60 cm (24 in) wide'];
const fill = (id, scene) => run('ideas.mjs', 'set', '--brand', 'fakebrand', '--id', id, '--json', JSON.stringify({ product_type: 'wooden sign', scene, angle: 'eye level', caption_structure: 'hook, story, CTA' }));

test.before(() => {
  write(path.join(dir, 'SKILL.md'), '# Fake brand skill\n');
  write(path.join(dir, 'project', 'project.md'), '# Fake\n\n- Website: https://fake.example\n- Hashtag cố định: #fakebrand\n\n## 10. Sản phẩm\nA wooden sign.\n');
  write(path.join(dir, 'project', 'social.json'), JSON.stringify({ brand: 'Fake Brand', enabled: true,
    channels: [{ network: 'facebook', enabled: true, account: 'Fake Brand', lang: ['en'] }], language_policy: { mode: 'single' },
    cadence: { posts_per_day: 1, timezone: 'America/New_York' }, product_images: { ai_scenes_allowed: true, size_source: 'project.md 10' },
    research: { sources: [{ id: 'shop-a', url: 'https://www.facebook.com/a', enabled: true }] } }));
  write(path.join(dir, 'scripts', 'check-skill.mjs'), 'process.exit(0);\n');
  fs.writeFileSync(product, png(64, 64, [150, 100, 60]));
  fs.writeFileSync(product2, png(64, 64, [60, 100, 150]));
  const store = path.join(ws, 'store', 'fakebrand');
  const list = [1, 2, 3, 4, 5].map((n) => ({ id: `S000${n}`, source_id: 'shop-a', post_url: `https://www.facebook.com/a/posts/${n}`, posted_date: `2026-11-0${n}`, caption: `Reference caption ${n}`, images: [`images/S000${n}-1.png`], status: 'new', used_by: [] }));
  // S0005: the old one-shot "used" state, drafted long ago (the draft folder is still there).
  Object.assign(list[4], { status: 'used', used_by: ['I009', 'fakebrand-20261101-01'], used_at: '2026-11-01T10:00:00.000Z' });
  write(path.join(ws, 'drafts', 'fakebrand', 'fakebrand-20261101-01', 'draft.json'), JSON.stringify({ id: 'fakebrand-20261101-01', created: '2026-11-01T10:00:00.000Z', idea: { id: 'I009', scene: 'barn wedding at golden hour' }, product_image: product, sign_text: '' }));
  for (const it of list) write(path.join(store, it.images[0]), png(16, 16, [40 * Number(it.id.slice(-1)), 80, 80]));
  write(path.join(store, 'items.json'), JSON.stringify({ next: 5, items: list }));
  write(path.join(ws, 'settings.json'), JSON.stringify({ planning: { ahead_days: 2 } }));
});

test('pure: fresh first, then least used after the cooldown; a repeat of scene or product+sign is a problem', async () => {
  process.env.SA_WORKSPACE = ws;
  const { pickItems, reuseProblems, counts } = await import('../scripts/store.mjs');
  const now = Date.parse('2026-11-10T12:00:00Z');
  const use = (at, extra = {}) => ({ draft: `b-${at.replace(/-/g, '')}-01`, scene: 'porch', product: product, sign_text: '', at: `${at}T00:00:00.000Z`, ...extra });
  const list = [
    { id: 'A', source_id: 's', status: 'new', uses: [use('2026-10-01'), use('2026-10-02')] },
    { id: 'B', source_id: 's', status: 'new', uses: [use('2026-10-20')] },
    { id: 'C', source_id: 's', status: 'new', uses: [use('2026-11-08')] }, // within the 7-day cooldown
    { id: 'D', source_id: 's', status: 'new', uses: [], posted_date: '2026-11-01' },
    { id: 'E', source_id: 's', status: 'rejected', note: 'used enough', uses: [] },
    { id: 'F', source_id: 's', status: 'rejected', uses: [] },
  ];
  assert.deepEqual(pickItems(list, 10, { cooldownDays: 7, now }).map((x) => x.id), ['D', 'B', 'A'], 'never used, then fewest uses; cooling/removed never');
  assert.deepEqual(pickItems(list, 10, { cooldownDays: 0, now }).map((x) => x.id), ['D', 'B', 'C', 'A']);
  assert.deepEqual(pickItems(list, 10, { cooldownDays: 7, now, busy: new Set(['D']) }).map((x) => x.id), ['B', 'A']);
  const c = counts(list, { cooldownDays: 7, now });
  assert.deepEqual([c.new, c.fresh, c.used, c.ready, c.cooling, c.removed, c.uses], [4, 1, 3, 3, 1, 2, 4]);
  const b = list[1];
  // Reference modes: keep-scene reuses differ by text, new-scene reuses by scene; same scene + same text + same product = repeat.
  assert.equal(reuseProblems(b, { scene: 'Porch!', product, sign_text: '' }).length, 1, 'same scene (normalized) + same text + same product = repeat');
  assert.match(reuseProblems(b, { scene: 'porch', product, sign_text: '' })[0], /change the scene \(new-scene\) or the sign_text \(keep-scene\)/);
  assert.equal(reuseProblems(b, { scene: 'porch', sign_text: '' }).length, 1, 'product unknown: same scene + same text = repeat');
  assert.deepEqual(reuseProblems(b, { scene: 'porch', product, sign_text: 'Cheers' }), [], 'keep-scene: same scene, new text = fine');
  assert.deepEqual(reuseProblems(b, { scene: 'rooftop bar at night', product, sign_text: '' }), [], 'new-scene: new scene, same text = fine');
  assert.deepEqual(reuseProblems(b, { scene: 'porch', product: product2, sign_text: '' }), [], 'same scene + text but another product photo = fine');
  assert.deepEqual(reuseProblems(b, { scene: 'porch' }), [], 'text not chosen yet (ideas set): not a repeat yet');
});

test('migration: old "used" items are available again, uses filled from their drafts; saved by migrate-uses', () => {
  const l = run('store.mjs', 'list', '--brand', 'fakebrand', '--status', 'new');
  assert.equal(l.items.length, 5, 'Available includes the item used before');
  const s = l.items.find((x) => x.id === 'S0005');
  assert.equal(s.status, 'new');
  assert.equal(s.used, 1);
  assert.deepEqual(s.uses.map((u) => [u.draft, u.scene]), [['fakebrand-20261101-01', 'barn wedding at golden hour']]);
  assert.deepEqual([l.counts.new, l.counts.fresh, l.counts.used], [5, 4, 1]);
  assert.match(run('store.mjs', 'list', '--brand', 'fakebrand', '--status', 'used').error, /new, rejected/, 'only Available / Removed');
  assert.equal(run('store.mjs', 'migrate-uses', '--brand', 'fakebrand').brands[0].migrated, 5);
  const s5 = items().find((x) => x.id === 'S0005');
  assert.equal(s5.status, 'new');
  assert.equal(s5.uses.length, 1);
  assert.equal(s5.last_used, '2026-11-01T10:00:00.000Z');
  assert.equal(run('store.mjs', 'migrate-uses', '--brand', 'fakebrand').brands[0].migrated, 0, 'once');
});

test('reuse: allowed from a new angle, a repeat is rejected; --items inside the cooldown with a note', () => {
  const i1 = run('ideas.mjs', 'init', '--brand', 'fakebrand', '--items', 'S0001');
  assert.deepEqual(i1.items, ['S0001']);
  assert.equal(fill(i1.added[0], 'cabin porch at dusk').idea.status, 'ready');
  run('ideas.mjs', 'pick', '--brand', 'fakebrand', '--id', i1.added[0]);
  const d1 = run('draft.mjs', 'new', '--brand', 'fakebrand', '--idea', i1.added[0], '--product', product, ...size);
  assert.equal(d1.ok, true, JSON.stringify(d1));
  let s1 = items().find((x) => x.id === 'S0001');
  assert.equal(s1.status, 'new', 'still available');
  assert.deepEqual(s1.uses.map((u) => [u.draft, u.scene]), [[d1.id, 'cabin porch at dusk']]);

  const i2 = run('ideas.mjs', 'init', '--brand', 'fakebrand', '--items', 'S0001');
  assert.equal(i2.added.length, 1);
  assert.match(i2.notes.join(' '), /cooldown/);
  assert.equal(i2.previous_uses.S0001[0].scene, 'cabin porch at dusk');
  assert.match(i2.reuse_rule, /NEW angle/);
  // The same scene is allowed at the idea step (keep-scene changes the text later); the draft blocks the same scene +
  // the same sign text + the same product.
  const same = fill(i2.added[0], 'Cabin porch at dusk.');
  assert.equal(same.idea.status, 'ready', JSON.stringify(same));
  run('ideas.mjs', 'pick', '--brand', 'fakebrand', '--id', i2.added[0]);
  const rep = run('draft.mjs', 'new', '--brand', 'fakebrand', '--idea', i2.added[0], '--product', product, ...size);
  assert.match(rep.error, /same library item.*already used with this scene and this sign text and product/);
  assert.equal(fs.readdirSync(path.join(ws, 'drafts', 'fakebrand')).filter((d) => d.endsWith('-02')).length, 0, 'no half draft left');
  const d2 = run('draft.mjs', 'new', '--brand', 'fakebrand', '--idea', i2.added[0], '--product', product2, ...size);
  assert.equal(d2.ok, true, JSON.stringify(d2));
  s1 = items().find((x) => x.id === 'S0001');
  assert.equal(s1.uses.length, 2);
  assert.equal(run('store.mjs', 'list', '--brand', 'fakebrand').items.find((x) => x.id === 'S0001').used, 2);
});

test('--items passes through pipeline.mjs create (one brand; only those ideas in the file)', () => {
  assert.match(run('pipeline.mjs', 'create', '--items', 'S0002').error, /one brand/);
  const a = run('pipeline.mjs', 'create', '--brand', 'fakebrand', '--items', 'S0002', '--agent', 'Test');
  assert.equal(a.ok, true, JSON.stringify(a));
  const todo = JSON.parse(fs.readFileSync(a.ideas_file, 'utf8'));
  assert.deepEqual(todo.ideas.map((x) => x._context.item), ['S0002']);
  assert.match(todo.how, /NEW angle/);
});

test('auto pick: fresh first, then reusable after the cooldown; open ideas and cooling items skipped', () => {
  run('ideas.mjs', 'set', '--brand', 'fakebrand', '--id', run('ideas.mjs', 'list', '--brand', 'fakebrand').ideas.find((i) => i.item === 'S0002').id, '--json', JSON.stringify({ product_type: 'wooden sign', scene: 'porch', angle: 'eye level', caption_structure: 'hook' })); // an unfilled idea would be dropped by init
  const r = run('ideas.mjs', 'init', '--brand', 'fakebrand', '--count', '10');
  // S0002 has an open (filled) idea (pipeline), S0001 was used today (cooldown); S0005 was used 9 days ago (reusable).
  assert.deepEqual(r.items, ['S0004', 'S0003', 'S0005']);
  assert.deepEqual(Object.keys(r.previous_uses), ['S0005']);
  assert.equal(r.store_ready_left, 0);
  assert.match(r.warning, /Library low: 0 available posts ready/);
});

test('remove: never picked, --items errors with the reason, restore brings it back; old "retired" migrates to Removed', () => {
  assert.equal(run('store.mjs', 'remove', '--brand', 'fakebrand', '--id', 'S0001', '--note', 'used enough').item.status, 'rejected');
  const rm = run('ideas.mjs', 'init', '--brand', 'fakebrand', '--items', 'S0001'); assert.match(rm.error || JSON.stringify(rm), /S0001 is removed .used enough.: restore it/);
  const l = run('store.mjs', 'list', '--brand', 'fakebrand', '--status', 'rejected');
  assert.deepEqual(l.items.map((x) => [x.id, x.used]), [['S0001', 2]]);
  assert.equal(l.counts.removed, 1);
  assert.match(run('store.mjs', 'remove', '--brand', 'fakebrand', '--id', 'S0001').error, /already removed/);
  assert.equal(run('store.mjs', 'restore', '--brand', 'fakebrand', '--id', 'S0001').item.status, 'new');
  assert.equal(items().find((x) => x.id === 'S0001').uses.length, 2, 'uses kept');
  // A store written with the old separate Retired state: read (and saved by migrate-uses) as Removed, reason kept.
  const file = path.join(ws, 'store', 'fakebrand', 'items.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  Object.assign(raw.items.find((x) => x.id === 'S0004'), { status: 'retired', retired_note: 'too similar to our feed', retired_by: 'user', retired_at: '2026-11-09T00:00:00.000Z' });
  fs.writeFileSync(file, JSON.stringify(raw));
  assert.equal(run('store.mjs', 'migrate-uses', '--brand', 'fakebrand').brands[0].migrated, 1);
  const s4 = items().find((x) => x.id === 'S0004');
  assert.deepEqual([s4.status, s4.note, s4.retired_note], ['rejected', 'too similar to our feed', undefined]);
});
