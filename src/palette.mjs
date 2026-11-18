/**
 * Palette Pull: an image's colors as named OKLCH swatches with background,
 * text and accent roles, and as files other tools open — CSS custom
 * properties (hex with an `oklch()` upgrade), JSON, Adobe Swatch Exchange
 * (`.ase`, written and read here from the public block layout) and GIMP
 * `.gpl`. Original, deterministic and dependency-free; runs in Node and the
 * browser. Swatches come from `dominantColors` (OKLab k-means).
 */
import { contrastRatio, dominantColors, parseHexColor, pickAccentColor, pickLegibleColor, toOklch } from './color.mjs';

export const PALETTE_SORTS = Object.freeze(['weight', 'lightness', 'hue']);
/** Recipe order names (the Palette Pull `sort` field) and the order each one draws. */
export const PALETTE_ORDERS = Object.freeze({ 'by presence': 'weight', 'by lightness': 'lightness', 'by hue': 'hue' });
export const PALETTE_LIMITS = Object.freeze({ colors: 12, minColors: 2, name: 64, analysisEdge: 192, aseBytes: 1_048_576, aseColors: 4096 });
export const PALETTE_FORMATS = Object.freeze(['css', 'json', 'ase', 'gpl']);

const HUES = [[40, 'red'], [75, 'orange'], [115, 'yellow'], [135, 'lime'], [165, 'green'], [200, 'teal'], [225, 'cyan'], [270, 'blue'], [295, 'indigo'], [325, 'violet'], [345, 'magenta'], [360, 'rose']];
const round = (value, digits) => { const k = 10 ** digits; return Math.round(value * k) / k || 0; };
const slug = text => String(text).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').replace(/^-|-$/g, '');
const cleanName = (name, fallback) => {
  const text = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, PALETTE_LIMITS.name);
  return text || fallback;
};

/**
 * A plain two-word name for a color from its OKLCH lightness, chroma and hue:
 * `deep teal`, `pale pink`, `warm grey`, `black`. English only; stable for a
 * given hex.
 */
export function colorName(color) {
  const [L, C, h] = toOklch(color);
  if (C < 0.03) {
    const tint = C < 0.012 ? '' : h >= 40 && h < 140 ? 'warm ' : h >= 180 && h < 300 ? 'cool ' : '';
    return `${L < 0.2 || L > 0.94 ? '' : tint}${L < 0.2 ? 'black' : L > 0.94 ? (tint ? `${tint}white` : 'white') : L < 0.45 ? 'dark grey' : L > 0.8 ? 'light grey' : 'grey'}`;
  }
  let hue = HUES.find(([limit]) => h < limit)[1];
  // Dark, quiet oranges and orange-reds read as brown; dark yellows as olive; light reds and magentas as pink; light teals as cyan.
  if ((hue === 'orange' || hue === 'red') && L < 0.62 && C < 0.16 && h >= 35 && h < 75) hue = 'brown';
  else if (hue === 'yellow' && L < 0.68) hue = 'olive';
  else if ((hue === 'red' || hue === 'magenta' || hue === 'rose') && L > 0.78) hue = 'pink';
  else if ((hue === 'teal' || hue === 'cyan')) hue = L > 0.72 ? 'cyan' : 'teal';
  const tone = C > 0.24 ? 'vivid' : L < 0.38 ? 'deep' : L < 0.55 ? 'dark' : L > 0.86 ? (C < 0.12 ? 'pale' : '') : L > 0.74 ? (C < 0.12 ? 'light' : '') : C < 0.08 ? 'muted' : C > 0.2 ? 'vivid' : '';
  return tone && !(tone === 'pale' && hue === 'pink') ? `${tone} ${hue}` : hue;
}

/** CSS `oklch()` text for a color: `oklch(62.4% 0.142 241.2)`. */
export function oklchCss(color) {
  const [L, C, h] = toOklch(color);
  return `oklch(${round(L * 100, 1)}% ${round(C, 3)} ${C < 0.002 ? 0 : round(h, 1)})`;
}

