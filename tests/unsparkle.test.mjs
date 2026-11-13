// Sparkle remover: a synthetic star (same shape the remover knows) over a smooth gradient is taken off; a picture without the star
// is left alone; the CLI reads a PNG and writes a PNG. (No JPEG fixture: the JPEG reader is the vendored jpeg-js decoder.)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeSparkle, sparkleCover, sparkleRadius, sparkleAnchor, unsparkleFile, decodeImage } from '../scripts/image/unsparkle.mjs';
import { encodePng, decodePng } from '../scripts/image/png.mjs';
import { isJpeg } from '../scripts/image/jpeg.mjs';

const W = 640, H = 640;
function gradient() {
  const data = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; data[i] = 60 + (x * 80) / W; data[i + 1] = 50 + (y * 60) / H; data[i + 2] = 40 + ((x + y) * 40) / (W + H); data[i + 3] = 255; }
  return { width: W, height: H, data };
}
function addStar(img, alpha = 0.32, right = 101, bottom = 101) {
  const { cover } = sparkleCover(W, H, W - right, H - bottom);
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

// The star is not at a fixed distance: 1K Flow downloads have it about 103 px from the right and 97 from the bottom, 2K ones 120 / 120.
for (const [right, bottom] of [[103, 97], [120, 120], [92, 128]]) {
  test(`a star ${right} px from the right and ${bottom} from the bottom is found and removed`, () => {
    const clean = gradient(), shown = gradient();
    addStar(shown, 0.3, right, bottom);
    const r = removeSparkle(shown);
    assert.equal(r.applied, true);
    assert.ok(Math.abs(r.right - right) <= 2 && Math.abs(r.bottom - bottom) <= 2, `found ${r.right}/${r.bottom}`);
    assert.ok(maxDiff(clean, shown) < 14, `left ${maxDiff(clean, shown)}`);
  });
}

test('the star radius grows only a little with the picture size', () => {
  assert.ok(Math.abs(sparkleRadius(1024, 1024) - 25.8) < 0.01);
  assert.ok(sparkleRadius(2048, 2048) <= 25.8 && sparkleRadius(2048, 2048) > 24);
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

// A bright, busy corner (white flowers on a pale table): the veil adds little contrast and the ring is noisy; the old mean-contrast test
// missed such a star. 1024 px picture, star 102 px from the right and bottom edges.
function brightBusy(size = 1024) {
  let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const data = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, base = 205 + (x * 25) / size + (y * 10) / size;
    // a bright blob (flower) just up-left of the star, brighter than the veiled star
    const flower = Math.hypot(x - (size - 135), y - (size - 135)) < 30 ? 50 : 0;
    const v = Math.max(0, Math.min(255, base + flower + (rnd() - 0.5) * 16));
    data[i] = v; data[i + 1] = v - 6; data[i + 2] = v - 14; data[i + 3] = 255;
  }
  return { width: size, height: size, data };
}
function veil(img, alpha = 0.3, off = 102) {
  const { cover } = sparkleCover(img.width, img.height, img.width - off, img.height - off);
  for (let p = 0; p < img.width * img.height; p++) { const a = alpha * cover[p]; if (!a) continue; for (let c = 0; c < 3; c++) img.data[p * 4 + c] = Math.round(img.data[p * 4 + c] * (1 - a) + 255 * a); }
}
const meanDiff = (a, b, size = 1024) => { let s = 0, n = 0; for (let y = size - 140; y < size - 64; y++) for (let x = size - 140; x < size - 64; x++) for (let c = 0; c < 3; c++) { s += Math.abs(a.data[(y * size + x) * 4 + c] - b.data[(y * size + x) * 4 + c]); n++; } return s / n; };

test('assumePresent: a star on a bright noisy background is taken off at the anchor (strength inside the real range)', () => {
  const clean = brightBusy(), shown = brightBusy(); veil(shown);
  const before = meanDiff(clean, shown);
  const r = removeSparkle(shown, { assumePresent: true });
  assert.equal(r.applied, true);
  assert.ok(['detected', 'anchor'].includes(r.method));
  assert.ok(r.alpha >= 0.1 && r.alpha <= 0.8, `alpha ${r.alpha}`);
  assert.ok(meanDiff(clean, shown) < before / 2, `mean error ${before} -> ${meanDiff(clean, shown)}`);
});

test('assumePresent on a picture whose star does not show: anchor method with the clamped strength', () => {
  const img = brightBusy();
  for (let p = 0; p < img.width * img.height; p++) for (let c = 0; c < 3; c++) img.data[p * 4 + c] = 253; // saturated: no contrast at all
  const r = removeSparkle(img, { assumePresent: true });
  assert.equal(r.applied, true);
  assert.equal(r.method, 'anchor');
  assert.ok(r.alpha >= 0.25 && r.alpha <= 0.36, `alpha ${r.alpha}`);
  assert.ok(Math.abs(r.right - 102) <= 5 && Math.abs(r.bottom - 102) <= 5);
});

test('without assumePresent a flat picture stays unchanged; the anchor grows from 102 (1K) to 120 (2K)', () => {
  const img = { width: 1024, height: 1024, data: Buffer.alloc(1024 * 1024 * 4, 253) }, copy = Buffer.from(img.data);
  assert.equal(removeSparkle(img).applied, false);
  assert.ok(img.data.equals(copy));
  assert.equal(sparkleAnchor(1024, 1024), 102);
  assert.equal(sparkleAnchor(2048, 2048), 120);
});

// A strong veil over a sharp horizontal edge (dark floor above, lighter rug below): the star is found, the strength stays what the
// picture shows (the interior and the edge-free outline agree), and nothing outside the star box changes.
test('a star across a sharp edge with different luminance on both sides is removed without a dark patch', () => {
  const make = () => { const img = gradient(); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4, k = y < H - 101 ? 0.45 : 1.3; for (let c = 0; c < 3; c++) img.data[i + c] = Math.min(255, Math.round(img.data[i + c] * k)); } return img; };
  const clean = make(), shown = make(), outside = Buffer.from(shown.data);
  addStar(shown, 0.32);
  const r = removeSparkle(shown);
  assert.equal(r.applied, true);
  assert.ok(r.alpha >= 0.22 && r.alpha <= 0.4, `alpha ${r.alpha}`);
  assert.ok(maxDiff(clean, shown) < 20, `left ${maxDiff(clean, shown)}`);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.abs(x - (W - 101)) > 40 || Math.abs(y - (H - 101)) > 40) for (let c = 0; c < 3; c++) assert.equal(shown.data[(y * W + x) * 4 + c], outside[(y * W + x) * 4 + c]);
});
