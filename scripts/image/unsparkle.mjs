// Removes the sparkle Google puts in the bottom right corner of the pictures its web AI makes (Flow, Gemini), in plain Node.
// The sparkle is one white veil of fixed shape (a four-point star with curved sides) in the corner (its distance from the edges depends on the picture size); it is not part of the
// picture. So it is undone, not painted over: shown = bg * (1 - a) + 255 * a, hence bg = (shown - 255 a) / (1 - a), and the
// detail under the star comes back. The strength a is measured on each picture: how much the star's inside is lifted over a
// smooth guess of the background (from the ring around the star). A picture without the star is left as it is.
// Own copy of Product Review's unsparkle.mjs (tools do not share image code), with JPEG input added: Flow downloads are JPEG.
//   node scripts/image-unsparkle.mjs --image <png|jpg> --out <png>     prints {"applied":true|false,"alpha":0.31}
import { readFileSync, writeFileSync } from "node:fs";
import { decodePng, encodePng } from "./png.mjs";
import { decodeJpeg, isJpeg } from "./jpeg.mjs";

// Measured on real Flow downloads: the star is NOT at a fixed distance from the corner. 1K (1024 x 1024): centre about 103 px from the
// right edge and 97 from the bottom; 2K (2048 x 2048, Flow's "upscaled" download): centre 120 px from both edges, about 48 px wide.
// So the star is found on each picture: every centre 90..130 px from the right and bottom edges is tried and the one where the star's
// inside is brightest against the ring around it wins. The radius follows the picture's size between those two anchors (25.8 px from
// centre to tip at 1K; the 2K star is not twice as big). (A shape measured on 18 real pictures instead of this formula was tried and
// not kept: what limits the result is the guess of the background under the star, not the shape.)
const RADIUS_1K = 25.8, RADIUS_2K = 25.0, CURVE = 0.66, MIN_SIDE = 400, NEAR_MIN = 90, NEAR_MAX = 130, CORE = 0.98, MIN_SCORE = 12;

// Star radius (centre to tip, px) for a picture: 25.8 up to 1K-ish sizes, 25.0 at 2K, linear between, flat beyond.
export function sparkleRadius(width, height) {
  const side = Math.min(width, height), t = Math.max(0, Math.min(1, (side - 1100) / (2048 - 1100)));
  return RADIUS_1K + (RADIUS_2K - RADIUS_1K) * t;
}

// How much of each pixel the star covers (0 to 1, soft at the edge); (cx, cy) is its centre, r its radius. Without a centre: the usual
// 1K place (101 px from the right and bottom).
export function sparkleCover(width, height, cx = width - 101, cy = height - 101, r = sparkleRadius(width, height)) {
  const x0 = Math.max(0, Math.floor(cx - r - 4)), x1 = Math.min(width - 1, Math.ceil(cx + r + 4));
  const y0 = Math.max(0, Math.floor(cy - r - 4)), y1 = Math.min(height - 1, Math.ceil(cy + r + 4));
  const cover = new Float32Array(width * height);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const f = Math.pow(Math.abs(x + 0.5 - cx) / r, CURVE) + Math.pow(Math.abs(y + 0.5 - cy) / r, CURVE); // below 1 inside
    cover[y * width + x] = Math.max(0, Math.min(1, ((1 - f) * r * 0.45) / 1.2 + 0.5));
  }
  return { cover, box: [x0, y0, x1, y1] };
}

// Where the star really is: the centre (90..130 px from the right and bottom edges) at which its inside is brightest against a ring
// just outside it. Offsets of "inside" and "ring" pixels are taken once from a star centred in a small local picture.
function findStar(image) {
  const { width: W, height: H, data } = image;
  const r = sparkleRadius(W, H), size = Math.ceil(r * 2 + 24), mid = Math.floor(size / 2);
  const { cover } = sparkleCover(size, size, mid, mid, r);
  const inner = [], outer = [];
  for (let y = 4; y < size - 4; y++) for (let x = 4; x < size - 4; x++) {
    const c = cover[y * size + x];
    if (c >= CORE) inner.push([x - mid, y - mid]);
    else if (c < 0.02) {
      let near = false;
      for (let dy = -4; dy <= 4 && !near; dy++) for (let dx = -4; dx <= 4; dx++) if (cover[(y + dy) * size + x + dx] >= 0.5) { near = true; break; }
      if (near) outer.push([x - mid, y - mid]);
    }
  }
  const lum = new Float32Array(W * H);
  const x0 = Math.max(0, W - NEAR_MAX - 40), y0 = Math.max(0, H - NEAR_MAX - 40);
  for (let y = y0; y < H; y++) for (let x = x0; x < W; x++) { const i = (y * W + x) * 4; lum[y * W + x] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; }
  let best = { right: 0, bottom: 0, score: -1e9 };
  for (let bottom = NEAR_MIN; bottom <= NEAR_MAX; bottom++) for (let right = NEAR_MIN; right <= NEAR_MAX; right++) {
    const cx = W - right, cy = H - bottom;
    let a = 0, b = 0;
    for (const [x, y] of inner) a += lum[(cy + y) * W + cx + x];
    for (const [x, y] of outer) b += lum[(cy + y) * W + cx + x];
    const score = a / inner.length - b / outer.length;
    if (score > best.score) best = { right, bottom, score };
  }
  return { ...best, r };
}

