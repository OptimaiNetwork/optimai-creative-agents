import test from 'node:test';
import assert from 'node:assert/strict';
import { ONE_EURO_DEFAULTS, createOneEuroFilter, createOneEuroVectorFilter, oneEuroAlpha } from '../src/landmark-filter.mjs';
import { FACE_RIG_FILTER, NEUTRAL_FACE, createFaceRigSmoother, smoothFaceRig } from '../src/camera-runtime.mjs';

const FRAME = 1000 / 30;
const noise = (seed = 7) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 - .5; };
const sd = values => { const mean = values.reduce((a, b) => a + b, 0) / values.length; return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length); };

test('the scalar filter primes on its first sample, holds on bad timestamps or values, and resets', () => {
  assert.ok(Math.abs(oneEuroAlpha(1, 1 / (2 * Math.PI)) - .5) < 1e-12);
  const filter = createOneEuroFilter({ minCutoff: 1, beta: 0 });
  assert.equal(filter.value, null);
  assert.equal(filter.filter(5, 100), 5);
  for (let i = 1; i < 20; i += 1) assert.equal(filter.filter(5, 100 + i * FRAME), 5, 'a constant signal never drifts');
  const moved = filter.filter(6, 100 + 20 * FRAME);
  assert.ok(moved > 5 && moved < 6);
  assert.equal(filter.filter(9, 100 + 20 * FRAME), moved, 'a repeated timestamp cannot produce a rate');
  assert.equal(filter.filter(9, 50), moved, 'a timestamp from the past holds the output');
  assert.equal(filter.filter(NaN, 100 + 21 * FRAME), moved, 'a missing value holds the output');
  filter.reset(); assert.equal(filter.value, null); assert.equal(filter.filter(-2, 0), -2);
});

test('invalid tuning falls back to defaults and sizes are bounded', () => {
  const tuned = createOneEuroFilter({ minCutoff: -1, beta: NaN, dCutoff: Infinity }), plain = createOneEuroFilter(ONE_EURO_DEFAULTS);
  const random = noise(3);
  for (let i = 0; i < 30; i += 1) { const x = random(); assert.equal(tuned.filter(x, i * FRAME), plain.filter(x, i * FRAME)); }
  assert.throws(() => createOneEuroVectorFilter(0), RangeError);
  assert.throws(() => createOneEuroVectorFilter(1.5), RangeError);
  assert.throws(() => createOneEuroVectorFilter(2).filter([1], 0), RangeError);
  assert.equal(createOneEuroVectorFilter(4, { stride: 3 }).stride, 1, 'a stride that does not divide the size is ignored');
});

test('speed adaptation: at rest the filter is stiller, on a fast move it lags less than a fixed low-pass', () => {
  const rest = createOneEuroFilter({ minCutoff: .5, beta: 2 }), fixed = createOneEuroFilter({ minCutoff: .5, beta: 0 }), fast = createOneEuroFilter({ minCutoff: .5, beta: 2 });
  const random = noise(11), restOut = [], fixedOut = [];
  for (let i = 0; i < 200; i += 1) { const x = .2 + random() * .02; restOut.push(rest.filter(x, i * FRAME)); fixedOut.push(fixed.filter(x, i * FRAME)); }
  assert.ok(sd(restOut.slice(60)) < .002, 'jitter is suppressed at rest');
  let adaptiveLag = 0, fixedLag = 0; const slow = createOneEuroFilter({ minCutoff: .5, beta: 0 });
  for (let i = 0; i < 30; i += 1) { const x = i * .05; adaptiveLag = x - fast.filter(x, i * FRAME); fixedLag = x - slow.filter(x, i * FRAME); }
  assert.ok(adaptiveLag < fixedLag / 3, `adaptive lag ${adaptiveLag} vs fixed ${fixedLag}`);
});

