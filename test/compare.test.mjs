import assert from 'node:assert/strict';
import test from 'node:test';
import { srgbToOklab } from '../src/verify.mjs';
import { printPixels, resolvePrint } from '../src/print.mjs';
import { COMPARE_LIMITS, compareGrid, compareImages, compareOutputs, describeComparison, splitView, stepSplit } from '../src/compare.mjs';

// A deterministic test photo: gradients, a disc and fine stripes, so structure matters.
function photo(width, height, paint = () => {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, u = x / width, v = y / height, disc = (u - .5) ** 2 + (v - .45) ** 2 < .04;
    data[i] = disc ? 220 : 40 + 160 * u; data[i + 1] = disc ? 120 : 60 + 120 * v; data[i + 2] = (x >> 2) % 2 ? 150 : 90; data[i + 3] = 255;
    paint(data, i, x, y);
  }
  return { data, width, height };
}
const map = (image, fn) => { const data = Uint8ClampedArray.from(image.data); for (let i = 0; i < data.length; i += 4) fn(data, i); return { ...image, data }; };

test('constants are frozen and the package subpath resolves to this module', async () => {
  assert.ok(Object.isFrozen(COMPARE_LIMITS));
  assert.equal((await import('@optimai/creative-agents/compare')).compareOutputs, compareOutputs);
});

test('identical images report no change, infinite PSNR and full structure', () => {
  const a = photo(64, 48), result = compareOutputs(a, photo(64, 48));
  assert.ok(Object.isFrozen(result));
  assert.equal(result.identical, true); assert.equal(result.sameSize, true);
  assert.equal(result.changed, 0); assert.equal(result.meanDelta, 0); assert.equal(result.maxDelta, 0); assert.equal(result.deltaE, 0);
  assert.equal(result.psnr, Infinity); assert.equal(result.ssim, 1); assert.equal(result.bounds, null);
  assert.deepEqual(result.grid, { width: 64, height: 48 });
  assert.equal(describeComparison(result), 'Identical');
});

test('a local edit is found exactly: its share, its bounds and a small change in words', () => {
  const a = photo(80, 60), b = photo(80, 60, (data, i, x, y) => { if (x >= 10 && x < 30 && y >= 5 && y < 15) { data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; } });
  const result = compareOutputs(a, b);
  assert.equal(result.changed, round(200 / 4800));
  assert.deepEqual({ ...result.bounds }, { x: 10, y: 5, width: 20, height: 10 });
  assert.ok(result.ssim > .85 && result.ssim < .95, `ssim ${result.ssim}`);
  assert.ok(result.psnr > 15 && result.psnr < 40, `psnr ${result.psnr}`);
  assert.ok(result.deltaE > 0);
  assert.equal(describeComparison(result), `Small changes to 4% of the image · structure ${Math.round(result.ssim * 100)}% kept`);
});
const round = value => Math.round(value * 1e4) / 1e4;

test('a brightness lift changes everything but keeps the structure; an inversion does not', () => {
  const a = photo(64, 64);
  const lift = compareOutputs(a, map(a, (d, i) => { d[i] += 40; d[i + 1] += 40; d[i + 2] += 40; }));
  assert.equal(lift.changed, 1);
  assert.ok(lift.ssim > .85, `lift ssim ${lift.ssim}`);
  assert.match(describeComparison(lift), /^Changed the whole image · structure \d+% kept$/);
  const invert = compareOutputs(a, map(a, (d, i) => { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; }));
  assert.ok(invert.ssim < .2, `invert ssim ${invert.ssim}`);
  assert.ok(invert.psnr < lift.psnr && invert.deltaE > lift.deltaE);
  assert.match(describeComparison(invert), /^A new look across the whole image · structure \d+% kept$/);
});

test('the colour shift is the OKLab distance the colour core measures', () => {
  const one = rgb => ({ data: Uint8ClampedArray.of(...rgb, 255), width: 1, height: 1 });
  for (const [p, q] of [[[200, 100, 50], [0, 0, 0]], [[12, 240, 99], [250, 250, 250]], [[128, 128, 128], [130, 126, 128]]]) {
    const expected = Math.hypot(...srgbToOklab(p).map((value, index) => value - srgbToOklab(q)[index]));
    assert.ok(Math.abs(compareOutputs(one(p), one(q)).deltaE - expected) < 2e-3, `${p} vs ${q}`);
  }
});

