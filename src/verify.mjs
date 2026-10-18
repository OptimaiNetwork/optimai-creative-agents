/**
 * Tier-0 verification: deterministic, local checks for creative assets.
 * Original and dependency-free. They need no model or network, and run in
 * Node and the browser in milliseconds, so an agent can reject a broken
 * candidate before paying for a model to judge it.
 *
 * Every check returns `{ check, pass, score, threshold, confidence, costMs }`.
 * Scores are oriented so that higher is always better, and `pass` means
 * `score >= threshold`. That orientation lets a host calibrate any score into
 * a probability with one monotone fit. `confidence` (0.5–1) grows with the
 * distance from the threshold; it is a margin, not a calibrated probability.
 *
 * Boxes are fractions of the frame: `{ x, y, width, height }`, each 0–1.
 */
import { SMART_CROP_LIMITS } from './smart-crop.mjs';

export const VERIFY_LIMITS = Object.freeze({ maxPixels: SMART_CROP_LIMITS.maxMapPixels, maxBoxes: 64, maxEvents: 4_096, maxPalette: 32 });

const now = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

function result(check, pass, score, threshold, scale, started) {
  const margin = Math.abs(score - threshold) / (scale > 0 ? scale : 1);
  return { check, pass, score, threshold, confidence: 0.5 + 0.5 * Math.min(1, Number.isFinite(margin) ? margin : 1), costMs: Math.max(0, now() - started) };
}

function checkPixels(pixels, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > VERIFY_LIMITS.maxPixels) {
    throw new RangeError(`Images must be whole-pixel sizes with at most ${VERIFY_LIMITS.maxPixels.toLocaleString('en-US')} pixels; check a thumbnail.`);
  }
  if (!(pixels instanceof Uint8ClampedArray || pixels instanceof Uint8Array) || pixels.length !== width * height * 4) {
    throw new TypeError('Pixels must be RGBA bytes matching the image size.');
  }
}

function checkColor(color, label = 'Colors') {
  if (!Array.isArray(color) || color.length < 3 || color.slice(0, 3).some(value => !Number.isFinite(value) || value < 0 || value > 255)) {
    throw new TypeError(`${label} must be [r, g, b] arrays with 0–255 channels.`);
  }
}

function checkBox(box) {
  const valid = box && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(box[key]))
    && box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0 && box.x + box.width <= 1 + 1e-9 && box.y + box.height <= 1 + 1e-9;
  if (!valid) throw new RangeError('Boxes must be { x, y, width, height } fractions inside the frame.');
}

function checkBoxes(boxes) {
  if (!Array.isArray(boxes) || boxes.length > VERIFY_LIMITS.maxBoxes) throw new RangeError(`Pass at most ${VERIFY_LIMITS.maxBoxes} boxes.`);
  boxes.forEach(checkBox);
}

function pixelBounds(box, width, height) {
  const x0 = Math.min(width - 1, Math.floor(box.x * width)), y0 = Math.min(height - 1, Math.floor(box.y * height));
  return { x0, y0, x1: Math.max(x0 + 1, Math.min(width, Math.ceil((box.x + box.width) * width))), y1: Math.max(y0 + 1, Math.min(height, Math.ceil((box.y + box.height) * height))) };
}

const LINEAR = Float64Array.from({ length: 256 }, (_, value) => {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
});
const linear = value => LINEAR[Math.round(Math.min(255, Math.max(0, value)))];

/** WCAG 2.x relative luminance of an sRGB color, 0 (black) to 1 (white). */
export function relativeLuminance(color) {
  checkColor(color);
  return 0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2]);
}

