// Step 0: discover brands. A brand is a skill folder in skillsRoot (config/settings.json) with SKILL.md,
// project/project.md and project/social.json. It is in the run (usable) only when social.json has "enabled": true and
// the skill's own `scripts/check-skill.mjs --tool-ready` passes; problems lists what that check says is missing.
// node scripts/brands.mjs
import { main, out, discoverBrands } from './lib.mjs';

main(() => {
  const { root, brands, skipped } = discoverBrands();
  out({
    skillsRoot: root,
    usable: brands.filter((b) => b.usable).map((b) => b.id),
    brands: brands.map(({ id, dir, brand, enabled, ready, usable, channels, languages, language_mode, review_languages, sources, ai_scenes_allowed, problems }) => ({ id, dir, brand, enabled, ready, usable, channels, languages, language_mode, review_languages, sources, ai_scenes_allowed, problems })),
    skipped,
  });
});
