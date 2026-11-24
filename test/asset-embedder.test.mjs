import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ASSET_EMBEDDER_RUNTIME, AssetEmbedderError, assetEmbedderPlan, canonicalSiglipText, createAssetEmbedder, createSiglipTokenizer, isAssetEmbedderCached,
  SIGLIP_MODEL, siglipImageTensor, siglipMatchChance,
} from '../src/asset-embedder.mjs';
import { createAssetIndex } from '../src/asset-search.mjs';
import { depthModelUrl } from '../src/depth.mjs';

// A tiny Unigram vocabulary with SigLIP's special ids (0 <pad>, 1 </s>, 2 <unk>) and two byte pieces.
const VOCAB = [['<pad>', 0], ['</s>', 0], ['<unk>', 0], ['<0xC3>', 0], ['<0xAF>', 0], ['▁', -2], ['▁red', -3], ['▁re', -4], ['d', -4], ['▁car', -3], ['▁c', -5], ['a', -5], ['r', -5], ['e', -5],
  ['▁blue', -3], ['▁a', -2], ['▁photo', -3], ['▁of', -2], ['▁na', -4], ['ve', -4], ['n', -6], ['v', -6], ['o', -6], ['i', -6]];
const id = piece => VOCAB.findIndex(([value]) => value === piece);
const tokenizerJson = () => JSON.stringify({ model: { type: 'Unigram', unk_id: 2, vocab: VOCAB } });
// The same JSON padded with whitespace to the pinned file's byte size, so a fake hub can serve it.
const pinnedTokenizer = () => { const text = tokenizerJson(); return text + ' '.repeat(SIGLIP_MODEL.config['tokenizer.json'].bytes - new TextEncoder().encode(text).length); };

test('the pinned model is Google SigLIP base (Apache-2.0) at one commit, with every file hashed', () => {
  assert.equal(SIGLIP_MODEL.license, 'Apache-2.0');
  assert.equal(SIGLIP_MODEL.source, 'google/siglip-base-patch16-224');
  assert.match(SIGLIP_MODEL.revision, /^[0-9a-f]{40}$/);
  assert.equal(SIGLIP_MODEL.index, `siglip-base-patch16-224@${SIGLIP_MODEL.revision.slice(0, 7)}`);
  assert.deepEqual(Object.keys(SIGLIP_MODEL.weights).sort(), ['text-fp16', 'text-q4f16', 'text-q8', 'vision-fp16', 'vision-q4f16', 'vision-q8']);
  for (const spec of Object.values(SIGLIP_MODEL.weights)) { assert.match(spec.sha256, /^[0-9a-f]{64}$/); assert.match(spec.file, /^onnx\/(vision|text)_model_(quantized|fp16|q4f16)\.onnx$/); assert.ok(spec.bytes > 5e7 && spec.bytes < 2.3e8); }
  assert.match(SIGLIP_MODEL.config['tokenizer.json'].gitSha1, /^[0-9a-f]{40}$/);
  assert.deepEqual({ ...ASSET_EMBEDDER_RUNTIME }, { package: 'onnxruntime-web', version: '1.31.1', license: 'MIT' });
  assert.ok(Object.isFrozen(SIGLIP_MODEL.weights['text-q8']) && Object.isFrozen(SIGLIP_MODEL.logit));
});

test('search text is canonicalized the way SigLIP was trained', () => {
  assert.equal(canonicalSiglipText('  A Photo of THE red car!  '), 'a photo of the red car');
  assert.equal(canonicalSiglipText("co-founder's 3D-printed (v2)"), 'cofounders 3dprinted v2');
  assert.equal(canonicalSiglipText('ＡＢＣ\tﬁne'), 'abc fine', 'NFKC folds full-width letters and ligatures');
  assert.equal(canonicalSiglipText(null), '');
});

