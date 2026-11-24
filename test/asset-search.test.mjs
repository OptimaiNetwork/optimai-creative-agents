import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ASSET_INDEX_KIND, ASSET_SEARCH_COLORS, ASSET_SEARCH_LIMITS, colorFamily, cosineSimilarity, createAssetIndex, describeImage, hintScore, loadAssetIndex,
  normalizeVector, parseAssetQuery, readImageFeatures,
} from '../src/asset-search.mjs';

const hex = value => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16));
// A `width`×`height` picture filled with `background`, with `[color, share]` painted as a centred block covering that share.
function picture(width, height, background, blocks = []) {
  const data = new Uint8ClampedArray(width * height * 4), fill = hex(background);
  for (let i = 0; i < width * height; i++) data.set([...fill, 255], i * 4);
  let y0 = 0;
  for (const [color, share] of blocks) {
    const rows = Math.round(height * share), rgb = hex(color);
    for (let y = y0; y < Math.min(height, y0 + rows); y++) for (let x = 0; x < width; x++) data.set([...rgb, 255], (y * width + x) * 4);
    y0 += rows;
  }
  return data;
}
const features = (width, height, background, blocks, aspect) => describeImage(picture(width, height, background, blocks), width, height, aspect ? { aspect } : {});

test('pixels get the color family a searcher would name', () => {
  const named = Object.fromEntries(['#ff0000', '#8b0000', '#dc143c', '#ff69b4', '#ffc0cb', '#ffa500', '#8b4513', '#d2b48c', '#ffd700', '#228b22', '#008080', '#0000ff', '#87ceeb', '#000080', '#800080', '#ee82ee', '#000000', '#222222', '#808080', '#ffffff', '#fffff0']
    .map(value => [value, colorFamily(...hex(value))]));
  assert.deepEqual(named, {
    '#ff0000': 'red', '#8b0000': 'red', '#dc143c': 'red', '#ff69b4': 'pink', '#ffc0cb': 'pink', '#ffa500': 'orange', '#8b4513': 'brown', '#d2b48c': 'brown', '#ffd700': 'yellow',
    '#228b22': 'green', '#008080': 'cyan', '#0000ff': 'blue', '#87ceeb': 'blue', '#000080': 'blue', '#800080': 'purple', '#ee82ee': 'purple',
    '#000000': 'black', '#222222': 'black', '#808080': 'grey', '#ffffff': 'white', '#fffff0': 'white',
  });
  assert.deepEqual(['#f6d9e3', '#cfe7f6', '#1a1d33', '#f4efe6', '#e6f4ff'].map(value => colorFamily(...hex(value))), ['pink', 'blue', 'black', 'white', 'white'], 'pastels keep their hue; near-black navy and off-whites stay neutral');
  assert.deepEqual([...ASSET_SEARCH_COLORS].sort(), [...new Set(Object.values(named))].sort(), 'every family is reachable');
});

test('a signature measures color shares, their lightness, tone and shape, deterministically', () => {
  const sign = features(40, 30, '#87ceeb', [['#b22222', 0.2], ['#ffffff', 0.1]], 16 / 9);
  assert.deepEqual(Object.keys(sign.colors).sort(), ['blue', 'red', 'white']);
  assert.equal(sign.colors.blue.weight, 0.7); assert.equal(sign.colors.red.weight, 0.2);
  assert.ok(sign.colors.red.lightness < 0.6 && sign.colors.blue.lightness > 0.75, 'per-family lightness');
  assert.equal(sign.aspect, 1.778);
  assert.ok(sign.warmth < 0, 'mostly sky blue reads cool');
  assert.deepEqual(features(40, 30, '#87ceeb', [['#b22222', 0.2], ['#ffffff', 0.1]], 16 / 9), sign);
  const grey = features(20, 20, '#202020', [['#e0e0e0', 0.5]]);
  assert.equal(grey.chromatic, 0); assert.ok(grey.contrast > 0.3);
  // Transparent pixels don't count; a fully transparent image has no colors.
  const clear = describeImage(new Uint8ClampedArray(16), 2, 2);
  assert.deepEqual(clear.colors, {}); assert.equal(clear.lightness, 0);
  assert.throws(() => describeImage(new Uint8ClampedArray(12), 2, 2), TypeError);
  assert.throws(() => describeImage(new Uint8ClampedArray(4), 1, 1, { aspect: 0 }), RangeError);
  assert.throws(() => describeImage(new Uint8ClampedArray(4), 1000, 1000), RangeError);
});

