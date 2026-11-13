// Run tab Sources picker + suggested sources. node --test tests/run-sources.test.mjs
// - scripts/lib.mjs suggestSource / acceptSuggestions / dismissSuggestions (workspace/brands/<id>.json, temp workspace)
// - the picker's scope and label ("k of M", only what is left) evaluated from the marked block of ui/index.html
// - the External sources step of the Research prompts
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-sources-'));
process.env.SA_WORKSPACE = path.join(tmp, 'workspace');
process.env.SA_SKILLS_ROOT = path.join(tmp, 'skills');
const L = await import('../scripts/lib.mjs');
const { fillPrompt, promptList, EXTERNAL_TEXT } = await import('../scripts/prompts.mjs');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const sug = (n, extra = {}) => ({ url: `https://www.facebook.com/page${n}`, name: `Page ${n}`, platform: 'facebook', reason: 'sells the same products', ...extra });

test('suggest: validation (link, http(s), platform, name, reason)', () => {
  assert.throws(() => L.suggestSource('v1', sug(1, { url: 'nope' })), /not a link/);
  assert.throws(() => L.suggestSource('v1', sug(1, { url: 'ftp://x.test/a' })), /http/);
  assert.throws(() => L.suggestSource('v1', sug(1, { platform: 'tiktok' })), /platform/);
  assert.throws(() => L.suggestSource('v1', sug(1, { name: ' ' })), /name/);
  assert.throws(() => L.suggestSource('v1', sug(1, { reason: '' })), /reason/);
  assert.throws(() => L.suggestSource('../x', sug(1)), /brand id/);
  assert.equal(fs.existsSync(L.brandOverrideFile('v1')), false, 'nothing is written for a refused suggestion');
});

test('suggest: dedupe against skill sources, added sources, earlier suggestions; tracking params and www do not matter', () => {
  const known = { knownUrls: ['https://www.instagram.com/known/'], knownIds: ['known'] };
  assert.equal(L.suggestSource('d1', { ...sug(1), url: 'https://instagram.com/known?utm_source=x', platform: 'instagram' }, known).reason, 'already a source');
  const a = L.suggestSource('d1', sug(2, { url: 'https://www.facebook.com/page2/?fbclid=abc#top' }), known);
  assert.equal(a.added, true);
  assert.equal(a.suggestion.url, 'https://www.facebook.com/page2/');
  assert.match(a.suggestion.id, /^sug-/);
  assert.equal(L.suggestSource('d1', sug(2, { url: 'https://facebook.com/PAGE2' }), known).reason, 'already suggested');
  L.saveBrandOverride('d1', { sources_add: [{ id: 'mine', url: 'https://www.facebook.com/mine' }] });
  assert.equal(L.suggestSource('d1', { ...sug(9), url: 'https://facebook.com/mine/' }, known).reason, 'already a source');
  assert.equal(L.readBrandOverride('d1').suggested.length, 1, 'the Brand Edit save kept the suggestion');
});

test('suggest: at most 5 per brand per run (day), the next day starts again', () => {
  const day1 = new Date('2026-11-13T10:00:00Z'), day2 = new Date('2026-11-14T10:00:00Z');
  for (let i = 1; i <= 5; i++) assert.equal(L.suggestSource('m1', sug(i), { now: day1 }).added, true);
  const r = L.suggestSource('m1', sug(6), { now: day1 });
  assert.equal(r.added, false);
  assert.match(r.reason, /limit/);
  assert.equal(L.suggestSource('m1', sug(6), { now: day2 }).added, true);
  assert.equal(L.listSuggested('m1').suggested.length, 6);
});

