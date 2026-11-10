// Metricool MCP route (Starter plan has no REST API): this script never talks to Metricool. It prepares the exact
// arguments the AGENT passes to its Metricool MCP tool createScheduledPost (any agent: Claude, ChatGPT, Codex), records what Metricool
// answered into the tool's post register (workspace/posts/<brand>/catalog.json, scripts/posts.mjs), and lists sent posts so the agent can reconcile them with getScheduledPosts.
//   node scripts/metricool-mcp.mjs payload --brand <id> [--posts POST-01,POST-02] [--lang en]
//          [--date YYYY-MM-DD --time HH:MM] [--allow-today] [--limit N] [--window morning|midday|afternoon|evening] [--start today|tomorrow]
//        --limit N: at most N approved posts of the brand (oldest approved first); --window: only times in that window of
//        the day (best first; no data = its midpoint hour); --start today: today too, at least 1 hour ahead.
//   node scripts/metricool-mcp.mjs record --brand <id> --post POST-xx --id <id> --uuid <uuid> --planner-url <url>
//          --publication <YYYY-MM-DDTHH:MM[:SS]> --tz <timezone> [--networks facebook] [--force]
//   node scripts/metricool-mcp.mjs status --brand <id>
// payload: one item per approved post with media_url/video_url and no metricool.<network>.id yet. Posting times come from
// the shared planner of metricool-csv.mjs (catalog schedule, --date/--time, cadence.slots or automatic times), planned in
// the audience timezone (cadence.timezone). publicationDate carries that timezone, so Metricool converts it itself (no
// manual conversion as in the CSV route). Always a REAL scheduled post (draft:false, autoPublish at the brand's slot time;
// user, 09/11/2026: the tool never makes Metricool drafts). A post recorded earlier as a Metricool draft (legacy) is
// sent again as a scheduled post. A post whose delivery check (posts.mjs checkPost) fails is blocked, the others go.
// The output is plain JSON for any agent's Metricool tool (Claude connector, ChatGPT connector, Codex MCP server).
// Text = posted languages only (never language_policy.review_langs), never any AI label. Media must be public https links
// (MCP copies them to static.metricool.com). A brand gets posts only when it is linked to a usable skill; a brand gone from
// the account (removed in workspace/metricool-brands.json) is never a target.
//   node scripts/metricool-mcp.mjs sync-brands --from <file with the getBrandSettings JSON>   (first step of every run)
//   node scripts/metricool-mcp.mjs sync-times  --brand <id> --from <file with the getBestTimeToPostByNetwork JSON> [--network facebook]
//        (before scheduling: the posting times come from Metricool's best times; no hand-set times)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main, out, fail, isMain, parseArgs, need, settings, readJson, writeJson, withLock, today, stamp, aiLabelHits, hasHidden, metricoolBrands, removedBlog, syncMetricoolBrands, listDrafts } from './lib.mjs';
import { postsCatalogFile, readPosts, checkPost as checkRegisterPost } from './posts.mjs';
import { timesFile, planPosts, findBrand, sentNetworks, toolMade, wallIn, zonedToInstant, nowIn, validDate, validTime, TEXT_LIMITS, NETWORKS, WEBP_URL } from './metricool-csv.mjs';

// Networks whose createScheduledPost shape is known (facebookData / instagramData). Others: use the CSV route.
export const MCP_NETWORKS = ['facebook', 'instagram'];
const normTime = (t) => (/^\d{2}:\d{2}$/.test(t) ? `${t}:00` : t);

