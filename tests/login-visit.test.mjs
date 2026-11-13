// Check by visiting: the final-URL classifier, the lock refusals and the summary text. No Chrome, no site: everything is injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFinalUrl, visitPlatforms, runVisitCheck, buildSummary, mergeLogins, VISIT_PAGES } from '../core/setup/login-visit.mjs';

const CASES = [
  // [platform, final URL, expected]
  ['facebook', 'https://www.facebook.com/settings', 'logged_in'],
  ['facebook', 'https://www.facebook.com/settings/?tab=account', 'logged_in'],
  ['facebook', 'https://www.facebook.com/login/?next=https%3A%2F%2Fwww.facebook.com%2Fsettings', 'logged_out'],
  ['facebook', 'https://www.facebook.com/login.php?next=x', 'logged_out'],
  ['facebook', 'https://www.facebook.com/checkpoint/1501092823525282/', 'logged_out'],
  ['facebook', 'https://www.facebook.com/', 'unknown'],
  ['instagram', 'https://www.instagram.com/accounts/edit/', 'logged_in'],
  ['instagram', 'https://www.instagram.com/accounts/login/?next=%2Faccounts%2Fedit%2F', 'logged_out'],
  ['instagram', 'https://www.instagram.com/challenge/abc/', 'unknown'],
  ['pinterest', 'https://www.pinterest.com/settings/', 'logged_in'],
  ['pinterest', 'https://www.pinterest.com/login/?next=%2Fsettings%2F', 'logged_out'],
  ['pinterest', 'https://www.pinterest.com/', 'unknown'],
  ['etsy', 'https://www.etsy.com/your/account', 'logged_in'],
  ['etsy', 'https://www.etsy.com/signin?redirect_to=https%3A%2F%2Fwww.etsy.com%2Fyour%2Faccount', 'logged_out'],
  ['etsy', 'https://geo.captcha-delivery.com/captcha/?initialCid=x', 'unknown'],
  ['houzz', 'https://www.houzz.com/settings', 'logged_in'],
  ['houzz', 'https://www.houzz.com/auth/login?next=x', 'logged_out'],
  ['houzz', 'https://www.houzz.com/', 'unknown'],
  ['google', 'https://myaccount.google.com/', 'logged_in'],
  ['google', 'https://accounts.google.com/v3/signin/identifier?continue=x', 'logged_out'],
  ['google', 'https://accounts.google.com/ServiceLogin?continue=x', 'logged_out'],
  ['google', 'https://accounts.google.com/', 'unknown'],
  ['google', 'https://www.google.com/account/about/', 'unknown'],
  // never a verdict
  ['facebook', 'chrome-error://chromewebdata/', 'unknown'],
  ['facebook', 'about:blank', 'unknown'],
  ['facebook', '', 'unknown'],
  ['facebook', 'https://evil.example/login', 'unknown'],
  ['nowhere', 'https://www.facebook.com/login', 'unknown'],
];
test('final-URL classifier: table per platform', () => {
  for (const [p, url, want] of CASES) assert.equal(classifyFinalUrl(p, url), want, `${p} ${url}`);
});
test('classifier takes an injected pages table', () => {
  const pages = { facebook: { ...VISIT_PAGES.facebook, in: /^\/home/ } };
  assert.equal(classifyFinalUrl('facebook', 'https://www.facebook.com/home', pages), 'logged_in');
  assert.equal(classifyFinalUrl('facebook', 'https://www.facebook.com/settings', pages), 'unknown');
});

