// Sparkle remover: a synthetic star (same shape the remover knows) over a smooth gradient is taken off; a picture without the star
// is left alone; the CLI reads a PNG and writes a PNG. (No JPEG fixture: the JPEG reader is the vendored jpeg-js decoder.)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeSparkle, sparkleCover, unsparkleFile, decodeImage } from '../scripts/image/unsparkle.mjs';
import { encodePng, decodePng } from '../scripts/image/png.mjs';
import { isJpeg } from '../scripts/image/jpeg.mjs';

const W = 640, H = 640;
function gradient() {
  const data = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; data[i] = 60 + (x * 80) / W; data[i + 1] = 50 + (y * 60) / H; data[i + 2] = 40 + ((x + y) * 40) / (W + H); data[i + 3] = 255; }
  return { width: W, height: H, data };
}
function addStar(img, alpha = 0.32) {
  const { cover } = sparkleCover(W, H);
  for (let p = 0; p < W * H; p++) { const a = alpha * cover[p]; if (!a) continue; for (let c = 0; c < 3; c++) img.data[p * 4 + c] = Math.round(img.data[p * 4 + c] * (1 - a) + 255 * a); }
}
const maxDiff = (a, b) => { let m = 0; for (let p = 0; p < W * H; p++) for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(a.data[p * 4 + c] - b.data[p * 4 + c])); return m; };

test('a star over a gradient is removed', () => {
  const clean = gradient(), shown = gradient();
  addStar(shown);
  assert.ok(maxDiff(clean, shown) > 30);
  const r = removeSparkle(shown);
  assert.equal(r.applied, true);
  assert.ok(Math.abs(r.alpha - 0.32) < 0.05, `alpha ${r.alpha}`);
  assert.ok(maxDiff(clean, shown) < 12, `left ${maxDiff(clean, shown)}`);
});

test('a picture without the star is left as it is', () => {
  const img = gradient(), copy = Buffer.from(img.data);
  assert.equal(removeSparkle(img).applied, false);
  assert.ok(img.data.equals(copy));
});

test('too small a picture is left as it is', () => {
  const img = { width: 100, height: 100, data: Buffer.alloc(100 * 100 * 4, 128) };
  assert.equal(removeSparkle(img).applied, false);
});

test('unsparkleFile and the CLI: PNG in, PNG out, input untouched', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-unsparkle-'));
  try {
    const shown = gradient(); addStar(shown);
    const input = path.join(dir, 'in.png'), output = path.join(dir, 'out.png');
    fs.writeFileSync(input, encodePng(shown));
    const before = fs.readFileSync(input);
    const r = unsparkleFile(input, output);
    assert.equal(r.applied, true);
    assert.ok(fs.readFileSync(input).equals(before));
    assert.ok(maxDiff(gradient(), decodeImage(fs.readFileSync(output))) < 12);
    const none = path.join(dir, 'none.png'), noneOut = path.join(dir, 'none-out.png');
    fs.writeFileSync(none, encodePng(gradient()));
    const cli = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/image-unsparkle.mjs', import.meta.url)), '--image', none, '--out', noneOut], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).applied, false);
    assert.ok(fs.readFileSync(noneOut).equals(fs.readFileSync(none)));
    assert.equal(decodePng(fs.readFileSync(noneOut)).width, W);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('isJpeg looks at the magic bytes', () => {
  assert.equal(isJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), true);
  assert.equal(isJpeg(Buffer.from([137, 80, 78, 71])), false);
});
