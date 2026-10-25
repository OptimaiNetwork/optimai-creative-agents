/**
 * Pixel color grade. Original, deterministic and dependency-free; runs on any
 * RGBA buffer in Node or the browser, so a finish never depends on
 * `CanvasRenderingContext2D.filter` and looks the same everywhere.
 *
 * Each pixel goes 8-bit sRGB → linear (table) → exposure → OKLab, then:
 * - a tone curve on L (S-shaped contrast pivoting on mid grey) and a black lift (fade);
 * - chroma: saturation scales all of it, vibrance mostly the muted colors;
 * - white balance: temperature moves b, tint moves a, weighted by lightness
 *   so blacks stay neutral;
 * - split tone: a hue pushed into the shadows and another into the highlights;
 * - grain: seeded triangular luminance noise, strongest in the midtones;
 * then back to linear, clipped per channel, and encoded through a 65536-step table.
 * Grain is keyed on absolute pixel coordinates and the seed, so the same image,
 * grade and seed always give identical bytes, whole or band by band.
 */
export const GRADE_LIMITS = Object.freeze({ pixels: 16_000_000, seed: 0xffffffff });

const IDENTITY = Object.freeze({ exposure: 0, contrast: 0, fade: 0, saturation: 1, vibrance: 0, temperature: 0, tint: 0, shadowHue: 0, shadowTint: 0, highlightHue: 0, highlightTint: 0, grain: 0 });
// [min, max] for each setting; hues are degrees and are never interpolated.
const RANGES = Object.freeze({ exposure: [-2, 2], contrast: [-1, 1], fade: [0, 0.3], saturation: [0, 2], vibrance: [-1, 1], temperature: [-1, 1], tint: [-1, 1], shadowHue: [0, 360], shadowTint: [0, 0.1], highlightHue: [0, 360], highlightTint: [0, 0.1], grain: [0, 1] });
const HUES = new Set(['shadowHue', 'highlightHue']);

/** The Image Finish looks as grade settings, at full intensity. */
export const GRADE_PRESETS = Object.freeze({
  original: IDENTITY,
  noir: Object.freeze({ ...IDENTITY, contrast: 0.55, fade: 0.02, saturation: 0, grain: 0.22 }),
  warm: Object.freeze({ ...IDENTITY, contrast: 0.08, vibrance: 0.2, temperature: 0.45, tint: 0.08, shadowHue: 40, shadowTint: 0.008, highlightHue: 75, highlightTint: 0.022 }),
  cool: Object.freeze({ ...IDENTITY, exposure: 0.05, contrast: 0.05, saturation: 0.9, temperature: -0.4, tint: -0.04, shadowHue: 245, shadowTint: 0.02 }),
  punchy: Object.freeze({ ...IDENTITY, contrast: 0.35, saturation: 1.1, vibrance: 0.45 }),
});

/**
 * A complete, validated grade: a preset name or partial settings, scaled from
 * the identity by `amount` (0–1). Hues keep their angle; everything else is
 * interpolated, so `amount` 0 is always the untouched image.
 */