test('accept: the suggestion becomes an ordinary enabled user source; unknown ids are ignored', () => {
  const s = L.suggestSource('a1', sug(1)).suggestion;
  L.suggestSource('a1', sug(2));
  assert.deepEqual(L.acceptSuggestions('a1', ['nope']).accepted, []);
  const r = L.acceptSuggestions('a1', [s.id, 'nope']);
  assert.equal(r.accepted.length, 1);
  assert.equal(r.pending, 1);
  const ov = L.readBrandOverride('a1');
  assert.equal(ov.sources_add.length, 1);
  assert.deepEqual([ov.sources_add[0].id, ov.sources_add[0].enabled, ov.sources_add[0].platform], [s.id, true, 'facebook']);
  const social = L.applyBrandOverride({ brand: 'A', research: { sources: [] } }, ov);
  assert.deepEqual(L.brandSources(social).map((x) => x.id), [s.id]);
  assert.equal(L.suggestSource('a1', sug(1)).reason, 'already a source');
});

test('dismiss: removed and never suggested again, not even with another spelling of the URL', () => {
  const s = L.suggestSource('x1', sug(1)).suggestion;
  assert.deepEqual(L.dismissSuggestions('x1', [s.id]).dismissed, [s.id]);
  assert.equal(L.readBrandOverride('x1').suggested.length, 0);
  assert.equal(L.suggestSource('x1', sug(1, { url: 'https://facebook.com/page1/?utm_x=1' })).reason, 'dismissed');
  // a Brand Edit save (no suggestion fields) keeps the dismissed list
  L.saveBrandOverride('x1', { posts_per_day: 2 });
  assert.equal(L.suggestSource('x1', sug(1)).reason, 'dismissed');
  assert.equal(L.readBrandOverride('x1').posts_per_day, 2);
});

// ----- the picker: scope + label (the marked block of ui/index.html, evaluated with stubs) -----
const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');
const block = html.slice(html.indexOf('// SRC-SCOPE-BEGIN'), html.indexOf('// SRC-SCOPE-END'));
function picker({ brands, registry = {}, platOff = [], srcOff = [], sugOn = [] }) {
  const ctx = { arr: (v) => (Array.isArray(v) ? v : []), PLATS: ['instagram', 'pinterest', 'facebook', 'etsy', 'houzz'], platOff: new Set(platOff), srcOff: new Set(srcOff), sugOn: new Set(sugOn), modeCounts: Object.fromEntries(Object.entries(registry).map(([id, r]) => [id, { registry: r }])), srcBrands: () => brands };
  return new Function('ctx', `const { arr, PLATS, platOff, srcOff, sugOn, modeCounts, srcBrands } = ctx; ${block}; return { srcScope, srcSumText };`)(ctx);
}
const brand = (id, sources, suggested = []) => ({ id, name: id, sources: sources.map((s) => s[0]), sources_info: sources.map(([i, platform]) => ({ id: i, name: i, platform, url: `https://www.${platform}.com/${i}` })), suggested });
const done = (...ids) => Object.fromEntries(ids.map((i) => [i, { status: 'complete' }]));

test('picker: k of M counts only the rows shown (not fully crawled + suggested), completed ones stay out of the label and in the run', () => {
  const b = brand('b', [['a', 'facebook'], ['c', 'facebook'], ['d', 'pinterest'], ['e', 'pinterest'], ['f', 'instagram']]);
  const p = picker({ brands: [b], registry: { b: done('c', 'f') } });
  const sc = p.srcScope();
  assert.equal(p.srcSumText(sc), '3 of 3', 'M = a, d, e (c and f are complete and hidden)');
  assert.equal(sc.all, true, 'all ticked = no --source flag');
  assert.deepEqual(sc.per.b, ['a', 'c', 'd', 'e', 'f'], 'hidden completed sources stay in the run');
  const p2 = picker({ brands: [b], registry: { b: done('c', 'f') }, srcOff: ['b:d'] });
  assert.equal(p2.srcSumText(p2.srcScope()), '2 of 3');
  assert.equal(p2.srcScope().all, false);
  assert.deepEqual(p2.srcScope().per.b, ['a', 'c', 'e', 'f'], '--source list = ticked remaining + hidden completed');
  const p3 = picker({ brands: [b], registry: { b: done('c', 'f') }, srcOff: ['b:a', 'b:d', 'b:e'] });
  assert.equal(p3.srcSumText(p3.srcScope()), '0 of 3');
  assert.deepEqual(p3.srcScope().per.b, ['c', 'f'], 'only the quick top check remains');
  assert.ok(p3.srcScope().eff > 0);
});