// Returns { applied, alpha } and changes image.data in place when the star was there.
export function removeSparkle(image) {
  const { width: W, height: H, data } = image;
  if (Math.min(W, H) < MIN_SIDE) return { applied: false, alpha: 0 };
  if (W < NEAR_MAX + 60 || H < NEAR_MAX + 60) return { applied: false, alpha: 0 };
  const found = findStar(image);
  // The real star is clearly brighter inside than around it, and inside the search window; a best match on the window's edge, or a
  // weak one, is something else (a bright object, a gradient).
  if (found.right <= NEAR_MIN || found.right >= NEAR_MAX || found.bottom <= NEAR_MIN || found.bottom >= NEAR_MAX || found.score < MIN_SCORE) return { applied: false, alpha: 0 };
  const { cover, box: [x0, y0, x1, y1] } = sparkleCover(W, H, W - found.right, H - found.bottom, found.r);
  const at = (x, y) => (y * W + x) * 4;
  const inside = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (cover[y * W + x] > 0.02) inside.push([x, y]);
  // Smooth background under the star: start from the mean of the ring around it, then diffuse from the ring inwards.
  const bg = new Float32Array(W * H * 3);
  const ring = [0, 0, 0]; let n = 0;
  for (let y = y0 - 1; y <= y1 + 1; y++) for (let x = x0 - 1; x <= x1 + 1; x++) {
    for (let c = 0; c < 3; c++) bg[(y * W + x) * 3 + c] = data[at(x, y) + c];
    if (cover[y * W + x] <= 0.02) { for (let c = 0; c < 3; c++) ring[c] += data[at(x, y) + c]; n++; }
  }
  for (const [x, y] of inside) for (let c = 0; c < 3; c++) bg[(y * W + x) * 3 + c] = ring[c] / n;
  for (let pass = 0; pass < 500; pass++) for (const [x, y] of inside) for (let c = 0; c < 3; c++) {
    const i = (y * W + x) * 3 + c;
    bg[i] = (bg[i - W * 3] + bg[i + W * 3] + bg[i - 3] + bg[i + 3]) / 4;
  }
  // Strength: the median lift of the pixels the star fully covers. A star that is there lifts nearly all of them.
  const lifts = []; let lifted = 0, tested = 0;
  for (const [x, y] of inside) {
    if (cover[y * W + x] < CORE) continue;
    for (let c = 0; c < 3; c++) {
      const b = bg[(y * W + x) * 3 + c], v = data[at(x, y) + c];
      if (255 - b < 30) continue;
      lifts.push((v - b) / (255 - b)); tested++; if (v > b) lifted++;
    }
  }
  if (tested < 100 || lifted / tested < 0.9) return { applied: false, alpha: 0 };
  lifts.sort((a, b) => a - b);
  const alpha = lifts[lifts.length >> 1];
  if (alpha < 0.1 || alpha > 0.8) return { applied: false, alpha };
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  for (const [x, y] of inside) {
    const a = alpha * cover[y * W + x], i = at(x, y);
    for (let c = 0; c < 3; c++) data[i + c] = clamp((data[i + c] - 255 * a) / (1 - a));
  }
  // The edge of the star is where the measured shape is soft: a pixel only partly covered, whose strength is the least certain. Those
  // pixels take the mean of the clean pixels around them (inside and outside), so no faint outline is left.
  const edge = (x, y) => cover[y * W + x] > 0 && cover[y * W + x] < 0.99;
  const before = Uint8Array.from(data);
  for (const [x, y] of inside) {
    if (!edge(x, y)) continue;
    const t = [0, 0, 0]; let m = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H || edge(xx, yy)) continue;
      const j = at(xx, yy); t[0] += before[j]; t[1] += before[j + 1]; t[2] += before[j + 2]; m++;
    }
    if (!m) continue;
    const i = at(x, y);
    for (let c = 0; c < 3; c++) data[i + c] = clamp(before[i + c] * 0.2 + (t[c] / m) * 0.8);
  }
  return { applied: true, alpha, score: found.score, right: found.right, bottom: found.bottom };
}

// Reads a PNG or JPEG file into RGBA pixels.
export const decodeImage = (buf) => (isJpeg(buf) ? decodeJpeg(buf) : decodePng(buf));

// file (png|jpg) -> out (png). A picture without the star is returned unchanged in its pixels (written as PNG); the input file is never touched.
export function unsparkleFile(file, out) {
  const buf = readFileSync(file), picture = decodeImage(buf);
  const result = removeSparkle(picture);
  // A PNG without the star is copied byte for byte; a JPEG is converted (its pixels, not re-compressed).
  writeFileSync(out, !result.applied && !isJpeg(buf) ? buf : encodePng(picture));
  return { applied: result.applied, alpha: Number(result.alpha.toFixed(3)), ...(result.applied ? { right: result.right, bottom: result.bottom } : {}) };
}
