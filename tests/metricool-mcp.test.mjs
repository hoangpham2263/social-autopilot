// metricool-mcp.mjs payload/record/status against a throw-away brand (temp skills root + temp workspace with its own
// metricool-brands.json). Nothing is sent to Metricool: the script only prints the tool arguments and edits the temp catalog.
// npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'social-autopilot-mmcp-'));
const skills = path.join(tmp, 'skills');
const ws = path.join(tmp, 'workspace');
const brandDir = path.join(skills, 'testbrand-skills');
// The tool's own post register (scripts/posts.mjs); the skill folder is read-only for the tool.
const postsRoot = path.join(ws, 'posts', 'testbrand');
const catalogFile = path.join(postsRoot, 'catalog.json');
process.env.SA_SKILLS_ROOT = skills;
process.env.SA_WORKSPACE = ws;
const env = { ...process.env };
const mcp = await import('../scripts/metricool-mcp.mjs');

const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };
const run = (...args) => {
  const r = spawnSync(process.execPath, [path.join(tool, 'scripts', 'metricool-mcp.mjs'), ...args], { env, encoding: 'utf8' });
  try { return { code: r.status, ...JSON.parse(r.stdout) }; } catch { throw new Error(`${args.join(' ')}: ${r.stdout}${r.stderr}`); }
};
const addDays = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const FUTURE = addDays(30);
const IMG = (n) => `https://raw.githubusercontent.com/example/sources/main/testbrand/2026/11/post-${n}.png`;
const catalog = () => JSON.parse(fs.readFileSync(catalogFile, 'utf8'));

write(path.join(ws, 'metricool-brands.json'), JSON.stringify({ version: 1, brands: [
  { name: 'Test Brand', blog_id: '1111', timezone: 'Indian/Christmas', networks: ['facebook'], skill_id: 'testbrand' },
  { name: 'Other Brand', blog_id: '2222', timezone: 'America/New_York', networks: ['facebook'], skill_id: null },
] }));

function setup({ posts, skillPosts = [], metricool = { brand_name: 'Test Brand', blog_id: '1111' }, channels = [{ network: 'facebook', lang: ['en'], enabled: true }], en } = {}) {
  fs.rmSync(skills, { recursive: true, force: true });
  fs.rmSync(postsRoot, { recursive: true, force: true });
  // The skill's own catalog (its private posts): never read for posting.
  if (skillPosts.length) write(path.join(brandDir, 'workspace', 'catalog.json'), JSON.stringify({ posts: skillPosts.map((p) => ({ folder: `workspace/posts/${p.id}`, captions: { en: 'content-en.txt' }, status: 'approved', ...p })) }));
  write(path.join(brandDir, 'SKILL.md'), '# test\n');
  write(path.join(brandDir, 'project', 'project.md'), '# Test\n\n## 1. Nhận diện\n- Tên thương hiệu (*): TestBrand\n');
  write(path.join(brandDir, 'project', 'social.json'), JSON.stringify({
    version: 1, brand: 'TestBrand', enabled: true, channels,
    language_policy: { mode: 'single', review_langs: ['vn'] },
    cadence: { timezone: 'America/Los_Angeles', posts_per_week: 3, slots: [] },
    metricool,
  }));
  const folder = (id) => id;
  for (const p of posts) {
    write(path.join(postsRoot, folder(p.id), 'content-en.txt'), en ?? `Hello from ${p.id}\n\n#TestBrand`);
    write(path.join(postsRoot, folder(p.id), 'content-vn.txt'), `Xin chào ${p.id} (chỉ để duyệt)`);
  }
  write(catalogFile, JSON.stringify({ posts: posts.map((p) => ({ folder: folder(p.id), captions: { en: 'content-en.txt' }, review_captions: { vn: 'content-vn.txt' }, caption_status: { en: 'approved' }, status: 'approved', source: `social-autopilot test-${p.id}`, ...p })) }, null, 2));
}

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('isoWithOffset: audience timezone offset (PST/PDT) and +07:00', () => {
  assert.equal(mcp.isoWithOffset('2026-11-17', '10:00', 'America/Los_Angeles'), '2026-11-17T10:00:00-08:00');
  assert.equal(mcp.isoWithOffset('2026-07-01', '10:00:00', 'America/Los_Angeles'), '2026-07-01T10:00:00-07:00');
  assert.equal(mcp.isoWithOffset('2026-11-17', '01:00', 'Indian/Christmas'), '2026-11-17T01:00:00+07:00');
});

