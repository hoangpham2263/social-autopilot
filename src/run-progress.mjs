// Read-only counters of the current (or last) Run now run, derived from the files the run already writes (never from model text):
// research = runs/<brand>/<date>/run.json (sources done, posts found / kept vs the brand target), create = pipeline/create.json + drafts
// (posts, captions, images present vs to make), publish = the queue report (scheduled on Metricool vs approved).
// GET /api/run-progress (the detailed rows) and the `progress {done,total,label}` of GET /api/agent-run (what the live bar draws). Nothing is written.
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { workspace, readJson, runDir, latestRun, listDrafts } from "../scripts/lib.mjs";
import { brandTotal } from "../scripts/research.mjs";
import { queueReport } from "../scripts/queue.mjs";
import { draftImages } from "../scripts/draft-lib.mjs";

const arr = (v) => (Array.isArray(v) ? v : []);
// A file counts for this run only when it was written after the run started (a small slack for clock rounding).
const fresh = (file, started) => { try { return !started || statSync(file).mtimeMs >= Date.parse(started) - 5000; } catch { return false; } };

export function researchProgress(brands, started) {
  const rows = arr(brands).map((id) => {
    const date = latestRun(id), file = date ? join(runDir(id, date), "run.json") : "";
    const run = file && fresh(file, started) ? readJson(file, null) : null;
    const queries = arr(run?.discovery?.queries), sources = arr(run?.sources);
    const found = sources.reduce((a, x) => a + (x.new || 0), 0) + queries.reduce((a, q) => a + (q.kept || 0), 0);
    return { brand: id, kept: run ? brandTotal(run) : 0, found, target: Number(run?.mode?.max_posts) || 0, started: !!run,
      units: sources.length + queries.length, unitsDone: sources.filter((x) => x.result).length + queries.filter((q) => q.state && q.state !== "pending").length };
  });
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  return { rows, kept: sum("kept"), found: sum("found"), target: sum("target"), units: sum("units"), unitsDone: sum("unitsDone") };
}

const mtime = (f) => { try { return statSync(f).mtimeMs; } catch { return 0; } };
// Create: posts, captions and images of this run's pipeline, plus one row per post (images done/total, caption, state) and the images
// registered SINCE this agent run started (their times give the pace for the time left; a resumed run counts only its own new images).
// pipeId = the run's own pipeline folder (kept by a resumed run): its create.json belongs to the run whatever its age; only the old shared
// file (no pipeId) must be newer than the start.
export function createProgress(started, pipeId = "") {
  const file = join(workspace, "pipeline", ...(pipeId ? [pipeId] : []), "create.json");
  if (!pipeId && !fresh(file, started)) return null;
  const st = readJson(file, null);
  if (!st) return null;
  const ideas = st.ideas_file && existsSync(st.ideas_file) ? readJson(st.ideas_file, {}) : {};
  const order = arr(st.drafts), ids = new Set(order);
  const mine = listDrafts().filter((d) => ids.has(d.id)).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const requested = arr(ideas.ideas).filter((i) => !i.reject).length || arr(ideas.ideas).length;
  const t0 = Date.parse(started) || 0;
  let imagesTotal = 0, imagesDone = 0, captions = 0;
  const posts = [], runTimes = [];
  let next = null;
  for (const d of mine) {
    const files = draftImages(d.draft), have = files.map((f) => mtime(join(d.dir, f)));
    const done = have.filter(Boolean).length;
    for (const t of have) if (t && t0 && t >= t0 - 5000) runTimes.push(t);
    const caption = Object.values(d.draft?.captions || {}).some((f) => typeof f === "string" && existsSync(join(d.dir, f)));
    imagesTotal += files.length; imagesDone += done; if (caption) captions++;
    const s = String(d.status?.status || "");
    const state = /failed/.test(s) ? "failed" : done >= files.length && caption ? "done" : done || caption ? "partial" : "todo";
    posts.push({ id: d.id, brand: d.draft?.brand || "", images: done, total: files.length, caption, state });
    if (!next && done < files.length && state !== "failed") next = { id: d.id, n: have.findIndex((t) => !t) + 1 };
  }
  runTimes.sort((a, b) => a - b);
  return { requested, drafts: ids.size, captions, images: mine.filter((d) => existsSync(join(d.dir, "image.png"))).length, imagesTotal, imagesDone, stage: st.stage || "",
    posts, next, imagesRun: runTimes.length, lastImageAt: runTimes.length ? new Date(runTimes.at(-1)).toISOString() : "" };
}
// Time left from the pace of the images finished in THIS run (2 at least): elapsed / images done here x images still missing. 0 = no estimate.
export function etaMinutes(c, started, nowMs = Date.now()) {
  const el = (nowMs - (Date.parse(started) || nowMs)) / 1000, left = (c?.imagesTotal || 0) - (c?.imagesDone || 0);
  if (!c || c.imagesRun < 2 || left <= 0 || el < 30) return 0;
  return Math.max(1, Math.round((left * (el / c.imagesRun)) / 60));
}
// The item being worked: the newest per-image live line ("Bài <id> · ảnh N · <bước>") while it names a post that still misses an image, else the first missing image on disk.
export function currentItem(c, friendly = []) {
  if (!c) return "";
  const open = new Set(arr(c.posts).filter((p) => p.images < p.total).map((p) => p.id));
  for (const f of arr(friendly).slice().reverse().slice(0, 12)) { const m = /^Bài (\S+) · ảnh (\d) · (.+)$/.exec(String(f?.text || "")); if (m && open.has(m[1])) return m[0]; }
  return c.next ? `Bài ${c.next.id} · ảnh ${c.next.n}` : "";
}

