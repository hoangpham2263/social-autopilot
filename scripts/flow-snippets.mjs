// Ready-made Playwright snippets for ONE Flow image (Vietnamese UI), written by `draft.mjs flow-brief` next to the run's temp files.
// Why (measured in product-review 2026-11-26 and here 2026-11-27): ~16 agent tool turns per image at 7-36 s each were the real cost, not Flow's render.
// These files fold the steps of docs/flow-ui-notes.md into 4 calls the agent runs with browser_run_code_unsafe { filename: <path> }:
//   ready   = cheap check, no side effect (is this item's result rendered?);
//   prep    = 1:1 chip check + the ONE reference upload of this item + its chip in the box + prompt typed (never submits);
//   submit  = Enter (or "Bắt đầu tạo") + warning scan;
//   collect = open the result tile + click 1K download (then `node scripts/flow-pace.mjs download-collect --tag <draft>#<n>`).
// They never pace themselves: `node scripts/flow-pace.mjs gate --tag <draft>#<n>` stays a separate command between prep and submit, exactly as before.
// One item per snippet, no loops over items, the tab is brought to the front in every call.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// On for runs started by this app version (agent-run.mjs sets SA_FLOW_SPEED=1) and for runs outside the app (no SA_RUN_ID); a run started by an
// older app process (SA_RUN_ID without the flag) keeps the old by-hand flow until the app restarts.
export const flowSpeedOn = (env = process.env) => env.SA_FLOW_SPEED === '1' || !env.SA_RUN_ID;
const q = (s) => JSON.stringify(String(s));
const HEAD = `await page.bringToFront(); const sleep = (ms) => page.waitForTimeout(ms);
  if (/\\/edit\\//.test(page.url())) { const back = page.getByRole('button', { name: 'Nút quay lại để quay về trang trước' }); if (await back.count()) { await back.first().evaluate((b) => b.click()); await sleep(2500); } }`;
const WARN = `/bất thường|hạn mức|không thể tạo|vi phạm|chính sách|unusual activity|quota|violate/i`;
const CHIP = `img[alt="Hình ảnh thành phần"], img[alt="Ingredient image"]`;
const BOX = `let box = page.locator('div[role=textbox]:not([aria-label="Văn bản có thể chỉnh sửa"])').first();
  if (!(await box.count())) box = page.getByRole('textbox', { name: 'Bạn muốn tạo những gì?' });`;
// The result tile of this item = the tile right before its uploaded reference (newest first: result > upload).
const TILE = (f) => `await page.evaluate((f) => { const gs = [...document.querySelectorAll('[role=group]')]; const i = gs.findIndex((g) => g.getAttribute('aria-label') === f); if (i < 1) return { err: 'no upload tile of this item' }; const t = gs[i - 1], img = t.querySelector('img'); return { label: t.getAttribute('aria-label') || '', done: !!(img && img.naturalWidth > 0) && !/%/.test(t.innerText), text: t.innerText.replace(/\\s+/g, ' ').slice(0, 60) }; }, ${q(f)})`;

