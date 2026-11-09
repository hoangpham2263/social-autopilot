// metricool-csv.mjs export/validate against a throw-away brand (temp skills root, SA_SKILLS_ROOT) and temp workspace.
// Nothing is sent to Metricool; --check-urls is tested through checkUrl() against a local HTTP server.
// npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'social-autopilot-mcsv-'));
const skills = path.join(tmp, 'skills');
const ws = path.join(tmp, 'workspace');
const brandDir = path.join(skills, 'testbrand-skills');
const outDir = path.join(tmp, 'out');
process.env.SA_SKILLS_ROOT = skills;
process.env.SA_WORKSPACE = ws;
const env = { ...process.env };
const lib = await import('../scripts/metricool-csv.mjs');

const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };
const run = (...args) => {
  const r = spawnSync(process.execPath, [path.join(tool, 'scripts', 'metricool-csv.mjs'), ...args], { env, encoding: 'utf8' });
  try { return { code: r.status, ...JSON.parse(r.stdout) }; } catch { throw new Error(`${args.join(' ')}: ${r.stdout}${r.stderr}`); }
};
const addDays = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const FUTURE = addDays(30);
const IMG = (n) => `https://raw.example.com/sources/main/testbrand/post-${n}.png`;
const header = lib.templateHeader();

function setup({ metricool = { brand_name: 'Test Brand', timezone: 'Asia/Ho_Chi_Minh' }, posts } = {}) {
  fs.rmSync(skills, { recursive: true, force: true });
  write(path.join(brandDir, 'SKILL.md'), '# test\n');
  write(path.join(brandDir, 'project', 'project.md'), '# Test\n\n## 1. Nhận diện\n- Tên thương hiệu (*): TestBrand\n');
  write(path.join(brandDir, 'project', 'social.json'), JSON.stringify({
    version: 1, brand: 'TestBrand', enabled: false,
    channels: [{ network: 'facebook', lang: ['vn', 'en'], enabled: true }, { network: 'instagram', lang: ['en'], enabled: false }],
    language_policy: { mode: 'one-post-bilingual' },
    cadence: { timezone: 'America/Los_Angeles', slots: [{ day: 'mon', time: '10:00' }, { day: 'thu', time: '19:30' }] },
    metricool,
  }));
  const folder = (id) => `workspace/posts/${id}`;
  for (const p of posts) {
    write(path.join(brandDir, folder(p.id), 'content-vn.txt'), `Xin chào ${p.id}`);
    write(path.join(brandDir, folder(p.id), 'content-en.txt'), p.en ?? `Hello "${p.id}",\nsecond line, with comma`);
  }
  write(path.join(brandDir, 'workspace', 'catalog.json'), JSON.stringify({
    posts: posts.map((p) => ({ folder: folder(p.id), captions: { vn: 'content-vn.txt', en: 'content-en.txt' }, caption_status: { vn: 'approved', en: 'approved' }, status: 'approved', ...p, en: undefined })),
  }));
}
// A valid row object (keyed by header) that tests then break one field at a time.
const row = (over = {}) => ({ ...Object.fromEntries(header.map((h) => [h, ''])), Text: 'Hello', Date: FUTURE, Time: '11:00:00', Draft: 'false', Facebook: 'true', [`Picture Url 1`]: IMG(1), 'Brand name': 'Test Brand', ...over });
const csvFile = (name, rows, h = header) => { const f = path.join(outDir, name); write(f, lib.toMetricoolCsv(h, rows)); return f; };

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('template has 99 columns starting with Text and ending with Brand name', () => {
  assert.equal(header.length, 99);
  assert.equal(header[0], 'Text');
  assert.equal(header.at(-1), 'Brand name');
});

