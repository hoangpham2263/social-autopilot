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
const RADIUS_1K = 25.8, RADIUS_2K = 25.0, CURVE = 0.66, MIN_SIDE = 400, NEAR_MIN = 90, NEAR_MAX = 130, CORE = 0.98, MIN_SCORE = 20, EDGE_DIST = 2.5, ANCHOR_1K = 102, ANCHOR_2K = 120, ALPHA_LOW = 0.25, ALPHA_HIGH = 0.36, ALPHA_DEFAULT = 0.30;

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

// Where the flow star sits on a picture of this size: the centre is this many px from the right and bottom edges (102 at 1K, 120 at 2K, linear between).
export function sparkleAnchor(width, height) {
  const side = Math.min(width, height), t = Math.max(0, Math.min(1, (side - 1100) / (2048 - 1100)));
  return Math.round(ANCHOR_1K + (ANCHOR_2K - ANCHOR_1K) * t);
}

// The star's outline as sample points: for each pixel on its edge (cover about 0.5) the offset from the centre and the unit normal
// pointing into the star, taken once from a star centred in a small local picture.
function outline(r) {
  const size = Math.ceil(r * 2 + 24), mid = size >> 1, { cover } = sparkleCover(size, size, mid, mid, r), pts = [];
  for (let y = 2; y < size - 2; y++) for (let x = 2; x < size - 2; x++) {
    const c = cover[y * size + x];
    if (c < 0.3 || c > 0.7) continue;
    const gx = cover[y * size + x + 1] - cover[y * size + x - 1], gy = cover[(y + 1) * size + x] - cover[(y - 1) * size + x], g = Math.hypot(gx, gy);
    if (g >= 0.05) pts.push([x - mid, y - mid, gx / g, gy / g]);
  }
  return pts;
}

// How well a star of radius r at (cx, cy) fits: the MEDIAN, over its outline, of (luminance just inside - luminance just outside). The
// veil makes a step along the whole edge; a median over ~110 outline points does not care about a flower or a bright object touching
// the outline on one side, and a white background (where the veil adds little) still leaves the step on the non-white stretches.
function edgeScore(lum, W, pts, cx, cy) {
  const cs = new Float32Array(pts.length);
  for (let k = 0; k < pts.length; k++) {
    const [x, y, nx, ny] = pts[k];
    cs[k] = lum[Math.round(cy + y + EDGE_DIST * ny) * W + Math.round(cx + x + EDGE_DIST * nx)] - lum[Math.round(cy + y - EDGE_DIST * ny) * W + Math.round(cx + x - EDGE_DIST * nx)];
  }
  cs.sort();
  return cs[cs.length >> 1];
}

const luminance = (image, x0, y0) => {
  const { width: W, height: H, data } = image, lum = new Float32Array(W * H);
  for (let y = y0; y < H; y++) for (let x = x0; x < W; x++) { const i = (y * W + x) * 4; lum[y * W + x] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; }
  return lum;
};

// Where the star really is: the centre (90..130 px from the right and bottom edges) with the best edge fit; also the best fit within
// +-3 px of the anchor for the size (used when the whole-window search is inconclusive).
function findStar(image) {
  const { width: W, height: H } = image, r = sparkleRadius(W, H), pts = outline(r), anchor = sparkleAnchor(W, H);
  const lum = luminance(image, Math.max(0, W - NEAR_MAX - 40), Math.max(0, H - NEAR_MAX - 40));
  let best = { right: 0, bottom: 0, score: -1e9 }, near = { right: anchor, bottom: anchor, score: -1e9 };
  for (let bottom = NEAR_MIN; bottom <= NEAR_MAX; bottom++) for (let right = NEAR_MIN; right <= NEAR_MAX; right++) {
    const score = edgeScore(lum, W, pts, W - right, H - bottom);
    if (score > best.score) best = { right, bottom, score };
    if (Math.abs(right - anchor) <= 3 && Math.abs(bottom - anchor) <= 3 && score > near.score) near = { right, bottom, score };
  }
  return { ...best, r, near, pts, lum };
}

