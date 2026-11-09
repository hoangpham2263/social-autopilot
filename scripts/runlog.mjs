// Run log: after every agent run (Research only or Create & publish, any agent) one short report the user reads in the
// app (Log tab). Built automatically from what the run left behind (research run.json + progress, the queue report:
// drafts, posts written, Metricool records); the agent only adds notes and errors.
//   node scripts/runlog.mjs add --mode research|create|publish --agent "<Claude Code|Codex|...>" [--brand a,b] [--started <ISO>]
//        [--file <json> | stdin] [--notes "..."]
//        agent JSON (optional): { "notes": "...", "errors": ["..."], "brands": { "<id>": { "notes": "...", "errors": [...] } } }
//   node scripts/runlog.mjs list [--brand <id>] [--mode research|create|publish] [--limit N]
//   node scripts/runlog.mjs show --id <log id>
// Files: workspace/logs/runs/<yyyymmdd-hhmmss>-<mode>.json (one per run).
import fs from 'node:fs';
import path from 'node:path';
import { main, out, isMain, parseArgs, need, readJson, writeJson, workspace, discoverBrands, listDrafts, stamp } from './lib.mjs';

const USAGE = `node scripts/runlog.mjs add --mode research|create|publish --agent "<Claude Code|Codex>" [--brand a,b] [--started <ISO>]
     [--file <notes.json> | --stdin] [--notes "..."] [--reason "<why the run stopped>" | --stopped]
   The last-but-one step of every run, also after a stop (then give --reason: logged as "stopped", no older numbers).
   notes.json: { "notes": "...", "errors": ["..."], "brands": { "<id>": { "notes": "...", "errors": ["..."] } } }
node scripts/runlog.mjs list [--brand <id>] [--mode research|create|publish] [--limit N]
node scripts/runlog.mjs show --id <log id>`;
import { researchReport } from './research.mjs';
import { writtenPost } from './queue.mjs';

export const runsDir = () => path.join(workspace, 'logs', 'runs');
const MODES = ['research', 'create', 'publish']; // publish = Mode 3, Publish approved (reported like create)
// A source that brought nothing new in this many research runs in a row is "dried up" (consider new sources).
export const DRIED_UP_RUNS = 3;

// One source's outcome in plain words.
export function sourceState(x) {
  if (x.state === 'blocked') return 'blocked';
  if (x.state === 'skipped') return 'skipped (quota)'; // never opened: the brand's --max-posts was used up first
  if (x.state === 'pending' || x.state === 'partial') return x.note && /lỗi|error/i.test(x.note) ? 'error' : 'unfinished';
  if (x.new > 0) return 'new posts';
  if (x.state === 'end' || x.reached_end) return x.new ? 'new posts' : 'reached end';
  return 'dried up';
}

// A crawl opened before this run began (an older run.json) is not this run's: no numbers from it.
function researchPart(brandId, since = '') {
  const r = researchReport(brandId);
  if (!r.date) return { date: null, sources: [], new: 0, duplicates: 0, not_run: true };
  const run = readJson(path.join(workspace, 'runs', brandId, r.date, 'run.json'), {});
  if (since && String(run.restarted || run.started || '') < since) return { date: null, sources: [], new: 0, duplicates: 0, not_run: true };
  const sources = r.sources.map((x) => ({ id: x.id, name: x.name || x.id, url: x.url || '', new: x.new, kept: x.kept || 0, filtered: x.filtered || 0, low_keep: !!x.low_keep, duplicates: x.duplicates, backfilled: x.backfilled, reached_end: x.reached_end, state: sourceState(x), note: x.note || '' }));
  return { date: r.date, crawl_mode: r.crawl_mode, sources, new: r.new_total || 0, kept: r.kept_total || 0, filtered: r.filtered_total || 0, duplicates: r.duplicates_total || 0, store: r.store };
}

