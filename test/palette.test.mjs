import assert from 'node:assert/strict';
import test from 'node:test';
import { contrastRatio } from '../src/color.mjs';
import {
  buildPalette, colorName, oklchCss, PALETTE_FORMATS, PALETTE_LIMITS, PALETTE_ORDERS, PALETTE_SORTS, paletteAse, paletteCss, paletteFiles,
  paletteGpl, paletteJson, palettePixelSize, pullPalette, readAse,
} from '../src/palette.mjs';

const sample = (sort = 'weight') => buildPalette([{ color: '#1f2433', weight: 5 }, { color: '#e7b7a3', weight: 3 }, { color: '#2b6cb0', weight: 2 }], { sort, name: 'Harbour dusk' });
// RGBA pixels made of `[hex, share]` stripes, left to right.
function stripes(width, height, parts) {
  const data = new Uint8ClampedArray(width * height * 4); let x0 = 0;
  for (const [hex, share] of parts) {
    const x1 = Math.min(width, x0 + Math.round(width * share)), rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    for (let y = 0; y < height; y++) for (let x = x0; x < x1; x++) data.set([...rgb, 255], (y * width + x) * 4);
    x0 = x1;
  }
  return data;
}

test('colors get plain, stable names from their OKLCH lightness, chroma and hue', () => {
  const names = Object.fromEntries(['#000000', '#ffffff', '#808080', '#ff0000', '#ffa500', '#ffff00', '#00ff00', '#008080', '#00ffff', '#0000ff', '#4b0082', '#ffc0cb', '#8b4513', '#808000', '#1f2433', '#f4efe6', '#c6f87d']
    .map(hex => [hex, colorName(hex)]));
  assert.deepEqual(names, {
    '#000000': 'black', '#ffffff': 'white', '#808080': 'grey', '#ff0000': 'vivid red', '#ffa500': 'orange', '#ffff00': 'yellow', '#00ff00': 'vivid green',
    '#008080': 'dark teal', '#00ffff': 'cyan', '#0000ff': 'vivid blue', '#4b0082': 'deep violet', '#ffc0cb': 'pink', '#8b4513': 'dark brown', '#808000': 'olive',
    '#1f2433': 'cool dark grey', '#f4efe6': 'warm white', '#c6f87d': 'lime',
  });
  assert.equal(colorName([255, 0, 0]), colorName('#f00'));
  assert.deepEqual(['#946074', '#800000', '#8b4513'].map(colorName), ['muted rose', 'deep red', 'dark brown'], 'brown is a dark orange, never a maroon');
  assert.throws(() => colorName('red'), /hex color/);
});

test('oklch() text is short, rounded and zero-hued for neutrals', () => {
  assert.equal(oklchCss('#2b6cb0'), 'oklch(52.4% 0.126 252.3)');
  assert.equal(oklchCss('#808080'), 'oklch(60% 0 0)');
  assert.equal(oklchCss('#ffffff'), 'oklch(100% 0 0)');
});

test('a palette names, orders and normalises its swatches and picks readable roles', () => {
  const palette = sample();
  assert.ok(Object.isFrozen(palette) && Object.isFrozen(palette.colors) && Object.isFrozen(palette.colors[0]) && Object.isFrozen(palette.roles));
  assert.equal(palette.name, 'Harbour dusk');
  assert.deepEqual(palette.colors.map(color => [color.hex, color.name, color.weight]), [['#1f2433', 'cool dark grey', 0.5], ['#e7b7a3', 'light orange', 0.3], ['#2b6cb0', 'dark blue', 0.2]]);
  assert.deepEqual(palette.colors[2].oklch, [0.5241, 0.1259, 252.32]);
  assert.equal(palette.colors[2].css, 'oklch(52.4% 0.126 252.3)');
  assert.deepEqual(palette.roles, { background: '#1f2433', text: '#e7b7a3', accent: '#2b6cb0' }, 'the most present color, the palette color that reads best on it, the vivid one');
  assert.ok(contrastRatio(palette.roles.text, palette.roles.background) >= 4.5);
  assert.deepEqual(sample('lightness').colors.map(color => color.hex), ['#e7b7a3', '#2b6cb0', '#1f2433']);
  assert.deepEqual(sample('by hue').colors.map(color => color.hex), ['#e7b7a3', '#2b6cb0', '#1f2433'], 'hues around the wheel, neutrals last');
  assert.equal(sample('by presence').sort, 'weight');
  assert.deepEqual(Object.values(PALETTE_ORDERS).sort(), [...PALETTE_SORTS].sort());
  // Two swatches that share a name are told apart; strings work and weights are shared evenly.
  const twins = buildPalette(['#2b6cb0', '#2c6db1', '#ffffff']);
  assert.deepEqual(twins.colors.map(color => color.name), ['dark blue', 'dark blue 2', 'white'], 'equal weights keep hex order');
  assert.ok(twins.colors.every(color => color.weight === 0.3333));
  // A palette with no color that reads over its background moves one's lightness instead.
  const quiet = buildPalette([{ color: '#777777', weight: 2 }, { color: '#888888', weight: 1 }]);
  assert.ok(contrastRatio(quiet.roles.text, quiet.roles.background) >= 4.5);
  assert.equal(quiet.roles.accent, null, 'a grey palette has no accent');
  for (const [swatches, options, pattern] of [[[], {}, /1 to 12/], [Array(13).fill('#000000'), {}, /1 to 12/], [['#000'], { sort: 'random' }, /Sort/], [['nope'], {}, /hex/], [[{ color: '#000000', weight: -1 }], {}, /weights/]]) {
    assert.throws(() => buildPalette(swatches, options), pattern);
  }
  assert.equal(buildPalette(['#000000'], { name: ' \u0000 ' }).name, 'Palette', 'control characters and blank names fall back');
  assert.equal(buildPalette(['#000000'], { name: 'x'.repeat(90) }).name.length, PALETTE_LIMITS.name);
});

