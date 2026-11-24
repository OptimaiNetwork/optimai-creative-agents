/**
 * Local asset search: find a shot among a creator's own images by what it
 * looks like ("the dark red one", "portrait, black and white") or by its name
 * and tags, entirely on the device. Original, deterministic and
 * dependency-free; runs in Node and the browser.
 *
 * - `describeImage` reads a thumbnail once into a small, storable signature:
 *   how much of the picture is each of 12 plain color families (per pixel in
 *   OKLab, alpha-weighted) and how light that color is there, plus overall
 *   lightness, contrast, colorfulness, warmth and shape.
 * - `parseAssetQuery` turns plain words into color, shade, tone and shape
 *   hints (with "no"/"without" negation) and leaves the rest as words to match
 *   against names, tags and captions.
 * - `createAssetIndex` keeps entries, ranks them with reasons a UI can show,
 *   says which words it could not use, and saves to JSON. It also takes
 *   embedding vectors from any image–text model (CLIP-style: one vector per
 *   image, one per query) and blends cosine similarity with the hints, so the
 *   same index works before and after a model is downloaded. Vectors are
 *   tagged with the model that made them and dropped on load when it changes.
 */

export const ASSET_INDEX_VERSION = 1;
export const ASSET_INDEX_KIND = 'optimai.asset-index';
export const ASSET_SEARCH_LIMITS = Object.freeze({ assets: 5000, id: 128, name: 256, text: 512, tags: 32, tag: 64, query: 200, terms: 16, dims: 2048, results: 200, analysisEdge: 64, maxPixels: 262_144 });
export const ASSET_SEARCH_COLORS = Object.freeze(['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink', 'brown', 'black', 'white', 'grey']);
export const ASSET_SEARCH_TONES = Object.freeze(['dark', 'bright', 'mono', 'colorful', 'muted', 'warm', 'cool', 'contrast']);
export const ASSET_SEARCH_SHAPES = Object.freeze(['portrait', 'landscape', 'square', 'panorama']);

const COLOR_WORDS = {
  red: 'red', crimson: 'red', scarlet: 'red', maroon: 'red', burgundy: 'red', cherry: 'red', ruby: 'red', wine: 'red',
  orange: 'orange', amber: 'orange', tangerine: 'orange', peach: 'orange', coral: 'orange', rust: 'orange',
  yellow: 'yellow', gold: 'yellow', golden: 'yellow', lemon: 'yellow', mustard: 'yellow',
  green: 'green', lime: 'green', olive: 'green', emerald: 'green', mint: 'green', forest: 'green', sage: 'green',
  cyan: 'cyan', teal: 'cyan', turquoise: 'cyan', aqua: 'cyan',
  blue: 'blue', navy: 'blue', azure: 'blue', cobalt: 'blue', sapphire: 'blue', indigo: 'blue',
  purple: 'purple', violet: 'purple', lavender: 'purple', lilac: 'purple', magenta: 'purple', plum: 'purple', mauve: 'purple',
  pink: 'pink', rose: 'pink', fuchsia: 'pink', blush: 'pink', salmon: 'red',
  brown: 'brown', tan: 'brown', beige: 'brown', chocolate: 'brown', coffee: 'brown', bronze: 'brown', khaki: 'brown',
  black: 'black', ebony: 'black', white: 'white', ivory: 'white', cream: 'white', snow: 'white',
  grey: 'grey', gray: 'grey', silver: 'grey', charcoal: 'grey',
};
const SHADES = { light: 'light', pale: 'light', pastel: 'light', baby: 'light', dark: 'dark', deep: 'dark' };
const TONE_WORDS = {
  dark: 'dark', night: 'dark', nighttime: 'dark', moody: 'dark', dim: 'dark', shadowy: 'dark', lowkey: 'dark', gloomy: 'dark',
  bright: 'bright', light: 'bright', airy: 'bright', sunny: 'bright', highkey: 'bright', daylight: 'bright', luminous: 'bright',
  mono: 'mono', monochrome: 'mono', grayscale: 'mono', greyscale: 'mono', bw: 'mono', noir: 'mono',
  colorful: 'colorful', colourful: 'colorful', vibrant: 'colorful', vivid: 'colorful', saturated: 'colorful', bold: 'colorful',
  muted: 'muted', pastel: 'muted', desaturated: 'muted', faded: 'muted', soft: 'muted', washed: 'muted',
  warm: 'warm', cool: 'cool', cold: 'cool', contrast: 'contrast', contrasty: 'contrast', punchy: 'contrast',
};
const SHAPE_WORDS = {
  portrait: 'portrait', vertical: 'portrait', tall: 'portrait', upright: 'portrait', story: 'portrait', stories: 'portrait',
  landscape: 'landscape', horizontal: 'landscape', wide: 'landscape', widescreen: 'landscape', square: 'square', panorama: 'panorama', panoramic: 'panorama', pano: 'panorama',
};
const PHRASES = [[/\bblack\s*(?:and|&|-|\/)\s*white\b|\bb\s*(?:&|\/|n)\s*w\b/g, ' mono '], [/\bhigh[\s-]*contrast\b/g, ' contrast '], [/\blow[\s-]*key\b/g, ' lowkey '], [/\bhigh[\s-]*key\b/g, ' highkey '], [/\bwashed[\s-]*out\b/g, ' washed ']];
const NEGATORS = new Set(['no', 'not', 'without', 'non', 'except', 'minus']);
const STOPWORDS = new Set('a an the and or of in on at to with by for from into onto over under near is are was were be it its this that these those there where which who whose what find show me my our your give get one ones some any all shot shots photo photos image images picture pictures pic pics frame frames file files thing things look looks looking like has have had some kind sort please just only more most very really bit little'.split(' '));
const WARM = new Set(['red', 'orange', 'yellow', 'brown', 'pink']), COOL = new Set(['green', 'cyan', 'blue', 'purple']);

