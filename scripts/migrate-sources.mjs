// One-off, idempotent: copy the reference sources a skill's project/social.json still lists (research.sources[]) into the
// tool's own per-brand user list (workspace/brands/<id>.json sources_add[]), keeping each source's id, name, platform, url,
// what_to_take and notes, so known.json, library items (source_id) and crawl history keep matching. A source the skill had
// switched off (enabled: false) is migrated too, listed in sources_disabled. Nothing is removed anywhere (the skill file is
// never written here: empty its list yourself after the migration).
//   node scripts/migrate-sources.mjs [--brand <id>] [--dry]
import { main, out, isMain, parseArgs, discoverBrands, skillSocial, readBrandOverride, saveBrandOverride } from './lib.mjs';

export function sourcesToMigrate(skillSources, override) {
  const have = new Set((override.sources_add || []).map((x) => x.id));
  const list = (Array.isArray(skillSources) ? skillSources : []).filter((x) => x && x.url && /^[a-z0-9][a-z0-9-]*$/.test(x.id || '') && !have.has(x.id));
  return list.map((x) => ({ id: x.id, name: x.name || x.id, platform: x.platform || '', url: x.url, what_to_take: x.what_to_take || '', notes: x.notes || '', was_disabled: x.enabled !== true }));
}

if (isMain(import.meta.url)) main(() => {
  const args = parseArgs();
  const only = args.brand && args.brand !== true ? String(args.brand) : '';
  const report = [];
  for (const b of discoverBrands().brands.filter((x) => !only || x.id === only)) {
    const ov = readBrandOverride(b.id);
    const move = sourcesToMigrate(skillSocial(b.dir).research?.sources, ov);
    const before = (ov.sources_add || []).map((x) => x.id);
    if (move.length && !args.dry) {
      saveBrandOverride(b.id, { ...ov, sources_add: [...(ov.sources_add || []), ...move.map(({ was_disabled, ...x }) => x)], sources_disabled: [...new Set([...(ov.sources_disabled || []), ...move.filter((x) => x.was_disabled).map((x) => x.id)])] });
    }
    report.push({ brand: b.id, before, migrated: move.map((x) => ({ id: x.id, name: x.name, url: x.url })), after: move.length && !args.dry ? readBrandOverride(b.id).sources_add.map((x) => x.id) : before, dry: !!args.dry });
  }
  out({ brands: report });
});
