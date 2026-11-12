// JPEG reader for Social Autopilot: Flow's downloads are JPEG, the sparkle remover works on RGBA pixels. Plain Node, uses the
// vendored decoder (scripts/vendor/jpeg-decoder.cjs, see scripts/vendor/README.md). Returns { width, height, data } like decodePng.
import { createRequire } from "node:module";
const decode = createRequire(import.meta.url)("../vendor/jpeg-decoder.cjs");

export const isJpeg = (buf) => buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
export function decodeJpeg(file) {
  if (!isJpeg(file)) throw new Error("Not a JPEG file.");
  const { width, height, data } = decode(file, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
  return { width, height, data: Buffer.from(data.buffer, data.byteOffset, data.length) };
}
