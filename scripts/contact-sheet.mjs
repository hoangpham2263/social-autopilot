// One contact sheet of draft images, so the agent LOOKS at every new image in one read (pipeline.mjs, draft.mjs
// contact-sheet). Pure Node (zlib): PNG decode (8-bit, non-interlaced; what Codex saves) and PNG encode; other formats
// (JPEG/WebP) go through ffmpeg when it is there (settings ffmpeg.command), else they show as a grey tile with a note.
// Each tile carries a label (draft number + short id) in a tiny bitmap font, so no font file is needed.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// -> { w, h, rgb: Buffer (w*h*3) } or throws.
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  let pos = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0, palette = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), kind = buf.toString('latin1', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (kind === 'PLTE') palette = data;
    else if (kind === 'tRNS') trns = data;
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace) throw new Error(`PNG depth ${depth}${interlace ? ' interlaced' : ''} not supported`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!ch) throw new Error(`PNG colour type ${type} not supported`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch, px = Buffer.alloc(stride * h);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), cur = px.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    prev = cur;
  }
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    let r, g, b, al = 255;
    if (type === 0) r = g = b = px[i];
    else if (type === 4) { r = g = b = px[i * 2]; al = px[i * 2 + 1]; }
    else if (type === 2) { r = px[i * 3]; g = px[i * 3 + 1]; b = px[i * 3 + 2]; }
    else if (type === 6) { r = px[i * 4]; g = px[i * 4 + 1]; b = px[i * 4 + 2]; al = px[i * 4 + 3]; }
    else { const k = px[i]; r = palette[k * 3]; g = palette[k * 3 + 1]; b = palette[k * 3 + 2]; if (trns && k < trns.length) al = trns[k]; }
    // Transparent parts on white (how the post would look on a light feed).
    rgb[i * 3] = (r * al + 255 * (255 - al)) / 255; rgb[i * 3 + 1] = (g * al + 255 * (255 - al)) / 255; rgb[i * 3 + 2] = (b * al + 255 * (255 - al)) / 255;
  }
  return { w, h, rgb };
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = ~0; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return ~c >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'latin1'), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
export function encodePng(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

// Area-average downscale (keeps small text readable better than nearest neighbour), fit inside tw x th.
export function fit(img, tw, th) {
  const k = Math.min(tw / img.w, th / img.h, 1), w = Math.max(1, Math.round(img.w * k)), h = Math.max(1, Math.round(img.h * k));
  const out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y / k), y1 = Math.max(y0 + 1, Math.min(img.h, Math.floor((y + 1) / k)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x / k), x1 = Math.max(x0 + 1, Math.min(img.w, Math.floor((x + 1) / k)));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * img.w + xx) * 3; r += img.rgb[i]; g += img.rgb[i + 1]; b += img.rgb[i + 2]; n++; }
      const o = (y * w + x) * 3; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
  }
  return { w, h, rgb: out };
}

// 5x7 bitmap font: digits, A-Z, '-', '.', '/', ' ', ':', '#'.
const FONT = {
  '0': '01110100011001110101110011000101110', '1': '00100011000010000100001000010001110', '2': '01110100010000100010001000100011111',
  '3': '11110000010000101110000010000111110', '4': '00010001100101010010111110001000010', '5': '11111100001111000001000011000101110',
  '6': '00110010001000011110100011000101110', '7': '11111000010001000100010000100001000', '8': '01110100011000101110100011000101110',
  '9': '01110100011000101111000010001001100', A: '01110100011000111111100011000110001', B: '11110100011000111110100011000111110',
  C: '01110100011000010000100001000101110', D: '11100100101000110001100011001011100', E: '11111100001000011110100001000011111',
  F: '11111100001000011110100001000010000', G: '01110100011000010111100011000101111', H: '10001100011000111111100011000110001',
  I: '01110001000010000100001000010001110', J: '00111000100001000010000101001001100', K: '10001100101010011000101001001010001',
  L: '10000100001000010000100001000011111', M: '10001110111010110101100011000110001', N: '10001100011100110101100111000110001',
  O: '01110100011000110001100011000101110', P: '11110100011000111110100001000010000', Q: '01110100011000110001101011001001101',
  R: '11110100011000111110101001001010001', S: '01111100001000001110000010000111110', T: '11111001000010000100001000010000100',
  U: '10001100011000110001100011000101110', V: '10001100011000110001100010101000100', W: '10001100011000110101101011010101010',
  X: '10001100010101000100010101000110001', Y: '10001100010101000100001000010000100', Z: '11111000010001000100010001000011111',
  '-': '00000000000000011111000000000000000', '.': '00000000000000000000000000110001100', '/': '00001000010001000100010001000010000',
  ':': '00000011000110000000011000110000000', '#': '01010010101111101010111110101001010', ' ': '00000000000000000000000000000000000',
};
function text(canvas, cw, x, y, str, scale, color) {
  for (const chr of String(str).toUpperCase()) {
    const g = FONT[chr] || FONT['-'];
    for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (g[r * 5 + c] === '1')
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) { const o = ((y + r * scale + dy) * cw + x + c * scale + dx) * 3; if (o >= 0 && o < canvas.length - 2) canvas.set(color, o); }
    x += 6 * scale;
  }
}

// Any image -> { w, h, rgb } at most tw x th: PNG in Node; other formats through ffmpeg (raw RGB out) when available.
export function loadThumb(file, tw, th, ffmpeg = 'ffmpeg') {
  const buf = fs.readFileSync(file);
  if (buf.subarray(0, 8).equals(SIG)) { try { return fit(decodePng(buf), tw, th); } catch { /* fall through to ffmpeg */ } }
  const probe = spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-vf', `scale=${tw}:${th}:force_original_aspect_ratio=decrease`, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], { maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  if (probe.status === 0 && probe.stdout?.length) return decodePng(probe.stdout);
  return null;
}

// items: [{ file, label }] -> PNG Buffer. cols columns of tw x th tiles, label bar under each.
export function contactSheet(items, { cols = 3, tw = 512, th = 512, ffmpeg = 'ffmpeg' } = {}) {
  const pad = 8, bar = 30, rows = Math.max(1, Math.ceil(items.length / cols));
  const W = cols * tw + (cols + 1) * pad, H = rows * (th + bar) + (rows + 1) * pad;
  const canvas = Buffer.alloc(W * H * 3, 34);
  const missing = [];
  items.forEach((it, n) => {
    const cx = pad + (n % cols) * (tw + pad), cy = pad + Math.floor(n / cols) * (th + bar + pad);
    let t = null; try { t = loadThumb(it.file, tw, th, ffmpeg); } catch {}
    if (!t) { missing.push(it.file); for (let y = 0; y < th; y++) canvas.fill(90, ((cy + y) * W + cx) * 3, ((cy + y) * W + cx + tw) * 3); text(canvas, W, cx + 12, cy + th / 2, 'NO PREVIEW', 3, [255, 200, 0]); }
    else {
      const ox = cx + Math.floor((tw - t.w) / 2), oy = cy + Math.floor((th - t.h) / 2);
      for (let y = 0; y < t.h; y++) t.rgb.copy(canvas, ((oy + y) * W + ox) * 3, y * t.w * 3, (y + 1) * t.w * 3);
    }
    text(canvas, W, cx + 4, cy + th + 7, `#${n + 1} ${it.label}`.slice(0, Math.floor(tw / 12)), 2, [255, 255, 255]);
  });
  return { png: encodePng(W, H, canvas), width: W, height: H, missing };
}
