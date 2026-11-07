// Shared helpers for the social-autopilot CLI scripts: settings, paths, JSON output, brand discovery, text cleaning,
// CSV. Every script prints ONE JSON object on stdout ({ ok: true, ... } or { ok: false, error }) and exits 1 on error.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// SA_WORKSPACE lets tests run against a throw-away workspace; normal runs use <tool>/workspace.
export const workspace = path.resolve(process.env.SA_WORKSPACE || path.join(toolRoot, 'workspace'));
export const today = () => new Date().toISOString().slice(0, 10);
export const stamp = () => new Date().toISOString();

// ----- output -----
// Each call is also logged to workspace/logs/<date>.log (command + ok/error), so a scheduled run leaves a trail.
function log(line) {
  try {
    fs.mkdirSync(path.join(workspace, 'logs'), { recursive: true });
    fs.appendFileSync(path.join(workspace, 'logs', `${today()}.log`), `[${stamp()}] ${path.basename(process.argv[1] || '')} ${process.argv.slice(2).join(' ')} -> ${line}\n`);
  } catch {}
}
export function out(data) { log('ok'); process.stdout.write(JSON.stringify({ ok: true, ...data }, null, 2) + '\n'); }
export function fail(error, extra = {}) { log('error: ' + error); process.stdout.write(JSON.stringify({ ok: false, error, ...extra }, null, 2) + '\n'); process.exit(1); }
// True when the file is the script being run (not imported by another script).
export const isMain = (url) => process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(url);
export function main(fn) {
  Promise.resolve().then(fn).catch((e) => fail(e?.message || String(e)));
}

// ----- args: <command> --key value --flag -----
export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true; else { args[key] = next; i++; }
    } else args._.push(a);
  }
  return args;
}
export const need = (args, key) => { if (!args[key] || args[key] === true) throw new Error(`Thiếu --${key}.`); return String(args[key]); };

// ----- json files -----
export const readJson = (file, fallback) => {
  if (!fs.existsSync(file)) { if (fallback !== undefined) return fallback; throw new Error(`Không có file ${file}`); }
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
};
// Atomic write (temp file + rename), so a reader never sees half a file. Windows may refuse the rename for a moment
// while another process reads the file; it is retried.
export const writeJson = (file, data) => writeText(file, JSON.stringify(data, null, 2) + '\n');
export function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      if (i >= 20 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { fs.rmSync(tmp, { force: true }); throw e; }
      sleep(50);
    }
  }
}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// The UI server and a scheduled agent can run at the same time: every read-modify-write of a shared file
// (status.json, ideas.json, research-log.json, the brand's catalog.json and social.json) runs inside this lock, a
// <file>.lock folder (mkdir is atomic). A lock older than 2 minutes is a crashed run's and is taken over.
export function withLock(file, fn, { timeoutMs = 20000, staleMs = 120000 } = {}) {
  const lock = `${file}.lock`;
  const start = Date.now();
  for (;;) {
    try { fs.mkdirSync(lock); break; } catch (e) {
      if (e.code === 'ENOENT') { fs.mkdirSync(path.dirname(lock), { recursive: true }); continue; }
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > staleMs) { fs.rmSync(lock, { recursive: true, force: true }); continue; } } catch {}
      if (Date.now() - start > timeoutMs) throw new Error(`Đang bận: ${path.basename(file)} đang được tiến trình khác ghi. Chạy lại sau.`);
      sleep(100);
    }
  }
  try { return fn(); } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}
