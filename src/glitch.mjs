/**
 * Seeded still-image glitch. Original, deterministic and dependency-free; it runs
 * on plain RGBA buffers in Node and the browser.
 *
 * A glitch is a plan drawn from a mulberry32 stream: displaced row bands, shuffled
 * blocks, an RGB split, scanlines and faint echoes, sized by `amount`. The same
 * seed, effect, amount and image size give the same plan and the same bytes on
 * every engine: the plan uses only the PRNG, + − × ÷ and rounding, never sin()
 * or other functions whose last bit may differ between engines. Amount 0 is the
 * untouched image. It is a still effect: nothing here flashes.
 */
export const GLITCH_EFFECTS = Object.freeze(['blocks', 'trails', 'echoes']);
/** Recipe treatment names (the template's `effect` field) and the effect each one draws. */
export const GLITCH_TREATMENTS = Object.freeze({ 'block displacement': 'blocks', 'colour trails': 'trails', 'frame echoes': 'echoes' });
export const GLITCH_LIMITS = Object.freeze({ seed: 999_999, pixels: 16_000_000 });

/** The mulberry32 generator: a function returning floats in [0, 1) from a 32-bit seed. */
export function mulberry32(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state = state + 0x6d2b79f5 | 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** A fresh seed for a new look; pass it back to reproduce that look exactly. */
export function randomGlitchSeed() {
  const values = globalThis.crypto?.getRandomValues?.(new Uint32Array(1));
  return (values ? values[0] : Math.floor(Math.random() * 2 ** 32)) % (GLITCH_LIMITS.seed + 1);
}

// Per effect at full amount: row bands, shuffled blocks, split (fraction of width), split taps, scanline depth, echoes.
const LOOKS = {
  blocks: { bands: 18, blocks: 10, split: 0.004, taps: 1, scan: 0.12, echoes: 0 },
  trails: { bands: 6, blocks: 0, split: 0.012, taps: 3, scan: 0.06, echoes: 0 },
  echoes: { bands: 7, blocks: 3, split: 0.004, taps: 1, scan: 0.18, echoes: 2 },
};

/** Validate glitch settings; recipe treatment names are accepted as aliases. */
export function resolveGlitch(options = {}) {
  const raw = options.effect ?? 'blocks', effect = GLITCH_TREATMENTS[raw] ?? raw;
  if (!GLITCH_EFFECTS.includes(effect)) throw new RangeError('Choose a supported glitch effect.');
  const amount = Number(options.amount ?? 35), seed = Number(options.seed ?? 1);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100) throw new RangeError('Glitch amount must be between 0 and 100.');
  if (!Number.isInteger(seed) || seed < 0 || seed > GLITCH_LIMITS.seed) throw new RangeError(`A glitch seed is a whole number from 0 to ${GLITCH_LIMITS.seed}.`);
  return Object.freeze({ effect, amount, seed });
}

/**
 * The deterministic layout of one glitch at a size: row bands with a horizontal
 * shift, blocks copied from (x, y) to (x + dx, y + dy), the RGB split in pixels,
 * the scanline period and depth, and echo offsets with their opacity.
 */
export function planGlitch(width, height, options = {}) {
  size(width, height);
  const { effect, amount, seed } = resolveGlitch(options), a = amount / 100, look = LOOKS[effect], random = mulberry32(seed);
  const between = (min, max) => min + random() * (max - min), sign = () => random() < .5 ? -1 : 1;
  const bands = [], blocks = [], echoes = [];
  if (a > 0) {
    for (let count = Math.round(look.bands * (0.3 + 0.7 * a)), index = 0; index < count; index++) {
      const h = Math.max(1, Math.round(height * between(0.005, 0.06))), y = Math.floor(random() * Math.max(1, height - h));
      bands.push(Object.freeze({ y, height: h, shift: sign() * Math.max(1, Math.round(width * between(0.02, 0.12) * a)) }));
    }
    for (let count = Math.round(look.blocks * a), index = 0; index < count; index++) {
      const w = Math.max(1, Math.round(width * between(0.04, 0.18))), h = Math.max(1, Math.round(height * between(0.01, 0.06)));
      blocks.push(Object.freeze({ x: Math.floor(random() * Math.max(1, width - w)), y: Math.floor(random() * Math.max(1, height - h)), width: w, height: h,
        dx: sign() * Math.round(width * between(0.02, 0.15) * a), dy: sign() * Math.round(height * between(0, 0.04) * a) }));
    }
    for (let index = 0; index < look.echoes; index++) {
      echoes.push(Object.freeze({ dx: sign() * Math.max(1, Math.round(width * 0.03 * a * (index + 1))), dy: Math.round(height * between(-0.01, 0.01) * a), alpha: Math.round(0.34 / (index + 1) * a * 1000) / 1000 }));
    }
  }
  return Object.freeze({
    effect, amount, seed, width, height, bands: Object.freeze(bands), blocks: Object.freeze(blocks), echoes: Object.freeze(echoes),
    split: a > 0 ? Math.max(1, Math.round(width * look.split * a)) : 0, taps: look.taps,
    scanlines: Object.freeze({ period: Math.max(2, Math.round(height / 300) * 2), depth: Math.round(look.scan * a * 256) }),
  });
}