// upload = absolute path of the reference copy (under the tool folder: the file chooser refuses Downloads), prompt = the condensed prompt,
// own = the tool's own Chrome (download.saveAs works there; the extension mode takes the file from Downloads), saveAs = where own mode saves it.
export function buildFlowSnippets({ upload = '', prompt = '', own = false, saveAs = '' } = {}) {
  const f = path.basename(String(upload || ''));
  if (!f || !prompt) throw new Error('flow snippets need the reference upload and the prompt');
  const lib = `page.locator('[role=group][aria-label=' + JSON.stringify(${q(f)}) + ']:has(img[src^="http"])')`;
  const ready = `async (page) => { ${HEAD}
  const info = ${TILE(f)};
  return { item_ready: !!info.done && !/^sa-ref-/.test(info.label || ''), info }; }`;
  const prep = `async (page) => { ${HEAD}
  await page.keyboard.press('Escape'); await sleep(300);
  const left = await page.locator(${q(CHIP)}).count();
  if (left) return { stop: 'chips-left', chips: left };
  const settings = page.getByRole('button', { name: 'Điều kiện kích hoạt cài đặt' });
  let chip = (await settings.innerText()).replace(/\\s+/g, ' ');
  if (!/Nano Banana 2\\.1/.test(chip) || /Pro/.test(chip)) return { stop: 'model', settings: chip, use: 'select Nano Banana 2.1 by hand (never Pro); absent = stop and report' };
  if (!/crop_square|1:1/.test(chip)) { await settings.evaluate((b) => b.click()); await sleep(1000);
    const okA = await page.evaluate(() => { const b = [...document.querySelectorAll('.cdk-overlay-container button')].find((x) => x.textContent.trim().endsWith('1:1')); if (b) b.click(); return !!b; });
    await sleep(500); await page.keyboard.press('Escape'); await sleep(400); chip = (await settings.innerText()).replace(/\\s+/g, ' '); if (!okA) return { stop: 'no-aspect-chip', settings: chip }; }
  if (!(await ${lib}.count())) {
    let ub = page.getByRole('button', { name: 'Tải nội dung nghe nhìn lên' });
    if (!(await ub.count())) { await page.getByRole('button', { name: 'Thêm thành phần vào ô nhập câu lệnh' }).evaluate((x) => x.click()); await sleep(1000); ub = page.locator('.cdk-overlay-container button', { hasText: 'Tải nội dung nghe nhìn lên' }); }
    try { const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 8000 }), ub.first().evaluate((x) => x.click())]); await fc.setFiles(${q(upload)}); }
    catch (e) { return { stop: 'upload-chooser', error: String(e).slice(0, 120), use: 'browser_file_upload with the upload path of flow-brief, then run prep again' }; }
    for (let i = 0; i < 30 && !(await ${lib}.count()); i++) await sleep(1500);
    if (!(await ${lib}.count())) return { stop: 'upload-not-ready' };
  }
  await page.keyboard.press('Escape'); await sleep(300);
  const g = ${lib}.first();
  await g.locator('button[aria-label="Tuỳ chọn khác"]').first().evaluate((b) => b.click()); await sleep(900);
  await page.evaluate(() => { const m = [...document.querySelectorAll('.cdk-overlay-container [role=menuitem]')].find((b) => b.textContent.includes('add_2')); if (m) m.click(); }); await sleep(1200);
  await page.keyboard.press('Escape'); await sleep(300);
  const srcs = await page.locator(${q(CHIP)}).evaluateAll((a) => a.map((i) => (i.src || '').split('=')[0]));
  const base = (await g.locator('img').first().getAttribute('src') || '').split('=')[0];
  const ref_ok = srcs.length === 1 && srcs[0] === base;
  if (!ref_ok) return { stop: 'chips', chips: srcs.length, ref_ok };
  ${BOX}
  await box.fill(${q(prompt)}); await sleep(500);
  let typed = (await box.innerText()).length;
  if (typed < ${Math.floor(prompt.length * 0.9)}) { await box.click(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('Backspace'); await page.keyboard.insertText(${q(prompt)}); await sleep(500); typed = (await box.innerText()).length; }
  return { ok: typed >= ${Math.floor(prompt.length * 0.9)}, chips: srcs.length, ref_ok, typed, want: ${prompt.length}, settings: chip }; }`;
  const submit = `async (page) => { ${HEAD}
  const before = await page.locator('[role=group]').count();
  ${BOX}
  await box.focus(); await page.keyboard.press('Enter'); await sleep(1500);
  if (await page.locator(${q(CHIP)}).count()) { const go = page.getByRole('button', { name: 'Bắt đầu tạo' }); if (await go.count()) { await go.first().evaluate((b) => b.click()); } }
  await sleep(2000);
  const text = await page.evaluate(() => document.body.innerText);
  const warning = (text.match(${WARN}) || [])[0] || '';
  const chips = await page.locator(${q(CHIP)}).count();
  return { submitted: chips === 0, chips_left: chips, tiles_before: before, tiles_after: await page.locator('[role=group]').count(), warning }; }`;
  const click1k = `page.evaluate(async () => { const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const find = () => [...document.querySelectorAll('.cdk-overlay-container button, .cdk-overlay-container [role=menuitem]')].find((b) => /^\\s*1K/.test(b.textContent));
    let b = find(); if (!b) { const d = document.querySelector('button[aria-label="Tải nội dung nghe nhìn xuống"]'); if (!d) return 'no-download-button'; d.click(); for (let i = 0; i < 20 && !(b = find()); i++) await sleep(100); }
    if (!b) return 'no-1k-item'; b.click(); return 'clicked'; })`;
  const collect = `async (page) => { ${HEAD}
  const info = ${TILE(f)};
  if (info.err || !info.done || /^sa-ref-/.test(info.label)) return { stop: 'not-ready', info };
  await page.evaluate((f) => { const gs = [...document.querySelectorAll('[role=group]')]; const i = gs.findIndex((g) => g.getAttribute('aria-label') === f); gs[i - 1].querySelector('img').click(); }, ${q(f)});
  await sleep(2200);
  ${own && saveAs
    ? `let clicked = '', saved = '';
  try { const [d] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), ${click1k}.then((r) => { clicked = r; })]); await d.saveAs(${q(saveAs)}); saved = ${q(saveAs)}; } catch (e) { if (!clicked) clicked = String(e).slice(0, 80); }
  return { info, clicked, saved, next: 'node scripts/flow-pace.mjs download-collect --tag <draft>#<n> (it waits for the file, moves it, releases the lock)' }; }`
    : `const clicked = await ${click1k};
  return { info, clicked, next: 'node scripts/flow-pace.mjs download-collect --tag <draft>#<n> (it waits for the file, moves it, releases the lock)' }; }`}`;
  return { ready, prep, submit, collect };
}

// Writes <base>-flow-{ready,prep,submit,collect}.js into outDir; returns the 4 paths.
export function writeFlowSnippets(brief, outDir, base) {
  const s = buildFlowSnippets(brief);
  fs.mkdirSync(outDir, { recursive: true });
  const res = {};
  for (const [k, code] of Object.entries(s)) { const p = path.join(outDir, `${base}-flow-${k}.js`); fs.writeFileSync(p, code); res[k] = p; }
  return res;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, briefFile, outDir, base] = process.argv.slice(2);
  if (cmd !== 'write') { console.log(JSON.stringify({ ok: false, error: 'node scripts/flow-snippets.mjs write <brief.json> <outDir> <base>' })); process.exit(1); }
  try { console.log(JSON.stringify({ ok: true, ...writeFlowSnippets(JSON.parse(fs.readFileSync(briefFile, 'utf8').replace(/^﻿/, '')), outDir, base) })); }
  catch (e) { console.log(JSON.stringify({ ok: false, error: String(e.message || e) })); process.exit(1); }
}