test('payload: exact createScheduledPost shape, posted language only, no AI label, always scheduled, skips sent posts', () => {
  setup({ posts: [
    { id: 'POST-01', media_url: IMG(1), media_alt: 'A pink neon sign', schedule: { facebook: { date_time: `${FUTURE}T10:00`, timezone: 'America/Los_Angeles' } } },
    { id: 'POST-02', media_url: IMG(2), metricool: { facebook: { blog_id: '1111', id: '999', publication: `${FUTURE}T09:00:00`, timezone: 'America/Los_Angeles', draft: false } } },
    { id: 'POST-03' }, // no media: skipped with a warning
    { id: 'POST-04', status: 'awaiting_review', media_url: IMG(4) },
  ] });
  const before = fs.readFileSync(catalogFile, 'utf8');
  const r = run('payload', '--brand', 'testbrand');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(fs.readFileSync(catalogFile, 'utf8'), before, 'payload writes nothing');
  assert.equal(r.items.length, 1);
  assert.deepEqual(r.skipped.map((s) => s.post), ['POST-02']);
  assert.ok(r.warnings.some((w) => /POST-03/.test(w)));
  const it = r.items[0];
  assert.equal(it.post, 'POST-01');
  assert.equal(it.tool, 'createScheduledPost');
  assert.deepEqual(Object.keys(it.args).sort(), ['blogId', 'date', 'info']);
  assert.equal(it.args.blogId, '1111');
  assert.equal(it.args.date, mcp.isoWithOffset(FUTURE, '10:00', 'America/Los_Angeles'));
  assert.equal(typeof it.args.info, 'string');
  const info = JSON.parse(it.args.info);
  assert.deepEqual(Object.keys(info).sort(), ['autoPublish', 'descendants', 'draft', 'facebookData', 'firstCommentText', 'hasNotReadNotes', 'media', 'mediaAltText', 'providers', 'publicationDate', 'shortener', 'smartLinkData', 'text']);
  assert.equal(info.draft, false);
  assert.equal(info.autoPublish, true);
  assert.deepEqual(info.media, [IMG(1)]);
  assert.deepEqual(info.mediaAltText, ['A pink neon sign']);
  assert.deepEqual(info.providers, [{ network: 'facebook' }]);
  assert.deepEqual(info.publicationDate, { dateTime: `${FUTURE}T10:00:00`, timezone: 'America/Los_Angeles' });
  assert.deepEqual(info.facebookData, { type: 'POST' });
  assert.equal(info.instagramData, undefined);
  assert.equal(info.shortener, false);
  assert.deepEqual(info.smartLinkData, { ids: [] });
  assert.deepEqual(info.descendants, []);
  assert.equal(info.firstCommentText, '');
  assert.equal(info.text, 'Hello from POST-01\n\n#TestBrand');
  assert.doesNotMatch(info.text, /Xin chào|chỉ để duyệt/, 'reviewer-only language is never posted');
  assert.doesNotMatch(it.args.info, /isAiGenerated":true|made with AI|AIgenerated/i);
  assert.match(it.record, /record --brand testbrand --post POST-01 .* --tz <publicationDate.timezone> --time-source "catalog schedule"$/);
  assert.match(run('payload', '--brand', 'testbrand', '--draft').error, /removed/);
  // the automatic time never reuses the day taken by the sent post
  const r2 = run('payload', '--brand', 'testbrand', '--posts', 'POST-02');
  assert.equal(r2.ok, true);
  assert.equal(r2.items.length, 0);
});

test('payload: draft false; instagram gets instagramData isAiGenerated false; video is a REEL', () => {
  setup({
    channels: [{ network: 'facebook', lang: ['en'], enabled: true }, { network: 'instagram', lang: ['en'], enabled: true }],
    posts: [{ id: 'POST-01', video_url: 'https://raw.githubusercontent.com/hoangpham2263/social-autopilot-sources/main/testbrand/2026/11/post-01.mp4', schedule: { facebook: { date_time: `${FUTURE}T18:30`, timezone: 'America/Los_Angeles' } } }],
  });
  const r = run('payload', '--brand', 'testbrand');
  assert.equal(r.ok, true, JSON.stringify(r));
  const info = JSON.parse(r.items[0].args.info);
  assert.equal(info.draft, false);
  assert.deepEqual(info.providers, [{ network: 'facebook' }, { network: 'instagram' }]);
  assert.deepEqual(info.facebookData, { type: 'REEL' });
  assert.deepEqual(info.instagramData, { type: 'REEL', isAiGenerated: false });
  assert.doesNotMatch(r.items[0].record, /--draft/);
});

test('payload: refuses an AI label, a past time, a blog of another brand and unknown networks', () => {
  setup({ posts: [{ id: 'POST-01', media_url: IMG(1), schedule: { date: FUTURE, time: '10:00' } }], en: 'Hello\n\n#AIgenerated #TestBrand' });
  let r = run('payload', '--brand', 'testbrand');
  assert.equal(r.ok, false);
  assert.match(r.error, /nhãn AI/);

  setup({ posts: [{ id: 'POST-01', media_url: IMG(1), schedule: { date: '2020-01-01', time: '10:00' } }] });
  r = run('payload', '--brand', 'testbrand');
  assert.equal(r.ok, false);
  assert.match(r.error, /đã qua/);

  setup({ posts: [{ id: 'POST-01', media_url: IMG(1) }], metricool: { brand_name: 'Other Brand', blog_id: '2222' } });
  r = run('payload', '--brand', 'testbrand');
  assert.equal(r.ok, false);
  assert.match(r.error, /blogId 2222/);

  setup({ posts: [{ id: 'POST-01', media_url: IMG(1) }], channels: [{ network: 'tiktok', lang: ['en'], enabled: true }] });
  r = run('payload', '--brand', 'testbrand');
  assert.equal(r.ok, false);
  assert.match(r.error, /chưa hỗ trợ mạng tiktok/);
});

test('record: always scheduled (schedule.<network> + status); a legacy Metricool draft is sent again and replaced; status lists the query', () => {
  // POST-01 was recorded earlier as a Metricool draft (old flow): it counts as not sent, so payload plans it again.
  setup({ posts: [
    { id: 'POST-01', media_url: IMG(1), schedule: { facebook: { date_time: `${FUTURE}T10:00`, timezone: 'America/Los_Angeles' } }, metricool: { facebook: { blog_id: '1111', id: '421362711', uuid: '3757973938339334504', planner_url: 'https://app.metricool.com/planner?x=1', publication: `${FUTURE}T10:00:00`, timezone: 'America/Los_Angeles', draft: true } } },
    { id: 'POST-02', media_url: IMG(2) },
  ] });
  const again = run('payload', '--brand', 'testbrand');
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.deepEqual(again.items.map((i) => i.post).sort(), ['POST-01', 'POST-02']);
  assert.equal(run('record', '--brand', 'testbrand', '--post', 'POST-01', '--id', '1', '--publication', `${FUTURE}T10:00`, '--tz', 'America/Los_Angeles', '--draft').ok, false, '--draft is gone');

  // the scheduled post replaces the old draft (no --force needed), as Metricool answered it in its timezone
  let r = run('record', '--brand', 'testbrand', '--post', 'POST-01', '--id', '500', '--uuid', 'u-500', '--planner-url', 'https://app.metricool.com/planner?x=2', '--publication', '2026-12-18T01:00', '--tz', 'Indian/Christmas');
  assert.equal(r.ok, true, JSON.stringify(r));
  let p = catalog().posts.find((x) => x.id === 'POST-01');
  assert.equal(p.status, 'scheduled');
  assert.deepEqual(p.schedule, { facebook: { date_time: '2026-12-18T01:00:00', timezone: 'Indian/Christmas' } });
  assert.equal(p.metricool.facebook.draft, false);
  assert.equal(p.metricool.facebook.id, '500');
  assert.equal(p.metricool.facebook.uuid, 'u-500');
  assert.equal(p.metricool.facebook.replaced_draft, '421362711');
  assert.ok(!Number.isNaN(Date.parse(p.metricool.facebook.sent_at)));

  // already scheduled: payload skips it and plans only POST-02
  const pay = run('payload', '--brand', 'testbrand');
  assert.equal(pay.ok, true, JSON.stringify(pay));
  assert.deepEqual(pay.items.map((i) => i.post), ['POST-02']);
  assert.deepEqual(pay.skipped.map((s) => s.post), []); // scheduled posts are no longer "approved": not planned again

  // another id for the same network is refused without --force
  r = run('record', '--brand', 'testbrand', '--post', 'POST-01', '--id', '5', '--publication', `${FUTURE}T10:00`, '--tz', 'America/Los_Angeles');
  assert.equal(r.ok, false);
  assert.match(r.error, /--force/);
  // the same id again keeps the uuid of the first record
  r = run('record', '--brand', 'testbrand', '--post', 'POST-01', '--id', '500', '--publication', '2026-12-18T01:00', '--tz', 'Indian/Christmas');
  assert.equal(r.ok, true, JSON.stringify(r));
  p = catalog().posts.find((x) => x.id === 'POST-01');
  assert.equal(p.metricool.facebook.uuid, 'u-500', 'kept from the first record');

  const st = run('status', '--brand', 'testbrand');
  assert.equal(st.ok, true);
  assert.deepEqual(st.posts.map((x) => x.post), ['POST-01']);
  assert.deepEqual(st.posts[0].audience_time, { date: '2026-12-17', time: '10:00:00', timezone: 'America/Los_Angeles' });
  assert.equal(st.query.tool, 'getScheduledPosts');
  assert.equal(st.query.brandId, '1111');
  assert.equal(st.query.fromDate, '2026-12-17T00:00:00');
  assert.equal(st.query.toDate, '2026-12-19T23:59:59');
  assert.equal(st.query.timezone, 'Indian/Christmas');

  // record refuses posts that are not approved/scheduled
  r = run('record', '--brand', 'testbrand', '--post', 'POST-09', '--id', '1', '--publication', `${FUTURE}T10:00`, '--tz', 'America/Los_Angeles');
  assert.equal(r.ok, false);
});

test('payload: a failing post is blocked, the others still go; an old settings default_mode is ignored', () => {
  setup({ posts: [
    { id: 'POST-01', media_url: IMG(1), schedule: { date: FUTURE, time: '10:00' } },
    { id: 'POST-02', media_url: IMG(2), schedule: { date: '2020-01-01', time: '10:00' } },
  ] });
  let r = run('payload', '--brand', 'testbrand');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.items.map((i) => i.post), ['POST-01']);
  assert.equal(r.blocked.length, 1);
  assert.match(r.blocked[0], /POST-02.*đã qua/);
  assert.equal(r.draft, false);
  // The register's delivery check (posts.mjs checkPost) is part of the gate: errors block the post (here the caption does not quote the sign text).
  setup({ posts: [{ id: 'POST-01', media_url: IMG(1), sign_text: 'The Copper Lounge', schedule: { date: FUTURE, time: '10:00' } }, { id: 'POST-03', media_url: IMG(3), schedule: { date: FUTURE, time: '11:00' } }] });
  r = run('payload', '--brand', 'testbrand');
  assert.deepEqual(r.items.map((i) => i.post), ['POST-03']);
  assert.match(r.blocked.join(' '), /POST-01/);
  // an old settings metricool.default_mode "draft" changes nothing: always scheduled.
  write(path.join(ws, 'settings.json'), JSON.stringify({ metricool: { default_mode: 'draft' } }));
  try {
    assert.equal(run('payload', '--brand', 'testbrand').draft, false);
  } finally { fs.rmSync(path.join(ws, 'settings.json'), { force: true }); }
});

