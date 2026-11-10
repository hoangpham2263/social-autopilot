// Run progress for the app's Prompt tab: one small file per mode, workspace/runs/current-<mode>.json
//   { run_id, mode, brands, agent, created, started, updated, finished, result,
//     steps: [{ n, key, name, state: pending|running|done|failed|stopped, detail, at }], items: { label, done, total } }
// The step numbers are the prompt's (docs/scheduled-prompt.md, RUNBOOK.md). The app's Copy prompt makes a new pending run
// (POST /api/progress); `brands.mjs --run <mode>` (Setup) reuses it or starts one; every step script then reports through
// lib.mjs out()/fail() (trackCli below: one table, script + command -> step), and the long ones (image-batch)
// also report live. runlog.mjs add ends the run. Writes are atomic (writeJson) under a short lock and never throw:
// progress must never break a run. SA_PROGRESS=off turns it off (image-batch's own child processes).
//   node scripts/progress.mjs show --mode research|create|publish
//   node scripts/progress.mjs new  --mode <mode> [--brand a,b] [--agent "<name>"]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workspace, readJson, writeJson, withLock, stamp, listDrafts, main, out, parseArgs, need } from './lib.mjs';

export const MODES = ['research', 'create', 'publish'];
// The fixed steps of each mode, numbered like the prompt; keys are what the scripts report.
export const STEPS = {
  research: [
    { keys: ['setup'], name: 'Setup' },
    { keys: ['chrome'], name: 'Check the browser (Playwright MCP)' },
    { keys: ['start'], name: 'Open the run' },
    { keys: ['crawl'], name: 'Collect: reference pages, then discovery' },
    { keys: ['filter'], name: 'Filter the library' },
    { keys: ['report'], name: 'Report data' },
    { keys: ['runlog'], name: 'Run log' },
    { keys: ['tell'], name: 'Report' },
  ],
  create: [
    { keys: ['setup'], name: 'Setup' },
    { keys: ['sync'], name: 'Sync Metricool brands and times' },
    { keys: ['schedule'], name: 'Schedule approved posts' },
    { keys: ['reconcile'], name: 'Reconcile sent posts' },
    { keys: ['make'], name: 'Make posts (ideas, images, captions, checks)' },
    { keys: ['data'], name: 'Stop at To review · report data' },
    { keys: ['runlog'], name: 'Run log' },
    { keys: ['tell'], name: 'Report' },
  ],
  publish: [
    { keys: ['setup'], name: 'Setup' },
    { keys: ['sync'], name: 'Sync Metricool brands and times' },
    { keys: ['schedule'], name: 'Schedule approved posts' },
    { keys: ['reconcile', 'data'], name: 'Reconcile sent posts · report data' },
    { keys: ['runlog'], name: 'Run log' },
    { keys: ['tell'], name: 'Report' },
  ],
};
export const STATES = ['pending', 'running', 'done', 'failed', 'stopped'];
// A run with no update for this long is not shown as running any more (a crashed or abandoned agent).
export const STALE_MS = 6 * 3600 * 1000;

const off = () => /^(off|0|false)$/i.test(process.env.SA_PROGRESS || '');
const validMode = (m) => { if (!MODES.includes(m)) throw new Error('mode must be research, create or publish.'); return m; };
export const progressFile = (mode) => path.join(workspace, 'runs', `current-${validMode(mode)}.json`);
export const template = (mode) => STEPS[validMode(mode)].map((s, i) => ({ n: i + 1, key: s.keys[0], keys: s.keys, name: s.name, state: 'pending', detail: '', at: '' }));
export const readRun = (mode) => { try { return readJson(progressFile(mode), null); } catch { return null; } };
export const isActive = (run, now = Date.now()) => !!run && !run.finished && now - Date.parse(run.updated || run.created || 0) < STALE_MS;
const begun = (run) => run.steps.some((s) => s.state !== 'pending');

