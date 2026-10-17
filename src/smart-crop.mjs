/**
 * Focus-aware cover cropping. Original, deterministic and local: it reads a
 * small thumbnail of an already decoded image, scores visual interest and
 * slides the largest crop of the target aspect toward it. It uses no model,
 * network, face or skin-tone heuristic. Flat or uniform images keep a centred
 * crop, so the result is never worse than a plain `cover` fit.
 *
 * Interest combines two classic, inexpensive signals on a 96-pixel thumbnail:
 * - detail: Sobel gradient magnitude of luminance;
 * - distinctiveness: OKLab distance from the image's mean color, as in
 *   frequency-tuned salient-region detection (Achanta et al., CVPR 2009).
 * A cover crop at full scale can move along one axis only, so the search is
 * a 1D scan that favours windows holding the interest near their centre.
 */
export const SMART_CROP_LIMITS = Object.freeze({ analysisEdge: 96, maxMapPixels: 262_144, candidates: 97 });

const LINEAR = Float32Array.from({ length: 256 }, (_, value) => {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
});

function checkMapSize(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > SMART_CROP_LIMITS.maxMapPixels) {
    throw new RangeError(`Focus maps must be whole-pixel sizes with at most ${SMART_CROP_LIMITS.maxMapPixels.toLocaleString('en-US')} pixels.`);
  }
}

function boxBlur(values, width, height, radius) {
  if (radius < 1) return values;
  const temp = new Float32Array(values.length), out = new Float32Array(values.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0, count = 0;
      for (let dx = -radius; dx <= radius; dx++) { const sx = x + dx; if (sx >= 0 && sx < width) { sum += values[y * width + sx]; count++; } }
      temp[y * width + x] = sum / count;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0, count = 0;
      for (let dy = -radius; dy <= radius; dy++) { const sy = y + dy; if (sy >= 0 && sy < height) { sum += temp[sy * width + x]; count++; } }
      out[y * width + x] = sum / count;
    }
  }
  return out;
}

/**
 * Score visual interest for RGBA pixels (row-major, 4 bytes per pixel).
 * Returns a non-negative Float32Array of `width * height` weights. Fully
 * transparent pixels have no interest. A flat image returns all zeros.
 */