/**
 * Glitch `pixels` (RGBA, width × height) into `out` (a new buffer by default; it
 * may be `pixels` itself). Alpha follows the displaced image. Returns `out`.
 */
export function glitchPixels(pixels, width, height, options = {}, out = new Uint8ClampedArray(width * height * 4)) {
  const length = size(width, height) * 4;
  for (const buffer of [pixels, out]) if (!(buffer?.length === length) || typeof buffer.BYTES_PER_ELEMENT !== 'number') throw new TypeError('Pass RGBA buffers of width × height × 4 bytes.');
  const plan = options.bands ? options : planGlitch(width, height, options);
  if (plan.width !== width || plan.height !== height) throw new RangeError('This glitch plan was made for another size.');
  if (!plan.amount) { if (out !== pixels) out.set(pixels); return out; }
  // 1. Geometry: shift each band (wrapping), then copy blocks from the original image.
  const shift = new Int32Array(height), geo = new Uint8ClampedArray(length);
  for (const band of plan.bands) for (let y = band.y; y < band.y + band.height && y < height; y++) shift[y] = band.shift;
  for (let y = 0; y < height; y++) {
    const s = ((shift[y] % width) + width) % width, row = y * width * 4;
    geo.set(pixels.subarray(row, row + (width - s) * 4), row + s * 4);
    if (s) geo.set(pixels.subarray(row + (width - s) * 4, row + width * 4), row);
  }
  for (const block of plan.blocks) for (let y = 0; y < block.height; y++) {
    const ty = block.y + y + block.dy; if (ty < 0 || ty >= height) continue;
    for (let x = 0; x < block.width; x++) {
      const tx = block.x + x + block.dx; if (tx < 0 || tx >= width) continue;
      const from = ((block.y + y) * width + block.x + x) * 4, to = (ty * width + tx) * 4;
      geo[to] = pixels[from]; geo[to + 1] = pixels[from + 1]; geo[to + 2] = pixels[from + 2]; geo[to + 3] = pixels[from + 3];
    }
  }
  // 2. Color: red leads and blue trails by `split` (smeared over `taps`), echoes are mixed in, scanlines darken.
  const weights = plan.taps === 3 ? [128, 80, 48] : [256], { period, depth } = plan.scanlines;
  const at = (x, y) => (Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 4;
  for (let y = 0; y < height; y++) {
    const dark = (y % period) < period / 2 ? 256 - depth : 256;
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      let r = 0, b = 0;
      for (let tap = 0; tap < weights.length; tap++) { r += geo[at(x - plan.split * (tap + 1), y)] * weights[tap]; b += geo[at(x + plan.split * (tap + 1), y) + 2] * weights[tap]; }
      r = (r + 128) >> 8; b = (b + 128) >> 8;
      let g = geo[index + 1];
      for (const echo of plan.echoes) {
        const read = at(x - echo.dx, y - echo.dy), k = Math.round(echo.alpha * 256);
        r += ((geo[read] - r) * k + 128) >> 8; g += ((geo[read + 1] - g) * k + 128) >> 8; b += ((geo[read + 2] - b) * k + 128) >> 8;
      }
      out[index] = (r * dark + 128) >> 8; out[index + 1] = (g * dark + 128) >> 8; out[index + 2] = (b * dark + 128) >> 8; out[index + 3] = geo[index + 3];
    }
  }
  return out;
}

function size(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > GLITCH_LIMITS.pixels) throw new RangeError(`Glitch frames are 1 to ${GLITCH_LIMITS.pixels} pixels.`);
  return width * height;
}