const clamp01 = value => Math.min(1, Math.max(0, value));
const round = (value, digits = 3) => { const k = 10 ** digits; return Math.round(value * k) / k || 0; };
const cleanText = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const fold = text => String(text).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = text => fold(String(text).replace(/([a-z])([A-Z])/g, '$1 $2')).split(/[^a-z0-9]+/).filter(Boolean);
const stem = word => word.length > 4 && /(?:s|x|z|ch|sh)es$/.test(word) ? word.slice(0, -2) : word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;

// sRGB byte → linear light, tabulated once.
const LINEAR = Float64Array.from({ length: 256 }, (_, value) => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
function oklab(r, g, b) {
  const lr = LINEAR[r], lg = LINEAR[g], lb = LINEAR[b];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb), m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb), s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** The plain color family of one sRGB pixel, as a searcher would name it. */
export function colorFamily(r, g, b) {
  const [L, A, B] = oklab(r, g, b), C = Math.hypot(A, B), h = (Math.atan2(B, A) * 180 / Math.PI + 360) % 360;
  // Pastels keep their hue (pale pink is ~0.034 chroma, white and ivory ≤ 0.021); near-black navy and plum read as black.
  if (C < (L > 0.85 ? 0.025 : L < 0.3 ? 0.035 + 0.02 * (0.3 - L) / 0.15 : 0.035)) return L < 0.28 ? 'black' : L > 0.88 ? 'white' : 'grey';
  if (L < 0.18 && C < 0.06) return 'black';
  let family = h < 12 || h >= 340 ? 'pink' : h < 45 ? 'red' : h < 80 ? 'orange' : h < 125 ? 'yellow' : h < 180 ? 'green' : h < 225 ? 'cyan' : h < 290 ? 'blue' : 'purple';
  if ((family === 'red' || family === 'orange') && L < 0.56 && C < 0.15 && h >= 30) family = 'brown';
  else if (family === 'orange' && L < 0.84 && C < 0.09) family = 'brown';
  else if ((family === 'red' && L > 0.76 && C < 0.2) || (family === 'purple' && h >= 330 && L > 0.7)) family = 'pink';
  return family;
}

