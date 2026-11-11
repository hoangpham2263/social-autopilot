// Chrome check: a read-only test of the browser the Playwright MCP is connected to (tab visible? signed in per platform?).
// The user connects the Playwright MCP extension to the Chrome profile they want BY THEMSELVES first.
//   node scripts/collect.mjs check-chrome [--brand <id>|all]   writes the check script to research.script_dir and prints its path
//        (run it with browser_run_code_unsafe + filename; ~40 s at most; read only: no click, no typing, no sign-in; no secret, no app token)
//   node scripts/research.mjs chrome-record --state ok|fail [--note ..] [--result '<json>' | --result-file <path>]   records it in workspace/runs/chrome-check.json
// The gate (research.mjs start refuses without a fresh ok; next skips signed-out platforms) is OFF unless the setting
// research.chrome_check_required is true. With it off, start/next behave as before.
import fs from 'node:fs';
import path from 'node:path';
import { workspace, readJson, writeJson, settings, discoverBrands, loadBrand, brandDiscovery, brandSources, RETIRED_PLATFORMS, DISCOVERY_PLATFORMS } from './lib.mjs';
import { platformOf } from './store.mjs';
import { scriptDir } from './collect-transfer.mjs';

export const HOMES = { facebook: 'https://www.facebook.com/', instagram: 'https://www.instagram.com/', pinterest: 'https://www.pinterest.com/', etsy: 'https://www.etsy.com/', houzz: 'https://www.houzz.com/' };
export const PLATFORM_NAMES = { facebook: 'Facebook', instagram: 'Instagram', pinterest: 'Pinterest', etsy: 'Etsy', houzz: 'Houzz' };
export const chromeCheckFile = () => path.join(workspace, 'runs', 'chrome-check.json');
export const chromeCheckMinutes = (cfg = settings().research?.chrome_check_minutes) => (cfg !== undefined && cfg !== null && Number.isFinite(Number(cfg)) && Number(cfg) >= 0 ? Number(cfg) : 30);
export const gateRequired = (cfg = settings().research?.chrome_check_required) => cfg === true;

// Platforms to check: union over the brands of the skill's enabled discovery platforms + the platforms of their reference sources, minus retired ones.
export function platformsOf(brands) {
  const set = new Set();
  for (const b of brands) {
    const social = b.social || {};
    for (const p of brandDiscovery(social).platforms) set.add(p.id);
    for (const x of brandSources(social)) set.add(x.platform || platformOf({ source_url: x.url }) || '');
  }
  return DISCOVERY_PLATFORMS.filter((p) => set.has(p) && !RETIRED_PLATFORMS.includes(p));
}

// Pure: what the page showed (facts read by the script) -> { signed_in: true|false|'unknown', wall: null|'login'|'captcha'|'blocked' }.
// ONE self-contained function: its source is embedded in the check script.
export function classifyPage(id, f) {
  const text = String(f.text || ''), url = String(f.url || '');
  const bot = /captcha|are you a robot|unusual traffic|verify you are (a )?human|press (&|and) hold|access denied|temporarily blocked/i.test(`${f.title || ''} ${text}`);
  if (bot || /\/checkpoint\b/.test(url)) return { signed_in: 'unknown', wall: /captcha|robot|human|press/i.test(text) ? 'captcha' : 'blocked' };
  if (id === 'facebook') {
    if (/\/login\b|\/recover\b/.test(url) || f.loginForm || f.loginDialog) return { signed_in: false, wall: 'login' };
    return { signed_in: f.loggedInHint ? true : 'unknown', wall: null };
  }
  if (id === 'instagram') {
    if (/\/accounts\/login/.test(url) || f.loginForm) return { signed_in: false, wall: 'login' };
    return { signed_in: f.loggedInHint ? true : 'unknown', wall: null };
  }
  return { signed_in: 'unknown', wall: null };
}

// The script browser_run_code_unsafe runs (an async (page) function). All Node-side Playwright; every wait is short and bounded.
export function checkScript(platforms) {
  const homes = Object.fromEntries(platforms.map((p) => [p, HOMES[p]]));
  return `async (page) => {
  const t0 = Date.now(), HOMES = ${JSON.stringify(homes)};
  ${classifyPage.toString()}
  const res = { ok: false, hidden: null, focus: null, tabs: 0, platforms: {}, seconds: 0 };
  try {
    await page.bringToFront();
    await page.waitForTimeout(300);
    const v = await page.evaluate(() => ({ s: document.visibilityState, f: document.hasFocus() }));
    res.hidden = v.s !== 'visible'; res.focus = !!v.f; res.ok = true;
    res.tabs = page.context().pages().length;
  } catch (e) { res.error = String(e && e.message || e).slice(0, 160); res.seconds = Math.round((Date.now() - t0) / 1000); return JSON.stringify(res); }
  for (const [id, url] of Object.entries(HOMES)) {
    const p0 = Date.now();
    if (p0 - t0 > 34000) { res.platforms[id] = { signed_in: 'unknown', wall: null, skipped: true, ms: 0 }; continue; }
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 6000 });
      await page.waitForTimeout(1200);
      const facts = await page.evaluate(() => {
        const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
        const q = (sel) => [...document.querySelectorAll(sel)].some(vis);
        const dlg = [...document.querySelectorAll('[role=dialog]')].some((d) => vis(d) && /log in|sign in/i.test(d.innerText.slice(0, 300)) && d.querySelector('input'));
        return { url: location.href, title: document.title, text: (document.body ? document.body.innerText : '').slice(0, 1500),
          loginForm: q('input[type=password]') || q('form#login_form') || q('[data-testid=royal_login_form]'), loginDialog: dlg,
          loggedInHint: q('[role=feed]') || q('[aria-label=Home]') || q('a[href="/direct/inbox/"]') || q('[aria-label="Your profile"]') || q('[aria-label=Account]') };
      });
      res.platforms[id] = { ...classifyPage(id, facts), ms: Date.now() - p0 };
    } catch (e) { res.platforms[id] = { signed_in: 'unknown', wall: null, error: String(e && e.message || e).slice(0, 80), ms: Date.now() - p0 }; }
  }
  res.seconds = Math.round((Date.now() - t0) / 1000);
  return JSON.stringify(res);
}`;
}

