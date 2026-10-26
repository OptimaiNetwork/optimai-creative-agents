/**
 * 3D color lookup tables. Original and dependency-free: a strict `.cube` parser
 * (Adobe/Resolve text format, 3D only), a writer, trilinear application to any
 * RGBA buffer, and three original film looks built from a few numbers each.
 *
 * Tables are indexed on encoded sRGB, red fastest, then green, then blue, as in
 * `.cube` files. Inputs outside the domain clamp to its edge; outputs clip to 0–1.
 * Application is plain arithmetic on a Float32Array, so the same image, table and
 * amount give identical bytes in every engine, whole or band by band.
 */
export const LUT_LIMITS = Object.freeze({ size: 65, bytes: 16_777_216, title: 200, pixels: 16_000_000 });

const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
const numbers = (tokens, count, line) => {
  if (tokens.length !== count || !tokens.every(token => NUMBER.test(token))) throw new SyntaxError(`Line ${line}: expected ${count} number${count === 1 ? '' : 's'}.`);
  return tokens.map(Number);
};
const checkSize = (size, line) => {
  if (!Number.isInteger(size) || size < 2 || size > LUT_LIMITS.size) throw new RangeError(`${line ? `Line ${line}: ` : ''}LUT_3D_SIZE must be a whole number from 2 to ${LUT_LIMITS.size}.`);
  return size;
};

/** A frozen LUT from a size and its table (red fastest), checked like a parsed file. */
function makeLut(title, size, table, domainMin = [0, 0, 0], domainMax = [1, 1, 1]) {
  if (domainMin.some((min, channel) => !(domainMax[channel] > min))) throw new RangeError('DOMAIN_MAX must be greater than DOMAIN_MIN on every channel.');
  return Object.freeze({ title, size, domainMin: Object.freeze([...domainMin]), domainMax: Object.freeze([...domainMax]), table });
}

/**
 * Parse `.cube` text into a LUT. Strict: one LUT_3D_SIZE (2–65) before the data,
 * optional TITLE, DOMAIN_MIN/DOMAIN_MAX (or LUT_3D_INPUT_RANGE), `#` comments,
 * then exactly size³ rows of three finite numbers. 1D tables, unknown keywords
 * and anything over 16 MiB are refused with a message naming the line.
 */
export function parseCubeLut(text) {
  if (typeof text !== 'string') throw new TypeError('A .cube LUT is text.');
  if (text.length > LUT_LIMITS.bytes) throw new RangeError('This .cube file is larger than 16 MB.');
  let title = '', size = 0, domainMin = [0, 0, 0], domainMax = [1, 1, 1], table = null, rows = 0;
  const seen = new Set(), lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim(), number = index + 1;
    if (!line || line[0] === '#') continue;
    if (/^[-+.\d]/.test(line)) {
      if (!size) throw new SyntaxError(`Line ${number}: LUT_3D_SIZE must come before the table.`);
      if (rows === size ** 3) throw new SyntaxError(`Line ${number}: more than ${size}³ table rows.`);
      table ??= new Float32Array(size ** 3 * 3);
      const values = numbers(line.split(/\s+/), 3, number);
      // Float32 keeps HDR outputs; anything beyond ±1e6 is a broken file, not a look.
      if (!values.every(value => Math.abs(value) <= 1e6)) throw new RangeError(`Line ${number}: table values must be finite numbers within ±1000000.`);
      table.set(values, rows++ * 3);
      continue;
    }
    if (table) throw new SyntaxError(`Line ${number}: keywords must come before the table.`);
    const [keyword, ...rest] = line.split(/\s+/);
    if (seen.has(keyword)) throw new SyntaxError(`Line ${number}: ${keyword} appears twice.`);
    seen.add(keyword);
    if (keyword === 'TITLE') {
      const match = /^TITLE\s+"([^"]*)"$/.exec(line);
      if (!match || match[1].length > LUT_LIMITS.title) throw new SyntaxError(`Line ${number}: TITLE is a quoted name of up to ${LUT_LIMITS.title} characters.`);
      title = match[1];
    }
    else if (keyword === 'LUT_3D_SIZE') size = checkSize(numbers(rest, 1, number)[0], number);
    else if (keyword === 'DOMAIN_MIN') domainMin = numbers(rest, 3, number);
    else if (keyword === 'DOMAIN_MAX') domainMax = numbers(rest, 3, number);
    else if (keyword === 'LUT_3D_INPUT_RANGE') { const [min, max] = numbers(rest, 2, number); domainMin = [min, min, min]; domainMax = [max, max, max]; }
    else if (keyword.startsWith('LUT_1D')) throw new SyntaxError(`Line ${number}: 1D LUTs are not supported; export a 3D .cube.`);
    else throw new SyntaxError(`Line ${number}: unknown keyword ${keyword.slice(0, 40)}.`);
  }
  if (!size) throw new SyntaxError('This .cube file has no LUT_3D_SIZE.');
  if (rows !== size ** 3) throw new SyntaxError(`Expected ${size ** 3} table rows for size ${size}, found ${rows}.`);
  if ([...domainMin, ...domainMax].some(value => !Number.isFinite(value))) throw new RangeError('DOMAIN values must be finite.');
  return makeLut(title, size, table, domainMin, domainMax);
}

