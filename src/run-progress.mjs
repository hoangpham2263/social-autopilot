// Read-only counters of the current (or last) Run now run, derived from the files the run already writes:
// research = runs/<brand>/<date>/run.json (kept so far vs the brand target), create = pipeline/create.json + drafts,
// publish = the queue report (scheduled on Metricool vs approved). GET /api/run-progress; nothing is written.
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { workspace, readJson, runDir, latestRun, listDrafts } from "../scripts/lib.mjs";
import { brandTotal } from "../scripts/research.mjs";
import { queueReport } from "../scripts/queue.mjs";

const arr = (v) => (Array.isArray(v) ? v : []);
// A file counts for this run only when it was written after the run started (a small slack for clock rounding).
const fresh = (file, started) => { try { return !started || statSync(file).mtimeMs >= Date.parse(started) - 5000; } catch { return false; } };

export function researchProgress(scope, started) {
  const rows = brands.map((id) => {
    const date = latestRun(id), file = date ? join(runDir(id, date), "run.json") : "";
    const run = file && fresh(file, started) ? readJson(file, null) : null;
    return { brand: id, kept: run ? brandTotal(run) : 0, target: Number(run?.mode?.max_posts) || 0, started: !!run };
  });
  return { rows, kept: rows.reduce((a, r) => a + r.kept, 0), target: rows.reduce((a, r) => a + r.target, 0) };
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
  return { requested, drafts: ids.size, images: mine.filter((d) => existsSync(join(d.dir, "image.png"))).length, stage: st.stage || "" };
}

export function publishProgress(brands) {
  const q = queueReport({});
  const rows = arr(q.brands).filter((b) => !brands.length || brands.includes(b.brand));
  const scheduled = rows.reduce((a, b) => a + arr(b.on_metricool).length, 0), waiting = rows.reduce((a, b) => a + arr(b.unsent_approved).length, 0);
  return { scheduled, approved: scheduled + waiting };
}

// st = agentRun.status(): mode, started and brands of the current or last run.
export function runProgress(st, allBrands = []) {
  const mode = st?.mode || "", started = st?.started || "", brands = arr(st?.brands).map((b) => (typeof b === "string" ? b : b?.brand || b?.id)).filter(Boolean), scope = brands.length ? brands : allBrands;
  const out = { mode, active: !!st?.active, started };
  if (mode === "research") out.research = researchProgress(brands, started);
  else if (mode === "create") out.create = createProgress(started);
  else if (mode === "publish") out.publish = publishProgress(brands);
  return out;
}
