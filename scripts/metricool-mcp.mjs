// Metricool MCP route (Starter plan has no REST API): this script never talks to Metricool. It prepares the exact
// arguments the AGENT passes to its Metricool MCP tool createScheduledPost (any agent: Claude, ChatGPT, Codex), records what Metricool
// answered into the brand catalog, and lists sent posts so the agent can reconcile them with getScheduledPosts.
//   node scripts/metricool-mcp.mjs payload --brand <id> [--posts POST-01,POST-02] [--lang en]
//          [--date YYYY-MM-DD --time HH:MM] [--allow-today]
//   node scripts/metricool-mcp.mjs record --brand <id> --post POST-xx --id <id> --uuid <uuid> --planner-url <url>
//          --publication <YYYY-MM-DDTHH:MM[:SS]> --tz <timezone> [--networks facebook] [--force]
//   node scripts/metricool-mcp.mjs status --brand <id>
// payload: one item per approved post with media_url/video_url and no metricool.<network>.id yet. Posting times come from
// the shared planner of metricool-csv.mjs (catalog schedule, --date/--time, cadence.slots or automatic times), planned in
// the audience timezone (cadence.timezone). publicationDate carries that timezone, so Metricool converts it itself (no
// manual conversion as in the CSV route). Always a REAL scheduled post (draft:false, autoPublish at the brand's slot time;
// user, 09/11/2026: the tool never makes Metricool drafts). A post recorded earlier as a Metricool draft (legacy) is
// sent again as a scheduled post. A post whose check-post.mjs fails is blocked, the others go.
// The output is plain JSON for any agent's Metricool tool (Claude connector, ChatGPT connector, Codex MCP server).
// Text = posted languages only (never language_policy.review_langs), never any AI label. Media must be public https links
// (MCP copies them to static.metricool.com). A Metricool brand marked excluded (or removed) in
// workspace/metricool-brands.json is never a target.
//   node scripts/metricool-mcp.mjs sync-brands --from <file with the getBrandSettings JSON>   (first step of every run)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { main, out, fail, isMain, parseArgs, need, settings, readJson, writeJson, withLock, today, stamp, aiLabelHits, hasHidden, metricoolBrands, excludedBlog, syncMetricoolBrands } from './lib.mjs';
import { planPosts, findBrand, sentNetworks, wallIn, zonedToInstant, nowIn, validDate, validTime, TEXT_LIMITS, NETWORKS, WEBP_URL } from './metricool-csv.mjs';

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

