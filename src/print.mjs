/**
 * Print looks for stills: ordered (Bayer) and blue-noise dithering, Floyd–Steinberg
 * error diffusion, amplitude-modulated halftone dots and a two-ink riso duotone.
 * Original, deterministic and dependency-free; it runs on plain RGBA buffers in
 * Node and the browser.
 *
 * Dithers work on a grid of `scale`-pixel cells, so a larger scale gives a chunkier
 * print; halftone cells are four times the scale, on a 45° screen. Every look uses
 * only integer math, + − × ÷, rounding and sqrt() (which IEEE 754 rounds exactly),
 * so the same settings give the same bytes on every engine. The blue-noise tile is
 * built once by void-and-cluster from integer weights. Like prepress, midtones are
 * lightened before screening (`dotGain`, a blend of x and x²), so a print reads as
 * bright as its photo. `amount` mixes the print over the original: 0 is the
 * untouched image.
 */
import { mulberry32 } from './glitch.mjs';

export const PRINT_LOOKS = Object.freeze(['riso', 'halftone', 'floyd-steinberg', 'bayer', 'blue-noise']);
/** Recipe style names (the template's `look` field) and the look each one draws. */
export const PRINT_STYLES = Object.freeze({ 'riso duotone': 'riso', 'halftone dots': 'halftone', 'error diffusion': 'floyd-steinberg', 'ordered dither': 'bayer', 'blue-noise grain': 'blue-noise' });
/** Riso-style ink pairs, as screen approximations of common stencil-printer inks. */
export const RISO_INKS = Object.freeze({
  'pink + blue': Object.freeze(['#ff48b0', '#0078bf']),
  'orange + teal': Object.freeze(['#ff6c2f', '#00838a']),
  'yellow + purple': Object.freeze(['#ffd100', '#765ba7']),
  'red + black': Object.freeze(['#e8383d', '#2a2a2a']),
});
export const PRINT_PAPER = '#f4efe6';
export const PRINT_INK = '#1f2433';
export const PRINT_LIMITS = Object.freeze({ scale: 12, seed: 999_999, pixels: 16_000_000 });
export const PRINT_DOT_GAIN = 0.45;

const HEX = /^#[a-f0-9]{6}$/i;
const rgb = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));

/** Validate print settings; recipe style names are accepted as aliases. */
export function resolvePrint(options = {}) {
  const raw = options.look ?? 'riso', look = Object.hasOwn(PRINT_STYLES, raw) ? PRINT_STYLES[raw] : raw;
  if (!PRINT_LOOKS.includes(look)) throw new RangeError('Choose a supported print look.');
  const scale = Number(options.scale ?? 3), amount = Number(options.amount ?? 100), seed = Number(options.seed ?? 1), dotGain = Number(options.dotGain ?? PRINT_DOT_GAIN);
  if (!Number.isInteger(scale) || scale < 1 || scale > PRINT_LIMITS.scale) throw new RangeError(`A print scale is a whole number from 1 to ${PRINT_LIMITS.scale}.`);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100) throw new RangeError('Print amount must be between 0 and 100.');
  if (!Number.isInteger(seed) || seed < 0 || seed > PRINT_LIMITS.seed) throw new RangeError(`A print seed is a whole number from 0 to ${PRINT_LIMITS.seed}.`);
  if (!Number.isFinite(dotGain) || dotGain < 0 || dotGain > 1) throw new RangeError('Dot gain compensation must be between 0 and 1.');
  const ink = options.ink ?? PRINT_INK, paper = options.paper ?? PRINT_PAPER, pair = options.inks ?? 'pink + blue';
  if (!HEX.test(ink) || !HEX.test(paper)) throw new RangeError('Print ink and paper are six-digit hex colors.');
  const inks = typeof pair === 'string' ? Object.hasOwn(RISO_INKS, pair) ? RISO_INKS[pair] : null : pair;
  if (!Array.isArray(inks) || inks.length !== 2 || !inks.every(value => HEX.test(value))) throw new RangeError('Choose a riso ink pair or two six-digit hex inks.');
  return Object.freeze({ look, scale, amount, seed, dotGain, ink: ink.toLowerCase(), paper: paper.toLowerCase(), inks: Object.freeze(inks.map(value => value.toLowerCase())) });
}

/** The recursive Bayer threshold matrix of `size` 2, 4, 8 or 16: ranks 0 … size² − 1, row by row. */
export function bayerMatrix(size = 8) {
  if (![2, 4, 8, 16].includes(size)) throw new RangeError('Bayer matrices are 2, 4, 8 or 16 wide.');
  let matrix = [0], n = 1;
  while (n < size) {
    const next = new Array(n * n * 4);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const value = matrix[y * n + x] * 4;
      next[y * 2 * n + x] = value; next[y * 2 * n + x + n] = value + 2; next[(y + n) * 2 * n + x] = value + 3; next[(y + n) * 2 * n + x + n] = value + 1;
    }
    matrix = next; n *= 2;
  }
  return Uint16Array.from(matrix);
}

