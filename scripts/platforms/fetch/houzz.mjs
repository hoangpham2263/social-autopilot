// Houzz photo search: the server-rendered HTML of /photos/query/<slug> holds ~20 cards. Fetched with curl (child_process;
// the node fetch has got a 3 KB stub from Houzz). Card: <a href="/photos/<slug>~<id>" class="space-card__photo-link">Title</a> ...
// <img class="hui-photo-card__image" src=".../...-w550-...jpg">. Author only when the card shows one.
import * as houzz from '../houzz.mjs';
import { unescapeXml } from './common.mjs';

export const platform = 'houzz';
export const adapter = houzz;
export function requestFor(task) { return { url: task.url, via: 'curl' }; }
export function parse(html) {
  const tiles = [], seen = new Set();
  const re = /<a href="(\/photos\/[^"]*~(\d{5,}))"[^>]*class="space-card__photo-link"[^>]*>([^<]*)<\/a>([\s\S]*?)(?=<a href="\/photos\/[^"]*"[^>]*class="space-card__photo-link"|$)/g;
  for (const m of String(html || '').matchAll(re)) {
    if (seen.has(m[2])) continue;
    const img = (m[4].match(/hui-photo-card__image"[^>]*?\ssrc="(https:\/\/st\.hzcdn\.com\/[^"]+)"/) || [])[1];
    if (!img) continue;
    seen.add(m[2]);
    const author = unescapeXml((m[4].match(/hui-photo-card__(?:author|pro|credit)[^>]*>([^<]{2,60})</) || [])[1] || '');
    tiles.push({ url: `https://www.houzz.com${m[1]}`, image_urls: [img], caption: unescapeXml(m[3]).trim(), author });
  }
  return tiles;
}
