// Removes the marks Google puts in the bottom right corner of the pictures its web AI makes (Flow, Gemini), in plain Node:
//  - the sparkle: one white veil of fixed shape (a four-point star with curved sides). It is undone, not painted over:
//    shown = bg * (1 - a) + 255 * a, hence bg = (shown - 255 a) / (1 - a), so the detail under the star comes back.
//  - the "AI" pill: a translucent grey rounded label with dark letters. The letters hide the picture, so the pill is
//    inpainted (smooth fill from the ring around it plus matching grain).
// WHERE the star is depends on the download: the older Flow files had it at a fixed ~101 px from the right and bottom edges,
// the newer ones (measured on 40 pictures of 382 x 512 up to 1376 x 768) put its centre at 1/6 of the SHORTER side from both edges
// with a radius of about 3.4 % of that side, so every size has its own pixel position. The star (and the pill, at about 6 % of the
// shorter side from the edges) is therefore searched per picture: every candidate place is scored by the step along its outline
// (inside minus outside) and the best one wins. A picture without a mark is left as it is (applied:false), unless the caller
// knows the picture comes from Flow ({assumePresent:true}); then a weak match is still taken when the lift inside the star is plausible.
// Social Autopilot copy of Product Review src/image/unsparkle.mjs (tools do not share image code), plus JPEG input (Flow downloads are JPEG).
// CLI: node scripts/image-unsparkle.mjs --image <png|jpg> --out <png> [--assume-present]
import { readFileSync, writeFileSync } from "node:fs";
import { decodePng, encodePng } from "./png.mjs";
import { decodeJpeg, isJpeg } from "./jpeg.mjs";

const MIN_SIDE = 300, LEGACY_CENTER = 101, LEGACY_RADIUS = 25.8, CURVE = 0.66, CORE = 0.98, EDGE_DIST = 2.5;
const STAR_SCORE = 12, PILL_SCORE = 14;           // 15th percentile of the outline step
const ALPHA_LOW = 0.2, ALPHA_HIGH = 0.4, ALPHA_DEFAULT = 0.3, BAND_LOW = 0.22, BAND_HIGH = 0.38, AGREE = 0.06;
const STAR_FRACTION = 1 / 6, STAR_RADIUS_FRACTIONS = [0.030, 0.032, 0.034, 0.036, 0.038, 0.040];
const PILL = { w: 0.0536, h: 0.039, right: 0.0625, bottom: 0.0558 };   // fractions of the shorter side (centre from the edges)

// How much of each pixel the star covers (0 to 1, soft at the edge); (cx, cy) is its centre, r its radius. Without a centre: the
// older 1K place (101 px from the right and bottom).
export function sparkleCover(width, height, cx = width - LEGACY_CENTER, cy = height - LEGACY_CENTER, r = LEGACY_RADIUS) {
  const x0 = Math.max(0, Math.floor(cx - r - 4)), x1 = Math.min(width - 1, Math.ceil(cx + r + 4));
  const y0 = Math.max(0, Math.floor(cy - r - 4)), y1 = Math.min(height - 1, Math.ceil(cy + r + 4));
  const cover = new Float32Array(width * height);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const f = Math.pow(Math.abs(x + 0.5 - cx) / r, CURVE) + Math.pow(Math.abs(y + 0.5 - cy) / r, CURVE); // below 1 inside
    cover[y * width + x] = Math.max(0, Math.min(1, ((1 - f) * r * 0.45) / 1.2 + 0.5));
  }
  return { cover, box: [x0, y0, x1, y1] };
}

// How much of each pixel the "AI" pill covers (a stadium: rectangle with fully rounded ends), centre (cx, cy), size w x h.
export function pillCover(width, height, cx, cy, w, h) {
  const x0 = Math.max(0, Math.floor(cx - w / 2 - 3)), x1 = Math.min(width - 1, Math.ceil(cx + w / 2 + 3));
  const y0 = Math.max(0, Math.floor(cy - h / 2 - 3)), y1 = Math.min(height - 1, Math.ceil(cy + h / 2 + 3));
  const cover = new Float32Array(width * height), r = h / 2, half = w / 2 - r;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = Math.abs(x + 0.5 - cx), dx = Math.max(0, px - half), d = Math.hypot(dx, y + 0.5 - cy) - r; // negative inside
    cover[y * width + x] = Math.max(0, Math.min(1, 0.5 - d));
  }
  return { cover, box: [x0, y0, x1, y1] };
}

// The shape's outline as sample points (offset from the centre and the unit normal pointing inwards), from its own cover map.
function outlineOf(make, size) {
  const mid = size >> 1, { cover } = make(size, mid), pts = [];
  for (let y = 2; y < size - 2; y++) for (let x = 2; x < size - 2; x++) {
    const c = cover[y * size + x];
    if (c < 0.3 || c > 0.7) continue;
    const gx = cover[y * size + x + 1] - cover[y * size + x - 1], gy = cover[(y + 1) * size + x] - cover[(y - 1) * size + x], g = Math.hypot(gx, gy);
    if (g >= 0.05) pts.push([x - mid, y - mid, gx / g, gy / g]);
  }
  return pts;
}
const starOutline = (r) => outlineOf((size, mid) => sparkleCover(size, size, mid, mid, r), Math.ceil(r * 2 + 24));
const pillOutline = (w, h) => outlineOf((size, mid) => pillCover(size, size, mid, mid, w, h), Math.ceil(w + 24));

