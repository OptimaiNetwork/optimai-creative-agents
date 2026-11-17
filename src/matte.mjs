/**
 * Edge-aware matte refinement. A coarse segmentation mask (low resolution, soft, blind to hair) is snapped to the
 * picture's own edges with a colour guided filter (He, Sun & Tang) run at a bounded working size and applied at full
 * size ("fast guided filter"), then edge colours are cleaned with blur-fusion foreground estimation (Forte & Pitié)
 * so a cutout keeps no fringe of its old background. Every step is linear in pixels. No dependencies, no DOM.
 */
export const MATTE_DEFAULTS = Object.freeze({ radius: 0, epsilon: 0.001, band: 0.3, maxSide: 512, foreground: true });
export const MATTE_LIMITS = Object.freeze({ minRadius: 1, maxRadius: 32, minEpsilon: 1e-6, maxEpsilon: 0.1, minBand: 0.05, maxBand: 0.5, minSide: 64, maxSide: 1024, maxPixels: 16_777_216 });

const bad = message => { throw new RangeError(message); };
/**
 * Validated options. `radius: 0` picks one from the working size (about 1/80 of its long side); `epsilon` is how much
 * colour change counts as an edge; `band` is the half-width around alpha 0.5 kept soft after filtering (0.5 keeps the
 * filter's own ramp, smaller is crisper); `foreground` cleans edge colours in `apply`.
 */
export function resolveMatteOptions(options = {}) {
  const o = { ...MATTE_DEFAULTS, ...Object.fromEntries(Object.entries(options || {}).filter(([, v]) => v !== undefined)) };
  const L = MATTE_LIMITS;
  if (!Number.isInteger(o.radius) || (o.radius !== 0 && (o.radius < L.minRadius || o.radius > L.maxRadius))) bad(`Matte radius must be 0 (automatic) or an integer from ${L.minRadius} to ${L.maxRadius}.`);
  if (!Number.isFinite(o.epsilon) || o.epsilon < L.minEpsilon || o.epsilon > L.maxEpsilon) bad(`Matte epsilon must be from ${L.minEpsilon} to ${L.maxEpsilon}.`);
  if (!Number.isFinite(o.band) || o.band < L.minBand || o.band > L.maxBand) bad(`Matte band must be from ${L.minBand} to ${L.maxBand}.`);
  if (!Number.isInteger(o.maxSide) || o.maxSide < L.minSide || o.maxSide > L.maxSide) bad(`Matte working size must be an integer from ${L.minSide} to ${L.maxSide}.`);
  if (typeof o.foreground !== 'boolean') bad('Matte foreground must be true or false.');
  return { radius: o.radius, epsilon: o.epsilon, band: o.band, maxSide: o.maxSide, foreground: o.foreground };
}
/** The working grid: the image's aspect, long side at most `maxSide`, never larger than the image. */
export function matteWorkSize(width, height, maxSide = MATTE_DEFAULTS.maxSide) {
  const s = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}
function checkImage(image, label, channels) {
  const { data, width, height } = image || {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > MATTE_LIMITS.maxPixels) bad(`The ${label} needs whole, positive dimensions up to ${MATTE_LIMITS.maxPixels} pixels.`);
  if (!data || data.length !== width * height * channels) bad(`The ${label} data must hold ${channels === 4 ? 'RGBA' : 'one value per'} pixel${channels === 4 ? 's' : ''}.`);
}
/** Mask values as 0–1: float arrays are read as-is, byte arrays as 0–255. */
const maskScale = data => (data instanceof Float32Array || data instanceof Float64Array ? 1 : 1 / 255);

