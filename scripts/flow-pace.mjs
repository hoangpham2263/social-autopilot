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
// State: workspace/tmp/flow-pace.json (this machine only).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'workspace', 'tmp', 'flow-pace.json');
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

const [cmd, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) { args[rest[i].slice(2)] = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; }
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (cmd === 'gate') await gate(args);
  else if (cmd === 'status') { const st = load(); out({ ok: true, in_group: st.in_group, group_size: st.group_size, last_2min: st.times.filter((t) => Date.now() - t < 120000).length, total_recorded: st.times.length }); }
  else if (cmd === 'reset') { save({ times: [], in_group: 0, group_size: rnd(2, 3), tags: [] }); out({ ok: true, reset: true }); }
  else { out({ ok: false, error: 'Lệnh: gate --tag <draft>#<n> | status | reset' }); process.exit(1); }
}