export const sha1 = (data) => crypto.createHash('sha1').update(data).digest('hex');
export const inside = (base, target) => {
  const rel = path.relative(path.resolve(base), path.resolve(target));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

// ----- settings: config/settings.json (defaults, in git) + workspace/settings.json (this machine) -----
const merge = (a, b) => {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b === undefined ? a : b;
  const o = { ...(a || {}) };
  for (const [k, v] of Object.entries(b)) o[k] = merge(a?.[k], v);
  return o;
};
export function settings() {
  const s = merge(readJson(path.join(toolRoot, 'config', 'settings.json')), readJson(path.join(workspace, 'settings.json'), {}));
  const root = process.env.SA_SKILLS_ROOT || s.skillsRoot;
  s.skillsRoot = path.resolve(toolRoot, root);
  return s;
}

// The settings as stored (defaults + this machine's workspace/settings.json), without resolving paths.
export function rawSettings() {
  return merge(readJson(path.join(toolRoot, 'config', 'settings.json')), readJson(path.join(workspace, 'settings.json'), {}));
}

// Saves this machine's settings to workspace/settings.json (config/settings.json stays the default in git). Only the
// known keys, checked; nothing that looks like a secret.
export function saveSettings(input) {
  const d = readJson(path.join(toolRoot, 'config', 'settings.json'));
  const int = (v, name, min = 0) => { const n = Number(v); if (!Number.isInteger(n) || n < min) throw new Error(`${name} phải là số nguyên >= ${min}.`); return n; };
  const str = (v, name) => { if (typeof v !== 'string' || !v.trim()) throw new Error(`${name} không được trống.`); if (/token|secret|password/i.test(v)) throw new Error(`${name} không được chứa token/mật khẩu.`); return v.trim(); };
  const r = input.research || {}, a = input.approval || {};
  const delay = [].concat(r.delay_seconds ?? d.research.delay_seconds).map((x, i) => int(x, `research.delay_seconds[${i}]`));
  if (delay.length !== 2 || delay[0] > delay[1]) throw new Error('research.delay_seconds phải là [min, max] với min <= max.');
  const next = {
    skillsRoot: str(input.skillsRoot ?? d.skillsRoot, 'skillsRoot'),
    research: {
      max_sources_per_run: int(r.max_sources_per_run ?? d.research.max_sources_per_run, 'research.max_sources_per_run', 1),
      max_posts_per_source: int(r.max_posts_per_source ?? d.research.max_posts_per_source, 'research.max_posts_per_source', 1),
      max_posts_per_day_all_brands: int(r.max_posts_per_day_all_brands ?? d.research.max_posts_per_day_all_brands, 'research.max_posts_per_day_all_brands'),
      delay_seconds: delay,
    },
    approval: Object.fromEntries(Object.keys(d.approval).map((k) => [k, a[k] === undefined ? d.approval[k] : a[k] === true || a[k] === 'true'])),
    codex: { command: str(input.codex?.command ?? d.codex.command, 'codex.command'), timeout_minutes: int(input.codex?.timeout_minutes ?? d.codex.timeout_minutes, 'codex.timeout_minutes', 1) },
    ffmpeg: { command: str(input.ffmpeg?.command ?? d.ffmpeg.command, 'ffmpeg.command') },
    remove_watermark: {
      script: str(input.remove_watermark?.script ?? d.remove_watermark.script, 'remove_watermark.script'),
      providers: Object.fromEntries(Object.entries(input.remove_watermark?.providers ?? d.remove_watermark.providers).map(([k, v]) => [str(k, 'provider'), str(v, 'provider')])),
    },
  };
  if (!fs.existsSync(path.resolve(toolRoot, next.skillsRoot))) throw new Error(`skillsRoot không tồn tại: ${path.resolve(toolRoot, next.skillsRoot)}`);
  const file = path.join(workspace, 'settings.json');
  withLock(file, () => writeJson(file, next));
  return next;
}

// ----- text cleaning -----
// Facebook pads captions with U+034F (combining grapheme joiner) and zero-width characters; the brand's check-post
// also rejects bidi marks, U+FEFF, U+FFFD and U+00A0.
const HIDDEN = /[͏​-‏‪-‮⁠-⁤⁦-⁩﻿­]/g;
export function cleanText(text) {
  const before = String(text ?? '');
  const hidden = (before.match(HIDDEN) || []).length;
  const nbsp = (before.match(/ /g) || []).length;
  let t = before.replace(HIDDEN, '').replace(/ /g, ' ').replace(/\r\n?/g, '\n').normalize('NFC');
  t = t.split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: t, removed: hidden, nbsp };
}
export const hasHidden = (t) => /[͏​-‏‪-‮⁠-⁤⁦-⁩﻿� ­]/.test(t);