/**
 * A storable visual signature of RGBA thumbnail pixels (row-major, 4 bytes
 * each, at most 262,144 pixels). `aspect` is the original width ÷ height
 * (defaults to the thumbnail's). Every number is rounded to 3 digits, so the
 * same pixels always give the same signature.
 */
export function describeImage(rgba, width, height, { aspect } = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > ASSET_SEARCH_LIMITS.maxPixels) {
    throw new RangeError(`Asset search reads whole-pixel images with at most ${ASSET_SEARCH_LIMITS.maxPixels.toLocaleString('en-US')} pixels; pass a thumbnail.`);
  }
  if (!(rgba instanceof Uint8ClampedArray || rgba instanceof Uint8Array) || rgba.length !== width * height * 4) throw new TypeError('Asset search pixels must be RGBA bytes matching the image size.');
  const ratio = aspect === undefined ? width / height : Number(aspect);
  if (!(ratio > 0) || !Number.isFinite(ratio)) throw new RangeError('aspect must be a positive width ÷ height.');
  const share = new Map(), light = new Map();
  let total = 0, sumL = 0, sumL2 = 0, sumC = 0, chromatic = 0;
  for (let offset = 0; offset < rgba.length; offset += 4) {
    const alpha = rgba[offset + 3] / 255;
    if (alpha <= 0) continue;
    const r = rgba[offset], g = rgba[offset + 1], b = rgba[offset + 2], [L, A, B] = oklab(r, g, b), C = Math.hypot(A, B), family = colorFamily(r, g, b);
    share.set(family, (share.get(family) || 0) + alpha); light.set(family, (light.get(family) || 0) + L * alpha);
    total += alpha; sumL += L * alpha; sumL2 += L * L * alpha; sumC += C * alpha; if (family !== 'black' && family !== 'white' && family !== 'grey') chromatic += alpha;
  }
  const colors = {};
  let warm = 0, cool = 0;
  if (total > 0) for (const family of ASSET_SEARCH_COLORS) {
    const weight = (share.get(family) || 0) / total;
    if (weight < 0.002) continue;
    colors[family] = { weight: round(weight), lightness: round(light.get(family) / share.get(family)) };
    if (WARM.has(family)) warm += weight; else if (COOL.has(family)) cool += weight;
  }
  const mean = total > 0 ? sumL / total : 0;
  return {
    version: 1, aspect: round(ratio), lightness: round(mean), contrast: round(total > 0 ? Math.sqrt(Math.max(0, sumL2 / total - mean * mean)) : 0),
    chroma: round(total > 0 ? sumC / total : 0), chromatic: round(total > 0 ? chromatic / total : 0), warmth: round(warm - cool), colors,
  };
}

/**
 * Read the signature of a decoded image, video frame or canvas from a
 * thumbnail of at most 64 pixels. Returns null when this environment cannot
 * read pixels (no canvas, or a cross-origin image), so hosts can still index
 * the asset by name.
 */
export function readImageFeatures(source, sourceWidth, sourceHeight) {
  if (!source || !(sourceWidth > 0) || !(sourceHeight > 0)) return null;
  const scale = Math.min(1, ASSET_SEARCH_LIMITS.analysisEdge / Math.max(sourceWidth, sourceHeight));
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
    context.drawImage(source, 0, 0, width, height);
    return describeImage(context.getImageData(0, 0, width, height).data, width, height, { aspect: sourceWidth / sourceHeight });
  } catch {
    return null;
  } finally { canvas.width = 1; canvas.height = 1; }
}

/**
 * Plain words → `{ text, hints, terms }`. Hints are
 * `{ kind: 'color' | 'tone' | 'shape', value, shade?, negate, label }`;
 * terms are `{ word, negate }` left to match names, tags and captions.
 * "black and white", "b&w", "high contrast", "no"/"without"/`-word` and
 * "light"/"dark" before a color are understood.
 */
