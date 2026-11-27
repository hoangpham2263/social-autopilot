// Caption worker: writes the captions of ONE draft on a light CLI process (Claude Code or Antigravity, the Create agent of Settings),
// started by the app (src/caption-pump.mjs) as soon as the post's cover image is registered, while the Flow / image agent keeps working
// (same idea as product-review's review workers). No browser, no web, no image tools: the CLI only reads the brief + brand files and
// answers with the caption text; THIS script checks it (draft-lib caption rules) and writes content-<lang>.txt under the draft's lock.
//   node scripts/caption-worker.mjs run --id <draft>      (env SA_CAPTION_BACKEND claude|antigravity, SA_CAPTION_CLI, SA_CAPTION_MODEL, SA_CAPTION_EFFORT)
//   node scripts/caption-worker.mjs prompt --id <draft>   the prompt it would send (nothing is called)
// Resume-safe: only missing / empty caption files are written (a worker-written set whose sign_text changed after a redo is written again).
// Retries: a dropped connection / empty answer is tried again after a wait; an answer that breaks a rule is asked again naming the problem;
// the last answer is kept when every language has text (draft.mjs check still flags it). Quota / login problems stop at once (cause QUOTA / AUTH).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { main, out, isMain, parseArgs, need, findDraft, withLock, writeJson, readJson, stamp, toolRoot, settings, cleanText } from './lib.mjs';
import { draftLangs, captionContext, captionTextProblems } from './draft-lib.mjs';
import { draftSignMode } from './signtext.mjs';
import { agySettings, parseAgyMcpList, AGY_IDLE_TOOLS, agyToolCall, agyQuota, isTransientAgyError } from '../core/setup/agent-run.mjs';

export const META = 'captions-meta.json', CLAIM = 'caption-claim.json';
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const nonEmpty = (f) => { try { return fs.readFileSync(f, 'utf8').trim().length > 0; } catch { return false; } };

// The caption files a draft must have (posted + reviewer-only languages): { lang: file }.
export function wantedCaptions(d) {
  const langs = draftLangs(d.draft);
  return Object.fromEntries([...new Set([...Object.keys(d.draft.captions || {}), ...langs.review])].map((l) => [l, langs.file(l)]));
}
// A worker-written set whose sign_text changed later (a redo with a new wording): the captions quote the old words, write them again.
export const staleCaptions = (d) => { const m = readJson(path.join(d.dir, META), null); return !!m && m.by === 'caption-worker' && String(m.sign_text || '') !== String(d.draft.sign_text || ''); };
export function missingCaptions(d) {
  const want = wantedCaptions(d), stale = staleCaptions(d);
  return Object.entries(want).filter(([, f]) => stale || !nonEmpty(path.join(d.dir, f))).map(([l]) => l);
}
// Does this draft still need a caption worker? Not for a draft that is approved / rejected / ready, nor before its cover image exists.
export function needsCaptions(d) {
  if (['approved', 'rejected', 'ready'].includes(d.status?.status)) return false;
  if (!['image.png', 'image-generated.png'].some((f) => fs.existsSync(path.join(d.dir, f)))) return false; // the cover (a Codex image before its clean copy counts)
  return missingCaptions(d).length > 0;
}
export const claimAlive = (dir) => { const c = readJson(path.join(dir, CLAIM), null); return !!c?.pid && pidAlive(c.pid); };