test('a new grain seed reads as the same picture; a new print look or a moved subject does not', () => {
  // A smooth export-sized scene (gradient sky, a disc); fine stripes would turn the seeded misregistration into real structure.
  const base = photo(480, 600, (d, i, x, y) => { if ((x - 240) ** 2 + (y - 260) ** 2 >= 125 ** 2) d[i + 2] = 120 + y / 8; });
  const print = (look, seed) => { const out = Uint8ClampedArray.from(base.data); printPixels(out, 480, 600, resolvePrint({ look, seed }), out); return { ...base, data: out }; };
  const reseeded = compareOutputs(print('riso', 3), print('riso', 7));
  assert.ok(reseeded.changed > .15 && reseeded.ssim < .5, 'pixel by pixel the grain differs');
  assert.ok(reseeded.overall.deltaE < .02 && reseeded.overall.ssim > .9, JSON.stringify(reseeded.overall));
  assert.match(describeComparison(reseeded), /^Same picture with new grain or texture across \d+% of the image$/);
  const relooked = compareOutputs(print('riso', 3), print('halftone', 3));
  assert.ok(relooked.overall.deltaE > .04); assert.doesNotMatch(describeComparison(relooked), /Same picture/);
  const moved = compareOutputs(photo(240, 300), photo(240, 300, (d, i, x, y) => { const disc = ((x - 60) / 240) ** 2 + ((y - 60) / 300) ** 2 < .04; if (disc) { d[i] = 220; d[i + 1] = 120; } }));
  assert.doesNotMatch(describeComparison(moved), /Same picture/);
  assert.deepEqual(compareOutputs(base, base).overall, { deltaE: 0, ssim: 1 });
});

test('metrics are deterministic and symmetric for same-size images', () => {
  const a = photo(50, 40), b = map(a, (d, i) => { d[i + 2] = d[i + 2] ^ 32; });
  const ab = compareOutputs(a, b), ba = compareOutputs(b, a);
  assert.deepEqual(compareOutputs(a, b), ab);
  for (const key of ['changed', 'meanDelta', 'maxDelta', 'psnr', 'ssim', 'deltaE']) assert.equal(ab[key], ba[key], key);
  assert.deepEqual(ab.bounds, ba.bounds);
});

test('large images are sampled onto a bounded grid and bounds come back in full pixels', () => {
  const a = photo(1024, 512), b = photo(1024, 512, (data, i, x) => { if (x >= 512) data[i] = 0; });
  const result = compareOutputs(a, b);
  assert.deepEqual(result.grid, { width: 512, height: 256 });
  assert.equal(result.width, 1024); assert.equal(result.height, 512);
  assert.deepEqual({ ...result.bounds }, { x: 512, y: 0, width: 512, height: 512 });
  assert.deepEqual(compareGrid({ width: 1024, height: 512 }, { width: 1024, height: 512 }, 128), { width: 128, height: 64 });
  assert.deepEqual(compareOutputs(a, b, { maxSide: 1 }).grid, { width: COMPARE_LIMITS.minSide, height: 8 }, 'maxSide is clamped');
});

test('different sizes compare on the smaller grid without failing', () => {
  const big = photo(120, 90), small = photo(60, 45), result = compareOutputs(big, small);
  assert.equal(result.sameSize, false);
  assert.deepEqual(result.grid, { width: 60, height: 45 });
  assert.ok(result.ssim > .8 && result.meanDelta < .05, JSON.stringify(result));
  assert.equal(describeComparison(compareOutputs(photo(8, 8, (d, i) => { d[i] = d[i + 1] = d[i + 2] = 99; }), photo(16, 16, (d, i) => { d[i] = d[i + 1] = d[i + 2] = 99; }))), 'Same picture at another size');
});

test('transparency is compared over mid grey and the threshold ignores tiny noise', () => {
  const clear = photo(16, 16, (d, i) => { d[i + 3] = 0; }), grey = photo(16, 16, (d, i) => { d[i] = d[i + 1] = d[i + 2] = 128; });
  assert.equal(compareOutputs(clear, grey).identical, true);
  const a = photo(32, 32), noisy = map(a, (d, i) => { d[i] += (i / 4) % 2 ? 3 : -3; });
  const result = compareOutputs(a, noisy);
  assert.equal(result.identical, false); assert.equal(result.changed, 0); assert.equal(result.bounds, null);
  assert.equal(describeComparison(result), 'No visible change');
  assert.ok(compareOutputs(a, noisy, { threshold: 0 }).changed > .4);
});