/** WCAG contrast ratio between two sRGB colors, 1 to 21. */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** OKLab coordinates `[L, a, b]` of an sRGB color (https://bottosson.github.io/posts/oklab/). */
export function srgbToOklab(color) {
  checkColor(color);
  const r = linear(color[0]), g = linear(color[1]), b = linear(color[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Euclidean OKLab distance between two sRGB colors (about 0.02 is just noticeable). */
export function deltaEOK(a, b) {
  const p = srgbToOklab(a), q = srgbToOklab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/**
 * Contrast of known-color text over the pixels behind it. The score is a low
 * percentile (default the 5th) of per-pixel WCAG contrast inside `box`, so a
 * busy background cannot hide behind its average. Transparent pixels are skipped.
 * Use `minRatio: 3` for large text (WCAG AA), 4.5 for body text.
 */
export function checkTextContrast(pixels, width, height, box, textColor, { minRatio = 4.5, percentile = 0.05 } = {}) {
  const started = now();
  checkPixels(pixels, width, height); checkBox(box); checkColor(textColor, 'Text color');
  if (!(minRatio >= 1 && minRatio <= 21) || !(percentile >= 0 && percentile <= 1)) throw new RangeError('minRatio must be 1–21 and percentile 0–1.');
  const textLum = relativeLuminance(textColor);
  const { x0, y0, x1, y1 } = pixelBounds(box, width, height);
  const ratios = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const offset = (y * width + x) * 4;
    if (pixels[offset + 3] === 0) continue;
    const lum = 0.2126 * LINEAR[pixels[offset]] + 0.7152 * LINEAR[pixels[offset + 1]] + 0.0722 * LINEAR[pixels[offset + 2]];
    ratios.push((Math.max(lum, textLum) + 0.05) / (Math.min(lum, textLum) + 0.05));
  }
  if (!ratios.length) return result('text-contrast', true, 21, minRatio, minRatio, started);
  ratios.sort((a, b) => a - b);
  const score = ratios[Math.floor(percentile * (ratios.length - 1))];
  return result('text-contrast', score >= minRatio, score, minRatio, minRatio, started);
}

/** Rendered text height in pixels against a minimum (for example 16 px at the delivered size). */
export function checkTextSize(heightPx, { minPx = 16 } = {}) {
  const started = now();
  if (!Number.isFinite(heightPx) || heightPx < 0 || !(minPx > 0)) throw new RangeError('Text height and minPx must be non-negative numbers.');
  return result('text-size', heightPx >= minPx, heightPx, minPx, minPx, started);
}

/**
 * How much of the image's visual interest the text leaves uncovered. `focus`
 * is `{ map, width, height }` from smart-crop's `computeFocusMap` or
 * `analyzeImageFocus`. The score is 1 minus the share of interest under the
 * union of `boxes`; it passes when at most `maxShare` is covered. A flat image
 * has no interest to cover and passes.
 */
export function checkTextOverlap(focus, boxes, { maxShare = 0.15 } = {}) {
  const started = now();
  if (!focus || !(focus.map instanceof Float32Array) || !Number.isInteger(focus.width) || !Number.isInteger(focus.height) || focus.map.length !== focus.width * focus.height) {
    throw new TypeError('Pass a focus map from computeFocusMap or analyzeImageFocus.');
  }
  checkBoxes(boxes);
  if (!(maxShare >= 0 && maxShare <= 1)) throw new RangeError('maxShare must be 0–1.');
  const { map, width, height } = focus;
  const covered = new Uint8Array(map.length);
  for (const box of boxes) {
    const { x0, y0, x1, y1 } = pixelBounds(box, width, height);
    for (let y = y0; y < y1; y++) covered.fill(1, y * width + x0, y * width + x1);
  }
  let total = 0, under = 0;
  for (let index = 0; index < map.length; index++) { total += map[index]; if (covered[index]) under += map[index]; }
  const score = total > 0 ? 1 - under / total : 1;
  return result('text-overlap', score >= 1 - maxShare, score, 1 - maxShare, Math.max(0.05, maxShare), started);
}

/**
 * Every box inside a safe zone (default: a 5% inset on each side). The score is
 * the smallest signed margin to the zone's edges, as a fraction of the frame;
 * negative means a box crosses the edge.
 */
export function checkSafeZone(boxes, { zone = { x: 0.05, y: 0.05, width: 0.9, height: 0.9 } } = {}) {
  const started = now();
  checkBoxes(boxes); checkBox(zone);
  let score = Infinity;
  for (const box of boxes) {
    score = Math.min(score, box.x - zone.x, box.y - zone.y, zone.x + zone.width - (box.x + box.width), zone.y + zone.height - (box.y + box.height));
  }
  if (!boxes.length) score = 1;
  return result('safe-zone', score >= 0, score, 0, 0.05, started);
}

/** Delivered size against a target aspect ratio. The score is 1 minus the relative error. */
export function checkAspect(width, height, aspect, { tolerance = 0.01 } = {}) {
  const started = now();
  if (![width, height, aspect].every(value => Number.isFinite(value) && value > 0) || !(tolerance >= 0)) throw new RangeError('Sizes and aspect must be positive numbers.');
  const score = 1 - Math.abs(width / height - aspect) / aspect;
  return result('aspect', score >= 1 - tolerance, score, 1 - tolerance, Math.max(tolerance, 0.005), started);
}

/** Duration in seconds within `[min, max]`. The score is the signed margin to the nearer bound, in seconds. */
export function checkDuration(seconds, { min = 0, max = Infinity } = {}) {
  const started = now();
  if (!Number.isFinite(seconds) || seconds < 0 || !(min >= 0) || !(max >= min)) throw new RangeError('Duration and bounds must be non-negative, with max at least min.');
  const score = Math.min(seconds - min, max - seconds);
  return result('duration', score >= 0, score, 0, Math.max(0.25, Number.isFinite(max) ? (max - min) / 4 : 1), started);
}

/** A detector's count (people, faces, objects) within `[min, max]`. The score is the signed margin to the nearer bound. */
export function checkCount(count, { min = 0, max = Infinity } = {}) {
  const started = now();
  if (!Number.isInteger(count) || count < 0 || !(min >= 0) || !(max >= min)) throw new RangeError('Counts must be non-negative integers, with max at least min.');
  const score = Math.min(count - min, max - count);
  return result('count', score >= 0, score, 0, 1, started);
}

/**
 * Share of opaque pixels whose nearest brand color is within `maxDeltaE` in
 * OKLab. Pass a thumbnail; at most `VERIFY_LIMITS.maxPixels` pixels are read.
 */
export function checkPalette(pixels, width, height, palette, { maxDeltaE = 0.08, minCoverage = 0.6 } = {}) {
  const started = now();
  checkPixels(pixels, width, height);
  if (!Array.isArray(palette) || !palette.length || palette.length > VERIFY_LIMITS.maxPalette) throw new RangeError(`Palettes need 1–${VERIFY_LIMITS.maxPalette} colors.`);
  palette.forEach(color => checkColor(color, 'Palette colors'));
  if (!(maxDeltaE > 0) || !(minCoverage >= 0 && minCoverage <= 1)) throw new RangeError('maxDeltaE must be positive and minCoverage 0–1.');
  const swatches = palette.map(srgbToOklab);
  const cache = new Map();
  let opaque = 0, near = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3] === 0) continue;
    opaque++;
    const key = (pixels[offset] << 16) | (pixels[offset + 1] << 8) | pixels[offset + 2];
    let hit = cache.get(key);
    if (hit === undefined) {
      const lab = srgbToOklab([pixels[offset], pixels[offset + 1], pixels[offset + 2]]);
      hit = swatches.some(s => Math.hypot(lab[0] - s[0], lab[1] - s[1], lab[2] - s[2]) <= maxDeltaE);
      cache.set(key, hit);
    }
    if (hit) near++;
  }
  const score = opaque ? near / opaque : 1;
  return result('palette', score >= minCoverage, score, minCoverage, 0.2, started);
}

/**
 * Edit timing: the share of cuts within `tolerance` seconds of a beat. Beat
 * times come from any tracker. An edit with no cuts passes vacuously.
 */
export function checkCutAlignment(cuts, beats, { tolerance = 0.07, minHitRate = 0.8 } = {}) {
  const started = now();
  for (const [label, list] of [['Cuts', cuts], ['Beats', beats]]) {
    if (!Array.isArray(list) || list.length > VERIFY_LIMITS.maxEvents || list.some(value => !Number.isFinite(value) || value < 0)) {
      throw new RangeError(`${label} must be at most ${VERIFY_LIMITS.maxEvents.toLocaleString('en-US')} non-negative times in seconds.`);
    }
  }
  if (!(tolerance >= 0) || !(minHitRate >= 0 && minHitRate <= 1)) throw new RangeError('tolerance must be non-negative and minHitRate 0–1.');
  if (!cuts.length) return result('cut-alignment', true, 1, minHitRate, 0.2, started);
  const sorted = [...beats].sort((a, b) => a - b);
  let hits = 0;
  for (const cut of cuts) {
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < cut) lo = mid + 1; else hi = mid; }
    const nearest = Math.min(lo < sorted.length ? sorted[lo] - cut : Infinity, lo > 0 ? cut - sorted[lo - 1] : Infinity);
    if (nearest <= tolerance + 1e-12) hits++;
  }
  const score = hits / cuts.length;
  return result('cut-alignment', score >= minHitRate, score, minHitRate, 0.2, started);
}

/** Combine check results: passes only if every check passes. */
export function summarizeChecks(results) {
  if (!Array.isArray(results)) throw new TypeError('Pass an array of check results.');
  return {
    pass: results.every(item => item.pass),
    failed: results.filter(item => !item.pass).map(item => item.check),
    minConfidence: results.length ? Math.min(...results.map(item => item.confidence)) : 1,
    costMs: results.reduce((sum, item) => sum + item.costMs, 0),
  };
}
