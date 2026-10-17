import assert from 'node:assert/strict';
import test from 'node:test';
import { SMART_CROP_LIMITS, analyzeImageFocus, computeFocusMap, findFocusCrop, focusCoverRect } from '../src/smart-crop.mjs';

/** A flat gray scene with a saturated, detailed subject in the given box (fractions of the frame). */
export function scene(width, height, box = null, background = [118, 124, 120, 255]) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4;
    const inside = box && x >= box.x * width && x < (box.x + box.width) * width && y >= box.y * height && y < (box.y + box.height) * height;
    pixels.set(inside ? ((x + y) % 4 < 2 ? [236, 78, 52, 255] : [252, 214, 96, 255]) : background, offset);
  }
  return pixels;
}
const centre = crop => ({ x: crop.x + crop.width / 2, y: crop.y + crop.height / 2 });
const contains = (crop, box) => crop.x <= box.x + 1e-9 && crop.x + crop.width >= box.x + box.width - 1e-9 && crop.y <= box.y + 1e-9 && crop.y + crop.height >= box.y + box.height - 1e-9;

test('flat, uniform and fully transparent images keep an exactly centred cover crop', () => {
  for (const pixels of [scene(96, 48), new Uint8ClampedArray(96 * 48 * 4)]) {
    const map = computeFocusMap(pixels, 96, 48);
    assert.ok(map.every(value => value === 0));
    assert.deepEqual(findFocusCrop(map, 96, 48, 1), { x: 0.25, y: 0, width: 0.5, height: 1 });
  }
  const noise = Uint8ClampedArray.from({ length: 64 * 64 * 4 }, (_, index) => index % 4 === 3 ? 255 : (index * 2654435761 >>> 24));
  const crop = findFocusCrop(computeFocusMap(noise, 64, 64), 64, 64, 16 / 9);
  assert.ok(Math.abs(centre(crop).y - 0.5) < 0.12, 'Texture spread over the frame stays near the centre.');
});

test('a subject off to one side pulls a horizontal crop over it', () => {
  for (const box of [{ x: 0.78, y: 0.3, width: 0.16, height: 0.4 }, { x: 0.04, y: 0.5, width: 0.14, height: 0.3 }]) {
    const crop = findFocusCrop(computeFocusMap(scene(96, 48, box), 96, 48), 96, 48, 1);
    assert.equal(crop.width, 0.5);
    assert.ok(contains(crop, box), `The square crop ${JSON.stringify(crop)} keeps the subject ${JSON.stringify(box)}.`);
  }
});

test('a subject near the top of a portrait image pulls a wide crop up', () => {
  const box = { x: 0.35, y: 0.06, width: 0.3, height: 0.18 };
  const crop = findFocusCrop(computeFocusMap(scene(48, 96, box), 48, 96), 48, 96, 16 / 9);
  assert.equal(crop.x, 0);
  assert.ok(crop.y < 0.1 && contains(crop, box), JSON.stringify(crop));
});

test('transparent pixels contribute no interest, even when they hide detail', () => {
  const hidden = { x: 0.06, y: 0.2, width: 0.2, height: 0.5 };
  const pixels = scene(96, 48, hidden);
  for (let index = 3; index < pixels.length; index += 4) if ((index >> 2) % 96 < 48) pixels[index] = 0;
  assert.deepEqual(findFocusCrop(computeFocusMap(pixels, 96, 48), 96, 48, 1).x, 0.25, 'Hidden detail alone does not move the crop.');
  const visible = { x: 0.8, y: 0.3, width: 0.14, height: 0.4 };
  const both = scene(96, 48, visible);
  pixels.forEach((value, index) => { if (((index >> 2) % 96) >= 48) pixels[index] = both[index]; });
  const crop = findFocusCrop(computeFocusMap(pixels, 96, 48), 96, 48, 1);
  assert.ok(contains(crop, visible), `The crop follows the visible subject: ${JSON.stringify(crop)}.`);
});