export function buildPrompt(d, langs, repair = '') {
  const { dir, draft } = d;
  const want = wantedCaptions(d), review = draftLangs(draft).review, mode = draftSignMode(draft);
  const ctx = captionContext(draft);
  const lines = [
    `TASK: write the social captions of ONE draft post. You are a caption worker of the app: no browser, no web, no image generation, no sub-agents; do NOT create, write or edit any file and run no command. Only READ files.`,
    `Draft ${draft.id} of brand ${draft.brand}, folder ${dir}.`,
    `1. Read ${path.join(dir, 'brief.md')} and follow it (it names the brand SKILL.md and project.md sections to read: read them).`,
    `2. Write each caption from the IDEA + audience in brief.md, never from the image.${draft.sign_text && mode !== 'placeholder' ? ` Every caption quotes the sign wording exactly: "${draft.sign_text}".` : ''}${mode === 'placeholder' ? ' The sign shows a placeholder: never quote it as a customer name.' : ''}`,
    `3. Plain text: no Markdown, no AI label, no shop name of the reference post, at most one empty line in a row.${ctx.website ? ` A line "🌐 Website: ${ctx.website}".` : ''}${ctx.tag ? ` The LAST line has the hashtag ${ctx.tag}.` : ''}`,
    `4. Languages: ${langs.map((l) => `${l} (${want[l]}${review.includes(l) ? ', reviewer-only, never posted' : ''})`).join(', ')}.`,
    `REPLY with ONLY the captions, one block per language, exactly like this (nothing before or after):`,
    ...langs.flatMap((l) => [`<<<CAPTION ${l}>>>`, `(the ${l} caption)`, '<<<END>>>']),
  ];
  if (repair) lines.push('', `Your previous answer was not accepted: ${repair} Write it again fixing only that.`);
  return lines.join('\n');
}
export function parseCaptions(text, langs) {
  const got = {};
  const re = /<<<CAPTION\s+([a-z]{2})>>>\s*\r?\n([\s\S]*?)\r?\n?<<<END>>>/g;
  for (let m; (m = re.exec(String(text || '')));) if (langs.includes(m[1])) got[m[1]] = cleanText(m[2]).text.trim();
  return got;
}

