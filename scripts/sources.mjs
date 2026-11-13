// Each brand's enabled crawl inputs: the sources the USER keeps in the tool (workspace/brands/<id>.json, Overview > Edit; research.sources
// in the skill ships empty), each with its crawl registry (status none|partial|complete, posts_total, new_last_run, last_run, resume).
// The scheduled agent iterates brand -> its sources; sources are never mixed between brands.
//   node scripts/sources.mjs [--brand <id>] [--all]     list (read-only; --all: brands not enabled too)
// Suggested sources (Research with nothing left to crawl: the agent looks for NEW pages OUTSIDE the list and only SUGGESTS them; the person
// chooses in the Run tab picker or the brand Edit page). Stored in workspace/brands/<id>.json suggested[] / dismissed_suggestions[]:
//   node scripts/sources.mjs suggest --brand <id> --url <page url> --name "<page name>" --platform <p> --reason "<why it fits, short>"   (max 5 per brand per run)
//   node scripts/sources.mjs list-suggested --brand <id>
//   node scripts/sources.mjs accept --brand <id> --id <sug-id>[,<sug-id>]      (becomes an ordinary user source)
//   node scripts/sources.mjs dismiss --brand <id> --id <sug-id>[,<sug-id>]     (never suggested again)
//   node scripts/sources.mjs queries --brand <id> [--platforms a,b]            (the discovery search pages of the brand's skill keywords/hashtags, even if discovery is off)
import { main, out, isMain, parseArgs, need, discoverBrands, brandSocial, brandSources, brandDiscovery, suggestSource, acceptSuggestions, dismissSuggestions, listSuggested, SUGGEST_PLATFORMS } from './lib.mjs';
import { registryAll } from './store.mjs';
import { discoveryQueries } from './research.mjs';

const ids = (v) => String(v === true || v === undefined ? '' : v).split(',').map((x) => x.trim()).filter(Boolean);
function brandOf(id) {
  const { brands, root } = discoverBrands();
  const b = brands.find((x) => x.id === id);
  if (!b) throw new Error(`Unknown brand "${id}" in ${root}.`);
  return b;
}
// Every source the brand already has, enabled or not (skill + added in the tool): a suggestion never repeats one.
export function knownSources(b) {
  const list = (brandSocial(b.dir, b.id).research?.sources || []).filter((x) => x && x.id);
  return { knownUrls: list.map((x) => x.url).filter(Boolean), knownIds: list.map((x) => x.id) };
}

if (isMain(import.meta.url)) main(() => {
  const args = parseArgs();
  const cmd = args._[0];
  if (cmd === 'suggest') {
    const b = brandOf(need(args, 'brand'));
    return out({ brand: b.id, ...suggestSource(b.id, { url: need(args, 'url'), name: need(args, 'name'), platform: need(args, 'platform'), reason: need(args, 'reason') }, knownSources(b)) });
  }
  if (cmd === 'list-suggested') return out({ brand: need(args, 'brand'), ...listSuggested(brandOf(need(args, 'brand')).id) });
  if (cmd === 'accept') return out({ brand: need(args, 'brand'), ...acceptSuggestions(brandOf(need(args, 'brand')).id, ids(need(args, 'id'))) });
  if (cmd === 'dismiss') return out({ brand: need(args, 'brand'), ...dismissSuggestions(brandOf(need(args, 'brand')).id, ids(need(args, 'id'))) });
  if (cmd === 'queries') {
    const b = brandOf(need(args, 'brand'));
    const d = brandDiscovery(brandSocial(b.dir, b.id), { force: true });
    const only = args.platforms === undefined || args.platforms === true ? null : ids(args.platforms);
    const platforms = (d.platforms.length ? d.platforms.map((p) => p.id) : SUGGEST_PLATFORMS).filter((p) => !only || only.includes(p));
    return out({ brand: b.id, platforms, keywords: d.keywords, hashtags: d.hashtags, product_fit: d.product_fit, queries: discoveryQueries(platforms, d.keywords, d.hashtags).map(({ platform, kind, term, url }) => ({ platform, kind, term, url })) });
  }
  if (cmd) throw new Error('Commands: (none = list) | suggest | list-suggested | accept | dismiss | queries');
  const { root, brands } = discoverBrands();
  const list = brands.filter((b) => (args.all || b.usable) && (!args.brand || b.id === args.brand)).map((b) => {
    const social = brandSocial(b.dir, b.id);
    const sources = brandSources(social), registry = registryAll(b.id, sources.map((x) => x.id));
    return { brand: b.id, name: b.brand, usable: b.usable, sources: sources.map((x) => ({ ...x, registry: registry[x.id] ? { status: registry[x.id].status, posts_total: registry[x.id].posts_total, new_last_run: registry[x.id].new_last_run, last_run: registry[x.id].last_run, resume: registry[x.id].resume } : null })), suggested: listSuggested(b.id).suggested };
  });
  out({ skillsRoot: root, brands: list });
});
