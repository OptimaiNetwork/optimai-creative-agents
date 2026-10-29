import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { bayerMatrix, blueNoiseMatrix, PRINT_DOT_GAIN, PRINT_INK, PRINT_LIMITS, PRINT_LOOKS, PRINT_PAPER, PRINT_STYLES, printPixels, resolvePrint, RISO_INKS, separateDuotone } from '../src/print.mjs';

// Two gradients and a hard vertical edge in blue, so tone, color and edges all reach the print.
function photo(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 4;
    data[index] = Math.round(x * 255 / width); data[index + 1] = Math.round(y * 255 / height); data[index + 2] = x < width / 2 ? 40 : 200; data[index + 3] = 255;
  }
  return data;
}
const flat = (width, height, value) => { const data = new Uint8ClampedArray(width * height * 4).fill(value); for (let index = 3; index < data.length; index += 4) data[index] = 255; return data; };
const digest = data => createHash('sha256').update(data).digest('hex').slice(0, 16);
const hex = (data, index) => '#' + [0, 1, 2].map(channel => data[index + channel].toString(16).padStart(2, '0')).join('');

test('settings validate looks, aliases, ranges and inks', () => {
  assert.deepEqual(resolvePrint(), { look: 'riso', scale: 3, amount: 100, seed: 1, dotGain: PRINT_DOT_GAIN, ink: PRINT_INK, paper: PRINT_PAPER, inks: RISO_INKS['pink + blue'] });
  for (const [style, look] of Object.entries(PRINT_STYLES)) assert.equal(resolvePrint({ look: style }).look, look);
  assert.deepEqual(new Set(Object.values(PRINT_STYLES)), new Set(PRINT_LOOKS), 'every look has a recipe name');
  assert.deepEqual(resolvePrint({ inks: ['#AABBCC', '#000000'] }).inks, ['#aabbcc', '#000000']);
  for (const options of [{ look: 'screenprint' }, { look: '__proto__' }, { scale: 0 }, { scale: 13 }, { scale: 2.5 }, { amount: -1 }, { amount: NaN }, { seed: -1 }, { seed: PRINT_LIMITS.seed + 1 }, { seed: 1.5 }, { dotGain: -0.1 }, { dotGain: 1.5 }, { dotGain: NaN },
    { ink: 'black' }, { paper: '#fff' }, { inks: 'green + gold' }, { inks: ['#ff0000'] }, { inks: ['#ff0000', 'blue'] }]) {
    assert.throws(() => resolvePrint(options), RangeError, JSON.stringify(options));
  }
});

test('the Bayer matrix is the recursive ordered-dither matrix', () => {
  assert.deepEqual([...bayerMatrix(2)], [0, 2, 3, 1]);
  assert.deepEqual([...bayerMatrix(4)], [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]);
  for (const size of [8, 16]) assert.deepEqual([...bayerMatrix(size)].sort((a, b) => a - b), Array.from({ length: size * size }, (_, index) => index));
  assert.throws(() => bayerMatrix(3), RangeError);
});

test('the blue-noise tile is a permutation with even, pattern-free coverage at every level', () => {
  const tile = blueNoiseMatrix(64);
  assert.deepEqual([...tile].sort((a, b) => a - b), Array.from({ length: 4096 }, (_, index) => index));
  assert.deepEqual(blueNoiseMatrix(64), tile, 'built once, the same every time');
  tile[0] = 9999; assert.notEqual(blueNoiseMatrix(64)[0], 9999, 'callers get a copy');
  // White noise gives each 8 × 8 block a count variance near 16 (binomial); blue noise spreads points far more evenly.
  const ranks = blueNoiseMatrix(64);
  for (const level of [512, 2048, 3584]) {
    let variance = 0;
    for (let by = 0; by < 8; by++) for (let bx = 0; bx < 8; bx++) {
      let count = 0;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (ranks[(by * 8 + y) * 64 + bx * 8 + x] < level) count++;
      variance += (count - level / 64) ** 2 / 64;
    }
    assert.ok(variance < 5, `level ${level}: block variance ${variance}`);
  }
  // No two of the first 5% of points touch, even across the tile's wrap.
  const first = [...ranks].flatMap((rank, index) => rank < 205 ? [[index % 64, Math.floor(index / 64)]] : []);
  for (const [x, y] of first) assert.ok(!first.some(([u, v]) => (u !== x || v !== y) && Math.min(Math.abs(u - x), 64 - Math.abs(u - x)) <= 1 && Math.min(Math.abs(v - y), 64 - Math.abs(v - y)) <= 1));
  assert.equal(blueNoiseMatrix(16).length, 256);
  assert.throws(() => blueNoiseMatrix(48), RangeError);
});