export function resolveGrade(grade = 'original', amount = 1) {
  const t = Number(amount);
  if (!Number.isFinite(t) || t < 0 || t > 1) throw new RangeError('Grade amount must be a number from 0 to 1.');
  let settings = grade;
  if (typeof grade === 'string') {
    if (!Object.hasOwn(GRADE_PRESETS, grade)) throw new RangeError(`Choose a supported grade preset: ${Object.keys(GRADE_PRESETS).join(', ')}.`);
    settings = GRADE_PRESETS[grade];
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new TypeError('A grade is a preset name or an object of grade settings.');
  const resolved = { ...IDENTITY };
  for (const [key, value] of Object.entries(settings)) {
    if (!Object.hasOwn(RANGES, key)) throw new RangeError(`Unknown grade setting: ${key}.`);
    const [min, max] = RANGES[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new RangeError(`Grade ${key} must be a number from ${min} to ${max}.`);
    resolved[key] = HUES.has(key) ? value : IDENTITY[key] + (value - IDENTITY[key]) * t;
  }
  return Object.freeze(resolved);
}

/** True when a resolved grade leaves every pixel unchanged. */
export const isIdentityGrade = grade => Object.keys(IDENTITY).every(key => HUES.has(key) || grade[key] === IDENTITY[key]);

const LINEAR = Float64Array.from({ length: 256 }, (_, value) => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
// 65536 steps keep the steepest part of the curve within a twentieth of a level.
const ENCODE = Uint8Array.from({ length: 65536 }, (_, index) => { const v = index / 65535; return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)); });
const encode = value => ENCODE[value <= 0 ? 0 : value >= 1 ? 65535 : Math.round(value * 65535)];
// S-curve through black, white and a pivot at sRGB mid grey (OKLab L ≈ 0.6), so contrast keeps mid grey.
const PIVOT = 0.6;
function tone(L) {
  const t = L < PIVOT ? L / PIVOT * 0.5 : 0.5 + (L - PIVOT) / (1 - PIVOT) * 0.5, s = t * t * (3 - 2 * t);
  return s < 0.5 ? s * 2 * PIVOT : PIVOT + (s - 0.5) * 2 * (1 - PIVOT);
}
// 32-bit integer hash of (x, y, seed) to [0, 1); identical in every engine.
function hash(x, y, seed) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Presets and partial settings resolve at full amount; `resolveGrade` results pass through.
const resolve = grade => typeof grade === 'string' || !Object.isFrozen(grade) ? resolveGrade(grade) : grade;
function gradeFunction(g, seed) {
  const gain = 2 ** g.exposure, contrast = g.contrast * 2, fade = g.fade, saturation = g.saturation, vibrance = g.vibrance;
  const wa = g.tint * 0.04, wb = g.temperature * 0.04, grain = g.grain * 0.09;
  const sa = g.shadowTint * Math.cos(g.shadowHue * Math.PI / 180), sb = g.shadowTint * Math.sin(g.shadowHue * Math.PI / 180);
  const ha = g.highlightTint * Math.cos(g.highlightHue * Math.PI / 180), hb = g.highlightTint * Math.sin(g.highlightHue * Math.PI / 180);
  const out = [0, 0, 0];
  // Grade one linear-light pixel at (x, y); writes encoded sRGB into `out`.
  return (r, gr, bl, x, y) => {
    r *= gain; gr *= gain; bl *= gain;
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * gr + 0.0514459929 * bl);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * gr + 0.1073969566 * bl);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * gr + 0.6299787005 * bl);
    let L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    let a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    let b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    L = L < 0 ? 0 : L > 1 ? 1 : L;
    L += contrast * (tone(L) - L);
    L = fade + L * (1 - fade);
    const chroma = Math.sqrt(a * a + b * b);
    const scale = saturation * (1 + vibrance * (1 - (chroma > 0.2 ? 1 : chroma / 0.2)));
    a *= scale; b *= scale;
    a += wa * L; b += wb * L;
    const shadow = (1 - L) * (1 - L), highlight = L * L;
    a += sa * shadow + ha * highlight; b += sb * shadow + hb * highlight;
    if (grain) L += (hash(x, y, seed) + hash(x, y, seed ^ 0x9e3779b9) - 1) * grain * (0.35 + 2.6 * L * (1 - L));
    const p = L + 0.3963377774 * a + 0.2158037573 * b, q = L - 0.1055613458 * a - 0.0638541728 * b, u = L - 0.0894841775 * a - 1.291485548 * b;
    const pl = p * p * p, ql = q * q * q, ul = u * u * u;
    out[0] = encode(4.0767416621 * pl - 3.3077115913 * ql + 0.2309699292 * ul);
    out[1] = encode(-1.2684380046 * pl + 2.6097574011 * ql - 0.3413193965 * ul);
    out[2] = encode(-0.0041960863 * pl - 0.7034186147 * ql + 1.707614701 * ul);
    return out;
  };
}
const checkSeed = seed => {
  if (!Number.isInteger(seed) || seed < 0 || seed > GRADE_LIMITS.seed) throw new RangeError('Grade seed must be a whole number from 0 to 4294967295.');
  return seed | 0;
};

/**
 * Grade an RGBA buffer in place and return it. Alpha is kept. `grade` is a
 * preset name or a `resolveGrade` result. `rows: [start, end)` grades one band,
 * so hosts can split a large image across frames with identical results.
 */
export function gradePixels(rgba, width, height, grade = 'original', { seed = 0, rows } = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > GRADE_LIMITS.pixels) throw new RangeError('Grade size must be whole pixels within 16 million.');
  if (!(rgba instanceof Uint8ClampedArray || rgba instanceof Uint8Array) || rgba.length < width * height * 4) throw new TypeError('Grade pixels must be an RGBA Uint8ClampedArray of width × height × 4.');
  const [start, end] = rows ?? [0, height];
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > height || start > end) throw new RangeError('Grade rows must be a [start, end) range inside the image.');
  const resolved = resolve(grade);
  if (isIdentityGrade(resolved)) return rgba;
  const apply = gradeFunction(resolved, checkSeed(seed));
  for (let y = start; y < end; y++) {
    for (let x = 0, offset = y * width * 4; x < width; x++, offset += 4) {
      const out = apply(LINEAR[rgba[offset]], LINEAR[rgba[offset + 1]], LINEAR[rgba[offset + 2]], x, y);
      rgba[offset] = out[0]; rgba[offset + 1] = out[1]; rgba[offset + 2] = out[2];
    }
  }
  return rgba;
}

/** One color through a grade (without grain), as `#rrggbb`: swatches and previews. */
export function gradeColor(color, grade = 'original') {
  const match = typeof color === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) throw new TypeError('Use a hex color such as #101312.');
  const digits = match[1].length === 3 ? match[1].replace(/./g, '$&$&') : match[1];
  const out = gradeFunction({ ...resolve(grade), grain: 0 }, 0)(...[0, 2, 4].map(index => LINEAR[parseInt(digits.slice(index, index + 2), 16)]), 0, 0);
  return `#${out.map(value => value.toString(16).padStart(2, '0')).join('')}`;
}
