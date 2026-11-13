// Own browser (core/setup/own-browser.mjs): settings, launcher command and refusals, lock detection, login status from cookie metadata.
// Fakes only: no browser is started. The cookie reader test builds a temp sqlite file with node:sqlite (skipped when unavailable).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { browserSettings, loginCommand, openLoginBrowser, profileLocked, profileProblem, browserInfo, mapLogins, loginStatus, readCookieMeta, validateBrowserSettings, PLATFORMS, LOGIN_URLS } from '../core/setup/own-browser.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sa-own-'));

test('browser settings defaults and validation', () => {
  const root = tmp();
  assert.deepEqual(browserSettings({}, root), { mode: 'own', headless: true, profileDir: path.join(root, 'workspace', 'browser-profile') });
  assert.equal(browserSettings({ browser: { mode: 'extension', headless: false } }, root).mode, 'own', 'an old stored extension mode is read as own');
  assert.equal(browserSettings({ browser: { headless: false } }, root).headless, false);
  assert.deepEqual(validateBrowserSettings({ mode: 'extension', headless: 'false' }, {}), { mode: 'own', headless: false, profile_dir: 'workspace/browser-profile' }, 'any mode is stored as own, no error');
  assert.equal(validateBrowserSettings({ mode: 'x' }, { mode: 'extension' }).mode, 'own');
  assert.equal(validateBrowserSettings(undefined), undefined);
  for (const bad of [{ headless: 'maybe' }, { profile_dir: '' }, { profile_dir: 'a/secret' }, []]) assert.throws(() => validateBrowserSettings(bad, {}));
});

test('launcher command: user-data-dir, no-first-run, only allow-listed URLs', () => {
  const b = { path: '/x/chrome', kind: 'chrome' };
  const c = loginCommand({ browser: b, profileDir: '/p', plat: 'linux' });
  assert.equal(c.cmd, '/x/chrome');
  assert.deepEqual(c.args.slice(0, 3), ['--user-data-dir=/p', '--no-first-run', '--no-default-browser-check']);
  assert.deepEqual(c.args.slice(3), LOGIN_URLS);
  assert.deepEqual(LOGIN_URLS, ['https://www.facebook.com/', 'https://www.instagram.com/', 'https://www.pinterest.com/', 'https://www.etsy.com/', 'https://www.houzz.com/', 'https://flow.google.com/']);
  assert.equal(loginCommand({ browser: b, profileDir: '/p', plat: 'darwin' }).cmd, 'open');
});

test('openLoginBrowser: creates the profile, one site on request, refuses while a run or the window holds it', () => {
  const root = tmp(), ws = path.join(root, 'workspace'), exe = path.join(root, 'chrome');
  fs.writeFileSync(exe, '');
  const settings = { research: { chrome_path: exe } }, calls = [];
  const start = (cmd, args) => calls.push({ cmd, args });
  const r = openLoginBrowser({ settings, toolRoot: root, workspace: ws, start, locked: () => false });
  assert.equal(r.ok, true);
  assert.ok(fs.existsSync(path.join(root, 'workspace', 'browser-profile')));
  assert.equal(calls[0].args.filter((a) => a.startsWith('https://')).length, 6);
  openLoginBrowser({ platform: 'facebook', settings, toolRoot: root, workspace: ws, start, locked: () => false });
  assert.deepEqual(calls[1].args.filter((a) => a.startsWith('https://')), ['https://www.facebook.com/']);
  assert.throws(() => openLoginBrowser({ platform: 'evil.com', settings, toolRoot: root, workspace: ws, start, locked: () => false }), /Unknown platform/);
  assert.throws(() => openLoginBrowser({ settings, toolRoot: root, workspace: ws, start, runActive: true }), /run is using/);
  assert.throws(() => openLoginBrowser({ settings, toolRoot: root, workspace: ws, start, locked: () => true }), /already open/);
  assert.equal(calls.length, 2);
  assert.ok(browserInfo({ settings, toolRoot: root, workspace: ws, locked: () => true }).window_open);
});