export function parseAssetQuery(input) {
  const text = cleanText(input, ASSET_SEARCH_LIMITS.query);
  let folded = ` ${fold(text)} `.replace(/(^|\s)-(?=[a-z])/g, '$1not ');
  for (const [pattern, replacement] of PHRASES) folded = folded.replace(pattern, replacement);
  const tokens = folded.split(/[^a-z0-9]+/).filter(Boolean), hints = [], terms = [], seen = new Set();
  let negate = false;
  const push = (list, item, key) => { if (!seen.has(key) && hints.length + terms.length < ASSET_SEARCH_LIMITS.terms) { seen.add(key); list.push(item); } negate = false; };
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index], next = tokens[index + 1];
    if (NEGATORS.has(token)) { negate = true; continue; }
    if (SHADES[token] && next && COLOR_WORDS[next] && !['black', 'white'].includes(COLOR_WORDS[next])) {
      const value = COLOR_WORDS[next], shade = SHADES[token]; index++;
      push(hints, { kind: 'color', value, shade, negate, label: `${negate ? 'no ' : ''}${shade} ${value}` }, `color:${value}:${shade}:${negate}`); continue;
    }
    const kind = COLOR_WORDS[token] ? 'color' : TONE_WORDS[token] ? 'tone' : SHAPE_WORDS[token] ? 'shape' : null;
    if (kind) {
      const value = (kind === 'color' ? COLOR_WORDS : kind === 'tone' ? TONE_WORDS : SHAPE_WORDS)[token];
      push(hints, { kind, value, negate, label: `${negate ? 'no ' : ''}${value === 'mono' ? 'black and white' : value === 'contrast' ? 'high contrast' : value}` }, `${kind}:${value}:${negate}`); continue;
    }
    if (STOPWORDS.has(token) || (token.length < 2 && !/\d/.test(token))) { negate = false; continue; }
    push(terms, { word: token, negate }, `term:${token}:${negate}`);
  }
  return { text, hints, terms };
}

const shadeFit = (shade, lightness) => !shade ? 1 : shade === 'light' ? clamp01((lightness - 0.45) / 0.3) : clamp01((0.72 - lightness) / 0.3);
const sigmoid = (value, low, high) => clamp01((value - low) / (high - low));

/** How well a signature fits one hint, 0–1, before negation. */
export function hintScore(features, hint) {
  if (!features) return 0;
  if (hint.kind === 'color') {
    const entry = features.colors?.[hint.value];
    if (!entry || entry.weight < 0.01) return 0;
    return Math.min(1, Math.sqrt(entry.weight / 0.2)) * shadeFit(hint.shade, entry.lightness);
  }
  if (hint.kind === 'shape') {
    const aspect = features.aspect, tilt = Math.abs(Math.log(aspect));
    return hint.value === 'square' ? clamp01(1 - (tilt - 0.06) / 0.14) : hint.value === 'portrait' ? sigmoid(-Math.log(aspect), 0.02, 0.15) : hint.value === 'landscape' ? sigmoid(Math.log(aspect), 0.02, 0.15) : sigmoid(aspect, 1.9, 2.4);
  }
  switch (hint.value) {
    case 'dark': return sigmoid(0.62 - features.lightness, 0, 0.3);
    case 'bright': return sigmoid(features.lightness - 0.5, 0, 0.25);
    case 'mono': return clamp01(1 - features.chromatic / 0.12);
    case 'colorful': return sigmoid(features.chroma, 0.03, 0.13);
    case 'muted': return clamp01(1 - sigmoid(features.chroma, 0.04, 0.14));
    case 'warm': return sigmoid(features.warmth, 0, 0.4);
    case 'cool': return sigmoid(-features.warmth, 0, 0.4);
    case 'contrast': return sigmoid(features.contrast, 0.14, 0.3);
    default: return 0;
  }
}

function toVector(value, dims, label) {
  if (!(value instanceof Float32Array || value instanceof Float64Array || Array.isArray(value))) throw new TypeError(`${label} must be a Float32Array or an array of numbers.`);
  if (value.length < 1 || value.length > ASSET_SEARCH_LIMITS.dims) throw new RangeError(`${label} must have 1 to ${ASSET_SEARCH_LIMITS.dims} numbers.`);
  if (dims && value.length !== dims) throw new RangeError(`${label} has ${value.length} numbers; this index holds ${dims}-number vectors from one model.`);
  return normalizeVector(value);
}

