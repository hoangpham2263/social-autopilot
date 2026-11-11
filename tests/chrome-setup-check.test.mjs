import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromeSetupCheck, BRIDGE_EXTENSION_ID } from '../core/setup/chrome.mjs';

function fake() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-chrome-'));
  const exe = path.join(root, 'chrome'); fs.writeFileSync(exe, '');
  const ud = path.join(root, 'ud'); fs.mkdirSync(ud);
  fs.writeFileSync(path.join(ud, 'Local State'), JSON.stringify({ profile: { info_cache: { 'Profile 1': { name: 'Work', user_name: 'w@x.com' }, 'Profile 2': { name: 'Other' } } } }));
  fs.mkdirSync(path.join(ud, 'Profile 1', 'Extensions', BRIDGE_EXTENSION_ID), { recursive: true });
  fs.mkdirSync(path.join(ud, 'Profile 2'), { recursive: true });
  return { settings: { research: { chrome_path: exe, chrome_user_data_dir: ud } } };
}

test('extension present, absent, unknown and invalid profile', () => {
  const { settings } = fake();
  const a = chromeSetupCheck({ profile: 'Profile 1', settings });
  assert.equal(a.browser.found, true); assert.equal(a.profile.exists, true); assert.equal(a.profile.name, 'Work'); assert.equal(a.profile.email, 'w@x.com'); assert.equal(a.extension.installed, true);
  assert.equal(chromeSetupCheck({ profile: 'Profile 2', settings }).extension.installed, false);
  const bad = chromeSetupCheck({ profile: '../x', settings });
  assert.equal(bad.profile.exists, false); assert.equal(bad.extension.installed, false);
});

test('browser missing', () => {
  const { settings } = fake();
  settings.research.chrome_path = path.join(os.tmpdir(), 'no-such-chrome');
  assert.equal(chromeSetupCheck({ profile: 'Profile 1', settings }).browser.found, false);
});
