// Step 0: discover brands in skillsRoot (config/settings.json; SA_SKILLS_ROOT overrides it). Two layouts: legacy
// <skillsRoot>/<id>-skills/ and shared <skillsRoot>/brand-content-skills/brands/<id>/ (SKILL.md + scripts at the skill root);
// either way a brand has project/project.md and project/social.json. It is in the run (usable) only when social.json has
// "enabled": true and the skill's `scripts/check-skill.mjs --tool-ready` (shared layout: `--brand <id>`) passes; problems lists what is missing.
// node scripts/brands.mjs [--run research|create|publish]
//   --run (Setup, step 1 of every prompt): this run shows in the app's Prompt tab (Run progress); it takes over the
//   pending run the app's Copy prompt made, or starts one (scripts/progress.mjs).
import { main, out, parseArgs, discoverBrands } from './lib.mjs';
import { beginRun, MODES } from './progress.mjs';

main(() => {
  const args = parseArgs();
  const { root, brands, skipped } = discoverBrands();
  const usable = brands.filter((b) => b.usable).map((b) => b.id);
  if (args.run !== undefined) {
    if (!MODES.includes(String(args.run))) throw new Error('--run must be research, create or publish.');
    beginRun(String(args.run), { brands: usable });
  }
  out({
    skillsRoot: root,
    usable,
    brands: brands.map(({ id, dir, skillRoot, shared, brand, enabled, ready, usable, channels, languages, language_mode, review_languages, sources, ai_scenes_allowed, problems }) => ({ id, dir, skillRoot, shared, brand, enabled, ready, usable, channels, languages, language_mode, review_languages, sources, ai_scenes_allowed, problems })),
    skipped,
  });
});