test('the Unigram tokenizer picks the cheapest split, falls back to bytes, and pads to 64', () => {
  const tokenizer = createSiglipTokenizer(tokenizerJson());
  assert.equal(tokenizer.size, VOCAB.length);
  const { ids, count } = tokenizer.encode('Red car!');
  assert.equal(ids.length, 64); assert.equal(count, 3);
  assert.deepEqual(ids.slice(0, 4), [id('▁red'), id('▁car'), 1, 1], '▁red (−3) beats ▁re + d (−8); </s> ends and pads');
  assert.deepEqual(tokenizer.split('naïve'), [id('▁na'), id('<0xC3>'), id('<0xAF>'), id('ve')], 'a missing character becomes its UTF-8 byte pieces');
  assert.deepEqual(tokenizer.split('red 漢字'), [id('▁red'), id('▁'), 2], 'characters without byte pieces become one <unk> per run');
  assert.deepEqual(tokenizer.encode('').ids.slice(0, 2), [1, 1]);
  const long = tokenizer.encode('red '.repeat(100));
  assert.equal(long.count, 64); assert.equal(long.ids[62], id('▁red')); assert.equal(long.ids[63], 1, 'truncated to 63 pieces plus </s>');
  assert.equal(createSiglipTokenizer(tokenizerJson(), { length: 8 }).encode('red').ids.length, 8);
  assert.throws(() => createSiglipTokenizer('{"model":{"type":"BPE","vocab":[]}}'), TypeError);
  assert.throws(() => createSiglipTokenizer(JSON.stringify({ model: { type: 'Unigram', vocab: [['a', 0], ['b', 'x'], ['c', 0]] } })), /entry 1/);
  assert.throws(() => createSiglipTokenizer(tokenizerJson(), { length: 1 }), RangeError);
});

test('pictures become a 224 × 224 tensor in −1…1, squashed to the square', () => {
  const data = new Uint8ClampedArray(2 * 1 * 4); data.set([255, 0, 0, 255, 0, 0, 255, 255]);
  const { data: tensor, dims } = siglipImageTensor({ width: 2, height: 1, data });
  assert.deepEqual(dims, [1, 3, 224, 224]);
  const plane = 224 * 224, at = (ch, x, y) => tensor[ch * plane + y * 224 + x];
  assert.equal(at(0, 0, 0), 1); assert.equal(at(2, 0, 0), -1);
  assert.equal(at(0, 223, 223), -1); assert.equal(at(2, 223, 223), 1);
  assert.ok(tensor.every(value => value >= -1 && value <= 1));
  assert.throws(() => siglipImageTensor({ width: 2, height: 2, data: new Uint8Array(3) }), TypeError);
  assert.throws(() => siglipImageTensor({ width: 5000, height: 5000, data: { length: 5000 * 5000 * 4 } }), error => error instanceof AssetEmbedderError && error.code === 'image-too-large');
});

test('match chance is SigLIP\'s own sigmoid of the cosine', () => {
  const even = -SIGLIP_MODEL.logit.bias / SIGLIP_MODEL.logit.scale;
  assert.ok(Math.abs(siglipMatchChance(even) - 0.5) < 1e-9);
  assert.ok(siglipMatchChance(0) < 1e-5 && siglipMatchChance(0.2) > 0.99);
  assert.ok(siglipMatchChance(0.1) < siglipMatchChance(0.11));
});