// A new pending run (the app's Copy prompt, or a run started without one): resets the panel.
export function newRun(mode, { brands = [], agent = '' } = {}) {
  const now = stamp();
  const run = { run_id: `${now.replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}-${mode}`, mode: validMode(mode), brands: [].concat(brands).map(String).filter(Boolean), agent: String(agent || ''), created: now, started: now, updated: now, finished: null, result: null, steps: template(mode), items: null, item_parts: {} };
  writeJson(progressFile(mode), run);
  return run;
}

function mutate(mode, fn) {
  if (off()) return null;
  const file = progressFile(mode);
  try {
    return withLock(file, () => {
      const run = readJson(file, null);
      if (!run) return null;
      fn(run);
      run.updated = stamp();
      writeJson(file, run);
      return run;
    }, { timeoutMs: 3000 });
  } catch { return null; }
}

// Step <key> of the run: running / done / failed / stopped, with a short detail. Starting a later step closes the
// earlier running one (done); earlier steps never run stay pending (the panel shows them as skipped).
function applyStep(run, key, state, detail) {
  const i = run.steps.findIndex((s) => (s.keys || [s.key]).includes(key));
  if (i < 0) return;
  if (!begun(run)) run.started = stamp(); // the agent began now (the Copy may have been minutes earlier)
  const now = stamp();
  // An earlier step running again: Research does its brands one after another, so the next brand's steps start over
  // (later steps back to pending). Create / Publish may run brands in parallel: never backwards there (a slower brand
  // only updates the last message; the panel shows the furthest step). Setup never moves a run back.
  if (state === 'running' && run.steps.slice(i + 1).some((x) => x.state !== 'pending')) {
    if (run.mode !== 'research' || key === 'setup') { if (detail) run.detail = String(detail).slice(0, 300); return; }
    for (const x of run.steps.slice(i + 1)) Object.assign(x, { state: 'pending', detail: '', at: '' });
  }
  for (const s of run.steps.slice(0, i)) if (s.state === 'running') { s.state = 'done'; s.at = now; }
  const s = run.steps[i];
  s.state = state; s.at = now;
  if (detail) s.detail = String(detail).slice(0, 300);
  run.detail = s.detail;
}

// Item counter, per brand (brands may run in parallel); items = the sum over brands of the latest label.
function applyItems(run, brand, { label, done, total = null }) {
  const parts = (run.item_parts ||= {});
  if (run.items?.label !== label) for (const k of Object.keys(parts)) if (k !== label) delete parts[k];
  (parts[label] ||= {})[brand || '_'] = { done: Number(done) || 0, total: total === null || total === undefined ? null : Number(total) || 0 };
  const list = Object.values(parts[label]);
  run.items = { label, done: list.reduce((a, x) => a + x.done, 0), total: list.some((x) => x.total === null) ? null : list.reduce((a, x) => a + x.total, 0) };
}

// The mode a step key belongs to: the active run (newest update) of a mode that has this step. None active: a run is
// started only for the first steps of Research (no Copy, no brands.mjs --run), never guessed for the others.
export function resolveMode(key, { modes = MODES } = {}) {
  const cand = modes.filter((m) => STEPS[m].some((s) => s.keys.includes(key)));
  const active = cand.map((m) => readRun(m)).filter((r) => isActive(r)).sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  return active[0]?.mode || '';
}

// What a script reports: track('make', { state, detail, brand, items: { label, done, total } }). Never throws.
export function track(key, { state = 'running', detail = '', brand = '', items = null, mode = '', start = false } = {}) {
  if (off()) return null;
  try {
    let m = mode || resolveMode(key);
    if (!m && start) { const only = MODES.filter((x) => STEPS[x].some((s) => s.keys.includes(key))); if (only.length === 1) { newRun(only[0], { brands: brand ? [brand] : [] }); m = only[0]; } }
    if (!m) return null;
    return mutate(m, (run) => {
      applyStep(run, key, state, detail ? `${brand ? `${brand}: ` : ''}${detail}` : '');
      if (items) applyItems(run, brand, typeof items === 'function' ? items(run, brand) : items);
      if (brand && !run.brands.includes(brand)) run.brands.push(brand);
    });
  } catch { return null; }
}

