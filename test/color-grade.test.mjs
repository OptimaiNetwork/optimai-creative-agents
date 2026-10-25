import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { GRADE_LIMITS, GRADE_PRESETS, gradeColor, gradePixels, isIdentityGrade, resolveGrade } from '../src/color-grade.mjs';
import { toOklab, toOklch } from '../src/color.mjs';

/** A deterministic test card: hue sweep left to right, lightness top to bottom, plus a grey ramp row. */
function card(width = 96, height = 64) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, v = Math.round(255 * y / (height - 1)), h = x / width * 6, f = h % 1;
    const rgb = y < 4 ? [x * 255 / (width - 1), x * 255 / (width - 1), x * 255 / (width - 1)] : [[1, f, 0], [1 - f, 1, 0], [0, 1, f], [0, 1 - f, 1], [f, 0, 1], [1, 0, 1 - f]][Math.floor(h)].map(c => v * (0.35 + 0.65 * c));
    pixels.set([...rgb.map(Math.round), 200 + (x % 56)], i);
  }
  return pixels;
}
const digest = pixels => createHash('sha256').update(pixels).digest('hex');
const meanChroma = pixels => { let sum = 0; for (let i = 0; i < pixels.length; i += 4) sum += toOklch([pixels[i], pixels[i + 1], pixels[i + 2]])[1]; return sum / (pixels.length / 4); };

test('resolveGrade scales presets from the identity, keeps hues and rejects unknown or out-of-range settings', () => {
  assert.equal(resolveGrade('warm', 0).temperature, 0);
  assert.ok(isIdentityGrade(resolveGrade('punchy', 0)), 'Intensity 0 is always the untouched image.');
  assert.ok(isIdentityGrade(resolveGrade('original')));
  const half = resolveGrade('cool', 0.5);
  assert.equal(half.temperature, GRADE_PRESETS.cool.temperature / 2);
  assert.equal(half.saturation, 1 + (GRADE_PRESETS.cool.saturation - 1) / 2);
  assert.equal(half.shadowHue, GRADE_PRESETS.cool.shadowHue, 'Hues are angles, not amounts.');
  assert.deepEqual({ ...resolveGrade({ grain: 0.5 }) }, { ...GRADE_PRESETS.original, grain: 0.5 });
  assert.ok(Object.isFrozen(resolveGrade('noir')));
  assert.throws(() => resolveGrade('sepia'), /supported grade preset/);
  assert.throws(() => resolveGrade('warm', 1.5), /amount/);
  assert.throws(() => resolveGrade({ hue: 10 }), /Unknown grade setting: hue/);
  assert.throws(() => resolveGrade({ saturation: 3 }), /saturation must be a number from 0 to 2/);
  assert.throws(() => resolveGrade({ grain: Number.NaN }), /grain/);
  assert.throws(() => resolveGrade(['warm']), /preset name or an object/);
});

test('every preset is a pure function of the pixels: same bytes on every run, and band by band', () => {
  for (const preset of Object.keys(GRADE_PRESETS)) {
    const whole = gradePixels(card(), 96, 64, preset, { seed: 7 });
    const banded = card();
    for (let row = 0; row < 64; row += 5) gradePixels(banded, 96, 64, preset, { seed: 7, rows: [row, Math.min(64, row + 5)] });
    assert.equal(digest(banded), digest(whole), `${preset} graded in bands matches one pass`);
    assert.equal(digest(gradePixels(card(), 96, 64, preset, { seed: 7 })), digest(whole), `${preset} repeats exactly`);
  }
  const noir = card(), source = card();
  gradePixels(noir, 96, 64, 'noir');
  for (let i = 3; i < noir.length; i += 4) assert.equal(noir[i], source[i], 'Alpha is kept.');
  assert.equal(digest(gradePixels(card(), 96, 64, 'original')), digest(source), 'original is untouched.');
  assert.notEqual(digest(gradePixels(card(), 96, 64, 'noir', { seed: 1 })), digest(gradePixels(card(), 96, 64, 'noir', { seed: 2 })), 'The grain follows the seed.');
  assert.equal(digest(gradePixels(card(), 96, 64, 'warm', { seed: 1 })), digest(gradePixels(card(), 96, 64, 'warm', { seed: 2 })), 'Grain-free grades ignore the seed.');
});