// "+07:00" style offset of tz at wall clock date + time.
export function offsetOf(date, time, tz) {
  const [y, mo, d] = date.split('-').map(Number), [h, mi, se] = normTime(time).split(':').map(Number);
  const min = Math.round((Date.UTC(y, mo - 1, d, h, mi, se) - zonedToInstant(date, normTime(time), tz).getTime()) / 60000);
  const a = Math.abs(min);
  return `${min < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}
export const isoWithOffset = (date, time, tz) => `${date}T${normTime(time)}${offsetOf(date, time, tz)}`;

// The brand's Metricool blogId, refusing a blog gone from the account and any blog that belongs to another brand.
export function targetBlog(brand) {
  const blog = brand.blog_id;
  if (!blog) throw new Error(`${brand.id}: chưa có Metricool blogId (social.json metricool.blog_id hoặc config/metricool-brands.json).`);
  const gone = removedBlog(blog);
  if (gone) throw new Error(`blogId ${blog} ("${gone.name}") is no longer in the Metricool account: nothing is sent to it.`);
  let owners = [];
  try { owners = (metricoolBrands().brands || []).filter((b) => String(b.blog_id) === blog); } catch {}
  const other = owners.find((b) => b.skill_id !== brand.id);
  if (other) throw new Error(`blogId ${blog} thuộc brand Metricool "${other.name}" (skill_id ${other.skill_id ?? 'null'}), không phải ${brand.id}.`);
  return blog;
}

function payloadItems(args, { now = new Date(), root = settings().skillsRoot } = {}) {
  const brand = findBrand(need(args, 'brand'), root);
  if (!brand.enabled) throw new Error(`social.json enabled: false (${brand.id}): không gửi gì lên Metricool.`);
  if (args.draft || args.schedule) throw new Error('--draft/--schedule were removed: the tool always schedules real posts at the brand\'s slot time.');
  const blogId = targetBlog(brand);
  const draft = false;
  const plan = planPosts(args, { now, root, brand });
  const tz = brand.audience_timezone;
  const unsupported = plan.networkKeys.filter((n) => !MCP_NETWORKS.includes(n));
  if (unsupported.length) throw new Error(`Đường MCP chưa hỗ trợ mạng ${unsupported.join(', ')} (chỉ ${MCP_NETWORKS.join(', ')}); dùng metricool-csv.mjs.`);
  if (plan.mode === 'separate-posts') throw new Error('language_policy.mode separate-posts chưa hỗ trợ qua MCP (mỗi bài một id); dùng metricool-csv.mjs.');
  const problems = [], items = [];
  const cur = nowIn(tz, now);
  for (const it of plan.items) {
    const p = it.post, { date, time } = it.when;
    if (!validDate(date) || !validTime(time)) { problems.push(`${p.id}: giờ "${date} ${time}" không hợp lệ.`); continue; }
    if (date < cur.date || (date === cur.date && (!(args['allow-today'] || args.start === 'today') || time <= cur.time))) { problems.push(`${p.id}: ${date} ${time} ${tz} đã qua hoặc là hôm nay (hôm nay ${cur.date} ${cur.time}); chỉ ngày mai trở đi (--allow-today cho giờ sau bây giờ).`); continue; }
    // The register's delivery check must pass (posts.mjs checkPost).
    const cp = checkPost(brand, p.id);
    if (cp?.errors) { problems.push(`${p.id}: kiểm bài báo ${cp.errors} lỗi (${cp.results[0].errors.join('; ')}).`); continue; }
    const text = it.texts[0].text;
    if (!text.trim()) { problems.push(`${p.id}: caption trống.`); continue; }
    const ai = aiLabelHits(text);
    if (ai.length) { problems.push(`${p.id}: caption có nhãn AI (${ai.join(', ')}); không gắn nhãn AI khi đăng.`); continue; }
    if (hasHidden(text)) { problems.push(`${p.id}: caption có ký tự ẩn.`); continue; }
    const len = Array.from(text).length;
    const over = plan.networkKeys.filter((n) => len > TEXT_LIMITS[NETWORKS[n]]);
    if (over.length) { problems.push(`${p.id}: caption ${len} ký tự, quá giới hạn ${over.join(', ')}.`); continue; }
    const badMedia = it.media.filter((m) => { try { return new URL(m).protocol !== 'https:' || WEBP_URL.test(m); } catch { return true; } });
    if (badMedia.length) { problems.push(`${p.id}: media phải là link https không phải WebP: ${badMedia.join(', ')}.`); continue; }
    const info = {
      autoPublish: true,
      descendants: [],
      draft,
      firstCommentText: '',
      hasNotReadNotes: false,
      media: it.media,
      mediaAltText: it.media.map((_, k) => it.alt[k] || ''),
      providers: plan.networkKeys.map((network) => ({ network })),
      publicationDate: { dateTime: `${date}T${time}`, timezone: tz },
      shortener: false,
      smartLinkData: { ids: [] },
      text,
    };
    if (plan.networkKeys.includes('facebook')) info.facebookData = { type: it.facebook_post_type };
    if (plan.networkKeys.includes('instagram')) info.instagramData = { type: it.video ? 'REEL' : 'POST', isAiGenerated: false };
    const rec = ['node scripts/metricool-mcp.mjs record', `--brand ${brand.id}`, `--post ${p.id}`, '--id <id>', '--uuid <uuid>', '--planner-url <plannerUrl>', '--publication <publicationDate.dateTime>', '--tz <publicationDate.timezone>', `--time-source "${it.when.source || ''}"`].join(' ');
    items.push({
      post: p.id, lang: it.texts[0].lang, networks: plan.networkKeys, draft, time_source: it.when.source, planned: it.planned,
      tool: 'createScheduledPost',
      args: { blogId, date: isoWithOffset(date, time, tz), info: JSON.stringify(info) },
      record: rec,
    });
  }
  // A post that fails a check is blocked (listed with the reason); the others still go. Only when nothing is left is it an error.
  if (problems.length && !items.length) throw Object.assign(new Error(`Không tạo được payload: ${problems.join(' ')}`), { problems });
  return { brand, blogId, draft, plan, items, blocked: problems };
}

function runPayload(args) {
  const x = payloadItems(args);
  out({
    brand: x.brand.id, blog_id: x.blogId, metricool_brand: x.brand.brand_name, audience_timezone: x.brand.audience_timezone, draft: x.draft,
    languages: x.plan.langs, networks: x.plan.networkKeys, items: x.items, blocked: x.blocked, skipped: x.plan.skipped, warnings: x.plan.warnings,
    next: x.items.length
      ? 'Với từng item: gọi tool MCP Metricool createScheduledPost với đúng args (blogId, date, info; không sửa info), rồi chạy lệnh record với id, uuid, plannerUrl, publicationDate.dateTime, publicationDate.timezone Metricool trả về. Không bao giờ dùng blogId khác args.blogId.'
      : 'Không có bài nào cần gửi.',
  });
}


// ----- record -----
const isUrl = (v) => { try { return new URL(v).protocol === 'https:'; } catch { return false; } };
// Delivery check of a register post (posts.mjs checkPost; the skill is never run on the tool's posts).
const checkPost = (brand, postId) => checkRegisterPost(brand, postId);

export function record(args, { root = settings().skillsRoot, now = new Date() } = {}) {
  const brand = findBrand(need(args, 'brand'), root);
  const blogId = targetBlog(brand);
  const postId = need(args, 'post');
  const id = need(args, 'id').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`--id "${id}" không hợp lệ (id Metricool trả về, vd 421362711).`);
  const uuid = args.uuid && args.uuid !== true ? String(args.uuid).trim() : '';
  const planner = args['planner-url'] && args['planner-url'] !== true ? String(args['planner-url']).trim() : '';
  if (planner && !isUrl(planner)) throw new Error(`--planner-url "${planner}" phải là link https.`);
  const tz = need(args, 'tz').trim();
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { throw new Error(`--tz "${tz}" không phải timezone hợp lệ.`); }
  const pub = need(args, 'publication').trim();
  const w = wallIn(pub, tz, tz);
  if (!w) throw new Error(`--publication "${pub}" phải là YYYY-MM-DDTHH:MM[:SS].`);
  const publication = `${w.date}T${w.time}`;
  if (args.draft) throw new Error('--draft was removed: the tool always records real scheduled posts.');
  const draft = false;
  // Which source chose the time ("Metricool best time" / "research default" / "catalog schedule"), shown in the app and the log.
  const timeSource = args['time-source'] && args['time-source'] !== true ? String(args['time-source']).trim().slice(0, 60) : '';
  const channels = (brand.social.channels || []).filter((c) => c.enabled).map((c) => String(c.network).toLowerCase());
  const networks = args.networks && args.networks !== true ? String(args.networks).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : [...new Set(channels)];
  const bad = networks.filter((n) => !MCP_NETWORKS.includes(n));
  if (!networks.length || bad.length) throw new Error(`--networks: chỉ ${MCP_NETWORKS.join(', ')} (${bad.join(', ') || 'trống'}).`);
  const catalogFile = postsCatalogFile(brand.id);
  const result = withLock(catalogFile, () => {
    const catalog = readJson(catalogFile, { posts: [] });
    const entry = (catalog.posts || []).find((p) => p.id === postId);
    if (!entry) throw new Error(`Sổ bài của ${brand.id} (workspace/posts/${brand.id}/catalog.json) không có ${postId}.`);
    if (!toolMade(entry)) throw new Error(`${postId} là bài riêng của skill (không do tool tạo): tool không ghi gì cho bài này.`);
    if (!['approved', 'scheduled'].includes(entry.status)) throw new Error(`${postId}: trạng thái "${entry.status}", chỉ ghi cho bài approved/scheduled.`);
    const mc = entry.metricool && typeof entry.metricool === 'object' && !Array.isArray(entry.metricool) ? entry.metricool : {};
    for (const n of networks) {
      const old = mc[n];
      // A legacy Metricool draft of this post is replaced by the scheduled post (the draft stays in Metricool; delete it there).
      if (old?.id && String(old.id) !== id && old.draft !== true && !args.force) throw new Error(`${postId}: metricool.${n}.id đã là ${old.id} (khác ${id}). Kiểm trong Metricool; ghi đè bằng --force.`);
    }
    const sentAt = stamp();
    for (const n of networks) {
      const old = mc[n] || {};
      const same = old.id && String(old.id) === id;
      mc[n] = { blog_id: blogId, id, uuid: (same && old.uuid) || uuid || '', planner_url: planner || (same ? old.planner_url : '') || '', publication, timezone: tz, draft, ...(timeSource ? { time_source: timeSource } : {}), ...(old.draft === true && !same ? { replaced_draft: String(old.id) } : {}), sent_at: old.id && String(old.id) === id && old.sent_at ? old.sent_at : sentAt, ...(old.id && String(old.id) === id ? { updated_at: sentAt } : {}) };
    }
    entry.metricool = mc;
    if (!draft) {
      const sched = entry.schedule && typeof entry.schedule === 'object' && !entry.schedule.date ? entry.schedule : {};
      for (const n of networks) sched[n] = { date_time: publication, timezone: tz };
      entry.schedule = sched;
      entry.status = 'scheduled';
    }
    catalog.updated = today(brand.audience_timezone, now);
    writeJson(catalogFile, catalog);
    return { status: entry.status, metricool: entry.metricool, schedule: entry.schedule };
  });
  return { brand: brand.id, post: postId, ...result, check_post: checkPost(brand, postId) };
}

// ----- best times (getBestTimeToPostByNetwork) -----
// Any JSON shape Metricool returns: a list (or { data | items | bestTimes | result: [...] }) of entries with a day
// (0-6 Sunday first, 1-7 Monday first when 7 appears, or a name) and an hour (0-23, or "HH:MM"), and a score
// (value / score / engagement / count). A matrix { monday: { "9": 12, ... } } works too.
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const dayOf = (v, mondayFirst) => {
  if (typeof v === 'string' && !/^\d+$/.test(v)) { const k = v.trim().slice(0, 3).toLowerCase(); return DAY_NAMES.includes(k) ? k : ''; }
  const n = Number(v);
  if (!Number.isInteger(n)) return '';
  return mondayFirst ? DAY_NAMES[n % 7] : DAY_NAMES[n] || '';
};
const hourOf = (v) => { const m = String(v ?? '').match(/^(\d{1,2})(?::(\d{2}))?/); if (!m) return ''; const h = Number(m[1]); return h < 24 ? `${String(h).padStart(2, '0')}:${m[2] || '00'}` : ''; };
export function parseBestTimes(raw) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const list = Array.isArray(data) ? data : [data?.data, data?.items, data?.bestTimes, data?.result, data?.data?.items].find(Array.isArray);
  const slots = [];
  if (list) {
    const mondayFirst = list.some((e) => Number(e?.day ?? e?.dayOfWeek ?? e?.weekday) === 7);
    for (const e of list) {
      if (!e || typeof e !== 'object') continue;
      // Metricool's own shape: { dayOfWeek: 1 (Mon) .. 7 (Sun), bestTimesByHour: [{ hourOfDay, value }] }.
      if (Array.isArray(e.bestTimesByHour)) {
        const day = dayOf(e.dayOfWeek ?? e.day, true);
        for (const h of e.bestTimesByHour) { const time = hourOf(h?.hourOfDay ?? h?.hour); if (day && time) slots.push({ day, time, score: Number(h?.value ?? h?.score ?? 0) || 0 }); }
        continue;
      }
      const day = dayOf(e.day ?? e.dayOfWeek ?? e.weekday ?? e.dayName, mondayFirst), time = hourOf(e.hour ?? e.time ?? e.hourOfDay);
      const score = Number(e.value ?? e.score ?? e.engagement ?? e.count ?? e.interactions ?? 0) || 0;
      if (day && time) slots.push({ day, time, score });
    }
  } else if (data && typeof data === 'object') {
    for (const [d, hours] of Object.entries(data.data && typeof data.data === 'object' ? data.data : data)) {
      const day = dayOf(d, false);
      if (!day || !hours || typeof hours !== 'object') continue;
      for (const [h, v] of Object.entries(hours)) { const time = hourOf(h); if (time) slots.push({ day, time, score: Number(v) || 0 }); }
    }
  }
  return slots.sort((a, b) => b.score - a.score);
}
export function syncTimes(args) {
  const brand = findBrand(need(args, 'brand'));
  const slots = parseBestTimes(fs.readFileSync(need(args, 'from'), 'utf8'));
  if (!slots.length) throw new Error('No best times found in the getBestTimeToPostByNetwork answer.');
  let cfg = null;
  try { cfg = (metricoolBrands().brands || []).find((b) => b.skill_id === brand.id) || null; } catch {}
  const doc = { brand: brand.id, network: args.network && args.network !== true ? String(args.network) : 'facebook', timezone: cfg?.timezone || brand.timezone || '', updated_at: new Date().toISOString(), slots };
  writeJson(timesFile(brand.id), doc);
  return { brand: brand.id, file: timesFile(brand.id), timezone: doc.timezone, slots: slots.length, best: slots.slice(0, 5) };
}

// ----- status -----
const addDays = (date, n) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export function status(args, { root = settings().skillsRoot } = {}) {
  const brand = findBrand(need(args, 'brand'), root);
  const catalog = readPosts(brand.id);
  const posts = [];
  const dates = [];
  let tz = '';
  for (const p of (catalog.posts || []).filter(toolMade)) { // only the tool's posts
    const nets = sentNetworks(p);
    if (!nets.length) continue;
    const networks = Object.fromEntries(nets.map((n) => [n, p.metricool[n]]));
    for (const r of Object.values(networks)) { if (r.publication) dates.push(String(r.publication).slice(0, 10)); tz = tz || r.timezone || ''; }
    const first = networks[nets[0]];
    const local = first.publication ? wallIn(first.publication, first.timezone, brand.audience_timezone) : null;
    posts.push({ post: p.id, catalog_status: p.status, published: p.status === 'published', networks, audience_time: local ? { ...local, timezone: brand.audience_timezone } : null });
  }
  dates.sort();
  // Posts a person sent back to review (finalize.mjs unapprove): their old Metricool ids are history, never matched again.
  const ignore = []; try { for (const d of listDrafts(brand.id)) for (const h of d.status?.reverted || []) for (const v of Object.values(h.metricool || {})) if (v?.id) ignore.push(String(v.id)); } catch {}
  const open = posts.filter((p) => !p.published);
  const query = open.length ? { tool: 'getScheduledPosts', brandId: brand.blog_id, fromDate: `${addDays(dates[0], -1)}T00:00:00`, toDate: `${addDays(dates.at(-1), 1)}T23:59:59`, timezone: tz || brand.timezone } : null;
  return {
    brand: brand.id, blog_id: brand.blog_id, posts, query, ignore_ids: [...new Set(ignore)],
    next: open.length
      ? 'Gọi getScheduledPosts với query, khớp theo id. PENDING: không làm gì. Bài còn metricool.<network>.draft true (nháp cũ): payload sẽ gửi lại thành bài hẹn giờ thật. ERROR: báo lỗi cho người dùng (id, plannerUrl, lý do). PUBLISHED: chạy node scripts/posts.mjs mark-published --brand <id> --post <POST> --date <yyyy-mm-dd theo audience_time> [--url <link bài>] --lang <ngôn ngữ đăng> (sổ bài của tool; không bao giờ ghi vào skill). Nháp cũ đã được người hẹn giờ trong Metricool (draft false, có giờ): chạy record lại với cùng --id. Bài có id trong ignore_ids (đã đưa về To review): bỏ qua, không record/mark-published.'
      : 'Không có bài nào đang chờ trên Metricool.',
  };
}

if (isMain(import.meta.url)) main(async () => {
  const args = parseArgs();
  const cmd = args._[0];
  try {
    if (cmd === 'payload') runPayload(args);
    else if (cmd === 'record') out(record(args));
    else if (cmd === 'status') out(status(args));
    else if (cmd === 'sync-times') out(syncTimes(args));
    else if (cmd === 'sync-brands') {
      const file = need(args, 'from');
      const r = syncMetricoolBrands(fs.readFileSync(file, 'utf8'));
      out({ brands: r.brands.map(({ name, blog_id, skill_id, removed }) => ({ name, blog_id, skill_id, ...(removed ? { removed } : {}) })), added: r.added, removed: r.removed, updated_at: r.updated_at });
    }
    else fail('Lệnh: payload --brand <id> [--posts POST-01,...] | record --brand <id> --post POST-xx --id <id> --uuid <uuid> --planner-url <url> --publication <dateTime> --tz <tz> | status --brand <id> | sync-brands --from <file> | sync-times --brand <id> --from <file> [--network facebook]');
  } catch (e) { fail(e.message, e.problems ? { problems: e.problems } : {}); }
});