test('the plan runs pictures on WebGPU (q4f16) when it can and searches on WebAssembly (q8)', () => {
  const gpu = assetEmbedderPlan({ gpu: true }), cpu = assetEmbedderPlan({ gpu: false }), tokenizer = SIGLIP_MODEL.config['tokenizer.json'].bytes;
  assert.deepEqual([gpu.vision.device, gpu.vision.dtype, gpu.text.device, gpu.text.dtype], ['webgpu', 'q4f16', 'wasm', 'q8']);
  assert.deepEqual([cpu.vision.device, cpu.vision.dtype, cpu.text.device, cpu.text.dtype], ['wasm', 'q8', 'wasm', 'q8']);
  assert.equal(gpu.bytes, SIGLIP_MODEL.weights['vision-q4f16'].bytes + SIGLIP_MODEL.weights['text-q8'].bytes + tokenizer);
  assert.equal(cpu.text.bytes, SIGLIP_MODEL.weights['text-q8'].bytes + tokenizer);
  assert.ok(gpu.bytes < 170e6 && cpu.bytes < 215e6, 'within the approved download');
  assert.equal(assetEmbedderPlan({ gpu: true, vision: { dtype: 'fp16' } }).vision.file, 'onnx/vision_model_fp16.onnx');
  assert.throws(() => assetEmbedderPlan({ vision: { device: 'webgpu', dtype: 'q8' } }), /wrong results on WebGPU/);
  assert.throws(() => assetEmbedderPlan({ text: { device: 'cpu' } }), RangeError);
  assert.throws(() => assetEmbedderPlan({ text: { dtype: 'int4' } }), RangeError);
});

// Weights of zeros at their pinned size, the padded tokenizer, and a crypto stand-in that reports the pinned hash for
// a file of the pinned size (real verification is covered by the depth tests).
function pinnedHub() {
  const calls = [], specs = Object.values(SIGLIP_MODEL.weights), tokenizer = new TextEncoder().encode(pinnedTokenizer());
  const fetch = async url => {
    calls.push(url.split('/').pop());
    if (url === depthModelUrl('tokenizer.json', SIGLIP_MODEL)) return new Response(tokenizer.slice(), { headers: { 'content-length': String(tokenizer.length) } });
    const spec = specs.find(item => url === depthModelUrl(item.file, SIGLIP_MODEL));
    if (!spec) return new Response('missing', { status: 404 });
    let left = spec.bytes;
    return new Response(new ReadableStream({ pull(controller) { if (!left) return controller.close(); const size = Math.min(left, 8 << 20); left -= size; controller.enqueue(new Uint8Array(size)); } }), { headers: { 'content-length': String(spec.bytes) } });
  };
  const hexBytes = text => Uint8Array.from(text.match(/../g), byte => parseInt(byte, 16)).buffer;
  const subtle = { async digest(algorithm, data) { return algorithm === 'SHA-1' ? hexBytes(SIGLIP_MODEL.config['tokenizer.json'].gitSha1) : hexBytes(specs.find(item => item.bytes === data.byteLength).sha256); } };
  return { fetch, subtle, calls };
}
function memoryCaches() {
  const stores = new Map();
  return { async open(name) { if (!stores.has(name)) { const map = new Map(); stores.set(name, { async match(key) { const bytes = map.get(key); return bytes && new Response(bytes.slice()); }, async put(key, response) { map.set(key, new Uint8Array(await response.arrayBuffer())); }, async delete(key) { return map.delete(key); } }); } return stores.get(name); } };
}
// An ONNX Runtime stand-in: vision vectors say how red/blue the picture is, text vectors whether "red"/"blue" was asked.
function fakeOrt({ failGpu = false, mask = false, slow = 0 } = {}) {
  const log = [];
  let running = 0;
  class Tensor { constructor(type, data, dims) { Object.assign(this, { type, data, dims }); } }
  const part = bytes => Object.entries(SIGLIP_MODEL.weights).find(([, spec]) => spec.bytes === bytes)[0];
  const InferenceSession = {
    async create(bytes, options) {
      const name = part(bytes.byteLength);
      log.push({ create: name, on: options.executionProviders[0] });
      assert.equal(options.logSeverityLevel, 3);
      if (failGpu && options.executionProviders[0] === 'webgpu') throw new Error('no adapter');
      const vision = name.startsWith('vision');
      return {
        inputNames: vision ? ['pixel_values'] : mask ? ['input_ids', 'attention_mask'] : ['input_ids'], outputNames: ['last_hidden_state', 'pooler_output'],
        async run(feeds) {
          assert.equal(++running, 1, 'one run at a time across sessions (ORT WebGPU: "Session mismatch")');
          await new Promise(resolve => setTimeout(resolve, slow));
          const out = new Float32Array(SIGLIP_MODEL.dims).fill(0.01);
          if (vision) {
            const input = feeds.pixel_values, plane = 224 * 224, mean = ch => input.data.subarray(ch * plane, (ch + 1) * plane).reduce((sum, value) => sum + value, 0) / plane;
            log.push({ run: 'vision', dims: input.dims, type: input.type });
            out[0] = 1 + mean(0); out[1] = 1 + mean(2);
          } else {
            const ids = feeds.input_ids;
            log.push({ run: 'text', dims: ids.dims, type: ids.type, ids: Array.from(ids.data.slice(0, 6), Number), mask: feeds.attention_mask && Array.from(feeds.attention_mask.data.slice(0, 2), Number) });
            const asked = Array.from(ids.data, Number);
            out[0] = asked.includes(id('▁red')) ? 2 : 0; out[1] = asked.includes(id('▁blue')) ? 2 : 0;
          }
          running--;
          return { last_hidden_state: { data: new Float32Array(4), dispose() {} }, pooler_output: { data: out, dispose() { log.push('disposed'); } } };
        },
        async release() { log.push(`released ${name}`); },
      };
    },
  };
  return { ort: { Tensor, InferenceSession }, log };
}
const solid = rgb => { const data = new Uint8ClampedArray(16 * 4); for (let i = 0; i < 16; i++) data.set([...rgb, 255], i * 4); return { width: 4, height: 4, data }; };