test('the diff heatmap keeps unchanged pixels grey and paints changes warm', () => {
  const a = photo(20, 10), b = photo(20, 10, (d, i, x) => { if (x < 5) { d[i] = 0; d[i + 1] = 255; } });
  const { diff } = compareOutputs(a, b, { diff: true });
  assert.equal(diff.data.length, 20 * 10 * 4); assert.ok(Object.isFrozen(diff));
  const at = (x, y) => [...diff.data.subarray((y * 20 + x) * 4, (y * 20 + x) * 4 + 4)];
  const [r, g, bl, alpha] = at(15, 5); assert.equal(r, g); assert.equal(g, bl); assert.equal(alpha, 255);
  const [hr, hg, hb] = at(2, 5); assert.ok(hr > 200 && hr > hg && hr > hb, `${hr},${hg},${hb}`);
  assert.equal(compareOutputs(a, b).diff, undefined);
});

test('bad buffers are refused with clear errors', () => {
  assert.throws(() => compareOutputs({ data: new Uint8Array(4), width: 0, height: 1 }, photo(1, 1)), TypeError);
  assert.throws(() => compareOutputs(photo(2, 2), { data: new Uint8Array(3), width: 1, height: 1 }), /b\.data/);
  assert.throws(() => compareOutputs(null, photo(1, 1)), /a needs/);
  assert.equal(describeComparison(null), 'Nothing to compare yet');
});

test('the split view gives clips, a divider and keyboard steps', () => {
  const half = splitView(.25, 400, 200);
  assert.deepEqual({ ...half.before }, { x: 0, y: 0, width: 100, height: 200 });
  assert.deepEqual({ ...half.after }, { x: 100, y: 0, width: 300, height: 200 });
  assert.deepEqual({ ...half.line }, { x1: 100, y1: 0, x2: 100, y2: 200 });
  assert.equal(half.clipPath, 'inset(0 75% 0 0)');
  const vertical = splitView(.6, 100, 50, { orientation: 'vertical' });
  assert.equal(vertical.clipPath, 'inset(0 0 40% 0)'); assert.equal(vertical.before.height, 30);
  assert.equal(splitView(4).position, 1); assert.equal(splitView(Number.NaN).position, .5);
  assert.equal(stepSplit(.5, 'ArrowRight'), .55); assert.equal(stepSplit(.5, 'ArrowLeft'), .45);
  assert.equal(stepSplit(.5, 'PageUp'), .7); assert.equal(stepSplit(.98, 'ArrowUp'), 1);
  assert.equal(stepSplit(.4, 'Home'), 0); assert.equal(stepSplit(.4, 'End'), 1);
  assert.equal(stepSplit(.4, 'Enter'), undefined); assert.equal(stepSplit(.4, 'ArrowRight', { step: .1 }), .5);
});

// Browser decoding mock: blobs carry an RGBA image, bitmaps record close(), and drawImage redraws the test photo at the asked size.
async function withBrowser(run) {
  const saved = { createImageBitmap: globalThis.createImageBitmap, OffscreenCanvas: globalThis.OffscreenCanvas }, closed = [], draws = [];
  const sources = new WeakMap();
  globalThis.createImageBitmap = async blob => { const image = sources.get(blob); const bitmap = { width: image.width, height: image.height, image, close: () => closed.push(bitmap) }; return bitmap; };
  globalThis.OffscreenCanvas = class { constructor(width, height) { Object.assign(this, { width, height }); }
    getContext() { let drawn; return { drawImage: (bitmap, x, y, w, h) => { draws.push([bitmap.width, w, h]); drawn = photo(w, h); }, getImageData: () => drawn }; } };
  const blob = image => { const value = new Blob([new Uint8Array(1)], { type: 'image/png' }); sources.set(value, image); return value; };
  try { await run({ blob, closed, draws }); } finally { Object.assign(globalThis, saved); }
}

test('compareImages decodes blobs onto the grid, reports full pixels and closes its bitmaps', () => withBrowser(async ({ blob, closed, draws }) => {
  const a = photo(1024, 512), result = await compareImages(blob(a), blob(photo(1024, 512)), { maxSide: 256 });
  assert.deepEqual(draws, [[1024, 256, 128], [1024, 256, 128]], 'decoded straight onto the grid');
  assert.equal(result.width, 1024); assert.equal(result.height, 512); assert.equal(result.identical, true); assert.equal(result.sameSize, true);
  assert.equal(closed.length, 2);
  const buffers = await compareImages(photo(40, 30), photo(40, 30, (d, i, x) => { if (x < 4) d[i] = 0; }));
  assert.deepEqual({ ...buffers.bounds }, { x: 0, y: 0, width: 4, height: 30 });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(compareImages(blob(a), blob(a), { signal: controller.signal }), error => error.name === 'AbortError');
}));
