// Read-only status page: collects the state of every brand with the same functions the scheduled agent runs (brands,
// research limits, runs, ideas, drafts, approvals, settings) and writes ONE self-contained dashboard.html (data
// embedded as JSON, images by relative path, no server). Open it by double-click; refresh by running this again
// (open-dashboard.cmd does both). It never writes to a brand folder or changes any draft.
//   node scripts/dashboard.mjs [--out <file>]      default: <tool>/dashboard.html (git-ignored: local data)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { main, out, isMain, parseArgs, settings, rawSettings, discoverBrands, brandSources, readJson, listDrafts, runDir, loadRefs, workspace, toolRoot, today, stamp } from './lib.mjs';
import { summary } from './draft-lib.mjs';
import { limits } from './research.mjs';

const REFRESH = 'node scripts/dashboard.mjs';
const MAX_RUNS = 5;

// What the brand skill's check-skill --tool-ready says is missing, in plain Vietnamese (the field stays as a hint).
const PLAIN = [
  [/project\/social\.json/, 'Chưa có file khai báo social (project/social.json)'],
  [/research\.sources/, 'Chưa có trang tham khảo nào đang bật'],
  [/research\.max_per_day/, 'Chưa đặt số lượt nghiên cứu mỗi ngày'],
  [/^thiếu channels/, 'Chưa có kênh đăng nào đang bật (cần link và ngôn ngữ)'],
  [/language_policy/, 'Chưa chọn cách viết theo ngôn ngữ'],
  [/product_images\.sources/, 'Chưa có thư mục ảnh sản phẩm thật'],
  [/ai_scenes_allowed/, 'Chưa chọn có cho dựng cảnh bằng AI hay không'],
  [/ai_disclosure_label/, 'Thiếu nhãn khai báo ảnh AI'],
  [/Giọng viết/, 'Hồ sơ thương hiệu thiếu tính cách giọng viết'],
  [/Hashtag cố định/, 'Hồ sơ thương hiệu thiếu hashtag cố định'],
  [/CTA/, 'Hồ sơ thương hiệu thiếu hướng kêu gọi (CTA)'],
  [/project\.md Website/, 'Hồ sơ thương hiệu thiếu website'],
  [/posts_per_week/, 'Chưa đặt số bài mỗi tuần'],
  [/cadence\.timezone/, 'Chưa đặt múi giờ đăng'],
  [/cadence\.slots/, 'Chưa có giờ đăng nào'],
  [/approval\.owner/, 'Chưa có người duyệt'],
  [/check-skill\.mjs/, 'Skill thiếu script kiểm tra (scripts/check-skill.mjs)'],
  [/không đọc được/, 'File social.json bị lỗi, không đọc được'],
];
export const plainProblem = (p) => {
  const hit = PLAIN.find(([re]) => re.test(p));
  return { text: hit ? hit[1] : p.replace(/^thiếu /, 'Thiếu '), field: hit ? p.replace(/^thiếu /, '') : '' };
};

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
const countBy = (list, key) => list.reduce((o, x) => { const k = key(x); o[k] = (o[k] || 0) + 1; return o; }, {});

function runsData(brandIds) {
  const root = path.join(workspace, 'runs');
  const ids = new Set([...brandIds, ...(fs.existsSync(root) ? fs.readdirSync(root) : [])]);
  const runs = [];
  for (const brand of ids) {
    const dir = path.join(root, brand);
    if (!fs.existsSync(dir)) continue;
    const dates = fs.readdirSync(dir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse().slice(0, MAX_RUNS);
    for (const date of dates) {
      const run = readJson(path.join(runDir(brand, date), 'run.json'), {});
      let refs = [];
      try { refs = loadRefs(brand, date); } catch {}
      const ideas = readJson(path.join(runDir(brand, date), 'ideas.json'), { ideas: [] }).ideas || [];
      const sources = (run.sources || []).map((x) => ({
        id: x.id, name: x.name || x.id, url: x.url || '',
        raw: fs.existsSync(path.join(runDir(brand, date), x.id, 'raw.json')),
        refs: refs.filter((r) => r.source === x.id).length,
      }));
      runs.push({ brand, date, status: run.status || 'không rõ', started: run.started || '', ingested: run.ingested || '', sources, refs: refs.length, ideas: countBy(ideas, (i) => i.status) });
    }
  }
  return runs.sort((a, b) => b.date.localeCompare(a.date) || a.brand.localeCompare(b.brand));
}

// Last errors the scripts logged (workspace/logs/<date>.log), newest first.
function recentErrors(n = 12) {
  const dir = path.join(workspace, 'logs');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort().reverse().slice(0, 3);
  const lines = [];
  for (const f of files) {
    const all = fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/).filter((l) => / -> error: /.test(l)).reverse();
    for (const l of all) {
      const m = /^\[([^\]]+)\] (\S+) (.*?) -> error: (.*)$/.exec(l);
      if (m) lines.push({ at: m[1], script: m[2], args: m[3], error: m[4] });
      if (lines.length >= n) return lines;
    }
  }
  return lines;
}