// ----- the CLI call -----
const cmdOf = (cli, args) => (/\.(c?m?js)$/i.test(cli) ? [process.execPath, [cli, ...args]] : process.platform === 'win32' && /\.(cmd|bat)$/i.test(cli) ? ['cmd', ['/c', cli, ...args]] : [cli, args]);
function addDirs(d) {
  let s = {}; try { s = settings(); } catch {}
  return [...new Set([toolRoot, d.dir, d.draft.brand_dir, s.skillsRoot, s.brandsRoot].filter((x) => typeof x === 'string' && x))];
}
export function callAi({ backend, cli, model = '', effort = '', prompt, dirs = [], timeoutMs = 15 * 60000 }) {
  return new Promise((resolve) => {
    let cfg = '';
    let args;
    if (backend === 'antigravity') {
      // A light agy session: every configured MCP server denied, the idle / timer tools denied (agy waits on them for minutes).
      let names = [];
      try { const r = spawnSync(...cmdOf(cli, ['mcp', 'list']), { encoding: 'utf8', windowsHide: true, timeout: 30000 }); if (r.status === 0) names = parseAgyMcpList(r.stdout); } catch {}
      cfg = path.join(os.tmpdir(), `sa-caption-${process.pid}-${Date.now()}.json`);
      fs.writeFileSync(cfg, JSON.stringify(agySettings(names, '', true)));
      args = ['--input-format', 'stream-json', '--output-format', 'stream-json', '-p=', '--dangerously-skip-permissions', '--settings', cfg, ...(model ? ['--model', model] : []), ...(effort && !/-(low|medium|high|xhigh)$/.test(model) ? ['--effort', effort] : []), '--print-timeout', `${Math.ceil(timeoutMs / 60000)}m`, ...dirs.flatMap((x) => ['--add-dir', x])];
    } else {
      args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'default', '--allowedTools', 'Read,Glob,Grep', '--strict-mcp-config', '--max-turns', '40', ...(model ? ['--model', model] : []), ...(effort ? ['--effort', effort] : []), '--add-dir', ...dirs];
    }
    const [file, argv] = cmdOf(cli, args);
    let child;
    try { child = spawn(file, argv, { cwd: toolRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env } }); } catch (e) { if (cfg) fs.rmSync(cfg, { force: true }); return resolve({ ok: false, cause: 'TRANSIENT', error: e.message }); }
    let buf = '', stderr = '', result = null, agyText = {}, lastText = '', foreign = '';
    const kill = () => { try { if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); else child.kill('SIGKILL'); } catch {} };
    const timer = setTimeout(() => { foreign ||= 'timeout'; kill(); }, timeoutMs);
    const line = (l) => {
      let ev; try { ev = JSON.parse(l); } catch { return; }
      if (ev.type === 'result') result = { ok: !ev.is_error, text: typeof ev.result === 'string' ? ev.result : '', error: ev.is_error ? String(ev.result || ev.subtype || '') : '' };
      else if (ev.type === 'assistant') for (const c of ev.message?.content || []) { if (c.type === 'text' && c.text) lastText = c.text; }
      else if (ev.event === 'step_update' && ev.step_update) {
        const su = ev.step_update;
        if (su.step_type === 'agent_response') { agyText[su.step_index] = (agyText[su.step_index] || '') + (su.text_delta || ''); if (su.state === 'DONE') lastText = agyText[su.step_index]; }
        else if (su.tool_name) { const c = agyToolCall(su.tool_name, su.tool_info?.parameters, '', su.subagent_info?.subagents, false); if (c.foreign || /^(run_command|write_to_file|replace_file_content|multi_replace_file_content|sed_file|invoke_subagent)$/.test(su.tool_name)) { foreign = su.tool_name; kill(); } }
      } else if (ev.event === 'result' && ev.result) result = { ok: ev.result.status === 'SUCCESS', text: String(ev.result.response || ''), error: String(ev.result.error || '') };
    };
    child.stdout.on('data', (c) => { buf += c.toString('utf8'); let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) line(l); } });
    child.stderr.on('data', (c) => { stderr = (stderr + c.toString('utf8')).slice(-4000); });
    child.on('error', (e) => { stderr += ' ' + e.message; });
    child.on('close', (code) => {
      clearTimeout(timer); if (buf.trim()) line(buf.trim()); if (cfg) fs.rmSync(cfg, { force: true });
      const err = [result?.error, stderr].filter(Boolean).join(' ').slice(-1500);
      if (foreign) return resolve({ ok: false, cause: 'TRANSIENT', error: foreign === 'timeout' ? 'no answer in time' : `the caption CLI used ${foreign}, which a caption worker may not use` });
      if (agyQuota(err) || /quota|RESOURCE_EXHAUSTED|usage limit|rate[- ]limit.*(reset|hours)/i.test(err)) return resolve({ ok: false, cause: 'QUOTA', error: err.slice(0, 300) });
      if (/not logged in|please run \/login|authentication|unauthori[sz]ed|sign in again|\b401\b/i.test(err)) return resolve({ ok: false, cause: 'AUTH', error: err.slice(0, 300) });
      const text = result?.text || lastText;
      if ((result && !result.ok) || code !== 0 || !text.trim()) return resolve({ ok: false, cause: 'TRANSIENT', error: (err || `exit ${code}, no answer`).slice(0, 300), transient: isTransientAgyError(err) || /overloaded|\b5\d\d\b|ECONN|network|timed? ?out|fetch failed/i.test(err) });
      resolve({ ok: true, text });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(backend === 'antigravity' ? JSON.stringify({ event: 'user', message: { content: prompt } }) + '\n' : prompt);
  });
}

