// Metricool CSV: export approved posts of a brand into Metricool's bulk-import CSV (the real 99-column template in
// docs/metricool-csv-template.csv), and validate such a file before a person imports it. Nothing is sent anywhere:
// this only reads the brand folder and writes the --out file (never inside the skills folders).
//   node scripts/metricool-csv.mjs export --brand <id> [--posts POST-01,POST-02] [--lang en]
//          [--date YYYY-MM-DD --time HH:MM] [--allow-today] [--check-urls] --out <file.csv>
//   node scripts/metricool-csv.mjs validate <file.csv> [--brand <id>] [--allow-today] [--check-urls]
// Why validate is strict (docs/metricool.md sections 5, 6): when ANY row has an error, Metricool imports ALL rows as
// drafts and a row with an invalid date "will be scheduled today at current time". So every problem is an error.
//
// Brand fields read from <skill>/project/social.json:
//   metricool.brand_name  exact Metricool brand label (e.g. "Dreamy Vows"); fallback: project.md "Tên thương hiệu" (warned)
//   metricool.timezone    the Metricool brand's timezone (Metricool reads CSV Date/Time in it); fallback: the brand's
//                         timezone in config/metricool-brands.json (skill_id), else cadence.timezone (warned, no conversion)
//   cadence.timezone      the AUDIENCE timezone: every posting time (cadence.slots, automatic times, catalog schedule,
//                         --date/--time) is planned in it and converted to the Metricool timezone when Date/Time are written
//   cadence.slots[]       { day: mon..sun, time: HH:MM } used for posts without catalog schedule {date, time}
//   channels[] enabled    -> network columns; language_policy.mode + channels[].lang -> Text
// Catalog post fields: status "approved"; media_url (string or array, max 10) or video_url (+ video_thumbnail_url);
//   media_alt / image_alt (string or array) for alt text; schedule { date: YYYY-MM-DD, time: HH:MM[:SS] };
//   facebook_post_type (default POST, REEL for a video).
import fs from 'node:fs';
import path from 'node:path';
import { main, out, fail, isMain, parseArgs, need, settings, toolRoot, readJson, projectField, cleanText, hasHidden, parseCsv, inside, aiLabelHits, reviewLanguages, metricoolBrands, skillDirs, linkedDir } from './lib.mjs';

// WebP in any form Metricool refuses ("Unsupported .webp format"): the extension anywhere in the URL, or a CDN format
// parameter (format=webp, fm=webp, f=webp, output=webp, ...). With --check-urls a content-type image/webp is refused too.
export const WEBP_URL = /\.webp|[?&;](?:format|fm|f|output|ext|type|mime|auto)=(?:image(?:%2F|\/))?webp(?:[&#;]|$)/i;

export const TEMPLATE = path.join(toolRoot, 'docs', 'metricool-csv-template.csv');
export const templateHeader = () => parseCsv(fs.readFileSync(TEMPLATE, 'utf8'))[0];

// Network column <- social.json channels[].network.
export const NETWORKS = {
  facebook: 'Facebook', twitter: 'Twitter/X', x: 'Twitter/X', linkedin: 'LinkedIn', gbp: 'GBP', gmb: 'GBP',
  instagram: 'Instagram', pinterest: 'Pinterest', tiktok: 'TikTok', youtube: 'Youtube', threads: 'Threads', bluesky: 'Bluesky',
};
export const NETWORK_COLUMNS = ['Facebook', 'Twitter/X', 'LinkedIn', 'GBP', 'Instagram', 'Pinterest', 'TikTok', 'Youtube', 'Threads', 'Bluesky'];
// Text length limits per network (characters, counted as code points). Sources: each network's published post limits;
// Twitter/X counts links and some characters double, so 280 here is a lower bound check. Pinterest = pin description.
export const TEXT_LIMITS = {
  Facebook: 63206, 'Twitter/X': 280, LinkedIn: 3000, GBP: 1500, Instagram: 2200, Pinterest: 500, TikTok: 2200, Youtube: 5000, Threads: 500, Bluesky: 300,
};
// Max media per post where it is below Metricool's 10 columns.
export const MEDIA_LIMITS = { 'Twitter/X': 4, Bluesky: 4, LinkedIn: 9 };
// Networks that cannot post text only / need a video.
const NEEDS_MEDIA = ['Instagram', 'Pinterest', 'TikTok', 'Youtube'];
const NEEDS_VIDEO = ['TikTok', 'Youtube'];
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi)(\?|#|$)/i;
const MAX_MEDIA = 10;
// User rule: never add an AI label when posting. Export always writes "false" (as the template's example row) in
// these columns and never adds AI disclosure text to Text; validate fails when any of them is not false/empty.
export const AI_LABEL_COLUMNS = ['Pinterest AI generated content', 'Pinterest AI generated person', 'Youtube AI generated content', 'TikTok Ai generated content'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const pics = (n) => `Picture Url ${n}`;
const alts = (n) => `Alt text picture ${n}`;

// ----- time in a timezone -----
export function nowIn(tz, now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
}
// Offset (ms) of tz at an instant: the wall clock in tz read as UTC, minus the instant.
function tzOffset(tz, instant) {
  const w = nowIn(tz, instant);
  const [y, mo, d] = w.date.split('-').map(Number), [h, mi, se] = w.time.split(':').map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, se) - Math.floor(instant.getTime() / 1000) * 1000;
}
// The instant of a wall-clock date + time in tz, DST-safe (as Temporal "compatible"): a time that happens twice when the
// clocks go back takes the first (earlier) one; a time skipped when the clocks go forward moves forward by the gap.
export function zonedToInstant(date, time, tz) {
  const t = normTime(time);
  const [y, mo, d] = date.split('-').map(Number), [h, mi, se] = t.split(':').map(Number);
  const local = Date.UTC(y, mo - 1, d, h, mi, se);
  const before = tzOffset(tz, new Date(local - 14 * 36e5)), after = tzOffset(tz, new Date(local + 14 * 36e5));
  const fits = (x) => { const w = nowIn(tz, new Date(x)); return w.date === date && w.time === t; };
  const ok = [local - before, local - after].filter(fits);
  return new Date(ok.length ? Math.min(...ok) : local - before);
}
// Wall-clock date + time in fromTz -> the same instant's wall clock in toTz (the date rolls over as needed).
export function convertZoned(date, time, fromTz, toTz) {
  const t = normTime(time);
  if (!fromTz || !toTz || fromTz === toTz) return { date, time: t };
  return nowIn(toTz, zonedToInstant(date, t, fromTz));
}
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
// "2026-11-10 10:00 America/Los_Angeles = 01:00 ngày hôm sau (2026-11-11) Indian/Christmas trong Metricool"
export function describeTimes(planned, metricool) {
  const hm = (t) => String(t).slice(0, 5);
  if (planned.timezone === metricool.timezone) return `${planned.date} ${hm(planned.time)} ${planned.timezone} (Metricool cùng múi giờ, không quy đổi)`;
  const dd = dayDiff(planned.date, metricool.date);
  const rel = dd === 0 ? 'cùng ngày' : dd === 1 ? 'ngày hôm sau' : dd === -1 ? 'ngày hôm trước' : `${dd > 0 ? '+' : ''}${dd} ngày`;
  return `${planned.date} ${hm(planned.time)} ${planned.timezone} = ${hm(metricool.time)} ${rel} (${metricool.date}) ${metricool.timezone} trong Metricool`;
}
const validTz = (tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };
export function validDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}
export const validTime = (s) => /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(s || '');
function normTime(s) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(s || '') ? `${s}:00` : String(s || ''); }
const addDays = (date, n) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = (date) => DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];

