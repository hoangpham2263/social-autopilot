// INSTALL + CALL split of the extract script (saves ~7k tokens per extract: the MCP echoes the whole script of every browser_run_code_unsafe call).
// `collect.mjs install` writes ONE file (install.js) with the extractors of every platform; run it once per Research session, it registers an
// init script (page.context().addInitScript) that defines window.__sa = { facebook(args), pinterest(args), ... } on every page loaded afterwards.
// `collect.mjs script` then writes a TINY per-task file that calls window.__sa.<platform>(args) and posts the result exactly as the single-file script does.
// The extractors are NOT rewritten: each one is cut out of the platform's own pageScript() text (the page.evaluate function + its static options).
import { packB64, checksumOf } from './platforms/common.mjs';
import { POST_JS } from './collect-transfer.mjs';
import { getAdapter, platformIds } from './platforms/index.mjs';

export const INSTALL_FILE = 'install.js';

// A link/id as the page-side crawl compares it with the Library's known posts: host without www/m, path without trailing slash, only the
// query parameters that identify a post. SELF-CONTAINED (embedded in the page by toString; the Node side uses the same text).
export function knownKey(u) {
  try {
    const x = new URL(String(u || ''), 'https://x.invalid/');
    const q = ['fbid', 'story_fbid', 'v', 'id'].map((k) => (x.searchParams.get(k) ? k + '=' + x.searchParams.get(k) : '')).filter(Boolean).join('&');
    return x.hostname.toLowerCase().replace(/^(www|m|mbasic|web)\./, '') + x.pathname.replace(/\/+$/, '') + (q ? '?' + q : '');
  } catch (e) { return String(u || ''); }
}

// The page-side CRAWL (window.__sa.crawl(platform, a)): one browser call = one ROUND. It runs the platform's extractor (window.__sa.<platform>),
// scrolls by itself with window.scrollBy and the platform's polite random waits, and keeps going until: 'known' (stop_known known posts in a
// row: the top check of a complete source), 'end' (3 rounds at the bottom with no new post and no growth, or the platform's closed page),
// 'blocked' (login wall / captcha / checkpoint seen by the extractor), or 'time' (the round time, budget_ms, is used: run the same file again).
// Everything new comes back in ONE result: { ...last extract, tiles (new ones; known ones are cut to id + links, marked known:1), total, checksum,
// crawl: { stop, rounds, scrolls, fresh, known_streak, elapsed_ms, passed_resume, on_page } }. State (ids already handed out, the known-post
// streak, the scroll count) stays in window.__sa_state[task], so running the same file again continues where the last round stopped.
// a = { task, args: { found_by, max, seen }, known[] (ids + knownKey links), stop_known, budget_ms, wait: [lo, hi] s, step, fast_step, pre_scroll, resume[] }.
// SELF-CONTAINED apart from its four injected helpers (embedded as (factory)(sa, packB64, checksumOf, knownKey)); read only apart from scrolling.
export const crawlFactory = (sa, packB64, checksumOf, knownKey) => async (platform, a) => {
  const t0 = Date.now();
  const all = (window.__sa_state = window.__sa_state || {});
  const S = (all[a.task] = all[a.task] || { emitted: new Set(((a.args && a.args.seen) || []).map(String)), known: new Set((a.known || []).map(String)), streak: 0, flat: 0, scrolls: 0, resume: new Set((a.resume || []).filter(Boolean).map(String)), passed: !(a.resume || []).filter(Boolean).length });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const wait = Array.isArray(a.wait) && a.wait.length === 2 ? a.wait : [2, 4];
  const budget = a.budget_ms > 0 ? a.budget_ms : 24000;
  const keysOf = (t) => [t.id].concat(t.alt || []).filter(Boolean).map(String);
  const linksOf = (t) => [t.url].concat(t.alt_urls || []).filter(Boolean).map(knownKey);
  const out = [];
  let last = null, reason = '', rounds = 0, onPage = 0, fresh = 0;
  if (a.pre_scroll && S.scrolls === 0) { for (let i = 0; i < 2; i++) { window.scrollBy(0, 900); await sleep(1000); } await sleep(1500); S.scrolls += 2; }
  for (;;) {
    const x = await sa[platform](Object.assign({}, a.args, { seen: [...S.emitted] }));
    last = x.r; rounds++;
    if (last.loginWall) { reason = 'blocked'; break; }
    onPage = Math.max(onPage, last.total_on_page || 0);
    let added = 0;
    for (const t of last.tiles || []) {
      const ks = keysOf(t);
      if (ks.some((k) => S.emitted.has(k))) continue;
      ks.forEach((k) => S.emitted.add(k));
      added++;
      const mine = ks.concat(linksOf(t));
      if (!S.passed && mine.some((k) => S.resume.has(k))) S.passed = true;
      if (mine.some((k) => S.known.has(k))) {
        out.push({ id: t.id, alt: t.alt, url: t.url, alt_urls: t.alt_urls, known: 1 });
        S.streak++;
        if (a.stop_known > 0 && S.streak >= a.stop_known) { reason = 'known'; break; }
      } else { out.push(t); S.streak = 0; fresh++; }
    }
    if (reason) break;
    if (last.closed && !added) { reason = 'end'; break; }
    if (Date.now() - t0 + wait[1] * 1000 + 3000 > budget) { reason = 'time'; break; }
    const h0 = document.documentElement.scrollHeight;
    window.scrollBy(0, S.passed ? (a.step || 900) : (a.fast_step || 1800));
    S.scrolls++;
    await sleep(S.passed ? (wait[0] + Math.random() * (wait[1] - wait[0])) * 1000 : wait[0] * 1000);
    const grew = document.documentElement.scrollHeight > h0;
    const bottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 300;
    S.flat = added || grew || !bottom ? 0 : S.flat + 1;
    if (S.flat >= 3) { reason = 'end'; break; }
  }
  const res = Object.assign({}, last, { tiles: out, total: out.length, total_on_page: onPage, checksum: checksumOf(out.map((t) => t.id || t.url)),
    crawl: { stop: reason || 'time', rounds, scrolls: S.scrolls, fresh, known_streak: S.streak, elapsed_ms: Date.now() - t0, passed_resume: S.passed, on_page: onPage } });
  return { r: res, p: packB64(res) };
};
const TAIL = ', o);\n  const p = packB64(r);';

