// Album: random image count per post, brand-skill file names, cover first (not run by default: tests only on request).
import test from 'node:test';
import assert from 'node:assert/strict';
import { imagesRange, pickImageCount, imageFiles, draftImages, extraShotOf } from '../scripts/draft-lib.mjs';

test('imagesRange: brand overrides settings, default [1, 3]', () => {
  assert.deepEqual(imagesRange({}, {}), [1, 3]);
  assert.deepEqual(imagesRange({ posts: { images_per_post: [2, 4] } }, {}), [2, 4]);
  assert.deepEqual(imagesRange({ posts: { images_per_post: [2, 4] } }, { posts: { images_per_post: [1, 1] } }), [1, 1]);
  assert.deepEqual(imagesRange({ posts: { images_per_post: [3, 1] } }, {}), [1, 3]);
});
test('pickImageCount stays in range', () => {
  assert.equal(pickImageCount([1, 3], () => 0), 1);
  assert.equal(pickImageCount([1, 3], () => 0.999), 3);
  for (let i = 0; i < 50; i++) { const n = pickImageCount([1, 3]); assert.ok(n >= 1 && n <= 3); }
});
test('imageFiles: image.png alone, image-01.. for an album; never language images', () => {
  assert.deepEqual(imageFiles(1), ['image.png']);
  assert.deepEqual(imageFiles(3), ['image-01.png', 'image-02.png', 'image-03.png']);
  assert.ok(!imageFiles(3).some((f) => /image-(vn|en)\.png/.test(f)));
});
test('draftImages: old drafts keep image.png, cover first', () => {
  assert.deepEqual(draftImages('x', {}), ['image.png']);
  assert.deepEqual(draftImages('x', { images: ['image-01.png', 'image-02.png'] })[0], 'image-01.png');
  assert.deepEqual([extraShotOf(1), extraShotOf(2)], ['detail', 'wide']);
});
