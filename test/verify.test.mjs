import assert from 'node:assert/strict';
import test from 'node:test';
import { computeFocusMap } from '../src/smart-crop.mjs';
import {
  VERIFY_LIMITS, checkAspect, checkCount, checkCutAlignment, checkDuration, checkPalette, checkSafeZone,
  checkTextContrast, checkTextOverlap, checkTextSize, contrastRatio, deltaEOK, relativeLuminance, srgbToOklab, summarizeChecks,
} from '../src/verify.mjs';

/** A flat background with an optional detailed, saturated subject in `box` (fractions). */
function scene(width, height, background, box = null) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const inside = box && x >= box.x * width && x < (box.x + box.width) * width && y >= box.y * height && y < (box.y + box.height) * height;
    pixels.set(inside ? ((x + y) % 4 < 2 ? [236, 78, 52, 255] : [252, 214, 96, 255]) : background, (y * width + x) * 4);
  }
  return pixels;
}
const shape = result => Object.keys(result).sort().join(',');
const RESULT_KEYS = 'check,confidence,costMs,pass,score,threshold';

test('luminance and contrast follow WCAG 2.x', () => {
  assert.equal(relativeLuminance([0, 0, 0]), 0);
  assert.ok(Math.abs(relativeLuminance([255, 255, 255]) - 1) < 1e-12);
  assert.ok(Math.abs(contrastRatio([0, 0, 0], [255, 255, 255]) - 21) < 1e-9);
  assert.equal(contrastRatio([90, 90, 90], [90, 90, 90]), 1);
  // #767676 on white is the classic smallest gray that passes AA (about 4.54).
  const gray = contrastRatio([118, 118, 118], [255, 255, 255]);
  assert.ok(gray > 4.5 && gray < 4.6, `got ${gray}`);
  assert.equal(contrastRatio([10, 20, 30], [200, 210, 220]), contrastRatio([200, 210, 220], [10, 20, 30]));
});

test('OKLab matches the reference white and black points', () => {
  const white = srgbToOklab([255, 255, 255]), black = srgbToOklab([0, 0, 0]);
  assert.ok(Math.abs(white[0] - 1) < 1e-4 && Math.abs(white[1]) < 1e-4 && Math.abs(white[2]) < 1e-4);
  assert.deepEqual(black.map(v => Math.abs(v) < 1e-9), [true, true, true]);
  assert.equal(deltaEOK([12, 200, 99], [12, 200, 99]), 0);
  assert.ok(deltaEOK([255, 0, 0], [0, 0, 255]) > 0.3);
});

test('text contrast uses a low percentile, so a busy background cannot average its way to a pass', () => {
  const plain = scene(40, 20, [250, 250, 250, 255]);
  const box = { x: 0.1, y: 0.2, width: 0.6, height: 0.5 };
  const dark = checkTextContrast(plain, 40, 20, box, [20, 20, 20]);
  assert.equal(shape(dark), RESULT_KEYS);
  assert.equal(dark.pass, true);
  assert.ok(dark.score > 15);
  assert.equal(checkTextContrast(plain, 40, 20, box, [200, 200, 200]).pass, false);

  // Mostly white, with a dark band under part of the text: the mean would pass, the 5th percentile fails.
  const banded = scene(40, 20, [250, 250, 250, 255]);
  for (let y = 0; y < 20; y++) for (let x = 4; x < 8; x++) banded.set([30, 30, 30, 255], (y * 40 + x) * 4);
  const result = checkTextContrast(banded, 40, 20, box, [20, 20, 20]);
  assert.equal(result.pass, false);
  assert.ok(result.score < 2);
  assert.equal(checkTextContrast(banded, 40, 20, box, [20, 20, 20], { percentile: 0.5 }).pass, true);
});

test('large text can use the 3:1 threshold and transparent backgrounds pass vacuously', () => {
  const mid = scene(10, 10, [150, 150, 150, 255]);
  const box = { x: 0, y: 0, width: 1, height: 1 };
  assert.equal(checkTextContrast(mid, 10, 10, box, [0, 0, 0], { minRatio: 4.5 }).pass, true);
  assert.equal(checkTextContrast(mid, 10, 10, box, [255, 255, 255], { minRatio: 3 }).pass, false);
  assert.equal(checkTextContrast(new Uint8ClampedArray(400), 10, 10, box, [0, 0, 0]).pass, true);
});

test('text over the subject fails the overlap check; text in empty space passes', () => {
  const subject = { x: 0.6, y: 0.25, width: 0.3, height: 0.5 };
  const pixels = scene(96, 48, [118, 124, 120, 255], subject);
  const focus = { map: computeFocusMap(pixels, 96, 48), width: 96, height: 48 };
  const over = checkTextOverlap(focus, [{ x: 0.55, y: 0.3, width: 0.4, height: 0.3 }]);
  const clear = checkTextOverlap(focus, [{ x: 0.05, y: 0.1, width: 0.35, height: 0.25 }]);
  assert.equal(over.pass, false);
  assert.equal(clear.pass, true);
  assert.ok(clear.score > over.score);
  // Overlapping boxes count covered interest once.
  const twice = checkTextOverlap(focus, [{ x: 0.55, y: 0.3, width: 0.4, height: 0.3 }, { x: 0.55, y: 0.3, width: 0.4, height: 0.3 }]);
  assert.equal(twice.score, over.score);
  const flat = { map: computeFocusMap(scene(32, 32, [90, 90, 90, 255]), 32, 32), width: 32, height: 32 };
  assert.equal(checkTextOverlap(flat, [{ x: 0, y: 0, width: 1, height: 1 }]).score, 1);
});

