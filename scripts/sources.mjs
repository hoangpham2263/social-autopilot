// Each brand's enabled crawl inputs: the sources the USER keeps in the tool (workspace/brands/<id>.json, Overview > Edit; research.sources
// in the skill ships empty), each with its crawl registry (status none|partial|complete, posts_total, new_last_run, last_run, resume).
// The scheduled agent iterates brand -> its sources; sources are never mixed between brands. Read-only.
// node scripts/sources.mjs [--brand <id>] [--all]     (--all: brands not enabled too)
import { main, out, parseArgs, discoverBrands, brandSocial, brandSources } from './lib.mjs';
import { registryAll } from './store.mjs';
import path from 'node:path';

main(() => {
  const args = parseArgs();
  const { root, brands } = discoverBrands();
  const list = brands.filter((b) => (args.all || b.usable) && (!args.brand || b.id === args.brand)).map((b) => {
    const social = brandSocial(b.dir, b.id);
    const sources = brandSources(social), registry = registryAll(b.id, sources.map((x) => x.id));
    return { brand: b.id, name: b.brand, usable: b.usable, sources: sources.map((x) => ({ ...x, registry: registry[x.id] ? { status: registry[x.id].status, posts_total: registry[x.id].posts_total, new_last_run: registry[x.id].new_last_run, last_run: registry[x.id].last_run, resume: registry[x.id].resume } : null })) };
  });
  out({ skillsRoot: root, brands: list });
});
