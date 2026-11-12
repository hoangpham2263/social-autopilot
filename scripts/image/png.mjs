// PNG reader and writer for Social Autopilot (plain Node, node:zlib only, the same on Windows and macOS): used to take Google's
// sparkle off pictures Flow made (unsparkle.mjs). Own copy of Product Review's png.mjs: tools do not share image code.
// Images are PNG: 1 to 16 bit, gray, palette, RGB or RGBA, not interlaced (the image AIs save plain PNG).
import { inflateSync, deflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// ----- PNG decode: RGBA, 8 bits per channel -----
export function decodePng(file) {
  if (file.length < 8 || !file.subarray(0, 8).equals(SIGNATURE)) throw new Error("Không phải file PNG.");
  let pos = 8, head = null, palette = null, trns = null;
  const idat = [];
  while (pos + 12 <= file.length) {
    const length = file.readUInt32BE(pos);
    const type = file.toString("latin1", pos + 4, pos + 8);
    const data = file.subarray(pos + 8, pos + 8 + length);
    pos += 12 + length;
    if (type === "IHDR") head = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    else if (type === "PLTE") palette = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  if (!head) throw new Error("PNG thiếu IHDR.");
  if (head.interlace) throw new Error("PNG xen kẽ (interlaced) chưa được hỗ trợ.");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[head.color];
  if (!channels || ![1, 2, 4, 8, 16].includes(head.depth)) throw new Error("Kiểu PNG này chưa được hỗ trợ.");
  const { width, height, depth, color } = head;
  const bits = channels * depth, bpp = Math.max(1, Math.ceil(bits / 8)), stride = Math.ceil((width * bits) / 8);
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < height * (stride + 1)) throw new Error("PNG bị cắt ngang.");
  // undo the row filters
  const px = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride, up = row - stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? px[row + i - bpp] : 0, b = y ? px[up + i] : 0, c = y && i >= bpp ? px[up + i - bpp] : 0, x = raw[src + i];
      let v;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      else throw new Error("PNG có kiểu lọc không hợp lệ.");
      px[row + i] = v & 255;
    }
  }
  // to RGBA
  const out = new Uint8Array(width * height * 4);
  const mask = (1 << Math.min(depth, 8)) - 1;
  const sample = (row, index) => { // the index-th sample of a row, scaled to 0..255 for gray, raw for palette
    if (depth === 8) return px[row + index];
    if (depth === 16) return px[row + index * 2];
    const bit = index * depth;
    return (px[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & mask;
  };
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (color === 6) { for (let k = 0; k < 4; k++) out[o + k] = sample(row, x * 4 + k); }
      else if (color === 2) { for (let k = 0; k < 3; k++) out[o + k] = sample(row, x * 3 + k); out[o + 3] = 255; }
      else if (color === 4) { const g = sample(row, x * 2); out[o] = out[o + 1] = out[o + 2] = g; out[o + 3] = sample(row, x * 2 + 1); }
      else if (color === 0) { const g = depth >= 8 ? sample(row, x) : Math.round((sample(row, x) * 255) / mask); out[o] = out[o + 1] = out[o + 2] = g; out[o + 3] = 255; }
      else {
        const i = sample(row, x);
        if (!palette || i * 3 + 2 >= palette.length) throw new Error("PNG có màu ngoài bảng màu.");
        out[o] = palette[i * 3]; out[o + 1] = palette[i * 3 + 1]; out[o + 2] = palette[i * 3 + 2];
        out[o + 3] = trns && i < trns.length ? trns[i] : 255;
      }
    }
  }
  return { width, height, data: out };
}

// ----- PNG encode: RGB when every pixel is opaque, else RGBA; the best of three filters for each row -----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  Buffer.from(data.buffer ?? data, data.byteOffset ?? 0, data.length).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
export function encodePng({ width, height, data }) {
  let opaque = true;
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) { opaque = false; break; }
  const channels = opaque ? 3 : 4, stride = width * channels;
  const rows = Buffer.alloc(height * (stride + 1));
  const line = new Uint8Array(stride), none = new Uint8Array(stride), sub = new Uint8Array(stride), upf = new Uint8Array(stride);
  let previous = new Uint8Array(stride);
  const cost = (r) => { let s = 0; for (let i = 0; i < r.length; i++) s += r[i] < 128 ? r[i] : 256 - r[i]; return s; };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) for (let k = 0; k < channels; k++) line[x * channels + k] = data[(y * width + x) * 4 + k];
    for (let i = 0; i < stride; i++) { none[i] = line[i]; sub[i] = (line[i] - (i >= channels ? line[i - channels] : 0)) & 255; upf[i] = (line[i] - previous[i]) & 255; }
    const costs = [cost(none), cost(sub), cost(upf)], best = costs.indexOf(Math.min(...costs));
    rows[y * (stride + 1)] = best;
    rows.set([none, sub, upf][best], y * (stride + 1) + 1);
    previous = Uint8Array.from(line);
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0); head.writeUInt32BE(height, 4); head[8] = 8; head[9] = opaque ? 2 : 6;
  return Buffer.concat([SIGNATURE, chunk("IHDR", head), chunk("IDAT", deflateSync(rows, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}