// Static options + the evaluate function source of one platform's pageScript.
export function splitPageScript(code) {
  const a = code.indexOf('const r = await page.evaluate(') + 'const r = await '.length;
  const b = code.lastIndexOf(TAIL);
  const m = code.match(/\n  const o = (\{.*\});\n/);
  if (a < 0 || b < a || !m) throw new Error('pageScript has an unexpected shape (cannot split into install + call)');
  const fn = code.slice(a + 'page.evaluate('.length, b);
  const stat = JSON.parse(m[1]);
  for (const k of ['found_by', 'max', 'seen', 'post']) delete stat[k];
  const wait = (code.match(/\n  (for \(let i = 0; i < 4; i\+\+\) \{[\s\S]*?\n  \})\n  const r = await page\.evaluate/) || [])[1] || '';
  return { fn, stat, wait };
}
// The browser-side init script: window.__sa.<platform>(args) -> { r, p } (r = the extract result, p = packB64(r)); same code as the single-file script.
export function initScriptCode(ids = platformIds()) {
  const parts = ids.map((id) => {
    const ad = getAdapter(id);
    if (!ad?.pageScript) return '';
    const { fn, stat } = splitPageScript(ad.pageScript({ found_by: '', max: 0, seen: [] }));
    return `  sa[${JSON.stringify(id)}] = async (a) => { const r = await (${fn})(Object.assign({}, ${JSON.stringify(stat)}, a)); return { r, p: packB64(r) }; };`;
  }).filter(Boolean);
  return `(() => {\n  const packB64 = ${packB64};\n  const checksumOf = ${checksumOf};\n  const knownKey = ${knownKey};\n  const sa = (window.__sa = window.__sa || {});\n${parts.join('\n')}\n  sa.crawl = (${crawlFactory})(sa, packB64, checksumOf, knownKey);\n})();`;
}
export function installScript(ids = platformIds()) {
  const code = initScriptCode(ids);
  return `async (page) => {\n  await page.bringToFront();\n  const code = ${JSON.stringify(code)};\n  await page.context().addInitScript(code);\n  await page.evaluate(code).catch(() => {});\n  return { installed: true, platforms: ${JSON.stringify(ids)} };\n}`;
}
// The tiny per-task file: args = { found_by, max, seen, post?, crawl? }. With crawl (the options of crawlFactory) one run of the file is a
// whole ROUND of the page-side crawl (scrolls by itself); without it one plain extract of what is on the page now.
export function callScript(platform, args) {
  const { wait } = splitPageScript(getAdapter(platform).pageScript({ found_by: '', max: 0, seen: [] }));
  const { post, crawl, ...a } = args;
  const call = crawl
    ? `page.evaluate((c) => (window.__sa && window.__sa.crawl && window.__sa[${JSON.stringify(platform)}] ? window.__sa.crawl(${JSON.stringify(platform)}, c) : null), ${JSON.stringify({ ...crawl, args: a })})`
    : `page.evaluate((a) => (window.__sa && window.__sa[${JSON.stringify(platform)}] ? window.__sa[${JSON.stringify(platform)}](a) : null), ${JSON.stringify(a)})`;
  return `async (page) => {
  await page.bringToFront();
  const o = ${JSON.stringify({ post: post || undefined })};
  ${wait}
  const x = await ${call};
  if (!x) return { error: 'not_installed', next: 'run install.js (browser_run_code_unsafe filename), then reload the page and run this file again' };
  const r = x.r, p = x.p;
  ${POST_JS}
}`;
}