const tiles = new Map();
/**
 * A tileable blue-noise threshold matrix (ranks 0 … size² − 1, row by row) made by
 * void-and-cluster with a toroidal Gaussian (σ 1.5). Weights are rounded to integers,
 * so the tile never depends on the last bit of exp(). Built once per size and cached;
 * each call returns a fresh copy.
 */
export function blueNoiseMatrix(size = 64) {
  if (![16, 32, 64].includes(size)) throw new RangeError('Blue-noise tiles are 16, 32 or 64 wide.');
  return blueNoise(size).slice();
}
function blueNoise(size) {
  if (tiles.has(size)) return tiles.get(size);
  const n = size * size, kernel = new Int32Array(n), energy = new Int32Array(n), on = new Uint8Array(n), ranks = new Uint16Array(n);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = Math.min(x, size - x), dy = Math.min(y, size - y);
    kernel[y * size + x] = Math.round(10000 * Math.exp(-(dx * dx + dy * dy) / 4.5));
  }
  const toggle = (index, value) => {
    on[index] = value; const sign = value ? 1 : -1, ix = index % size, iy = (index - ix) / size;
    for (let y = 0; y < size; y++) {
      const row = ((y - iy + size) % size) * size;
      for (let x = 0; x < size; x++) energy[y * size + x] += sign * kernel[row + (x - ix + size) % size];
    }
  };
  // Tightest cluster among the set cells, or the largest void among the empty ones; the first index wins ties.
  const find = (value, most) => {
    let best = -1;
    for (let index = 0; index < n; index++) if (on[index] === value && (best < 0 || (most ? energy[index] > energy[best] : energy[index] < energy[best]))) best = index;
    return best;
  };
  const random = mulberry32(0x9e3779b9), count = Math.round(n / 10);
  for (let placed = 0; placed < count;) { const index = Math.floor(random() * n); if (!on[index]) { toggle(index, 1); placed++; } }
  for (;;) { const cluster = find(1, true); toggle(cluster, 0); const gap = find(0, false); toggle(gap, 1); if (gap === cluster) break; }
  const prototype = on.slice(), start = energy.slice();
  for (let rank = count - 1; rank >= 0; rank--) { const index = find(1, true); toggle(index, 0); ranks[index] = rank; }
  on.set(prototype); energy.set(start);
  for (let rank = count; rank < n; rank++) { const index = find(0, false); toggle(index, 1); ranks[index] = rank; }
  tiles.set(size, ranks);
  return ranks;
}

/**
 * How much of two inks reproduces a color, as coverages [a, b] from 0 to 1: a
 * least-squares fit of the color's absorption (1 − channel / 255) to the inks'.
 */
export function separateDuotone(color, inkA, inkB) {
  const t = color.map(value => 1 - value / 255), A = rgb(inkA).map(value => 1 - value / 255), B = rgb(inkB).map(value => 1 - value / 255);
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2], aa = dot(A, A), bb = dot(B, B), ab = dot(A, B), at = dot(A, t), bt = dot(B, t);
  const clamp = value => value < 0 ? 0 : value > 1 ? 1 : value, det = aa * bb - ab * ab;
  let a = det > 1e-9 ? (at * bb - bt * ab) / det : 0, b = det > 1e-9 ? (bt * aa - at * ab) / det : bb > 0 ? bt / bb : 0;
  // Outside the pair's gamut: fix the clamped ink and refit the other alone.
  if (a < 0 || a > 1) { a = clamp(a); b = bb > 0 ? clamp((bt - a * ab) / bb) : 0; }
  else if (b < 0 || b > 1) { b = clamp(b); a = aa > 0 ? clamp((at - b * ab) / aa) : 0; }
  return [a, b];
}

/**
 * Print `pixels` (RGBA, width × height) into `out` (a new buffer by default; it
 * may be `pixels` itself). Alpha is kept. Returns `out`.
 */