const luminance = (image, x0, y0) => {
  const { width: W, height: H, data } = image, lum = new Float32Array(W * H);
  for (let y = y0; y < H; y++) for (let x = x0; x < W; x++) { const i = (y * W + x) * 4; lum[y * W + x] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; }
  return lum;
};

// Fit of a shape at (cx, cy): the 15th percentile, over its outline, of (luminance just inside - luminance just outside) times sign.
// A veil makes a step of one sign along the whole edge; a natural edge of the picture does not, so a low percentile (not the median)
// keeps a bright object touching the outline from passing for a mark. sign +1 for the star (it lifts), +-1 for the pill (grey).
function fit(lum, W, pts, cx, cy, sign) {
  const cs = new Float32Array(pts.length);
  for (let k = 0; k < pts.length; k++) {
    const [x, y, nx, ny] = pts[k];
    cs[k] = sign * (lum[Math.round(cy + y + EDGE_DIST * ny) * W + Math.round(cx + x + EDGE_DIST * nx)] - lum[Math.round(cy + y - EDGE_DIST * ny) * W + Math.round(cx + x - EDGE_DIST * nx)]);
  }
  cs.sort();
  return cs[Math.floor(cs.length * 0.15)];
}

// Best star: scaled family (centre S/6 from the edges, +-1.5 % of S, radius 3.0..4.0 % of S) and the older fixed 101 px family.
function findStar(image, lum) {
  const { width: W, height: H } = image, S = Math.min(W, H);
  let best = { score: -1e9 }, scaled = { score: -1e9 };
  const mid0 = Math.round(S * STAR_FRACTION);
  const consider = (pts, r, cx, cy, family) => { const score = fit(lum, W, pts, cx, cy, 1); if (score > best.score) best = { score, r, cx, cy, family }; if (family === "scaled" && Math.abs(W - cx - mid0) <= 4 && Math.abs(H - cy - mid0) <= 4 && score > scaled.score) scaled = { score, r, cx, cy, family }; };
  const span = Math.max(3, Math.round(S * 0.015)), mid = Math.round(S * STAR_FRACTION);
  for (const k of STAR_RADIUS_FRACTIONS) {
    const r = k * S, pts = starOutline(r);
    for (let b = mid - span; b <= mid + span; b++) for (let rt = mid - span; rt <= mid + span; rt++) consider(pts, r, W - rt, H - b, "scaled");
  }
  if (S >= 600) {
    const pts = starOutline(LEGACY_RADIUS);
    for (let b = 90; b <= 130; b++) for (let rt = 90; rt <= 130; rt++) if (Math.abs(b - mid) > span + 2 || Math.abs(rt - mid) > span + 2) consider(pts, LEGACY_RADIUS, W - rt, H - b, "legacy");
  }
  return { ...best, scaled };
}

// Best "AI" pill: centre near (PILL.right, PILL.bottom) of S from the edges (+-2 % of S), size 0.85..1.2 times the usual.
function findPill(image, lum) {
  const { width: W, height: H } = image, S = Math.min(W, H);
  let best = { score: -1e9 };
  const span = Math.max(3, Math.round(S * 0.02));
  for (const k of [0.85, 1, 1.2]) {
    const w = PILL.w * S * k, h = PILL.h * S * k, pts = pillOutline(w, h);
    const rt0 = Math.round(PILL.right * S), b0 = Math.round(PILL.bottom * S);
    for (let b = b0 - span; b <= b0 + span; b++) for (let rt = rt0 - span; rt <= rt0 + span; rt++) for (const sign of [1, -1]) {
      const score = fit(lum, W, pts, W - rt, H - b, sign);
      if (score > best.score) best = { score, w, h, cx: W - rt, cy: H - b, sign };
    }
  }
  return best;
}

// Fine position of a star: within +-2 px, the centre where its inside is brightest on average against the ring around it.
function refineStar(lum, W, r, guess) {
  const size = Math.ceil(r * 2 + 24), mid = size >> 1, { cover } = sparkleCover(size, size, mid, mid, r), inner = [], outer = [];
  for (let y = 4; y < size - 4; y++) for (let x = 4; x < size - 4; x++) {
    const c = cover[y * size + x];
    if (c >= CORE) inner.push([x - mid, y - mid]);
    else if (c < 0.02) {
      let near = false;
      for (let dy = -4; dy <= 4 && !near; dy++) for (let dx = -4; dx <= 4; dx++) if (cover[(y + dy) * size + x + dx] >= 0.5) { near = true; break; }
      if (near) outer.push([x - mid, y - mid]);
    }
  }
  let best = { cx: guess.cx, cy: guess.cy, mean: -1e9 };
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const cx = guess.cx + dx, cy = guess.cy + dy;
    let a = 0, b = 0;
    for (const [x, y] of inner) a += lum[(cy + y) * W + cx + x];
    for (const [x, y] of outer) b += lum[(cy + y) * W + cx + x];
    const mean = a / inner.length - b / outer.length;
    if (mean > best.mean) best = { cx, cy, mean };
  }
  return best;
}