test('sync-brands: getBrandSettings rewrites the brand list, keeps skill links by blogId, flags removed brands', () => {
  const file = path.join(ws, 'metricool-brands.json');
  const before = fs.readFileSync(file, 'utf8');
  try {
    const answer = path.join(ws, 'brand-settings.json');
    write(answer, JSON.stringify({ data: [
      { id: 1111, label: 'Test Brand Renamed', timezone: 'Asia/Ho_Chi_Minh', userId: 42, facebook: 'page-1', instagram: '' },
      { id: 3333, label: 'New Brand', timezone: 'Europe/Paris', networks: ['facebook', 'instagram'] },
    ] }));
    const r = run('sync-brands', '--from', answer);
    assert.equal(r.ok, true, JSON.stringify(r));
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    const by = Object.fromEntries(saved.brands.map((b) => [b.blog_id, b]));
    assert.equal(by['1111'].name, 'Test Brand Renamed');
    assert.equal(by['1111'].skill_id, 'testbrand', 'skill link kept by blogId');
    assert.deepEqual(by['1111'].networks, ['facebook']);
    assert.equal(by['1111'].timezone, 'Asia/Ho_Chi_Minh');
    assert.equal(by['3333'].skill_id, null);
    assert.deepEqual(by['3333'].networks, ['facebook', 'instagram']);
    assert.equal(by['2222'].removed, true);
    assert.equal(saved.account.user_id, '42');
    assert.ok(saved.updated_at);
    assert.deepEqual(r.added, ['New Brand']);
    assert.equal(run('sync-brands', '--from', path.join(ws, 'missing.json')).ok, false);
  } finally { fs.writeFileSync(file, before); }
});