export function computeFocusMap(rgba, width, height) {
  checkMapSize(width, height);
  if (!(rgba instanceof Uint8ClampedArray || rgba instanceof Uint8Array) || rgba.length !== width * height * 4) {
    throw new TypeError('Focus pixels must be RGBA bytes matching the map size.');
  }
  const count = width * height;
  const luma = new Float32Array(count), alpha = new Float32Array(count);
  const labA = new Float32Array(count), labB = new Float32Array(count);
  let weight = 0, meanL = 0, meanA = 0, meanB = 0;
  for (let index = 0; index < count; index++) {
    const offset = index * 4;
    const r = LINEAR[rgba[offset]], g = LINEAR[rgba[offset + 1]], b = LINEAR[rgba[offset + 2]], a = rgba[offset + 3] / 255;
    // OKLab: https://bottosson.github.io/posts/oklab/
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    luma[index] = L; labA[index] = A; labB[index] = B; alpha[index] = a;
    weight += a; meanL += L * a; meanA += A * a; meanB += B * a;
  }
  const map = new Float32Array(count);
  if (weight <= 0) return map;
  meanL /= weight; meanA /= weight; meanB /= weight;
  const at = (x, y) => luma[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
  const detail = new Float32Array(count);
  const distinct = new Float32Array(count);
  let detailSum = 0, distinctSum = 0;
  // A light blur first, so distinctiveness describes regions rather than noise.
  const smooth = [luma, labA, labB].map(channel => boxBlur(channel, width, height, 1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      detail[index] = Math.hypot(gx, gy) * alpha[index];
      distinct[index] = Math.hypot(smooth[0][index] - meanL, smooth[1][index] - meanA, smooth[2][index] - meanB) * alpha[index];
      detailSum += detail[index]; distinctSum += distinct[index];
    }
  }
  // Normalise each signal by its mean so neither dominates by units alone.
  // Means below a small OKLab floor (far under a visible difference) are flat.
  const detailScale = detailSum / count > 1e-3 ? count / detailSum : 0;
  const distinctScale = distinctSum / count > 1e-3 ? count / distinctSum : 0;
  for (let index = 0; index < count; index++) map[index] = detail[index] * detailScale + distinct[index] * distinctScale;
  return boxBlur(map, width, height, Math.max(1, Math.round(Math.min(width, height) / 24)));
}

/**
 * Find the largest crop of `aspect` (width / height) inside a focus map.
 * Returns fractions of the source: `{ x, y, width, height }`, each 0–1.
 * `edgeFalloff` (0–1) values interest near the crop's centre over its edges;
 * `centerBias` (0–1) gently prefers the image centre and breaks ties.
 */
export function findFocusCrop(map, width, height, aspect, { edgeFalloff = 0.5, centerBias = 0.08 } = {}) {
  checkMapSize(width, height);
  if (!(map instanceof Float32Array) || map.length !== width * height) throw new TypeError('Use a focus map from computeFocusMap.');
  if (!Number.isFinite(aspect) || aspect <= 0) throw new RangeError('Crop aspect must be a positive number.');
  const falloff = Math.min(1, Math.max(0, Number(edgeFalloff) || 0));
  const bias = Math.min(1, Math.max(0, Number(centerBias) || 0));
  const horizontal = aspect < width / height;
  const length = horizontal ? width : height;
  const window = horizontal ? height * aspect : width / aspect;
  const centred = horizontal ? { x: (1 - window / width) / 2, y: 0, width: window / width, height: 1 } : { x: 0, y: (1 - window / height) / 2, width: 1, height: window / height };
  const span = length - window;
  if (span <= 1e-6) return centred;
  const profile = new Float64Array(length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) profile[horizontal ? x : y] += map[y * width + x];
  if (!profile.some(value => value > 0)) return centred;
  let best = -1, bestOffset = span / 2;
  const candidates = SMART_CROP_LIMITS.candidates;
  for (let step = 0; step < candidates; step++) {
    const offset = span * step / (candidates - 1);
    const middle = offset + window / 2;
    let score = 0;
    for (let index = Math.floor(offset); index < Math.min(length, Math.ceil(offset + window)); index++) {
      const overlap = Math.min(index + 1, offset + window) - Math.max(index, offset);
      if (overlap <= 0) continue;
      const u = (index + 0.5 - middle) / (window / 2);
      score += profile[index] * overlap * Math.max(0, 1 - falloff * u * u);
    }
    const c = (offset - span / 2) / (span / 2);
    score *= 1 - bias * c * c;
    if (score > best) { best = score; bestOffset = offset; }
  }
  return horizontal
    ? { x: bestOffset / width, y: 0, width: window / width, height: 1 }
    : { x: 0, y: bestOffset / height, width: 1, height: window / height };
}

/**
 * The source rectangle, in source pixels, for drawing `source` to cover a
 * `targetWidth` × `targetHeight` box. Without a focus map it is centred, like
 * CSS `object-fit: cover`. Use it with the nine-argument `drawImage`.
 */
export function focusCoverRect(sourceWidth, sourceHeight, targetWidth, targetHeight, focus = null) {
  if (![sourceWidth, sourceHeight, targetWidth, targetHeight].every(value => Number.isFinite(value) && value > 0)) {
    throw new RangeError('Cover dimensions must be positive numbers.');
  }
  const aspect = targetWidth / targetHeight;
  const width = sourceWidth / sourceHeight > aspect ? sourceHeight * aspect : sourceWidth;
  const height = sourceWidth / sourceHeight > aspect ? sourceHeight : sourceWidth / aspect;
  let x = (sourceWidth - width) / 2, y = (sourceHeight - height) / 2;
  if (focus) {
    const crop = findFocusCrop(focus.map, focus.width, focus.height, aspect);
    x = Math.min(sourceWidth - width, Math.max(0, (crop.x + crop.width / 2) * sourceWidth - width / 2));
    y = Math.min(sourceHeight - height, Math.max(0, (crop.y + crop.height / 2) * sourceHeight - height / 2));
  }
  return { x, y, width, height };
}

/**
 * Read a focus map from a decoded ImageBitmap, image or canvas. Returns
 * `{ map, width, height }`, or null when this environment cannot read
 * pixels; callers then keep a centred crop. Reads at most 96 × 96 pixels.
 */
export function analyzeImageFocus(source, sourceWidth, sourceHeight) {
  if (!source || !(sourceWidth > 0) || !(sourceHeight > 0)) return null;
  const scale = Math.min(1, SMART_CROP_LIMITS.analysisEdge / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale)), height = Math.max(1, Math.round(sourceHeight * scale));
  let canvas;
  if (typeof OffscreenCanvas === 'function') canvas = new OffscreenCanvas(width, height);
  else if (typeof document !== 'undefined' && typeof CanvasRenderingContext2D === 'function') canvas = document.createElement('canvas');
  else return null;
  try {
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context || typeof context.getImageData !== 'function') return null;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'medium';
    context.drawImage(source, 0, 0, width, height);
    return { map: computeFocusMap(context.getImageData(0, 0, width, height).data, width, height), width, height };
  } catch {
    // A tainted or lost canvas only disables focus; the crop stays centred.
    return null;
  } finally { canvas.width = 1; canvas.height = 1; }
}