// ----- brands (read directly; no check-skill spawn, nothing written) -----
// The sub-folders of root plus the skill folders linked by path (lib.mjs skillDirs).
function brandDirs(root) {
  return skillDirs({ ...settings(), skillsRoot: root }).filter((d) => fs.existsSync(path.join(d, 'project', 'social.json')));
}
export function brandInfo(dir) {
  const social = readJson(path.join(dir, 'project', 'social.json'));
  const projectFile = path.join(dir, 'project', 'project.md');
  const project = fs.existsSync(projectFile) ? fs.readFileSync(projectFile, 'utf8') : '';
  const mc = social.metricool && typeof social.metricool === 'object' ? social.metricool : {};
  const configured = typeof mc.brand_name === 'string' && mc.brand_name.trim() !== '';
  const display = projectField(project, 'Tên thương hiệu') || social.brand || '';
  const id = path.basename(dir).replace(/-skills$/, '');
  const name = configured ? mc.brand_name.trim() : display;
  const cadenceTz = social.cadence?.timezone || '';
  // Metricool brand timezone: social.json metricool.timezone, else config/metricool-brands.json (by skill_id, then name).
  let cfg = null;
  try { const list = metricoolBrands().brands || []; cfg = list.find((b) => b.skill_id === id) || list.find((b) => name && b.name === name) || null; } catch {}
  const ownTz = typeof mc.timezone === 'string' ? mc.timezone.trim() : '';
  const cfgTz = cfg && typeof cfg.timezone === 'string' ? cfg.timezone.trim() : '';
  const tz = ownTz || cfgTz || cadenceTz;
  return {
    id, dir, social, enabled: social.enabled === true,
    brand_name: name,
    brand_name_source: configured ? 'social.json metricool.brand_name' : 'project.md "Tên thương hiệu" (chưa có metricool.brand_name)',
    brand_name_configured: configured,
    // timezone = the Metricool brand's timezone: CSV Date/Time are written in it.
    timezone: tz,
    timezone_source: ownTz ? 'social.json metricool.timezone' : cfgTz ? `config metricool-brands.json (brand "${cfg.name}")` : 'social.json cadence.timezone (chưa có metricool.timezone)',
    timezone_configured: !!(ownTz || cfgTz),
    config_timezone: cfgTz, config_brand: cfg?.name || '',
    // Metricool blogId: social.json metricool.blog_id, else the config brand matched above; config_skill_id tells whose it is.
    blog_id: String(mc.blog_id || cfg?.blog_id || '').trim(), config_blog_id: String(cfg?.blog_id || ''), config_skill_id: cfg ? cfg.skill_id ?? null : undefined,
    // audience_timezone = where posting times are planned (cadence.timezone); converted to timezone on export.
    cadence_timezone: cadenceTz,
    audience_timezone: cadenceTz && validTz(cadenceTz) ? cadenceTz : tz,
  };
}
export function allBrands(root = settings().skillsRoot) { return brandDirs(root).map(brandInfo); }
export function findBrand(id, root = settings().skillsRoot) {
  const dir = brandDirs(root).find((d) => [path.basename(d), path.basename(d).replace(/-skills$/, '')].includes(id));
  if (!dir) throw new Error(`Không có thương hiệu "${id}" trong ${root}.`);
  return brandInfo(dir);
}

// ----- CSV writing: UTF-8 without BOM (as the template), LF, booleans bare, other values quoted -----
const BOOL = (v) => v === 'true' || v === 'false';
const cell = (v) => { const s = String(v ?? ''); if (s === '' || BOOL(s)) return s; return `"${s.replace(/"/g, '""')}"`; };
export const toMetricoolCsv = (header, rows) => [header.map(cell).join(','), ...rows.map((r) => header.map((h) => cell(r[h])).join(','))].join('\n') + '\n';

