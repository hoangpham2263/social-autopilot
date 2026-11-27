// Captions in parallel with the images (like product-review's review workers): while a Create run of THIS window is active, every few
// seconds the server looks at the run's own pipeline (workspace/pipeline/<pipe_id>/create.json) and starts a caption worker
// (scripts/caption-worker.mjs, a separate light CLI process) for each post whose cover image is registered and whose captions are missing,
// up to the Run tab Threads value at once (Flow never counts: the image agent stays one sequential process). Backend and model = the
// Create agent of Settings (agent.create: Claude Code or Antigravity; Antigravity without a chosen model = its fast default for light steps).
// A failed worker is tried again (3 launches per post per run); a quota / login answer stops new workers for the run and says so.
// Nothing here writes a caption: the worker does, under the draft's lock. Only runs started by this app version carry caption_workers.
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { readJson, writeJson, findDraft } from "../scripts/lib.mjs";
import { needsCaptions, claimAlive } from "../scripts/caption-worker.mjs";
import { agentFor, agyChoice, AGY_FAST_DEFAULT } from "../scripts/agent-models.mjs";
import { claudeChoice } from "../core/setup/agent-run.mjs";

export function captionChoice(settings = {}) {
  const backend = agentFor(settings, "create");
  if (backend === "antigravity") {
    const c = agyChoice(settings), model = c.id || AGY_FAST_DEFAULT;
    // a model id that already ends in its level (gemini-3.8-flash-medium) takes no --effort: agy refuses the pair
    return { backend, model, effort: /-(low|medium|high|xhigh)$/.test(model) ? "" : c.effort };
  }
  const c = claudeChoice(settings); return { backend, model: c.id, effort: c.effort };
}

export function createCaptionPump({ agentRun, toolRoot, workspace, getSettings = () => ({}), findCli, findAgy, spawnFn = spawn, maxLaunches = 3, env = process.env }) {
  let job = null; // { run, pipe, n, active: Map id -> child, launches: {id: n}, done: Set, failed: Set, fatal, said: Set }
  const note = (text) => { try { agentRun.note?.(text, job?.run || ""); } catch {} };

  // What pipeline.mjs Stage C reads: the posts whose captions the workers gave up on (the agent writes those), and a stop cause.
  const report = (j) => { try { writeJson(join(workspace, "pipeline", j.pipe, "captions-failed.json"), { run: j.run, failed: [...j.failed], fatal: j.fatal }); } catch {} };

  function launch(id, choice, cli) {
    const child = spawnFn(process.execPath, [join(toolRoot, "scripts", "caption-worker.mjs"), "run", "--id", id], {
      cwd: toolRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...env, SA_WORKSPACE: workspace, SA_RUN_ID: job.run, SA_PIPE_ID: job.pipe, SA_CAPTION_BACKEND: choice.backend, SA_CAPTION_CLI: cli, SA_CAPTION_MODEL: choice.model || "", SA_CAPTION_EFFORT: choice.effort || "" },
    });
    const j = job; let outText = "";
    j.active.set(id, child); j.launches[id] = (j.launches[id] || 0) + 1;
    if (!j.said.has("start")) { j.said.add("start"); note(`Caption: viết song song với tạo ảnh, ${j.n} luồng (${choice.backend === "antigravity" ? "Antigravity" : "Claude"})`); }
    child.stdout?.on("data", (c) => { outText = (outText + c.toString("utf8")).slice(-20000); });
    child.stderr?.on("data", () => {});
    const end = () => {
      if (!j.active.has(id)) return; j.active.delete(id);
      let r = null; try { r = JSON.parse(outText.slice(outText.indexOf("{"))); } catch {}
      if (r?.ok) { if (!r.skipped) { j.done.add(id); note(`Bài ${id}: caption xong`); } return; }
      const cause = r?.cause || "FAILED";
      if (["QUOTA", "AUTH"].includes(cause)) { j.fatal = cause; report(j); note(`Caption dừng: ${cause === "QUOTA" ? "hết hạn mức" : "cần đăng nhập lại"} CLI viết caption; agent sẽ viết phần còn thiếu`); return; }
      if ((j.launches[id] || 0) >= maxLaunches || cause === "TOOL") { j.failed.add(id); report(j); note(`Bài ${id}: caption chưa viết được (${String(r?.error || cause).slice(0, 80)}); agent sẽ viết`); }
      else note(`Bài ${id}: caption lỗi, tự thử lại (lần ${(j.launches[id] || 0) + 1}/${maxLaunches})`);
    };
    child.on("close", end); child.on("error", end);
  }

  function tick() {
    const st = agentRun.status();
    if (!st?.active || st.mode !== "create" || !st.caption_workers || !st.pipe_id) { // workers already started finish on their own, unless the person stopped the run
      if (job?.active.size && st?.run_id === job.run && st.status === "stopped") shutdown();
      return status();
    }
    if (!job || job.run !== st.run_id) job = { run: st.run_id, pipe: st.pipe_id, n: Math.min(4, Math.max(1, Number(st.caption_threads) || 1)), active: new Map(), launches: {}, done: new Set(), failed: new Set(), fatal: "", said: new Set() };
    if (job.fatal) return status();
    const choice = captionChoice(getSettings() || {});
    const found = choice.backend === "antigravity" ? findAgy?.() : findCli?.();
    if (!found?.found) { if (!job.said.has("nocli")) { job.said.add("nocli"); job.fatal = "NO_CLI"; report(job); note("Caption: không thấy CLI để viết caption song song; agent sẽ tự viết"); } return status(); }
    const state = readJson(join(workspace, "pipeline", job.pipe, "create.json"), null);
    for (const id of Array.isArray(state?.drafts) ? state.drafts : []) {
      if (job.active.size >= job.n) break;
      if (job.active.has(id) || job.failed.has(id) || (job.launches[id] || 0) >= maxLaunches) continue;
      let d; try { d = findDraft(id); } catch { continue; }
      if (!needsCaptions(d) || claimAlive(d.dir)) continue;
      launch(id, choice, found.path);
    }
    return status();
  }
  function status() {
    return job ? { run_id: job.run, threads: job.n, active: [...job.active.keys()], done: [...job.done], failed: [...job.failed], fatal: job.fatal } : { run_id: "", threads: 0, active: [], done: [], failed: [], fatal: "" };
  }
  // The worker and its CLI child (the whole tree on Windows).
  function shutdown() { for (const c of job?.active.values() || []) { try { if (process.platform === "win32" && c.pid) spawnSync("taskkill", ["/PID", String(c.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", timeout: 10000 }); else c.kill(); } catch {} } }
  return { tick, status, shutdown, busy: () => !!job?.active.size };
}