/** A unit-length Float32Array copy of an embedding; throws on a zero or non-finite vector. */
export function normalizeVector(vector) {
  let sum = 0;
  for (let index = 0; index < vector.length; index++) { const value = Number(vector[index]); if (!Number.isFinite(value)) throw new RangeError('Embeddings must hold finite numbers.'); sum += value * value; }
  if (!(sum > 0)) throw new RangeError('An embedding cannot be all zeros.');
  const scale = 1 / Math.sqrt(sum), out = new Float32Array(vector.length);
  for (let index = 0; index < vector.length; index++) out[index] = vector[index] * scale;
  return out;
}

/** Cosine similarity of two equal-length vectors, −1…1 (0 when either is zero). */
export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) throw new RangeError('Compare vectors of the same length.');
  let dot = 0, na = 0, nb = 0;
  for (let index = 0; index < a.length; index++) { dot += a[index] * b[index]; na += a[index] * a[index]; nb += b[index] * b[index]; }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

const toBase64 = vector => { const bytes = new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength); let binary = ''; for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000)); return btoa(binary); };
const fromBase64 = text => { const binary = atob(text); if (binary.length % 4) throw new RangeError('bad vector'); const bytes = new Uint8Array(binary.length); for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index); return new Float32Array(bytes.buffer); };

function cleanFeatures(features) {
  if (features == null) return null;
  if (typeof features !== 'object' || features.version !== 1) throw new TypeError('features must come from describeImage or readImageFeatures.');
  const number = (value, min, max) => { const n = Number(value); if (!Number.isFinite(n)) throw new TypeError('features hold a value that is not a number.'); return Math.min(max, Math.max(min, n)); };
  const colors = {};
  for (const family of ASSET_SEARCH_COLORS) {
    const entry = features.colors?.[family];
    if (entry) colors[family] = { weight: number(entry.weight, 0, 1), lightness: number(entry.lightness, 0, 1) };
  }
  return { version: 1, aspect: number(features.aspect, 1e-3, 1e3), lightness: number(features.lightness, 0, 1), contrast: number(features.contrast, 0, 1), chroma: number(features.chroma, 0, 1), chromatic: number(features.chromatic, 0, 1), warmth: number(features.warmth, -1, 1), colors };
}

/**
 * An in-memory index of a creator's assets. `model` names the embedding model
 * whose vectors it may hold (any string; vectors are refused without one);
 * `dims` is fixed by the first vector when not given.
 */
