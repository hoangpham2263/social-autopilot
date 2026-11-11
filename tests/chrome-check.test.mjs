// Chrome check (scripts/chrome-check.mjs): script generation, page classification, recording, status, gate. Pure.
// npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkScript, classifyPage, recordCheck, checkStatus, unavailableOf, unavailableLines, assertGate, parseResult, HOMES } from '../scripts/chrome-check.mjs';

test('check script: valid async function, only the given platforms, bounded waits, read only', () => {
  const code = checkScript(['facebook', 'pinterest']);
  assert.doesNotThrow(() => new Function(`return (${code})`));
  assert.ok(code.includes(HOMES.facebook) && code.includes(HOMES.pinterest) && !code.includes(HOMES.houzz));
  assert.ok(code.includes('page.bringToFront()') && code.includes('visibilityState') && code.includes('hasFocus'));
  assert.ok(!/waitForFunction|\.click\(|\.fill\(|\.type\(|token/.test(code));
  assert.ok(/timeout: 6000/.test(code) && /34000/.test(code));
});

test('classifyPage: login walls, captcha, no-login platforms', () => {
  assert.deepEqual(classifyPage('facebook', { url: 'https://www.facebook.com/login/?next=x', text: '' }), { signed_in: false, wall: 'login' });
  assert.deepEqual(classifyPage('facebook', { url: 'https://www.facebook.com/', loginForm: true }), { signed_in: false, wall: 'login' });
  assert.deepEqual(classifyPage('facebook', { url: 'https://www.facebook.com/', loggedInHint: true }), { signed_in: true, wall: null });
  assert.deepEqual(classifyPage('instagram', { url: 'https://www.instagram.com/accounts/login/' }), { signed_in: false, wall: 'login' });
  assert.equal(classifyPage('pinterest', { url: 'https://www.pinterest.com/', text: 'Verify you are human' }).wall, 'captcha');
  assert.deepEqual(classifyPage('etsy', { url: 'https://www.etsy.com/', text: 'Welcome' }), { signed_in: 'unknown', wall: null });
});

test('recordCheck: refuses ok with hidden, keeps old flags (no result)', () => {
  assert.throws(() => recordCheck({ state: 'ok', result: { ok: true, hidden: true } }), /bringToFront/);
  assert.throws(() => recordCheck({ state: 'ok', result: { ok: false } }), /ok:false/);
  const r = recordCheck({ state: 'ok', result: { ok: true, hidden: false, tabs: 2, platforms: { facebook: { signed_in: false, wall: 'login', ms: 5 }, etsy: { signed_in: 'unknown', wall: null } } }, now: new Date('2026-11-11T10:00:00Z') });
  assert.equal(r.hidden, false); assert.equal(r.tabs, 2); assert.equal(r.platforms.facebook.signed_in, false);
  assert.deepEqual(unavailableOf(r), { facebook: 'signed out' });
  assert.deepEqual(unavailableLines(unavailableOf(r)), ['Facebook: signed out - skipped']);
  assert.equal(recordCheck({ state: 'fail', note: 'no browser' }).state, 'fail');
});

test('parseResult: JSON, string-wrapped JSON, MCP text', () => {
  assert.equal(parseResult('{"ok":true}').ok, true);
  assert.equal(parseResult(JSON.stringify('{"ok":true}')).ok, true);
  assert.equal(parseResult('### Result\n{"ok":true,"hidden":false}\n').hidden, false);
});

test('checkStatus: not run, ok, expired, failed; gate only when required', () => {
  const now = Date.parse('2026-11-11T10:30:00Z');
  const ok = recordCheck({ state: 'ok', result: { ok: true, hidden: false, platforms: {} }, now: new Date('2026-11-11T10:20:00Z') });
  assert.equal(checkStatus(null, 30, now).reason, 'not run');
  assert.equal(checkStatus(ok, 30, now).ok, true);
  assert.equal(checkStatus(ok, 30, now).age_minutes, 10);
  assert.equal(checkStatus(ok, 5, now).reason, 'expired');
  assert.equal(checkStatus({ ...ok, state: 'fail', note: 'x' }, 30, now).ok, false);
  assert.deepEqual(assertGate(now, false), { required: false, unavailable: {} }); // off: never refuses
});
