// Per-brand overrides kept in the tool (workspace/brands/<id>.json) merged over the skill's social.json; the skill is
// read-only. node --test tests/brand-override.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-override-'));
process.env.SA_WORKSPACE = path.join(tmp, 'workspace');
process.env.SA_SKILLS_ROOT = path.join(tmp, 'skills');
const { applyBrandOverride, normalizeOverride, saveBrandOverride, readBrandOverride, brandSocial, brandSources, brandOverrideFile } = await import('../scripts/lib.mjs');

const social = {
  brand: 'X', enabled: true, cadence: { posts_per_week: 7, timezone: 'America/New_York' },
  research: { sources: [
    { id: 'a', url: 'https://www.facebook.com/a', enabled: true },
    { id: 'b', url: 'https://www.facebook.com/b', enabled: true },
    { id: 'c', url: 'https://www.facebook.com/c', enabled: false },
  ] },
};

test('apply: posts_per_day, paused, sources disabled and added; the input is not changed', () => {
  const copy = JSON.stringify(social);
  const s = applyBrandOverride(social, normalizeOverride({ posts_per_day: 2, paused: true, sources_disabled: ['a'], sources_add: [{ id: 'src-d', url: 'https://www.facebook.com/d' }] }));
  assert.equal(JSON.stringify(social), copy);
  assert.equal(s.cadence.posts_per_day, 2);
  assert.equal(s.cadence.timezone, 'America/New_York');
  assert.equal(s.enabled, false);
  assert.deepEqual(brandSources(s).map((x) => x.id), ['b', 'src-d']);
  // An empty override changes nothing; paused false never turns on a brand the skill has off.
  assert.deepEqual(applyBrandOverride(social, normalizeOverride({})), social);
  assert.equal(applyBrandOverride({ ...social, enabled: false }, normalizeOverride({ paused: false })).enabled, false);
  // An added source with the id of a skill source does not duplicate it.
  assert.equal(applyBrandOverride(social, normalizeOverride({ sources_add: [{ id: 'a', url: 'https://x.test/a' }] })).research.sources.length, 3);
});

test('normalize: bad values are refused', () => {
  assert.throws(() => normalizeOverride({ posts_per_day: 0 }), /posts_per_day/);
  assert.throws(() => normalizeOverride({ posts_per_day: 1.5 }), /posts_per_day/);
  assert.throws(() => normalizeOverride({ sources_add: [{ id: 'x', url: 'ftp://x' }] }), /http/);
  assert.throws(() => normalizeOverride({ sources_add: [{ id: 'Bad Id', url: 'https://x.test' }] }), /id/);
  assert.deepEqual(normalizeOverride({ sources_disabled: ['ok', '../x', 'ok'] }).sources_disabled, ['ok']);
});

test('save/read: workspace/brands/<id>.json; brandSocial merges it over the skill file, which stays as it is', () => {
  const dir = path.join(tmp, 'skills', 'x-skills');
  fs.mkdirSync(path.join(dir, 'project'), { recursive: true });
  const file = path.join(dir, 'project', 'social.json');
  fs.writeFileSync(file, JSON.stringify(social));
  const before = fs.readFileSync(file, 'utf8');
  saveBrandOverride('x', { posts_per_day: 4, sources_disabled: ['b'] });
  assert.ok(fs.existsSync(brandOverrideFile('x')));
  assert.equal(readBrandOverride('x').posts_per_day, 4);
  const s = brandSocial(dir);
  assert.equal(s.cadence.posts_per_day, 4);
  assert.deepEqual(brandSources(s).map((x) => x.id), ['a']);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.throws(() => saveBrandOverride('../x', {}), /brand id/);
});
