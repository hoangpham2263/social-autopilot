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
// Dates are local, never UTC: a brand's date is in its timezone (social.json cadence.timezone), tool-level dates (logs,
// research-log totals) in Vietnam time. new Date().toISOString() rolled back a day before 07:00 VN.
export const TOOL_TZ = 'Asia/Ho_Chi_Minh';
export const validTimeZone = (tz) => { if (typeof tz !== 'string' || !tz.trim()) return false; try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };
export function today(tz = TOOL_TZ, now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: validTimeZone(tz) ? tz : TOOL_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
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

// A scheduled agent and a manual chat run can overlap: every read-modify-write of a shared file
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
const RESEARCH_DROPPED = ['max_sources_per_run', 'max_posts_per_source', 'max_posts_per_day_all_brands', 'max_per_day'];
// Every key not sent keeps this machine's current value (defaults + workspace/settings.json, merged deeply); nothing is
// reset to config/settings.json and no key is dropped. Values are checked strictly: a wrong type is refused, never coerced.
export function saveSettings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('settings phải là một object.');
  const file = path.join(workspace, 'settings.json');
  return withLock(file, () => {
    const cur = rawSettings();
    const int = (v, name, min = 0) => { const n = typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : v; if (!Number.isInteger(n) || n < min) throw new Error(`${name} phải là số nguyên >= ${min}.`); return n; };
    const str = (v, name) => { if (typeof v !== 'string' || !v.trim()) throw new Error(`${name} không được trống.`); if (/token|secret|password/i.test(v)) throw new Error(`${name} không được chứa token/mật khẩu.`); return v.trim(); };
    const bool = (v, name) => { if (v === true || v === 'true') return true; if (v === false || v === 'false') return false; throw new Error(`${name} phải là true hoặc false (nhận ${JSON.stringify(v)}).`); };
    const obj = (v, name) => { if (v === undefined) return {}; if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${name} phải là object.`); return v; };
    const r = obj(input.research, 'research'), mc = obj(input.metricool, 'metricool'), cx = obj(input.codex, 'codex'), ff = obj(input.ffmpeg, 'ffmpeg'), rw = obj(input.remove_watermark, 'remove_watermark'), ih = obj(input.imageHost, 'imageHost');
    const cr = cur.research || {};
    const delay = [].concat(r.delay_seconds ?? cr.delay_seconds).map((x, i) => int(x, `research.delay_seconds[${i}]`));
    if (delay.length !== 2 || delay[0] > delay[1]) throw new Error('research.delay_seconds phải là [min, max] với min <= max.');
    // Metricool: always real scheduling (no draft mode any more); an old metricool.default_mode is dropped.
    void mc;
    const changes = {
      skillsRoot: str(input.skillsRoot ?? cur.skillsRoot, 'skillsRoot'),
      // Research: only the human-like pause between page actions; there are no run or post limits.
      research: { ...Object.fromEntries(Object.entries(cr).filter(([k]) => !RESEARCH_DROPPED.includes(k))), delay_seconds: delay },
      metricool: Object.fromEntries(Object.entries(cur.metricool || {}).filter(([k]) => k !== 'default_mode')),
      codex: { command: str(cx.command ?? cur.codex?.command, 'codex.command'), timeout_minutes: int(cx.timeout_minutes ?? cur.codex?.timeout_minutes, 'codex.timeout_minutes', 1) },
      ffmpeg: { command: str(ff.command ?? cur.ffmpeg?.command, 'ffmpeg.command') },
      remove_watermark: { script: str(rw.script ?? cur.remove_watermark?.script, 'remove_watermark.script') },
    };
    // Providers: a map sent is the whole map (so one can be removed); not sent = kept.
    if (rw.providers !== undefined) changes.remove_watermark.providers = Object.fromEntries(Object.entries(obj(rw.providers, 'remove_watermark.providers')).map(([k, v]) => [str(k, 'provider'), str(v, 'provider')]));
    // Image host (host-image.mjs): the kind stays as configured; path, link base, branch, remote, verify and the
    // after-write-back switch editable; anything not sent stays as it is on this machine.
    const ch = cur.imageHost || {};
    if (ch.type) {
      const rawBase = str(ih.rawBase ?? ch.rawBase, 'imageHost.rawBase');
      if (!/^https:\/\//.test(rawBase)) throw new Error('imageHost.rawBase phải là link https.');
      const host = { path: str(ih.path ?? ch.path, 'imageHost.path'), rawBase, auto_after_writeback: bool(ih.auto_after_writeback ?? ch.auto_after_writeback ?? true, 'imageHost.auto_after_writeback') };
      for (const k of ['branch', 'remote']) if (ih[k] !== undefined || ch[k] !== undefined) host[k] = str(ih[k] ?? ch[k], `imageHost.${k}`);
      const v = obj(ih.verify, 'imageHost.verify'), cv = ch.verify || {};
      if (Object.keys(v).length || Object.keys(cv).length) host.verify = { ...cv, ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, int(x, `imageHost.verify.${k}`, k === 'attempts' ? 1 : 0)])) };
      changes.imageHost = host;
    }
    if (!fs.existsSync(path.resolve(toolRoot, changes.skillsRoot))) throw new Error(`skillsRoot không tồn tại: ${path.resolve(toolRoot, changes.skillsRoot)}`);
    const next = merge(cur, changes);
    // No approval step any more (user, 09/11/2026): older settings files lose their approval block on save.
    delete next.approval;
    next.research = changes.research;
    next.metricool = changes.metricool;
    if (changes.remove_watermark.providers) next.remove_watermark.providers = changes.remove_watermark.providers;
    writeJson(file, next);
    return next;
  });
}

// ----- Metricool brands: config/metricool-brands.json (defaults, in git) or workspace/metricool-brands.json (this machine) -----
// The plan has no API, so the account's brands are listed by hand (name, blog_id, timezone, networks, skill_id or null).
export const metricoolFile = () => { const own = path.join(workspace, 'metricool-brands.json'); return fs.existsSync(own) ? own : path.join(toolRoot, 'config', 'metricool-brands.json'); };
export const metricoolBrands = () => readJson(metricoolFile());
export function saveMetricoolBrands(input) {
  const list = Array.isArray(input?.brands) ? input.brands : null;
  if (!list) throw new Error('Thiếu danh sách brands.');
  const secrets = secretProblems(input);
  if (secrets.length) throw new Error(`Không lưu token/mật khẩu: ${secrets.join('; ')}.`);
  let current = {};
  try { current = metricoolBrands(); } catch {}
  if (input.account !== undefined && (!input.account || typeof input.account !== 'object' || Array.isArray(input.account))) throw new Error('account phải là object.');
  const account = { ...(current.account || {}), ...(input.account || {}) };
  if (account.brand_limit !== undefined && account.brand_limit !== null && account.brand_limit !== '') {
    const n = typeof account.brand_limit === 'string' && /^\d+$/.test(account.brand_limit.trim()) ? Number(account.brand_limit) : account.brand_limit;
    if (!Number.isInteger(n) || n < 1) throw new Error('account.brand_limit phải là số nguyên >= 1.');
    account.brand_limit = n;
  }
  if (account.brand_limit && list.length > account.brand_limit) throw new Error(`Gói Metricool chỉ có ${account.brand_limit} brand (account.brand_limit), danh sách có ${list.length}.`);
  const names = new Set(), skills = new Set();
  const brands = list.map((b, i) => {
    if (!b || typeof b !== 'object') throw new Error(`Brand thứ ${i + 1} không hợp lệ.`);
    const name = String(b.name || '').trim();
    if (!name) throw new Error(`Brand thứ ${i + 1} thiếu tên.`);
    const key = name.normalize('NFC').toLowerCase();
    if (names.has(key)) throw new Error(`Tên brand "${name}" bị trùng.`);
    names.add(key);
    const timezone = String(b.timezone || '').trim();
    if (!validTimeZone(timezone)) throw new Error(`Brand "${name}": timezone "${timezone}" không phải múi giờ IANA hợp lệ (vd. Asia/Ho_Chi_Minh).`);
    const skill_id = b.skill_id ? String(b.skill_id).trim() : null;
    if (skill_id) { if (skills.has(skill_id)) throw new Error(`skill_id "${skill_id}" gắn cho hơn một brand.`); skills.add(skill_id); }
    // skill_path (optional): the linked skill folder when it is not a sub-folder of skillsRoot (Tổng quan, Chọn skill).
    const skill_path = skill_id && typeof b.skill_path === 'string' && b.skill_path.trim() ? b.skill_path.trim() : undefined;
    return { name, blog_id: String(b.blog_id || '').trim(), timezone, networks: [].concat(b.networks || []).map(String).filter(Boolean), skill_id, ...(skill_path ? { skill_path } : {}), last_checked: String(b.last_checked || '').trim() };
  });
  const next = { version: 1, account, brands };
  const file = path.join(workspace, 'metricool-brands.json');
  withLock(file, () => writeJson(file, next));
  return next;
}
// A brand skill folder: SKILL.md, project/project.md and project/social.json. Its id is the folder name without -skills.
export const SKILL_FILES = ['SKILL.md', 'project/project.md', 'project/social.json'];
export const isSkillDir = (dir) => SKILL_FILES.every((f) => fs.existsSync(path.join(dir, f)));
export const skillIdOf = (dir) => path.basename(path.resolve(dir)).replace(/-skills$/, '');

const samePath = (x, y) => path.resolve(x).toLowerCase() === path.resolve(y).toLowerCase();
// Chọn skill / Đổi skill / Ngắt kết nối (Tổng quan): links one Metricool brand to a skill folder BY PATH, in place
// (nothing is copied: the tool reads and writes that folder). skill_path is the source of truth; skill_id (the folder
// name without -skills) is kept as the brand's id for scripts and stores. skillDir null = unlink (the folder is never
// touched; the tool stops making and sending posts for that Metricool brand).
export function linkMetricool(name, skillDir) {
  const cfg = metricoolBrands();
  const b = (cfg.brands || []).find((x) => x.name === name);
  if (!b) throw new Error(`Unknown Metricool brand "${name}".`);
  let skill_id = null, skill_path;
  if (skillDir) {
    const dir = path.resolve(String(skillDir).trim());
    if (!isSkillDir(dir)) throw new Error(`${dir} is not a skill folder (needs ${SKILL_FILES.join(', ')}).`);
    skill_id = skillIdOf(dir);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(skill_id)) throw new Error(`Skill folder name "${path.basename(dir)}" is not valid (lowercase letters, digits, hyphens).`);
    const other = cfg.brands.find((x) => x !== b && (x.skill_id === skill_id || (x.skill_path && samePath(x.skill_path, dir))));
    if (other) throw new Error(`Skill "${skill_id}" is already linked to "${other.name}".`);
    skill_path = dir.split(path.sep).join('/');
  }
  return saveMetricoolBrands({ ...cfg, brands: cfg.brands.map((x) => { if (x !== b) return x; const { skill_path: _, ...rest } = x; return { ...rest, skill_id, ...(skill_path ? { skill_path } : {}) }; }) });
}

// The folder a Metricool brand points to: its skill_path; an older entry with only skill_id means skillsRoot/<id>-skills.
export const linkedDir = (m, s = settings()) => (m?.skill_path ? path.resolve(m.skill_path) : m?.skill_id ? path.join(s.skillsRoot, `${m.skill_id}-skills`) : '');

// Every skill folder the tool works with: the sub-folders of skillsRoot, plus the folders linked by path. A linked
// path owns its id: a skillsRoot folder of the same id is not used for it, also when the linked folder is missing
// (renamed or moved), so a brand never silently falls back to another folder.
export function skillDirs(s = settings()) {
  const root = s.skillsRoot, byId = new Map();
  if (fs.existsSync(root)) for (const e of fs.readdirSync(root, { withFileTypes: true })) if (e.isDirectory() && !e.name.startsWith('.')) byId.set(skillIdOf(e.name), path.join(root, e.name));
  let linked = [];
  try { linked = metricoolBrands().brands || []; } catch {}
  for (const m of linked) if (m.skill_id && m.skill_path) {
    const dir = path.resolve(m.skill_path);
    if (isSkillDir(dir)) byId.set(m.skill_id, dir); else if (byId.has(m.skill_id) && !samePath(byId.get(m.skill_id), dir)) byId.delete(m.skill_id);
  }
  return [...byId.values()];
}
// Every brand of the Metricool account with its skill (status, missing items, timezone check), plus the skills that have no
// Metricool brand yet. The skill is found by the linked folder (skill_path); skill_path_missing = that folder is gone.
export function brandOverview(found = discoverBrands()) {
  const cfg = metricoolBrands();
  const used = new Set();
  const brands = (cfg.brands || []).map((m) => {
    const dir = m.skill_id ? linkedDir(m) : '';
    const skill = dir ? found.brands.find((b) => samePath(b.dir, dir)) : null;
    if (skill) used.add(skill.id);
    // tz_mismatch (informational): cadence.timezone (audience, where times are planned) differs from the Metricool brand;
    // metricool-csv.mjs converts every posting time, so it is not an error. tz_conflict: the skill's metricool.timezone
    // disagrees with the Metricool brand's timezone (a wrong setting: times would be converted to the wrong zone).
    const tz_mismatch = !!(skill && m.timezone && skill.timezone && skill.timezone !== m.timezone);
    const tz_conflict = !!(skill && m.timezone && skill.metricool_timezone && skill.metricool_timezone !== m.timezone);
    const skill_path_missing = !!(m.skill_id && !isSkillDir(dir));
    return { ...m, skill: skill ? { id: skill.id, brand: skill.brand, enabled: skill.enabled, ready: skill.ready, usable: skill.usable, problems: skill.problems, timezone: skill.timezone, metricool_timezone: skill.metricool_timezone || '' } : null, skill_missing: !!(m.skill_id && !skill), skill_path_missing, tz_mismatch, tz_conflict };
  });
  return { account: cfg.account || {}, brands, skills_without_metricool: found.brands.filter((b) => !used.has(b.id)).map((b) => ({ id: b.id, brand: b.brand })) };
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
// The value only: a trailing note in parentheses or an HTML comment is cut ("#DreamyVows (người dùng chốt ...)" -> "#DreamyVows").
export const projectField = (md, label) => (md.match(new RegExp(`^- ${label}(?: \\(\\*\\))?:\\s*(.+)$`, 'm'))?.[1] || '')
  .replace(/\s*<!--.*?-->/g, '').replace(/\s+\([^()]*\)\s*$/, '').trim();

// Languages that are POSTED: every lang of the enabled channels (social.json channels[]).
export function brandLanguages(social) {
  const langs = new Set();
  for (const c of social.channels || []) if (c.enabled) for (const l of [].concat(c.lang || [])) langs.add(l);
  return [...langs];
}
export const postedLangs = brandLanguages;
// Reviewer-only languages (social.json language_policy.review_langs, e.g. ["vn"]): a content-<lang>.txt is written and
// checked for the approver to read, but it is NEVER posted: not in the post text, the preview's posted text, the
// catalog's posted captions or the Metricool CSV. A posted language is never also a review language.
export function reviewLanguages(social) {
  const posted = new Set(brandLanguages(social));
  return [...new Set([].concat(social?.language_policy?.review_langs || []).map((l) => String(l).trim()).filter((l) => /^[a-z]{2}$/.test(l) && !posted.has(l)))];
}
export const reviewLangs = reviewLanguages;

// ----- AI labels: never on a post (user rule). Captions and CSV Text are refused when they carry one. -----
// "AI" in upper case is a label; lower-case "ai" in Vietnamese means "who", so Vietnamese patterns need upper-case AI
// (or "trí tuệ nhân tạo"). Text is compared without diacritics.
const AI_TAGS = /^(ai|a\.i|ai\w*(generated|art|artwork|artist|image|images|photo|photos|photography|created|made|design|assisted|edit|edited|render|rendered|illustration|picture)|(made|created|generated|designed|drawn|edited|done|tao|lam|ve)(with|by|bang|boi|voi)ai|generativeai|midjourney|dalle\d*|stablediffusion|anhai|hinhai|tranhai)$/;
export function aiLabelHits(text) {
  const raw = String(text || '').normalize('NFC');
  const marked = raw.replace(/(?<![\p{L}\p{N}_])A\.?I\.?(?![\p{L}\p{N}_])/gu, '§AI§');
  const s = marked.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase();
  const hits = [];
  for (const m of s.matchAll(/#([\p{L}\p{N}_.]+)/gu)) if (AI_TAGS.test(m[1].replace(/§/g, '').replace(/\.$/, ''))) hits.push(`#${m[1].replace(/§/g, '')}`);
  const EAI = '(?:§ai§|\\bai\\b|artificial intelligence)', VAI = '(?:§ai§|tri tue nhan tao)';
  const patterns = [
    new RegExp(`\\b(?:made|created|generated|produced|designed|rendered|edited|enhanced|crafted|built|drawn|illustrated|powered|imagined|done)\\s+(?:with|by|using|via|through)\\s+(?:an?\\s+|the\\s+help\\s+of\\s+|the\\s+)?${EAI}`),
    new RegExp(`${EAI}[\\s-]*(?:generated|created|made|art|artwork|image|images|photo|photos|render|rendered|assisted|edited|enhanced|illustration|picture)\\b`),
    new RegExp(`\\bgenerative\\s+${EAI}`),
    new RegExp(`\\b(?:tao|lam|ve|sinh|dung|thiet ke|chinh sua|che|xu ly|minh hoa)(?:\\s+ra)?\\s+(?:bang|boi|voi|tu|nho|qua)\\s+(?:cong nghe\\s+|cong cu\\s+)?${VAI}`),
    new RegExp(`\\bminh\\s+hoa[^\\n]{0,60}${VAI}`),
    new RegExp(`\\b(?:anh|hinh|hinh anh|tranh|buc anh)\\s+${VAI}`),
    new RegExp(`${VAI}\\s+(?:tao|ve|sinh|lam|thiet ke)\\b`),
    new RegExp(`\\b(?:do|boi)\\s+${VAI}\\s`),
  ];
  for (const re of patterns) { const m = s.match(re); if (m) hits.push(m[0].replace(/§ai§/g, 'AI').trim()); }
  return [...new Set(hits)];
}

// ----- secrets: keys and values that look like a token/password (social.json, metricool-brands.json) -----
// Only real secret keys (token, secret, password, api key, access key, x-mc-auth, bearer, cookie, credentials,
// authorization); "author", "session_note", "auth_owner" are fine.
const SECRET_WORDS = new Set(['token', 'tokens', 'secret', 'secrets', 'password', 'passwords', 'passwd', 'pwd', 'bearer', 'cookie', 'cookies', 'credential', 'credentials', 'authorization']);
const SECRET_JOINED = /(apikey|accesskey|secretkey|privatekey|clientsecret|accesstoken|refreshtoken|xmcauth|authtoken|sessiontoken|sessionid|sessioncookie)/;
export function secretKey(k) {
  const words = String(k).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return words.some((w) => SECRET_WORDS.has(w)) || SECRET_JOINED.test(words.join(''));
}
export const looksLikeToken = (v) => typeof v === 'string' && (/^\s*bearer\s+\S{10,}/i.test(v) || (!/\s/.test(v) && !/^https?:\/\//.test(v)
  && (/^(EAA|sk-|ghp_|gho_|github_pat_|xox[bp]-|ya29\.|AKIA)/.test(v) || (v.length >= 40 && /^[A-Za-z0-9_\-.=+]+$/.test(v) && /\d/.test(v) && /[A-Za-z]/.test(v)))));
export function secretProblems(value, at = '') {
  const found = [];
  if (Array.isArray(value)) value.forEach((x, i) => found.push(...secretProblems(x, `${at}[${i}]`)));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) {
    if (secretKey(k)) found.push(`trường "${at}${k}" giống token/mật khẩu`);
    found.push(...secretProblems(v, `${at}${k}.`));
  } else if (looksLikeToken(value)) found.push(`giá trị ở "${at.replace(/\.$/, '')}" giống token`);
  return found;
}

// One brand = one skill folder (under skillsRoot, or linked by path from Tổng quan) with SKILL.md, project/project.md and project/social.json.
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
  result.timezone = social.cadence?.timezone || '';
  result.posts_per_week = Number.isInteger(social.cadence?.posts_per_week) ? social.cadence.posts_per_week : null;
  result.metricool_timezone = typeof social.metricool?.timezone === 'string' ? social.metricool.timezone.trim() : '';
  result.review_languages = reviewLanguages(social);
  result.sources = brandSources(social).map((x) => x.id);
  result.ai_scenes_allowed = social.product_images?.ai_scenes_allowed !== false; // on unless explicitly false
  const checker = path.join(dir, 'scripts', 'check-skill.mjs');
  if (!fs.existsSync(checker)) result.problems.push('skill thiếu scripts/check-skill.mjs');
  else {
    const r = spawnSync(process.execPath, [checker, '--tool-ready'], { cwd: dir, encoding: 'utf8', windowsHide: true });
    result.ready = r.status === 0;
    if (!result.ready) result.problems.push(...String(r.stdout).split(/\r?\n/).filter((l) => /^\s+- |^LỖI /.test(l)).map((l) => l.replace(/^\s+- /, 'missing: ').trim()));
  }
  result.usable = result.enabled && result.ready;
  return result;
}

export function discoverBrands(s = settings()) {
  const root = s.skillsRoot;
  const dirs = skillDirs(s);
  if (!fs.existsSync(root) && !dirs.length) return { root, brands: [], skipped: [{ dir: root, reason: 'skillsRoot không tồn tại' }] };
  const brands = [], skipped = [];
  for (const dir of dirs) {
    const b = inspectBrand(dir);
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
    // tool_status = the last status the tool itself set (kept for the log).
    const next = { ...readJson(file, {}), ...extra, status, tool_status: status, updated: stamp() };
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
