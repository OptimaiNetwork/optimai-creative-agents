/**
 * A/B compare two results. `compareOutputs(a, b)` measures two RGBA buffers on one sampled grid — how much of the image
 * changed, mean and peak change, PSNR, an SSIM-lite structure score on luma, a mean OKLab colour shift, the changed
 * region and an optional diff heatmap — and `describeComparison` says it in plain words. `splitView` and `stepSplit`
 * give a before/after slider its clip and keyboard steps; `compareImages` decodes blobs, URLs or bitmaps in a browser.
 * Original, deterministic and dependency-free: the same two buffers always give the same numbers in Node and the browser.
 */
export const COMPARE_LIMITS = Object.freeze({ maxSide: 512, minSide: 16, maxSampleSide: 2048, window: 8, threshold: 8, overallSide: 24, maxInputPixels: 67_108_864 });
// Below this mean OKLab shift (about one just-noticeable difference) the overall look reads as unchanged.
const SAME_LOOK = .02;
// SSIM constants for 8-bit luma (Wang et al. 2004): K1 = 0.01, K2 = 0.03, L = 255.
const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
const BACKDROP = 128; // Transparent pixels are compared as they would sit over mid grey.
const int = (value, fallback, min, max) => Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
const round = (value, digits = 4) => Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : value;

function pixels(image, name) {
  const width = image?.width, height = image?.height, data = image?.data;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new TypeError(`${name} needs a positive integer width and height.`);
  if (width * height > COMPARE_LIMITS.maxInputPixels) throw new RangeError(`${name} is larger than ${COMPARE_LIMITS.maxInputPixels} pixels.`);
  if (!data || typeof data.length !== 'number' || data.length !== width * height * 4) throw new TypeError(`${name}.data must hold width × height × 4 RGBA bytes.`);
  return { width, height, data };
}

/** The grid both images are measured on: `a`'s aspect, no larger than either image, the long side at most `maxSide`. */
export function compareGrid(a, b, maxSide = COMPARE_LIMITS.maxSide) {
  const side = int(maxSide, COMPARE_LIMITS.maxSide, COMPARE_LIMITS.minSide, COMPARE_LIMITS.maxSampleSide);
  const scale = Math.min(1, side / Math.max(a.width, a.height), b.width / a.width, b.height / a.height);
  return { width: Math.max(1, Math.round(a.width * scale)), height: Math.max(1, Math.round(a.height * scale)) };
}

// Box-average RGBA onto a w × h grid, composited over the grey backdrop (an exact copy when the size already matches).
function sample({ width, height, data }, w, h) {
  const out = new Float32Array(w * h * 3), xs = new Int32Array(w + 1);
  for (let x = 0; x <= w; x++) xs[x] = Math.floor(x * width / w);
  for (let y = 0, o = 0; y < h; y++) {
    const y0 = Math.floor(y * height / h), y1 = Math.max(y0 + 1, Math.floor((y + 1) * height / h));
    for (let x = 0; x < w; x++, o += 3) {
      const x0 = xs[x], x1 = Math.max(x0 + 1, xs[x + 1]);
      let r = 0, g = 0, b = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let i = (sy * width + x0) * 4, end = (sy * width + x1) * 4; i < end; i += 4) {
          const alpha = data[i + 3];
          if (alpha === 255) { r += data[i]; g += data[i + 1]; b += data[i + 2]; continue; }
          const rest = (255 - alpha) * BACKDROP;
          r += (data[i] * alpha + rest) / 255; g += (data[i + 1] * alpha + rest) / 255; b += (data[i + 2] * alpha + rest) / 255;
        }
      }
      const n = (x1 - x0) * (y1 - y0); out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
  }
  return out;
}