test('duotone separation finds each ink, paper and their overprint', () => {
  const [pink, blue] = RISO_INKS['pink + blue'], close = (actual, expected) => actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-9, `${actual} ≈ ${expected}`));
  close(separateDuotone([255, 255, 255], pink, blue), [0, 0]);
  close(separateDuotone([0xff, 0x48, 0xb0], pink, blue), [1, 0]);
  close(separateDuotone([0x00, 0x78, 0xbf], pink, blue), [0, 1]);
  const [a, b] = separateDuotone([0, 0, 0], pink, blue);
  assert.ok(a > .9 && b === 1, 'black takes both inks');
  const [r, k] = separateDuotone([128, 128, 128], '#e8383d', '#2a2a2a');
  assert.ok(k > .5 && r < .1, 'grey goes to the black ink, not the red');
});

test('each look prints in its own inks on paper, with pinned bytes for the same settings', () => {
  const width = 48, height = 32, source = photo(width, height);
  const pinned = { riso: '0a9fd16fa46b1d45', halftone: '4b4019f249ce85c0', 'floyd-steinberg': '097ec634212388b9', bayer: 'ff798d50bdebd5a3', 'blue-noise': 'a0ea89b358f77ddc' };
  for (const look of PRINT_LOOKS) {
    const out = printPixels(source, width, height, { look, seed: 7, scale: 2 });
    assert.equal(digest(out), pinned[look], `${look} reproduces byte for byte`);
    assert.equal(digest(printPixels(source, width, height, { look, seed: 7, scale: 2 })), pinned[look]);
    const colors = new Set(); for (let index = 0; index < out.length; index += 4) colors.add(hex(out, index));
    if (look === 'riso') assert.ok([...colors].every(color => ['#f4efe6', '#f4439f', '#0070ac', '#002077'].includes(color)), [...colors].join());
    else if (look !== 'halftone') assert.deepEqual([...colors].sort(), [PRINT_INK, PRINT_PAPER]);
    else assert.ok(colors.has(PRINT_INK) && colors.has(PRINT_PAPER) && colors.size > 2, 'halftone dots have soft edges');
    for (let index = 3; index < out.length; index += 4) assert.equal(out[index], 255);
  }
  assert.equal(digest(printPixels(source, width, height, { look: 'floyd-steinberg', seed: 1, scale: 2 })), pinned['floyd-steinberg'], 'the seed only moves noise');
  assert.notEqual(digest(printPixels(source, width, height, { look: 'blue-noise', seed: 8, scale: 2 })), pinned['blue-noise'], 'a new seed, new grain');
  assert.notEqual(digest(printPixels(source, width, height, { look: 'riso', seed: 8, scale: 2 })), pinned.riso);
});

test('dithers keep the tone: the ink share follows the darkness, lightened in the midtones by dot gain', () => {
  const width = 64, height = 64;
  for (const look of ['floyd-steinberg', 'bayer', 'blue-noise', 'halftone']) for (const value of [64, 128, 192]) for (const dotGain of [0, PRINT_DOT_GAIN]) {
    // A flat image would be stretched to one end, so put each level beside black and white bars that pin the range.
    const source = flat(width, height, value);
    for (let y = 0; y < height; y++) for (let x = 0; x < 2; x++) { source.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3); source.fill(255, (y * width + 62 + x) * 4, (y * width + 62 + x) * 4 + 3); }
    const out = printPixels(source, width, height, { look, scale: 1, ink: '#000000', paper: '#ffffff', dotGain });
    let ink = 0, count = 0;
    for (let y = 8; y < 56; y++) for (let x = 8; x < 56; x++) { ink += 1 - out[(y * width + x) * 4] / 255; count++; }
    const dark = 1 - value / 255, expected = dark * (1 - dotGain) + dark * dark * dotGain;
    assert.ok(Math.abs(ink / count - expected) < .07, `${look} at ${value}, dot gain ${dotGain}: ${(ink / count).toFixed(3)} ≠ ${expected.toFixed(3)}`);
  }
});

test('scale prints chunkier cells, amount mixes over the original and 0 leaves it untouched', () => {
  const width = 40, height = 40, source = photo(width, height);
  const coarse = printPixels(source, width, height, { look: 'bayer', scale: 4 });
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) assert.equal(coarse[(y * width + x) * 4], coarse[((y - y % 4) * width + x - x % 4) * 4], 'each 4 × 4 cell is one ink');
  assert.deepEqual(printPixels(source, width, height, { amount: 0 }), source);
  const half = printPixels(source, width, height, { look: 'bayer', amount: 50 }), full = printPixels(source, width, height, { look: 'bayer' });
  for (let index = 0; index < source.length; index += 4) assert.ok(Math.abs(half[index] - (source[index] + full[index]) / 2) <= 1);
  const inPlace = source.slice();
  assert.equal(printPixels(inPlace, width, height, { look: 'halftone' }, inPlace), inPlace);
  assert.deepEqual(inPlace, printPixels(source, width, height, { look: 'halftone' }));
  const alpha = source.slice(); alpha[3] = 7; assert.equal(printPixels(alpha, width, height)[3], 7, 'alpha is kept');
  assert.throws(() => printPixels(source, width + 1, height), TypeError);
  assert.throws(() => printPixels([0, 0, 0, 255], 1, 1), TypeError);
  assert.throws(() => printPixels(new Uint8ClampedArray(4), 0, 1), RangeError);
});