// Fine position: within +-2 px of a first guess, the centre where the star's inside is brightest on average against the ring around it
// (less jumpy than the median edge step, which is what finds the star in the first place).
function refine(image, lum, r, guess) {
  const { width: W, height: H } = image, size = Math.ceil(r * 2 + 24), mid = size >> 1, { cover } = sparkleCover(size, size, mid, mid, r), inner = [], outer = [];
  for (let y = 4; y < size - 4; y++) for (let x = 4; x < size - 4; x++) {
    const c = cover[y * size + x];
    if (c >= CORE) inner.push([x - mid, y - mid]);
    else if (c < 0.02) {
      let near = false;
      for (let dy = -4; dy <= 4 && !near; dy++) for (let dx = -4; dx <= 4; dx++) if (cover[(y + dy) * size + x + dx] >= 0.5) { near = true; break; }
      if (near) outer.push([x - mid, y - mid]);
    }
  }
  let best = { ...guess, mean: -1e9 };
  for (let bottom = guess.bottom - 2; bottom <= guess.bottom + 2; bottom++) for (let right = guess.right - 2; right <= guess.right + 2; right++) {
    const cx = W - right, cy = H - bottom;
    let a = 0, b = 0;
    for (const [x, y] of inner) a += lum[(cy + y) * W + cx + x];
    for (const [x, y] of outer) b += lum[(cy + y) * W + cx + x];
    const mean = a / inner.length - b / outer.length;
    if (mean > best.mean) best = { right, bottom, mean };
  }
  return { right: best.right, bottom: best.bottom, score: guess.score };
}

// Strength from the outline: for each outline point a = (inside - outside) / (255 - outside), only where the outside is not nearly white
// (there the veil adds almost nothing and the ratio is noise); the median of those.
function edgeAlpha(lum, W, pts, cx, cy) {
  const as = [];
  for (const [x, y, nx, ny] of pts) {
    const lin = lum[Math.round(cy + y + EDGE_DIST * ny) * W + Math.round(cx + x + EDGE_DIST * nx)], lout = lum[Math.round(cy + y - EDGE_DIST * ny) * W + Math.round(cx + x - EDGE_DIST * nx)];
    if (255 - lout >= 40) as.push((lin - lout) / (255 - lout));
  }
  if (as.length < 20) return null;
  as.sort((a, b) => a - b);
  return as[as.length >> 1];
}

// Strength from the inside: the median lift of the pixels the star fully covers over a smooth guess of the background under it (the
// ring's mean, diffused inwards); null when the star does not lift nearly all of them.
function interiorAlpha(image, cover, inside, [x0, y0, x1, y1]) {
  const { width: W, data } = image, at = (x, y) => (y * W + x) * 4;
  const bg = new Float32Array(W * image.height * 3), ring = [0, 0, 0]; let n = 0;
  for (let y = y0 - 1; y <= y1 + 1; y++) for (let x = x0 - 1; x <= x1 + 1; x++) {
    for (let c = 0; c < 3; c++) bg[(y * W + x) * 3 + c] = data[at(x, y) + c];
    if (cover[y * W + x] <= 0.02) { for (let c = 0; c < 3; c++) ring[c] += data[at(x, y) + c]; n++; }
  }
  for (const [x, y] of inside) for (let c = 0; c < 3; c++) bg[(y * W + x) * 3 + c] = ring[c] / n;
  for (let pass = 0; pass < 500; pass++) for (const [x, y] of inside) for (let c = 0; c < 3; c++) {
    const i = (y * W + x) * 3 + c;
    bg[i] = (bg[i - W * 3] + bg[i + W * 3] + bg[i - 3] + bg[i + 3]) / 4;
  }
  const lifts = []; let lifted = 0, tested = 0;
  for (const [x, y] of inside) {
    if (cover[y * W + x] < CORE) continue;
    for (let c = 0; c < 3; c++) {
      const b = bg[(y * W + x) * 3 + c], v = data[at(x, y) + c];
      if (255 - b < 30) continue;
      lifts.push((v - b) / (255 - b)); tested++; if (v > b) lifted++;
    }
  }
  if (tested < 100 || lifted / tested < 0.9) return null;
  lifts.sort((p, q) => p - q);
  return lifts[lifts.length >> 1];
}