test('createAssetEmbedder downloads nothing until asked, then verifies and runs each half on its own', async () => {
  const hub = pinnedHub(), { ort, log } = fakeOrt({ mask: true }), events = [], caches = memoryCaches();
  const embedder = createAssetEmbedder({ ort, gpu: true, fetch: hub.fetch, subtle: hub.subtle, caches, onProgress: event => events.push(event) });
  assert.deepEqual(hub.calls, [], 'lazy');
  assert.equal(embedder.index, SIGLIP_MODEL.index); assert.equal(embedder.ready('vision'), false);
  assert.deepEqual(await isAssetEmbedderCached({ gpu: true, caches }), { vision: false, text: false });
  const red = await embedder.embedImage(solid([220, 20, 20])), blue = await embedder.embedImage(solid([20, 20, 220]));
  assert.deepEqual(hub.calls, ['vision_model_q4f16.onnx'], 'only the picture half downloads');
  assert.deepEqual(log[0], { create: 'vision-q4f16', on: 'webgpu' });
  assert.deepEqual(log[1], { run: 'vision', dims: [1, 3, 224, 224], type: 'float32' });
  assert.ok(red instanceof Float32Array && red.length === 768);
  assert.ok(Math.abs(red.reduce((sum, value) => sum + value * value, 0) - 1) < 1e-5, 'unit length');
  assert.ok(embedder.ready('vision') && !embedder.ready('text'));
  assert.ok(events.every(event => event.part === 'vision' && event.model === SIGLIP_MODEL.id) && events.some(event => event.stage === 'verify'));
  assert.deepEqual(await isAssetEmbedderCached({ gpu: true, caches }), { vision: true, text: false });

  const query = await embedder.embedText('Red!');
  assert.deepEqual(hub.calls.slice(1), ['tokenizer.json', 'text_model_quantized.onnx']);
  const run = log.find(entry => entry.run === 'text');
  assert.deepEqual(run.dims, [1, 64]); assert.equal(run.type, 'int64');
  assert.deepEqual(run.ids, [id('▁a'), id('▁photo'), id('▁of'), id('▁red'), 1, 1], 'written into "a photo of {}"');
  assert.deepEqual(run.mask, [1, 1], 'padding is attended, as SigLIP was trained');
  assert.equal(embedder.plan.text.device, 'wasm');

  const index = createAssetIndex({ model: embedder.index });
  index.add({ id: 'red', vector: red }); index.add({ id: 'blue', vector: blue });
  assert.equal(index.search('red', { vector: query }).results[0].id, 'red');
  assert.equal(index.search('blue', { vector: await embedder.embedText('blue') }).results[0].id, 'blue');
  await assert.rejects(embedder.embedText('  '), RangeError);
  await embedder.dispose();
  assert.ok(log.includes('released vision-q4f16') && log.includes('released text-q8'));
  await assert.rejects(embedder.embedImage(solid([0, 0, 0])), error => error instanceof AssetEmbedderError && error.code === 'closed');
});

