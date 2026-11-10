// Reddit via the public Atom feed (search.rss): 25 posts per request, thumbnail / preview.redd.it image, author, link.
// ONE request per keyword; Reddit answers 429/403 quickly, which stops the route (state blocked).
import { enc } from '../common.mjs';
import * as reddit from '../reddit.mjs';
import { unescapeXml, stripTags } from './common.mjs';

export const platform = 'reddit';
export const adapter = reddit;
const termOf = (task) => String(task.found_by || '').replace(/^(keyword|hashtag):/, '').trim();
export function requestFor(task) {
  if (task.kind === 'source') return { url: `${String(task.url).replace(/[?#].*$/, '').replace(/\/+$/, '')}/.rss`, via: 'fetch' };
  const term = termOf(task);
  if (!term) throw new Error('Reddit: cần từ khoá (--query).');
  return { url: `https://www.reddit.com/search.rss?q=${enc(`"${term}"`)}&sort=relevance&t=year&type=link`, via: 'fetch' };
}
// Atom text -> tiles. Image: the post's own image link (i.redd.it / preview.redd.it), else the feed thumbnail. Text-only posts have no image and are left out.
export function parse(xml) {
  const tiles = [];
  for (const m of String(xml || '').matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const g = (re) => (e.match(re) || [])[1] || '';
    const content = unescapeXml(g(/<content[^>]*>([\s\S]*?)<\/content>/));
    const link = g(/<link href="([^"]*)"/);
    const img = (content.match(/<a href="(https?:\/\/(?:i|preview)\.redd\.it\/[^"]*)"/) || [])[1] || unescapeXml(g(/<media:thumbnail url="([^"]*)"/));
    if (!link || !img) continue;
    tiles.push({ url: link, image_urls: [img], caption: unescapeXml(g(/<title>([\s\S]*?)<\/title>/)) || stripTags(content).slice(0, 200), author: unescapeXml(g(/<author><name>([^<]*)<\/name>/)) });
  }
  return tiles;
}
