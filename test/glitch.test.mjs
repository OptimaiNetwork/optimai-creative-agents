import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { GLITCH_EFFECTS, GLITCH_LIMITS, GLITCH_TREATMENTS, glitchPixels, mulberry32, planGlitch, randomGlitchSeed, resolveGlitch } from '../src/glitch.mjs';

// A gradient with a hard vertical edge, so shifts, splits and scanlines all leave a trace.
function photo(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 4;
    data[index] = x < width / 2 ? 30 : 230; data[index + 1] = Math.round(255 * y / height); data[index + 2] = Math.round(255 * x / width); data[index + 3] = 255;
  }
  return data;
}
const digest = data => createHash('sha256').update(data).digest('hex').slice(0, 16);

test('mulberry32 is the reference generator: reproducible, seed-sensitive and in [0, 1)', () => {
  const first = mulberry32(1);
  assert.deepEqual([first(), first(), first()], [0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
  const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
  const run = random => Array.from({ length: 1000 }, random);
  const values = run(a);
  assert.deepEqual(values, run(b));
  assert.notDeepEqual(values.slice(0, 5), run(c).slice(0, 5));
  assert.ok(values.every(value => value >= 0 && value < 1));
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  assert.ok(Math.abs(mean - .5) < .05, 'roughly uniform');
  for (let index = 0; index < 50; index++) { const seed = randomGlitchSeed(); assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= GLITCH_LIMITS.seed); }
});

test('settings validate effects, treatment aliases, amounts and whole-number seeds', () => {
  assert.deepEqual(resolveGlitch(), { effect: 'blocks', amount: 35, seed: 1 });
  for (const [treatment, effect] of Object.entries(GLITCH_TREATMENTS)) assert.equal(resolveGlitch({ effect: treatment }).effect, effect);
  assert.deepEqual(GLITCH_EFFECTS, ['blocks', 'trails', 'echoes']);
  for (const options of [{ effect: 'datamosh' }, { amount: -1 }, { amount: 101 }, { amount: NaN }, { seed: 1.5 }, { seed: -1 }, { seed: GLITCH_LIMITS.seed + 1 }]) assert.throws(() => resolveGlitch(options), RangeError);
  assert.throws(() => planGlitch(0, 10), RangeError);
  assert.throws(() => planGlitch(5000, 5000), /16000000 pixels/);
});

test('the same seed always draws the same glitch; another seed draws another', () => {
  const width = 160, height = 120, source = photo(width, height);
  for (const effect of GLITCH_EFFECTS) {
    const options = { effect, amount: 70, seed: 2026 };
    assert.deepEqual(planGlitch(width, height, options), planGlitch(width, height, options));
    const once = glitchPixels(source, width, height, options), again = glitchPixels(source, width, height, options);
    assert.equal(digest(once), digest(again), `${effect} is reproducible byte for byte`);
    assert.notEqual(digest(once), digest(glitchPixels(source, width, height, { ...options, seed: 2027 })), `${effect} changes with the seed`);
    assert.notEqual(digest(once), digest(source));
  }
  // Pinned bytes: a change here means saved recipes would no longer reproduce their glitch.
  assert.equal(digest(glitchPixels(source, width, height, { effect: 'blocks', amount: 50, seed: 7 })), '3af76be40bbda686');
});

test('amount 0 is the untouched image and the amount scales every part of the plan', () => {
  const width = 64, height = 48, source = photo(width, height);
  assert.deepEqual(glitchPixels(source, width, height, { amount: 0, seed: 9 }), source);
  const none = planGlitch(width, height, { amount: 0 });
  assert.deepEqual([none.bands.length, none.blocks.length, none.split, none.scanlines.depth], [0, 0, 0, 0]);
  const soft = planGlitch(1200, 900, { amount: 20, seed: 3 }), hard = planGlitch(1200, 900, { amount: 100, seed: 3 });
  assert.ok(hard.bands.length > soft.bands.length && hard.blocks.length > soft.blocks.length);
  assert.ok(hard.split > soft.split && hard.scanlines.depth > soft.scanlines.depth);
  const widest = plan => Math.max(...plan.bands.map(band => Math.abs(band.shift)));
  assert.ok(widest(hard) > widest(soft) && widest(hard) <= 1200 * .12);
  for (const band of hard.bands) assert.ok(band.y >= 0 && band.y + band.height <= 900);
});

test('each effect draws its own look', () => {
  const blocks = planGlitch(1200, 900, { effect: 'blocks', amount: 80, seed: 5 });
  const trails = planGlitch(1200, 900, { effect: 'trails', amount: 80, seed: 5 });
  const echoes = planGlitch(1200, 900, { effect: 'echoes', amount: 80, seed: 5 });
  assert.ok(blocks.blocks.length >= 6 && trails.blocks.length === 0, 'block displacement shuffles blocks; trails does not');
  assert.ok(trails.split > blocks.split && trails.taps === 3, 'colour trails split wider and smear over three taps');
  assert.equal(echoes.echoes.length, 2); assert.ok(echoes.echoes[0].alpha > echoes.echoes[1].alpha);
  assert.ok(echoes.scanlines.depth > blocks.scanlines.depth);
  // With no geometry the red channel visibly leads the blue one at the hard edge.
  const width = 200, height = 4, source = photo(width, height);
  const out = glitchPixels(source, width, height, { ...trails, width, height, bands: [], blocks: [], split: 4, scanlines: { period: 2, depth: 0 } });
  assert.equal(out[(width / 2) * 4 + 1], source[(width / 2) * 4 + 1], 'green stays put');
  assert.ok(out[(width / 2 + 2) * 4] < source[(width / 2 + 2) * 4], 'red trails behind the edge');
});

test('buffers are checked, plans must match their size, alpha follows the image and output may alias input', () => {
  const width = 40, height = 30, source = photo(width, height);
  for (let index = 3; index < source.length; index += 4) source[index] = index % 8 === 3 ? 255 : 0;
  const expected = glitchPixels(source, width, height, { seed: 11, amount: 90 });
  const copy = source.slice();
  assert.equal(glitchPixels(copy, width, height, { seed: 11, amount: 90 }, copy), copy);
  assert.deepEqual(copy, expected, 'in place gives the same bytes');
  assert.ok(expected.some((value, index) => index % 4 === 3 && value !== source[index]), 'alpha moves with the shifted bands');
  assert.deepEqual(glitchPixels(source, width, height, planGlitch(width, height, { seed: 11, amount: 90 })), expected, 'a plan draws exactly like its options');
  assert.throws(() => glitchPixels(source, width, height, planGlitch(20, 30, { seed: 1 })), /another size/);
  assert.throws(() => glitchPixels(new Uint8ClampedArray(10), width, height), TypeError);
  assert.throws(() => glitchPixels([...source], width, height), TypeError);
  const bytes = glitchPixels(Uint8Array.from(source), width, height, { seed: 11, amount: 90 }, new Uint8Array(source.length));
  assert.deepEqual([...bytes], [...expected], 'plain Uint8Array buffers work too');
});
