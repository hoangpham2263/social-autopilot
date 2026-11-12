// Takes Google's sparkle (the star Flow/Gemini put in the bottom right corner) off a picture, locally. Input PNG or JPEG (Flow
// downloads are JPEG), output PNG; the original is never touched. A picture without the star comes out unchanged (as PNG)
// unless --assume-present (Flow pictures always have it): then the star is taken off at its anchor position even when the contrast test is inconclusive.
//   node scripts/image-unsparkle.mjs --image <png|jpg> --out <png> [--assume-present]     prints {"applied":true|false,"alpha":0.31}
import { fileURLToPath } from "node:url";
import { unsparkleFile } from "./image/unsparkle.mjs";

export { unsparkleFile };
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2), get = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : ""; };
  const image = get("--image"), out = get("--out"), assumePresent = args.includes("--assume-present");
  if (!image || !out) { console.error("Usage: node scripts/image-unsparkle.mjs --image <png|jpg> --out <png> [--assume-present]"); process.exit(1); }
  try { console.log(JSON.stringify(unsparkleFile(image, out, { assumePresent }))); }
  catch (error) { console.error(String(error.message || error)); process.exit(1); }
}
