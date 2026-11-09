// "Xem trước": the post as it would go out on each enabled channel of a draft: the brand's page name, the POSTED text
// per language_policy (one-post-bilingual = the captions joined, as metricool-csv.mjs joins them; separate-posts = one
// post per language; single = one language) and the media. Reviewer-only languages (language_policy.review_langs, e.g.
// a Vietnamese reading of an English post) are never posted: they come back apart, in review_texts, for the approver to
// read. Static data for a mock in the app; nothing is sent anywhere.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as lib from './lib.mjs';

const { readJson, cleanText } = lib;
// The brand's posted and reviewer-only languages: lib.mjs's own rule when it has one, else the same rule here.
const postedOf = (social) => (lib.postedLangs || ((s) => [...new Set((s.channels || []).filter((c) => c.enabled).flatMap((c) => [].concat(c.lang || [])))]))(social);
const reviewOf = (social) => (lib.reviewLanguages || lib.reviewLangs || ((s) => {
  const posted = new Set(postedOf(s));
  return [...new Set([].concat(s?.language_policy?.review_langs || []).map((l) => String(l).trim()).filter((l) => /^[a-z]{2}$/.test(l) && !posted.has(l)))];
}))(social);

export function previewOf(d) {
  let social = {};
  try { social = readJson(join(d.draft.brand_dir, 'project', 'social.json')); } catch {}
  const review = reviewOf(social);
  const sep = typeof social.metricool?.bilingual_separator === 'string' ? social.metricool.bilingual_separator : '\n\n';
  // A caption file: the one the draft names, else content-<lang>.txt in the draft folder.
  const cap = (l) => {
    const file = join(d.dir, d.draft.captions?.[l] || `content-${l}.txt`);
    return existsSync(file) ? cleanText(readFileSync(file, 'utf8')).text : '';
  };
  const draftMode = d.draft.language_mode || social.language_policy?.mode || 'single';
  const posts = (d.draft.networks || []).map((n) => {
    const all = [].concat(n.lang || d.draft.languages || []);
    // Posted = the channel's languages without the reviewer-only ones (an older draft may still list them).
    const kept = all.filter((l) => !review.includes(l));
    const langs = kept.length ? kept : all;
    const mode = langs.length > 1 ? draftMode : 'single';
    const texts = mode === 'separate-posts' ? langs.map((l) => ({ lang: l, text: cap(l) }))
      : [{ lang: langs.join('+'), text: mode === 'one-post-bilingual' ? langs.map(cap).filter(Boolean).join(sep) : cap(langs[0]) }];
    return { network: n.network, account: n.account || '', mode, langs, texts };
  });
  const posted = new Set(posts.flatMap((p) => p.langs));
  const review_texts = review.filter((l) => !posted.has(l)).map((lang) => ({ lang, text: cap(lang) })).filter((x) => x.text);
  const media = ['image.png'].map((f) => join(d.dir, f)).filter((f) => existsSync(f)).map((path) => ({ type: /\.(mp4|mov|webm)$/i.test(path) ? 'video' : 'image', path }));
  // The brand's page as on Facebook: the channel's account name and the skill's avatar (served by /avatar?brand=).
  const avatar = d.draft.brand_dir && lib.brandAvatar(d.draft.brand_dir) ? `/avatar?brand=${encodeURIComponent(d.draft.brand)}` : '';
  return { page_name: lib.pageName(social) || d.draft.brand_name || d.draft.brand, page_avatar: avatar, mode: posts[0]?.mode || draftMode, posts, review_texts, media };
}
