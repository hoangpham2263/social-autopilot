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

// The page-side CRAWL STEP (window.__sa.crawl(platform, a)): one browser call = one ROUND, made of short STEPS. Each step is ONE page.evaluate
// that runs the platform's extractor (window.__sa.<platform>), records new posts, decides whether the round stops, and otherwise scrolls once
// with window.scrollBy and returns { wait } (ms): the polite random wait is done on the NODE side (page.waitForTimeout in callScript), never with
// page timers, so the crawl also works in a BACKGROUND tab (Chrome throttles a hidden tab's chained timers to once a minute and gives it no
// animation frames; nothing here needs focus, bringToFront or rAF). The round stops on: 'known' (stop_known known posts in a row: the top check
// of a complete source), 'end' (3 steps at the bottom with no new post and no growth, or the platform's closed page), 'blocked' (login wall /
// captcha / checkpoint seen by the extractor), 'hidden' (the same 3 flat steps, but the tab was hidden and the page never grew while hidden:
// Chrome may not lazy-load in a background tab, so it is NOT the end: resumable), or 'time' (the round time, budget_ms, is used: run the same
// file again). The last step returns { done: true, r, p }: r = { ...last extract, tiles (new ones; known ones are cut to id + links, marked
// known:1), total, checksum, crawl: { stop, rounds, scrolls, fresh, known_streak, elapsed_ms, passed_resume, on_page, hidden } }. State (ids
// already handed out, the known-post streak, the scroll count, the round in progress) stays in window.__sa_state[task], so running the same
// file again continues where the last round stopped.
// a = { task, first (true on the first step of a round), args: { found_by, max, seen }, known[] (ids + knownKey links), stop_known, budget_ms,
// wait: [lo, hi] s, step, fast_step, pre_scroll, resume[] }.
// SELF-CONTAINED apart from its four injected helpers (embedded as (factory)(sa, packB64, checksumOf, knownKey)); read only apart from scrolling.
export const crawlFactory = (sa, packB64, checksumOf, knownKey) => async (platform, a) => {
  const all = (window.__sa_state = window.__sa_state || {});
  const S = (all[a.task] = all[a.task] || { emitted: new Set(((a.args && a.args.seen) || []).map(String)), known: new Set((a.known || []).map(String)), streak: 0, flat: 0, scrolls: 0, pre: 0, resume: new Set((a.resume || []).filter(Boolean).map(String)), passed: !(a.resume || []).filter(Boolean).length });
  if (a.first || !S.round) S.round = { t0: Date.now(), out: [], last: null, rounds: 0, onPage: 0, fresh: 0, hidden: false };
  const R = S.round;
  const wait = Array.isArray(a.wait) && a.wait.length === 2 ? a.wait : [2, 4];
  const budget = a.budget_ms > 0 ? a.budget_ms : 24000;
  const keysOf = (t) => [t.id].concat(t.alt || []).filter(Boolean).map(String);
  const linksOf = (t) => [t.url].concat(t.alt_urls || []).filter(Boolean).map(knownKey);
  const isHidden = () => document.visibilityState !== 'visible';
  // scrollBy works in a hidden tab; the synthetic scroll event wakes scroll-listener loaders there too (real scroll events wait for a frame).
  const scroll = (dy) => { window.scrollBy(0, dy); if (isHidden()) window.dispatchEvent(new Event('scroll')); };
  const finish = (reason) => {
    S.round = null; S.pending = null;
    const res = Object.assign({}, R.last, { tiles: R.out, total: R.out.length, total_on_page: R.onPage, checksum: checksumOf(R.out.map((t) => t.id || t.url)),
      crawl: { stop: reason || 'time', rounds: R.rounds, scrolls: S.scrolls, fresh: R.fresh, known_streak: S.streak, elapsed_ms: Date.now() - R.t0, passed_resume: S.passed, on_page: R.onPage, hidden: R.hidden || isHidden() } });
    return { done: true, r: res, p: packB64(res) };
  };
  if (isHidden()) R.hidden = true;
  if (a.pre_scroll && S.pre < 2) { scroll(900); S.pre++; S.scrolls++; return { wait: S.pre >= 2 ? 2500 : 1000 }; }
  // the check of the previous step's scroll (after its Node-side wait)
  if (S.pending) {
    const grew = document.documentElement.scrollHeight > S.pending.h0;
    const bottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 300;
    if (grew && isHidden()) S.hiddenGrew = true;
    S.flat = S.pending.added || grew || !bottom ? 0 : S.flat + 1;
    S.pending = null;
    if (S.flat >= 3) { S.flat = 0; return finish(isHidden() && !S.hiddenGrew ? 'hidden' : 'end'); }
  }
  const x = await sa[platform](Object.assign({}, a.args, { seen: [...S.emitted] }));
  R.last = x.r; R.rounds++;
  if (R.last.loginWall) return finish('blocked');
  R.onPage = Math.max(R.onPage, R.last.total_on_page || 0);
  let added = 0;
  for (const t of R.last.tiles || []) {
    const ks = keysOf(t);
    if (ks.some((k) => S.emitted.has(k))) continue;
    ks.forEach((k) => S.emitted.add(k));
    added++;
    const mine = ks.concat(linksOf(t));
    if (!S.passed && mine.some((k) => S.resume.has(k))) S.passed = true;
    if (mine.some((k) => S.known.has(k))) {
      R.out.push({ id: t.id, alt: t.alt, url: t.url, alt_urls: t.alt_urls, known: 1 });
      S.streak++;
      if (a.stop_known > 0 && S.streak >= a.stop_known) return finish('known');
    } else { R.out.push(t); S.streak = 0; R.fresh++; }
  }
  if (R.last.closed && !added) return finish('end');
  if (Date.now() - R.t0 + wait[1] * 1000 + 3000 > budget) return finish('time');
  S.pending = { h0: document.documentElement.scrollHeight, added };
  scroll(S.passed ? (a.step || 900) : (a.fast_step || 1800));
  S.scrolls++;
  return { wait: Math.round(S.passed ? (wait[0] + Math.random() * (wait[1] - wait[0])) * 1000 : wait[0] * 1000) };
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
  // crawl: a loop of short page steps; the polite waits run on the Node side (page.waitForTimeout), so it works in a background tab
  // without bringToFront. A 27 s guard ends the round ('time') below the 30 s limit of one browser call.
  const P = JSON.stringify(platform);
  const call = crawl
    ? `(async () => {
    const c = ${JSON.stringify({ ...crawl, args: a })}, t0 = Date.now();
    const step = (x) => page.evaluate((c) => (window.__sa && window.__sa.crawl && window.__sa[${P}] ? window.__sa.crawl(${P}, c) : null), x);
    for (let i = 0; ; i++) {
      const s = await step({ ...c, first: i === 0 });
      if (!s || s.done) return s;
      if (Date.now() - t0 + (s.wait || 1000) > 27000) return await step({ ...c, budget_ms: 1 });
      await page.waitForTimeout(Math.min(s.wait || 1000, 12000));
    }
  })()`
    : `page.evaluate((a) => (window.__sa && window.__sa[${P}] ? window.__sa[${P}](a) : null), ${JSON.stringify(a)})`;
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