test('export: approved posts with media, header order, quoting, bilingual text, slots, no writes in brand folder', () => {
  setup({ posts: [
    { id: 'POST-01', media_url: IMG(1), media_alt: 'Alt "one"' },
    { id: 'POST-02', media_url: [IMG(2), IMG(3)], schedule: { date: FUTURE, time: '08:15' } },
    { id: 'POST-03', status: 'awaiting_review', media_url: IMG(4) },
    { id: 'POST-04' }, // approved, no media: skipped with a warning
  ] });
  const before = fs.readFileSync(path.join(brandDir, 'workspace', 'catalog.json'), 'utf8');
  const file = path.join(outDir, 'export.csv');
  const r = run('export', '--brand', 'testbrand', '--draft', '--out', file);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.rows, 2);
  assert.equal(r.brand_name, 'Test Brand');
  assert.equal(r.timezone, 'Asia/Ho_Chi_Minh');
  assert.ok(r.warnings.some((w) => /POST-04/.test(w)));
  assert.ok(r.warnings.some((w) => /khác cadence.timezone/.test(w)));
  assert.ok(r.warnings.some((w) => /saveExternalMediaFiles/.test(w)));
  const raw = fs.readFileSync(file, 'utf8');
  assert.notEqual(raw.charCodeAt(0), 0xfeff, 'no BOM, as the template');
  const recs = parse(raw);
  assert.deepEqual(recs[0], header);
  const rows = recs.slice(1).map((rec) => Object.fromEntries(header.map((h, i) => [h, rec[i]])));
  const p1 = rows.find((x) => x['Picture Url 1'] === IMG(1));
  const p2 = rows.find((x) => x['Picture Url 1'] === IMG(2));
  assert.equal(p1.Text, 'Xin chào POST-01\n\nHello "POST-01",\nsecond line, with comma');
  assert.equal(p1.Draft, 'true'); assert.equal(p1.Facebook, 'true'); assert.equal(p1.Instagram, '');
  assert.equal(p1['Alt text picture 1'], 'Alt "one"');
  assert.equal(p1['Facebook Post Type'], 'POST');
  assert.match(p1.Time, /^(10:00:00|19:30:00)$/, 'time from cadence slot');
  assert.ok(p1.Date > new Date().toISOString().slice(0, 10) || p1.Date >= addDays(0));
  assert.equal(p2.Date, FUTURE); assert.equal(p2.Time, '08:15:00');
  assert.equal(p2['Picture Url 2'], IMG(3));
  // Quoting: booleans bare, text quoted with doubled quotes and real newlines.
  assert.ok(raw.includes('"Xin chào POST-01\n\nHello ""POST-01"",\nsecond line, with comma"'));
  assert.ok(/,true,true,/.test(raw));
  assert.equal(fs.readFileSync(path.join(brandDir, 'workspace', 'catalog.json'), 'utf8'), before, 'catalog untouched');
  // The exported file validates.
  const v = run('validate', file, '--brand', 'testbrand');
  assert.equal(v.ok, true, JSON.stringify(v));
});
function parse(raw) {
  // Independent RFC 4180 parser (LF only), so the test checks the file bytes, not lib.mjs.
  const rows = []; let r = [], f = '', q = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (q) { if (c === '"') { if (raw[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { r.push(f); f = ''; }
    else if (c === '\n') { r.push(f); rows.push(r); r = []; f = ''; } else f += c;
  }
  return rows;
}

test('export: --lang en, --posts selection, refuses unapproved / missing media / >10 pictures / out in brand folder', () => {
  const many = Array.from({ length: 11 }, (_, i) => IMG(i + 1));
  setup({ posts: [{ id: 'POST-01', media_url: IMG(1) }, { id: 'POST-02', status: 'awaiting_review', media_url: IMG(2) }, { id: 'POST-03' }, { id: 'POST-04', media_url: many }] });
  const ok = run('export', '--brand', 'testbrand', '--posts', 'POST-01', '--lang', 'en', '--date', FUTURE, '--time', '09:00', '--out', path.join(outDir, 'one.csv'));
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.rows, 1); assert.equal(ok.posts[0].time, '09:00:00');
  const text = parse(fs.readFileSync(path.join(outDir, 'one.csv'), 'utf8'))[1][0];
  assert.ok(!text.includes('Xin chào'));
  const bad = run('export', '--brand', 'testbrand', '--posts', 'POST-02,POST-03', '--out', path.join(outDir, 'x.csv'));
  assert.equal(bad.ok, false); assert.equal(bad.code, 1);
  assert.match(bad.error, /POST-02.*approved/); assert.match(bad.error, /POST-03.*media_url/);
  const ten = run('export', '--brand', 'testbrand', '--posts', 'POST-04', '--out', path.join(outDir, 'x.csv'));
  assert.equal(ten.ok, false); assert.match(ten.error, /tối đa 10/);
  const inBrand = run('export', '--brand', 'testbrand', '--posts', 'POST-01', '--out', path.join(brandDir, 'x.csv'));
  assert.equal(inBrand.ok, false); assert.match(inBrand.error, /thư mục thương hiệu/);
  assert.ok(!fs.existsSync(path.join(brandDir, 'x.csv')));
});

test('export: past schedule is refused and nothing is written', () => {
  setup({ posts: [{ id: 'POST-01', media_url: IMG(1), schedule: { date: '2020-01-01', time: '10:00' } }] });
  const f = path.join(outDir, 'past.csv');
  fs.rmSync(f, { force: true });
  const r = run('export', '--brand', 'testbrand', '--out', f);
  assert.equal(r.ok, false); assert.ok(r.errors.some((e) => e.field === 'Date' && /đã qua/.test(e.error)));
  assert.ok(!fs.existsSync(f));
});

test('export: no metricool block falls back to project.md name and cadence timezone, with warnings', () => {
  setup({ metricool: {}, posts: [{ id: 'POST-01', media_url: IMG(1) }] });
  const r = run('export', '--brand', 'testbrand', '--out', path.join(outDir, 'fb.csv'));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.brand_name, 'TestBrand'); assert.match(r.brand_name_source, /project\.md/);
  assert.equal(r.timezone, 'America/Los_Angeles');
  assert.ok(r.warnings.some((w) => /metricool\.brand_name/.test(w)));
  assert.ok(r.warnings.some((w) => /metricool\.timezone/.test(w)));
});

test('validate: catches every row error with a per-row list', () => {
  setup({ posts: [] });
  const tooLong = 'x'.repeat(63207);
  const rows = [
    row(),                                                     // 2 ok
    row({ Date: '2026-02-30' }),                               // 3 bad date
    row({ Date: '2020-01-01' }),                               // 4 past
    row({ Facebook: '' }),                                     // 5 no network
    row({ 'Picture Url 1': 'http://example.com/a.png' }),      // 6 not https
    row({ 'Picture Url 1': 'https://cdn.shopify.com/a.webp?format=jpg' }), // 7 webp in URL
    row({ Draft: 'TRUE' }),                                    // 8 uppercase boolean
    row({ Time: '25:00' }),                                    // 9 bad time
    row({ 'Brand name': '' }),                                 // 10 empty brand
    row({ 'Brand name': 'Other Brand' }),                      // 11 unknown brand
    row({ Text: '  ' }),                                       // 12 empty text
    row({ Text: tooLong }),                                    // 13 over Facebook limit
    row({ Instagram: 'true', 'Picture Url 1': '' }),           // 14 IG without media
    row({ 'Picture Url 1': '', 'Picture Url 2': IMG(2) }),     // 15 gap
    row({ Facebook: 'yes' }),                                  // 16 bad network value
    row({ Text: 'line one\nline "two", end' }),                // 17 ok (quoting round trip)
  ];
  const f = csvFile('bad.csv', rows);
  const r = run('validate', f);
  assert.equal(r.ok, false); assert.equal(r.code, 1);
  const at = (n) => r.errors.filter((e) => e.row === n);
  assert.equal(at(2).length, 0, JSON.stringify(at(2)));
  assert.equal(at(17).length, 0, JSON.stringify(at(17)));
  assert.ok(at(3).some((e) => e.field === 'Date'));
  assert.ok(at(4).some((e) => /đã qua/.test(e.error)));
  assert.ok(at(5).some((e) => e.field === 'networks'));
  assert.ok(at(6).some((e) => /https/.test(e.error)));
  assert.ok(at(7).some((e) => /\.webp/.test(e.error)));
  assert.ok(at(8).some((e) => e.field === 'Draft'));
  assert.ok(at(9).some((e) => e.field === 'Time'));
  assert.ok(at(10).some((e) => e.field === 'Brand name'));
  assert.ok(at(11).some((e) => e.field === 'Brand name' && /Test Brand/.test(e.error)));
  assert.ok(at(12).some((e) => e.field === 'Text'));
  assert.ok(at(13).some((e) => /Facebook/.test(e.error)));
  assert.ok(at(14).some((e) => e.field === 'Instagram'));
  assert.ok(at(15).some((e) => /liền nhau/.test(e.error)));
  assert.ok(at(16).some((e) => e.field === 'Facebook'));
});

test('validate: today refused unless --allow-today (and then the time must still be ahead)', () => {
  setup({ posts: [] });
  const tz = 'Asia/Ho_Chi_Minh';
  const now = lib.nowIn(tz);
  const f = csvFile('today.csv', [row({ Date: now.date, Time: '23:59:59' })]);
  const r = run('validate', f);
  assert.equal(r.ok, false); assert.ok(r.errors.some((e) => /hôm nay/.test(e.error)));
  const late = now.time < '23:59:59';
  const r2 = run('validate', f, '--allow-today');
  assert.equal(r2.ok, late, JSON.stringify(r2));
  const f2 = csvFile('today-past.csv', [row({ Date: now.date, Time: '00:00:00' })]);
  const r3 = run('validate', f2, '--allow-today');
  if (now.time > '00:00:00') { assert.equal(r3.ok, false); assert.ok(r3.errors.some((e) => e.field === 'Time')); }
});

test('validate: header must match the template exactly', () => {
  setup({ posts: [] });
  const h = [...header]; [h[4], h[5]] = [h[5], h[4]];
  const r = run('validate', csvFile('hdr.csv', [row()], h));
  assert.equal(r.ok, false); assert.equal(r.errors[0].field, 'header');
  const short = run('validate', csvFile('hdr2.csv', [row()], header.slice(0, 98)));
  assert.equal(short.ok, false); assert.equal(short.errors[0].field, 'header');
});

test('validate: >4 pictures on Twitter/X, video rules', () => {
  setup({ posts: [] });
  const five = Object.fromEntries([1, 2, 3, 4, 5].map((k) => [`Picture Url ${k}`, IMG(k)]));
  const r = run('validate', csvFile('tw.csv', [row({ ...five, 'Twitter/X': 'true' }), row({ TikTok: 'true' })]));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.row === 2 && e.field === 'Twitter/X'));
  assert.ok(r.errors.some((e) => e.row === 3 && e.field === 'TikTok' && /video/.test(e.error)));
});

test('checkUrl: 200 image ok; 404 and text/html refused', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/a.png') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end('x'); }
    if (req.url === '/page') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>'); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await lib.checkUrl(`${base}/a.png`)).ok, true);
    const nf = await lib.checkUrl(`${base}/missing.png`);
    assert.equal(nf.ok, false); assert.match(nf.error, /404/);
    const html = await lib.checkUrl(`${base}/page`);
    assert.equal(html.ok, false); assert.match(html.error, /content-type/);
  } finally { server.close(); }
});
