// Perceptual image hash (dHash) for the research store's duplicate check: the same photo reposted by another shop, or
// re-encoded / resized by Facebook, gets nearly the same hash (small Hamming distance) even when the bytes differ.
// No dependency: PNG is decoded here (zlib); other formats (JPEG, WebP) are first shrunk to a small PNG by the
// platform's own tool, all files of one call in one batch: Windows PowerShell System.Drawing (JPEG/PNG/BMP/GIF),
// macOS sips, or ffmpeg (settings ffmpeg.command / SA_FFMPEG) when present. A file nobody can decode gets '' (the other
// duplicate rules still apply; the report says so).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';

export const HASH_W = 17, HASH_H = 16; // 16 x 16 = 256 bits
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// 8-bit PNG (gray, RGB, palette, gray+alpha, RGBA), not interlaced -> { w, h, gray: Float64Array } or null.
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) return null;
  let pos = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0, palette = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos), name = buf.toString('latin1', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (name === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (name === 'PLTE') palette = data;
    else if (name === 'IDAT') idat.push(data);
    else if (name === 'IEND') break;
    pos += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!w || !h || depth !== 8 || interlace || !ch || (type === 3 && !palette)) return null;
  let raw; try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch { return null; }
  const stride = w * ch, out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[y * stride + x - ch] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= ch && y ? out[(y - 1) * stride + x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[y * stride + x] = v & 255;
    }
  }
  const gray = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    let r, g, b2;
    if (type === 3) { const k = out[i] * 3; r = palette[k]; g = palette[k + 1]; b2 = palette[k + 2]; }
    else if (ch <= 2) r = g = b2 = out[i * ch];
    else { r = out[i * ch]; g = out[i * ch + 1]; b2 = out[i * ch + 2]; }
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b2;
  }
  return { w, h, gray };
}

// Box-average resize of a gray image to tw x th.
function shrink({ w, h, gray }, tw, th) {
  const res = new Float64Array(tw * th);
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
    const x0 = Math.floor((tx * w) / tw), x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * w) / tw));
    const y0 = Math.floor((ty * h) / th), y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * h) / th));
    let sum = 0, n = 0;
    for (let y = y0; y < y1 && y < h; y++) for (let x = x0; x < x1 && x < w; x++) { sum += gray[y * w + x]; n++; }
    res[ty * tw + tx] = n ? sum / n : 0;
  }
  return res;
}

// dHash: each bit = is a pixel brighter than its right neighbour, on a 17 x 16 grayscale thumbnail; 64 hex chars.
export function dhash(img) {
  const s = shrink(img, HASH_W, HASH_H);
  let bits = '';
  for (let y = 0; y < HASH_H; y++) for (let x = 0; x < HASH_W - 1; x++) bits += s[y * HASH_W + x] > s[y * HASH_W + x + 1] ? '1' : '0';
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}
export function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) { let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (x) { d += x & 1; x >>= 1; } }
  return d;
}

// Shrinks every non-PNG file to a 64 px PNG in tmp with the platform's tool; returns file -> png path.
function toSmallPng(files, ffmpeg) {
  const res = new Map();
  if (!files.length) return res;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-phash-'));
  const outOf = (i) => path.join(tmp, `${i}.png`);
  try {
    if (process.platform === 'win32') {
      const list = path.join(tmp, 'list.txt');
      fs.writeFileSync(list, files.map((f, i) => `${f}\t${outOf(i)}`).join('\n'), 'utf8');
      const script = path.join(tmp, 'shrink.ps1');
      fs.writeFileSync(script, '﻿param([string]$List)\nAdd-Type -AssemblyName System.Drawing\nGet-Content -LiteralPath $List -Encoding UTF8 | ForEach-Object {\n  $p = $_ -split "`t"\n  try {\n    $i = [System.Drawing.Image]::FromFile($p[0]); $b = New-Object System.Drawing.Bitmap 64, 64; $g = [System.Drawing.Graphics]::FromImage($b)\n    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear; $g.DrawImage($i, 0, 0, 64, 64)\n    $b.Save($p[1], [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $b.Dispose(); $i.Dispose()\n  } catch {}\n}\n', 'utf8');
      spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-List', list], { encoding: 'utf8', windowsHide: true, timeout: 300000 });
    } else if (process.platform === 'darwin') {
      files.forEach((f, i) => spawnSync('sips', ['-s', 'format', 'png', '-z', '64', '64', f, '--out', outOf(i)], { windowsHide: true, timeout: 30000 }));
    }
    files.forEach((f, i) => {
      if (!fs.existsSync(outOf(i)) && ffmpeg) spawnSync(ffmpeg, ['-y', '-v', 'error', '-i', f, '-vf', 'scale=64:64,format=rgb24', '-frames:v', '1', outOf(i)], { windowsHide: true, timeout: 30000 });
      if (fs.existsSync(outOf(i))) res.set(f, fs.readFileSync(outOf(i)));
    });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  return res;
}

// file -> dHash hex ('' when the file could not be decoded).
export function imageHashes(files, { ffmpeg = process.env.SA_FFMPEG || '' } = {}) {
  const res = new Map(), rest = [];
  for (const f of new Set(files)) {
    const img = decodePng(fs.readFileSync(f));
    if (img) res.set(f, dhash(img)); else rest.push(f);
  }
  for (const [f, png] of toSmallPng(rest, ffmpeg)) { const img = decodePng(png); if (img) res.set(f, dhash(img)); }
  for (const f of files) if (!res.has(f)) res.set(f, '');
  return res;
}
