// Stand-in for the caption CLI (claude -p / agy -p=) of scripts/caption-worker.mjs in tests. Never calls an AI.
// Reads the prompt (plain text, or agy's NDJSON user message), answers with caption blocks that pass the draft-lib caption rules.
// FAKE_CAPTION_DIR: calls.jsonl (one line per call: draft, start, end, behavior). FAKE_CAPTION_DELAY_MS: answer time.
// FAKE_CAPTION_FLAKY=<draft,..>: the FIRST call for those drafts dies with a dropped connection. FAKE_CAPTION_BADFIRST=<draft,..>: the first answer has no hashtag.
// FAKE_CAPTION_QUOTA=1: every call answers a quota error.
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
if (args[0] === 'mcp' && args[1] === 'list') { console.log('NAME TYPE STATUS COMMAND\nplaywright stdio ok npx'); process.exit(0); }
const agy = args.includes('-p=');
let prompt = fs.readFileSync(0, 'utf8');
if (agy) prompt = JSON.parse(prompt.trim().split('\n')[0]).message.content;
const dir = process.env.FAKE_CAPTION_DIR || '.';
const id = (/Draft (\S+) of brand/.exec(prompt) || [])[1] || '?';
const start = Date.now();
const seen = fs.existsSync(path.join(dir, 'calls.jsonl')) ? fs.readFileSync(path.join(dir, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((c) => c.id === id).length : 0;
const list = (v) => String(process.env[v] || '').split(',').filter(Boolean);
const behavior = process.env.FAKE_CAPTION_QUOTA ? 'quota' : list('FAKE_CAPTION_FLAKY').includes(id) && !seen ? 'flaky' : list('FAKE_CAPTION_BADFIRST').includes(id) && !seen ? 'bad' : 'ok';
const langs = [...new Set([...prompt.matchAll(/<<<CAPTION ([a-z]{2})>>>/g)].map((m) => m[1]))];
const sign = (/quotes the sign wording exactly: "([^"]+)"/.exec(prompt) || [])[1] || '';
const website = (/"🌐 Website: ([^"]+)"/.exec(prompt) || [])[1] || '';
const tag = (/the hashtag (\S+?)\./.exec(prompt) || [])[1] || '';
const say = (text, ok = true) => {
  if (agy) console.log(JSON.stringify({ event: 'result', result: { status: ok ? 'SUCCESS' : 'ERROR', response: ok ? text : '', error: ok ? '' : text } }));
  else console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: !ok, result: text }));
};
setTimeout(() => {
  fs.appendFileSync(path.join(dir, 'calls.jsonl'), JSON.stringify({ id, start, end: Date.now(), behavior, agy, model: args[args.indexOf('--model') + 1] || '', repair: /previous answer was not accepted/.test(prompt) }) + '\n');
  if (behavior === 'quota') { say('RESOURCE_EXHAUSTED HTTP 429: You have exhausted your capacity, quota will reset after 2h10m', false); process.exit(1); }
  if (behavior === 'flaky') { console.error('ECONNRESET: connection reset'); process.exit(1); }
  const body = langs.map((l) => `<<<CAPTION ${l}>>>\n${l === 'vi' ? 'Bảng chữ' : 'A sign that reads'} "${sign}" for ${id}.\n${website ? `🌐 Website: ${website}\n` : ''}${behavior === 'bad' ? '#Other' : tag}\n<<<END>>>`).join('\n');
  say(body);
  process.exit(0);
}, Number(process.env.FAKE_CAPTION_DELAY_MS || 50));
