import assert from 'node:assert/strict';
import test from 'node:test';
import { computeFocusMap } from '../src/smart-crop.mjs';
import { contrastRatio } from '../src/color.mjs';
import { checkTextOverlap } from '../src/verify.mjs';
import { PLACEMENT_LIMITS, TEXT_POSITIONS, chooseTitleInk, fitScrim, placeTextBlock, regionInterest } from '../src/text-placement.mjs';

/** A flat grey scene with a saturated, detailed subject in `box` (fractions of the frame). */
function scene(width, height, box) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const inside = box && x >= box.x * width && x < (box.x + box.width) * width && y >= box.y * height && y < (box.y + box.height) * height;
    pixels.set(inside ? ((x + y) % 4 < 2 ? [236, 78, 52, 255] : [252, 214, 96, 255]) : [118, 124, 120, 255], (y * width + x) * 4);
  }
  return pixels;
}

const canvas = { width: 1200, height: 1500 };
const block = { width: 700, height: 300 };
const bounds = { x: 96, y: 150, width: 1008, height: 1170 };
const focusOf = (box, width = 80, height = 100) => ({ map: computeFocusMap(scene(width, height, box), width, height), width, height });

test('interest under a region is relative to the image mean, exact for whole cells and zero on a flat map', () => {
  const map = new Float32Array(16); map[5] = 16; // one hot cell in a 4 × 4 map; the image mean is 1
  const focus = { map, width: 4, height: 4 };
  const size = { width: 4, height: 4 };
  assert.equal(regionInterest(focus, { x: 1, y: 1, width: 1, height: 1 }, size), 16);
  assert.equal(regionInterest(focus, { x: 0, y: 0, width: 2, height: 2 }, size), 4);
  assert.equal(regionInterest(focus, { x: 2, y: 2, width: 2, height: 2 }, size), 0);
  assert.equal(regionInterest(focus, { x: 1, y: 1, width: .5, height: 1 }, size), 16, 'Inside one cell the table is linear.');
  assert.equal(regionInterest(focus, { x: 0, y: 0, width: 400, height: 400 }, { width: 400, height: 400 }), regionInterest(focus, { x: 0, y: 0, width: 4, height: 4 }, size), 'Canvas pixels scale to map cells.');
  assert.equal(regionInterest({ map: new Float32Array(16), width: 4, height: 4 }, { x: 0, y: 0, width: 4, height: 4 }, size), 0);
  assert.throws(() => regionInterest({ map: [1], width: 1, height: 1 }, { x: 0, y: 0, width: 1, height: 1 }, size), /focus map/);
  assert.throws(() => regionInterest(focus, { x: 0, y: 0, width: -1, height: 1 }, size), /Region/);
  assert.throws(() => regionInterest(focus, { x: 0, y: 0, width: 1, height: 1 }, { width: 0, height: 4 }), /canvas/);
});

test('auto placement leaves a busy subject alone and lands in the calmest band', () => {
  // A subject in the lower half (a car on a road): the title moves up instead of covering it.
  const low = focusOf({ x: .15, y: .55, width: .7, height: .35 });
  const home = placeTextBlock(low, { canvas, block, bounds, position: 'bottom' });
  const auto = placeTextBlock(low, { canvas, block, bounds });
  assert.equal(home.position, 'bottom'); assert.equal(home.moved, false);
  assert.notEqual(auto.position, 'bottom'); assert.equal(auto.moved, true);
  assert.ok(auto.y + auto.height <= canvas.height * .55 - 40, 'The title ends above the subject, with some air.');
  assert.ok(auto.interest < home.interest / 4, `${auto.interest} is far calmer than ${home.interest}.`);
  const share = rect => 1 - checkTextOverlap(low, [{ x: rect.x / canvas.width, y: rect.y / canvas.height, width: rect.width / canvas.width, height: rect.height / canvas.height }]).score;
  assert.ok(share(auto) < .05 && share(home) > .3, 'The tier-0 overlap check agrees.');
  assert.ok(auto.x >= bounds.x && auto.y >= bounds.y && auto.x + auto.width <= bounds.x + bounds.width + 1e-9 && auto.y + auto.height <= bounds.y + bounds.height + 1e-9, 'The block stays inside its bounds.');
  // A subject at the top keeps the usual bottom spot; one on the left sends a left-aligned title right.
  assert.equal(placeTextBlock(focusOf({ x: .2, y: .05, width: .6, height: .3 }), { canvas, block, bounds }).moved, false);
  const side = placeTextBlock(focusOf({ x: .05, y: .1, width: .3, height: .85 }), { canvas, block: { width: 400, height: 300 }, bounds, columns: 3 });
  assert.ok(side.x > bounds.x + 500, `A left-hand subject moves the title right (x = ${side.x}).`);
});

