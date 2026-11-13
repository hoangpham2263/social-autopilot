// Album: random image count per post, brand-skill file names, cover first, alt per image (tests only on request).
import test from 'node:test';
import assert from 'node:assert/strict';
import { imagesRange, pickImageCount, imageFiles, draftImages, publishPairs, extraShotOf, parseImagesOpt } from '../scripts/draft-lib.mjs';
import { altTexts } from '../scripts/writeback.mjs';
import { normalizeOverride } from '../scripts/lib.mjs';

test('imagesRange: brand overrides settings, default [1, 4]', () => {
  assert.deepEqual(imagesRange({}, {}), [1, 4]);
  assert.deepEqual(imagesRange({ posts: { images_per_post: [1, 9] } }, {}), [1, 4]); // max 4
  assert.deepEqual(imagesRange({ posts: { images_per_post: [2, 4] } }, {}), [2, 4]);
  assert.deepEqual(imagesRange({ posts: { images_per_post: [2, 4] } }, { posts: { images_per_post: [1, 1] } }), [1, 1]);
  assert.deepEqual(imagesRange({ posts: { images_per_post: [3, 1] } }, {}), [1, 3]);
  assert.deepEqual(normalizeOverride({ posts: { images_per_post: [2, 3] } }).posts, { images_per_post: [2, 3] });
  assert.equal(normalizeOverride({ posts: { images_per_post: [0, 3] } }).posts, undefined);
});
test('pickImageCount stays in range', () => {
  assert.equal(pickImageCount([1, 3], () => 0), 1);
  assert.equal(pickImageCount([1, 3], () => 0.999), 3);
  assert.equal(pickImageCount([1, 4], () => 0.999), 4);
  for (let i = 0; i < 50; i++) { const n = pickImageCount([1, 3]); assert.ok(n >= 1 && n <= 3); }
});
test('names: image.png alone, image-01.. for an album; never language images', () => {
  assert.deepEqual(imageFiles(1), ['image.png']);
  assert.deepEqual(imageFiles(3), ['image-01.png', 'image-02.png', 'image-03.png']);
  assert.ok(!imageFiles(3).some((f) => /image-(vn|en)\.png/.test(f)));
});
test('draft images: old drafts keep image.png; album cover first, published as image-01', () => {
  assert.deepEqual(draftImages({}), ['image.png']);
  assert.deepEqual(draftImages({ image_count: 3 }), ['image.png', 'image-02.png', 'image-03.png']);
  assert.deepEqual(publishPairs({}), [{ from: 'image.png', to: 'image.png' }]);
  assert.deepEqual(publishPairs({ image_count: 2 }).map((p) => p.to), ['image-01.png', 'image-02.png']);
  assert.deepEqual([extraShotOf(1), extraShotOf(2)], ['detail', 'wide']);
});
test('alt text: one per image, in order', () => {
  const alts = altTexts({ image_count: 3, idea: { product_type: 'Neon sign', scene: 'a cozy bar' }, sign_text: 'Open' });
  assert.equal(alts.length, 3);
  assert.match(alts[0], /^Neon sign reading "Open" in a cozy bar/);
  assert.match(alts[1], /^Close-up/);
  assert.equal(altTexts({ idea: { product_type: 'Lamp' } }).length, 1);
});

test('parseImagesOpt: --images N | min-max within 1..4', () => {
  assert.deepEqual(parseImagesOpt('2'), [2, 2]);
  assert.deepEqual(parseImagesOpt('1-3'), [1, 3]);
  assert.deepEqual(parseImagesOpt('1-4'), [1, 4]);
  for (const bad of ['0', '5', '3-1', 'x', '1-5']) assert.equal(parseImagesOpt(bad), null);
  assert.equal(parseImagesOpt(undefined), null);
  assert.deepEqual(draftImages({ image_count: 4 }), ['image.png', 'image-02.png', 'image-03.png', 'image-04.png']);
});

test('album type: --album parsing, forced choice, random split, old drafts = angle', async () => {
  const { parseAlbumOpt, albumChoice, pickAlbumMode, albumModeOf } = await import('../scripts/draft-lib.mjs');
  assert.equal(parseAlbumOpt(undefined), '');
  assert.equal(parseAlbumOpt('Scene'), 'scene');
  assert.equal(parseAlbumOpt('x'), null);
  assert.equal(albumChoice('', { posts: { album_mode: 'angle' } }), 'angle');
  assert.equal(albumChoice('scene', { posts: { album_mode: 'angle' } }), 'scene');
  assert.equal(albumChoice('', {}), 'random');
  assert.equal(pickAlbumMode('scene'), 'scene');
  assert.equal(pickAlbumMode('random', () => 0), 'angle');
  assert.equal(pickAlbumMode('random', () => 0.9), 'scene');
  assert.equal(albumModeOf({ image_count: 1, album_mode: 'scene' }), '');
  assert.equal(albumModeOf({ image_count: 3 }), 'angle');
  assert.equal(albumModeOf({ image_count: 3, album_mode: 'scene' }), 'scene');
  const alts = altTexts({ image_count: 3, album_mode: 'scene', album_scenes: ['a bar counter'], idea: { product_type: 'Neon sign', scene: 'a cozy bar' }, sign_text: 'Open' });
  assert.match(alts[1], /in a bar counter\.$/);
  assert.match(alts[2], /in a different setting\.$/);
});