test('payload --limit N: at most N approved posts, oldest approved first; the rest wait for the next run', () => {
  setup({ posts: [
    { id: 'POST-01', media_url: IMG(1), approval: { date: '2026-11-03' } },
    { id: 'POST-02', media_url: IMG(2), approval: { date: '2026-11-01' } },
    { id: 'POST-03', media_url: IMG(3), approval: { date: '2026-11-02' } },
  ] });
  const r = run('payload', '--brand', 'testbrand', '--limit', '2');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.items.map((i) => i.post).sort(), ['POST-02', 'POST-03']);
  assert.ok(r.skipped.some((x) => x.post === 'POST-01' && /--limit 2/.test(x.reason)));
  assert.equal(run('payload', '--brand', 'testbrand', '--limit', '0').ok, false);
  const w = run('payload', '--brand', 'testbrand', '--window', 'evening');
  assert.equal(w.ok, true, JSON.stringify(w));
  assert.ok(w.items.every((i) => /in window/.test(i.time_source)), JSON.stringify(w.items.map((i) => i.time_source)));
});

test('skill-owned posts (the skill catalog) are never sent, recorded or exported, even when approved with media', () => {
  setup({ posts: [
    { id: 'POST-01', media_url: IMG(1), schedule: { date: FUTURE, time: '10:00' } },
  ], skillPosts: [
    { id: 'POST-02', media_url: IMG(2) }, // made by hand in the skill
    { id: 'POST-05', media_url: IMG(5), source: 'social-autopilot old' }, // even an old tool entry left in a skill
  ] });
  const skillCatalog = fs.readFileSync(path.join(brandDir, 'workspace', 'catalog.json'), 'utf8');
  let r = run('payload', '--brand', 'testbrand');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.items.map((i) => i.post), ['POST-01']);
  assert.ok(![...r.skipped, ...r.blocked].some((x) => /POST-0[25]/.test(JSON.stringify(x))), 'not even listed');
  r = run('payload', '--brand', 'testbrand', '--posts', 'POST-02');
  assert.equal(r.ok, false, 'asked by id: still refused');
  r = run('record', '--brand', 'testbrand', '--post', 'POST-02', '--id', '7', '--publication', `${FUTURE}T10:00`, '--tz', 'America/Los_Angeles');
  assert.equal(r.ok, false);
  assert.match(r.error, /không có POST-02/);
  r = run('status', '--brand', 'testbrand');
  assert.ok(!JSON.stringify(r.posts || []).includes('POST-02'));
  assert.equal(fs.readFileSync(path.join(brandDir, 'workspace', 'catalog.json'), 'utf8'), skillCatalog, 'skill catalog untouched');
});