// Strength from the star's outline: a = (inside - outside) / (255 - outside), only where the outside is not nearly white; the median.
function edgeAlpha(lum, W, pts, cx, cy, flatOnly = false) {
  const as = [], L = (x, y) => lum[Math.round(y) * W + Math.round(x)];
  for (const [x, y, nx, ny] of pts) {
    if (flatOnly && (Math.abs(L(cx + x - EDGE_DIST * nx, cy + y - EDGE_DIST * ny) - L(cx + x - 7 * nx, cy + y - 7 * ny)) > 10 || Math.abs(L(cx + x + EDGE_DIST * nx, cy + y + EDGE_DIST * ny) - L(cx + x + 7 * nx, cy + y + 7 * ny)) > 10)) continue;
    const lin = L(cx + x + EDGE_DIST * nx, cy + y + EDGE_DIST * ny), lout = L(cx + x - EDGE_DIST * nx, cy + y - EDGE_DIST * ny);
    if (255 - lout >= 40) as.push((lin - lout) / (255 - lout));
  }
  if (as.length < (flatOnly ? 12 : 20)) return null;
  as.sort((a, b) => a - b);
  return as[as.length >> 1];
}

// A smooth guess of the background under a shape: the ring's mean, diffused inwards.
function smoothBackground(image, cover, inside, [x0, y0, x1, y1]) {
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
  return bg;
}

// Strength from the inside: the median lift of the fully covered pixels over the smooth background; also how many were lifted.
function interiorAlpha(image, cover, inside, bg) {
  const { width: W, data } = image, at = (x, y) => (y * W + x) * 4;
  const lifts = []; let lifted = 0, tested = 0;
  for (const [x, y] of inside) {
    if (cover[y * W + x] < CORE) continue;
    for (let c = 0; c < 3; c++) {
      const b = bg[(y * W + x) * 3 + c], v = data[at(x, y) + c];
      if (255 - b < 30) continue;
      lifts.push((v - b) / (255 - b)); tested++; if (v > b) lifted++;
    }
  }
  if (tested < 100) return { alpha: null, share: 0 };
  lifts.sort((p, q) => p - q);
  return { alpha: lifts[lifts.length >> 1], share: lifted / tested };
}

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const insideOf = (cover, [x0, y0, x1, y1], W) => { const inside = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (cover[y * W + x] > 0.02) inside.push([x, y]); return inside; };

// ----- repair: the mark is fitted to the picture (shape, place to a fraction of a pixel, edge softness, strength), then undone -----
// The star as Flow draws it, measured on clean Flow corners: its radius every 5 degrees from a tip (0) to the middle of a side (45),
// as a fraction of r. Blunter at the very tip and slimmer at the sides than the superellipse that finds it. r is 3.6 % of the shorter
// side in the newer files and 26.1 px in the older ones; the strength is 0.29..0.30 in both.
const STAR_RHO = [0.957, 0.7838, 0.6769, 0.6173, 0.566, 0.54, 0.521, 0.507, 0.4876, 0.4925];
const STAR_R = 0.036, LEGACY_R = 26.1, SUB = 6, FREE_GAIN = 0.88, UNSTABLE = 0.7;
const starShape = (P) => (X, Y) => {
  const dx = X - P.cx, dy = Y - P.cy; let deg = Math.atan2(Math.abs(dy), Math.abs(dx)) * 57.29577951308232; if (deg > 45) deg = 90 - deg;
  const f = deg / 5, i = Math.min(8, Math.floor(f)), t = f - i;
  return (STAR_RHO[i] * (1 - t) + STAR_RHO[i + 1] * t) * P.r - Math.hypot(dx, dy);
};
const pillShape = (P) => (X, Y) => { const rr = P.h / 2; return rr - Math.hypot(Math.max(0, Math.abs(X - P.cx) - (P.w / 2 - rr)), Y - P.cy); };
const STAR = { shape: starShape, thin: true, reach: (P) => [P.r, P.r] };
const PILLS = { shape: pillShape, thin: false, reach: (P) => [P.w / 2, P.h / 2] };
const boxAround = (kind, P, W, H, pad) => { const [rx, ry] = kind.reach(P); return [Math.max(1, Math.floor(P.cx - rx - pad)), Math.max(1, Math.floor(P.cy - ry - pad)), Math.min(W - 2, Math.ceil(P.cx + rx + pad)), Math.min(H - 2, Math.ceil(P.cy + ry + pad))]; };