const isLut = lut => lut && Number.isInteger(lut.size) && lut.size >= 2 && lut.size <= LUT_LIMITS.size && lut.table instanceof Float32Array && lut.table.length === lut.size ** 3 * 3 && lut.domainMin?.length === 3 && lut.domainMax?.length === 3;
const checkLut = lut => { if (!isLut(lut)) throw new TypeError('Use a LUT from parseCubeLut, createLut or filmLut.'); return lut; };

/** Write a LUT as `.cube` text (six decimals), readable by this parser and by grading tools. */
export function formatCubeLut(lut) {
  const { title, size, domainMin, domainMax, table } = checkLut(lut), lines = [];
  if (title) lines.push(`TITLE "${String(title).replace(/"/g, "'").slice(0, LUT_LIMITS.title)}"`);
  lines.push(`LUT_3D_SIZE ${size}`, `DOMAIN_MIN ${domainMin.join(' ')}`, `DOMAIN_MAX ${domainMax.join(' ')}`);
  for (let i = 0; i < table.length; i += 3) lines.push(`${table[i].toFixed(6)} ${table[i + 1].toFixed(6)} ${table[i + 2].toFixed(6)}`);
  return `${lines.join('\n')}\n`;
}

/** Bake `transform([r, g, b]) → [r, g, b]` (encoded sRGB, 0–1) into a size³ LUT. */
export function createLut(transform, { size = 33, title = '' } = {}) {
  if (typeof transform !== 'function') throw new TypeError('createLut needs a color transform function.');
  checkSize(size, 0);
  const table = new Float32Array(size ** 3 * 3), step = 1 / (size - 1);
  for (let b = 0, i = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++, i += 3) {
    const out = transform([r * step, g * step, b * step]);
    if (!Array.isArray(out) || out.length !== 3 || !out.every(Number.isFinite)) throw new TypeError('A LUT transform returns three finite numbers.');
    table.set(out, i);
  }
  return makeLut(String(title).slice(0, LUT_LIMITS.title), size, table);
}

// Per-level grid index and fraction for one channel's domain.
function axis(min, max, size) {
  const index = new Int32Array(256), fraction = new Float32Array(256);
  for (let level = 0; level < 256; level++) {
    const x = Math.min(size - 1, Math.max(0, (level / 255 - min) / (max - min) * (size - 1))), i = Math.min(size - 2, Math.floor(x));
    index[level] = i; fraction[level] = x - i;
  }
  return [index, fraction];
}
function lookup(lut) {
  const { size, table } = lut, [ri, rf] = axis(lut.domainMin[0], lut.domainMax[0], size), [gi, gf] = axis(lut.domainMin[1], lut.domainMax[1], size), [bi, bf] = axis(lut.domainMin[2], lut.domainMax[2], size);
  const dg = size * 3, db = size * size * 3, out = [0, 0, 0];
  // Trilinear interpolation of the 8 surrounding entries; writes 0–1 values into `out`.
  return (r, g, b) => {
    const x = rf[r], y = gf[g], z = bf[b], base = (bi[b] * size + gi[g]) * size * 3 + ri[r] * 3;
    for (let c = 0; c < 3; c++) {
      const o = base + c, c00 = table[o] + (table[o + 3] - table[o]) * x, c10 = table[o + dg] + (table[o + dg + 3] - table[o + dg]) * x;
      const c01 = table[o + db] + (table[o + db + 3] - table[o + db]) * x, c11 = table[o + db + dg] + (table[o + db + dg + 3] - table[o + db + dg]) * x;
      const v = (c00 + (c10 - c00) * y) + ((c01 + (c11 - c01) * y) - (c00 + (c10 - c00) * y)) * z;
      out[c] = v <= 0 ? 0 : v >= 1 ? 1 : v;
    }
    return out;
  };
}
const checkAmount = amount => {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 1) throw new RangeError('LUT amount must be a number from 0 to 1.');
  return amount;
};

