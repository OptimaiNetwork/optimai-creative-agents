import assert from 'node:assert/strict';
import test from 'node:test';
import { FILM_LOOKS, LUT_LIMITS, applyLut, createLut, filmLut, formatCubeLut, lutColor, parseCubeLut } from '../src/lut.mjs';
import { toOklch } from '../src/color.mjs';

/** Every 8-bit level on each channel, in a few cross combinations, with varied alpha. */
function ramp() {
  const pixels = new Uint8ClampedArray(256 * 4 * 4);
  for (let row = 0; row < 4; row++) for (let level = 0; level < 256; level++) {
    const rgb = [[level, level, level], [level, 255 - level, (level * 7) % 256], [(level * 3) % 256, level, 40], [90, (level * 5) % 256, level]][row];
    pixels.set([...rgb, 100 + (level % 150)], (row * 256 + level) * 4);
  }
  return pixels;
}
// A 2³ cube that swaps red and blue, written by hand.
const SWAP = `# swap red and blue
TITLE "Swap"
LUT_3D_SIZE 2

0 0 0
0 0 1
0 1 0
0 1 1
1 0 0
1 0 1
1 1 0
1 1 1
`;

test('parseCubeLut reads 3D .cube files: title, domain, comments, CRLF and red-fastest order', () => {
  const lut = parseCubeLut(SWAP.replace(/\n/g, '\r\n'));
  assert.equal(lut.title, 'Swap');
  assert.equal(lut.size, 2);
  assert.deepEqual([...lut.domainMin], [0, 0, 0]);
  assert.deepEqual([...lut.table.slice(3, 6)], [0, 0, 1], 'Row 2 is red = 1: it maps to blue.');
  assert.ok(Object.isFrozen(lut));
  assert.equal(lutColor('#ff0000', lut), '#0000ff');
  assert.equal(lutColor('#00ff00', lut), '#00ff00');
  const ranged = parseCubeLut(SWAP.replace('LUT_3D_SIZE 2', 'LUT_3D_SIZE 2\nLUT_3D_INPUT_RANGE 0 2'));
  assert.deepEqual([...ranged.domainMax], [2, 2, 2]);
  assert.equal(lutColor('#ff0000', ranged), '#000080', 'Inputs map into the domain: full red is halfway along 0–2.');
  const scaled = parseCubeLut(SWAP.replace('LUT_3D_SIZE 2', 'LUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 0.5'));
  assert.equal(lutColor('#0000ff', scaled), '#ff0000', 'Inputs above DOMAIN_MAX clamp to the edge.');
});

test('parseCubeLut is strict and names the line it refused', () => {
  const refuse = (text, pattern) => assert.throws(() => parseCubeLut(text), pattern);
  refuse(42, /is text/);
  refuse('TITLE "x"\n', /no LUT_3D_SIZE/);
  refuse('0 0 0\nLUT_3D_SIZE 2\n', /Line 1: LUT_3D_SIZE must come before/);
  refuse('LUT_3D_SIZE 1\n', /Line 1: LUT_3D_SIZE must be a whole number from 2 to 65/);
  refuse('LUT_3D_SIZE 66\n', /from 2 to 65/);
  refuse('LUT_3D_SIZE 2.5\n', /whole number/);
  refuse('LUT_1D_SIZE 1024\n', /1D LUTs are not supported/);
  refuse('LUT_3D_SIZE 2\nLUT_3D_SIZE 2\n', /Line 2: LUT_3D_SIZE appears twice/);
  refuse('LUT_3D_SIZE 2\nGAMMA 2.2\n', /Line 2: unknown keyword GAMMA/);
  refuse('TITLE unquoted\nLUT_3D_SIZE 2\n', /TITLE is a quoted name/);
  refuse(`TITLE "${'x'.repeat(201)}"\nLUT_3D_SIZE 2\n`, /up to 200 characters/);
  refuse(SWAP.replace('0 1 1', '0 1'), /Line 8: expected 3 numbers/);
  refuse(SWAP.replace('0 1 1', '0 1 one'), /expected 3 numbers/);
  refuse(SWAP.replace('0 1 1', '0 1 1e40'), /within ±1000000/);
  refuse(SWAP.replace('1 1 1\n', ''), /Expected 8 table rows for size 2, found 7/);
  refuse(`${SWAP}0 0 0\n`, /Line 13: more than 2³ table rows/);
  refuse(SWAP.replace('1 1 0\n', 'DOMAIN_MIN 0 0 0\n1 1 0\n'), /keywords must come before the table/);
  refuse(SWAP.replace('LUT_3D_SIZE 2', 'LUT_3D_SIZE 2\nDOMAIN_MIN 1 0 0\nDOMAIN_MAX 1 1 1'), /DOMAIN_MAX must be greater/);
  refuse(' '.repeat(LUT_LIMITS.bytes + 1), /larger than 16 MB/);
});