test('a half that cannot start on WebGPU moves to WebAssembly once; bad files and missing runtimes fail clearly', async () => {
  {
    const hub = pinnedHub(), { ort, log } = fakeOrt({ failGpu: true });
    const embedder = createAssetEmbedder({ ort, gpu: true, fetch: hub.fetch, subtle: hub.subtle, caches: null });
    await embedder.prepare('vision');
    assert.deepEqual(log.slice(0, 2), [{ create: 'vision-q4f16', on: 'webgpu' }, { create: 'vision-q8', on: 'wasm' }]);
    assert.deepEqual([embedder.plan.vision.device, embedder.plan.vision.dtype], ['wasm', 'q8']);
    assert.equal(embedder.ready('vision'), true);
    await embedder.dispose();
  }
  {
    const hub = pinnedHub(), { ort } = fakeOrt({ failGpu: true });
    const embedder = createAssetEmbedder({ ort, vision: { device: 'webgpu' }, fetch: hub.fetch, subtle: hub.subtle, caches: null });
    await assert.rejects(embedder.prepare('vision'), error => error instanceof AssetEmbedderError && error.code === 'load-failed' && error.cause.message === 'no adapter');
    assert.equal(embedder.ready('vision'), false);
  }
  {
    const hub = pinnedHub(), { ort } = fakeOrt();
    const embedder = createAssetEmbedder({ ort, gpu: false, fetch: hub.fetch, subtle: { digest: async () => new ArrayBuffer(32) }, caches: null });
    await assert.rejects(embedder.prepare('vision'), error => error instanceof AssetEmbedderError && error.code === 'unverified-model' && /search model|checksum/.test(error.message));
  }
  {
    const { ort } = fakeOrt();
    const embedder = createAssetEmbedder({ ort, gpu: false, fetch: async () => new Response('gone', { status: 503 }), caches: null });
    await assert.rejects(embedder.prepare('text'), error => error instanceof AssetEmbedderError && error.code === 'download-failed' && /search model/.test(error.message));
    await assert.rejects(embedder.prepare('audio'), RangeError);
  }
  assert.throws(() => createAssetEmbedder({}), error => error instanceof AssetEmbedderError && error.code === 'runtime-missing');
  assert.throws(() => createAssetEmbedder({ ort: fakeOrt().ort, template: 'a photo' }), /template/);
});

test('concurrent pictures and searches queue on one engine', async () => {
  const hub = pinnedHub(), { ort, log } = fakeOrt({ slow: 5 });
  const embedder = createAssetEmbedder({ ort, gpu: true, fetch: hub.fetch, subtle: hub.subtle, caches: null });
  const vectors = await Promise.all([solid([200, 0, 0]), solid([0, 0, 200]), solid([90, 90, 90])].map(image => embedder.embedImage(image)));
  assert.equal(vectors.length, 3); assert.equal(log.filter(entry => entry.run === 'vision').length, 3);
  assert.equal(log.filter(entry => entry.create).length, 1, 'the half loads once');
  // A search while pictures are still being read waits for them instead of overlapping.
  await embedder.prepare('text');
  const [, words] = await Promise.all([embedder.embedImage(solid([10, 200, 10])), embedder.embedText('red'), embedder.embedImage(solid([0, 0, 0]))]);
  assert.equal(words.length, 768);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(embedder.embedImage(solid([1, 2, 3]), { signal: controller.signal }), { name: 'AbortError' });
  await embedder.dispose();
});