test('the looks do what they say in OKLab', () => {
  // Noir: neutral (chroma ~0), more contrast, mid grey held, grain only in the noise floor.
  const noir = gradePixels(card(), 96, 64, 'noir');
  assert.ok(meanChroma(noir) < 0.004, `noir is neutral (${meanChroma(noir)})`);
  assert.ok(Math.abs(toOklab(gradeColor('#808080', 'noir'))[0] - toOklab('#808080')[0]) < 0.01, 'Contrast pivots on mid grey.');
  assert.ok(toOklab(gradeColor('#404040', 'noir'))[0] < toOklab('#404040')[0] - 0.05 && toOklab(gradeColor('#c0c0c0', 'noir'))[0] > toOklab('#c0c0c0')[0] + 0.05);
  // Warm and cool move neutrals along b (yellow ↔ blue), and keep black black.
  assert.ok(toOklab(gradeColor('#808080', 'warm'))[2] > 0.01 && toOklab(gradeColor('#808080', 'cool'))[2] < -0.01);
  assert.equal(gradeColor('#000000', 'warm'), '#000000');
  // Vibrance lifts muted colors more than vivid ones; punchy is more colorful overall.
  const gain = color => toOklch(gradeColor(color, resolveGrade({ vibrance: 1 })))[1] / toOklch(color)[1];
  assert.ok(gain('#8a7f74') > gain('#e0301e') + 0.3, 'Muted colors gain more chroma than vivid ones.');
  assert.ok(meanChroma(gradePixels(card(), 96, 64, 'punchy')) > meanChroma(card()) * 1.15);
  // Split tone pushes the chosen hue into the shadows only.
  const split = resolveGrade({ shadowHue: 250, shadowTint: 0.05 });
  assert.ok(Math.abs(toOklch(gradeColor('#202020', split))[2] - 250) < 25 && toOklch(gradeColor('#202020', split))[1] > 0.02);
  assert.ok(toOklch(gradeColor('#f0f0f0', split))[1] < 0.005);
  // Exposure is in stops of linear light.
  assert.ok(toOklab(gradeColor('#606060', resolveGrade({ exposure: 1 })))[0] > toOklab('#606060')[0] + 0.1);
});

test('a near-identity grade round-trips every 8-bit level, so subtle grades do not band', () => {
  const grade = resolveGrade({ exposure: 1e-6 });
  for (let v = 0; v < 256; v++) {
    const hex = `#${v.toString(16).padStart(2, '0').repeat(3)}`;
    assert.equal(gradeColor(hex, grade), hex);
  }
  assert.equal(gradeColor('#3a6ea5', grade), '#3a6ea5');
});

test('grain is luminance noise centred on the source, without changing the hue', () => {
  const flat = new Uint8ClampedArray(64 * 64 * 4).fill(128);
  gradePixels(flat, 64, 64, resolveGrade({ grain: 1 }), { seed: 11 });
  let sum = 0, spread = 0;
  for (let i = 0; i < flat.length; i += 4) { sum += flat[i]; spread = Math.max(spread, Math.abs(flat[i] - 128)); assert.ok(Math.abs(flat[i] - flat[i + 1]) <= 1 && Math.abs(flat[i] - flat[i + 2]) <= 1); }
  assert.ok(Math.abs(sum / 4096 - 128) < 1.5, `grain averages out (${sum / 4096})`);
  assert.ok(spread > 8 && spread < 40, `grain is visible but bounded (±${spread})`);
});

test('pixel buffers, sizes, rows and seeds are validated', () => {
  assert.throws(() => gradePixels(new Uint8ClampedArray(12), 2, 2, 'warm'), /RGBA/);
  assert.throws(() => gradePixels([0, 0, 0, 255], 1, 1, 'warm'), /RGBA/);
  assert.throws(() => gradePixels(new Uint8ClampedArray(4), 0, 1, 'warm'), /whole pixels/);
  assert.throws(() => gradePixels(new Uint8ClampedArray(4), 5000, 5000, 'warm'), /16 million/);
  assert.throws(() => gradePixels(new Uint8ClampedArray(16), 2, 2, 'warm', { rows: [1, 3] }), /rows/);
  assert.throws(() => gradePixels(new Uint8ClampedArray(16), 2, 2, 'noir', { seed: -1 }), /seed/);
  assert.throws(() => gradePixels(new Uint8ClampedArray(16), 2, 2, 'noir', { seed: GRADE_LIMITS.seed + 1 }), /seed/);
  assert.doesNotThrow(() => gradePixels(new Uint8ClampedArray(16), 2, 2, 'noir', { seed: GRADE_LIMITS.seed }));
  assert.throws(() => gradeColor('red', 'warm'), /hex color/);
});
