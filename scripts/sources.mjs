// Each brand's enabled crawl inputs, read only from that brand's own project/social.json (research.sources[]).
// The scheduled agent iterates brand -> its sources; sources are never mixed between brands. Read-only.
// node scripts/sources.mjs [--brand <id>] [--all]     (--all: brands not enabled too)
import { main, out, parseArgs, discoverBrands, readJson, brandSources } from './lib.mjs';
import path from 'node:path';

main(() => {
  const args = parseArgs();
  const { root, brands } = discoverBrands();
  const list = brands.filter((b) => (args.all || b.usable) && (!args.brand || b.id === args.brand)).map((b) => {
    const social = readJson(path.join(b.dir, 'project', 'social.json'));
    return { brand: b.id, name: b.brand, usable: b.usable, max_per_day: Number(social.research?.max_per_day ?? 0) || null, sources: brandSources(social) };
  });
  out({ skillsRoot: root, brands: list });
});
