import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findBrowser, parseProfiles, listProfiles, validProfile, validConnectUrl, openCommand, openChromeProfile, userDataDirs } from '../core/setup/chrome.mjs';

const ID = 'a'.repeat(32);
const url = (relay) => `chrome-extension://${ID}/connect.html?mcpRelayUrl=${relay}&client=x`;

test('findBrowser: override, win32 candidates, linux which, none', () => {
  assert.deepEqual(findBrowser({ override: '/x/chrome', exists: () => true }), { found: true, path: '/x/chrome', kind: 'custom' });
  const env = { PROGRAMFILES: 'P', LOCALAPPDATA: 'L' };
  const hit = path.join('L', 'Google', 'Chrome', 'Application', 'chrome.exe');
  assert.equal(findBrowser({ plat: 'win32', env, exists: (p) => p === hit, which: () => '' }).path, hit);
  assert.equal(findBrowser({ plat: 'linux', which: (n) => (n === 'chromium' ? '/usr/bin/chromium' : '') }).path, '/usr/bin/chromium');
  assert.equal(findBrowser({ plat: 'darwin', home: '/h', exists: () => false }).found, false);
});

test('parseProfiles tolerates corrupt input and sorts Default first', () => {
  assert.deepEqual(parseProfiles('not json'), []);
  assert.deepEqual(parseProfiles('{}'), []);
  const t = JSON.stringify({ profile: { info_cache: { 'Profile 2': { name: 'Work', user_name: 'a@b.c' }, Default: { gaia_name: 'Me' } } } });
  assert.deepEqual(parseProfiles(t).map((p) => p.folder), ['Default', 'Profile 2']);
  assert.equal(parseProfiles(t)[1].email, 'a@b.c');
});

test('listProfiles reads only Local State from a temp dir', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-chrome-'));
  fs.writeFileSync(path.join(d, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'P' } } } }));
  assert.equal(listProfiles({ userDataDir: d }).profiles.length, 1);
  assert.equal(listProfiles({ userDataDir: path.join(d, 'missing') }).profiles.length, 0);
  assert.ok(userDataDirs({ plat: 'darwin', home: '/h' }).chrome.includes('Application Support'));
});

test('allow-lists: profile and connect url', () => {
  assert.ok(validProfile('Default') && validProfile('Profile 12') && !validProfile('../x') && !validProfile('Profile 2; rm'));
  assert.ok(validProfile('Custom', [{ folder: 'Custom' }]));
  assert.ok(validConnectUrl(url('ws%3A%2F%2F%5B%3A%3A1%5D%3A5%2Fextension%2Fu')));
  assert.ok(validConnectUrl(url('ws://127.0.0.1:9/extension/u')) && validConnectUrl(url('ws%3A%2F%2Flocalhost%3A1%2Fe')));
  assert.ok(!validConnectUrl(url('ws://evil.com/x')) && !validConnectUrl(url('wss://127.0.0.1/x')));
  assert.ok(!validConnectUrl('https://example.com') && !validConnectUrl(`chrome-extension://${ID}/other.html?mcpRelayUrl=ws://127.0.0.1:1/`));
  assert.ok(!validConnectUrl(`chrome-extension://${'A'.repeat(32)}/connect.html?mcpRelayUrl=ws://127.0.0.1:1/`));
});

test('openCommand and openChromeProfile use argument arrays, never spawn in the test', () => {
  const b = { path: '/c/chrome', kind: 'chrome' };
  assert.deepEqual(openCommand({ browser: b, profile: 'Default', plat: 'linux' }), { cmd: '/c/chrome', args: ['--profile-directory=Default'] });
  assert.deepEqual(openCommand({ browser: b, profile: 'Default', url: 'u', plat: 'darwin' }), { cmd: 'open', args: ['-na', 'Google Chrome', '--args', '--profile-directory=Default', 'u'] });
  let got;
  const r = openChromeProfile({ profile: 'Profile 3', url: url('ws://[::1]:4/e'), settings: { research: { chrome_path: '/c/chrome' } }, plat: 'linux', exists: () => true, read: () => '{}', start: (c, a) => { got = [c, a]; } });
  assert.equal(r.ok, true); assert.equal(got[0], '/c/chrome'); assert.equal(got[1][0], '--profile-directory=Profile 3');
  assert.throws(() => openChromeProfile({ profile: 'Default', url: 'https://x', settings: { research: { chrome_path: '/c' } }, plat: 'linux', exists: () => true, read: () => '{}', start() {} }));
});