export function createAssetIndex({ model = null, dims = null } = {}) {
  if (model !== null && (typeof model !== 'string' || !model.trim() || model.length > ASSET_SEARCH_LIMITS.name)) throw new TypeError('model must be a short, non-empty name.');
  if (dims !== null && (!Number.isInteger(dims) || dims < 1 || dims > ASSET_SEARCH_LIMITS.dims)) throw new RangeError(`dims must be 1 to ${ASSET_SEARCH_LIMITS.dims}.`);
  const entries = new Map();
  let width = dims;
  const index = {
    get model() { return model; },
    get dims() { return width; },
    get size() { return entries.size; },
    has: id => entries.has(String(id)),
    get(id) { const entry = entries.get(String(id)); return entry ? publicEntry(entry) : null; },
    ids: () => [...entries.keys()],
    /** Add or replace `{ id, name?, tags?, text?, features?, vector? }`. */
    add(asset) {
      if (!asset || typeof asset !== 'object') throw new TypeError('Add an asset object with an id.');
      const id = cleanText(asset.id, ASSET_SEARCH_LIMITS.id + 1);
      if (!id || id.length > ASSET_SEARCH_LIMITS.id) throw new RangeError(`Asset ids are 1 to ${ASSET_SEARCH_LIMITS.id} characters.`);
      if (!entries.has(id) && entries.size >= ASSET_SEARCH_LIMITS.assets) throw new RangeError(`An index holds at most ${ASSET_SEARCH_LIMITS.assets.toLocaleString('en-US')} assets.`);
      const name = cleanText(asset.name, ASSET_SEARCH_LIMITS.name), text = cleanText(asset.text, ASSET_SEARCH_LIMITS.text);
      const tags = [...new Set((Array.isArray(asset.tags) ? asset.tags : []).map(tag => cleanText(tag, ASSET_SEARCH_LIMITS.tag)).filter(Boolean))].slice(0, ASSET_SEARCH_LIMITS.tags);
      let vector = null;
      if (asset.vector != null) {
        if (!model) throw new TypeError('Name the embedding model (createAssetIndex({ model })) before adding vectors.');
        vector = toVector(asset.vector, width, 'An asset vector');
        width ??= vector.length;
      }
      const entry = { id, name, tags, text, features: cleanFeatures(asset.features), vector, tokens: new Set([...words(name.replace(/\.[a-z0-9]{2,5}$/i, '')), ...tags.flatMap(words), ...words(text)].map(stem)) };
      entries.delete(id); entries.set(id, entry);
      return publicEntry(entry);
    },
    remove: id => entries.delete(String(id)),
    clear() { entries.clear(); width = dims; },
    /**
     * Rank assets for a query. `vector` is the query's embedding from the same
     * model; `vectorWeight` (0–1; default 0.7, or 0.4 when every word is a
     * color, tone or shape word) blends cosine similarity with
     * the hints. `calibrate` maps a cosine to a 0–1 match chance (for SigLIP,
     * `siglipMatchChance`); meaning then counts as each chance relative to the
     * best one in the index, so the best match by meaning stays ahead of a
     * look hint even when no picture is a strong match. Returns `{ query, results: [{ id, name, score, matches, similarity? }], unmatched, total }`
     * (`similarity` is the cosine, or null for an asset without a vector);
     * `unmatched` lists words that matched no asset and no hint, so a UI can
     * say what needs a model. Negated words ("-word", "without word") leave
     * out assets that have them; negated looks ("no red") only score. An
     * empty query lists every asset in order.
     */
    search(query, { vector, vectorWeight, calibrate, limit = 20, minScore = 0.05 } = {}) {
      const parsed = typeof query === 'object' && query && Array.isArray(query.hints) ? query : parseAssetQuery(query);
      if (!Number.isInteger(limit) || limit < 1) throw new RangeError('limit must be a positive whole number.');
      // A search made only of look words ("black and white", "orange portrait") is measured exactly from the pixels, so
      // the model counts less there; any other word ("a fox", "red car") lets meaning lead.
      const max = Math.min(limit, ASSET_SEARCH_LIMITS.results), weight = clamp01(Number(vectorWeight ?? (parsed.terms.length ? 0.7 : 0.4)));
      if (calibrate != null && typeof calibrate !== 'function') throw new TypeError('calibrate must turn a cosine into a 0–1 score.');
      const probe = vector == null ? null : toVector(vector, width, 'The query vector');
      const every = [...entries.values()];
      const known = parsed.terms.filter(term => every.some(entry => matchesTerm(entry, term.word)));
      const unmatched = probe ? [] : parsed.terms.filter(term => !known.includes(term) && !term.negate).map(term => term.word);
      // "-word" and "without word" are filters: an asset whose name, tags or caption has the word is left out.
      const excluded = known.filter(term => term.negate), live = known.filter(term => !term.negate);
      const all = every.filter(entry => !excluded.some(term => matchesTerm(entry, term.word)));
      const criteria = parsed.hints.length + live.length;
      if (!criteria && !probe) return { query: parsed, results: all.slice(0, max).map(entry => ({ id: entry.id, name: entry.name, score: 0, matches: [] })), unmatched, total: every.length };
      // With `calibrate`, meaning counts relative to the best match here (its odds ratio), so a weak but best match still leads looks and names.
      const cosines = probe ? new Map(all.filter(entry => entry.vector).map(entry => [entry, cosineSimilarity(probe, entry.vector)])) : null;
      const chances = calibrate && cosines ? new Map([...cosines].map(([entry, cosine]) => [entry, clamp01(Number(calibrate(cosine)) || 0)])) : null;
      const best = chances ? Math.max(0, ...chances.values()) : 0;
      const ranked = [];
      all.forEach((entry, order) => {
        const matches = [];
        let sum = 0;
        for (const hint of parsed.hints) {
          const fit = hintScore(entry.features, hint), score = hint.negate ? (entry.features ? clamp01(1 - 1.5 * fit) : 0) : fit; // "no red": a clear patch of red rules a shot out
          sum += score; if (score >= 0.35) matches.push(hint.label);
        }
        for (const term of live) if (matchesTerm(entry, term.word)) { sum += 1; matches.push(term.word); }
        const hints = criteria ? sum / criteria : 0;
        let score = hints, similarity;
        if (probe) {
          similarity = cosines.get(entry) ?? null;
          const fit = similarity === null ? (calibrate ? 0 : -1) : chances ? (best > 0 ? chances.get(entry) / best : 0) : similarity;
          score = criteria ? weight * fit + (1 - weight) * hints : fit;
        } else if (score < minScore) return;
        ranked.push({ order, result: { id: entry.id, name: entry.name, score: round(score, 4), matches, ...(probe && { similarity: similarity === null ? null : round(similarity, 4) }) } });
      });
      ranked.sort((a, b) => b.result.score - a.result.score || a.order - b.order);
      return { query: parsed, results: ranked.slice(0, max).map(item => item.result), unmatched, total: every.length };
    },
    /** A JSON-safe copy: `{ kind, version, model, dims, entries }` with vectors as base64 float32. */
    toJSON() {
      return { kind: ASSET_INDEX_KIND, version: ASSET_INDEX_VERSION, model, dims: width, entries: [...entries.values()].map(entry => ({ id: entry.id, ...(entry.name && { name: entry.name }), ...(entry.tags.length && { tags: entry.tags }), ...(entry.text && { text: entry.text }), ...(entry.features && { features: entry.features }), ...(entry.vector && { vector: toBase64(entry.vector) }) })) };
    },
  };
  return index;
}

