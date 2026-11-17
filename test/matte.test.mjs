import assert from 'node:assert/strict';
import test from 'node:test';
import { MATTE_DEFAULTS, applyMatte, boxMean, createMatteRefiner, matteWorkSize, refineMatte, resolveMatteOptions } from '../src/matte.mjs';

// A portrait-like scene: an oval "head" in warm skin over a cool, uneven background, plus 14 thin hair strands.
// The coarse mask is what a segmenter at 1/6 resolution gives after the threshold/softness step.
const W = 480, H = 360, S = 6, FG = [230, 170, 120];
function scene() {
  const truth = new Float32Array(W * H), data = new Uint8ClampedArray(W * H * 4);
  let seed = 1; const noise = () => ((seed = seed * 16807 % 2147483647) / 2147483647 - 0.5) * 6;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; let a = Math.hypot((x - 240) / 110, (y - 220) / 140) < 1 ? 1 : 0;
    for (let k = 0; k < 14; k++) if (y > 40 && y < 120 && Math.abs(x - (150 + k * 14 + Math.sin(y * 0.05 + k) * 8)) < 1.2) a = Math.max(a, 0.85);
    truth[i] = a;
    const bg = [40 + 60 * x / W + 20 * Math.sin(y * 0.07), 90 + 40 * y / H, 200 - 50 * x / W];
    for (let c = 0; c < 3; c++) data[i * 4 + c] = a * (FG[c] + 10 * Math.sin(x * 0.2 + y * 0.13)) + (1 - a) * bg[c] + noise();
    data[i * 4 + 3] = 255;
  }
  const mw = W / S, mh = H / S, mask = new Float32Array(mw * mh);
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    let s = 0; for (let yy = 0; yy < S; yy++) for (let xx = 0; xx < S; xx++) s += truth[(y * S + yy) * W + x * S + xx];
    const t = Math.min(1, Math.max(0, (s / S / S - 0.38) / 0.24)); mask[y * mw + x] = t * t * (3 - 2 * t);
  }
  return { truth, image: { data, width: W, height: H }, mask: { data: mask, width: mw, height: mh } };
}
const ringError = (alpha, truth) => {
  let e = 0, n = 0;
  for (let i = 0; i < W * H; i++) if (Math.abs(Math.hypot((i % W - 240) / 110, ((i / W | 0) - 220) / 140) - 1) < 0.08) { e += Math.abs(alpha[i] / 255 - truth[i]); n++; }
  return e / n;
};

test('boxMean matches a brute-force clamped window for every radius', () => {
  const w = 9, h = 7, src = Float32Array.from({ length: w * h }, (_, i) => (i * 37) % 11);
  for (const r of [0, 1, 3, 12]) {
    const out = boxMean(src, w, h, r);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) { s += src[yy * w + xx]; n++; }
      assert.ok(Math.abs(out[y * w + x] - s / n) < 1e-4, `r=${r} at ${x},${y}`);
    }
  }
});

test('options have defaults and refuse out-of-range values', () => {
  assert.deepEqual(resolveMatteOptions(), { ...MATTE_DEFAULTS });
  assert.equal(resolveMatteOptions({ radius: undefined }).radius, 0);
  for (const bad of [{ radius: 1.5 }, { radius: 33 }, { epsilon: 0 }, { epsilon: 1 }, { band: 0 }, { band: 0.6 }, { maxSide: 32 }, { maxSide: 2048 }, { foreground: 'yes' }]) assert.throws(() => resolveMatteOptions(bad), RangeError);
  assert.deepEqual(matteWorkSize(1600, 1200), { width: 512, height: 384 });
  assert.deepEqual(matteWorkSize(300, 200), { width: 300, height: 200 });
  const image = { data: new Uint8ClampedArray(16), width: 2, height: 2 };
  assert.throws(() => refineMatte(image, { data: new Float32Array(3), width: 2, height: 2 }), /mask/);
  assert.throws(() => refineMatte({ ...image, width: 3 }, { data: new Float32Array(4), width: 2, height: 2 }), /image/);
});