test('flat, absent and evenly busy maps keep the home spot; fixed positions never search', () => {
  for (const focus of [null, focusOf(null)]) {
    const place = placeTextBlock(focus, { canvas, block, bounds, home: { x: 0, y: .5 } });
    assert.deepEqual([place.x, place.y, place.moved, place.position], [96, 150 + (1170 - 300) / 2, false, 'center']);
  }
  const noise = Uint8ClampedArray.from({ length: 64 * 80 * 4 }, (_, index) => index % 4 === 3 ? 255 : (index * 2654435761 >>> 24));
  assert.equal(placeTextBlock({ map: computeFocusMap(noise, 64, 80), width: 64, height: 80 }, { canvas, block, bounds }).position, 'bottom', 'Texture everywhere gives no reason to move.');
  const low = focusOf({ x: .15, y: .55, width: .7, height: .35 });
  for (const position of ['top', 'center', 'bottom']) {
    const place = placeTextBlock(low, { canvas, block, bounds, position });
    assert.equal(place.position, position); assert.equal(place.moved, false);
  }
  assert.equal(placeTextBlock(low, { canvas, block, bounds, homeBias: 50 }).moved, false, 'A strong home bias keeps the layout.');
  const weak = placeTextBlock(low, { canvas, block, bounds, minGain: 100 });
  assert.deepEqual([weak.moved, weak.position], [false, 'bottom'], 'A gain below minGain keeps the layout.');
  assert.equal(placeTextBlock(low, { canvas, block: { width: 2000, height: 2000 }, bounds }).y, bounds.y, 'An oversized block pins to the bounds.');
  assert.deepEqual(TEXT_POSITIONS, ['auto', 'top', 'center', 'bottom']);
  assert.throws(() => placeTextBlock(low, { canvas, block, position: 'left' }), /position/);
  assert.throws(() => placeTextBlock(low, { block, bounds }), /canvas/);
  assert.throws(() => placeTextBlock(low, { canvas, block: { width: NaN, height: 1 } }), /Block/);
  // The candidate grid is bounded, so huge requests stay cheap.
  const started = performance.now();
  placeTextBlock(low, { canvas, block: { width: 100, height: 100 }, bounds, columns: 1e6, rows: 1e6 });
  assert.ok(performance.now() - started < 200 && PLACEMENT_LIMITS.maxSteps === 33);
});

test('a scrim appears only when contrast fails, at the lightest opacity that passes', () => {
  assert.equal(fitScrim(['#101312', '#202522'], '#ffffff'), null, 'White already reads over a dark photo.');
  const sky = ['#ecf0f4', '#d6dee6'];
  const scrim = fitScrim(sky, '#ffffff', { minContrast: 3 });
  assert.equal(scrim.color, '#000000'); assert.equal(scrim.passes, true);
  assert.ok(scrim.surfaces.every(surface => contrastRatio('#ffffff', surface) >= 3));
  const lighter = fitScrim(sky, '#ffffff', { minContrast: 3, maxOpacity: scrim.opacity - .01 });
  assert.equal(lighter.passes, false, 'One step lighter would fail.');
  assert.equal(fitScrim(['#111111'], '#222222').color, '#ffffff', 'Dark ink gets a light scrim.');
  assert.equal(fitScrim(sky, '#ffffff', { color: '#203040' }).color, '#203040');
  assert.equal(fitScrim(['#b0b0b0'], '#ffffff', { minOpacity: .3 }).opacity, .3, 'A floor keeps a scrim visible.');
  assert.ok(chooseTitleInk(sky, { prefer: ['#ffffff'] }).scrim.opacity >= .15);
  assert.equal(fitScrim([{ color: '#ecf0f4', weight: 1 }], '#ffffff').passes, true, 'Takes analyzeImageColors surfaces.');
  assert.throws(() => fitScrim([], '#fff'), /background/);
  assert.throws(() => fitScrim(sky, '#fff', { maxOpacity: .95 }), /maxOpacity/);
  assert.throws(() => fitScrim(sky, '#fff', { minContrast: 30 }), /minContrast/);
});

test('title ink keeps the creator color behind a scrim instead of greying it out', () => {
  const sky = [{ color: '#ecf0f4' }, { color: '#d6dee6' }];
  const white = chooseTitleInk(sky, { prefer: [null, '#ffffff'] });
  assert.equal(white.ink, '#ffffff'); assert.equal(white.scrim.color, '#000000');
  assert.ok(white.surfaces.every(surface => contrastRatio('#ffffff', surface) >= 3));
  const off = chooseTitleInk(sky, { prefer: ['#ffffff'], scrim: false });
  assert.equal(off.scrim, null); assert.ok(contrastRatio(off.ink, '#ecf0f4') >= 3, 'With the scrim off the lightness moves, as before.');
  const nudge = chooseTitleInk(['#6a7076'], { prefer: ['#e8e8e8'] });
  assert.equal(nudge.scrim, null, 'A small lightness move is enough; no scrim.');
  assert.deepEqual(chooseTitleInk(['#101312'], { prefer: ['#c6f87d'] }), { ink: '#c6f87d', scrim: null, surfaces: ['#101312'] });
  // Over white and black, a light grey needs more than a 20% scrim, so the ink also moves over what the scrim leaves.
  const hard = chooseTitleInk(['#ffffff', '#000000'], { prefer: ['#c0c0c0'], maxOpacity: .2 });
  assert.deepEqual(hard.scrim, { color: '#000000', opacity: .2 });
  assert.notEqual(hard.ink, '#c0c0c0');
  assert.ok(hard.surfaces.every(surface => contrastRatio(hard.ink, surface) >= 3));
});
