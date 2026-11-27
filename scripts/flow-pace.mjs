#!/usr/bin/env node
// Human pacing gate for Google Flow submissions (Flow flags bursts as "unusual activity").
//   node scripts/flow-pace.mjs gate --tag <draft>#<n>   BLOCKS until a human-like moment, records the submission, prints one JSON line.
//   node scripts/flow-pace.mjs status                   prints the recent submissions (no waiting).
//   node scripts/flow-pace.mjs reset                    clears the record (a new Flow project / a new run).
// The agent runs `gate` right BEFORE every prompt it submits and submits right after it returns. Nothing else paces the run, so the
// pauses cannot be skipped by writing a faster browser script. Rules (fast, but never a rhythm):
//   - 5-12 s random gap between two prompts;
//   - a group is 2-3 prompts (random, user 2026-11-23), gaps stay random; after a group a further 20-45 s pause (the agent should download/register that group meanwhile);
//   - never more than 8 prompts inside 2 minutes.
// State: PER CHROME PROFILE (user 2026-11-23: one account per profile, Google limits per account), machine-wide in the OS temp folder
// <tmp>/flow-pace/<profile>.json, the same file product-review uses for that profile, so both tools on one profile share one pace and
// runs on different profiles never wait for each other. The profile: PLAYWRIGHT_MCP_PROFILE_DIR_NAME (set on the run by agent-run.mjs),
// else settings research.chrome_profile; unknown = the old workspace/tmp/flow-pace.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function flowProfile() {
  if (process.env.PLAYWRIGHT_MCP_PROFILE_DIR_NAME) return process.env.PLAYWRIGHT_MCP_PROFILE_DIR_NAME;
  for (const f of ['workspace/settings.json', 'config/settings.json']) {
    try { const s = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); if (s.browser?.mode === 'own') return 'own-chrome'; const p = String(s.research?.chrome_profile || '').trim(); if (p) return p; } catch {}
  }
  return '';
}
const PROFILE = flowProfile();
const FILE = PROFILE ? path.join(os.tmpdir(), 'flow-pace', PROFILE.replace(/[^\w.-]+/g, '_') + '.json') : path.join(ROOT, 'workspace', 'tmp', 'flow-pace.json');
const rnd = (a, b) => Math.round(a + Math.random() * (b - a));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function load() {
  try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); return { times: Array.isArray(j.times) ? j.times : [], in_group: j.in_group || 0, group_size: j.group_size || rnd(2, 3), tags: j.tags || [] }; }
  catch { return { times: [], in_group: 0, group_size: rnd(2, 3), tags: [] }; }
}
function save(st) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(st)); }
const out = (o) => console.log(JSON.stringify(o));

export function requiredWaitMs(st, now = Date.now()) {
  const last = st.times[st.times.length - 1];
  let wait = 0;
  if (last) {
    const sinceLast = now - last;
    const gap = st.in_group >= st.group_size ? rnd(20, 45) * 1000 : rnd(5, 12) * 1000;
    wait = Math.max(0, gap - sinceLast);
  }
  const recent = st.times.filter((t) => now - t < 120000);
  if (recent.length >= 8) wait = Math.max(wait, 120000 - (now - recent[recent.length - 8]) + 1000);
  return wait;
}

async function gate(args) {
  const tag = String(args.tag || '').trim();
  if (!tag) { out({ ok: false, error: 'Thiếu --tag <draft>#<n>.' }); process.exit(1); }
  const st = load();
  const waitMs = requiredWaitMs(st);
  if (waitMs > 0) await sleep(waitMs + rnd(0, 1500));
  const now = Date.now();
  if (st.in_group >= st.group_size) { st.in_group = 0; st.group_size = rnd(2, 3); st.tags = []; }
  st.in_group += 1; st.tags.push(tag);
  st.times = [...st.times.filter((t) => now - t < 600000), now];
  save(st);
  out({ ok: true, tag, waited_s: Math.round(waitMs / 1000), prompt_in_group: st.in_group, group_size: st.group_size, last_of_group: st.in_group >= st.group_size,
    note: st.in_group >= st.group_size ? 'Last prompt of this group: submit it, wait for the group to render, download + register it; the next gate adds a 20-45 s pause.' : 'Submit this prompt now.' });
}