// sRGB (0–255, fractional) → OKLab (https://bottosson.github.io/posts/oklab/), written out so the per-pixel loop allocates nothing.
const LINEAR = Float64Array.from({ length: 4096 }, (_, i) => { const c = i / 4095; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
const linear = value => LINEAR[Math.round(value * 4095 / 255)];
function oklabDistance(r1, g1, b1, r2, g2, b2) {
  const lab = (r, g, b) => {
    const R = linear(r), G = linear(g), B = linear(b);
    const l = Math.cbrt(.4122214708 * R + .5363325363 * G + .0514459929 * B), m = Math.cbrt(.2119034982 * R + .6806995451 * G + .1073969566 * B), s = Math.cbrt(.0883024619 * R + .2817188376 * G + .6299787005 * B);
    LAB[0] = .2104542553 * l + .793617785 * m - .0040720468 * s; LAB[1] = 1.9779984951 * l - 2.428592205 * m + .4505937099 * s; LAB[2] = .0259040371 * l + .7827717662 * m - .808675766 * s;
  };
  lab(r1, g1, b1); const L = LAB[0], A = LAB[1], Bv = LAB[2]; lab(r2, g2, b2);
  return Math.sqrt((L - LAB[0]) ** 2 + (A - LAB[1]) ** 2 + (Bv - LAB[2]) ** 2);
}
const LAB = new Float64Array(3);

// Box-average an RGB float grid down to w × h (the "seen from across the room" view used for `overall`).
function shrink(grid, width, height, w, h) {
  const out = new Float32Array(w * h * 3);
  for (let y = 0, o = 0; y < h; y++) {
    const y0 = Math.floor(y * height / h), y1 = Math.max(y0 + 1, Math.floor((y + 1) * height / h));
    for (let x = 0; x < w; x++, o += 3) {
      const x0 = Math.floor(x * width / w), x1 = Math.max(x0 + 1, Math.floor((x + 1) * width / w)), n = (x1 - x0) * (y1 - y0);
      for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) { const i = (sy * width + sx) * 3; out[o] += grid[i] / n; out[o + 1] += grid[i + 1] / n; out[o + 2] += grid[i + 2] / n; }
    }
  }
  return out;
}
const luma = (grid, n) => { const out = new Float64Array(n); for (let i = 0, o = 0; i < n; i++, o += 3) out[i] = .2126 * grid[o] + .7152 * grid[o + 1] + .0722 * grid[o + 2]; return out; };

// Summed-area table with a zero row and column, so any window sum is four reads.
function integral(values, w, h) {
  const table = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) for (let x = 0, row = 0; x < w; x++) { row += values[y * w + x]; table[(y + 1) * (w + 1) + x + 1] = table[y * (w + 1) + x + 1] + row; }
  return table;
}
const windowSum = (table, w, x0, y0, x1, y1) => table[y1 * (w + 1) + x1] - table[y0 * (w + 1) + x1] - table[y1 * (w + 1) + x0] + table[y0 * (w + 1) + x0];

// SSIM-lite: mean SSIM on BT.709 luma over size × size windows, half-overlapping; one window for tiny grids.
function structure(la, lb, w, h, size) {
  const n = w * h, aa = new Float64Array(n), bb = new Float64Array(n), ab = new Float64Array(n);
  for (let i = 0; i < n; i++) { aa[i] = la[i] * la[i]; bb[i] = lb[i] * lb[i]; ab[i] = la[i] * lb[i]; }
  const [sa, sb, saa, sbb, sab] = [la, lb, aa, bb, ab].map(values => integral(values, w, h));
  const ww = Math.min(size, w), wh = Math.min(size, h), stepX = Math.max(1, ww >> 1), stepY = Math.max(1, wh >> 1);
  let total = 0, count = 0;
  for (let y = 0; y + wh <= h; y += stepY) for (let x = 0; x + ww <= w; x += stepX) {
    const k = ww * wh, sum = table => windowSum(table, w, x, y, x + ww, y + wh);
    const ma = sum(sa) / k, mb = sum(sb) / k;
    const va = Math.max(0, sum(saa) / k - ma * ma), vb = Math.max(0, sum(sbb) / k - mb * mb), cov = sum(sab) / k - ma * mb;
    total += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); count++;
  }
  return count ? total / count : 1;
}

/**
 * Compare two RGBA images (`{ data, width, height }`, e.g. `ImageData`). Both are box-sampled onto `compareGrid(a, b)`;
 * `b` is stretched to `a`'s aspect when the sizes differ (`sameSize: false`). Returns frozen metrics:
 * `changed` (share of grid pixels whose largest channel moved more than `threshold`), `meanDelta`/`maxDelta` (0–1),
 * `psnr` (dB, `Infinity` when identical), `ssim` (−1…1, 1 = same structure), `deltaE` (mean OKLab distance),
 * `bounds` (changed region in `a`'s pixels, or null), and `diff` (an RGBA heatmap on the grid) when `{ diff: true }`.
 */