// How much of each pixel of box the mark covers: the share of SUB x SUB points spread over s px that fall inside the shape (a box
// filtered edge, as the drawn mark is anti-aliased). The shape gives a signed distance, positive inside; only its sign is trusted
// near the edge and along the axes of the star, where its tips are thinner than a pixel.
function coverage(kind, P, box, s = P.s) {
  const [x0, y0, x1, y1] = box, w = x1 - x0 + 1, out = new Float32Array(w * (y1 - y0 + 1)), inside = kind.shape(P), reach = s + 2;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const X = x + 0.5, Y = y + 0.5, d = inside(X, Y), j = (y - y0) * w + x - x0;
    if (d < -reach) continue;
    if (d > reach * 1.6 && !(kind.thin && (Math.abs(X - P.cx) < reach + 1 || Math.abs(Y - P.cy) < reach + 1))) { out[j] = 1; continue; }
    let n = 0;
    for (let b = 0; b < SUB; b++) for (let a = 0; a < SUB; a++) if (inside(X + ((a + 0.5) / SUB - 0.5) * s, Y + ((b + 0.5) / SUB - 0.5) * s) > 0) n++;
    out[j] = n / (SUB * SUB);
  }
  return out;
}

// The star as Flow draws it, as a full-size cover map (for tests): centre (cx, cy), radius r, edge softness s px.
export function flowStarCover(width, height, cx, cy, r, s = 1.2) {
  const P = { cx, cy, r }, box = boxAround(STAR, P, width, height, 4), c = coverage(STAR, P, box, s), cover = new Float32Array(width * height), w = box[2] - box[0] + 1;
  for (let y = box[1]; y <= box[3]; y++) for (let x = box[0]; x <= box[2]; x++) cover[y * width + x] = c[(y - box[1]) * w + x - box[0]];
  return { cover, box };
}

// The fit: the mark (strength P.a, colour P.m) taken off with these parameters must leave no step along its edge. Score = mean jump of
// the unveiled luminance between neighbouring pixels across the edge; the pairs and their weights come from a softened copy of the
// starting shape, so they stay put while the parameters move. Coordinate descent with halving steps, each parameter within lim.
function fitMark(lum, W, H, kind, start, free, lim) {
  const box = boxAround(kind, start, W, H, 9), [x0, y0, x1, y1] = box, w = x1 - x0 + 1, h = y1 - y0 + 1, soft = coverage(kind, start, box, 2.5), pairs = [];
  for (const [dx, dy] of [[1, 0], [0, 1], [2, 0], [0, 2], [1, 1], [1, -1]]) for (let y = 1; y < h - 2; y++) for (let x = 1; x < w - 2; x++) {
    const i = y * w + x, j = (y + dy) * w + x + dx, wt = Math.abs(soft[i] - soft[j]);
    if (wt >= 1e-3) pairs.push(i, j, wt);
  }
  const L = new Float32Array(w * h), B = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) L[y * w + x] = lum[(y + y0) * W + x + x0];
  const score = (P) => {
    const c = coverage(kind, P, box);
    for (let k = 0; k < L.length; k++) { const a = P.a * c[k]; B[k] = (L[k] - P.m * a) / (1 - a); }
    let e = 0, s = 0;
    for (let k = 0; k < pairs.length; k += 3) { e += pairs[k + 2] * Math.min(Math.abs(B[pairs[k]] - B[pairs[k + 1]]), 50); s += pairs[k + 2]; }
    return s ? e / s : Infinity;
  };
  const steps = { cx: 0.5, cy: 0.5, r: 0.3, w: 0.3, h: 0.3, a: 0.01, s: 0.15, m: 3 };
  let P = { ...start }, e0 = score(P);
  for (let it = 0; it < 80 && steps.cx >= 0.04; it++) {
    let moved = false;
    for (const k of free) for (const sign of [1, -1]) {
      const v = P[k] + sign * steps[k];
      if (v < lim[k][0] || v > lim[k][1]) continue;
      const Q = { ...P, [k]: v }, e = score(Q);
      if (e < e0 - 1e-6) { P = Q; e0 = e; moved = true; }
    }
    if (!moved) for (const k in steps) steps[k] /= 2;
  }
  return { P, e: e0 };
}