test('queries become color, shade, tone and shape hints with negation; other words stay words', () => {
  const red = parseAssetQuery('Find the shot with the red car');
  assert.deepEqual(red.hints.map(h => h.label), ['red']);
  assert.deepEqual(red.terms, [{ word: 'car', negate: false }]);
  const mixed = parseAssetQuery('Dark-red portrait, black & white, no blue -sky');
  assert.deepEqual(mixed.hints.map(h => [h.kind, h.value, h.shade ?? null, h.negate]), [['color', 'red', 'dark', false], ['shape', 'portrait', null, false], ['tone', 'mono', null, false], ['color', 'blue', null, true]]);
  assert.deepEqual(mixed.terms, [{ word: 'sky', negate: true }]);
  assert.deepEqual(parseAssetQuery('dark and moody b/w').hints.map(h => h.value), ['dark', 'mono'], 'duplicates fold; b/w is black and white');
  assert.deepEqual(parseAssetQuery('light blue, navy, golden hour').hints.map(h => h.label), ['light blue', 'blue', 'yellow']);
  assert.deepEqual(parseAssetQuery('Café crème').terms.map(t => t.word), ['cafe', 'creme'], 'accents fold');
  assert.equal(parseAssetQuery('x'.repeat(500)).text.length, ASSET_SEARCH_LIMITS.query);
  assert.ok(parseAssetQuery(Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')).terms.length <= ASSET_SEARCH_LIMITS.terms);
});

test('"the red car" finds the shot with red in it, and names what it could not use', () => {
  const index = createAssetIndex();
  index.add({ id: 'beach', name: 'IMG_2041.jpg', features: features(48, 32, '#87ceeb', [['#f4e2b8', 0.4]]) });
  index.add({ id: 'car', name: 'IMG_2042.jpg', features: features(48, 32, '#5a5a5a', [['#c81e1e', 0.15]]) });
  index.add({ id: 'roses', name: 'IMG_2043.jpg', tags: ['garden'], features: features(32, 48, '#1e5a1e', [['#e01a2a', 0.5]]) });
  const found = index.search('find the shot with the red car');
  assert.deepEqual(found.results.map(r => r.id), ['roses', 'car'], 'more red ranks first; the beach has none');
  assert.deepEqual(found.unmatched, ['car'], 'no asset is named "car", so the word needs a model');
  assert.deepEqual(found.results[0].matches, ['red']);
  // Once a name says "car", the word counts and both hints matter.
  index.add({ id: 'car', name: 'red-car-downtown.jpg', features: index.get('car').features });
  const named = index.search('red car');
  assert.equal(named.results[0].id, 'car'); assert.deepEqual(named.results[0].matches, ['red', 'car']); assert.deepEqual(named.unmatched, []);
  assert.deepEqual(index.search('portrait').results.map(r => r.id), ['roses']);
  assert.deepEqual(index.search('red -garden').results.map(r => r.id), ['car'], 'a negated word excludes');
  assert.deepEqual(index.search('no red').results.map(r => r.id), ['beach']);
  assert.deepEqual(index.search('without garden').results.map(r => r.id), ['beach', 'car'], 'a filter alone lists the rest in order');
  assert.deepEqual(index.search('-tulips').unmatched, [], 'a negated word nobody has is simply ignored');
});

test('shades, tones and shapes rank sensibly', () => {
  const index = createAssetIndex();
  index.add({ id: 'night', features: features(32, 32, '#0b0d1a', [['#f0c040', 0.05]], 16 / 9) });
  index.add({ id: 'noir', features: features(32, 32, '#101010', [['#d8d8d8', 0.45]], 4 / 5) });
  index.add({ id: 'pastel', features: features(32, 32, '#f6d6e0', [['#cfe8f6', 0.5]], 1) });
  index.add({ id: 'pop', features: features(32, 32, '#ff0055', [['#00c0ff', 0.5]], 1) });
  const top = query => index.search(query).results[0]?.id;
  assert.equal(top('dark'), 'night');
  assert.equal(top('black and white portrait'), 'noir');
  assert.equal(top('bright'), 'pastel');
  assert.equal(top('vibrant'), 'pop');
  assert.equal(top('high contrast'), 'noir');
  assert.equal(top('light pink square'), 'pastel');
  assert.equal(top('panorama'), undefined, 'nothing is panoramic');
  assert.ok(hintScore(index.get('night').features, { kind: 'shape', value: 'landscape' }) === 1);
  assert.equal(hintScore(null, { kind: 'tone', value: 'dark' }), 0);
});

test('names, tags and captions match by word, plural and prefix', () => {
  const index = createAssetIndex();
  index.add({ id: '1', name: 'GoldenGateSunset_final.png', tags: ['travel'] });
  index.add({ id: '2', name: 'logo-boxes.svg', text: 'Three cardboard boxes on a desk' });
  assert.deepEqual(index.search('sunset').results.map(r => r.id), ['1'], 'camelCase file names split');
  assert.deepEqual(index.search('box').results.map(r => r.id), ['2']);
  assert.deepEqual(index.search('trav').results.map(r => r.id), ['1']);
  assert.deepEqual(index.search('final.png').results.map(r => r.id), ['1']);
  const all = index.search('');
  assert.deepEqual(all.results.map(r => [r.id, r.score]), [['1', 0], ['2', 0]], 'an empty query lists every asset in order');
  assert.equal(index.search('', { limit: 1 }).results.length, 1);
});

test('embeddings blend with hints, stay tied to one model and survive a save', () => {
  assert.throws(() => createAssetIndex().add({ id: 'a', vector: [1, 0] }), /Name the embedding model/);
  const index = createAssetIndex({ model: 'demo-clip@1' });
  index.add({ id: 'cat', name: 'a.jpg', vector: [0.9, 0.1, 0], features: features(8, 8, '#808080') });
  index.add({ id: 'dog', name: 'b.jpg', vector: [0.1, 0.9, 0.1], features: features(8, 8, '#c81e1e') });
  index.add({ id: 'new', name: 'c.jpg' });
  assert.equal(index.dims, 3);
  assert.throws(() => index.add({ id: 'bad', vector: [1, 2] }), /3-number vectors/);
  assert.throws(() => index.add({ id: 'zero', vector: [0, 0, 0] }), /all zeros/);
  const cats = index.search('a cat', { vector: [1, 0, 0] });
  assert.deepEqual(cats.results.map(r => r.id), ['cat', 'dog', 'new'], 'cosine ranks; an asset without a vector goes last');
  assert.deepEqual(cats.unmatched, [], 'with a model every word is covered');
  assert.equal(cats.results[2].similarity, null);
  assert.ok(cats.results[0].similarity > 0.99);
  // A red hint pulls the red asset up when the vectors are close.
  assert.equal(index.search('red', { vector: [0.5, 0.5, 0], vectorWeight: 0.5 }).results[0].id, 'dog');

  const saved = JSON.parse(JSON.stringify(index.toJSON()));
  assert.equal(saved.kind, ASSET_INDEX_KIND); assert.equal(typeof saved.entries[0].vector, 'string');
  const same = loadAssetIndex(saved, { model: 'demo-clip@1' });
  assert.deepEqual(same.dropped, { entries: 0, vectors: 0 });
  assert.deepEqual(same.index.search('a cat', { vector: [1, 0, 0] }).results.map(r => r.id), ['cat', 'dog', 'new']);
  assert.deepEqual(same.index.get('cat').features, index.get('cat').features);
  const other = loadAssetIndex(JSON.stringify(saved), { model: 'demo-clip@2' });
  assert.deepEqual(other.dropped, { entries: 0, vectors: 2 }, 'vectors from another model are never compared');
  assert.equal(other.index.get('cat').hasVector, false);
  assert.deepEqual(other.index.search('red').results.map(r => r.id), ['dog'], 'entries stay searchable by look');
  const damaged = loadAssetIndex({ ...saved, entries: [...saved.entries, { id: '' }, { id: 'v', vector: '%%%' }, { id: 'f', features: { version: 9 } }] }, { model: 'demo-clip@1' });
  assert.equal(damaged.index.size, 4); assert.deepEqual(damaged.dropped, { entries: 2, vectors: 1 });
  assert.throws(() => loadAssetIndex({ kind: 'other' }), /not a saved asset index/);
});

test('a calibrated model leads by meaning relative to its best match; looks only adjust', () => {
  const index = createAssetIndex({ model: 'demo@1' });
  // "a car driving at night": the night drive is the best match by meaning but not a strong one; the dark dessert is darker.
  index.add({ id: 'night-drive', vector: [0.12, 1, 0], features: features(8, 8, '#2a3040') });
  index.add({ id: 'dark-dessert', vector: [0.1, 1, 0], features: features(8, 8, '#0c0608') });
  index.add({ id: 'beach', vector: [0, 1, 0.2], features: features(8, 8, '#87ceeb') });
  const chance = cosine => 1 / (1 + Math.exp(-(117.33 * cosine - 12.93)));
  const query = [1, 0, 0];
  const raw = index.search('night', { vector: query });
  assert.equal(raw.results[0].id, 'night-drive', 'raw cosines keep the order');
  const absolute = index.search('night', { vector: query, calibrate: cosine => chance(cosine) * 1 });
  assert.deepEqual(absolute.results.map(r => r.id), ['night-drive', 'dark-dessert', 'beach'], 'the weak best match still leads the darker picture');
  assert.equal(absolute.results[0].score, 0.7 + 0.3 * hintScore(index.get('night-drive').features, { kind: 'tone', value: 'dark' }));
  assert.ok(Math.abs(absolute.results[0].similarity - cosineSimilarity(query, [0.12, 1, 0])) < 1e-4, 'similarity stays the raw cosine');
  assert.equal(index.search('', { vector: query, calibrate: chance }).results[0].score, 1, 'the best match by meaning scores 1');
  assert.throws(() => index.search('x', { vector: query, calibrate: 0.5 }), TypeError);
  // "black and white": the model prefers a dark street; the ink painting is the one that is actually black and white.
  const looks = createAssetIndex({ model: 'demo@1' });
  looks.add({ id: 'neon-street', vector: [0.12, 1, 0], features: features(8, 8, '#14202e', [['#c83cc8', 0.15]]) });
  looks.add({ id: 'ink-painting', vector: [0.1, 1, 0], features: features(8, 8, '#e8e8e8', [['#202020', 0.4]]) });
  assert.equal(looks.search('black and white', { vector: query, calibrate: chance }).results[0].id, 'ink-painting', 'only look words: the pixels lead');
  assert.equal(looks.search('black and white', { vector: query, calibrate: chance, vectorWeight: 0.7 }).results[0].id, 'neon-street');
  assert.equal(looks.search('black and white street', { vector: query, calibrate: chance }).results[0].id, 'neon-street', 'another word lets meaning lead');
});

test('vector helpers and bounds', () => {
  const unit = normalizeVector([3, 4]);
  assert.ok(unit instanceof Float32Array); assert.ok(Math.abs(unit[0] - 0.6) < 1e-6);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0); assert.equal(cosineSimilarity([1, 1], [2, 2]).toFixed(6), '1.000000');
  assert.throws(() => cosineSimilarity([1], [1, 2]), RangeError);
  assert.throws(() => normalizeVector([1, NaN]), RangeError);
  const index = createAssetIndex();
  assert.throws(() => index.add({ id: 'x'.repeat(129) }), RangeError);
  assert.throws(() => index.add({ id: 'a', features: { version: 2 } }), TypeError);
  const entry = index.add({ id: 'a', name: 'n\u0000ame', tags: ['t', 't', ''] });
  assert.equal(entry.name, 'n ame'); assert.deepEqual(entry.tags, ['t']);
  index.add({ id: 'b' }); index.add({ id: 'a', name: 'again' });
  assert.deepEqual(index.ids(), ['b', 'a'], 'replacing moves an asset to the end');
  assert.equal(index.remove('b'), true); assert.equal(index.size, 1);
  index.clear(); assert.equal(index.size, 0);
  assert.throws(() => index.search('x', { limit: 0 }), RangeError);
});

test('readImageFeatures reads a small thumbnail through a canvas, or returns null without one', () => {
  assert.equal(readImageFeatures({}, 100, 50), null, 'Node has no canvas');
  const calls = [];
  const saved = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = class {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() {
      return {
        drawImage: (...args) => calls.push(args.slice(1)),
        getImageData: (x, y, width, height) => ({ data: picture(width, height, '#c81e1e') }),
      };
    }
  };
  try {
    const sign = readImageFeatures({ fake: true }, 4000, 3000);
    assert.deepEqual(calls, [[0, 0, 64, 48]]);
    assert.equal(sign.aspect, 1.333); assert.equal(sign.colors.red.weight, 1);
    globalThis.OffscreenCanvas = class { getContext() { return { drawImage() { throw new Error('tainted'); }, getImageData() {} }; } };
    assert.equal(readImageFeatures({}, 10, 10), null, 'a tainted canvas only disables look search');
  } finally { if (saved) globalThis.OffscreenCanvas = saved; else delete globalThis.OffscreenCanvas; }
});