test('pulling from pixels is deterministic, bounded and refuses an empty image', () => {
  const data = stripes(120, 40, [['#c0392b', .5], ['#f2c879', .3], ['#1f2433', .2]]);
  const palette = pullPalette(data, 120, 40, { count: 3, name: 'Stripes' });
  assert.deepEqual(palette.colors.map(color => [color.hex, color.weight]), [['#c0392b', 0.5], ['#f2c879', 0.3], ['#1f2433', 0.2]]);
  assert.deepEqual(pullPalette(data, 120, 40, { count: 3, name: 'Stripes' }), palette);
  assert.throws(() => pullPalette(data, 120, 40, { count: 1 }), /2 to 12/);
  assert.throws(() => pullPalette(data, 120, 40, { count: 13 }), /2 to 12/);
  assert.throws(() => pullPalette(new Uint8ClampedArray(16), 2, 2), /transparent/);
  assert.deepEqual(palettePixelSize(4000, 3000), { width: 192, height: 144 });
  assert.deepEqual(palettePixelSize(100, 50), { width: 100, height: 50 }, 'never upscaled');
  assert.deepEqual(palettePixelSize(10000, 10), { width: 192, height: 1 });
  assert.throws(() => palettePixelSize(0, 10), /positive/);
});

test('CSS exports hex variables with an oklch() upgrade and cannot be broken out of', () => {
  const css = paletteCss(sample(), { prefix: 'Brand Kit' });
  assert.match(css, /^\/\* Harbour dusk · 3 colors · made with OptimAI Creative Agents \*\/\n:root \{\n  --brand-kit-1: #1f2433; \/\* cool dark grey \*\/\n/);
  assert.match(css, /  --brand-kit-bg: #1f2433; \/\* background \*\/\n  --brand-kit-text: #e7b7a3; \/\* text \*\/\n  --brand-kit-accent: #2b6cb0; \/\* accent \*\/\n\}\n/);
  assert.match(css, /@supports \(color: oklch\(0% 0 0\)\) \{\n  :root \{\n    --brand-kit-1: oklch\(26\.2% 0\.029 270\.1\);/);
  assert.equal((css.match(/\{/g) ?? []).length, (css.match(/\}/g) ?? []).length);
  const sneaky = paletteCss(buildPalette(['#000000'], { name: 'a */ body { color: red } /*' }));
  assert.doesNotMatch(sneaky.replace(/\/\*[\s\S]*?\*\//g, ''), /body|red/, 'a name cannot close its comment');
  assert.match(paletteCss(sample(), { selector: '.card' }), /^\.card \{/m);
  assert.throws(() => paletteCss(sample(), { selector: 'a{}' }), /selector/);
  assert.match(paletteCss(sample(), { prefix: '!!' }), /--palette-1:/);
  assert.throws(() => paletteCss({}), /buildPalette/);
});

test('JSON and GIMP palettes carry every color by name', () => {
  const json = JSON.parse(paletteJson(sample()));
  assert.deepEqual(Object.keys(json), ['format', 'version', 'name', 'sort', 'colors', 'roles']);
  assert.deepEqual([json.format, json.version, json.colors.length, json.colors[1]], ['optimai.palette', 1, 3, { name: 'light orange', hex: '#e7b7a3', oklch: [0.8173, 0.0624, 43.75], css: 'oklch(81.7% 0.062 43.7)', weight: 0.3 }]);
  assert.equal(paletteGpl(sample()), 'GIMP Palette\nName: Harbour dusk\nColumns: 3\n#\n 31  36  51\tcool dark grey\n231 183 163\tlight orange\n 43 108 176\tdark blue\n');
});

test('Adobe Swatch Exchange bytes follow the block layout and read back exactly', () => {
  const bytes = paletteAse(sample()), view = new DataView(bytes.buffer);
  assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), 'ASEF');
  assert.deepEqual([view.getUint16(4), view.getUint16(6), view.getUint32(8)], [1, 0, 5], 'version 1.0, a group start, three colors and a group end');
  assert.deepEqual([view.getUint16(12), view.getUint32(14), view.getUint16(18)], [0xc001, 2 + 13 * 2, 13], 'the group is named after the palette, NUL-terminated UTF-16');
  const first = 12 + 6 + 28;
  assert.deepEqual([view.getUint16(first), view.getUint16(first + 6)], [0x0001, 15]);
  const model = first + 8 + 15 * 2;
  assert.equal(String.fromCharCode(...bytes.subarray(model, model + 4)), 'RGB ');
  assert.equal(view.getFloat32(model + 4), Math.fround(31 / 255));
  assert.equal(view.getUint16(model + 16), 0, 'a global swatch');
  assert.deepEqual(bytes.subarray(-6), new Uint8Array([0xc0, 0x02, 0, 0, 0, 0]));
  assert.equal(bytes.length, 12 + 34 + 56 + 52 + 46 + 6);
  assert.deepEqual(readAse(bytes), { name: 'Harbour dusk', colors: sample().colors.map(({ name, hex }) => ({ name, hex })), skipped: 0 });
  assert.deepEqual(readAse(bytes.buffer.slice(0)), readAse(bytes));
});

test('reading .ase files handles gray, CMYK and Lab swatches and rejects broken files', () => {
  const entry = (name, model, values) => {
    const units = name.length + 1, length = 2 + units * 2 + 4 + values.length * 4 + 2, out = new DataView(new ArrayBuffer(6 + length));
    out.setUint16(0, 1); out.setUint32(2, length); out.setUint16(6, units);
    [...name].forEach((char, i) => out.setUint16(8 + i * 2, char.charCodeAt(0)));
    let at = 8 + units * 2; [...model].forEach(char => out.setUint8(at++, char.charCodeAt(0)));
    values.forEach(value => { out.setFloat32(at, value); at += 4; });
    return new Uint8Array(out.buffer);
  };
  const file = blocks => { const head = new DataView(new ArrayBuffer(12)); [65, 83, 69, 70].forEach((byte, i) => head.setUint8(i, byte)); head.setUint16(4, 1); head.setUint32(8, blocks.length); return new Uint8Array([...new Uint8Array(head.buffer), ...blocks.flatMap(block => [...block])]); };
  const read = readAse(file([entry('Mid', 'Gray', [0.5]), entry('Ink', 'CMYK', [0, 0, 0, 1]), entry('Paper', 'LAB ', [1, 0, 0]), entry('Spot', 'XYZ!', [0, 0, 0])]));
  assert.equal(read.name, null);
  assert.deepEqual(read.colors.map(color => color.name), ['Mid', 'Ink', 'Paper']);
  assert.deepEqual(read.colors.slice(0, 2).map(color => color.hex), ['#808080', '#000000']);
  assert.ok(contrastRatio(read.colors[2].hex, '#ffffff') < 1.02, 'Lab white is white');
  assert.equal(read.skipped, 1);
  assert.throws(() => readAse(new Uint8Array(12)), /not an Adobe Swatch Exchange/);
  assert.throws(() => readAse(paletteAse(sample()).subarray(0, 60)), /cut short/);
  assert.throws(() => readAse('ASEF'), /bytes/);
  assert.throws(() => readAse(new Uint8Array(PALETTE_LIMITS.aseBytes + 1)), /1 MB/);
});

test('paletteFiles writes every export with a safe file name', () => {
  const files = paletteFiles(sample());
  assert.deepEqual(files.map(file => [file.format, file.filename, file.type, typeof file.data]), [
    ['css', 'harbour-dusk.css', 'text/css', 'string'], ['json', 'harbour-dusk.json', 'application/json', 'string'],
    ['ase', 'harbour-dusk.ase', 'application/octet-stream', 'object'], ['gpl', 'harbour-dusk.gpl', 'text/plain', 'string'],
  ]);
  assert.deepEqual([...PALETTE_FORMATS], files.map(file => file.format));
  assert.ok(files[2].data instanceof Uint8Array);
  assert.deepEqual(paletteFiles(sample(), { formats: ['gpl'], basename: '../../Évening Sky!' }).map(file => file.filename), ['evening-sky.gpl']);
  assert.equal(paletteFiles(buildPalette(['#000000'], { name: '%%%' }), { formats: ['css'] })[0].filename, 'palette.css');
  assert.match(paletteFiles(sample(), { formats: ['css'], prefix: 'kit' })[0].data, /--kit-1:/);
  assert.throws(() => paletteFiles(sample(), { formats: ['svg'] }), /css, json, ase, gpl/);
});