// Setup (brands.mjs --run <mode>): the active run of the mode (the pending one the app's Copy prompt made, or the one
// already going: per-brand sub-agents of a parallel run join it), or a new one when none is active. Setup of a run
// already past it does not move it back.
export function beginRun(mode, { brands = [], agent = '' } = {}) {
  if (off()) return null;
  const cur = readRun(mode);
  if (!isActive(cur)) { newRun(mode, { brands, agent }); return track('setup', { mode, detail: 'brands.mjs' }); }
  if (brands.length && !cur.brands.length) mutate(mode, (r) => { r.brands = brands; });
  return begun(cur) ? cur : track('setup', { mode, detail: 'brands.mjs' });
}

// runlog.mjs add: the run log is written (step done), the report follows; the run is finished. With a reason the run
// stopped: steps still running are "stopped".
export function finishRun(mode, { reason = '', logId = '' } = {}) {
  if (off() || !isActive(readRun(mode))) return null;
  return mutate(mode, (run) => {
    const now = stamp();
    for (const s of run.steps) if (s.state === 'running') { s.state = reason ? 'stopped' : 'done'; s.at = now; }
    for (const s of run.steps) if (['runlog', 'tell'].includes(s.key)) { s.state = 'done'; s.at = now; s.detail = s.key === 'runlog' ? (logId ? `log ${logId}` : 'written') : 'in the chat'; }
    run.finished = now; run.result = reason ? 'stopped' : 'done'; run.log_id = logId;
    run.detail = reason ? `Stopped: ${reason}` : 'Finished';
  });
}

// Drafts of this brand made since the run started, for the Make posts counters.
function madeSince(run, brand) {
  return listDrafts(brand || undefined).filter((d) => String(d.draft.created || '') >= String(run.created || ''));
}