test('the refined edge lands on the photo’s edge, far closer than upscaling the mask', () => {
  const { truth, image, mask } = scene();
  const upscaled = refineMatte(image, mask, { radius: 1, epsilon: 0.1, band: 0.5 }); // ≈ plain bilinear upscale
  const refined = refineMatte(image, mask);
  assert.equal(refined.alpha.length, W * H);
  assert.equal(refined.workWidth, W); assert.ok(refined.radius >= 2);
  const before = ringError(upscaled.alpha, truth), after = ringError(refined.alpha, truth);
  assert.ok(after < before / 3, `edge error ${after.toFixed(3)} vs ${before.toFixed(3)}`);
  // Across the right edge of the head (the true edge is x = 350): solid inside, mostly opaque up to the edge, clear outside.
  const row = 220 * W, edge = 350;
  assert.ok(refined.alpha[row + edge - 4] > 230 && refined.alpha[row + edge - 1] > 128 && refined.alpha[row + edge] < 25);
  // Hair strands the mask smeared come back where the photo shows them.
  let strand = 0, gap = 0;
  for (let x = 140; x < 350; x++) { const t = truth[100 * W + x]; if (t > 0.5) strand += refined.alpha[100 * W + x]; else if (t === 0) gap += refined.alpha[100 * W + x]; }
  assert.ok(strand / 14 > 2 * (gap / (210 - 14)), 'strands stand out from the gaps between them');
  assert.ok(Math.abs(refined.coverage - truth.reduce((a, b) => a + b, 0) / (W * H)) < 0.02);
});

test('apply writes alpha in place and removes the old background from edge colours', () => {
  const data = new Uint8ClampedArray(W * H * 4), truth = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, a = Math.min(1, Math.max(0, (1 - Math.hypot((x - 240) / 110, (y - 220) / 140)) * 40 + 0.5)); truth[i] = a;
    for (let c = 0; c < 3; c++) data[i * 4 + c] = a * FG[c] + (1 - a) * [40, 90, 230][c];
    data[i * 4 + 3] = 255;
  }
  const mask = new Float32Array(80 * 60);
  for (let y = 0; y < 60; y++) for (let x = 0; x < 80; x++) { let s = 0; for (let k = 0; k < 36; k++) s += truth[(y * 6 + (k / 6 | 0)) * W + x * 6 + k % 6]; mask[y * 80 + x] = s / 36; }
  const before = data.slice(), image = { data, width: W, height: H };
  const result = applyMatte(image, { data: mask, width: 80, height: 60 });
  let fringeBefore = 0, fringeAfter = 0, n = 0;
  for (let i = 0; i < W * H; i++) {
    assert.equal(data[i * 4 + 3], result.alpha[i]);
    const a = result.alpha[i] / 255; if (a <= 0.05 || a >= 0.95) continue; n++;
    for (let c = 0; c < 3; c++) { fringeBefore += Math.abs(before[i * 4 + c] - FG[c]); fringeAfter += Math.abs(data[i * 4 + c] - FG[c]); }
  }
  assert.ok(n > 200);
  assert.ok(fringeAfter < fringeBefore / 4, `edge colour error ${(fringeAfter / n / 3).toFixed(1)} vs ${(fringeBefore / n / 3).toFixed(1)}`);
  // foreground: false only writes alpha.
  const plain = { data: before.slice(), width: W, height: H };
  applyMatte(plain, { data: mask, width: 80, height: 60 }, { foreground: false });
  for (let i = 0; i < W * H * 4; i++) if (i % 4 !== 3) assert.equal(plain.data[i], before[i]);
});

test('a reused refiner gives the same result, byte masks equal float masks and big images use a bounded grid', () => {
  const { image, mask } = scene(), refiner = createMatteRefiner({ band: 0.4 });
  const a = refiner.refine(image, mask), b = refiner.refine(image, mask);
  assert.deepEqual(a.alpha, b.alpha); assert.equal(a.band, 0.4);
  const bytes = { data: Uint8ClampedArray.from(mask.data, v => Math.round(v * 255)), width: mask.width, height: mask.height };
  const c = refiner.refine(image, bytes);
  let diff = 0; for (let i = 0; i < c.alpha.length; i++) diff = Math.max(diff, Math.abs(c.alpha[i] - a.alpha[i]));
  assert.ok(diff <= 6, `byte mask differs by ${diff}`);
  refiner.dispose();
  const big = { data: new Uint8ClampedArray(1200 * 900 * 4).fill(128), width: 1200, height: 900 };
  const r = refineMatte(big, { data: new Float32Array(64 * 48).fill(1), width: 64, height: 48 });
  assert.deepEqual([r.workWidth, r.workHeight, r.alpha.length], [512, 384, 1200 * 900]);
  assert.equal(r.coverage, 1);
});