/**
 * Apply a LUT to an RGBA buffer in place and return it. Alpha is kept. `amount`
 * (0–1) mixes from the original; `rows: [start, end)` applies one band with
 * results identical to a single pass.
 */
export function applyLut(rgba, width, height, lut, { amount = 1, rows } = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > LUT_LIMITS.pixels) throw new RangeError('LUT size must be whole pixels within 16 million.');
  if (!(rgba instanceof Uint8ClampedArray || rgba instanceof Uint8Array) || rgba.length < width * height * 4) throw new TypeError('LUT pixels must be an RGBA Uint8ClampedArray of width × height × 4.');
  const [start, end] = rows ?? [0, height];
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > height || start > end) throw new RangeError('LUT rows must be a [start, end) range inside the image.');
  checkLut(lut);
  if (!checkAmount(amount)) return rgba;
  const apply = lookup(lut);
  for (let offset = start * width * 4, last = end * width * 4; offset < last; offset += 4) {
    const r = rgba[offset], g = rgba[offset + 1], b = rgba[offset + 2], out = apply(r, g, b);
    rgba[offset] = Math.round(r + (out[0] * 255 - r) * amount);
    rgba[offset + 1] = Math.round(g + (out[1] * 255 - g) * amount);
    rgba[offset + 2] = Math.round(b + (out[2] * 255 - b) * amount);
  }
  return rgba;
}

/** One `#rgb`/`#rrggbb` color through a LUT, as `#rrggbb`: swatches and previews. */
export function lutColor(color, lut, amount = 1) {
  const match = typeof color === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) throw new TypeError('Use a hex color such as #101312.');
  const digits = match[1].length === 3 ? match[1].replace(/./g, '$&$&') : match[1];
  const pixel = Uint8ClampedArray.from([0, 2, 4].map(index => parseInt(digits.slice(index, index + 2), 16)).concat(255));
  applyLut(pixel, 1, 1, lut, { amount });
  return `#${[...pixel.subarray(0, 3)].map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Original film looks as data, in encoded sRGB: channel gains, saturation around
 * luma, a split tone (added as (1 − Y)² in the shadows and Y² in the highlights),
 * then an S-curve of `contrast` landing between a lifted black and a soft white.
 */
export const FILM_LOOKS = Object.freeze({
  golden: Object.freeze({ title: 'Golden', gain: [1.04, 1, 0.9], saturation: 1.08, shadow: [0, 0.012, 0.01], highlight: [0.03, 0.012, -0.02], contrast: 0.25, black: 0.035, white: 0.97 }),
  'teal-amber': Object.freeze({ title: 'Teal & Amber', gain: [1.02, 1, 0.98], saturation: 1.12, shadow: [-0.035, 0.01, 0.04], highlight: [0.045, 0.015, -0.035], contrast: 0.4, black: 0.015, white: 0.99 }),
  matte: Object.freeze({ title: 'Matte', gain: [1, 1, 1], saturation: 0.78, shadow: [0.01, 0, 0.025], highlight: [0.015, 0.01, -0.005], contrast: 0.12, black: 0.09, white: 0.93 }),
});
const clamp01 = value => value <= 0 ? 0 : value >= 1 ? 1 : value;
const filmTransform = look => rgb => {
  let [r, g, b] = rgb.map((value, channel) => clamp01(value * look.gain[channel]));
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b, shadow = (1 - luma) ** 2, highlight = luma * luma;
  return [r, g, b].map((value, channel) => {
    const v = clamp01(luma + (value - luma) * look.saturation + look.shadow[channel] * shadow + look.highlight[channel] * highlight);
    const curved = v + look.contrast * (v * v * (3 - 2 * v) - v);
    return look.black + curved * (look.white - look.black);
  });
};
const films = new Map();
/** A film look baked into a 33³ LUT (built once, then shared). */
export function filmLut(name) {
  if (!Object.hasOwn(FILM_LOOKS, name)) throw new RangeError(`Choose a film look: ${Object.keys(FILM_LOOKS).join(', ')}.`);
  if (!films.has(name)) films.set(name, createLut(filmTransform(FILM_LOOKS[name]), { size: 33, title: FILM_LOOKS[name].title }));
  return films.get(name);
}