export function printPixels(pixels, width, height, options = {}, out = new Uint8ClampedArray(width * height * 4)) {
  const length = size(width, height) * 4;
  for (const buffer of [pixels, out]) if (!(buffer?.length === length) || typeof buffer.BYTES_PER_ELEMENT !== 'number') throw new TypeError('Pass RGBA buffers of width × height × 4 bytes.');
  const settings = resolvePrint(options), { look, scale, amount } = settings;
  if (!amount) { if (out !== pixels) out.set(pixels); return out; }
  // 1. Tone: luma, stretched between its 0.5th and 99.5th percentiles so flat photos still print with a full range.
  const luma = new Uint8Array(width * height), histogram = new Uint32Array(256);
  for (let index = 0, pixel = 0; pixel < luma.length; pixel++, index += 4) { const value = (54 * pixels[index] + 183 * pixels[index + 1] + 19 * pixels[index + 2] + 128) >> 8; luma[pixel] = value; histogram[value]++; }
  let low = 0, high = 255;
  for (let sum = 0, cut = Math.floor(luma.length / 200); low < 255 && (sum += histogram[low]) <= cut;) low++;
  for (let sum = 0, cut = Math.floor(luma.length / 200); high > 0 && (sum += histogram[high]) <= cut;) high--;
  const level = new Uint8Array(256);
  for (let value = 0; value < 256; value++) level[value] = high - low < 16 ? value : Math.max(0, Math.min(255, Math.round((value - low) * 255 / (high - low))));
  const printed = new Uint8ClampedArray(length), [pr, pg, pb] = rgb(settings.paper), k = settings.dotGain, gain = x => x * (1 - k) + x * x * k;
  if (look === 'halftone') halftone(luma, level, width, height, scale * 4, rgb(settings.ink), [pr, pg, pb], gain, printed);
  else {
    // 2. Grid: each scale × scale cell takes its mean color.
    const gw = Math.ceil(width / scale), gh = Math.ceil(height / scale), cells = gw * gh, mean = new Uint8Array(cells * 3), dark = new Uint8Array(cells);
    const sums = new Uint32Array(cells * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const cell = ((y / scale | 0) * gw + (x / scale | 0)) * 4, index = (y * width + x) * 4;
      sums[cell] += level[pixels[index]]; sums[cell + 1] += level[pixels[index + 1]]; sums[cell + 2] += level[pixels[index + 2]]; sums[cell + 3]++;
    }
    for (let cell = 0; cell < cells; cell++) {
      const count = sums[cell * 4 + 3], half = count >> 1;
      for (let channel = 0; channel < 3; channel++) mean[cell * 3 + channel] = Math.floor((sums[cell * 4 + channel] + half) / count);
      dark[cell] = Math.round(255 * gain(1 - ((54 * mean[cell * 3] + 183 * mean[cell * 3 + 1] + 19 * mean[cell * 3 + 2] + 128) >> 8) / 255));
    }
    const random = mulberry32(settings.seed), tile = blueNoise(64);
    // A seed moves and turns the blue-noise tile, so each seed grains differently.
    const noise = () => { const ox = Math.floor(random() * 64), oy = Math.floor(random() * 64), turn = Math.floor(random() * 8);
      return (x, y) => { let u = (x + ox) & 63, v = (y + oy) & 63; if (turn & 1) u = 63 - u; if (turn & 2) v = 63 - v; if (turn & 4) [u, v] = [v, u]; return tile[v * 64 + u]; }; };
    if (look === 'riso') {
      const [inkA, inkB] = settings.inks, a = new Uint8Array(cells), b = new Uint8Array(cells), grainA = noise(), grainB = noise();
      for (let cell = 0; cell < cells; cell++) {
        const [ca, cb] = separateDuotone([mean[cell * 3], mean[cell * 3 + 1], mean[cell * 3 + 2]], inkA, inkB), gx = cell % gw, gy = (cell - gx) / gw;
        a[cell] = Math.round(gain(ca) * 4096) > grainA(gx, gy) ? 1 : 0; b[cell] = Math.round(gain(cb) * 4096) > grainB(gx, gy) ? 1 : 0;
      }
      // The first ink is printed slightly off register, as on a stencil drum.
      const shift = () => (random() < .5 ? -1 : 1) * Math.max(1, Math.round(width * (0.0015 + random() * 0.0025))), mx = shift(), my = shift();
      const [ar, ag, ab] = rgb(inkA), [br, bg, bb] = rgb(inkB), multiply = (c, k) => ((c * k + 127) / 255) | 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const sx = Math.min(width - 1, Math.max(0, x - mx)), sy = Math.min(height - 1, Math.max(0, y - my)), index = (y * width + x) * 4;
        let r = pr, g = pg, bl = pb;
        if (a[(sy / scale | 0) * gw + (sx / scale | 0)]) { r = multiply(r, ar); g = multiply(g, ag); bl = multiply(bl, ab); }
        if (b[(y / scale | 0) * gw + (x / scale | 0)]) { r = multiply(r, br); g = multiply(g, bg); bl = multiply(bl, bb); }
        printed[index] = r; printed[index + 1] = g; printed[index + 2] = bl;
      }
    } else {
      const bits = new Uint8Array(cells);
      if (look === 'bayer') { const matrix = bayerMatrix(8); for (let cell = 0; cell < cells; cell++) { const gx = cell % gw, gy = (cell - gx) / gw; bits[cell] = dark[cell] * 64 > matrix[(gy & 7) * 8 + (gx & 7)] * 255 + 127 ? 1 : 0; } }
      else if (look === 'blue-noise') { const grain = noise(); for (let cell = 0; cell < cells; cell++) { const gx = cell % gw; bits[cell] = dark[cell] * 4096 > grain(gx, (cell - gx) / gw) * 255 + 127 ? 1 : 0; } }
      else {
        // Floyd–Steinberg in sixteenths, serpentine so the error never streaks one way.
        const error = new Int32Array(cells);
        for (let gy = 0; gy < gh; gy++) {
          const reverse = gy & 1, step = reverse ? -1 : 1;
          for (let i = 0; i < gw; i++) {
            const gx = reverse ? gw - 1 - i : i, cell = gy * gw + gx, value = dark[cell] * 16 + error[cell], bit = value >= 128 * 16 ? 1 : 0, rest = value - bit * 255 * 16;
            bits[cell] = bit;
            const spread = (dx, dy, weight) => { const x = gx + dx, y = gy + dy; if (x >= 0 && x < gw && y < gh) error[y * gw + x] += Math.trunc(rest * weight / 16); };
            spread(step, 0, 7); spread(-step, 1, 3); spread(0, 1, 5); spread(step, 1, 1);
          }
        }
      }
      const [ir, ig, ib] = rgb(settings.ink);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4, bit = bits[(y / scale | 0) * gw + (x / scale | 0)];
        printed[index] = bit ? ir : pr; printed[index + 1] = bit ? ig : pg; printed[index + 2] = bit ? ib : pb;
      }
    }
  }
  // 3. Mix the print over the original by `amount`; alpha is untouched.
  const mix = Math.round(amount / 100 * 256);
  for (let index = 0; index < length; index += 4) {
    for (let channel = 0; channel < 3; channel++) out[index + channel] = pixels[index + channel] + (((printed[index + channel] - pixels[index + channel]) * mix + 128) >> 8);
    out[index + 3] = pixels[index + 3];
  }
  return out;
}