// The one table: a script + command finished (lib.mjs out) or failed (lib.mjs fail) -> its step.
const arg = (a, k) => (a[k] && a[k] !== true ? String(a[k]) : '');
export function trackCli(scriptPath, args, ok, data = {}) {
  if (off()) return;
  const script = path.basename(String(scriptPath || '')).replace(/\.mjs$/, '');
  const cmd = args._?.[0] || '';
  // The brand: --brand, the JSON's brand, or the draft id's prefix (<brand>-<yyyymmdd>-<nn>).
  const brand = arg(args, 'brand') === 'all' ? '' : arg(args, 'brand') || (typeof data.brand === 'string' ? data.brand : '') || (String(data.id || arg(args, 'id')).match(/^([a-z0-9][a-z0-9-]*?)-\d{8}-\d+$/) || [])[1] || '';
  const fails = (key, label, start) => track(key, { state: 'failed', brand, start, detail: `${label}: ${String(data.error || 'failed').split('\n')[0].slice(0, 200)}` });
  const map = {
    brands: () => ['setup', 'brands.mjs'],
    research: () => ({ browser: ['chrome', ok && data.browser === 'ok' ? 'Playwright MCP ready' : `not ready${data.note ? ': ' + data.note : ''}`, { state: ok && data.browser === 'ok' ? 'done' : 'failed', start: true }], start: ['start', 'run opened', { state: 'done', start: true }], next: ['crawl', data.step === 'discovery' ? `next: ${data.platform} ${data.found_by}` : data.step === 'reference' ? `next: ${data.source}` : `collect done: ${data.reason || ''}`, { items: { label: 'New posts', done: data.total || 0, total: data.target || null } }], ingest: ['crawl', `ingest ${arg(args, 'query') || arg(args, 'source')}`], result: ['crawl', `${arg(args, 'query') || arg(args, 'source')}: ${data.result?.label || data.label || arg(args, 'state')}`], report: ['report', `${data.new_total ?? 0} new posts`, { state: 'done' }] })[cmd],
    store: () => ({ classify: ['filter', `${data.total_unjudged ?? 0} left to filter`, { items: unjudgedItems(data.total_unjudged) }], verdict: ['filter', `${data.left ?? 0} left to filter`, { items: unjudgedItems(data.left), state: data.left === 0 ? 'done' : 'running' }] })[cmd],
    'metricool-mcp': () => ({ 'sync-brands': ['sync', 'Metricool brands synced'], 'sync-times': ['sync', 'best times synced'], payload: ['schedule', `${(data.items || []).length} to schedule${(data.blocked || []).length ? `, ${data.blocked.length} blocked` : ''}`, { items: { label: 'Scheduled', done: 0, total: (data.items || []).length } }], record: ['schedule', `recorded ${arg(args, 'post')}`, { items: (run, b) => { const p = run.item_parts?.Scheduled?.[b || '_'] || { done: 0, total: null }; return { label: 'Scheduled', done: p.done + 1, total: p.total === null ? null : Math.max(p.total, p.done + 1) }; } }], status: ['reconcile', data.query ? 'checking sent posts' : 'nothing sent waiting'] })[cmd],
    ideas: () => ['make', `ideas ${cmd}${arg(args, 'id') ? ` ${arg(args, 'id')}` : ''}`],
    draft: () => (['new', 'image', 'reprompt', 'watermark', 'confirm-clean', 'check'].includes(cmd) ? ['make', `${cmd} ${data.id || arg(args, 'id')}${data.status ? ` → ${data.status}` : ''}`, { items: madeItems(cmd) }] : cmd === 'image-batch' ? ['make', `images: ${(data.done || []).length} done${(data.failed || []).length ? `, ${data.failed.length} failed` : ''}${(data.skipped || []).length ? `, ${data.skipped.length} skipped` : ''}`] : null),
    queue: () => ['data', 'queue report', { state: 'done' }],
  };
  try {
    const hit = map[script]?.();
    if (!hit) return;
    const [key, detail, opt = {}] = hit;
    if (!ok) return fails(key, `${script}${cmd ? ` ${cmd}` : ''}`, !!opt.start);
    track(key, { brand, detail, ...opt });
  } catch { /* never breaks the script */ }
}
// Filter counter: total = what was left at the first classify of this brand in the run.
const unjudgedItems = (left) => (left === undefined ? null : (run, brand) => {
  const p = run.item_parts?.Filtered?.[brand || '_'];
  const total = Math.max(p?.total || 0, (p?.done || 0) + Number(left || 0));
  return { label: 'Filtered', done: total - Number(left || 0), total };
});
// Make posts counter: images while images are made, then posts ready after the checks.
const madeItems = (cmd) => (run, brand) => {
  const made = madeSince(run, brand);
  if (cmd === 'check') return { label: 'Ready', done: made.filter((d) => d.status.status === 'ready').length, total: made.length };
  return { label: 'Images', done: made.filter((d) => fs.existsSync(path.join(d.dir, 'image.png'))).length, total: made.length };
};

// The Prompt tab's panel: the fixed steps of the mode, the current run (if any) and whether it is still running.
export function progressView(mode, now = Date.now()) {
  const run = readRun(mode);
  return { mode: validMode(mode), steps: template(mode).map(({ n, key, name }) => ({ n, key, name })), run, active: isActive(run, now), stale: !!run && !run.finished && !isActive(run, now) };
}

// lib.mjs imports this file (out/fail report here), so its exports are ready only once every module has run: the
// command starts on the next turn of the event loop.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) setImmediate(() => {
  main(() => {
    const args = parseArgs();
    const mode = need(args, 'mode');
    if (args._[0] === 'new') return out({ run: newRun(validMode(mode), { brands: arg(args, 'brand').split(',').map((x) => x.trim()).filter(Boolean), agent: arg(args, 'agent') }) });
    if (args._[0] === 'show') return out(progressView(mode));
    throw new Error('Lệnh: show --mode <mode> | new --mode <mode> [--brand a,b] [--agent ..]');
  });
});