// Takes the fitted mark off: shown = bg (1 - a) + m a, so bg = (shown - m a) / (1 - a), per channel. Along the edge (where the drawn
// outline and the model can differ by a fraction of a pixel, and Flow adds a faint dark rim) each pixel's own strength is then tuned
// within half the mark's strength (and down to a slight darkening) until its unveiled value sits inside the range of its neighbours;
// a pixel already inside that range keeps the model's value, so texture is not smoothed. Returns the pixels too veiled to recover.
function unveil(image, kind, P) {
  const { width: W, height: H, data } = image, box = boxAround(kind, P, W, H, 6), [x0, y0, x1, y1] = box, w = x1 - x0 + 1, h = y1 - y0 + 1;
  const c = coverage(kind, P, box), A = new Float32Array(w * h), O = new Float32Array(w * h), m = P.m;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const j = y * w + x, i = ((y + y0) * W + x + x0) * 4; A[j] = P.a * c[j]; O[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; }
  const value = (j, a) => a >= 0 ? (O[j] - m * a) / (1 - a) : O[j] / (1 + a);
  const edge = new Uint8Array(w * h), band = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    let lo = 1, hi = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const v = c[(y + dy) * w + x + dx]; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (hi - lo > 0.05) { edge[y * w + x] = 1; band.push(y * w + x); }
  }
  for (let pass = 0; pass < 3; pass++) for (const j of band) {
    const x = j % w, y = (j / w) | 0, near = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy, q = yy * w + xx;
      if ((dx || dy) && xx >= 0 && yy >= 0 && xx < w && yy < h && !(pass === 0 && edge[q])) near.push(value(q, A[q]));
    }
    if (near.length < 6) continue;
    near.sort((p, q) => p - q);
    const lo = near[Math.floor(near.length * 0.15)], hi = near[Math.floor(near.length * 0.85)], now = value(j, A[j]);
    if (now >= lo && now <= hi) continue;
    const target = now < lo ? lo : hi, up = (O[j] - target) / (m - target);
    const a = up >= 0 && target < m ? up : target > 0 ? O[j] / target - 1 : 0;
    A[j] = Math.max(Math.max(-0.08, A[j] - P.a / 2), Math.min(Math.min(P.a, A[j] + P.a / 2), a));
  }
  const lost = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const j = y * w + x, a = A[j]; if (a === 0) continue;
    const i = ((y + y0) * W + x + x0) * 4;
    if (a >= UNSTABLE) { lost.push((y + y0) * W + x + x0); continue; }
    for (let k = 0; k < 3; k++) data[i + k] = clamp(a >= 0 ? (data[i + k] - m * a) / (1 - a) : data[i + k] / (1 + a));
  }
  return lost;
}

// Exemplar inpainting (Criminisi): the hole is filled from its edge inwards, most confident and most structured spot first, each time
// with the best matching patch (sum of squared differences over its known pixels) from the clean surroundings, so lines and edges
// run on through the hole and texture stays texture (no average, no blur). Only the pixels of the hole are written.
function exemplarFill(image, hole, S) {
  const { width: W, height: H, data } = image, half = Math.max(2, Math.round(S / 300)), margin = Math.max(24, Math.round(S * 0.06));
  const todo = new Uint8Array(W * H); let left = 0, mx0 = W, my0 = H, mx1 = 0, my1 = 0;
  for (const p of hole) { if (todo[p]) continue; todo[p] = 1; left++; const x = p % W, y = (p / W) | 0; mx0 = Math.min(mx0, x); my0 = Math.min(my0, y); mx1 = Math.max(mx1, x); my1 = Math.max(my1, y); }
  if (!left) return;
  const sx0 = Math.max(half, mx0 - margin), sy0 = Math.max(half, my0 - margin), sx1 = Math.min(W - 1 - half, mx1 + margin), sy1 = Math.min(H - 1 - half, my1 + margin);
  const conf = new Float32Array(W * H).fill(1); for (const p of hole) conf[p] = 0;
  const src = [];
  for (let y = sy0; y <= sy1; y++) for (let x = sx0; x <= sx1; x++) {
    let ok = true;
    for (let dy = -half; dy <= half && ok; dy++) for (let dx = -half; dx <= half; dx++) if (todo[(y + dy) * W + x + dx]) { ok = false; break; }
    if (ok) src.push(y * W + x);
  }
  if (!src.length) return;
  const lum = (p) => 0.299 * data[p * 4] + 0.587 * data[p * 4 + 1] + 0.114 * data[p * 4 + 2], area = (2 * half + 1) ** 2;
  const fx0 = Math.max(half, mx0), fy0 = Math.max(half, my0), fx1 = Math.min(W - 1 - half, mx1), fy1 = Math.min(H - 1 - half, my1);
  for (let guard = 0; left > 0 && guard < 20000; guard++) {
    let best = -1, at = -1;
    for (let y = fy0; y <= fy1; y++) for (let x = fx0; x <= fx1; x++) {
      const p = y * W + x;
      if (!todo[p] || (todo[p - 1] && todo[p + 1] && todo[p - W] && todo[p + W])) continue;
      let cf = 0, g = 0;
      for (let dy = -half; dy <= half; dy++) for (let dx = -half; dx <= half; dx++) {
        const q = p + dy * W + dx; cf += conf[q];
        if (dx < half && dy < half && !todo[q] && !todo[q + 1] && !todo[q + W]) g = Math.max(g, Math.abs(lum(q + 1) - lum(q)) + Math.abs(lum(q + W) - lum(q)));
      }
      const priority = (cf / area) * (0.2 + g / 255);
      if (priority > best) { best = priority; at = p; }
    }
    if (at < 0) break;
    const known = [];
    for (let dy = -half; dy <= half; dy++) for (let dx = -half; dx <= half; dx++) if (!todo[at + dy * W + dx]) known.push(dy * W + dx);
    const ax = at % W, ay = (at / W) | 0;
    let from = -1, low = Infinity;
    for (const q of src) {
      let e = known.length * 0.02 * Math.hypot(q % W - ax, ((q / W) | 0) - ay);   // a slight pull to nearby patches keeps the fill local
      for (let k = 0; k < known.length && e < low; k++) {
        const a = (at + known[k]) * 4, b = (q + known[k]) * 4, d0 = data[a] - data[b], d1 = data[a + 1] - data[b + 1], d2 = data[a + 2] - data[b + 2];
        e += d0 * d0 + d1 * d1 + d2 * d2;
      }
      if (e < low) { low = e; from = q; }
    }
    let cp = 0; for (const o of known) cp += conf[at + o]; cp /= area;
    for (let dy = -half; dy <= half; dy++) for (let dx = -half; dx <= half; dx++) {
      const o = dy * W + dx, p = at + o; if (!todo[p]) continue;
      for (let k = 0; k < 3; k++) data[p * 4 + k] = data[(from + o) * 4 + k];
      todo[p] = 0; conf[p] = cp; left--;
    }
  }
}

