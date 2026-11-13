// Login manager: cookie METADATA only (name, host, expiry), never a value. Fixtures are temp sqlite files built here; no real profile is read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readCookieMeta, mapLogins, loginStatus } from '../core/setup/own-browser.mjs';

const WIN_EPOCH_US = 11644473600 * 1e6;
const chromeTime = (ms) => Math.round(ms * 1000 + WIN_EPOCH_US);
const NOW = Date.UTC(2026, 10, 13);
const FUTURE = chromeTime(NOW + 86400000), PAST = chromeTime(NOW - 86400000);

// A profile folder with Default/Network/Cookies (the newer Chrome layout) holding the given rows.
function profile(rows, { legacy = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-prof-'));
  const folder = legacy ? path.join(dir, 'Default') : path.join(dir, 'Default', 'Network');
  fs.mkdirSync(folder, { recursive: true });
  const db = new DatabaseSync(path.join(folder, 'Cookies'));
  db.exec('CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, expires_utc INTEGER)');
  const ins = db.prepare('INSERT INTO cookies VALUES (?, ?, ?, ?, ?)');
  for (const [host, name, exp] of rows) ins.run(host, name, 'SECRET-VALUE', Buffer.from('SECRET-BLOB'), exp);
  db.close();
  return dir;
}
const state = (list, p) => list.find((x) => x.platform === p);

test('reader returns names, hosts and expiry only; never a value; ignores other cookies', () => {
  const dir = profile([['.facebook.com', 'c_user', FUTURE], ['.facebook.com', 'xs', 0], ['.facebook.com', 'unrelated', FUTURE]]);
  const meta = readCookieMeta(dir, { sqlite: DatabaseSync });
  assert.deepEqual(meta.map((c) => c.name).sort(), ['c_user', 'xs']);
  assert.ok(!JSON.stringify(meta).includes('SECRET'));
  for (const c of meta) assert.deepEqual(Object.keys(c).sort(), ['expires', 'host', 'name']);
  assert.equal(meta.find((c) => c.name === 'xs').expires, 0); // session cookie
  assert.ok(Math.abs(meta.find((c) => c.name === 'c_user').expires - (NOW + 86400000)) < 1000);
});

test('the older layout (Default/Cookies) is read too; the temp copy is deleted', () => {
  const dir = profile([['.instagram.com', 'sessionid', FUTURE]], { legacy: true });
  const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('sa-cookies-')).length;
  const meta = readCookieMeta(dir, { sqlite: DatabaseSync });
  assert.equal(meta.length, 1);
  assert.equal(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('sa-cookies-')).length, before);
});

test('missing cookie file: null; no sqlite: throws', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-prof-'));
  assert.equal(readCookieMeta(dir, { sqlite: DatabaseSync }), null);
  const withCookies = profile([['.facebook.com', 'xs', 0]]);
  assert.throws(() => readCookieMeta(withCookies, { sqlite: null }));
});

test('status mapping: facebook needs c_user AND xs, valid, on facebook.com', () => {
  const m = (c) => state(mapLogins(c, { now: NOW }), 'facebook');
  assert.equal(m([{ host: '.facebook.com', name: 'c_user', expires: NOW + 1e6 }, { host: '.facebook.com', name: 'xs', expires: 0 }]).state, 'logged_in');
  assert.equal(m([{ host: '.facebook.com', name: 'c_user', expires: NOW + 1e6 }]).state, 'logged_out');
  assert.equal(m([{ host: '.facebook.com', name: 'c_user', expires: NOW - 1 }, { host: '.facebook.com', name: 'xs', expires: 0 }]).state, 'logged_out'); // expired
  assert.equal(m([{ host: '.example.com', name: 'c_user', expires: 0 }, { host: '.example.com', name: 'xs', expires: 0 }]).state, 'logged_out'); // wrong host
});

test('status mapping: instagram, pinterest, google rules; etsy and houzz stay unknown; required flags', () => {
  const list = mapLogins([
    { host: '.instagram.com', name: 'sessionid', expires: 0 },
    { host: '.pinterest.com', name: '_pinterest_sess', expires: NOW - 5 },
    { host: '.google.com', name: '__Secure-1PSID', expires: NOW + 1e6 },
  ], { now: NOW });
  assert.equal(state(list, 'instagram').state, 'logged_in');
  assert.equal(state(list, 'pinterest').state, 'logged_out');
  assert.equal(state(list, 'google').state, 'logged_in');
  assert.equal(state(list, 'etsy').state, 'unknown');
  assert.equal(state(list, 'houzz').state, 'unknown');
  assert.deepEqual(list.filter((x) => x.required).map((x) => x.platform).sort(), ['facebook', 'google', 'instagram']);
  assert.ok(list.every((x) => ['logged_in', 'logged_out', 'unknown'].includes(x.state) && typeof x.reason === 'string'));
});

test('loginStatus: no profile = logged_out; injected reader; read failure = unknown without paths', async () => {
  const missing = path.join(os.tmpdir(), 'sa-no-such-profile-' + Date.now());
  const none = await loginStatus({ settings: { browser: { profile_dir: missing } }, toolRoot: os.tmpdir(), now: NOW });
  assert.equal(state(none, 'facebook').state, 'logged_out');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-prof-'));
  const ok = await loginStatus({ settings: { browser: { profile_dir: dir } }, toolRoot: os.tmpdir(), now: NOW, read: async () => [{ host: '.instagram.com', name: 'sessionid', expires: 0 }] });
  assert.equal(state(ok, 'instagram').state, 'logged_in');
  const bad = await loginStatus({ settings: { browser: { profile_dir: dir } }, toolRoot: os.tmpdir(), now: NOW, read: async () => { throw new Error('EBUSY ' + dir); } });
  assert.equal(state(bad, 'facebook').state, 'unknown');
  assert.ok(!JSON.stringify(bad).includes(dir));
});
