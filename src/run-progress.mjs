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

export function createProgress(started) {
  const file = join(workspace, "pipeline", "create.json");
  if (!fresh(file, started)) return null;
  const st = readJson(file, null);
  if (!st) return null;
  const ideas = st.ideas_file && existsSync(st.ideas_file) ? readJson(st.ideas_file, {}) : {};
  const ids = new Set(arr(st.drafts));
  const mine = listDrafts().filter((d) => ids.has(d.id));
  const requested = arr(ideas.ideas).filter((i) => !i.reject).length || arr(ideas.ideas).length;
  let imagesTotal = 0, imagesDone = 0, captions = 0;
  for (const d of mine) {
    const files = draftImages(d.draft);
    imagesTotal += files.length; imagesDone += files.filter((f) => existsSync(join(d.dir, f))).length;
    if (Object.values(d.draft?.captions || {}).some((f) => typeof f === "string" && existsSync(join(d.dir, f)))) captions++;
  }
  return { requested, drafts: ids.size, captions, images: mine.filter((d) => existsSync(join(d.dir, "image.png"))).length, imagesTotal, imagesDone, stage: st.stage || "" };
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
  else if (mode === "create") out.create = createProgress(started);
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
      const c = createProgress(started);
      if (!c) return null;
      const posts = Math.max(c.requested, c.drafts);
      if (!posts) return null;
      return { done: c.drafts + c.captions + c.imagesDone, total: posts * 2 + Math.max(c.imagesTotal, 0), label: `Posts ${c.drafts}/${posts} · Captions ${c.captions} · Images ${c.imagesDone}/${c.imagesTotal}` };
    }
    if (mode === "publish") {
      const p = publishProgress(scope);
      return p.approved ? { done: p.scheduled, total: p.approved, label: `Scheduled ${p.scheduled}/${p.approved}` } : null;
    }
    return null;
  } catch { return null; }
}
