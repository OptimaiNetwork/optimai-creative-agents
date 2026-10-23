/**
 * Perceptual color core. Original, deterministic and dependency-free; runs in
 * Node and the browser. Colors are `#rgb`/`#rrggbb` strings or `[r, g, b]`
 * arrays with 0–255 channels; results are `#rrggbb` strings.
 *
 * - OKLab and OKLCH conversions (https://bottosson.github.io/posts/oklab/),
 *   with gamut mapping that keeps lightness and hue and lowers chroma.
 * - Perceptual mixing in OKLab.
 * - WCAG 2.x contrast for pass/fail, plus a polarity-aware OKLab lightness
 *   contrast for ranking. The second is a simple original measure on an
 *   Lc-like 0–100 scale, not APCA; use WCAG for conformance.
 * - `pickLegibleColor`: keep a creator's ink when it already reads over every
 *   background, otherwise move only its lightness until it does.
 * - `dominantColors`: weighted k-means in OKLab over a 15-bit histogram,
 *   seeded deterministically, so the same image always gives the same palette.
 */
import { contrastRatio as rgbContrast, relativeLuminance as rgbLuminance, srgbToOklab as rgbToOklab } from './verify.mjs';

export const COLOR_LIMITS = Object.freeze({ analysisEdge: 64, maxPixels: 262_144, maxColors: 12, maxSurfaces: 64, iterations: 10 });

