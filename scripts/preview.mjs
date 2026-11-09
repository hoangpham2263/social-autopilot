// "Xem trước": the post as it would go out on each enabled channel of a draft: the brand's page name, the text per
// language_policy (one-post-bilingual = the captions joined, as metricool-csv.mjs joins them; separate-posts = one post
// per language) and the media. Static data for a mock (local app and static dashboard); nothing is sent anywhere.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, cleanText } from './lib.mjs';

export function previewOf(d) {
  let social = {};
  try { social = readJson(join(d.draft.brand_dir, 'project', 'social.json')); } catch {}
  const mode = d.draft.language_mode || social.language_policy?.mode || 'single';
  const sep = typeof social.metricool?.bilingual_separator === 'string' ? social.metricool.bilingual_separator : '\n\n';
  const cap = (l) => { const f = d.draft.captions?.[l]; const file = f && join(d.dir, f); return file && existsSync(file) ? cleanText(readFileSync(file, 'utf8')).text : ''; };
  const posts = (d.draft.networks || []).map((n) => {
    const langs = [].concat(n.lang || d.draft.languages || []);
    const texts = mode === 'separate-posts' ? langs.map((l) => ({ lang: l, text: cap(l) }))
      : [{ lang: langs.join('+'), text: mode === 'one-post-bilingual' ? langs.map(cap).filter(Boolean).join(sep) : cap(langs[0]) }];
    return { network: n.network, account: n.account || '', texts };
  });
  const media = ['image.png'].map((f) => join(d.dir, f)).filter((f) => existsSync(f)).map((path) => ({ type: /\.(mp4|mov|webm)$/i.test(path) ? 'video' : 'image', path }));
  return { page_name: social.brand || d.draft.brand_name || d.draft.brand, mode, posts, media };
}