// ----- CSV (RFC 4180) -----
export function parseCsv(text) {
  const rows = []; let row = [], field = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}
const cell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
// Written with a BOM so Excel opens Vietnamese correctly (as the neon-competitors prototype).
export const toCsv = (rows) => '﻿' + rows.map((r) => r.map(cell).join(',')).join('\n') + '\n';

// ----- brand skill folders -----
export function projectSection(md, n) {
  const m = md.match(new RegExp(`^## ${n}\\.[^\\n]*\\n([\\s\\S]*?)(?=^## \\d+\\.|$(?![\\s\\S]))`, 'm'));
  return m ? m[1].trim() : '';
}
export const projectField = (md, label) => md.match(new RegExp(`^- ${label}(?: \\(\\*\\))?:\\s*(.+)$`, 'm'))?.[1]?.trim() || '';

// Languages to write: every lang of the enabled channels (social.json channels[]).
export function brandLanguages(social) {
  const langs = new Set();
  for (const c of social.channels || []) if (c.enabled) for (const l of [].concat(c.lang || [])) langs.add(l);
  return [...langs];
}

// One brand = one skill folder under skillsRoot with SKILL.md, project/project.md and project/social.json.
// Readiness is the skill's own check (scripts/check-skill.mjs --tool-ready, exit 0 = ready); the tool does not
// re-implement it. Usable (in the run) = enabled: true and ready.
export function inspectBrand(dir) {
  const id = path.basename(dir).replace(/-skills$/, '');
  const result = { id, dir, enabled: false, ready: false, usable: false, problems: [] };
  const missing = ['SKILL.md', 'project/project.md', 'project/social.json'].filter((f) => !fs.existsSync(path.join(dir, f)));
  if (missing.length) { result.skip = `thiếu ${missing.join(', ')}`; return result; }
  let social;
  try { social = readJson(path.join(dir, 'project/social.json')); } catch (e) { result.problems.push(`social.json không đọc được: ${e.message}`); return result; }
  result.brand = social.brand || '';
  result.enabled = social.enabled === true;
  result.channels = (social.channels || []).filter((c) => c.enabled).map((c) => c.network);
  result.languages = brandLanguages(social);
  result.language_mode = social.language_policy?.mode || '';
  result.owner = social.approval?.owner || '';
  result.sources = brandSources(social).map((x) => x.id);
  result.ai_scenes_allowed = social.product_images?.ai_scenes_allowed ?? null;
  const checker = path.join(dir, 'scripts', 'check-skill.mjs');
  if (!fs.existsSync(checker)) result.problems.push('skill thiếu scripts/check-skill.mjs');
  else {
    const r = spawnSync(process.execPath, [checker, '--tool-ready'], { cwd: dir, encoding: 'utf8', windowsHide: true });
    result.ready = r.status === 0;
    if (!result.ready) result.problems.push(...String(r.stdout).split(/\r?\n/).filter((l) => /^\s+- |^LỖI /.test(l)).map((l) => l.replace(/^\s+- /, 'thiếu ').trim()));
  }
  result.usable = result.enabled && result.ready;
  return result;
}

export function discoverBrands(s = settings()) {
  const root = s.skillsRoot;
  if (!fs.existsSync(root)) return { root, brands: [], skipped: [{ dir: root, reason: 'skillsRoot không tồn tại' }] };
  const brands = [], skipped = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const b = inspectBrand(path.join(root, e.name));
    if (b.skip) skipped.push({ dir: b.dir, reason: b.skip }); else brands.push(b);
  }
  return { root, brands, skipped };
}