const matchesTerm = (entry, word) => { const target = stem(word); for (const token of entry.tokens) if (token === target || (target.length >= 3 && token.startsWith(target))) return true; return false; };
const publicEntry = entry => ({ id: entry.id, name: entry.name, tags: [...entry.tags], text: entry.text, features: entry.features, hasVector: !!entry.vector });

/**
 * Rebuild an index saved with `toJSON`. Pass the `model` the host embeds with
 * now: vectors saved by another model (or by none) are dropped so they are
 * never compared with new ones, and the entries stay searchable by look and
 * name. Returns `{ index, dropped: { entries, vectors } }`; unreadable entries
 * are skipped, never thrown.
 */
export function loadAssetIndex(saved, { model = null } = {}) {
  const data = typeof saved === 'string' ? JSON.parse(saved) : saved;
  if (!data || data.kind !== ASSET_INDEX_KIND || data.version !== ASSET_INDEX_VERSION || !Array.isArray(data.entries)) throw new TypeError('This is not a saved asset index.');
  const keepVectors = model !== null && data.model === model;
  const index = createAssetIndex({ model, dims: keepVectors && Number.isInteger(data.dims) ? data.dims : null });
  const dropped = { entries: 0, vectors: 0 };
  for (const item of data.entries) {
    if (index.size >= ASSET_SEARCH_LIMITS.assets) { dropped.entries++; continue; }
    let vector = null;
    if (item?.vector != null) { if (keepVectors) { try { vector = fromBase64(item.vector); } catch { vector = null; dropped.vectors++; } } else dropped.vectors++; }
    try { index.add({ ...item, vector }); } catch { try { index.add({ ...item, vector: null }); dropped.vectors++; } catch { dropped.entries++; } }
  }
  return { index, dropped };
}