// Round dots on a 45° screen, sized by each cell's mean darkness; past 50% the paper shows as round holes at the cell corners.
function halftone(luma, level, width, height, cell, ink, paper, gain, printed) {
  const sat = new Float64Array((width + 1) * (height + 1)), stride = width + 1, c = Math.SQRT1_2, half = cell / 2;
  for (let y = 0; y < height; y++) for (let x = 0, row = 0; x < width; x++) { row += level[luma[y * width + x]]; sat[(y + 1) * stride + x + 1] = sat[y * stride + x + 1] + row; }
  const box = (x0, y0, x1, y1) => sat[y1 * stride + x1] - sat[y0 * stride + x1] - sat[y1 * stride + x0] + sat[y0 * stride + x0];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const px = x + .5, py = y + .5, u = (px * c + py * c) / cell, v = (py * c - px * c) / cell, cu = Math.floor(u) + .5, cv = Math.floor(v) + .5;
    const cx = (cu * c - cv * c) * cell, cy = (cu * c + cv * c) * cell;
    const x0 = Math.max(0, Math.min(width - 1, Math.floor(cx - half))), y0 = Math.max(0, Math.min(height - 1, Math.floor(cy - half)));
    const x1 = Math.max(x0 + 1, Math.min(width, Math.ceil(cx + half))), y1 = Math.max(y0 + 1, Math.min(height, Math.ceil(cy + half)));
    const t = gain(1 - box(x0, y0, x1, y1) / ((x1 - x0) * (y1 - y0) * 255)), fu = u - cu, fv = v - cv;
    let cover;
    if (t <= .5) cover = Math.sqrt(t / Math.PI) * cell - Math.sqrt(fu * fu + fv * fv) * cell + .5;
    else { const du = .5 - Math.abs(fu), dv = .5 - Math.abs(fv); cover = 1 - (Math.sqrt((1 - t) / Math.PI) * cell - Math.sqrt(du * du + dv * dv) * cell + .5); }
    const k = Math.round(Math.max(0, Math.min(1, cover)) * 256), index = (y * width + x) * 4;
    for (let channel = 0; channel < 3; channel++) printed[index + channel] = paper[channel] + (((ink[channel] - paper[channel]) * k + 128) >> 8);
  }
}

function size(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > PRINT_LIMITS.pixels) throw new RangeError(`Print frames are 1 to ${PRINT_LIMITS.pixels} pixels.`);
  return width * height;
}