function unveilStar(image, lum, star, assumePresent) {
  const { width: W, height: H } = image, S = Math.min(W, H);
  const clearFit = star.score >= STAR_SCORE;
  // A star that does not show (white or busy corner) is still taken at the usual place when the picture is known to come from Flow.
  const found = clearFit || !assumePresent ? star : star.scaled;
  const pos = refineStar(lum, W, found.r, found), pts = starOutline(found.r);
  const { cover, box } = sparkleCover(W, H, pos.cx, pos.cy, found.r), inside = insideOf(cover, box, W);
  const bgGuess = smoothBackground(image, cover, inside, box), ia = interiorAlpha(image, cover, inside, bgGuess), ea = edgeAlpha(lum, W, pts, pos.cx, pos.cy);
  const plausible = (v, lo, hi) => v !== null && v >= lo && v <= hi;
  const clear = clearFit && ia.share >= 0.9;
  let alpha, method = "detected";
  if (clear) {
    if (!plausible(ia.alpha, 0.1, 0.8) && !plausible(ea, 0.1, 0.8)) return null;
    alpha = plausible(ia.alpha, 0.1, 0.8) ? ia.alpha : ea;
    // Every clean Flow measurement is 0.27..0.33. An estimate outside the band is checked with the outline points that are NOT near a
    // strong edge of the picture; when that agrees with the interior one the veil really is that strong (dark scene) and is kept.
    if (alpha < BAND_LOW || alpha > BAND_HIGH) {
      const ra = edgeAlpha(lum, W, pts, pos.cx, pos.cy, true);
      if (plausible(ra, 0.1, 0.7) && plausible(ia.alpha, 0.1, 0.7) && Math.abs(ra - ia.alpha) <= AGREE) alpha = (ra + ia.alpha) / 2;
      else alpha = plausible(ra, BAND_LOW, BAND_HIGH) ? ra : ALPHA_DEFAULT;
    }
  } else if (assumePresent && plausible(ea, 0.24, 0.36)) {
    // The picture is known to come from Flow and the star only shows weakly (bright or busy corner), but the whole outline still steps by
    // the one strength Google uses (0.30): that is the proof. A corner with no step of that size has no star (Antigravity pictures, mislabelled runs).
    method = "weak";
    alpha = ia.share >= 0.75 && plausible(ia.alpha, ALPHA_LOW, ALPHA_HIGH) ? ia.alpha : plausible(ea, ALPHA_LOW, ALPHA_HIGH) ? ea : ALPHA_DEFAULT;
  } else return null;
  // The newer Flow files carry the veil at one fixed strength (0.30, measured on every one of 40 pictures, 0.28..0.33 along the outline).
  if (found.family === "scaled") alpha = plausible(ea, 0.26, 0.34) ? ea : 0.30;
  // Two fits from the found place: one held to the measured Flow star (size within 1 %, strength 0.27..0.33), one free (size within 15 %,
  // strength near the estimate above). The free one is only taken when it explains the edge clearly better (a star that is not Flow's
  // usual one); on a busy corner the held one is the safe answer, as a free fit there drifts to a fainter, smaller star and leaves a ghost.
  const legacy = found.family === "legacy", r0 = legacy ? LEGACY_R : STAR_R * S;
  const start = { cx: pos.cx, cy: pos.cy, r: r0, a: Math.max(0.27, Math.min(0.32, alpha)), s: 1.3, m: 255 };
  const place = { cx: [pos.cx - 3, pos.cx + 3], cy: [pos.cy - 3, pos.cy + 3], s: [0.6, 2.2], m: [255, 255] };
  const held = fitMark(lum, W, H, STAR, start, ["cx", "cy", "r", "a", "s"], { ...place, r: [r0 * 0.99, r0 * 1.01], a: [0.27, 0.32] });
  const free = fitMark(lum, W, H, STAR, { ...start, a: alpha }, ["cx", "cy", "r", "a", "s"], { ...place, r: [r0 * 0.85, r0 * 1.15], a: [Math.max(0.12, alpha - 0.1), Math.min(0.6, alpha + 0.1)] });
  const fitted = free.e < held.e * FREE_GAIN ? free.P : held.P;
  const lost = unveil(image, STAR, fitted);
  if (lost.length) exemplarFill(image, lost, S);
  return { applied: true, kind: "star", alpha: fitted.a, method, score: found.score, family: found.family, right: W - fitted.cx, bottom: H - fitted.cy };
}