test('visitPlatforms: one at a time, final URL only, 2 s pause, time cap', async () => {
  let t = 0; const sleeps = [];
  const urls = { 'https://www.facebook.com/settings': 'https://www.facebook.com/login/?next=x', 'https://www.etsy.com/your/account': 'https://www.etsy.com/your/account' };
  let cur = '';
  const cdp = { navigate: async (u) => { cur = urls[u]; return { errorText: '' }; }, currentUrl: async () => cur };
  const r = await visitPlatforms({ platforms: ['facebook', 'etsy'], cdp, sleep: async (ms) => { sleeps.push(ms); t += ms; }, now: () => t });
  assert.deepEqual(r.map((x) => [x.platform, x.state, x.source]), [['facebook', 'logged_out', 'visit'], ['etsy', 'logged_in', 'visit']]);
  assert.ok(sleeps.includes(2000));
  assert.ok(r.every((x) => !JSON.stringify(x).includes('http')));
  t = 0;
  const capped = await visitPlatforms({ platforms: ['facebook', 'etsy'], cdp, sleep: async (ms) => { t += ms; }, now: () => t, capMs: 8000 });
  assert.equal(capped[1].state, 'unknown');
});
test('visitPlatforms: a page that never settles ends at the max time; errors are unknown', async () => {
  let t = 0, n = 0;
  const cdp = { navigate: async () => ({ errorText: '' }), currentUrl: async () => `https://www.facebook.com/settings?x=${n++}` };
  const r = await visitPlatforms({ platforms: ['facebook'], cdp, sleep: async (ms) => { t += ms; }, now: () => t });
  assert.equal(r[0].state, 'logged_in');
  assert.ok(t <= 12000 + 1000);
  const bad = await visitPlatforms({ platforms: ['facebook'], cdp: { navigate: async () => { throw new Error('boom'); }, currentUrl: async () => '' }, sleep: async () => {}, now: () => 0 });
  assert.equal(bad[0].state, 'unknown');
});

test('runVisitCheck refuses while the login window is open, a run is active, or the profile is missing; never starts Chrome', async () => {
  let spawned = 0;
  const base = { platforms: ['facebook'], settings: {}, toolRoot: '/t', workspace: '/w', exists: () => true, which: () => '', env: { CHROME_PATH: '' }, spawnFn: () => { spawned++; throw new Error('must not start'); } };
  await assert.rejects(runVisitCheck({ ...base, locked: () => true }), /in use/);
  await assert.rejects(runVisitCheck({ ...base, locked: () => false, loginWindowOpen: true }), /in use/);
  await assert.rejects(runVisitCheck({ ...base, locked: () => false, runActive: true }), /run is using/);
  await assert.rejects(runVisitCheck({ ...base, locked: () => false, exists: () => false }), /no profile/);
  await assert.rejects(runVisitCheck({ ...base, platforms: [] }), /No site/);
  assert.equal(spawned, 0);
});

test('summary text', () => {
  const at = new Date(2026, 10, 13, 9, 5);
  const rows = [{ name: 'Facebook', state: 'logged_in' }, { name: 'Instagram', state: 'logged_in' }, { name: 'Google (Flow)', state: 'logged_in' }, { name: 'Etsy', state: 'logged_out' }, { name: 'Houzz', state: 'unknown' }];
  const v = buildSummary(rows, { source: 'visit', at });
  assert.equal(v.line, 'Checked 09:05 (visited the pages)');
  assert.equal(v.toast, 'Facebook, Instagram, Google: logged in · Etsy: not logged in · Houzz: could not tell (open the login window)');
  assert.equal(buildSummary(rows, { source: 'cookies', at }).line, 'Checked 09:05 (cookies)');
  assert.match(buildSummary([], { at }).toast, /Nothing to check/);
});

test('merge: a definite visit overrides; unknown rows explain themselves', () => {
  const cookies = [{ platform: 'etsy', name: 'Etsy', state: 'unknown', reason: 'login cookie not confirmed for this site' }, { platform: 'facebook', name: 'Facebook', state: 'logged_in', reason: 'login cookie present' }];
  const plain = mergeLogins(cookies, {});
  assert.match(plain[0].reason, /Cookies cannot tell for Etsy: use Check by visiting/);
  assert.equal(plain[1].source, 'cookies');
  const m = mergeLogins(cookies, { etsy: { state: 'logged_in', reason: 'ok', checked_at: 'x' }, facebook: { state: 'unknown', reason: 'r', checked_at: 'y' } });
  assert.equal(m[0].state, 'logged_in'); assert.equal(m[0].source, 'visit');
  assert.equal(m[1].state, 'logged_in'); // an unknown visit never overrides
});