test('vector points adapt to their own Euclidean speed, independent of axis and of other points', () => {
  const opts = { minCutoff: .5, beta: 1, stride: 2 };
  const straight = createOneEuroVectorFilter(2, opts), diagonal = createOneEuroVectorFilter(2, opts);
  let a, b;
  for (let i = 0; i < 20; i += 1) { const d = i * .02; a = straight.filter([d, 0], i * FRAME); b = diagonal.filter([d / Math.SQRT2, d / Math.SQRT2], i * FRAME); }
  assert.ok(Math.abs(a[0] - Math.hypot(b[0], b[1])) < 1e-12, 'a diagonal move is filtered like a straight one');
  const pair = createOneEuroVectorFilter(4, opts), alone = createOneEuroVectorFilter(2, opts), random = noise(5);
  for (let i = 0; i < 40; i += 1) {
    const jitter = [.5 + random() * .01, .5 + random() * .01];
    const out = pair.filter([i * .05, 0, ...jitter], i * FRAME);
    assert.deepEqual(out.slice(2), alone.filter(jitter, i * FRAME), 'a moving landmark does not unlock a still one');
  }
  assert.equal(pair.value.length, 4);
});

test('the face rig smoother keeps the avatar still at rest and follows fast turns and blinks better than the fixed EMA', () => {
  const random = noise(7), smoother = createFaceRigSmoother(); let ema = { ...NEUTRAL_FACE };
  const euroYaw = [], emaYaw = [];
  for (let i = 0; i < 300; i += 1) {
    const target = { ...NEUTRAL_FACE, yaw: .2 + random() * .03, jaw: .3 + random() * .03 };
    const rig = smoother.next(target, i * FRAME); ema = smoothFaceRig(ema, target, FRAME);
    if (i > 60) { euroYaw.push(rig.yaw); emaYaw.push(ema.yaw); }
  }
  assert.ok(sd(euroYaw) < sd(emaYaw) * .8, 'less jitter at rest');
  const turn = createFaceRigSmoother(); ema = { ...NEUTRAL_FACE }; let euroLag = 0, emaLag = 0, blinkPeak = 0;
  for (let i = 0; i < 60; i += 1) {
    const time = i * FRAME, yaw = Math.min(.8, Math.max(0, (time - 300) / 200 * .8));
    const target = { ...NEUTRAL_FACE, yaw, blinkLeft: time >= 600 && time < 700 ? 1 : 0 };
    const rig = turn.next(target, time); ema = smoothFaceRig(ema, target, FRAME);
    if (time >= 300 && time <= 600) { euroLag = Math.max(euroLag, yaw - rig.yaw); emaLag = Math.max(emaLag, yaw - ema.yaw); }
    if (time >= 600 && time < 700) blinkPeak = Math.max(blinkPeak, rig.blinkLeft);
    for (const [key, value] of Object.entries(rig)) assert.ok(value >= NEUTRAL_FACE[key] - 1e-12 && value <= 1 + 1e-12, `${key} stays in range`);
  }
  assert.ok(euroLag < emaLag * .6, `turn lag ${euroLag} vs EMA ${emaLag}`);
  assert.ok(blinkPeak > .95, 'a 100 ms blink closes the eye');
});

test('the face rig smoother accepts malformed targets, custom tuning and reset', () => {
  const smoother = createFaceRigSmoother({ pose: { minCutoff: 2 }, expression: { beta: 0 } });
  assert.deepEqual(smoother.next(null, 0), { ...NEUTRAL_FACE });
  assert.deepEqual(smoother.next({ yaw: NaN, jaw: 'open' }, FRAME), { ...NEUTRAL_FACE });
  const rig = smoother.next({ ...NEUTRAL_FACE, yaw: .5 }, 2 * FRAME);
  assert.ok(rig.yaw > 0 && rig.yaw < .5);
  smoother.reset(); assert.equal(smoother.next({ ...NEUTRAL_FACE, yaw: .5 }, 0).yaw, .5);
  assert.ok(Object.isFrozen(FACE_RIG_FILTER) && Object.isFrozen(FACE_RIG_FILTER.pose));
});