// collect.mjs check-chrome [--brand <id>|all]
export function checkChrome(args) {
  const want = args.brand && args.brand !== true ? String(args.brand) : 'all';
  const brands = want === 'all' ? discoverBrands().brands.filter((b) => b.usable).map((b) => loadBrand(b.id)) : [loadBrand(want)];
  const platforms = platformsOf(brands);
  const dir = scriptDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'chrome-check.js');
  fs.writeFileSync(file, checkScript(platforms) + '\n');
  process.stdout.write(JSON.stringify({ file, platforms, brands: brands.map((b) => b.id), run: 'browser_run_code_unsafe with filename = file (do not paste it); it returns ONE compact JSON. Save it to a file and record it: node scripts/research.mjs chrome-record --state ok --result-file <that file> (hidden:true -> bringToFront again and re-run; ok:false -> --state fail --note). Read only: never sign in for the user.' }) + '\n');
}

// ---- recording (research.mjs chrome-record) ----
export function parseResult(text) {
  const t = String(text || '').trim();
  let o;
  try { o = JSON.parse(t); } catch { const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a < 0 || b <= a) throw new Error('--result: cannot read the JSON of check-chrome.'); o = JSON.parse(t.slice(a, b + 1)); }
  if (typeof o === 'string') o = JSON.parse(o); // browser_run_code_unsafe may return the JSON as a string
  if (!o || typeof o !== 'object') throw new Error('--result: not an object.');
  return o;
}
export function recordCheck({ state, note = '', result = null, now = new Date() }) {
  if (state === 'ok' && result && result.hidden === true) throw new Error('--state ok refused: hidden:true (the tab is in the background). Call browser_run_code_unsafe with page.bringToFront() again and re-run the check.');
  if (state === 'ok' && result && result.ok === false) throw new Error('--state ok refused: the check says ok:false. Use --state fail --note "<reason>".');
  const platforms = {};
  for (const [id, p] of Object.entries(result?.platforms || {})) platforms[id] = { signed_in: p.signed_in === false ? false : p.signed_in === true ? true : 'unknown', wall: p.wall || null, ...(p.error ? { error: String(p.error).slice(0, 80) } : {}) };
  return { at: now.toISOString(), state, note, hidden: result ? result.hidden === true : false, tabs: Number(result?.tabs) || 0, platforms };
}
export function saveCheck(rec) { writeJson(chromeCheckFile(), rec); return rec; }
export const readCheck = () => readJson(chromeCheckFile(), null);

// The platforms a check says are unavailable: { facebook: 'signed out' | 'captcha' | 'blocked' }.
export function unavailableOf(rec) {
  const out = {};
  for (const [id, p] of Object.entries(rec?.platforms || {})) {
    if (p.wall) out[id] = p.wall === 'login' ? 'signed out' : p.wall;
    else if (p.signed_in === false) out[id] = 'signed out';
  }
  return out;
}
// Status view (also GET /api/chrome-check): { ok, reason, age_minutes, minutes, unavailable, expected_profile }.
export function checkStatus(rec, minutes = chromeCheckMinutes(), now = Date.now(), profile = settings().research?.chrome_profile) {
  const base = { minutes, expected_profile: String(profile || '') };
  if (!rec) return { ...base, ok: false, reason: 'not run', unavailable: {} };
  const age = Math.max(0, Math.round((now - Date.parse(rec.at)) / 60000));
  if (rec.state !== 'ok') return { ...base, ok: false, reason: 'last check failed' + (rec.note ? `: ${rec.note}` : ''), age_minutes: age, unavailable: {} };
  if (rec.hidden) return { ...base, ok: false, reason: 'tab hidden', age_minutes: age, unavailable: {} };
  if (minutes > 0 && age > minutes) return { ...base, ok: false, reason: 'expired', age_minutes: age, unavailable: unavailableOf(rec) };
  return { ...base, ok: true, reason: '', age_minutes: age, unavailable: unavailableOf(rec) };
}
export const GATE_HELP = 'run the Chrome check first: node scripts/collect.mjs check-chrome --brand all (run the file it prints with browser_run_code_unsafe + filename), then node scripts/research.mjs chrome-record --state ok --result-file <saved result>. If the browser does not answer or the tab stays hidden, STOP and tell the user to connect/refresh the Playwright MCP extension in the right Chrome profile; do not sign in for the user.';
// Only when research.chrome_check_required is true. Returns { required, unavailable }; throws when the check is missing / old / failed.
export function assertGate(now = Date.now(), required = gateRequired()) {
  if (!required) return { required: false, unavailable: {} };
  const st = checkStatus(readCheck(), chromeCheckMinutes(), now);
  if (!st.ok) throw new Error(`${GATE_HELP} (Chrome check: ${st.reason}${st.age_minutes !== undefined ? `, ${st.age_minutes} min ago` : ''}; valid ${st.minutes} min.)`);
  return { required: true, unavailable: st.unavailable };
}
export const unavailableLines = (un) => Object.entries(un || {}).map(([id, why]) => `${PLATFORM_NAMES[id] || id}: ${why} - skipped`);