// ----- Machine-wide download lock (the SAME file and format as product-review's core/flow-pace.mjs, so the two tools never take each other's
// file out of the shared Downloads folder) + download-collect (ported from product-review 2026-11-26). The gate above is untouched. -----
//   node scripts/flow-pace.mjs download-lock acquire --tag <draft>#<n> [--stale-min 5] [--wait-min 10]   BLOCKS until no other window is downloading.
//   node scripts/flow-pace.mjs download-lock release --tag <draft>#<n>
//   node scripts/flow-pace.mjs download-collect --tag <draft>#<n> [--dest <dir>] [--wait-s 30]   after the download click: wait for the new file,
//     move it to <dest>/<draft>-<n>.<ext> (default workspace/tmp/flow-downloads/<run id>), check it is an image, ALWAYS release the lock.
const DOWNLOAD_LOCK = process.env.PR_FLOW_DOWNLOAD_LOCK || path.join(os.tmpdir(), 'flow-download.lock');
async function downloadLock(action, args) {
  const tag = String(args.tag || '').trim();
  if (!tag) { out({ ok: false, error: 'Thiếu --tag <draft>#<n>.' }); process.exit(1); }
  if (action === 'release') {
    let cur = null; try { cur = JSON.parse(fs.readFileSync(DOWNLOAD_LOCK, 'utf8')); } catch {}
    if (!cur) { out({ ok: true, released: false, note: 'no lock held' }); return; }
    if (cur.tag !== tag && !args.force) { out({ ok: false, error: `The lock belongs to ${cur.tag}, not ${tag}.` }); process.exit(1); }
    try { fs.rmSync(DOWNLOAD_LOCK, { force: true }); } catch {}
    out({ ok: true, released: true, tag }); return;
  }
  if (action !== 'acquire') { out({ ok: false, error: 'Lệnh: download-lock acquire|release --tag <draft>#<n>' }); process.exit(1); }
  const staleMs = Math.max(1, Number(args['stale-min']) || 5) * 60000, giveUp = Date.now() + Math.max(1, Number(args['wait-min']) || 10) * 60000;
  const started = Date.now();
  for (;;) {
    try {
      fs.writeFileSync(DOWNLOAD_LOCK, JSON.stringify({ tag, pid: process.ppid || process.pid, session: 'social-autopilot' + (process.env.SA_RUN_ID ? ' ' + process.env.SA_RUN_ID : ''), at: new Date().toISOString() }), { flag: 'wx' });
      out({ ok: true, tag, waited_s: Math.round((Date.now() - started) / 1000), note: 'Hold it only for ONE download: click download, then download-collect (it moves the file and releases the lock).' });
      return;
    } catch {
      let cur = null; try { cur = JSON.parse(fs.readFileSync(DOWNLOAD_LOCK, 'utf8')); } catch {}
      let age = 0; try { age = Date.now() - fs.statSync(DOWNLOAD_LOCK).mtimeMs; } catch { continue; }
      if (age > staleMs) { try { fs.rmSync(DOWNLOAD_LOCK, { force: true }); } catch {} continue; } // only the age decides (the acquiring shell is gone long before the download ends)
      if (Date.now() > giveUp) { out({ ok: false, error: `Download lock still held by ${cur?.tag || '?'} (${cur?.session || 'default'}) after the wait; try again.` }); process.exit(1); }
      await sleep(300 + rnd(0, 200));
    }
  }
}
function imageInfo(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) return { type: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i + 9 < buf.length;) { if (buf[i] !== 0xff) { i++; continue; } const m = buf[i + 1]; if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { type: 'jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }; i += 2 + buf.readUInt16BE(i + 2); }
    return { type: 'jpeg', width: 0, height: 0 };
  }
  if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { type: 'webp', width: 0, height: 0 };
  return null;
}
export async function downloadCollect(args) {
  const tag = String(args.tag || '').trim();
  if (!tag) return { ok: false, error: 'Thiếu --tag <draft>#<n>.' };
  const m = /^([a-z0-9][a-z0-9-]*)#([1-4])$/i.exec(tag), key = m ? `${m[1]}-${m[2]}` : tag.replace(/[^\w.-]+/g, '-');
  const dir = args.dir || process.env.SA_DOWNLOADS_DIR || path.join(os.homedir(), 'Downloads');
  const ws = path.resolve(process.env.SA_WORKSPACE || path.join(ROOT, 'workspace'));
  const dest = args.dest || path.join(ws, 'tmp', 'flow-downloads', process.env.SA_RUN_ID || 'manual');
  const since = args['since-ms'] ? Number(args['since-ms']) : Date.now() - 120000, until = Date.now() + Math.max(3, Number(args['wait-s']) || 30) * 1000;
  let found = null;
  try {
    while (!found && Date.now() < until) {
      const cands = [];
      let names = []; try { names = fs.readdirSync(dir); } catch {}
      for (const n of names) {
        if (!/\.(png|jpe?g|webp)$/i.test(n) || /^(?:sa|pr)-ref-/i.test(n)) continue; // the reference copies we upload are never a result
        let st; try { st = fs.statSync(path.join(dir, n)); } catch { continue; }
        if (st.isFile() && st.mtimeMs >= since && st.size > 2000) cands.push({ n, mtime: st.mtimeMs, size: st.size, tagged: n.includes(key) });
      }
      cands.sort((a, b) => (b.tagged - a.tagged) || (b.mtime - a.mtime));
      const c = cands[0];
      if (c) { await sleep(400); try { if (fs.statSync(path.join(dir, c.n)).size === c.size) { found = c; break; } } catch {} }
      else await sleep(400);
    }
    if (!found) return { ok: false, tag, error: 'No new image appeared in ' + dir + ' within the wait (is the 1K download menu item clicked?).', cause: 'NO_DOWNLOAD', lock_released: true };
    fs.mkdirSync(dest, { recursive: true });
    const ext = path.extname(found.n).toLowerCase(), target = path.join(dest, key + ext);
    try { fs.renameSync(path.join(dir, found.n), target); } catch { fs.copyFileSync(path.join(dir, found.n), target); fs.rmSync(path.join(dir, found.n), { force: true }); }
    const buf = fs.readFileSync(target), info = imageInfo(buf);
    if (!info) return { ok: false, tag, error: 'The moved file is not a PNG/JPEG/WebP image.', cause: 'NOT_IMAGE', path: target, lock_released: true };
    const reg = m ? `node scripts/draft.mjs register-image --id ${m[1]} --n ${m[2]} --from "${target}"` : '';
    return { ok: true, tag, path: target, bytes: buf.length, type: info.type, width: info.width, height: info.height, from: found.n, tagged: found.tagged, lock_released: true,
      next: 'LOOK at the picture ONCE (Read), then ' + (reg || 'its register command with --from <path>') };
  } finally { try { const cur = JSON.parse(fs.readFileSync(DOWNLOAD_LOCK, 'utf8')); if (cur.tag === tag || args.force) fs.rmSync(DOWNLOAD_LOCK, { force: true }); } catch {} }
}

