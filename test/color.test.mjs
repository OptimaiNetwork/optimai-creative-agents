import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COLOR_LIMITS, analyzeImageColors, contrastRatio, dominantColors, formatHexColor, fromOklab, fromOklch, lightnessContrast,
  mixColors, parseHexColor, pickAccentColor, pickLegibleColor, relativeLuminance, toOklab, toOklch,
} from '../src/color.mjs';

const hue = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
/** RGBA pixels filled by vertical bands: [[fraction, [r, g, b, a?]], …]. */
function bands(width, height, stripes) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let x = 0; x < width; x++) {
    let edge = 0; const [, color] = stripes.find(([share]) => x < width * (edge += share)) ?? stripes.at(-1);
    for (let y = 0; y < height; y++) pixels.set([...color.slice(0, 3), color[3] ?? 255], (y * width + x) * 4);
  }
  return pixels;
}

test('hex, OKLab and OKLCH round-trip every 12-bit color exactly and match reference values', () => {
  for (let value = 0; value < 4096; value++) {
    const hex = `#${value.toString(16).padStart(3, '0')}`;
    const full = formatHexColor(parseHexColor(hex));
    assert.equal(fromOklch(toOklch(hex)), full);
    assert.equal(fromOklab(toOklab(full)), full);
  }
  const [L, C, h] = toOklch('#ff0000');
  assert.ok(Math.abs(L - 0.628) < 1e-3 && Math.abs(C - 0.2577) < 1e-3 && Math.abs(h - 29.23) < 0.05);
  assert.deepEqual(toOklch('#ffffff').map(value => Math.round(value * 1000) / 1000), [1, 0, 0]);
  assert.deepEqual(parseHexColor('#AbC'), [170, 187, 204]);
  assert.equal(formatHexColor([300, -4, 127.6]), '#ff0080');
  for (const bad of ['red', '#12345', 'url(x)', 42]) assert.throws(() => parseHexColor(bad), /hex color/);
  assert.throws(() => toOklab([0, 0, 256]), /0–255/);
  assert.throws(() => fromOklch([0.5, -1, 0]), /C ≥ 0/);
});

test('out-of-gamut OKLCH keeps its lightness and hue and loses only chroma', () => {
  for (const [L, C, h] of [[0.7, 0.4, 30], [0.9, 0.3, 140], [0.3, 0.35, 265], [0.55, 0.5, 200]]) {
    const mapped = toOklch(fromOklch([L, C, h]));
    assert.ok(Math.abs(mapped[0] - L) < 0.01, `L ${L} stays put (${mapped[0]}).`);
    assert.ok(hue(mapped[2], h) < 3, `hue ${h} stays put (${mapped[2]}).`);
    assert.ok(mapped[1] < C);
  }
  assert.equal(fromOklab([1.4, 0, 0]), '#ffffff');
  assert.equal(fromOklab([-1, 0, 0]), '#000000');
});

test('perceptual mixing, WCAG contrast and polarity-aware lightness contrast', () => {
  assert.equal(mixColors('#ff0000', '#0000ff', 0), '#ff0000');
  assert.equal(mixColors('#ff0000', '#0000ff', 1), '#0000ff');
  assert.ok(Math.abs(toOklab(mixColors('#000', '#fff'))[0] - 0.5) < 0.005, 'Halfway is perceptually mid-grey, not #808080.');
  assert.ok(toOklch(mixColors('#ff0000', '#0000ff'))[1] > 0.1, 'An OKLab mix of red and blue stays colorful.');
  assert.equal(contrastRatio('#000', '#fff'), 21);
  assert.ok(Math.abs(contrastRatio('#777777', '#ffffff') - 4.48) < 0.01);
  assert.equal(relativeLuminance([255, 255, 255]), 1);
  assert.ok(lightnessContrast('#000', '#fff') > 99 && lightnessContrast('#fff', '#000') < -99);
  assert.equal(Math.round(lightnessContrast('#808080', '#808080')), 0);
});