// Returns { applied, alpha, method } and changes image.data in place when the star was there. Without options a picture that has no
// star is left as it is. With { assumePresent: true } (Flow pictures always carry the star) the star is taken off at the anchor
// position, with a clamped strength, even when the contrast test is inconclusive (a bright, busy corner).
export function removeSparkle(image, { assumePresent = false } = {}) {
  const { width: W, height: H, data } = image;
  if (Math.min(W, H) < MIN_SIDE) return { applied: false, alpha: 0 };
  if (W < NEAR_MAX + 60 || H < NEAR_MAX + 60) return { applied: false, alpha: 0 };
  const found = findStar(image);
  // The real star has a clear step along its whole edge and sits inside the search window; a best match on the window's edge or a
  // weak one is something else (a bright object, a gradient).
  const clear = found.right > NEAR_MIN && found.right < NEAR_MAX && found.bottom > NEAR_MIN && found.bottom < NEAR_MAX && found.score >= MIN_SCORE;
  if (!clear && !assumePresent) return { applied: false, alpha: 0 };
  const method = clear ? "detected" : "anchor";
  const pos = refine(image, found.lum, found.r, clear ? found : found.near);
  const { cover, box: [x0, y0, x1, y1] } = sparkleCover(W, H, W - pos.right, H - pos.bottom, found.r);
  const at = (x, y) => (y * W + x) * 4;
  const inside = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (cover[y * W + x] > 0.02) inside.push([x, y]);
  const ia = interiorAlpha(image, cover, inside, [x0, y0, x1, y1]), ea = edgeAlpha(found.lum, W, found.pts, W - pos.right, H - pos.bottom);
  const plausible = (v, lo, hi) => v !== null && v >= lo && v <= hi;
  let alpha;
  if (clear) {
    // The star shows clearly: take the measured strength (any plausible one), with or without the Flow assumption.
    if (!plausible(ia, 0.1, 0.8) && !plausible(ea, 0.1, 0.8)) { if (!assumePresent) return { applied: false, alpha: 0 }; alpha = ALPHA_DEFAULT; }
    else alpha = plausible(ia, 0.1, 0.8) ? ia : ea;
  } else {
    // Only reached with assumePresent (the star is there but does not show): take the measured strength when it is in the range seen
    // on real Flow pictures, else the middle of that range.
    alpha = plausible(ia, ALPHA_LOW, ALPHA_HIGH) ? ia : plausible(ea, ALPHA_LOW, ALPHA_HIGH) ? ea : ALPHA_DEFAULT;
  }
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  for (const [x, y] of inside) {
    const a = alpha * cover[y * W + x], i = at(x, y);
    for (let c = 0; c < 3; c++) data[i + c] = clamp((data[i + c] - 255 * a) / (1 - a));
  }
  // (A pixel that is 255 in the source stays 255 by the formula, which is right: the background there was at least that bright.)
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
  return { applied: true, alpha, method, interior: ia, edgeAlpha: ea, score: found.score, right: pos.right, bottom: pos.bottom };
}

// Reads a PNG or JPEG file into RGBA pixels.
export const decodeImage = (buf) => (isJpeg(buf) ? decodeJpeg(buf) : decodePng(buf));

// file (png|jpg) -> out (png). A picture without the star is returned unchanged in its pixels (written as PNG); the input file is never touched.
export function unsparkleFile(file, out, options = {}) {
  const buf = readFileSync(file), picture = decodeImage(buf);
  const result = removeSparkle(picture, options);
  // A PNG without the star is copied byte for byte; a JPEG is converted (its pixels, not re-compressed).
  writeFileSync(out, !result.applied && !isJpeg(buf) ? buf : encodePng(picture));
  return { applied: result.applied, alpha: Number(result.alpha.toFixed(3)), ...(result.applied ? { method: result.method, right: result.right, bottom: result.bottom } : {}) };
}