// The Flow project of each Chrome profile (user 2026-11-23: set the project up ONCE and reuse it every run, no new project and no new settings each time):
// workspace/config/flow-projects.json { "<profile>": { "url": "https://flow.google.com/project/<id>", "saved": "<iso time>" } }.
const PROJECTS_FILE = path.join(ROOT, 'workspace', 'config', 'flow-projects.json');
const readProjects = () => { try { return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8').replace(/^﻿/, '')) || {}; } catch { return {}; } };
function projectCmd(sub, args) {
  const key = PROFILE || 'shared', all = readProjects();
  if (sub === 'get') return out({ ok: true, profile: key, url: all[key]?.url || '', saved: all[key]?.saved || '', note: all[key]?.url ? 'Open this URL directly (it keeps its settings); only if it fails to open, create a new project and run: project set --url <new url>.' : 'No saved project for this profile: create one, then run: project set --url <its url>.' });
  if (sub === 'set') {
    const url = String(args.url || '').trim();
    if (!/^https:\/\/flow\.google\.com\/(?:[a-z]{2}\/)?project\/[\w-]{8,}/i.test(url)) { out({ ok: false, error: 'project set --url <https://flow.google.com/project/<id>>' }); process.exit(1); }
    all[key] = { url: url.split(/[?#]/)[0], saved: new Date().toISOString() };
    fs.mkdirSync(path.dirname(PROJECTS_FILE), { recursive: true }); fs.writeFileSync(PROJECTS_FILE, JSON.stringify(all, null, 2));
    return out({ ok: true, profile: key, url: all[key].url });
  }
  if (sub === 'clear') { delete all[key]; fs.mkdirSync(path.dirname(PROJECTS_FILE), { recursive: true }); fs.writeFileSync(PROJECTS_FILE, JSON.stringify(all, null, 2)); return out({ ok: true, profile: key, cleared: true }); }
  out({ ok: false, error: 'Lệnh: project get | project set --url <url> | project clear' }); process.exit(1);
}

const [cmd, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) { args[rest[i].slice(2)] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; }
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (cmd === 'gate') await gate(args);
  else if (cmd === 'download-lock') await downloadLock(rest.find((x) => !x.startsWith('--')), args);
  else if (cmd === 'download-collect') out(await downloadCollect(args));
  else if (cmd === 'status') { const st = load(); out({ ok: true, profile: PROFILE || 'shared', file: FILE, in_group: st.in_group, group_size: st.group_size, last_2min: st.times.filter((t) => Date.now() - t < 120000).length, total_recorded: st.times.length }); }
  else if (cmd === 'project') projectCmd(rest.find((x) => !x.startsWith('--')), args);
  else if (cmd === 'reset') { save({ times: [], in_group: 0, group_size: rnd(2, 3), tags: [] }); out({ ok: true, reset: true }); }
  else { out({ ok: false, error: 'Lệnh: project get|set --url <url>|clear | gate --tag <draft>#<n> | download-lock acquire|release --tag <draft>#<n> | download-collect --tag <draft>#<n> [--dest d] | status | reset' }); process.exit(1); }
}