const order = (colors, sort) => {
  const by = {
    weight: (a, b) => b.weight - a.weight,
    lightness: (a, b) => b.oklch[0] - a.oklch[0],
    // Neutrals go last, darkest first, so the hues read as a wheel.
    hue: (a, b) => (a.oklch[1] < 0.03) - (b.oklch[1] < 0.03) || (a.oklch[1] < 0.03 ? a.oklch[0] - b.oklch[0] : a.oklch[2] - b.oklch[2]),
  }[sort];
  return [...colors].sort((a, b) => by(a, b) || b.weight - a.weight || a.hex.localeCompare(b.hex));
};

/**
 * Turn swatches (`dominantColors` output, or `{ color, weight? }` / hex
 * strings) into a named palette: each color gets a unique `name`, `hex`,
 * `oklch` `[L, C, h]`, `css` and `weight`, in `sort` order (`weight`,
 * `lightness` or `hue`, or a recipe order name). `roles` picks a `background`
 * (the most present color), a `text` color that reads over it (a palette color
 * when one passes 4.5:1, else its lightness is moved) and an `accent` (the most
 * vivid color that is also present, or null).
 */
export function buildPalette(swatches, { sort = 'weight', name = 'Palette' } = {}) {
  const resolved = Object.hasOwn(PALETTE_ORDERS, sort) ? PALETTE_ORDERS[sort] : sort;
  if (!PALETTE_SORTS.includes(resolved)) throw new Error(`Sort a palette by ${PALETTE_SORTS.join(', ')}.`);
  if (!Array.isArray(swatches) || !swatches.length || swatches.length > PALETTE_LIMITS.colors) throw new RangeError(`A palette holds 1 to ${PALETTE_LIMITS.colors} colors.`);
  const entries = swatches.map(swatch => {
    const value = typeof swatch === 'string' ? { color: swatch } : swatch ?? {};
    const hex = `#${parseHexColor(value.color ?? value.hex).map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
    const weight = value.weight === undefined ? 1 / swatches.length : Number(value.weight);
    if (!Number.isFinite(weight) || weight < 0) throw new RangeError('Swatch weights must be zero or more.');
    return { hex, weight, oklch: toOklch(hex) };
  });
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0) || 1;
  const used = new Map();
  const colors = order(entries, resolved).map(entry => {
    const base = colorName(entry.hex), seen = (used.get(base) ?? 0) + 1; used.set(base, seen);
    return Object.freeze({ name: seen > 1 ? `${base} ${seen}` : base, hex: entry.hex, oklch: Object.freeze(entry.oklch.map((value, index) => round(value, index === 2 ? 2 : 4))), css: oklchCss(entry.hex), weight: round(entry.weight / total, 4) });
  });
  const background = [...colors].sort((a, b) => b.weight - a.weight || b.oklch[0] - a.oklch[0])[0].hex;
  const prefer = colors.filter(color => color.hex !== background).sort((a, b) => contrastRatio(b.hex, background) - contrastRatio(a.hex, background)).slice(0, 1).map(color => color.hex);
  const text = pickLegibleColor(background, { prefer, minContrast: 4.5 }).color;
  const accent = pickAccentColor(colors.map(color => ({ color: color.hex, weight: color.weight })));
  return Object.freeze({ name: cleanName(name, 'Palette'), sort: resolved, colors: Object.freeze(colors), roles: Object.freeze({ background, text, accent }) });
}

/**
 * Pull a named palette straight from RGBA pixels (`count` 2–12 colors). The
 * pixels must already be a thumbnail (`dominantColors` reads at most 262,144);
 * `palettePixelSize` gives one for an image size.
 */
export function pullPalette(rgba, width, height, { count = 6, sort = 'weight', name } = {}) {
  if (!Number.isInteger(count) || count < PALETTE_LIMITS.minColors || count > PALETTE_LIMITS.colors) throw new RangeError(`Pull ${PALETTE_LIMITS.minColors} to ${PALETTE_LIMITS.colors} colors.`);
  const swatches = dominantColors(rgba, width, height, { count });
  if (!swatches.length) throw new Error('This image is fully transparent, so it has no colors to pull.');
  return buildPalette(swatches, { sort, name });
}
/** The thumbnail size (longest edge `PALETTE_LIMITS.analysisEdge`) a palette is read at. */
export function palettePixelSize(width, height, edge = PALETTE_LIMITS.analysisEdge) {
  if (!(width > 0) || !(height > 0)) throw new RangeError('Pass a positive image size.');
  const scale = Math.min(1, edge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

const check = palette => {
  if (!palette || !Array.isArray(palette.colors) || !palette.colors.length) throw new TypeError('Pass a palette from buildPalette or pullPalette.');
  return palette;
};
const roleNames = { background: 'bg', text: 'text', accent: 'accent' };

/**
 * CSS custom properties on `selector` (default `:root`): `--{prefix}-1…n` and
 * `--{prefix}-bg/-text/-accent` as hex, then the same in `oklch()` for
 * browsers that support it. Each line names its color in a comment.
 */
export function paletteCss(palette, { prefix = 'palette', selector = ':root' } = {}) {
  const { name, colors, roles } = check(palette), key = slug(prefix) || 'palette';
  if (!/^[^{}<>;]+$/.test(selector)) throw new Error('Use a plain CSS selector.');
  const list = [...colors.map((color, index) => [`${index + 1}`, color.hex, color.name]), ...Object.entries(roleNames).filter(([role]) => roles?.[role]).map(([role, short]) => [short, roles[role], role])];
  const block = (inner, format) => `${inner}${selector} {\n${list.map(([id, hex, label]) => `${inner}  --${key}-${id}: ${format(hex)}; /* ${label.replace(/\*\//g, '')} */`).join('\n')}\n${inner}}`;
  return `/* ${name.replace(/\*\//g, '')} · ${colors.length} colors · made with OptimAI Creative Agents */\n${block('', hex => hex)}\n@supports (color: oklch(0% 0 0)) {\n${block('  ', oklchCss)}\n}\n`;
}

/** The palette as pretty JSON: `{ format: 'optimai.palette', version: 1, name, sort, colors, roles }`. */
export function paletteJson(palette) {
  const { name, sort, colors, roles } = check(palette);
  return `${JSON.stringify({ format: 'optimai.palette', version: 1, name, sort, colors: colors.map(({ name: label, hex, oklch, css, weight }) => ({ name: label, hex, oklch, css, weight })), roles }, null, 2)}\n`;
}

/** A GIMP palette (`.gpl`), also read by Inkscape, Krita and Aseprite. */
export function paletteGpl(palette) {
  const { name, colors } = check(palette);
  return `GIMP Palette\nName: ${name}\nColumns: ${Math.min(colors.length, 8)}\n#\n${colors.map(color => `${parseHexColor(color.hex).map(value => String(value).padStart(3)).join(' ')}\t${color.name}`).join('\n')}\n`;
}

/**
 * Adobe Swatch Exchange bytes: one group named after the palette holding
 * every color as a global RGB swatch, big-endian, UTF-16 names.
 */
export function paletteAse(palette) {
  const { name, colors } = check(palette);
  const utf16 = text => { const value = `${text}\0`; return { units: value.length, write: (view, at) => { for (let i = 0; i < value.length; i++) view.setUint16(at + i * 2, value.charCodeAt(i)); } }; };
  const group = utf16(name), entries = colors.map(color => ({ label: utf16(color.name), rgb: parseHexColor(color.hex) }));
  const groupLength = 2 + group.units * 2, size = 12 + (6 + groupLength) + entries.reduce((sum, entry) => sum + 6 + 2 + entry.label.units * 2 + 4 + 12 + 2, 0) + 6;
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
  let at = 0;
  const u16 = value => { view.setUint16(at, value); at += 2; }, u32 = value => { view.setUint32(at, value); at += 4; };
  [0x41, 0x53, 0x45, 0x46].forEach(byte => { bytes[at++] = byte; }); // ASEF
  u16(1); u16(0); u32(entries.length + 2);
  u16(0xc001); u32(groupLength); u16(group.units); group.write(view, at); at += group.units * 2;
  for (const { label, rgb } of entries) {
    u16(0x0001); u32(2 + label.units * 2 + 4 + 12 + 2); u16(label.units); label.write(view, at); at += label.units * 2;
    [0x52, 0x47, 0x42, 0x20].forEach(byte => { bytes[at++] = byte; }); // 'RGB '
    for (const channel of rgb) { view.setFloat32(at, channel / 255); at += 4; }
    u16(0); // global
  }
  u16(0xc002); u32(0);
  return bytes;
}

/**
 * Read Adobe Swatch Exchange bytes back into `{ name, colors: [{ name, hex }] }`.
 * RGB, gray, CMYK (naive) and Lab (D50 → sRGB, approximate) swatches are read;
 * anything else is counted in `skipped`. Bounded to 1 MB and 4,096 swatches.
 */
export function readAse(input) {
  const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
  if (!bytes || bytes.length < 12 || bytes.length > PALETTE_LIMITS.aseBytes) throw new TypeError('Pass .ase bytes up to 1 MB.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'ASEF') throw new Error('This is not an Adobe Swatch Exchange file.');
  const blocks = view.getUint32(8), colors = [], groups = [];
  let at = 12, skipped = 0;
  const need = n => { if (at + n > bytes.length) throw new Error('This .ase file is cut short.'); };
  const label = end => { need(2); const units = view.getUint16(at); at += 2; need(units * 2); if (at + units * 2 > end) throw new Error('This .ase file is cut short.'); let text = ''; for (let i = 0; i < units; i++) text += String.fromCharCode(view.getUint16(at + i * 2)); at += units * 2; return text.replace(/\0+$/, ''); };
  for (let block = 0; block < blocks && at < bytes.length; block++) {
    need(6); const type = view.getUint16(at), length = view.getUint32(at + 2); at += 6; need(length);
    const end = at + length;
    if (type === 0xc001) groups.push(label(end));
    else if (type === 0x0001) {
      const name = label(end); need(4);
      const model = String.fromCharCode(...bytes.subarray(at, at + 4)); at += 4;
      const read = n => { need(n * 4); const values = Array.from({ length: n }, (_, i) => view.getFloat32(at + i * 4)); at += n * 4; return values; };
      const clamp = value => Math.min(255, Math.max(0, Math.round(value * 255)));
      let rgb = null;
      if (model === 'RGB ') rgb = read(3).map(clamp);
      else if (model === 'Gray') rgb = read(1).map(clamp).flatMap(value => [value, value, value]);
      else if (model === 'CMYK') { const [c, m, y, k] = read(4); rgb = [c, m, y].map(value => clamp((1 - value) * (1 - k))); }
      else if (model === 'LAB ') {
        // CIE Lab (L 0–1 scaled to 0–100) D50 → XYZ → Bradford to D65 → sRGB.
        const [L, a, b] = read(3), fy = (L * 100 + 16) / 116, f = t => t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787;
        const [X, Y, Z] = [0.9642 * f(fy + a / 500), f(fy), 0.8251 * f(fy - b / 200)];
        const [x, y, z] = [0.9555766 * X - 0.0230393 * Y + 0.0631636 * Z, -0.0282895 * X + 1.0099416 * Y + 0.0210077 * Z, 0.0122982 * X - 0.020483 * Y + 1.3299098 * Z];
        const gamma = v => v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055;
        rgb = [3.2404542 * x - 1.5371385 * y - 0.4985314 * z, -0.969266 * x + 1.8760108 * y + 0.041556 * z, 0.0556434 * x - 0.2040259 * y + 1.0572252 * z].map(v => clamp(gamma(v)));
      }
      if (rgb && colors.length < PALETTE_LIMITS.aseColors) colors.push({ name: cleanName(name, `Color ${colors.length + 1}`), hex: `#${rgb.map(value => value.toString(16).padStart(2, '0')).join('')}` });
      else skipped++;
    }
    at = end;
  }
  return { name: groups[0] ? cleanName(groups[0], 'Palette') : null, colors, skipped };
}

/**
 * Every export of a palette as `{ format, filename, type, data }`: `data` is a
 * string for CSS, JSON and GPL and a `Uint8Array` for ASE. Pass `formats` to
 * choose, and `basename` for the file names (default from the palette name).
 */
export function paletteFiles(palette, { formats = PALETTE_FORMATS, basename, prefix } = {}) {
  check(palette);
  const base = slug(basename ?? palette.name) || 'palette';
  const writers = {
    css: ['text/css', () => paletteCss(palette, { prefix })], json: ['application/json', () => paletteJson(palette)],
    ase: ['application/octet-stream', () => paletteAse(palette)], gpl: ['text/plain', () => paletteGpl(palette)],
  };
  return formats.map(format => {
    if (!Object.hasOwn(writers, format)) throw new Error(`Export a palette as ${PALETTE_FORMATS.join(', ')}.`);
    const [type, write] = writers[format];
    return Object.freeze({ format, filename: `${base}.${format}`, type, data: write() });
  });
}