test('safe zone, aspect, size, duration and count are signed margins', () => {
  assert.equal(checkSafeZone([{ x: 0.1, y: 0.1, width: 0.5, height: 0.2 }]).pass, true);
  const edge = checkSafeZone([{ x: 0.02, y: 0.1, width: 0.5, height: 0.2 }]);
  assert.equal(edge.pass, false);
  assert.ok(Math.abs(edge.score - -0.03) < 1e-12);
  assert.equal(checkSafeZone([], {}).pass, true);

  assert.equal(checkAspect(1080, 1350, 4 / 5).pass, true);
  assert.equal(checkAspect(1080, 1080, 4 / 5).pass, false);
  assert.equal(checkTextSize(18, { minPx: 16 }).pass, true);
  assert.equal(checkTextSize(12).pass, false);

  assert.equal(checkDuration(8, { min: 7.5, max: 8.5 }).score, 0.5);
  assert.equal(checkDuration(9, { min: 7.5, max: 8.5 }).pass, false);
  assert.equal(checkCount(2, { min: 2, max: 2 }).pass, true);
  assert.equal(checkCount(3, { min: 2, max: 2 }).score, -1);
});

test('palette coverage measures brand colors in OKLab', () => {
  const brand = scene(20, 10, [20, 60, 200, 255], { x: 0, y: 0, width: 0.3, height: 1 });
  assert.equal(checkPalette(brand, 20, 10, [[20, 60, 200]]).pass, true);
  assert.equal(checkPalette(brand, 20, 10, [[20, 60, 200]], { minCoverage: 0.9 }).pass, false);
  assert.equal(checkPalette(brand, 20, 10, [[255, 255, 0]]).score, 0);
  assert.equal(checkPalette(new Uint8ClampedArray(800), 20, 10, [[0, 0, 0]]).score, 1);
});

test('cut alignment counts cuts near a beat', () => {
  const beats = [0, 0.5, 1, 1.5, 2, 2.5, 3];
  assert.equal(checkCutAlignment([0.52, 1.01, 2.47], beats).score, 1);
  const off = checkCutAlignment([0.52, 1.25, 2.47, 2.75], beats);
  assert.equal(off.score, 0.5);
  assert.equal(off.pass, false);
  assert.equal(checkCutAlignment([], beats).pass, true);
  assert.equal(checkCutAlignment([1], []).score, 0);
});

test('results combine and report time; invalid input fails loudly', () => {
  const results = [checkCount(1, { min: 1 }), checkAspect(100, 100, 1), checkTextSize(4)];
  const summary = summarizeChecks(results);
  assert.equal(summary.pass, false);
  assert.deepEqual(summary.failed, ['text-size']);
  assert.ok(summary.costMs >= 0 && summary.minConfidence >= 0.5 && summary.minConfidence <= 1);
  for (const r of results) assert.ok(r.confidence >= 0.5 && r.confidence <= 1 && r.costMs >= 0);

  assert.throws(() => checkTextContrast(new Uint8ClampedArray(8), 2, 2, { x: 0, y: 0, width: 1, height: 1 }, [0, 0, 0]), TypeError);
  assert.throws(() => checkTextContrast(new Uint8ClampedArray(16), 2, 2, { x: 0.5, y: 0, width: 0.8, height: 1 }, [0, 0, 0]), RangeError);
  assert.throws(() => checkPalette(new Uint8ClampedArray(16), 2, 2, []), RangeError);
  assert.throws(() => checkSafeZone(Array.from({ length: VERIFY_LIMITS.maxBoxes + 1 }, () => ({ x: 0, y: 0, width: 1, height: 1 }))), RangeError);
  assert.throws(() => checkCutAlignment([Number.NaN], [1]), RangeError);
  assert.throws(() => checkCount(1.5), RangeError);
  assert.throws(() => relativeLuminance([0, 0, 300]), TypeError);
});

test('checks are deterministic', () => {
  const pixels = scene(48, 24, [118, 124, 120, 255], { x: 0.5, y: 0.2, width: 0.3, height: 0.6 });
  const box = { x: 0.1, y: 0.1, width: 0.4, height: 0.3 };
  const strip = ({ costMs, ...rest }) => rest;
  assert.deepEqual(strip(checkTextContrast(pixels, 48, 24, box, [255, 255, 255])), strip(checkTextContrast(pixels, 48, 24, box, [255, 255, 255])));
  const focus = { map: computeFocusMap(pixels, 48, 24), width: 48, height: 24 };
  assert.deepEqual(strip(checkTextOverlap(focus, [box])), strip(checkTextOverlap(focus, [box])));
});
