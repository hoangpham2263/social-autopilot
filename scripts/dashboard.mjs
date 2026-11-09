// Read-only status page: collects what the user needs to see (drafts waiting for approval, brands and what they still
// miss, approved posts) with the same functions the scheduled agent runs, and writes ONE self-contained dashboard.html
// (data embedded as JSON, images by relative path, no server). Open it by double-click; refresh by running this again
// (open-dashboard.cmd does both). It never writes to a brand folder or changes any draft.
//   node scripts/dashboard.mjs [--out <file>]      default: <tool>/dashboard.html (git-ignored: local data)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { main, out, isMain, parseArgs, settings, discoverBrands, brandSources, readJson, listDrafts, workspace, toolRoot, stamp } from './lib.mjs';
import { summary } from './draft-lib.mjs';

const REFRESH = 'node scripts/dashboard.mjs';

// What the brand skill's check-skill --tool-ready says is missing, in plain Vietnamese.
const PLAIN = [
  [/project\/social\.json/, 'Chưa có file khai báo social'],
  [/research\.sources/, 'Chưa có trang tham khảo nào đang bật'],
  [/research\.max_per_day/, 'Chưa đặt số lượt nghiên cứu mỗi ngày'],
  [/^thiếu channels/, 'Chưa có kênh đăng nào đang bật'],
  [/language_policy/, 'Chưa chọn cách viết theo ngôn ngữ'],
  [/product_images\.sources/, 'Chưa có thư mục ảnh sản phẩm'],
  [/ai_scenes_allowed/, 'Chưa chọn có cho dựng cảnh bằng AI không'],
  [/Giọng viết/, 'Hồ sơ thiếu tính cách giọng viết'],
  [/Hashtag cố định/, 'Hồ sơ thiếu hashtag cố định'],
  [/CTA/, 'Hồ sơ thiếu hướng kêu gọi (CTA)'],
  [/project\.md Website/, 'Hồ sơ thiếu website'],
  [/posts_per_week/, 'Chưa đặt số bài mỗi tuần'],
  [/cadence\.timezone/, 'Chưa đặt múi giờ đăng'],
  [/cadence\.slots/, 'Chưa có giờ đăng'],
  [/approval\.owner/, 'Chưa có người duyệt'],
  [/check-skill\.mjs/, 'Skill thiếu script kiểm tra'],
  [/không đọc được/, 'File social.json bị lỗi'],
];
export const plainProblem = (p) => PLAIN.find(([re]) => re.test(p))?.[1] || p.replace(/^thiếu /, 'Thiếu ');

// Images are referenced, never embedded: relative to the page when under its folder, else a file:/// URL.
function linker(outDir) {
  return (file) => {
    if (!file || !fs.existsSync(file)) return '';
    const rel = path.relative(outDir, file);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel.split(path.sep).map(encodeURIComponent).join('/');
    return pathToFileURL(file).href;
  };
}
const langOf = (file) => /^content-(.+)\.txt$/.exec(file)?.[1] || file;

// Errors the scripts logged in the last 24 hours (workspace/logs/<date>.log): only a count for the page.
function recentErrors(now = Date.now()) {
  const dir = path.join(workspace, 'logs');
  let count = 0;
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((x) => /^\d{4}-\d{2}-\d{2}\.log$/.test(x)).sort().slice(-2)) {
      for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/)) {
        const m = /^\[([^\]]+)\] .* -> error: /.exec(l);
        if (m && now - Date.parse(m[1]) <= 24 * 3600 * 1000) count++;
      }
    }
  }
  return { count, dir };
}

export function collect({ outDir = toolRoot } = {}) {
  const s = settings();
  const link = linker(outDir);
  const { root, brands } = discoverBrands(s);
  const brandList = brands.map((b) => {
    let social = {};
    try { social = readJson(path.join(b.dir, 'project', 'social.json')); } catch {}
    return { id: b.id, name: b.brand || b.id, enabled: b.enabled, ready: b.ready, usable: b.usable, sources: brandSources(social).length, missing: (b.problems || []).map(plainProblem) };
  });
  // Hosted image link (media_url, written by host-image.mjs) from the brand catalog of each approved post.
  const catalogs = new Map();
  const mediaUrl = (bp) => {
    if (!bp.catalog) return '';
    if (!catalogs.has(bp.catalog)) { try { catalogs.set(bp.catalog, readJson(bp.catalog).posts || []); } catch { catalogs.set(bp.catalog, []); } }
    return catalogs.get(bp.catalog).find((p) => p.id === bp.id)?.media_url || '';
  };
  const drafts = listDrafts().map((d) => {
    const sm = summary(d);
    const st = d.status;
    return {
      id: sm.id, brand: sm.brand, status: sm.status, created: d.draft.created || '', idea: sm.idea, networks: sm.networks, image_mode: sm.image_mode,
      image: link(path.join(d.dir, 'image.png')),
      reference_image: sm.reference_image ? link(sm.reference_image) : '', source_shop: sm.source_shop || '', inspiration: sm.inspiration || '',
      captions: Object.entries(sm.captions).map(([f, text]) => ({ lang: langOf(f), text })),
      problems: sm.problems, dir: d.dir,
      brand_post: st.brand_post ? { id: st.brand_post.id, folder: st.brand_post.folder || '', media_url: mediaUrl(st.brand_post) } : null,
    };
  }).sort((a, b) => String(b.created).localeCompare(String(a.created)));
  return { generated_at: stamp(), refresh: REFRESH, skills_root: root, brands: brandList, drafts, errors: recentErrors() };
}

const BS = String.fromCharCode(92);
const UNSAFE = new RegExp('[<' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');
// JSON inside <script>: no "</script>" or "<!--" can end it early.
const embed = (data) => JSON.stringify(data).replace(UNSAFE, (c) => BS + 'u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

export function render(data) {
  const tpl = fs.readFileSync(path.join(toolRoot, 'scripts', 'dashboard.template.html'), 'utf8');
  return tpl.replace('/*__DATA__*/null', () => embed(data));
}

export function generate({ out: file = path.join(toolRoot, 'dashboard.html') } = {}) {
  const target = path.resolve(file);
  const data = collect({ outDir: path.dirname(target) });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, render(data), 'utf8');
  return {
    file: target, generated_at: data.generated_at, brands: data.brands.length, usable: data.brands.filter((b) => b.usable).length,
    awaiting_approval: data.drafts.filter((d) => d.status === 'awaiting_approval').length, approved: data.drafts.filter((d) => d.brand_post).length, hosted: data.drafts.filter((d) => d.brand_post?.media_url).length,
    errors_24h: data.errors.count, open: `start "" "${target}"`,
  };
}

if (isMain(import.meta.url)) main(() => { const args = parseArgs(); out(generate(args.out && args.out !== true ? { out: String(args.out) } : {})); });