// The brand by id, with its social.json and project.md; only usable (enabled, valid) brands unless allowDisabled.
export function loadBrand(id, { allowDisabled = false } = {}) {
  const { brands, root } = discoverBrands();
  const b = brands.find((x) => x.id === id);
  if (!b) throw new Error(`Không có thương hiệu "${id}" trong ${root}.`);
  if (!allowDisabled && !b.usable) throw new Error(`Thương hiệu "${id}" chưa dùng được: ${b.enabled ? b.problems.join('; ') : 'social.json enabled: false'}.`);
  return { ...b, social: readJson(path.join(b.dir, 'project/social.json')), project: fs.readFileSync(path.join(b.dir, 'project/project.md'), 'utf8') };
}

// ----- runs, ideas, drafts -----
export const runDir = (brand, date) => path.join(workspace, 'runs', brand, date);

// The brand's crawl inputs, only from its own project/social.json: research.sources[] (id, name, platform, url,
// enabled, what_to_take, notes), enabled ones only. The tool keeps no source list of its own.
export function brandSources(social) {
  return (Array.isArray(social.research?.sources) ? social.research.sources : [])
    .filter((x) => x && x.url && x.enabled === true && /^[a-z0-9][a-z0-9-]*$/.test(x.id || ''))
    .map((x) => ({ id: x.id, name: x.name || x.id, platform: x.platform || '', url: x.url, what_to_take: x.what_to_take || '', notes: x.notes || '' }));
}

// Every reference of a brand's run, across its source folders: key '<source-id>/R01', image relative to the run folder.
export function loadRefs(brand, date) {
  const dir = runDir(brand, date);
  const refs = [];
  if (!fs.existsSync(dir)) return refs;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, e.name, 'refs.json');
    if (!e.isDirectory() || !fs.existsSync(file)) continue;
    for (const r of readJson(file).refs) refs.push({ ...r, key: `${e.name}/${r.id}`, source: e.name, image: `${e.name}/${r.image}` });
  }
  return refs;
}
export function latestRun(brand) {
  const dir = path.join(workspace, 'runs', brand);
  if (!fs.existsSync(dir)) return '';
  return fs.readdirSync(dir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop() || '';
}
export const draftsRoot = path.join(workspace, 'drafts');
export function findDraft(id) {
  if (!/^[a-z0-9-]+$/.test(id || '')) throw new Error('Mã bản nháp không hợp lệ.');
  const brand = id.replace(/-\d{8}-\d{2}$/, '');
  const dir = path.join(draftsRoot, brand, id);
  if (!fs.existsSync(path.join(dir, 'draft.json'))) throw new Error(`Không có bản nháp ${id}.`);
  return { dir, draft: readJson(path.join(dir, 'draft.json')), status: readJson(path.join(dir, 'status.json'), { status: 'preparing' }) };
}
export function setStatus(dir, status, extra = {}) {
  const file = path.join(dir, 'status.json');
  return withLock(file, () => {
    const next = { ...readJson(file, {}), ...extra, status, updated: stamp() };
    writeJson(file, next);
    return next;
  });
}
export function listDrafts(brand) {
  const brands = brand ? [brand] : (fs.existsSync(draftsRoot) ? fs.readdirSync(draftsRoot) : []);
  const list = [];
  for (const b of brands) {
    const dir = path.join(draftsRoot, b);
    if (!fs.existsSync(dir)) continue;
    for (const id of fs.readdirSync(dir).sort()) {
      const d = path.join(dir, id);
      if (!fs.existsSync(path.join(d, 'draft.json'))) continue;
      list.push({ id, dir: d, draft: readJson(path.join(d, 'draft.json')), status: readJson(path.join(d, 'status.json'), { status: 'preparing' }) });
    }
  }
  return list;
}

// Longest run of shared words between two texts (copy check against a competitor caption).
export function sharedWords(a, b, n = 6) {
  const words = (t) => String(t || '').toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const wb = words(b);
  const grams = new Set();
  for (let i = 0; i + n <= wb.length; i++) grams.add(wb.slice(i, i + n).join(' '));
  const wa = words(a), hits = [];
  for (let i = 0; i + n <= wa.length; i++) { const g = wa.slice(i, i + n).join(' '); if (grams.has(g)) hits.push(g); }
  return hits;
}