const WAITS = String(process.env.SA_CAPTION_WAITS || '10000,30000').split(',').map(Number).filter((n) => n >= 0);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runWorker(id, env = process.env) {
  const backend = env.SA_CAPTION_BACKEND === 'antigravity' ? 'antigravity' : 'claude', cli = env.SA_CAPTION_CLI || '';
  if (!cli) return { ok: false, id, cause: 'NO_CLI', error: 'SA_CAPTION_CLI is not set (the app passes the Claude / agy CLI path).' };
  let d = findDraft(id);
  const claim = path.join(d.dir, CLAIM);
  if (claimAlive(d.dir) && readJson(claim, {}).pid !== process.pid) return { ok: false, id, cause: 'BUSY', error: 'another caption worker has this draft' };
  writeJson(claim, { pid: process.pid, run: env.SA_RUN_ID || '', at: stamp() });
  const tries = Math.max(1, Number(env.SA_CAPTION_TRIES) || 3);
  try {
    let repair = '', last = null, waits = 0, changes = 0;
    for (let attempt = 1; attempt <= tries; attempt++) {
      d = findDraft(id);
      if (!needsCaptions(d)) return { ok: true, id, skipped: true, note: 'captions already there (or the draft is no longer open)' };
      const langs = missingCaptions(d), signAt = String(d.draft.sign_text || '');
      const r = await callAi({ backend, cli, model: env.SA_CAPTION_MODEL || '', effort: env.SA_CAPTION_EFFORT || '', prompt: buildPrompt(d, langs, repair), dirs: addDirs(d), timeoutMs: Number(env.SA_CAPTION_TIMEOUT_MS) || 15 * 60000 });
      if (!r.ok) {
        if (['QUOTA', 'AUTH', 'TOOL'].includes(r.cause)) return { ok: false, id, cause: r.cause, error: r.error, attempts: attempt };
        last = { ok: false, id, cause: 'TRANSIENT', error: r.error, attempts: attempt };
        if (attempt < tries) await pause(WAITS[Math.min(waits++, WAITS.length - 1)] ?? 10000);
        continue;
      }
      const caps = parseCaptions(r.text, langs);
      const empty = langs.filter((l) => !caps[l]);
      if (empty.length) { repair = `no <<<CAPTION ${empty.join('>>> / <<<CAPTION ')}>>> ... <<<END>>> block with text.`; last = { ok: false, id, cause: 'INVALID', error: 'answer without the caption blocks for ' + empty.join(', '), attempts: attempt }; continue; }
      const ctx = captionContext(d.draft), want = wantedCaptions(d);
      const problems = langs.flatMap((l) => captionTextProblems(d.draft, want[l], caps[l] + '\n', ctx));
      if (problems.length && attempt < tries) { repair = problems.join('; ') + '.'; last = { ok: false, id, cause: 'INVALID', error: problems.join('; '), attempts: attempt }; continue; }
      // Write under the draft's caption lock (the agent's pipeline.mjs Stage D takes the same lock): only what is still missing,
      // never over a caption someone else wrote meanwhile, and not when the sign wording changed during the call (asked again).
      const res = withLock(path.join(d.dir, 'captions'), () => {
        const now = findDraft(id);
        if (['approved', 'rejected'].includes(now.status.status)) return { gone: true };
        if (String(now.draft.sign_text || '') !== signAt) return { changed: true };
        const stale = staleCaptions(now), wrote = [];
        for (const l of langs) {
          const f = path.join(now.dir, want[l]);
          if (!stale && nonEmpty(f)) continue;
          fs.writeFileSync(f + '.tmp', caps[l].trim() + '\n', 'utf8'); fs.renameSync(f + '.tmp', f); wrote.push(l);
        }
        writeJson(path.join(now.dir, META), { by: 'caption-worker', backend, model: env.SA_CAPTION_MODEL || '', run: env.SA_RUN_ID || '', sign_text: signAt, written: stamp(), langs: wrote, problems });
        return { wrote };
      });
      if (res.gone) return { ok: true, id, skipped: true, note: 'draft approved / rejected meanwhile' };
      if (res.changed) { repair = ''; attempt--; if (++changes > 3) return { ok: false, id, cause: 'INVALID', error: 'the sign wording kept changing' }; continue; }
      return { ok: true, id, langs: res.wrote, attempts: attempt, ...(problems.length ? { problems } : {}) };
    }
    return last || { ok: false, id, cause: 'INVALID', error: 'no usable answer' };
  } finally {
    try { if (readJson(claim, {}).pid === process.pid) fs.rmSync(claim, { force: true }); } catch {}
  }
}

if (isMain(import.meta.url)) main(async () => {
  const args = parseArgs();
  const cmd = args._[0];
  if (cmd === 'run') return out(await runWorker(String(need(args, 'id'))));
  if (cmd === 'prompt') { const d = findDraft(String(need(args, 'id'))); return out({ id: d.draft.id, langs: missingCaptions(d), prompt: buildPrompt(d, missingCaptions(d)) }); }
  throw new Error('Commands: run --id <draft> | prompt --id <draft>');
});