/** Parse `#rgb` or `#rrggbb` into `[r, g, b]`; throws on anything else. */
export function parseHexColor(hex) {
  const match = typeof hex === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new TypeError('Use a hex color such as #101312.');
  const digits = match[1].length === 3 ? match[1].replace(/./g, '$&$&') : match[1];
  return [0, 2, 4].map(index => parseInt(digits.slice(index, index + 2), 16));
}
const rgb = color => {
  if (typeof color === 'string') return parseHexColor(color);
  if (!Array.isArray(color) || color.length < 3 || color.slice(0, 3).some(value => !Number.isFinite(value) || value < 0 || value > 255)) {
    throw new TypeError('Colors must be hex strings or [r, g, b] arrays with 0–255 channels.');
  }
  return color.slice(0, 3);
};
/** Format `[r, g, b]` (rounded and clamped) as `#rrggbb`. */
export function formatHexColor(color) {
  return `#${rgb(color.map?.(value => Math.min(255, Math.max(0, Math.round(value)))) ?? color).map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG 2.x relative luminance, 0 (black) to 1 (white). */
export const relativeLuminance = color => rgbLuminance(rgb(color));
/** WCAG 2.x contrast ratio, 1 to 21. */
export const contrastRatio = (a, b) => rgbContrast(rgb(a), rgb(b));
/** OKLab `[L, a, b]`. */
export const toOklab = color => rgbToOklab(rgb(color));
/** OKLCH `[L, C, h]`, with hue in degrees 0–360 (0 for neutrals). */
export function toOklch(color) {
  const [L, a, b] = toOklab(color), C = Math.hypot(a, b);
  return [L, C, C < 1e-6 ? 0 : (Math.atan2(b, a) * 180 / Math.PI + 360) % 360];
}

const encode = value => 255 * (value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055);
function oklabToLinear([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
const inGamut = channels => channels.every(value => value >= -1e-4 && value <= 1 + 1e-4);

/** Hex for OKLab `[L, a, b]`; out-of-gamut colors keep L and hue and lose chroma. */
export function fromOklab(lab) {
  if (!Array.isArray(lab) || lab.length < 3 || lab.slice(0, 3).some(value => !Number.isFinite(value))) throw new TypeError('OKLab colors must be [L, a, b] numbers.');
  const L = Math.min(1, Math.max(0, lab[0]));
  let channels = oklabToLinear([L, lab[1], lab[2]]);
  if (!inGamut(channels)) {
    let low = 0, high = 1;
    for (let step = 0; step < 20; step++) { const mid = (low + high) / 2; if (inGamut(oklabToLinear([L, lab[1] * mid, lab[2] * mid]))) low = mid; else high = mid; }
    channels = oklabToLinear([L, lab[1] * low, lab[2] * low]);
  }
  return formatHexColor(channels.map(value => encode(Math.min(1, Math.max(0, value)))));
}
/** Hex for OKLCH `[L, C, h]` (hue in degrees), gamut-mapped by chroma. */
export function fromOklch([L, C, h] = []) {
  if (![L, C, h].every(Number.isFinite) || C < 0) throw new TypeError('OKLCH colors must be [L, C, h] numbers with C ≥ 0.');
  const angle = h * Math.PI / 180;
  return fromOklab([L, C * Math.cos(angle), C * Math.sin(angle)]);
}

/** Mix two colors in OKLab; `amount` 0 returns `a`, 1 returns `b`. */
export function mixColors(a, b, amount = 0.5) {
  const t = Math.min(1, Math.max(0, Number(amount)));
  if (!Number.isFinite(t)) throw new RangeError('Mix amount must be a number from 0 to 1.');
  const p = toOklab(a), q = toOklab(b);
  return fromOklab(p.map((value, index) => value + (q[index] - value) * t));
}

/**
 * Polarity-aware lightness contrast on an Lc-like scale: about +100 for
 * black on white, about −100 for white on black, 0 for equal lightness.
 * Positive means darker text on a lighter background. Not APCA.
 */
export function lightnessContrast(text, background) {
  return (toOklab(background)[0] - toOklab(text)[0]) * 100;
}

function surfaceList(backgrounds) {
  const list = (Array.isArray(backgrounds) && !(backgrounds.length === 3 && backgrounds.every(Number.isFinite)) ? backgrounds : [backgrounds])
    .map(entry => (entry && typeof entry === 'object' && !Array.isArray(entry) ? entry.color : entry));
  if (!list.length || list.length > COLOR_LIMITS.maxSurfaces) throw new RangeError(`Pass between 1 and ${COLOR_LIMITS.maxSurfaces} background colors.`);
  return list.map(rgb);
}

/**
 * Choose a text color that meets `minContrast` (WCAG ratio, default 4.5)
 * over every background. Preferred colors are tried in order: each is kept
 * as is when it passes, otherwise its OKLCH lightness moves the shortest
 * distance that passes, keeping its hue. Without a passing option, the
 * highest-contrast candidate is returned with `passes: false`; add a scrim.
 * Returns `{ color, contrast, lightness, passes, adjusted }`, where
 * `contrast` and `lightness` are the worst case over the backgrounds.
 */
export function pickLegibleColor(backgrounds, { prefer = [], minContrast = 4.5 } = {}) {
  const surfaces = surfaceList(backgrounds);
  const target = Number(minContrast);
  if (!Number.isFinite(target) || target < 1 || target > 21) throw new RangeError('minContrast must be a WCAG ratio from 1 to 21.');
  const worst = color => Math.min(...surfaces.map(surface => rgbContrast(color, surface)));
  const answer = (hex, adjusted) => {
    const color = parseHexColor(hex), contrast = worst(color);
    const lightness = Math.min(...surfaces.map(surface => Math.abs(lightnessContrast(color, surface))));
    return { color: hex.toLowerCase(), contrast, lightness, passes: contrast >= target, adjusted };
  };
  const preferred = (Array.isArray(prefer) && !(prefer.length === 3 && prefer.every(Number.isFinite)) ? prefer : [prefer]).filter(Boolean).map(color => formatHexColor(rgb(color)));
  for (const hex of preferred) {
    if (worst(parseHexColor(hex)) >= target) return answer(hex, false);
    const [L, C, h] = toOklch(hex);
    let best = null;
    for (const direction of [1, -1]) {
      for (let step = 1; step <= 100; step++) {
        const lightness = L + direction * step / 100;
        if (lightness < 0 || lightness > 1) break;
        const candidate = fromOklch([lightness, C, h]);
        if (worst(parseHexColor(candidate)) >= target) { if (!best || step < best.step) best = { candidate, step }; break; }
      }
    }
    if (best) return answer(best.candidate, true);
  }
  // Over mixed light and dark backgrounds the best ink can be a mid tone.
  const fallbacks = ['#ffffff', '#000000', ...[...preferred.map(hex => toOklch(hex).slice(1)), [0, 0]].flatMap(([C, h]) => Array.from({ length: 49 }, (_, step) => fromOklch([(step + 1) / 50, C, h])))];
  const strongest = fallbacks.reduce((best, hex) => (worst(parseHexColor(hex)) > worst(parseHexColor(best)) + 1e-9 ? hex : best));
  return answer(strongest, preferred.length > 0);
}

/**
 * Dominant colors of RGBA pixels (row-major, 4 bytes each), largest first:
 * `[{ color, weight, oklch }]`, where weights are fractions summing to 1.
 * Alpha weights each pixel; a fully transparent image returns `[]`.
 */
export function dominantColors(rgba, width, height, { count = 5 } = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > COLOR_LIMITS.maxPixels) {
    throw new RangeError(`Palettes read whole-pixel images with at most ${COLOR_LIMITS.maxPixels.toLocaleString('en-US')} pixels; pass a thumbnail.`);
  }
  if (!(rgba instanceof Uint8ClampedArray || rgba instanceof Uint8Array) || rgba.length !== width * height * 4) throw new TypeError('Palette pixels must be RGBA bytes matching the image size.');
  if (!Number.isInteger(count) || count < 1 || count > COLOR_LIMITS.maxColors) throw new RangeError(`Ask for 1 to ${COLOR_LIMITS.maxColors} colors.`);
  // A 5-bit-per-channel histogram bounds the clustering work by distinct colors, not pixels.
  const sums = new Float64Array(32_768 * 4);
  let total = 0;
  for (let offset = 0; offset < rgba.length; offset += 4) {
    const alpha = rgba[offset + 3] / 255;
    if (alpha <= 0) continue;
    const bin = ((rgba[offset] >> 3) << 10 | (rgba[offset + 1] >> 3) << 5 | rgba[offset + 2] >> 3) * 4;
    const [L, a, b] = rgbToOklab([rgba[offset], rgba[offset + 1], rgba[offset + 2]]);
    sums[bin] += alpha; sums[bin + 1] += L * alpha; sums[bin + 2] += a * alpha; sums[bin + 3] += b * alpha; total += alpha;
  }
  if (total <= 0) return [];
  const points = [], weights = [];
  for (let bin = 0; bin < sums.length; bin += 4) if (sums[bin] > 0) { weights.push(sums[bin]); points.push([sums[bin + 1] / sums[bin], sums[bin + 2] / sums[bin], sums[bin + 3] / sums[bin]]); }
  const distance = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
  // Deterministic k-means++: start at the heaviest color, then add the color
  // with the most weight far from every centre.
  let centres = [points[weights.indexOf(Math.max(...weights))]];
  const nearest = points.map(point => distance(point, centres[0]));
  while (centres.length < count) {
    let pick = -1, score = 1e-9;
    for (let index = 0; index < points.length; index++) if (weights[index] * nearest[index] > score) { score = weights[index] * nearest[index]; pick = index; }
    if (pick < 0) break;
    centres.push(points[pick]);
    for (let index = 0; index < points.length; index++) nearest[index] = Math.min(nearest[index], distance(points[index], points[pick]));
  }
  let members = new Float64Array(centres.length);
  for (let iteration = 0; iteration < COLOR_LIMITS.iterations; iteration++) {
    const next = centres.map(() => [0, 0, 0]); members = new Float64Array(centres.length);
    let moved = 0;
    points.forEach((point, index) => {
      let closest = 0;
      for (let centre = 1; centre < centres.length; centre++) if (distance(point, centres[centre]) < distance(point, centres[closest])) closest = centre;
      members[closest] += weights[index];
      for (let axis = 0; axis < 3; axis++) next[closest][axis] += point[axis] * weights[index];
    });
    next.forEach((sum, centre) => {
      if (!members[centre]) return;
      const mean = sum.map(value => value / members[centre]);
      moved = Math.max(moved, distance(mean, centres[centre])); centres[centre] = mean;
    });
    if (moved < 1e-8) break;
  }
  return centres.map((lab, index) => ({ lab, weight: members[index] / total }))
    .filter(entry => entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || b.lab[0] - a.lab[0])
    .map(({ lab, weight }) => { const color = fromOklab(lab); return { color, weight, oklch: toOklch(color) }; });
}

/**
 * The most vivid color that is also present: highest chroma × √weight among
 * swatches with chroma ≥ `minChroma` and weight ≥ `minWeight`, or null for a
 * near-neutral palette.
 */
export function pickAccentColor(palette, { minChroma = 0.05, minWeight = 0.02 } = {}) {
  if (!Array.isArray(palette)) throw new TypeError('Pass a palette from dominantColors.');
  let best = null, score = 0;
  for (const swatch of palette) {
    const [, C] = toOklch(swatch.color), weight = Number(swatch.weight) || 0;
    if (C >= minChroma && weight >= minWeight && C * Math.sqrt(weight) > score) { score = C * Math.sqrt(weight); best = swatch.color; }
  }
  return best;
}

/**
 * Read the dominant colors of a decoded image, video frame or canvas, or of
 * `region` (`{ x, y, width, height }` in source pixels) within it, from a
 * thumbnail of at most 64 pixels. Returns null when this environment cannot
 * read pixels, so callers keep their chosen colors.
 */
export function analyzeImageColors(source, sourceWidth, sourceHeight, { region, count = 5 } = {}) {
  if (!source || !(sourceWidth > 0) || !(sourceHeight > 0)) return null;
  const x = Math.max(0, Math.min(sourceWidth - 1, region?.x ?? 0)), y = Math.max(0, Math.min(sourceHeight - 1, region?.y ?? 0));
  const areaWidth = Math.max(1, Math.min(sourceWidth - x, region?.width ?? sourceWidth)), areaHeight = Math.max(1, Math.min(sourceHeight - y, region?.height ?? sourceHeight));
  if (![x, y, areaWidth, areaHeight].every(Number.isFinite)) return null;
  const scale = Math.min(1, COLOR_LIMITS.analysisEdge / Math.max(areaWidth, areaHeight));
  const width = Math.max(1, Math.round(areaWidth * scale)), height = Math.max(1, Math.round(areaHeight * scale));
  let canvas;
  if (typeof OffscreenCanvas === 'function') canvas = new OffscreenCanvas(width, height);
  else if (typeof document !== 'undefined' && typeof CanvasRenderingContext2D === 'function') canvas = document.createElement('canvas');
  else return null;
  try {
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context || typeof context.getImageData !== 'function') return null;
    context.imageSmoothingEnabled = true;
    context.drawImage(source, x, y, areaWidth, areaHeight, 0, 0, width, height);
    return dominantColors(context.getImageData(0, 0, width, height).data, width, height, { count });
  } catch {
    // A tainted or lost canvas only disables color analysis.
    return null;
  } finally { canvas.width = 1; canvas.height = 1; }
}