// ----- URL check (HEAD, then a 1-byte GET when HEAD is refused) -----
export async function checkUrl(url, { timeoutMs = 15000 } = {}) {
  const once = async (method) => {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { method, redirect: 'follow', signal: ctl.signal, headers: method === 'GET' ? { range: 'bytes=0-0' } : {} });
      try { await r.body?.cancel(); } catch {}
      return { status: r.status, type: (r.headers.get('content-type') || '').toLowerCase() };
    } finally { clearTimeout(t); }
  };
  try {
    let r = await once('HEAD');
    if (r.status === 405 || r.status === 403 || r.status === 501) r = await once('GET');
    const okStatus = r.status === 200 || r.status === 206;
    const okType = /^(image|video)\//.test(r.type);
    const webp = /^image\/webp\b/.test(r.type);
    return { ok: okStatus && okType && !webp, status: r.status, content_type: r.type, error: !okStatus ? `HTTP ${r.status}` : !okType ? `content-type "${r.type || '(trống)'}" không phải image/* hay video/*` : webp ? 'máy chủ trả ảnh WebP (content-type image/webp): Metricool báo "Unsupported .webp format"; dùng PNG/JPG trên repo ảnh' : '' };
  } catch (e) { return { ok: false, status: 0, content_type: '', error: e.name === 'AbortError' ? 'hết thời gian chờ' : e.message }; }
}

// ----- validation of rows (objects keyed by header) -----
// ctx: { brands: [{brand_name, timezone, audience_timezone, brand_name_configured}], brand (expected brand info or null),
// allowToday, now }. Date/Time are read in the brand's Metricool timezone; the past/today rules are applied to the same
// instant in the audience timezone (where times are planned). times[] shows both for every row of a known brand.
export function validateRows(rows, ctx) {
  const errors = [], warnings = [], times = [];
  const err = (row, field, error) => errors.push({ row, field, error });
  const known = ctx.brands.filter((b) => b.brand_name_configured);
  if (!ctx.brand && !known.length) warnings.push('Chưa thương hiệu nào có social.json metricool.brand_name: không kiểm được Brand name với nhãn trong Metricool.');
  const seen = new Map(), zones = new Map();
  rows.forEach((r, i) => {
    const n = i + 2; // line number of the row's first line counted as CSV records (header = 1)
    // Brand name
    const name = r['Brand name'] ?? '';
    let tz = '', aud = '';
    if (!name.trim()) err(n, 'Brand name', 'trống (Metricool không biết đưa bài vào brand nào)');
    else if (name !== name.trim()) err(n, 'Brand name', `có khoảng trắng thừa: "${name}"`);
    else if (ctx.brand) {
      if (name !== ctx.brand.brand_name) err(n, 'Brand name', `"${name}" khác tên brand Metricool của ${ctx.brand.id}: "${ctx.brand.brand_name}" (${ctx.brand.brand_name_source})`);
      tz = ctx.brand.timezone; aud = ctx.brand.audience_timezone || tz;
    } else {
      const b = known.find((x) => x.brand_name === name);
      if (b) { tz = b.timezone; aud = b.audience_timezone || tz; }
      else if (known.length) err(n, 'Brand name', `"${name}" không khớp metricool.brand_name nào (${known.map((x) => `"${x.brand_name}"`).join(', ')}); phân biệt hoa thường và dấu cách`);
    }
    if (tz && !validTz(tz)) { err(n, 'Brand name', `timezone "${tz}" của brand không hợp lệ`); tz = ''; }
    if (!aud || !validTz(aud)) aud = tz;
    if (tz) zones.set(name, tz);
    if (!tz) tz = aud = 'Pacific/Kiritimati'; // unknown brand timezone: compare with the earliest "today" on Earth (UTC+14)
    // Date / Time
    const date = r.Date ?? '', time = r.Time ?? '';
    const dateOk = validDate(date), timeOk = validTime(time);
    if (!dateOk) err(n, 'Date', `"${date}" không phải ngày YYYY-MM-DD hợp lệ (Metricool sẽ đặt "hôm nay giờ hiện tại")`);
    if (!timeOk) err(n, 'Time', `"${time}" không phải giờ HH:MM:SS hợp lệ`);
    if (dateOk) {
      // The row's instant on the audience's wall clock (the CSV values themselves when the zones are equal).
      const conv = timeOk && aud !== tz;
      const local = conv ? convertZoned(date, time, tz, aud) : { date, time };
      if (timeOk && zones.has(name)) times.push({ row: n, metricool: { date, time, timezone: tz }, planned: { ...local, timezone: aud }, note: describeTimes({ ...local, timezone: aud }, { date, time, timezone: tz }) });
      const at = conv ? `${aud} (Metricool ${tz}: ${date} ${time})` : aud;
      const now = nowIn(aud, ctx.now);
      if (local.date < now.date) err(n, 'Date', `${local.date} đã qua (hôm nay ở ${at} là ${now.date})`);
      else if (local.date === now.date) {
        if (!ctx.allowToday) err(n, 'Date', `${local.date} là hôm nay ở ${at}; chỉ nhận ngày mai trở đi (dùng --allow-today nếu thật sự muốn)`);
        else if (timeOk && local.time <= now.time) err(n, 'Time', `${local.time} hôm nay đã qua ở ${at} (bây giờ ${now.time})`);
      }
    }
    // Draft
    if (!BOOL(r.Draft ?? '')) err(n, 'Draft', `"${r.Draft ?? ''}" phải là true hoặc false (viết thường)`);
    // Networks
    const on = [];
    for (const col of NETWORK_COLUMNS) {
      const v = r[col] ?? '';
      if (v === 'true') on.push(col);
      else if (v !== '' && v !== 'false') err(n, col, `"${v}" phải là true, false hoặc trống (viết thường)`);
    }
    if (!on.length) err(n, 'networks', 'không có mạng nào true (Facebook, Instagram, ...)');
    for (const col of AI_LABEL_COLUMNS) {
      const v = r[col] ?? '';
      if (v !== '' && v !== 'false') err(n, col, `"${v}": không gắn nhãn AI khi đăng (quy tắc người dùng); phải là false hoặc trống`);
    }
    // Media
    const media = [];
    let gap = 0;
    for (let k = 1; k <= MAX_MEDIA; k++) {
      const url = r[pics(k)] ?? '', alt = r[alts(k)] ?? '';
      if (!url) { if (alt) err(n, alts(k), `có alt text nhưng ${pics(k)} trống`); if (!gap) gap = k; continue; }
      if (gap) err(n, pics(k), `${pics(gap)} trống nhưng ${pics(k)} có link (ảnh phải liền nhau từ 1)`);
      media.push(url);
      if (/\s/.test(url)) err(n, pics(k), 'link có khoảng trắng');
      let u = null; try { u = new URL(url); } catch {}
      if (!u || u.protocol !== 'https:') err(n, pics(k), `"${url}" phải là link https`);
      if (WEBP_URL.test(url)) err(n, pics(k), `link là WebP (".webp" hoặc format=webp): Metricool báo "Unsupported .webp format" (xét chuỗi trong URL, kể cả khi CDN trả JPEG); dùng PNG/JPG trên repo ảnh`);
    }
    const thumb = r['Video Thumbnail Url'] ?? '';
    if (thumb) {
      let u = null; try { u = new URL(thumb); } catch {}
      if (!u || u.protocol !== 'https:') err(n, 'Video Thumbnail Url', `"${thumb}" phải là link https`);
      if (WEBP_URL.test(thumb)) err(n, 'Video Thumbnail Url', 'link là WebP (".webp" hoặc format=webp; Metricool không nhận)');
    }
    const videos = media.filter((m) => VIDEO_EXT.test(m));
    if (videos.length && media.length > videos.length) err(n, 'Picture Url', 'trộn video và ảnh trong một bài');
    if (videos.length > 1) err(n, 'Picture Url', 'nhiều hơn 1 video trong một bài');
    for (const col of on) {
      if (NEEDS_MEDIA.includes(col) && !media.length) err(n, col, `${col} cần ít nhất 1 ảnh/video`);
      if (NEEDS_VIDEO.includes(col) && !videos.length) err(n, col, `${col} cần video`);
      if (MEDIA_LIMITS[col] && media.length > MEDIA_LIMITS[col]) err(n, col, `${col} nhận tối đa ${MEDIA_LIMITS[col]} ảnh, bài có ${media.length}`);
    }
    // Text
    const text = r.Text ?? '';
    if (!text.trim()) err(n, 'Text', 'trống');
    else {
      const len = Array.from(text).length;
      for (const col of on) if (len > TEXT_LIMITS[col]) err(n, 'Text', `${len} ký tự, quá giới hạn ${col} (${TEXT_LIMITS[col]})`);
      if (hasHidden(text)) err(n, 'Text', 'có ký tự ẩn (zero-width, NBSP, BOM, ...)');
      const ai = aiLabelHits(text);
      if (ai.length) err(n, 'Text', `có nhãn AI (${ai.map((x) => `"${x}"`).join(', ')}): không gắn nhãn AI khi đăng (quy tắc người dùng)`);
    }
    // Same brand + time + network twice
    for (const col of on) {
      const key = `${name}|${date}|${time}|${col}`;
      if (seen.has(key)) warnings.push(`Dòng ${n} trùng brand, giờ và mạng ${col} với dòng ${seen.get(key)}.`);
      else seen.set(key, n);
    }
    r._media = media;
  });
  if (new Set(zones.values()).size > 1) warnings.push(`File trộn brand khác timezone (${[...zones].map(([b, z]) => `${b}: ${z}`).join(', ')}); chưa kiểm chứng Metricool dùng timezone brand đích hay calendar đang mở (docs/metricool.md mục 6). Nên tách file theo timezone.`);
  return { errors, warnings, times };
}