test('profile lock detection and run refusal messages', () => {
  const d = tmp();
  assert.equal(profileLocked(d), false);
  fs.writeFileSync(path.join(d, 'lockfile'), '');
  assert.equal(profileLocked(d), true);
  fs.rmSync(path.join(d, 'lockfile'));
  assert.equal(profileLocked('/p', { exists: () => false, lstat: () => ({}), readlink: () => 'host-4242', alive: (p) => p === 4242 }), true);
  assert.equal(profileLocked('/p', { exists: () => false, lstat: () => ({}), readlink: () => 'host-4243', alive: () => false }), false, 'stale lock of a dead process');
  assert.match(profileProblem({ exists: true, locked: true }), /in use/);
  assert.match(profileProblem({ exists: true, windowOpen: true }), /in use/);
  assert.match(profileProblem({ exists: false, locked: false }), /Open browser to log in/);
  assert.equal(profileProblem({ exists: true, locked: false }), '');
});

test('login status mapping: cookies, expiry, unknown platforms', () => {
  const now = Date.parse('2026-11-13T00:00:00Z'), future = now + 1e9, past = now - 1000;
  const meta = [
    { host: '.facebook.com', name: 'c_user', expires: future }, { host: '.facebook.com', name: 'xs', expires: future },
    { host: '.instagram.com', name: 'sessionid', expires: past },
    { host: '.google.com', name: '__Secure-1PSID', expires: 0 },
  ];
  const by = Object.fromEntries(mapLogins(meta, { now }).map((x) => [x.platform, x]));
  assert.equal(by.facebook.state, 'logged_in');
  assert.equal(by.facebook.required, true);
  assert.equal(by.instagram.state, 'logged_out', 'expired');
  assert.equal(by.pinterest.state, 'logged_out');
  assert.equal(by.pinterest.required, false);
  assert.equal(by.google.state, 'logged_in', 'session cookie');
  assert.equal(by.etsy.state, 'unknown');
  assert.equal(by.houzz.state, 'unknown');
  assert.equal(mapLogins([{ host: '.facebook.com', name: 'c_user', expires: future }], { now }).find((x) => x.platform === 'facebook').state, 'logged_out', 'xs missing');
  assert.ok(mapLogins(null, { profileExists: false }).every((x) => x.state === 'logged_out'));
  assert.equal(mapLogins(null, { failed: 'busy' }).find((x) => x.platform === 'facebook').state, 'unknown');
  assert.equal(PLATFORMS.length, 6);
});

test('loginStatus: injectable reader, failure is Unknown, missing profile is Not logged in', async () => {
  const root = tmp(), profile = path.join(root, 'workspace', 'browser-profile');
  fs.mkdirSync(profile, { recursive: true });
  const ok = await loginStatus({ settings: {}, toolRoot: root, read: async () => [{ host: '.instagram.com', name: 'sessionid', expires: Date.now() + 1e8 }] });
  assert.equal(ok.find((x) => x.platform === 'instagram').state, 'logged_in');
  const bad = await loginStatus({ settings: {}, toolRoot: root, read: async () => { throw new Error('locked'); } });
  assert.ok(bad.every((x) => x.state === 'unknown'));
  const none = await loginStatus({ settings: { browser: { profile_dir: path.join(root, 'nope') } }, toolRoot: root, read: async () => [] });
  assert.ok(none.every((x) => x.state === 'logged_out'));
});

test('readCookieMeta reads names, hosts and expiry only, from a temp copy', async (t) => {
  let sqlite;
  try { sqlite = (await import('node:sqlite')).DatabaseSync; } catch { return t.skip('node:sqlite not available'); }
  const profile = tmp(), dir = path.join(profile, 'Default', 'Network');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'Cookies'), db = new sqlite(file);
  db.exec('CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, expires_utc INTEGER)');
  const ins = db.prepare('INSERT INTO cookies VALUES (?,?,?,?,?)');
  const us = (ms) => ms * 1000 + 11644473600 * 1e6;
  ins.run('.facebook.com', 'c_user', 'SECRETVALUE', Buffer.from('x'), us(Date.now() + 1e8));
  ins.run('.facebook.com', 'other', 'v', Buffer.from('x'), 0);
  ins.run('.instagram.com', 'sessionid', 'v', Buffer.from('x'), 0);
  db.close();
  const meta = readCookieMeta(profile, { sqlite });
  assert.deepEqual(meta.map((m) => m.name).sort(), ['c_user', 'sessionid']);
  assert.ok(meta.find((m) => m.name === 'c_user').expires > Date.now());
  assert.equal(meta.find((m) => m.name === 'sessionid').expires, 0);
  assert.ok(!JSON.stringify(meta).includes('SECRETVALUE'));
  assert.equal(readCookieMeta(tmp(), { sqlite }), null);
  assert.ok(fs.existsSync(file), 'original untouched');
});