/** Mean over a (2r+1)² window, clamped at the borders (divides by the pixels actually inside). O(n) for any r. */
export function boxMean(src, width, height, radius, out = new Float32Array(width * height), tmp = new Float32Array(width * height)) {
  const r = Math.max(0, radius | 0);
  for (let y = 0, row = 0; y < height; y++, row += width) {
    let s = 0;
    for (let x = 0; x <= Math.min(r, width - 1); x++) s += src[row + x];
    for (let x = 0; x < width; x++) {
      tmp[row + x] = s / (Math.min(x + r, width - 1) - Math.max(x - r, 0) + 1);
      if (x + r + 1 < width) s += src[row + x + r + 1];
      if (x - r >= 0) s -= src[row + x - r];
    }
  }
  for (let x = 0; x < width; x++) {
    let s = 0;
    for (let y = 0; y <= Math.min(r, height - 1); y++) s += tmp[y * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = s / (Math.min(y + r, height - 1) - Math.max(y - r, 0) + 1);
      if (y + r + 1 < height) s += tmp[(y + r + 1) * width + x];
      if (y - r >= 0) s -= tmp[(y - r) * width + x];
    }
  }
  return out;
}
/** Area-average (down) or bilinear (up) resample of `channels` interleaved planes into separate 0–1 planes. */
function resample(data, sw, sh, dw, dh, channels, pick, scale, planes) {
  if (dw <= sw && dh <= sh) {
    for (let y = 0; y < dh; y++) {
      const y0 = Math.floor(y * sh / dh), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sh / dh));
      for (let x = 0; x < dw; x++) {
        const x0 = Math.floor(x * sw / dw), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sw / dw)), n = (x1 - x0) * (y1 - y0);
        for (let c = 0; c < pick.length; c++) {
          let s = 0;
          for (let yy = y0; yy < y1; yy++) for (let xx = x0, i = (yy * sw + x0) * channels + pick[c]; xx < x1; xx++, i += channels) s += data[i];
          planes[c][y * dw + x] = s * scale / n;
        }
      }
    }
    return;
  }
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * sh / dh - 0.5)), y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * sw / dw - 0.5)), x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), wx = fx - x0;
      for (let c = 0; c < pick.length; c++) {
        const k = pick[c], a = data[(y0 * sw + x0) * channels + k], b = data[(y0 * sw + x1) * channels + k], d = data[(y1 * sw + x0) * channels + k], e = data[(y1 * sw + x1) * channels + k];
        planes[c][y * dw + x] = ((a + (b - a) * wx) * (1 - wy) + (d + (e - d) * wx) * wy) * scale;
      }
    }
  }
}
/** Bilinear read of a working-grid plane at full-size pixel (x, y), pixel centres aligned. */
function sampler(ww, wh, fw, fh) {
  const sx = ww / fw, sy = wh / fh;
  return (plane, x, y) => {
    const fx = Math.min(ww - 1, Math.max(0, (x + 0.5) * sx - 0.5)), fy = Math.min(wh - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const x0 = fx | 0, y0 = fy | 0, x1 = Math.min(ww - 1, x0 + 1), y1 = Math.min(wh - 1, y0 + 1), wx = fx - x0, wy = fy - y0;
    const a = plane[y0 * ww + x0], b = plane[y0 * ww + x1], c = plane[y1 * ww + x0], d = plane[y1 * ww + x1];
    return (a + (b - a) * wx) * (1 - wy) + (c + (d - c) * wx) * wy;
  };
}

/**
 * A refiner that keeps its scratch planes between calls, for video: one per stream, `dispose()` when done.
 * `refine` returns the full-size alpha (0–255); `apply` also writes it, with cleaned edge colours, into `image.data`.
 */
export function createMatteRefiner(defaults = {}) {
  const base = resolveMatteOptions(defaults);
  let size = 0, P = null;
  const planes = n => {
    if (n !== size) { size = n; P = Array.from({ length: 24 }, () => new Float32Array(n)); }
    return P;
  };
  function run(image, mask, options, write) {
    checkImage(image, 'image', 4); checkImage(mask, 'mask', 1);
    const o = resolveMatteOptions({ ...base, ...options });
    const { width: W, height: H, data: px } = image, { width: w, height: h } = matteWorkSize(W, H, o.maxSide), n = w * h;
    const r = o.radius || Math.max(2, Math.round(Math.max(w, h) / 80)), eps = o.epsilon, band = o.band;
    const [R, G, B, p, mR, mG, mB, mP, rr, rg, rb, gg, gb, bb, pr, pg, pb, tmp, prod, aR, aG, aB, bP, fa] = planes(n);
    resample(px, W, H, w, h, 4, [0, 1, 2], 1 / 255, [R, G, B]);
    resample(mask.data, mask.width, mask.height, w, h, 1, [0], maskScale(mask.data), [p]);
    const box = (src, out) => boxMean(src, w, h, r, out, tmp);
    const boxProduct = (x, y, out) => { for (let i = 0; i < n; i++) prod[i] = x[i] * y[i]; return box(prod, out); };
    box(R, mR); box(G, mG); box(B, mB); box(p, mP);
    boxProduct(R, R, rr); boxProduct(R, G, rg); boxProduct(R, B, rb); boxProduct(G, G, gg); boxProduct(G, B, gb); boxProduct(B, B, bb);
    boxProduct(R, p, pr); boxProduct(G, p, pg); boxProduct(B, p, pb);
    for (let i = 0; i < n; i++) {
      // Σ + εI is symmetric positive definite; solve a = (Σ + εI)⁻¹ cov(I, p) by its adjugate.
      const ur = mR[i], ug = mG[i], ub = mB[i], up = mP[i];
      const a11 = rr[i] - ur * ur + eps, a12 = rg[i] - ur * ug, a13 = rb[i] - ur * ub, a22 = gg[i] - ug * ug + eps, a23 = gb[i] - ug * ub, a33 = bb[i] - ub * ub + eps;
      const cr = pr[i] - ur * up, cg = pg[i] - ug * up, cb = pb[i] - ub * up;
      const i11 = a22 * a33 - a23 * a23, i12 = a13 * a23 - a12 * a33, i13 = a12 * a23 - a13 * a22, i22 = a11 * a33 - a13 * a13, i23 = a12 * a13 - a11 * a23, i33 = a11 * a22 - a12 * a12;
      const det = a11 * i11 + a12 * i12 + a13 * i13 || 1e-12;
      const kr = (i11 * cr + i12 * cg + i13 * cb) / det, kg = (i12 * cr + i22 * cg + i23 * cb) / det, kb = (i13 * cr + i23 * cg + i33 * cb) / det;
      aR[i] = kr; aG[i] = kg; aB[i] = kb; bP[i] = up - kr * ur - kg * ug - kb * ub;
    }
    // Average the per-window coefficients (reuse the product planes), then apply them at full size.
    box(aR, pr); box(aG, pg); box(aB, pb); box(bP, rr);
    const at = sampler(w, h, W, H), alpha = new Uint8ClampedArray(W * H);
    let sum = 0;
    for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
      const q = at(pr, x, y) * px[i * 4] / 255 + at(pg, x, y) * px[i * 4 + 1] / 255 + at(pb, x, y) * px[i * 4 + 2] / 255 + at(rr, x, y);
      // The filter places the edge from the picture but keeps the coarse mask's ramp; a smoothstep about 0.5 restores a crisp edge.
      const t = Math.min(1, Math.max(0, (q - 0.5 + band) / (2 * band))), v = Math.round(255 * t * t * (3 - 2 * t));
      alpha[i] = v; sum += v;
    }
    const result = { alpha, width: W, height: H, coverage: Math.round(sum / 255 / (W * H) * 10000) / 10000, radius: r, epsilon: eps, band, workWidth: w, workHeight: h };
    if (!write) return result;
    if (o.foreground) {
      // Blur-fusion: local foreground and background colour means, weighted by the refined alpha on the working grid.
      resample(alpha, W, H, w, h, 1, [0], 1 / 255, [fa]);
      const rf = Math.max(2, r * 2), bf = (src, out) => boxMean(src, w, h, rf, out, tmp);
      const weighted = (plane, weight, out) => { for (let i = 0; i < n; i++) prod[i] = plane[i] * weight(i); return bf(prod, out); };
      const on = i => fa[i], off = i => 1 - fa[i];
      bf(fa, mP); for (let i = 0; i < n; i++) p[i] = 1 - fa[i]; bf(p, bP);
      weighted(R, on, mR); weighted(G, on, mG); weighted(B, on, mB); weighted(R, off, aR); weighted(G, off, aG); weighted(B, off, aB);
      for (let i = 0; i < n; i++) {
        const f = mP[i] > 1e-4 ? 1 / mP[i] : 0, g = bP[i] > 1e-4 ? 1 / bP[i] : 0;
        mR[i] = f ? mR[i] * f : R[i]; mG[i] = f ? mG[i] * f : G[i]; mB[i] = f ? mB[i] * f : B[i];
        aR[i] = g ? aR[i] * g : R[i]; aG[i] = g ? aG[i] * g : G[i]; aB[i] = g ? aB[i] * g : B[i];
      }
      for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
        const a = alpha[i] / 255;
        if (a <= 0.01 || a >= 0.99) continue;
        const fr = at(mR, x, y), fg = at(mG, x, y), fb = at(mB, x, y), br = at(aR, x, y), bg = at(aG, x, y), bb2 = at(aB, x, y), k = i * 4;
        px[k] = 255 * (fr + a * (px[k] / 255 - a * fr - (1 - a) * br));
        px[k + 1] = 255 * (fg + a * (px[k + 1] / 255 - a * fg - (1 - a) * bg));
        px[k + 2] = 255 * (fb + a * (px[k + 2] / 255 - a * fb - (1 - a) * bb2));
      }
    }
    for (let i = 0; i < W * H; i++) px[i * 4 + 3] = alpha[i];
    return result;
  }
  return {
    refine: (image, mask, options) => run(image, mask, options, false),
    apply: (image, mask, options) => run(image, mask, options, true),
    dispose() { size = 0; P = null; },
  };
}
/** One-off: the refined full-size alpha (0–255) for `image` (RGBA) from a coarse `mask` of any size. */
export const refineMatte = (image, mask, options) => createMatteRefiner().refine(image, mask, options);
/** One-off: refine, clean edge colours (unless `foreground: false`) and write alpha into `image.data` in place. */
export const applyMatte = (image, mask, options) => createMatteRefiner().apply(image, mask, options);