// The pill is a grey veil (about 0.55 strength, colour about 235) with dark letters on it. The veil is fitted and undone like the star;
// the letters (darker than the veil can make any picture) and anything under a veil too strong to undo are filled by exemplar
// inpainting from the unveiled surroundings. When the veil does not fit like Flow's, the whole pill is filled that way.
// The strength and colour of the pill's veil, by least squares on its edge step: just inside = (1 - a) just outside + a m, over every
// outline point and channel. A corner of one flat colour cannot tell a from m (any pair undoes it the same there), so a stays 0.55 then.
function pillVeil(image, P) {
  const { width: W, data } = image, rr = P.h / 2, half = P.w / 2 - rr, side = 2 * half, arc = Math.PI * rr, total = 2 * side + 2 * arc;
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let k = 0; k < 400; k++) {
    let s = (k / 400) * total, px, py, nx, ny;
    if (s < side) { px = -half + s; py = -rr; nx = 0; ny = -1; }
    else if ((s -= side) < arc) { const t = -Math.PI / 2 + s / rr; px = half + rr * Math.cos(t); py = rr * Math.sin(t); nx = Math.cos(t); ny = Math.sin(t); }
    else if ((s -= arc) < side) { px = half - s; py = rr; nx = 0; ny = 1; }
    else { const t = Math.PI / 2 + (s - side) / rr; px = -half + rr * Math.cos(t); py = rr * Math.sin(t); nx = Math.cos(t); ny = Math.sin(t); }
    const ii = (Math.round(P.cy + py - 3 * ny) * W + Math.round(P.cx + px - 3 * nx)) * 4, io = (Math.round(P.cy + py + 3 * ny) * W + Math.round(P.cx + px + 3 * nx)) * 4;
    for (let c = 0; c < 3; c++) { const o = data[io + c], v = data[ii + c]; n++; sx += o; sy += v; sxx += o * o; sxy += o * v; }
  }
  // Flow's pill measures 0.52..0.58 on clean corners; a busy edge (cables, strong colour) pulls the regression off, so it is held there.
  const mo = sx / n, mi = sy / n, vo = sxx / n - mo * mo;
  const a = Math.max(0.5, Math.min(0.6, vo >= 150 ? 1 - (sxy / n - mo * mi) / vo : 0.55)), m = (mi - (1 - a) * mo) / a;
  return { a, m: m >= 200 && m <= 252 ? m : 236 };
}