async function checkMedia(rows, errors) {
  const cache = new Map();
  const results = [];
  for (const [i, r] of rows.entries()) {
    const urls = [...(r._media || []), ...(r['Video Thumbnail Url'] ? [r['Video Thumbnail Url']] : [])];
    for (const url of urls) {
      if (!/^https:\/\//.test(url)) continue;
      if (!cache.has(url)) cache.set(url, await checkUrl(url));
      const c = cache.get(url);
      results.push({ row: i + 2, url, status: c.status, content_type: c.content_type, ok: c.ok });
      if (!c.ok) errors.push({ row: i + 2, field: 'Picture Url', error: `${url}: ${c.error}` });
    }
  }
  return results;
}

// ----- posting times -----
// Next free cadence slots, starting tomorrow (or today later than now with allowToday), planned in the audience timezone.
function slotPicker(slots, tz, taken, { allowToday, now }) {
  const clean = (Array.isArray(slots) ? slots : []).filter((s) => DAYS.includes(s?.day) && /^([01]\d|2[0-3]):[0-5]\d$/.test(s?.time || ''))
    .map((s) => ({ day: s.day, time: `${s.time}:00` })).sort((a, b) => a.time.localeCompare(b.time));
  const cur = nowIn(tz, now);
  return () => {
    if (!clean.length) return null;
    for (let d = allowToday ? 0 : 1; d < 366; d++) {
      const date = addDays(cur.date, d);
      for (const s of clean) {
        if (s.day !== weekday(date)) continue;
        if (d === 0 && s.time <= cur.time) continue;
        const key = `${date} ${s.time}`;
        if (!taken.has(key)) { taken.add(key); return { date, time: s.time }; }
      }
    }
    return null;
  };
}

// Automatic posting times when cadence.slots is empty: good default days and hours per network, planned in the audience
// timezone (cadence.timezone) and converted to the Metricool timezone on export (docs/metricool.md "Giờ đăng tự động"). The first network of the brand's enabled channels decides.
export const AUTO_TIMES = {
  Facebook: { days: ['tue', 'wed', 'thu'], times: ['09:00', '10:00', '11:00'] },
  Instagram: { days: ['tue', 'wed', 'fri'], times: ['11:00', '13:00', '10:00'] },
  TikTok: { days: ['tue', 'thu', 'fri'], times: ['18:00', '19:00', '17:00'] },
  LinkedIn: { days: ['tue', 'wed', 'thu'], times: ['08:00', '10:00', '12:00'] },
  Pinterest: { days: ['fri', 'sat', 'sun'], times: ['20:00', '21:00', '14:00'] },
  Youtube: { days: ['thu', 'fri', 'sat'], times: ['15:00', '17:00', '12:00'] },
  'Twitter/X': { days: ['tue', 'wed', 'thu'], times: ['09:00', '12:00', '10:00'] },
  Threads: { days: ['tue', 'wed', 'thu'], times: ['09:00', '12:00', '10:00'] },
  Bluesky: { days: ['tue', 'wed', 'thu'], times: ['09:00', '12:00', '10:00'] },
  GBP: { days: ['mon', 'wed', 'fri'], times: ['10:00', '11:00', '09:00'] },
};
// Days added in this order when posts_per_week is larger than the network's best days.
const EXTRA_DAYS = ['mon', 'fri', 'wed', 'thu', 'tue', 'sat', 'sun'];
// cadence.posts_per_week (1-7, default 3) spread over the week's best days for the network; at most one post of the brand
// a day (dates already used by its scheduled posts are skipped), never a date+time already used in the queue.
export function autoPicker(network, postsPerWeek, tz, taken, { allowToday, now }) {
  const table = AUTO_TIMES[network] || AUTO_TIMES.Facebook;
  const n = Math.min(7, Math.max(1, Number.isInteger(postsPerWeek) ? postsPerWeek : 3));
  const days = [...new Set([...table.days, ...EXTRA_DAYS])].slice(0, n);
  const usedDates = new Set([...taken].map((k) => k.slice(0, 10)));
  const cur = nowIn(tz, now);
  return () => {
    for (let d = allowToday ? 0 : 1; d < 366; d++) {
      const date = addDays(cur.date, d);
      if (!days.includes(weekday(date)) || usedDates.has(date)) continue;
      const time = table.times.map((t) => `${t}:00`).find((t) => !(d === 0 && t <= cur.time) && !taken.has(`${date} ${t}`));
      if (!time) continue;
      taken.add(`${date} ${time}`); usedDates.add(date);
      return { date, time };
    }
    return null;
  };
}

// ----- shared planning (CSV export and Metricool MCP payload) -----
const list = (v) => (v === undefined || v === null || v === '' ? [] : [].concat(v)).map((x) => String(x).trim()).filter(Boolean);

function captionText(brand, post, langs, mode, separator) {
  const texts = [];
  for (const lang of langs) {
    const fileName = post.captions?.[lang];
    if (!fileName) throw new Error(`${post.id}: catalog không có caption "${lang}".`);
    const st = post.caption_status?.[lang];
    if (st && st !== 'approved') throw new Error(`${post.id}: caption "${lang}" chưa "approved" (caption_status ${st}).`);
    const file = path.join(brand.dir, post.folder || '', fileName);
    if (!fs.existsSync(file)) throw new Error(`${post.id}: không có file ${file}.`);
    texts.push(cleanText(fs.readFileSync(file, 'utf8')).text);
  }
  return mode === 'one-post-bilingual' ? texts.join(separator) : texts[0];
}

// Networks of a post already scheduled on Metricool through MCP (catalog metricool.<network>.id, written by
// metricool-mcp.mjs record). A legacy Metricool draft (draft: true) does not count: it is sent again as a scheduled post.
export function sentNetworks(post) {
  const mc = post?.metricool;
  if (!mc || typeof mc !== 'object' || Array.isArray(mc)) return [];
  return Object.entries(mc).filter(([, r]) => r && typeof r === 'object' && r.id !== undefined && r.id !== null && String(r.id) !== '' && r.draft !== true).map(([n]) => n);
}

// Wall-clock date_time ("YYYY-MM-DDTHH:MM[:SS]", optional Z/offset) read in tz -> { date, time } in toTz.
export function wallIn(dateTime, tz, toTz) {
  const s = String(dateTime || '').trim();
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (!m || !validDate(m[1])) return null;
  if (m[3]) { const d = new Date(s.replace(' ', 'T')); return Number.isNaN(d.getTime()) ? null : nowIn(toTz, d); }
  return tz && validTz(tz) ? convertZoned(m[1], m[2], tz, toTz) : { date: m[1], time: normTime(m[2]) };
}
// A post's own posting time in the audience timezone: legacy flat schedule { date, time } (audience time), or the
// standard's schedule.<network> { date_time, timezone } of the first enabled network that has one.
export function catalogSchedule(post, networkKeys, audienceTz) {
  const s = post?.schedule;
  if (!s || typeof s !== 'object') return null;
  if (s.date) return { date: String(s.date), time: normTime(s.time) };
  for (const n of networkKeys) {
    const r = s[n];
    if (r && typeof r === 'object' && r.date_time) { const w = wallIn(r.date_time, r.timezone || audienceTz, audienceTz); if (w) return w; }
  }
  return null;
}
// Time already taken by a post sent to Metricool (its publication in the record's timezone), in the audience timezone.
function sentTime(post, audienceTz) {
  for (const n of sentNetworks(post)) {
    const r = post.metricool[n];
    if (r.publication) { const w = wallIn(r.publication, r.timezone || audienceTz, audienceTz); if (w) return w; }
  }
  return null;
}

// Plans the approved posts of a brand: networks and posted languages from enabled channels (never review_langs), caption
// text, media, alt text and a posting time in the audience timezone (catalog schedule, --date/--time, cadence.slots or the
// automatic table). Posts already sent through MCP (metricool.<network>.id) are skipped and keep their time taken.
// Shared by metricool-csv.mjs export and metricool-mcp.mjs payload; nothing is written.
// Ngắt kết nối (Tổng quan): the Metricool brand with this blogId no longer points to this skill -> nothing is sent.
export function assertLinked(brand) {
  let list = [];
  try { list = metricoolBrands().brands || []; } catch {}
  const byBlog = brand.blog_id && list.find((b) => String(b.blog_id) === String(brand.blog_id));
  if (byBlog && (byBlog.skill_id !== brand.id || path.resolve(linkedDir(byBlog)).toLowerCase() !== path.resolve(brand.dir).toLowerCase())) throw new Error(`Brand Metricool "${byBlog.name}" không nối với bộ skill ${brand.id} (Tổng quan: Chọn skill / Ngắt kết nối): không gửi gì lên Metricool.`);
}
export function planPosts(args, { now = new Date(), root = settings().skillsRoot, brand = null } = {}) {
  brand = brand || findBrand(need(args, 'brand'), root);
  assertLinked(brand);
  const social = brand.social;
  const warnings = [], skipped = [];
  if (!brand.audience_timezone || !validTz(brand.audience_timezone)) throw new Error(`cadence.timezone "${brand.cadence_timezone}" không hợp lệ.`);

  // Networks and languages from enabled channels.
  const channels = (social.channels || []).filter((c) => c.enabled);
  const unknown = channels.filter((c) => !NETWORKS[String(c.network).toLowerCase()]).map((c) => c.network);
  if (unknown.length) throw new Error(`Mạng không có cột trong template Metricool: ${unknown.join(', ')}.`);
  const networkKeys = [...new Set(channels.map((c) => String(c.network).toLowerCase()))];
  const networks = [...new Set(networkKeys.map((k) => NETWORKS[k]))];
  if (!networks.length) throw new Error(`${brand.id}: social.json không có kênh nào enabled.`);
  // Reviewer-only languages (language_policy.review_langs) are never posted: they are for the approver to read.
  const reviewOnly = reviewLanguages(social);
  const chanLangs = [...new Set(channels.flatMap((c) => [].concat(c.lang || [])))].filter((l) => !reviewOnly.includes(l));
  let mode = social.language_policy?.mode || 'single';
  let langs = chanLangs;
  if (args.lang && args.lang !== true) {
    langs = String(args.lang).split(',').map((s) => s.trim()).filter(Boolean); mode = langs.length > 1 ? 'one-post-bilingual' : 'single';
    const bad = langs.filter((l) => reviewOnly.includes(l));
    if (bad.length) throw new Error(`--lang ${bad.join(',')}: ngôn ngữ chỉ để đọc (language_policy.review_langs), không đăng.`);
  }
  if (!langs.length) throw new Error(`${brand.id}: kênh không khai báo lang.`);
  if (mode === 'single') langs = langs.slice(0, 1);
  const separator = typeof social.metricool?.bilingual_separator === 'string' ? social.metricool.bilingual_separator : '\n\n';

  // Posts.
  const catalog = readJson(path.join(brand.dir, 'workspace', 'catalog.json'));
  const all = catalog.posts || [];
  const isSent = (p) => networkKeys.some((n) => sentNetworks(p).includes(n));
  const sentReason = (p) => `đã gửi lên Metricool (metricool.${sentNetworks(p).join('/')}.id)`;
  const wanted = args.posts && args.posts !== true ? String(args.posts).split(',').map((s) => s.trim()).filter(Boolean) : null;
  const problems = [];
  let posts;
  if (wanted) {
    posts = [];
    for (const id of wanted) {
      const p = all.find((x) => x.id === id);
      if (!p) problems.push(`${id}: không có trong catalog.`);
      else if (isSent(p)) skipped.push({ post: id, reason: sentReason(p) });
      else if (p.status !== 'approved') problems.push(`${id}: trạng thái "${p.status}", chỉ xuất bài approved.`);
      else if (!list(p.media_url).length && !list(p.video_url).length) problems.push(`${id}: chưa có media_url/video_url (chạy host-image.mjs publish).`);
      else posts.push(p);
    }
  } else {
    posts = all.filter((p) => p.status === 'approved');
    for (const p of posts.filter(isSent)) skipped.push({ post: p.id, reason: sentReason(p) });
    posts = posts.filter((p) => !isSent(p));
    for (const p of posts.filter((x) => !list(x.media_url).length && !list(x.video_url).length)) warnings.push(`${p.id}: bỏ qua, chưa có media_url/video_url.`);
    posts = posts.filter((p) => list(p.media_url).length || list(p.video_url).length);
  }
  for (const s of skipped) warnings.push(`${s.post}: bỏ qua, ${s.reason}.`);
  if (problems.length) throw Object.assign(new Error(`Không xuất được: ${problems.join(' ')}`), { problems });

  // Times: catalog schedule, --date/--time, else next cadence slot. Times of other posts (scheduled or sent) stay taken.
  const taken = new Set();
  for (const p of all) {
    const t = catalogSchedule(p, networkKeys, brand.audience_timezone) || sentTime(p, brand.audience_timezone);
    if (t && validDate(t.date) && validTime(t.time)) taken.add(`${t.date} ${t.time}`);
  }
  // cadence.slots (when the brand lists any) override the automatic times.
  const hasSlots = Array.isArray(social.cadence?.slots) && social.cadence.slots.length > 0;
  const nextSlot = hasSlots
    ? slotPicker(social.cadence.slots, brand.audience_timezone, taken, { allowToday: !!args['allow-today'], now })
    : autoPicker(networks[0], social.cadence?.posts_per_week, brand.audience_timezone, taken, { allowToday: !!args['allow-today'], now });
  const slotSource = hasSlots ? 'cadence.slots' : `tự động (${networks[0]}, ${brand.audience_timezone})`;
  const override = args.date && args.date !== true ? { date: String(args.date), time: normTime(args.time === true ? '' : args.time || '') } : null;

  const items = [];
  for (const p of posts) {
    const own = catalogSchedule(p, networkKeys, brand.audience_timezone);
    let when = own ? { ...own, source: 'catalog schedule' } : null;
    if (!when && override) when = { ...override, source: '--date/--time' };
    if (!when) { const s = nextSlot(); if (s) when = { ...s, source: slotSource }; }
    if (!when) { problems.push(`${p.id}: không tìm được giờ đăng (catalog schedule, ${slotSource}, --date/--time).`); continue; }
    const planned = { date: when.date, time: when.time, timezone: brand.audience_timezone };
    const images = list(p.media_url), video = list(p.video_url);
    if (images.length && video.length) { problems.push(`${p.id}: có cả media_url và video_url; Metricool không trộn ảnh với video.`); continue; }
    const media = video.length ? video : images;
    if (media.length > MAX_MEDIA) { problems.push(`${p.id}: ${media.length} ảnh, Metricool nhận tối đa ${MAX_MEDIA}.`); continue; }
    const alt = list(p.media_alt ?? p.image_alt);
    if (!alt.length) warnings.push(`${p.id}: chưa có alt text (catalog media_alt).`);
    const texts = mode === 'separate-posts' ? langs.map((l) => ({ lang: l, text: captionText(brand, p, [l], 'single', separator) })) : [{ lang: langs.join('+'), text: captionText(brand, p, langs, mode, separator) }];
    items.push({ post: p, when, planned, media, video: video.length > 0, alt, texts, facebook_post_type: p.facebook_post_type || (video.length ? 'REEL' : 'POST') });
  }
  if (problems.length) throw Object.assign(new Error(`Không xuất được: ${problems.join(' ')}`), { problems });
  return { brand, social, channels, networkKeys, networks, langs, mode, items, warnings, skipped };
}

export function buildExport(args, { now = new Date(), root = settings().skillsRoot } = {}) {
  if (args.draft) throw new Error('--draft was removed: the tool always schedules real posts.');
  const brand = findBrand(need(args, 'brand'), root);
  assertLinked(brand);
  const header = templateHeader();
  const warnings = [];
  if (!brand.enabled) warnings.push(`social.json enabled: false (${brand.id}). Chỉ xuất file, không gửi gì.`);
  if (!brand.brand_name) throw new Error(`Không có tên brand Metricool: thêm social.json metricool.brand_name cho ${brand.id}.`);
  if (!brand.brand_name_configured) warnings.push(`Brand name "${brand.brand_name}" lấy từ project.md; nhãn trong Metricool có thể khác (vd "Dreamy Vows"). Thêm social.json metricool.brand_name.`);
  if (!brand.timezone || !validTz(brand.timezone)) throw new Error(`Timezone "${brand.timezone}" không hợp lệ (${brand.timezone_source}).`);
  if (!brand.audience_timezone || !validTz(brand.audience_timezone)) throw new Error(`cadence.timezone "${brand.cadence_timezone}" không hợp lệ.`);
  if (!brand.timezone_configured) warnings.push(`Không biết múi giờ brand trong Metricool (thêm social.json metricool.timezone hoặc brand trong config/metricool-brands.json): tạm coi là ${brand.timezone} (cadence.timezone), KHÔNG quy đổi giờ. Metricool đọc Date/Time theo múi giờ của brand trong Metricool.`);
  if (brand.config_timezone && brand.timezone_source === 'social.json metricool.timezone' && brand.config_timezone !== brand.timezone) warnings.push(`social.json metricool.timezone (${brand.timezone}) khác múi giờ brand "${brand.config_brand}" trong config/metricool-brands.json (${brand.config_timezone}); dùng metricool.timezone. Kiểm lại múi giờ thật của brand trong Metricool.`);
  const notes = [];
  if (brand.audience_timezone !== brand.timezone) notes.push(`Giờ đăng được quy đổi tự động sang múi giờ Metricool: lên lịch theo ${brand.audience_timezone} (cadence.timezone, khách xem), ghi Date/Time theo ${brand.timezone} (${brand.timezone_source}). Gọn hơn (không bắt buộc): đặt múi giờ brand trong Metricool = ${brand.audience_timezone}.`);

  const plan = planPosts(args, { now, root, brand });
  warnings.push(...plan.warnings);
  if (!plan.items.length) throw new Error(`${brand.id}: không có bài approved nào có media_url${plan.skipped.length ? ' chưa gửi lên Metricool' : ''}.`);
  const { networks } = plan;
  const rows = [], map = [];
  for (const it of plan.items) {
    const { when, planned, media, alt } = it;
    // when is planned in the audience timezone; Metricool reads Date/Time in the brand's Metricool timezone.
    const mcWhen = { ...(validDate(when.date) && validTime(when.time) ? convertZoned(when.date, when.time, brand.audience_timezone, brand.timezone) : { date: when.date, time: when.time }), timezone: brand.timezone };
    for (const t of it.texts) {
      const r = Object.fromEntries(header.map((h) => [h, '']));
      r.Text = t.text; r.Date = mcWhen.date; r.Time = mcWhen.time; r.Draft = 'false';
      for (const col of networks) r[col] = 'true';
      for (const col of AI_LABEL_COLUMNS) r[col] = 'false';
      media.forEach((m, k) => { r[pics(k + 1)] = m; if (alt[k]) r[alts(k + 1)] = alt[k]; });
      if (it.video && it.post.video_thumbnail_url) r['Video Thumbnail Url'] = String(it.post.video_thumbnail_url);
      if (networks.includes('Facebook')) r['Facebook Post Type'] = it.facebook_post_type;
      if (networks.includes('Instagram')) r['Instagram Post Type'] = it.video ? 'REEL' : 'POST';
      r['Brand name'] = brand.brand_name;
      rows.push(r);
      map.push({ post: it.post.id, lang: t.lang, date: mcWhen.date, time: mcWhen.time, time_source: when.source, planned, metricool: mcWhen, time_note: describeTimes(planned, mcWhen), media: media.length });
    }
  }
  warnings.push('Đường CSV: Metricool KHÔNG chép ảnh ngoài về máy chủ của nó (saveExternalMediaFiles false): file ảnh trên repo ảnh phải còn nguyên đến khi bài đã đăng. Không gỡ file (host-image.mjs remove) trước giờ đăng.');
  return { brand, header, rows, map, networks, langs: plan.langs, mode: plan.mode, warnings, notes };
}

// ----- export -----
async function runExport(args) {
  const outFile = path.resolve(need(args, 'out'));
  const root = settings().skillsRoot;
  if (outFile === path.resolve(root) || inside(root, outFile)) throw new Error(`--out không được nằm trong thư mục thương hiệu (${root}).`);
  const now = new Date();
  const x = buildExport(args, { now, root });
  const v = validateRows(x.rows, { brands: allBrands(root), brand: x.brand, allowToday: !!args['allow-today'], now });
  const checks = args['check-urls'] ? await checkMedia(x.rows, v.errors) : undefined;
  const warnings = [...x.warnings, ...v.warnings];
  if (v.errors.length) return fail(`File không hợp lệ, KHÔNG ghi ${outFile}: ${v.errors.length} lỗi.`, { errors: v.errors, posts: x.map, warnings, url_checks: checks });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, toMetricoolCsv(x.header, x.rows), 'utf8');
  out({
    file: outFile, brand: x.brand.id, brand_name: x.brand.brand_name, brand_name_source: x.brand.brand_name_source,
    timezone: x.brand.timezone, timezone_source: x.brand.timezone_source, audience_timezone: x.brand.audience_timezone, notes: x.notes, draft: false, networks: x.networks,
    languages: x.langs, language_mode: x.mode, rows: x.rows.length, posts: x.map, columns: x.header.length,
    url_checks: checks, warnings,
    next: 'Kiểm tra bằng: node scripts/metricool-csv.mjs validate <file> --check-urls. Tool không import; người dùng tự import trong Metricool (Calendar > ⋮ > Import CSV) và KHÔNG bấm Import nếu preview còn dòng lỗi.',
  });
}

