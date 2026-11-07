// Stand-in for `codex` in tests (SA_CODEX): reads the prompt on stdin, checks the arguments, saves image.png in the
// working directory like Codex does. Never calls an AI.
import fs from 'node:fs';
import zlib from 'node:zlib';

const args = process.argv.slice(2);
const prompt = fs.readFileSync(0, 'utf8');
if (args[0] !== 'exec' || !args.includes('-i') || !prompt.includes('Save the result')) { console.error('bad call', args); process.exit(2); }
const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(16, 0); ihdr.writeUInt32BE(16, 4); ihdr[8] = 8; ihdr[9] = 2;
const raw = Buffer.alloc((16 * 3 + 1) * 16, 90);
for (let y = 0; y < 16; y++) raw[y * 49] = 0;
// Like a real GPT image: a C2PA chunk (caBX) and a text chunk the cleaning step must remove.
fs.writeFileSync('image.png', Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('caBX', Buffer.from('fake-c2pa-manifest')), chunk('tEXt', Buffer.from('Software\0fake-codex')), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log('image.png');
