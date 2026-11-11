// INSTALL + CALL split of the extract script (saves ~7k tokens per extract: the MCP echoes the whole script of every browser_run_code_unsafe call).
// `collect.mjs install` writes ONE file (install.js) with the extractors of every platform; run it once per Research session, it registers an
// init script (page.context().addInitScript) that defines window.__sa = { facebook(args), pinterest(args), ... } on every page loaded afterwards.
// `collect.mjs script` then writes a TINY per-task file that calls window.__sa.<platform>(args) and posts the result exactly as the single-file script does.
// The extractors are NOT rewritten: each one is cut out of the platform's own pageScript() text (the page.evaluate function + its static options).
import { packB64 } from './platforms/common.mjs';
import { POST_JS } from './collect-transfer.mjs';
import { getAdapter, platformIds } from './platforms/index.mjs';

export const INSTALL_FILE = 'install.js';
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
  return `(() => {\n  const packB64 = ${packB64};\n  const sa = (window.__sa = window.__sa || {});\n${parts.join('\n')}\n})();`;
}
export function installScript(ids = platformIds()) {
  const code = initScriptCode(ids);
  return `async (page) => {\n  await page.bringToFront();\n  const code = ${JSON.stringify(code)};\n  await page.context().addInitScript(code);\n  await page.evaluate(code).catch(() => {});\n  return { installed: true, platforms: ${JSON.stringify(ids)} };\n}`;
}
// The tiny per-task file: args = { found_by, max, seen, post? }.
export function callScript(platform, args) {
  const { wait } = splitPageScript(getAdapter(platform).pageScript({ found_by: '', max: 0, seen: [] }));
  const { post, ...a } = args;
  return `async (page) => {
  await page.bringToFront();
  const o = ${JSON.stringify({ post: post || undefined })};
  ${wait}
  const x = await page.evaluate((a) => (window.__sa && window.__sa[${JSON.stringify(platform)}] ? window.__sa[${JSON.stringify(platform)}](a) : null), ${JSON.stringify(a)});
  if (!x) return { error: 'not_installed', next: 'run install.js (browser_run_code_unsafe filename), then reload the page and run this file again' };
  const r = x.r, p = x.p;
  ${POST_JS}
}`;
}