export async function validateFile(file, { brandId = '', allowToday = false, checkUrls = false, now = new Date(), root = settings().skillsRoot } = {}) {
  if (!fs.existsSync(file)) throw new Error(`Không có file ${file}`);
  const raw = fs.readFileSync(file, 'utf8');
  const warnings = [], errors = [];
  if (raw.charCodeAt(0) === 0xfeff) warnings.push('File có BOM; template của Metricool không có BOM.');
  if (raw.includes('�')) errors.push({ row: 0, field: 'file', error: 'có ký tự U+FFFD: file không phải UTF-8 chuẩn' });
  const records = parseCsv(raw);
  const header = templateHeader();
  const got = records[0] || [];
  if (got.length !== header.length || got.some((h, i) => h !== header[i])) {
    const i = header.findIndex((h, k) => got[k] !== h);
    errors.push({ row: 1, field: 'header', error: `Header khác template (${got.length}/${header.length} cột); khác đầu tiên ở cột ${i + 1}: "${got[i] ?? ''}" thay vì "${header[i] ?? ''}"` });
    return { file, rows: Math.max(0, records.length - 1), errors, warnings };
  }
  const rows = [];
  records.slice(1).forEach((rec, i) => {
    if (rec.length !== header.length) errors.push({ row: i + 2, field: 'row', error: `${rec.length} cột, cần ${header.length}` });
    rows.push(Object.fromEntries(header.map((h, k) => [h, rec[k] ?? ''])));
  });
  if (!rows.length) errors.push({ row: 0, field: 'file', error: 'không có dòng bài nào' });
  const brands = allBrands(root);
  const brand = brandId ? findBrand(brandId, root) : null;
  const v = validateRows(rows, { brands, brand, allowToday, now });
  errors.push(...v.errors); warnings.push(...v.warnings);
  const checks = checkUrls ? await checkMedia(rows, errors) : undefined;
  errors.sort((a, b) => a.row - b.row);
  return { file, rows: rows.length, brands: [...new Set(rows.map((r) => r['Brand name']))], times: v.times, errors, warnings, url_checks: checks };
}

async function runValidate(args) {
  const file = args._[1] || (args.file !== true && args.file);
  if (!file) throw new Error('Thiếu đường dẫn file: validate <file.csv>');
  const r = await validateFile(path.resolve(String(file)), { brandId: args.brand && args.brand !== true ? String(args.brand) : '', allowToday: !!args['allow-today'], checkUrls: !!args['check-urls'] });
  if (r.errors.length) return fail(`${r.errors.length} lỗi trong ${r.file}. Metricool sẽ nhập TẤT CẢ các dòng thành nháp và ngày sai thành "hôm nay giờ hiện tại": sửa hết rồi mới import.`, r);
  out({ ...r, valid: true });
}

if (isMain(import.meta.url)) main(async () => {
  const args = parseArgs();
  const cmd = args._[0];
  if (cmd === 'export') {
    try { await runExport(args); } catch (e) { fail(e.message, e.problems ? { problems: e.problems } : {}); }
  } else if (cmd === 'validate') await runValidate(args);
  else fail('Lệnh: export --brand <id> [--posts POST-01,POST-02] [--lang en] [--date YYYY-MM-DD --time HH:MM] --out <file> | validate <file> [--brand <id>] [--allow-today] [--check-urls]');
});
