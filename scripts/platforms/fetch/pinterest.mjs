// Pinterest RSS of a user or a board (reference pages only; keyword search needs the browser).
//   https://www.pinterest.com/<user>/  -> /<user>/feed.rss      https://www.pinterest.com/<user>/<board>/ -> /<user>/<board>.rss
import * as pinterest from '../pinterest.mjs';
import { unescapeXml, stripTags } from './common.mjs';

export const platform = 'pinterest';
export const adapter = pinterest;
export function requestFor(task) {
  if (task.kind === 'query') throw new Error('Pinterest RSS chỉ cho trang tham chiếu (user/board); từ khoá thì dùng in-page script.');
  const parts = new URL(task.url).pathname.split('/').filter(Boolean);
  if (!parts.length || ['pin', 'search', 'ideas', 'today'].includes(parts[0])) throw new Error('Pinterest RSS cần URL dạng /<user>/ hoặc /<user>/<board>/.');
  const path = parts.length === 1 ? `/${parts[0]}/feed.rss` : `/${parts[0]}/${parts[1]}.rss`;
  return { url: `https://www.pinterest.com${path}`, via: 'fetch' };
}
// The adapter's toPost upgrades the 236x thumbnail to 736x.
export function parse(xml) {
  const tiles = [];
  for (const m of String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const e = m[1];
    const g = (re) => (e.match(re) || [])[1] || '';
    const link = g(/<link>([^<]*)<\/link>/).trim();
    const desc = unescapeXml(g(/<description>([\s\S]*?)<\/description>/));
    const img = (desc.match(/src="([^"]*)"/) || [])[1] || '';
    if (!link || !img) continue;
    tiles.push({ url: link, image_urls: [img], caption: unescapeXml(g(/<title>([\s\S]*?)<\/title>/)).trim() || stripTags(desc), author: '' });
  }
  return tiles;
}