function repairPill(image, lum, found) {
  const { width: W, height: H, data } = image, S = Math.min(W, H);
  const start = { cx: found.cx, cy: found.cy, w: found.w, h: found.h, s: 1.2, a: 0.55, m: 235 };
  const lim = { cx: [found.cx - 3, found.cx + 3], cy: [found.cy - 3, found.cy + 3], w: [found.w * 0.9, found.w * 1.1], h: [found.h * 0.9, found.h * 1.1], s: [0.6, 2.5] };
  let { P } = fitMark(lum, W, H, PILLS, start, ["cx", "cy", "w", "h", "s"], lim);
  Object.assign(P, pillVeil(image, P));
  if (P.a >= 0.3 && P.a <= 0.8) P = fitMark(lum, W, H, PILLS, P, ["cx", "cy", "w", "h", "s"], lim).P;
  const grown = { ...P, w: P.w + 3, h: P.h + 3 }, box = boxAround(PILLS, grown, W, H, 1), c = coverage(PILLS, grown, box, 1), bw = box[2] - box[0] + 1;
  const hole = [], before = Uint8Array.from(data);
  let veilOk = P.a >= 0.3 && P.a <= 0.75 && P.m >= 150 && P.m <= 260;
  if (veilOk) {
    // letters: a dark veil of their own, well below the grey body around them (under 0.62 of its median, measured on 14 Flow pills:
    // letters 10..112, body 127..228), grown by a pixel or two to take their anti-aliased edge
    const letter = new Uint8Array(W * H), grow = S >= 700 ? 2 : 1, inner = coverage(PILLS, { ...P, w: P.w - 4, h: P.h - 4 }, box, 1), body = [];
    const lumAt = (x, y) => { const i = (y * W + x) * 4; return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; };
    for (let y = box[1]; y <= box[3]; y++) for (let x = box[0]; x <= box[2]; x++) if (inner[(y - box[1]) * bw + x - box[0]] >= 1) body.push(lumAt(x, y));
    body.sort((p, q) => p - q);
    const floor = (body[body.length >> 1] || 0) * 0.62;
    for (let y = box[1]; y <= box[3]; y++) for (let x = box[0]; x <= box[2]; x++) if (inner[(y - box[1]) * bw + x - box[0]] >= 1 && lumAt(x, y) < floor) letter[y * W + x] = 1;
    const lost = unveil(image, PILLS, P);
    for (let y = box[1]; y <= box[3]; y++) for (let x = box[0]; x <= box[2]; x++) {
      let hit = false;
      for (let dy = -grow; dy <= grow && !hit; dy++) for (let dx = -grow; dx <= grow; dx++) if (letter[(y + dy) * W + x + dx]) { hit = true; break; }
      if (hit) hole.push(y * W + x);
    }
    hole.push(...lost);
    // Some pills also soften what lies under them; then the unveiled inside does not meet the outside. Checked along the outline (3 px
    // in against 3 px out, every channel): when they part, the unveil is dropped and the whole pill is filled instead.
    const gaps = [];
    for (let k = 0; k < 360; k++) {
      const t = (k / 360) * 2 * Math.PI, rr = P.h / 2, side = Math.sign(Math.cos(t)) || 1, nx = side * Math.abs(Math.cos(t)), ny = Math.sin(t);
      const px = P.cx + side * (P.w / 2 - rr) + rr * nx, py = P.cy + rr * ny;
      const ii = (Math.round(py - 3 * ny) * W + Math.round(px - 3 * nx)) * 4, io = (Math.round(py + 3 * ny) * W + Math.round(px + 3 * nx)) * 4;
      for (let ch = 0; ch < 3; ch++) gaps.push(data[ii + ch] - data[io + ch]);
    }
    gaps.sort((p, q) => p - q);
    const mid = gaps[gaps.length >> 1], spread = gaps[Math.floor(gaps.length * 0.75)] - gaps[Math.floor(gaps.length * 0.25)];
    if (Math.abs(mid) > 5 || spread > 17) { data.set(before); veilOk = false; hole.length = 0; }
  }
  if (!veilOk) {
    for (let y = box[1]; y <= box[3]; y++) for (let x = box[0]; x <= box[2]; x++) if (c[(y - box[1]) * bw + x - box[0]] > 0) hole.push(y * W + x);
  }
  exemplarFill(image, hole, S);
  return { applied: true, kind: "pill", alpha: veilOk ? P.a : 0, method: veilOk ? "detected" : "filled", score: found.score, right: W - P.cx, bottom: H - P.cy };
}

// Returns { applied, kind, alpha, method, score, right, bottom } and changes image.data in place when a mark was there.
// With { assumePresent: true } (the picture comes from Flow, which always stamps one) a weak star match is taken too.
export function removeSparkle(image, { assumePresent = false } = {}) {
  const { width: W, height: H } = image;
  if (Math.min(W, H) < MIN_SIDE) return { applied: false, alpha: 0 };
  const S = Math.min(W, H), x0 = Math.max(0, W - Math.round(S * 0.3) - 40), y0 = Math.max(0, H - Math.round(S * 0.3) - 40);
  const lum = luminance(image, x0, y0);
  const star = findStar(image, lum), pill = findPill(image, lum);
  // The pill and the star never sit together; the better fit decides, and the star must clear its threshold unless the caller knows Flow made it.
  if (pill.score >= PILL_SCORE && pill.score > star.score) return repairPill(image, lum, pill);
  const done = unveilStar(image, lum, star, assumePresent);
  if (done) return done;
  return { applied: false, alpha: 0, score: Math.max(star.score, pill.score) };
}

// Older 1K/2K helpers kept for callers and tests that still use them (radius and anchor of the fixed-place star).
export function sparkleRadius(width, height) {
  const side = Math.min(width, height), t = Math.max(0, Math.min(1, (side - 1100) / (2048 - 1100)));
  return 25.8 + (25.0 - 25.8) * t;
}
export function sparkleAnchor(width, height) {
  const side = Math.min(width, height), t = Math.max(0, Math.min(1, (side - 1100) / (2048 - 1100)));
  return Math.round(102 + (120 - 102) * t);
}

// Reads a PNG or JPEG file into RGBA pixels.
export const decodeImage = (buf) => (isJpeg(buf) ? decodeJpeg(buf) : decodePng(buf));

// file (png|jpg) -> out (png). A picture without a mark is returned unchanged in its pixels (written as PNG); the input file is never touched.
export function unsparkleFile(file, out, options = {}) {
  const buf = readFileSync(file), picture = decodeImage(buf);
  // convertOnly (Antigravity images carry no visible mark): no detection, a PNG is copied, a JPEG is converted.
  if (options.convertOnly) { writeFileSync(out, isJpeg(buf) ? encodePng(picture) : buf); return { applied: false, alpha: 0 }; }
  const result = removeSparkle(picture, options);
  writeFileSync(out, !result.applied && !isJpeg(buf) ? buf : encodePng(picture));
  return { applied: result.applied, alpha: Number((result.alpha || 0).toFixed(3)), ...(result.applied ? { kind: result.kind, method: result.method, right: result.right, bottom: result.bottom } : { score: Number((result.score ?? 0).toFixed(1)) }) };
}