test('formatCubeLut round-trips through the parser, and createLut bakes a transform', () => {
  const invert = createLut(([r, g, b]) => [1 - r, 1 - g, 1 - b], { size: 5, title: 'Invert "neg"' });
  const text = formatCubeLut(invert);
  assert.match(text, /^TITLE "Invert 'neg'"\nLUT_3D_SIZE 5\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n1\.000000 1\.000000 1\.000000\n/);
  const back = parseCubeLut(text);
  assert.equal(back.size, 5);
  assert.deepEqual([...back.table], [...invert.table]);
  assert.equal(lutColor('#204060', back), '#dfbf9f');
  assert.throws(() => createLut(() => [0, 0]), /three finite numbers/);
  assert.throws(() => createLut(x => x, { size: 80 }), /from 2 to 65/);
  assert.throws(() => formatCubeLut({ size: 2 }), /Use a LUT/);
});

test('applyLut: identity tables keep every level, trilinear follows linear maps, amount mixes and bands match', () => {
  for (const size of [2, 17, 33]) {
    const pixels = ramp(), original = pixels.slice();
    applyLut(pixels, 256, 4, createLut(rgb => rgb, { size }));
    assert.deepEqual(pixels, original, `A ${size}³ identity LUT is lossless, alpha included.`);
  }
  // Trilinear interpolation reproduces any affine map, even on a 2³ grid (within Float32 rounding of half a level).
  const affine = createLut(([r, g, b]) => [0.5 * r + 0.25 * g, 0.2 + 0.6 * b, 0.9 - 0.8 * r], { size: 2 });
  const pixels = applyLut(ramp(), 256, 4, affine), source = ramp();
  for (let i = 0; i < pixels.length; i += 4) {
    const [r, g, b] = [source[i] / 255, source[i + 1] / 255, source[i + 2] / 255];
    [0.5 * r + 0.25 * g, 0.2 + 0.6 * b, 0.9 - 0.8 * r].forEach((value, channel) => assert.ok(Math.abs(pixels[i + channel] - value * 255) <= 0.501, `level ${i / 4} channel ${channel}`));
  }
  const film = filmLut('teal-amber'), whole = applyLut(ramp(), 256, 4, film, { amount: 0.6 }), banded = ramp();
  for (const rows of [[0, 1], [1, 3], [3, 4]]) applyLut(banded, 256, 4, film, { amount: 0.6, rows });
  assert.deepEqual(banded, whole, 'Band by band gives identical bytes.');
  assert.deepEqual(applyLut(ramp(), 256, 4, film, { amount: 0 }), ramp(), 'Amount 0 is the untouched image.');
  const half = lutColor('#c08060', film, 0.5), full = lutColor('#c08060', film);
  assert.ok(parseInt(half.slice(1, 3), 16) > 0xc0 && parseInt(half.slice(1, 3), 16) < parseInt(full.slice(1, 3), 16), 'Half the amount moves half the way.');
  assert.throws(() => applyLut(ramp(), 256, 4, film, { amount: 2 }), /amount must be a number from 0 to 1/);
  assert.throws(() => applyLut(ramp(), 256, 4, film, { rows: [2, 9] }), /rows must be/);
  assert.throws(() => applyLut(new Uint8ClampedArray(8), 256, 4, film), /RGBA/);
  assert.throws(() => applyLut(ramp(), 256, 4, { size: 2, table: [] }), /Use a LUT/);
  assert.throws(() => applyLut(ramp(), 5000, 4000, film), /16 million/);
});

test('the film looks are distinct, shared, and do what their names say', () => {
  assert.deepEqual(Object.keys(FILM_LOOKS), ['golden', 'teal-amber', 'matte']);
  assert.equal(filmLut('golden'), filmLut('golden'), 'Each look is baked once.');
  assert.equal(filmLut('golden').size, 33);
  assert.throws(() => filmLut('vintage'), /Choose a film look: golden, teal-amber, matte/);
  const hue = color => toOklch(color)[2], chroma = color => toOklch(color)[1], lightness = color => toOklch(color)[0];
  const golden = filmLut('golden'), teal = filmLut('teal-amber'), matte = filmLut('matte');
  // Golden warms mid grey toward yellow-orange; whites stay bright.
  assert.ok(chroma(lutColor('#808080', golden)) > 0.02 && hue(lutColor('#808080', golden)) > 60 && hue(lutColor('#808080', golden)) < 110);
  assert.ok(lightness(lutColor('#ffffff', golden)) > 0.95);
  // Teal & Amber: dark blue-greys go teal-blue, skin tones go warmer and stronger.
  const shadow = lutColor('#203040', teal), skin = lutColor('#c08060', teal);
  assert.ok(hue(shadow) > 200 && hue(shadow) < 260, `shadow ${shadow}`);
  assert.ok(chroma(skin) > chroma('#c08060') && hue(skin) > 40 && hue(skin) < 70, `skin ${skin}`);
  // Matte lifts black, softens white and mutes color.
  assert.ok(lightness(lutColor('#000000', matte)) > 0.2 && lightness(lutColor('#ffffff', matte)) < 0.97);
  assert.ok(chroma(lutColor('#d03030', matte)) < chroma('#d03030') * 0.85);
  // Every look keeps the order of a grey ramp (no banding reversals).
  for (const lut of [golden, teal, matte]) {
    let previous = -1;
    for (let level = 0; level < 256; level += 5) { const value = lightness(lutColor(`#${level.toString(16).padStart(2, '0').repeat(3)}`, lut)); assert.ok(value > previous); previous = value; }
  }
});
