// Opens the browser in a chosen profile (detached), optionally on the Playwright MCP Bridge connect page.
//   node scripts/chrome-connect.mjs [--profile "<folder>"] [--url "chrome-extension://<id>/connect.html?mcpRelayUrl=ws%3A%2F%2F..."]
// Without --profile it uses research.chrome_profile (chosen in the app's Prompt tab). Never clicks Connect or signs in.
import { settings } from './lib.mjs';
import { openChromeProfile } from '../core/setup/chrome.mjs';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? String(process.argv[i + 1] ?? '') : ''; };
try {
  const r = openChromeProfile({ profile: arg('profile'), url: arg('url'), settings: settings() });
  console.log(`Opened ${r.browser} in profile "${r.profile}"${r.url ? ' on the connect page' : ''}. Click Connect in that window, then say "connected".`);
} catch (e) { console.error(e.message); process.exit(1); }
