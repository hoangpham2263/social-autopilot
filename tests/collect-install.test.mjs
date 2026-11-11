// install.js + tiny call file, pending_fit and the fit type check (pure; no browser).
import test from 'node:test';
import assert from 'node:assert/strict';
import { installScript, initScriptCode, callScript } from '../scripts/collect-install.mjs';
import { counters, applyDecisions, matchType } from '../scripts/collect.mjs';
import { pendingFitOf } from '../scripts/research.mjs';

test('install script parses and defines every platform extractor', () => {
  const code = initScriptCode();
  new Function(code);
  for (const p of ['facebook', 'pinterest', 'instagram', 'etsy', 'houzz']) assert.ok(code.includes(`sa["${p}"]`));
  new Function('return ' + installScript());
});

test('call file is tiny, parses, and reports not_installed', () => {
  const c = callScript('pinterest', { found_by: 'x', max: 0, seen: [], post: { url: 'u', token_url: 't' } });
  new Function('return ' + c);
  assert.ok(c.length < 3000);
  assert.ok(c.includes('not_installed') && c.includes('window.__sa'));
});

test('pending_fit = raw posts without a fit decision; read is informational', () => {
  const raw = { posts: [{ collector_id: 'a', product_fit: { type: 't' } }], rejected: [] };
  const c = counters(raw, 3, 5);
  assert.equal(c.read, 3);
  assert.equal(c.pending_fit, 0);
  assert.equal(counters({ posts: [{ collector_id: 'b' }], rejected: [] }, 0, 0).pending_fit, 1);
  assert.equal(counters({ posts: [], rejected: [] }, 2, 0).pending_fit, 0);
  assert.equal(pendingFitOf('/nonexistent-dir'), 0);
});

test('fit refuses unknown types and normalises a unique match', () => {
  const types = ['bar / home bar neon sign', 'wedding neon sign'];
  assert.equal(matchType('Bar / Home Bar Neon Sign', types), 'bar / home bar neon sign');
  assert.equal(matchType('bar home bar neon sign', types), 'bar / home bar neon sign');
  assert.equal(matchType('bar neon sign', types), '');
  const raw = { posts: [{ collector_id: 'a' }, { collector_id: 'b' }], rejected: [] };
  const r = applyDecisions(raw, [{ id: 'a', type: 'Wedding neon sign' }, { id: 'b', type: 'bar neon sign' }], types);
  assert.equal(r.fit, 1);
  assert.deepEqual(r.bad.map((x) => x.id), ['b']);
  assert.equal(r.raw.posts[0].product_fit.type, 'wedding neon sign');
});