export function collect({ outDir = toolRoot } = {}) {
  const s = settings();
  const link = linker(outDir);
  const { root, brands, skipped } = discoverBrands(s);
  const brandList = brands.map((b) => {
    let social = {};
    try { social = readJson(path.join(b.dir, 'project', 'social.json')); } catch {}
    const all = Array.isArray(social.research?.sources) ? social.research.sources : [];
    let lim = null;
    try { lim = limits(s, { id: b.id, social }).brand; } catch {}
    return {
      id: b.id, name: b.brand || b.id, dir: b.dir, enabled: b.enabled, ready: b.ready, usable: b.usable,
      channels: b.channels || [], languages: b.languages || [], language_mode: b.language_mode || '', owner: b.owner || '',
      ai_scenes_allowed: b.ai_scenes_allowed, scene_swap: social.product_images?.reference_redraw?.enabled === true,
      watermark: social.product_images?.watermark?.enabled === true, posts_per_week: social.cadence?.posts_per_week ?? null,
      max_per_day: Number.isInteger(social.research?.max_per_day) ? social.research.max_per_day : 0,
      sources: brandSources(social).map(({ id, name, url, what_to_take }) => ({ id, name, url, what_to_take })),
      sources_total: all.length,
      research_today: lim ? { runs: lim.runs_today, collected: lim.collected_today } : null,
      missing: (b.problems || []).map(plainProblem),
    };
  });
  const drafts = listDrafts().map((d) => {
    const sm = summary(d);
    const st = d.status;
    return {
      id: sm.id, brand: sm.brand, status: sm.status, created: d.draft.created || '', updated: st.updated || '',
      idea: sm.idea, networks: sm.networks, image_mode: sm.image_mode,
      image: link(path.join(d.dir, 'image.png')), image_path: path.join(d.dir, 'image.png'),
      reference_image: sm.reference_image ? link(sm.reference_image) : '', reference_path: sm.reference_image || '',
      source_shop: sm.source_shop || '', inspiration: sm.inspiration || '',
      captions: Object.entries(sm.captions).map(([f, text]) => ({ lang: langOf(f), text })),
      languages: d.draft.languages || [], problems: sm.problems, note: sm.note, by: st.by || '', error: st.error || '',
      logo_check: st.logo_check ? { by: st.logo_check.by || '', at: st.logo_check.at || st.logo_check.confirmed || '' } : null,
      metadata_clean: !!st.metadata_clean, watermark: !!st.watermark,
      approved: st.approved || '', rejected: st.rejected || '',
      brand_post: st.brand_post ? { id: st.brand_post.id, folder: st.brand_post.folder || '' } : null,
      dir: d.dir,
    };
  }).sort((a, b) => String(b.created).localeCompare(String(a.created)));
  const all = limits(s, null).all_brands;
  const raw = rawSettings();
  return {
    generated_at: stamp(), today: today(), refresh: REFRESH, tool_root: toolRoot, workspace, skills_root: root,
    brands: brandList, skipped: skipped.map((x) => ({ dir: x.dir, reason: x.reason })),
    drafts, runs: runsData(brandList.map((b) => b.id)), errors: recentErrors(),
    limits: { ...all, max_sources_per_run: s.research.max_sources_per_run, max_posts_per_source: s.research.max_posts_per_source, delay_seconds: s.research.delay_seconds },
    settings: {
      skillsRoot: raw.skillsRoot, skillsRootResolved: s.skillsRoot, local_override: fs.existsSync(path.join(workspace, 'settings.json')),
      approval: s.approval, codex: s.codex, ffmpeg: s.ffmpeg?.command || '', remove_watermark: s.remove_watermark?.script || '',
      publish: s.publish?.note || 'Chưa có code đăng bài.',
    },
  };
}

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
// JSON inside <script>: no "</script>" or "<!--" can end it early.
const embed = (data) => JSON.stringify(data).replace(/[<\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

export function render(data) {
  const tpl = fs.readFileSync(path.join(toolRoot, 'scripts', 'dashboard.template.html'), 'utf8');
  return tpl.replace('/*__DATA__*/null', () => embed(data)).replace('{{GENERATED}}', () => esc(data.generated_at));
}

export function generate({ out: file = path.join(toolRoot, 'dashboard.html') } = {}) {
  const target = path.resolve(file);
  const data = collect({ outDir: path.dirname(target) });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, render(data), 'utf8');
  const awaiting = data.drafts.filter((d) => d.status === 'awaiting_approval').length;
  return { file: target, generated_at: data.generated_at, brands: data.brands.length, usable: data.brands.filter((b) => b.usable).length, awaiting_approval: awaiting, drafts: data.drafts.length, open: `start "" "${target}"` };
}

if (isMain(import.meta.url)) main(() => { const args = parseArgs(); out(generate(args.out && args.out !== true ? { out: String(args.out) } : {})); });