export function compareOutputs(a, b, options = {}) {
  const A = pixels(a, 'a'), B = pixels(b, 'b');
  const { width: w, height: h } = compareGrid(A, B, options.maxSide);
  const threshold = int(options.threshold, COMPARE_LIMITS.threshold, 0, 254), size = int(options.window, COMPARE_LIMITS.window, 2, 32);
  const pa = sample(A, w, h), pb = sample(B, w, h), n = w * h;
  const la = new Float64Array(n), lb = new Float64Array(n), delta = new Float32Array(n);
  let squared = 0, absolute = 0, peak = 0, changed = 0, shift = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0, o = 0; i < n; i++, o += 3) {
    let most = 0;
    for (let c = 0; c < 3; c++) { const d = Math.abs(pa[o + c] - pb[o + c]); squared += d * d; absolute += d; if (d > most) most = d; }
    delta[i] = most; if (most > peak) peak = most;
    la[i] = .2126 * pa[o] + .7152 * pa[o + 1] + .0722 * pa[o + 2]; lb[i] = .2126 * pb[o] + .7152 * pb[o + 1] + .0722 * pb[o + 2];
    if (most > 0) shift += oklabDistance(pa[o], pa[o + 1], pa[o + 2], pb[o], pb[o + 1], pb[o + 2]);
    if (most > threshold) { changed++; const x = i % w, y = (i - x) / w; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const mse = squared / (n * 3), sx = A.width / w, sy = A.height / h;
  // The overall look: the same comparison on a tiny grid, where grain, dither and dot patterns average out.
  const os = Math.min(1, COMPARE_LIMITS.overallSide / Math.max(w, h)), ow = Math.max(1, Math.round(w * os)), oh = Math.max(1, Math.round(h * os));
  const qa = shrink(pa, w, h, ow, oh), qb = shrink(pb, w, h, ow, oh); let overallShift = 0;
  for (let o = 0; o < ow * oh * 3; o += 3) overallShift += oklabDistance(qa[o], qa[o + 1], qa[o + 2], qb[o], qb[o + 1], qb[o + 2]);
  const bounds = x1 < 0 ? null : Object.freeze({ x: Math.floor(x0 * sx), y: Math.floor(y0 * sy), width: Math.min(A.width, Math.ceil((x1 + 1) * sx)) - Math.floor(x0 * sx), height: Math.min(A.height, Math.ceil((y1 + 1) * sy)) - Math.floor(y0 * sy) });
  return Object.freeze({
    width: A.width, height: A.height, grid: Object.freeze({ width: w, height: h }),
    sameSize: A.width === B.width && A.height === B.height, identical: peak === 0, threshold,
    changed: round(changed / n), meanDelta: round(absolute / (n * 3) / 255), maxDelta: round(peak / 255),
    psnr: mse === 0 ? Infinity : round(10 * Math.log10(255 * 255 / mse), 2), ssim: round(structure(la, lb, w, h, size)),
    deltaE: round(shift / n), bounds,
    overall: Object.freeze({ deltaE: round(overallShift / (ow * oh)), ssim: round(structure(luma(qa, ow * oh), luma(qb, ow * oh), ow, oh, 4)) }),
    ...(options.diff ? { diff: Object.freeze(heatmap(la, delta, w, h, threshold)) } : {}),
  });
}

// Dimmed luma of `a` with the change painted over it in a warm ramp; unchanged pixels stay grey.
function heatmap(luma, delta, width, height, threshold) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, o = 0; i < delta.length; i++, o += 4) {
    const base = luma[i] * .3, t = delta[i] > threshold ? Math.min(1, .25 + delta[i] / 96) : 0;
    data[o] = base + (255 - base) * t; data[o + 1] = base + (Math.max(0, t - .45) * 1.8 * 220 - base) * t; data[o + 2] = base * (1 - t) + 70 * t; data[o + 3] = 255;
  }
  return { data, width, height };
}

const where = value => value >= .995 ? 'the whole image' : `${value < .01 ? 'under 1%' : `${Math.round(value * 100)}%`} of the image`;
/**
 * Short words for a comparison: "Identical", "Small changes to 4% of the image · structure 93% kept",
 * "Same picture with new grain or texture across 66% of the image", "A new look across the whole image · structure 19% kept".
 */
export function describeComparison(result) {
  if (!result || typeof result.changed !== 'number') return 'Nothing to compare yet';
  if (result.identical) return result.sameSize === false ? 'Same picture at another size' : 'Identical';
  if (result.changed === 0) return 'No visible change';
  const kept = typeof result.ssim === 'number' ? ` · structure ${Math.max(0, Math.round(result.ssim * 100))}% kept` : '';
  if (result.changed < .15 && result.ssim >= .85) return `Small changes to ${where(result.changed)}${kept}`;
  if (result.overall && result.overall.deltaE < SAME_LOOK && result.overall.ssim >= .9) return `Same picture with new grain or texture across ${where(result.changed)}`;
  return `${result.ssim >= .75 ? 'Changed' : 'A new look across'} ${where(result.changed)}${kept}`;
}

/**
 * The before/after split at `position` (0–1, from the left or top). `before` and `after` are the visible rectangles,
 * `line` is the divider, and `clipPath` is the CSS `inset()` that shows `before` over a stacked `after`.
 */