test('a legible color keeps a passing ink and otherwise moves only its lightness, as little as needed', () => {
  const kept = pickLegibleColor(['#101312', { color: '#29372b' }], { prefer: '#c6f87d' });
  assert.deepEqual([kept.color, kept.passes, kept.adjusted], ['#c6f87d', true, false]);
  const sky = ['#e8eef5', '#cfd8e0'];
  const tuned = pickLegibleColor(sky, { prefer: '#c6f87d', minContrast: 3 });
  assert.equal(tuned.passes, true); assert.equal(tuned.adjusted, true);
  assert.ok(tuned.contrast >= 3 && sky.every(surface => contrastRatio(tuned.color, surface) >= 3));
  assert.ok(hue(toOklch(tuned.color)[2], toOklch('#c6f87d')[2]) < 4, 'The creator’s hue survives.');
  assert.ok(toOklch(tuned.color)[0] < toOklch('#c6f87d')[0]);
  const nearer = fromOklch([toOklch(tuned.color)[0] + 0.01, ...toOklch(tuned.color).slice(1)]);
  assert.ok(Math.min(...sky.map(surface => contrastRatio(nearer, surface))) < 3, 'One step closer to the original would fail.');
  const order = pickLegibleColor('#f4f4f4', { prefer: [null, '#ff3366', '#ffffff'], minContrast: 3 });
  assert.ok(hue(toOklch(order.color)[2], toOklch('#ff3366')[2]) < 4, 'Preferences are tried in order.');
  const split = pickLegibleColor(['#000000', '#ffffff'], { prefer: '#c6f87d' });
  assert.equal(split.passes, false);
  assert.ok(split.contrast > 4.4, 'Over black and white the best is a mid tone, not white or black.');
  assert.equal(pickLegibleColor('#0b100e').color, '#ffffff');
  assert.throws(() => pickLegibleColor([]), /between 1 and 64/);
  assert.throws(() => pickLegibleColor('#fff', { minContrast: 30 }), /1 to 21/);
  assert.throws(() => pickLegibleColor('#fff', { prefer: 'javascript:alert(1)' }), /hex color/);
});

test('dominant colors are deterministic, alpha-weighted and recover the actual areas', () => {
  const pixels = bands(100, 10, [[0.5, [30, 60, 140]], [0.3, [240, 200, 40]], [0.2, [250, 250, 250]]]);
  const palette = dominantColors(pixels, 100, 10, { count: 4 });
  assert.deepEqual(palette, dominantColors(pixels, 100, 10, { count: 4 }));
  assert.deepEqual(palette.map(swatch => swatch.color), ['#1e3c8c', '#f0c828', '#fafafa']);
  assert.deepEqual(palette.map(swatch => Math.round(swatch.weight * 100)), [50, 30, 20]);
  assert.equal(pickAccentColor(palette), '#1e3c8c');
  assert.equal(pickAccentColor(palette, { minWeight: 0.6 }), null);
  assert.equal(pickAccentColor(dominantColors(bands(8, 8, [[0.5, [20, 20, 20]], [0.5, [200, 200, 200]]]), 8, 8)), null, 'A neutral image has no accent.');
  const ghost = dominantColors(bands(40, 10, [[0.5, [255, 0, 0, 255]], [0.5, [0, 0, 255, 0]]]), 40, 10);
  assert.deepEqual(ghost.map(swatch => [swatch.color, swatch.weight]), [['#ff0000', 1]], 'Transparent pixels add no color.');
  assert.deepEqual(dominantColors(new Uint8ClampedArray(16), 2, 2), []);
  const noise = Uint8ClampedArray.from({ length: 512 * 512 * 4 }, (_, index) => index % 4 === 3 ? 255 : (index * 2654435761) >>> 24);
  const started = performance.now(); const busy = dominantColors(noise, 512, 512, { count: COLOR_LIMITS.maxColors });
  assert.ok(performance.now() - started < 1500 && busy.length <= COLOR_LIMITS.maxColors);
  assert.ok(Math.abs(busy.reduce((sum, swatch) => sum + swatch.weight, 0) - 1) < 1e-9);
  assert.throws(() => dominantColors(pixels, 100, 10, { count: 13 }), /1 to 12/);
  assert.throws(() => dominantColors(pixels, 100, 9), /RGBA bytes/);
  assert.throws(() => dominantColors(new Uint8ClampedArray(4 * 600 * 600), 600, 600), /thumbnail/);
});

test('image color analysis reads a bounded thumbnail of the requested region, or nothing', () => {
  assert.equal(analyzeImageColors({}, 100, 100), null, 'Without a canvas there is no analysis.');
  const previous = globalThis.OffscreenCanvas, reads = [];
  globalThis.OffscreenCanvas = class {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() { const canvas = this; return { drawImage(...args) { reads.push({ args, width: canvas.width, height: canvas.height }); }, getImageData: (x, y, width, height) => ({ data: bands(width, height, [[1, [250, 240, 230]]]) }) }; }
  };
  try {
    const palette = analyzeImageColors({ id: 'frame' }, 1200, 1500, { region: { x: 100, y: 1200, width: 1000, height: 400 }, count: 3 });
    assert.deepEqual(palette.map(swatch => swatch.color), ['#faf0e6']);
    assert.deepEqual(reads[0].args.slice(1), [100, 1200, 1000, 300, 0, 0, 64, 19], 'The region is clamped to the source and read at 64 pixels.');
    assert.equal(analyzeImageColors(null, 10, 10), null);
    globalThis.OffscreenCanvas = class { getContext() { return { drawImage() {}, getImageData() { throw new DOMException('Tainted.', 'SecurityError'); } }; } };
    assert.equal(analyzeImageColors({}, 10, 10), null, 'A tainted canvas disables analysis instead of failing the render.');
  } finally { if (previous === undefined) delete globalThis.OffscreenCanvas; else globalThis.OffscreenCanvas = previous; }
});