test('picker: an unticked platform drops its sources, hidden completed ones too, and its suggestions', () => {
  const b = brand('b', [['a', 'facebook'], ['c', 'pinterest']], [{ id: 'sug-1', name: 'S', platform: 'pinterest', url: 'https://www.pinterest.com/s', reason: 'r' }]);
  const p = picker({ brands: [b], registry: { b: done('c') }, platOff: ['pinterest'], sugOn: ['b:sug-1'] });
  const sc = p.srcScope();
  assert.equal(p.srcSumText(sc), '1 of 2', 'a + the greyed suggestion are the rows shown; only a is on');
  assert.deepEqual(sc.per.b, ['a']);
  assert.equal(sc.all, false);
});

test('picker: suggested rows are unticked by default; a ticked one goes into --source, an unticked one never breaks "all"', () => {
  const b = brand('b', [['a', 'facebook']], [{ id: 'sug-1', name: 'S1', platform: 'facebook', url: 'https://www.facebook.com/s1', reason: 'r' }, { id: 'sug-2', name: 'S2', platform: 'facebook', url: 'https://www.facebook.com/s2', reason: 'r' }]);
  const p0 = picker({ brands: [b] }).srcScope();
  assert.deepEqual([p0.on, p0.total, p0.all], [1, 3, true]);
  const p1 = picker({ brands: [b], sugOn: ['b:sug-2'] }).srcScope();
  assert.deepEqual([p1.on, p1.total, p1.all, p1.per.b], [2, 3, true, ['a', 'sug-2']]);
});

test('picker: nothing left = "None left" and the brand asks for the External sources step; a suggestion pending means something is left', () => {
  const b = brand('b', [['a', 'facebook'], ['c', 'pinterest']]);
  const p = picker({ brands: [b], registry: { b: done('a', 'c') } });
  const sc = p.srcScope();
  assert.equal(p.srcSumText(sc), 'None left');
  assert.deepEqual(sc.ext.map((x) => x.id), ['b']);
  assert.equal(sc.all, true);
  assert.deepEqual(sc.per.b, ['a', 'c'], 'the top check still runs');
  const withSug = picker({ brands: [brand('b', [['a', 'facebook']], [{ id: 'sug-1', name: 'S', platform: 'facebook', url: 'https://www.facebook.com/s', reason: 'r' }])], registry: { b: done('a') } }).srcScope();
  assert.equal(withSug.ext.length, 0);
  assert.equal(withSug.total, 1);
  // two brands: only the one with nothing left gets the external step
  const two = picker({ brands: [b, brand('z', [['q', 'facebook']])], registry: { b: done('a', 'c') } }).srcScope();
  assert.deepEqual(two.ext.map((x) => x.id), ['b']);
  assert.equal(two.total, 1);
});

test('prompt: {{EXTERNAL}} sits in both Research prompts and is filled only when asked; the numbered steps do not change', () => {
  const research = promptList().filter((p) => p.mode === 'Research only' && p.agent !== 'ChatGPT');
  assert.equal(research.length, 2);
  for (const p of research) {
    assert.ok(p.text.includes('{{EXTERNAL}}'), p.agent);
    const off = fillPrompt(p.text, 'b', 'defaults', 'SKILL: b', '', '');
    const on = fillPrompt(p.text, 'b', 'defaults', 'SKILL: b', '', EXTERNAL_TEXT);
    assert.ok(!off.includes('{{EXTERNAL}}') && !off.includes('External sources'));
    assert.ok(on.includes('EXTRA STEP 1.4b External sources'));
    assert.equal(on.split('\n').length, off.split('\n').length + 1);
    assert.equal(on.split('\n').filter((l) => /^\d+\. /.test(l)).length, off.split('\n').filter((l) => /^\d+\. /.test(l)).length);
  }
  for (const k of ['sources.mjs queries', 'sources.mjs suggest', '--reason', 'max 5', 'do NOT crawl', 'never a private or personal profile']) assert.ok(EXTERNAL_TEXT.includes(k), k);
});