export function splitView(position = .5, width = 1, height = 1, { orientation = 'horizontal' } = {}) {
  const p = Number.isFinite(position) ? Math.min(1, Math.max(0, position)) : .5, vertical = orientation === 'vertical';
  const at = vertical ? height * p : width * p;
  return Object.freeze({
    position: p, orientation: vertical ? 'vertical' : 'horizontal',
    before: Object.freeze(vertical ? { x: 0, y: 0, width, height: at } : { x: 0, y: 0, width: at, height }),
    after: Object.freeze(vertical ? { x: 0, y: at, width, height: height - at } : { x: at, y: 0, width: width - at, height }),
    line: Object.freeze(vertical ? { x1: 0, y1: at, x2: width, y2: at } : { x1: at, y1: 0, x2: at, y2: height }),
    clipPath: vertical ? `inset(0 0 ${round((1 - p) * 100, 3)}% 0)` : `inset(0 ${round((1 - p) * 100, 3)}% 0 0)`,
  });
}

const KEYS = Object.freeze({ ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -4, PageUp: 4 });
/** The next split position for a key on a custom slider handle (arrows ± `step`, Page keys ± 4 steps, Home/End); undefined for other keys. */
export function stepSplit(position, key, { step = .05 } = {}) {
  if (key === 'Home') return 0;
  if (key === 'End') return 1;
  if (!(key in KEYS)) return undefined;
  const p = Number.isFinite(position) ? position : .5, s = Number.isFinite(step) && step > 0 ? step : .05;
  return Math.min(1, Math.max(0, round(p + KEYS[key] * s, 6)));
}

// Browser decoding: draw any image source straight onto the comparison grid.
async function bitmap(source, signal) {
  if (typeof source === 'string') {
    const response = await fetch(source, { signal });
    if (!response.ok) throw new Error(`Could not load ${source.startsWith('blob:') ? 'this result' : source} (${response.status}).`);
    source = await response.blob();
  }
  if (typeof Blob !== 'undefined' && source instanceof Blob) {
    if (typeof createImageBitmap !== 'function') throw new Error('This browser cannot decode images for comparison.');
    return { image: await createImageBitmap(source), owned: true };
  }
  return { image: source, owned: false };
}
const size = image => ({ width: image.naturalWidth || image.videoWidth || image.width, height: image.naturalHeight || image.videoHeight || image.height });
function canvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') return Object.assign(document.createElement('canvas'), { width, height });
  throw new Error('This browser has no canvas to compare images on.');
}
function readGrid(image, width, height) {
  const surface = canvas(width, height), ctx = surface.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser has no 2D canvas to compare images on.');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

/**
 * Browser helper: compare two images given as `ImageData`-like buffers, Blobs, URLs (`blob:` or same-origin) or anything
 * `drawImage` accepts. Decodes each once straight onto the comparison grid, so big exports stay cheap. `width`/`height`
 * in the result are `a`'s full size, and `bounds` is in those pixels. Takes `compareOutputs` options plus `signal`.
 */
export async function compareImages(a, b, options = {}) {
  const { signal } = options, opened = [];
  const abort = () => { if (signal?.aborted) throw signal.reason ?? new DOMException('Comparison cancelled.', 'AbortError'); };
  try {
    abort();
    const sources = [];
    for (const input of [a, b]) {
      if (input?.data && Number.isInteger(input.width)) { sources.push({ buffer: input, ...size(input) }); continue; }
      const { image, owned } = await bitmap(input, signal); if (owned) opened.push(image); abort();
      const dims = size(image);
      if (!(dims.width > 0 && dims.height > 0)) throw new Error('One of the images has no size yet. Wait for it to load.');
      sources.push({ image, ...dims });
    }
    const [first, second] = sources, grid = compareGrid(first, second, options.maxSide);
    const read = source => source.buffer && source.width === grid.width && source.height === grid.height ? source.buffer : source.image ? readGrid(source.image, grid.width, grid.height) : source.buffer;
    // Report in `a`'s full pixels even though both were decoded at grid size.
    const result = compareOutputs(read(first), read(second), options), sx = first.width / result.width, sy = first.height / result.height, box = result.bounds;
    return Object.freeze({
      ...result, width: first.width, height: first.height, sameSize: first.width === second.width && first.height === second.height,
      bounds: box && Object.freeze({ x: Math.floor(box.x * sx), y: Math.floor(box.y * sy), width: Math.min(first.width - Math.floor(box.x * sx), Math.ceil(box.width * sx)), height: Math.min(first.height - Math.floor(box.y * sy), Math.ceil(box.height * sy)) }),
    });
  } finally {
    for (const image of opened) image.close?.();
  }
}