test('matching aspects, invalid maps and options are handled without guessing', () => {
  const map = computeFocusMap(scene(40, 20, { x: 0.8, y: 0, width: 0.2, height: 1 }), 40, 20);
  assert.deepEqual(findFocusCrop(map, 40, 20, 2), { x: 0, y: 0, width: 1, height: 1 });
  assert.throws(() => computeFocusMap(new Uint8ClampedArray(8), 4, 4), /RGBA bytes/);
  assert.throws(() => computeFocusMap([], 4, 4), /RGBA bytes/);
  assert.throws(() => computeFocusMap(new Uint8ClampedArray(4), 0, 1), /whole-pixel/);
  assert.throws(() => computeFocusMap(new Uint8ClampedArray(4), 1.5, 1), /whole-pixel/);
  assert.throws(() => computeFocusMap(new Uint8ClampedArray(4 * 513 * 513), 513, 513), /at most/);
  assert.throws(() => findFocusCrop(new Float32Array(3), 2, 2, 1), /computeFocusMap/);
  assert.throws(() => findFocusCrop(map, 40, 20, 0), /positive/);
  assert.throws(() => findFocusCrop(map, 40, 20, Number.NaN), /positive/);
  const right = findFocusCrop(map, 40, 20, 1, { edgeFalloff: 'x', centerBias: 7 });
  assert.ok(right.x > 0.25 && right.x + right.width <= 1 + 1e-9);
  assert.equal(SMART_CROP_LIMITS.analysisEdge, 96);
});

test('cover rectangles keep the exact target aspect inside the source and default to centred', () => {
  assert.deepEqual(focusCoverRect(600, 300, 300, 300), { x: 150, y: 0, width: 300, height: 300 });
  assert.deepEqual(focusCoverRect(300, 600, 160, 90), { x: 0, y: 215.625, width: 300, height: 168.75 });
  const focus = { map: computeFocusMap(scene(96, 48, { x: 0.86, y: 0.2, width: 0.12, height: 0.6 }), 96, 48), width: 96, height: 48 };
  for (const [width, height] of [[300, 300], [1, 1], [90, 160], [1200, 300]]) {
    const area = focusCoverRect(600, 300, width, height, focus);
    assert.ok(area.x >= 0 && area.y >= 0 && area.x + area.width <= 600 + 1e-9 && area.y + area.height <= 300 + 1e-9, JSON.stringify(area));
    assert.ok(Math.abs(area.width / area.height - width / height) < 1e-9);
  }
  assert.equal(focusCoverRect(600, 300, 300, 300, focus).x, 300, 'A subject at the edge clamps the crop to the edge.');
  assert.throws(() => focusCoverRect(0, 1, 1, 1), /positive/);
});

test('analysis reads at most a 96-pixel thumbnail, releases it and degrades to null', () => {
  const previous = globalThis.OffscreenCanvas;
  const canvases = [];
  try {
    assert.equal(analyzeImageFocus({}, 1200, 600), null, 'No canvas reader means a centred crop.');
    globalThis.OffscreenCanvas = class {
      constructor(width, height) { this.width = width; this.height = height; canvases.push(this); }
      getContext() {
        const canvas = this;
        return { drawImage(source, x, y, width, height) { assert.deepEqual([x, y, width, height], [0, 0, canvas.width, canvas.height]); },
          getImageData(x, y, width, height) { return { data: scene(width, height, { x: 0.1, y: 0.1, width: 0.2, height: 0.5 }) }; } };
      }
    };
    const focus = analyzeImageFocus({}, 1200, 600);
    assert.deepEqual([focus.width, focus.height], [96, 48]);
    assert.equal(focus.map.length, 96 * 48);
    assert.deepEqual([canvases[0].width, canvases[0].height], [1, 1], 'The analysis canvas is released.');
    assert.deepEqual([analyzeImageFocus({}, 40, 30).width, analyzeImageFocus({}, 40, 30).height], [40, 30], 'Small images are never upscaled.');
    assert.equal(analyzeImageFocus(null, 10, 10), null);
    assert.equal(analyzeImageFocus({}, 0, 10), null);
    globalThis.OffscreenCanvas = class { getContext() { return { drawImage() {}, getImageData() { throw new DOMException('Tainted.', 'SecurityError'); } }; } };
    assert.equal(analyzeImageFocus({}, 100, 100), null, 'A tainted canvas keeps the centred crop.');
    globalThis.OffscreenCanvas = class { getContext() { return null; } };
    assert.equal(analyzeImageFocus({}, 100, 100), null);
  } finally { if (previous === undefined) delete globalThis.OffscreenCanvas; else globalThis.OffscreenCanvas = previous; }
});
