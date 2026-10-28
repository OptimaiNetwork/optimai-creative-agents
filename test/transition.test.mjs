import assert from 'node:assert/strict';
import test from 'node:test';
import { TRANSITION_DIRECTIONS, TRANSITION_LIMITS, TRANSITION_PACES, TRANSITION_STYLES, TRANSITION_TECHNIQUES, composeTransition, resolveTransition, transitionProgress, transitionTimes } from '../src/transition.mjs';

/** A width × height shot: a horizontal ramp on red, a vertical one on green and a fixed blue, so every pixel is distinct. */
function shot(width, height, blue) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set([Math.round(x * 255 / (width - 1)), Math.round(y * 255 / (height - 1)), blue, 77], (y * width + x) * 4);
  return pixels;
}
const solid = (width, height, value) => new Uint8ClampedArray(width * height * 4).fill(value);
const at = (pixels, width, x, y) => [...pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];

test('settings resolve from a pace, map every recipe technique and reject anything else', () => {
  assert.deepEqual({ ...resolveTransition() }, { style: 'radial', direction: 'right', ease: 'in-out', softness: 0.15, center: [0.5, 0.5] });
  assert.equal(Object.isFrozen(resolveTransition()), true);
  assert.deepEqual([resolveTransition({ pace: 'quick' }).softness, resolveTransition({ pace: 'slow cinematic' }).softness], [0.04, 0.35]);
  assert.equal(resolveTransition({ pace: 'slow cinematic', softness: 0 }).softness, 0);
  assert.deepEqual(Object.keys(TRANSITION_PACES), ['quick', 'gentle', 'slow cinematic']);
  for (const style of Object.values(TRANSITION_TECHNIQUES)) assert.ok(TRANSITION_STYLES.includes(style));
  assert.deepEqual(new Set(Object.values(TRANSITION_TECHNIQUES)).size, 4, 'each technique draws a different move');
  for (const options of [{ style: 'morph' }, { direction: 'north' }, { pace: 'rapid' }, { ease: 'bounce' }, { softness: -0.1 }, { softness: 2 }, { softness: NaN }, { center: [0.5] }, { center: [0.5, 1.2] }]) {
    assert.throws(() => resolveTransition(options), RangeError);
  }
});

test('progress eases from exactly 0 to exactly 1 and strip times are evenly spaced', () => {
  for (const ease of ['linear', 'in-out', 'out']) {
    assert.equal(transitionProgress(0, ease), 0); assert.equal(transitionProgress(1, ease), 1);
    let previous = -1; for (let t = 0; t <= 1; t += 0.05) { const value = transitionProgress(t, ease); assert.ok(value >= previous); previous = value; }
  }
  assert.equal(transitionProgress(0.5, 'in-out'), 0.5);
  assert.ok(transitionProgress(0.2, 'in-out') < 0.2 && transitionProgress(0.2, 'out') > 0.4, 'in-out starts slowly; out starts fast');
  assert.equal(transitionProgress(-3), 0); assert.equal(transitionProgress(7), 1);
  assert.throws(() => transitionProgress(NaN), RangeError); assert.throws(() => transitionProgress(0.5, 'bounce'), RangeError);
  assert.deepEqual(transitionTimes(5), [0, 0.25, 0.5, 0.75, 1]);
  assert.equal(transitionTimes(TRANSITION_LIMITS.frames).length, 12);
  for (const count of [0, 1, 13, 2.5]) assert.throws(() => transitionTimes(count), RangeError);
});

test('every style and direction starts on the first shot, ends on the second and is opaque', () => {
  const [width, height] = [9, 7], from = shot(width, height, 10), to = shot(height, width, 240);
  for (const style of TRANSITION_STYLES) for (const direction of TRANSITION_DIRECTIONS) for (const softness of [0, 0.3]) {
    const first = composeTransition(from, to, width, height, 0, { style, direction, softness });
    const last = composeTransition(from, to, width, height, 1, { style, direction, softness });
    for (let index = 0; index < from.length; index += 4) {
      assert.deepEqual([...first.subarray(index, index + 3), first[index + 3]], [...from.subarray(index, index + 3), 255], `${style} ${direction} at 0`);
      assert.deepEqual([...last.subarray(index, index + 3), last[index + 3]], [...to.subarray(index, index + 3), 255], `${style} ${direction} at 1`);
    }
  }
});