// The brand's Metricool blogId, refusing an excluded/removed blog and any blog that belongs to another brand.
export function targetBlog(brand) {
  const blog = brand.blog_id;
  if (!blog) throw new Error(`${brand.id}: chưa có Metricool blogId (social.json metricool.blog_id hoặc config/metricool-brands.json).`);
  const ex = excludedBlog(blog);
  if (ex) throw new Error(`blogId ${blog} ("${ex.name}") is ${ex.excluded ? 'excluded' : 'no longer in the Metricool account'}: never create or change posts for it.`);
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
    if (date < cur.date || (date === cur.date && (!args['allow-today'] || time <= cur.time))) { problems.push(`${p.id}: ${date} ${time} ${tz} đã qua hoặc là hôm nay (hôm nay ${cur.date} ${cur.time}); chỉ ngày mai trở đi (--allow-today cho giờ sau bây giờ).`); continue; }
    // The brand skill's check-post.mjs must pass (no human approval step: automatic checks are the gate).
    const cp = checkPost(brand, p.id);
    if (cp?.errors) { problems.push(`${p.id}: check-post.mjs của skill báo ${cp.errors} lỗi.`); continue; }
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
    const rec = ['node scripts/metricool-mcp.mjs record', `--brand ${brand.id}`, `--post ${p.id}`, '--id <id>', '--uuid <uuid>', '--planner-url <plannerUrl>', '--publication <publicationDate.dateTime>', '--tz <publicationDate.timezone>'].join(' ');
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
function checkPost(brand, postId) {
  const checker = path.join(brand.dir, 'scripts', 'check-post.mjs');
  if (!fs.existsSync(checker)) return null;
  const r = spawnSync(process.execPath, [checker, postId], { cwd: brand.dir, encoding: 'utf8', windowsHide: true });
  try { const j = JSON.parse(r.stdout); return { errors: j.errors, results: j.results.map(({ errors, warnings }) => ({ errors, warnings })) }; } catch { return { errors: 1, output: (r.stdout || r.stderr || '').slice(0, 2000) }; }
}

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
  const channels = (brand.social.channels || []).filter((c) => c.enabled).map((c) => String(c.network).toLowerCase());
  const networks = args.networks && args.networks !== true ? String(args.networks).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : [...new Set(channels)];
  const bad = networks.filter((n) => !MCP_NETWORKS.includes(n));
  if (!networks.length || bad.length) throw new Error(`--networks: chỉ ${MCP_NETWORKS.join(', ')} (${bad.join(', ') || 'trống'}).`);
  const catalogFile = path.join(brand.dir, 'workspace', 'catalog.json');
  const result = withLock(catalogFile, () => {
    const catalog = readJson(catalogFile);
    const entry = (catalog.posts || []).find((p) => p.id === postId);
    if (!entry) throw new Error(`Catalog của ${brand.id} không có ${postId}.`);
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
      mc[n] = { blog_id: blogId, id, uuid: (same && old.uuid) || uuid || '', planner_url: planner || (same ? old.planner_url : '') || '', publication, timezone: tz, draft, ...(old.draft === true && !same ? { replaced_draft: String(old.id) } : {}), sent_at: old.id && String(old.id) === id && old.sent_at ? old.sent_at : sentAt, ...(old.id && String(old.id) === id ? { updated_at: sentAt } : {}) };
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

// ----- status -----
const addDays = (date, n) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export function status(args, { root = settings().skillsRoot } = {}) {
  const brand = findBrand(need(args, 'brand'), root);
  const catalog = readJson(path.join(brand.dir, 'workspace', 'catalog.json'));
  const posts = [];
  const dates = [];
  let tz = '';
  for (const p of catalog.posts || []) {
    const nets = sentNetworks(p);
    if (!nets.length) continue;
    const networks = Object.fromEntries(nets.map((n) => [n, p.metricool[n]]));
    for (const r of Object.values(networks)) { if (r.publication) dates.push(String(r.publication).slice(0, 10)); tz = tz || r.timezone || ''; }
    const first = networks[nets[0]];
    const local = first.publication ? wallIn(first.publication, first.timezone, brand.audience_timezone) : null;
    posts.push({ post: p.id, catalog_status: p.status, published: p.status === 'published', networks, audience_time: local ? { ...local, timezone: brand.audience_timezone } : null });
  }
  dates.sort();
  const open = posts.filter((p) => !p.published);
  const query = open.length ? { tool: 'getScheduledPosts', brandId: brand.blog_id, fromDate: `${addDays(dates[0], -1)}T00:00:00`, toDate: `${addDays(dates.at(-1), 1)}T23:59:59`, timezone: tz || brand.timezone } : null;
  return {
    brand: brand.id, blog_id: brand.blog_id, posts, query,
    next: open.length
      ? 'Gọi getScheduledPosts với query, khớp theo id. PENDING: không làm gì. Bài còn metricool.<network>.draft true (nháp cũ): payload sẽ gửi lại thành bài hẹn giờ thật. ERROR: báo lỗi cho người dùng (id, plannerUrl, lý do). PUBLISHED: chạy node <thư mục skill>/scripts/mark-published.mjs <POST> <yyyy-mm-dd theo audience_time> [link bài] --lang <ngôn ngữ đăng>. Nháp cũ đã được người hẹn giờ trong Metricool (draft false, có giờ): chạy record lại với cùng --id.'
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
    else if (cmd === 'sync-brands') {
      const file = need(args, 'from');
      const r = syncMetricoolBrands(fs.readFileSync(file, 'utf8'));
      out({ brands: r.brands.map(({ name, blog_id, skill_id, excluded, removed }) => ({ name, blog_id, skill_id, ...(excluded ? { excluded } : {}), ...(removed ? { removed } : {}) })), added: r.added, removed: r.removed, updated_at: r.updated_at });
    }
    else fail('Lệnh: payload --brand <id> [--posts POST-01,...] | record --brand <id> --post POST-xx --id <id> --uuid <uuid> --planner-url <url> --publication <dateTime> --tz <tz> | status --brand <id> | sync-brands --from <file>');
  } catch (e) { fail(e.message, e.problems ? { problems: e.problems } : {}); }
});