export function publishProgress(brands) {
  const q = queueReport({});
  const rows = arr(q.brands).filter((b) => !brands.length || brands.includes(b.brand));
  const scheduled = rows.reduce((a, b) => a + arr(b.on_metricool).length, 0), waiting = rows.reduce((a, b) => a + arr(b.unsent_approved).length, 0);
  return { scheduled, approved: scheduled + waiting };
}

const scopeOf = (st, allBrands) => { const b = arr(st?.brands).map((x) => (typeof x === "string" ? x : x?.brand || x?.id)).filter(Boolean); return b.length ? b : arr(allBrands); };

// st = agentRun.status(): mode, started and brands of the current or last run.
export function runProgress(st, allBrands = []) {
  const mode = st?.mode || "", started = st?.started || "", scope = scopeOf(st, allBrands);
  const out = { mode, active: !!st?.active, started };
  if (mode === "research") out.research = researchProgress(scope, started);
  else if (mode === "create") out.create = createProgress(started, st?.pipe_id || "");
  else if (mode === "publish") out.publish = publishProgress(scope);
  return out;
}

// The ONE counting function of the live bar: { done, total, label } from facts on disk, or null until the first count exists (the UI shows "Đang chuẩn bị…").
export function progressOf(st, allBrands = []) {
  try {
    const mode = st?.mode || "", started = st?.started || "", scope = scopeOf(st, allBrands);
    if (!mode || !started) return null;
    if (mode === "research") {
      const r = researchProgress(scope, started);
      if (!r.rows.some((x) => x.started) || !r.target) return null;
      return { done: Math.min(r.kept, r.target), total: r.target, label: `Sources ${r.unitsDone}/${r.units} · Found ${r.found} · Kept ${r.kept}/${r.target}` };
    }
    if (mode === "create") {
      const c = createProgress(started, st?.pipe_id || "");
      if (!c) return null;
      const posts = Math.max(c.requested, c.drafts);
      if (!posts) return null;
      const eta = st?.active ? etaMinutes(c, started) : 0, current = st?.active ? currentItem(c, st?.friendly) : "";
      return { done: c.drafts + c.captions + c.imagesDone, total: posts * 2 + Math.max(c.imagesTotal, 0), label: `Bài ${c.drafts}/${posts} · Caption ${c.captions}/${c.drafts || posts} · Ảnh ${c.imagesDone}/${c.imagesTotal}`,
        eta_min: eta, current, posts: c.posts, images_run: c.imagesRun };
    }
    if (mode === "publish") {
      const p = publishProgress(scope);
      return p.approved ? { done: p.scheduled, total: p.approved, label: `Scheduled ${p.scheduled}/${p.approved}` } : null;
    }
    return null;
  } catch { return null; }
}