test('a hard wipe splits the frame at the progress line in its direction', () => {
  const [width, height] = [10, 4], from = solid(width, height, 0), to = solid(width, height, 200);
  const right = composeTransition(from, to, width, height, 0.5, { style: 'wipe', softness: 0 });
  assert.deepEqual(Array.from({ length: width }, (_, x) => at(right, width, x, 1)[0]), [200, 200, 200, 200, 200, 0, 0, 0, 0, 0]);
  const left = composeTransition(from, to, width, height, 0.5, { style: 'wipe', direction: 'left', softness: 0 });
  assert.deepEqual(Array.from({ length: width }, (_, x) => at(left, width, x, 1)[0]), [0, 0, 0, 0, 0, 200, 200, 200, 200, 200]);
  const up = composeTransition(from, to, width, height, 0.4, { style: 'wipe', direction: 'up', softness: 0 });
  assert.deepEqual(Array.from({ length: height }, (_, y) => at(up, width, 3, y)[0]), [0, 0, 200, 200]);
  // A feathered edge ramps monotonically through in-between values.
  const soft = composeTransition(from, to, width, height, 0.5, { style: 'wipe', softness: 0.6 });
  const ramp = Array.from({ length: width }, (_, x) => at(soft, width, x, 0)[0]);
  assert.ok(ramp.every((value, x) => x === 0 || value <= ramp[x - 1]));
  assert.ok(ramp.filter(value => value > 0 && value < 200).length >= 4);
});

test('a radial iris opens from its centre, which can sit on the subject', () => {
  const [width, height] = [21, 21], from = solid(width, height, 0), to = solid(width, height, 250);
  const frame = composeTransition(from, to, width, height, 0.4, { style: 'radial', softness: 0 });
  assert.equal(at(frame, width, 10, 10)[0], 250); assert.equal(at(frame, width, 0, 0)[0], 0); assert.equal(at(frame, width, 10, 0)[0], 0);
  const offset = composeTransition(from, to, width, height, 0.3, { style: 'radial', softness: 0, center: [0.2, 0.2] });
  assert.equal(at(offset, width, 4, 4)[0], 250); assert.equal(at(offset, width, 10, 10)[0], 0);
  assert.equal(composeTransition(from, to, width, height, 0, { style: 'radial', softness: 0 })[(10 * width + 10) * 4], 0, 'progress 0 is still the first shot');
});

test('a luma transition lets the brightest parts of the first shot give way first', () => {
  const [width, height] = [4, 1], from = new Uint8ClampedArray([250, 250, 250, 255, 170, 170, 170, 255, 90, 90, 90, 255, 10, 10, 10, 255]), to = solid(width, height, 128);
  const frame = composeTransition(from, to, width, height, 0.5, { style: 'luma', softness: 0 });
  assert.deepEqual([0, 1, 2, 3].map(x => at(frame, width, x, 0)[0]), [128, 128, 90, 10]);
});

test('a push slides both shots together without blending pixels', () => {
  const [width, height] = [8, 3], from = shot(width, height, 1), to = shot(width, height, 2);
  const right = composeTransition(from, to, width, height, 0.25, { style: 'push' });
  // Two columns of the incoming shot's right edge followed by the outgoing shot, moved two columns right.
  assert.deepEqual([0, 1, 2, 7].map(x => at(right, width, x, 1)), [at(to, width, 6, 1), at(to, width, 7, 1), at(from, width, 0, 1), at(from, width, 5, 1)].map(([r, g, b]) => [r, g, b, 255]));
  const up = composeTransition(from, to, width, height, 1 / 3, { style: 'push', direction: 'up' });
  assert.deepEqual([0, 1, 2].map(y => at(up, width, 4, y)), [at(from, width, 4, 1), at(from, width, 4, 2), at(to, width, 4, 0)].map(([r, g, b]) => [r, g, b, 255]));
  assert.throws(() => composeTransition(from, to, width, height, 0.5, { style: 'push' }, from), /separate output/);
});

test('matte styles give identical bytes in place and into a new buffer, and reject malformed input', () => {
  const [width, height] = [16, 9], from = shot(width, height, 30), to = shot(width, height, 200);
  for (const style of ['wipe', 'radial', 'luma', 'dissolve']) {
    const fresh = composeTransition(from, to, width, height, 0.37, { style });
    const inPlace = from.slice(); composeTransition(inPlace, to, width, height, 0.37, { style }, inPlace);
    assert.deepEqual(inPlace, fresh, style);
  }
  const dissolve = composeTransition(solid(1, 1, 0), solid(1, 1, 200), 1, 1, 0.25, { style: 'dissolve' });
  assert.deepEqual([...dissolve], [50, 50, 50, 255]);
  assert.throws(() => composeTransition(from, to.subarray(4), width, height, 0.5), TypeError);
  assert.throws(() => composeTransition(from, [...to], width, height, 0.5), TypeError);
  assert.throws(() => composeTransition(from, to, width, height, 1.5), RangeError);
  assert.throws(() => composeTransition(from, to, 0, height, 0.5), RangeError);
});