function createPart(brandId, since) {
  const drafts = listDrafts(brandId);
  const after = (t) => t && (!since || String(t) >= since);
  const scheduled = [], errors = [];
  for (const d of drafts.filter((x) => x.status.brand_post)) {
    const w = writtenPost(d);
    for (const m of w.metricool_sent || []) if (!m.draft && after(m.sent_at)) scheduled.push({ post: w.post, network: m.network, publication: m.publication || '', timezone: m.timezone || '', source: m.time_source || '', planner_url: m.planner_url || '' });
    if (w.metricool === 'error') errors.push(`${w.post}: Metricool error`);
  }
  const fresh = drafts.filter((d) => after(d.draft.created));
  const toReview = drafts.filter((d) => d.status.status === 'ready' && !d.status.brand_post && after(d.draft.created)).map((d) => ({ id: d.id }));
  const failed = fresh.filter((d) => ['check_failed', 'image_failed'].includes(d.status.status)).map((d) => ({ id: d.id, reason: (d.status.problems || [])[0] || d.status.error || d.status.status }));
  return { scheduled, made: fresh.length, to_review: toReview, failed, errors };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// "N kept · M filtered" once the batch filter judged something (store.mjs verdict).
export const keptText = (kept = 0, filtered = 0) => (kept || filtered ? `${kept} kept · ${filtered} filtered` : '');
export function brandHeadline(mode, b) {
  if (mode === 'research') {
    const r = b.research || {}, dry = (r.sources || []).filter((x) => x.state === 'dried up').length, blocked = (r.sources || []).filter((x) => x.state === 'blocked').length;
    return [`+${plural(r.new || 0, 'post')}`, keptText(r.kept, r.filtered), dry && `${plural(dry, 'source')} dried up`, blocked && `${blocked} blocked`, (b.errors || []).length && plural(b.errors.length, 'error')].filter(Boolean).join(' · ');
  }
  const c = b.create || {}, errs = (c.failed || []).length + (c.errors || []).length + (b.errors || []).length;
  return [`${(c.scheduled || []).length} scheduled`, `${(c.to_review || []).length} to review`, errs && plural(errs, 'error')].filter(Boolean).join(' · ');
}
const resultOf = (mode, b) => {
  const errs = (b.errors || []).length + (b.create?.errors || []).length + (b.research?.sources || []).filter((x) => x.state === 'error').length;
  if (errs) return 'error';
  if ((b.create?.failed || []).length) return 'error';
  if ((b.research?.sources || []).some((x) => x.state === 'blocked' || x.state === 'unfinished')) return 'warning';
  return 'ok';
};

// The previous run of the same mode ends where this one may start (when the agent gives no --started).
function lastEnded(mode) {
  const last = listLogs({ mode, limit: 1 })[0];
  return last?.ended || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
}

// reason (--reason / --stopped): the run stopped (Chrome unreachable, blocked, Metricool error...); logged as "stopped".
export function addLog({ mode, agent = '', brands = [], started = '', notes = '', reason = '', extra = {}, now = new Date() }) {
  if (!MODES.includes(mode)) throw new Error('--mode must be research, create or publish.');
  const all = discoverBrands().brands.filter((b) => b.usable || brands.includes(b.id));
  const pick = brands.length ? all.filter((b) => brands.includes(b.id)) : all;
  const since = started || lastEnded(mode);
  const ended = now.toISOString();
  const per = pick.map((b) => {
    const x = extra.brands?.[b.id] || {};
    // The brand's Facebook page (its enabled facebook channel's url), linked from the Log.
    const page = (readJson(path.join(b.dir, 'project', 'social.json'), {}).channels || []).find((c) => c?.enabled && c.network === 'facebook' && /^https:\/\//.test(c.url || ''))?.url || '';
    const entry = { brand: b.id, name: b.brand || b.id, page_url: page, notes: String(x.notes || ''), errors: [].concat(x.errors || []).map(String) };
    if (mode === 'research') entry.research = researchPart(b.id, since); else entry.create = createPart(b.id, since);
    entry.headline = entry.research?.not_run ? 'not run' : brandHeadline(mode, entry);
    entry.result = resultOf(mode, entry);
    return entry;
  });
  const errors = [].concat(extra.errors || []).map(String);
  const result = errors.length || per.some((b) => b.result === 'error') ? 'error' : per.some((b) => b.result === 'warning') ? 'warning' : 'ok';
  const sum = (f) => per.reduce((a, b) => a + f(b), 0);
  const headline = mode === 'research'
    ? [`+${plural(sum((b) => b.research.new || 0), 'post')}`, keptText(sum((b) => b.research.kept || 0), sum((b) => b.research.filtered || 0)), sum((b) => b.research.sources.filter((x) => x.state === 'dried up').length) && `${plural(sum((b) => b.research.sources.filter((x) => x.state === 'dried up').length), 'source')} dried up`, sum((b) => b.research.sources.filter((x) => x.state === 'blocked').length) && `${sum((b) => b.research.sources.filter((x) => x.state === 'blocked').length)} blocked`].filter(Boolean).join(' · ')
    : [`${sum((b) => b.create.scheduled.length)} scheduled`, `${sum((b) => b.create.to_review.length)} to review`, (errors.length + sum((b) => b.errors.length + b.create.errors.length + b.create.failed.length)) && plural(errors.length + sum((b) => b.errors.length + b.create.errors.length + b.create.failed.length), 'error')].filter(Boolean).join(' · ');
  const id = `${ended.replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}-${mode}`;
  // Publish approved makes no posts: its headlines leave out "to review".
  if (mode === 'publish') for (const x of per) x.headline = x.headline.replace(/ · \d+ to review/, '');
  const cleanHead = mode === 'publish' ? headline.replace(/ · \d+ to review/, '') : headline;
  // Stopped: the reason given, or a research run where no brand's crawl was started in this run.
  const stopReason = String(reason || '').trim() || (mode === 'research' && per.length && per.every((b) => b.research?.not_run) ? 'no crawl started' : '');
  const log = { id, mode, agent: String(agent || ''), started: since, ended, duration_s: Math.max(0, Math.round((Date.parse(ended) - Date.parse(since)) / 1000)), result: stopReason ? 'stopped' : result, headline: stopReason ? `Stopped: ${stopReason}` : cleanHead, ...(stopReason ? { stop_reason: stopReason } : {}), notes: String(notes || extra.notes || ''), errors, brands: per };
  writeJson(path.join(runsDir(), `${id}.json`), log);
  return log;
}

export function listLogs({ brand = '', mode = '', limit = 0 } = {}) {
  const dir = runsDir();
  if (!fs.existsSync(dir)) return [];
  let logs = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse().map((f) => readJson(path.join(dir, f), null)).filter(Boolean);
  if (mode) logs = logs.filter((l) => l.mode === mode);
  if (brand) logs = logs.filter((l) => (l.brands || []).some((b) => b.brand === brand));
  // Dried up across runs: per brand/source, how many research runs in a row (newest first) brought nothing new.
  const streak = {};
  for (const l of logs.filter((x) => x.mode === 'research').slice().reverse()) for (const b of l.brands || []) for (const s of b.research?.sources || []) {
    const k = `${b.brand}/${s.id}`;
    if (s.state === 'skipped (quota)') continue; // not opened: says nothing about the source
    streak[k] = s.new > 0 ? 0 : (streak[k] || 0) + 1;
  }
  for (const l of logs) for (const b of l.brands || []) for (const s of b.research?.sources || []) s.dry_runs = streak[`${b.brand}/${s.id}`] || 0;
  return limit ? logs.slice(0, limit) : logs;
}

export function showLog(id) {
  if (!/^[0-9]{8}-[0-9]{6}-(research|create|publish)$/.test(String(id || ''))) throw new Error('Invalid log id.');
  const log = listLogs().find((l) => l.id === id);
  if (!log) throw new Error(`No log ${id}.`);
  return log;
}

if (isMain(import.meta.url)) main(() => {
  const args = parseArgs();
  const cmd = args._[0];
  const str = (k) => (args[k] && args[k] !== true ? String(args[k]) : '');
  if (args.help || cmd === 'help' || !cmd) { process.stdout.write(USAGE + '\n'); return; }
  if (cmd === 'add') {
    let extra = {};
    const file = str('file');
    const text = file ? fs.readFileSync(file, 'utf8') : !process.stdin.isTTY && args.stdin ? fs.readFileSync(0, 'utf8') : '';
    if (text.trim()) extra = JSON.parse(text);
    return out({ log: addLog({ mode: need(args, 'mode'), agent: str('agent'), brands: str('brand').split(',').map((x) => x.trim()).filter(Boolean), started: str('started'), notes: str('notes'), reason: str('reason') || (args.stopped ? 'stopped' : ''), extra }) });
  }
  if (cmd === 'list') return out({ logs: listLogs({ brand: str('brand'), mode: str('mode'), limit: Number(str('limit')) || 0 }).map(({ id, mode, agent, ended, result, headline, brands }) => ({ id, mode, agent, ended, result, headline, brands: (brands || []).map((b) => b.brand) })) });
  if (cmd === 'show') return out({ log: showLog(need(args, 'id')) });
  throw new Error('Lệnh: add --mode research|create|publish --agent <name> [--brand a,b] [--started ISO] [--file json | --stdin] [--notes ..] | list [--brand] [--mode] [--limit] | show --id <id>');
});
