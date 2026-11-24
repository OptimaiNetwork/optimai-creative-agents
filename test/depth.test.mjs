import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import test from 'node:test';
import {
  DEPTH_CAMERAS, DEPTH_MODEL, DEPTH_ORT_RUNTIME, DEPTH_RUNTIME, depthInputSize, isDepthModelCached, isModelFileCached, depthInputTensor, DepthError, createDepthEstimator, createDepthMotionClip, createParallaxRenderer, createVerifiedModelCache,
  depthCameraAt, depthModelFile, depthModelPlan, depthModelUrl, depthMotionSettings, depthOverscan, depthToPixels, guessDepth, normalizeDepth, shrinkPixels, verifyDepthFile,
} from '../src/depth.mjs';

// A test scene: a red disc (near) in front of blue/green stripes (far), with a depth map that says so.
const W = 160, H = 96;
function scene() {
  const data = new Uint8ClampedArray(W * H * 4), depth = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, near = Math.hypot(x - 80, y - 48) < 22;
    depth[i] = near ? 1 : 0.1;
    const stripe = (x >> 3) & 1;
    data.set(near ? [230, 40, 30, 255] : stripe ? [30, 160, 90, 255] : [30, 60, 200, 255], i * 4);
  }
  return { image: { width: W, height: H, data }, depth: { width: W, height: H, data: depth, source: 'host' } };
}
const discCentre = (pixels, width, height) => {
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const i = (y * width + x) * 4; if (pixels[i] > 150 && pixels[i + 2] < 100) { sx += x; sy += y; n++; } }
  return { x: sx / n, y: sy / n, n };
};

// A fake Hub: the bytes of each pinned file are made up, so the test swaps in a model whose hashes match them.
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const gitSha1 = bytes => createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex');
function fakeModel() {
  const weights = Buffer.from('fake onnx weights '.repeat(64)), config = Buffer.from('{"model_type":"depth_anything"}'), pre = Buffer.from('{"size":{"height":518,"width":518}}');
  const model = {
    ...DEPTH_MODEL,
    config: { 'config.json': { bytes: config.length, gitSha1: gitSha1(config) }, 'preprocessor_config.json': { bytes: pre.length, gitSha1: gitSha1(pre) } },
    weights: { ...DEPTH_MODEL.weights, q8: { file: 'onnx/model_quantized.onnx', bytes: weights.length, sha256: sha256(weights) } },
  };
  const files = { 'config.json': config, 'preprocessor_config.json': pre, 'onnx/model_quantized.onnx': weights };
  return { model, files };
}
function hub(files, { tamper = false, chunk = 100 } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const path = url.split(`/resolve/${DEPTH_MODEL.revision}/`)[1];
    if (!files[path]) return new Response('missing', { status: 404 });
    const bytes = Uint8Array.from(files[path]); if (tamper) bytes[0] ^= 1;
    let at = 0;
    return new Response(new ReadableStream({ pull(controller) { if (at >= bytes.length) return controller.close(); controller.enqueue(bytes.slice(at, at += chunk)); } }), { headers: { 'content-length': String(bytes.length) } });
  };
  return { fetch, calls };
}
function memoryCaches() {
  const stores = new Map();
  return { stores, async open(name) { if (!stores.has(name)) { const map = new Map(); stores.set(name, { map, async match(key) { const bytes = map.get(key); return bytes && new Response(bytes.slice()); }, async put(key, response) { map.set(key, new Uint8Array(await response.arrayBuffer())); }, async delete(key) { return map.delete(key); } }); } return stores.get(name); } };
}

test('the pinned model is the Apache-2.0 small size at one commit, with every weight hashed', () => {
  assert.equal(DEPTH_MODEL.license, 'Apache-2.0');
  assert.match(DEPTH_MODEL.repo, /-small$/);
  assert.match(DEPTH_MODEL.revision, /^[0-9a-f]{40}$/);
  for (const spec of Object.values(DEPTH_MODEL.weights)) { assert.match(spec.sha256, /^[0-9a-f]{64}$/); assert.ok(spec.bytes > 1e7 && spec.bytes < 1.1e8); assert.match(spec.file, /^onnx\/.+\.onnx$/); }
  for (const spec of Object.values(DEPTH_MODEL.config)) assert.match(spec.gitSha1, /^[0-9a-f]{40}$/);
  assert.deepEqual({ ...DEPTH_RUNTIME }, { package: '@huggingface/transformers', version: '4.3.2', license: 'Apache-2.0' });
  assert.ok(Object.isFrozen(DEPTH_MODEL.weights.fp16));
});

test('Hub URLs are classified: pinned files, other revisions, unlisted weights and unrelated URLs', () => {
  assert.equal(depthModelUrl('onnx/model_fp16.onnx'), `https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/${DEPTH_MODEL.revision}/onnx/model_fp16.onnx`);
  assert.deepEqual(depthModelFile(depthModelUrl('onnx/model_fp16.onnx')), { kind: 'weights', path: 'onnx/model_fp16.onnx', spec: DEPTH_MODEL.weights.fp16, pinned: true });
  assert.equal(depthModelFile(depthModelUrl('config.json')).kind, 'config');
  const main = depthModelFile('https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_fp16.onnx');
  assert.equal(main.kind, 'weights'); assert.equal(main.pinned, false);
  assert.deepEqual(depthModelFile(depthModelUrl('onnx/model_extra.onnx_data')), { kind: 'weights', path: 'onnx/model_extra.onnx_data', spec: null, pinned: true });
  assert.equal(depthModelFile(depthModelUrl('README.md')).kind, 'other');
  for (const url of ['https://huggingface.co/someone/else/resolve/main/model.onnx', 'https://example.com/onnx-community/depth-anything-v2-small/resolve/x/y', 'not a url', undefined]) assert.equal(depthModelFile(url), null);
});

test('verifyDepthFile checks SHA-256 for weights and the Git blob id for config, and rejects a wrong size', async () => {
  const { model, files } = fakeModel(), subtle = webcrypto.subtle;
  assert.equal(await verifyDepthFile(files['onnx/model_quantized.onnx'], model.weights.q8, { subtle }), true);
  assert.equal(await verifyDepthFile(files['config.json'], model.config['config.json'], { subtle }), true);
  const bad = Uint8Array.from(files['onnx/model_quantized.onnx']); bad[3] ^= 1;
  assert.equal(await verifyDepthFile(bad, model.weights.q8, { subtle }), false);
  assert.equal(await verifyDepthFile(bad.slice(1), model.weights.q8, { subtle }), false);
  await assert.rejects(verifyDepthFile(files['onnx/model_quantized.onnx'], model.weights.q8, { subtle: null }), { code: 'unsupported-browser' });
});

test('the verified cache downloads pinned files once, keeps them by hash and refuses anything unverified', async () => {
  const { model, files } = fakeModel(), { fetch, calls } = hub(files), caches = memoryCaches(), events = [];
  const cache = createVerifiedModelCache({ model, fetch, caches, subtle: webcrypto.subtle, onProgress: event => events.push(event) });
  const url = depthModelUrl('onnx/model_quantized.onnx', model);
  const [a, b] = await Promise.all([cache.match(url), cache.match(new Request(url))]);
  assert.deepEqual(new Uint8Array(await a.arrayBuffer()), Uint8Array.from(files['onnx/model_quantized.onnx']));
  assert.equal((await b.arrayBuffer()).byteLength, files['onnx/model_quantized.onnx'].length);
  assert.equal(calls.length, 1, 'two readers share one download');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.ok(events.some(event => event.stage === 'download' && event.loaded < event.total) && events.at(-1).stage === 'verify');
  assert.equal((await cache.match(depthModelUrl('config.json', model))).headers.get('content-type'), 'application/json');
  // A second cache (a new page) reads Cache Storage instead of the network.
  const again = createVerifiedModelCache({ model, fetch, caches, subtle: webcrypto.subtle, onProgress: event => events.push(event) });
  await again.match(url);
  assert.equal(calls.length, 2, 'only the config fetch was added');
  assert.equal(events.at(-1).cached, true);
  // Weights from another revision, or not on the list, never download.
  await assert.rejects(cache.match(url.replace(model.revision, 'main')), { code: 'unverified-model' });
  await assert.rejects(cache.match(depthModelUrl('onnx/other.onnx', model)), { code: 'unverified-model' });
  assert.equal(calls.length, 2);
  // Other URLs go to the host's cache, or miss.
  const host = { seen: [], async match(request) { this.seen.push(request); return 'host'; }, async put(request) { this.seen.push(`put ${request}`); } };
  const chained = createVerifiedModelCache({ model, fetch, caches, subtle: webcrypto.subtle, fallback: host });
  assert.equal(await chained.match('https://huggingface.co/other/model/resolve/main/model.onnx'), 'host');
  await chained.put(url, new Response('x')); await chained.put('https://example.com/x', new Response('x'));
  assert.deepEqual(host.seen, ['https://huggingface.co/other/model/resolve/main/model.onnx', 'put https://example.com/x']);
  assert.equal(await cache.match('https://example.com/x'), undefined);
});

test('tampered, oversized, failed and cancelled downloads never reach the runtime', async () => {
  const { model, files } = fakeModel(), url = depthModelUrl('onnx/model_quantized.onnx', model);
  const tampered = createVerifiedModelCache({ model, fetch: hub(files, { tamper: true }).fetch, caches: memoryCaches(), subtle: webcrypto.subtle });
  await assert.rejects(tampered.match(url), error => error instanceof DepthError && error.code === 'unverified-model');
  const big = { ...files, 'onnx/model_quantized.onnx': Buffer.concat([files['onnx/model_quantized.onnx'], Buffer.from('x')]) };
  await assert.rejects(createVerifiedModelCache({ model, fetch: hub(big).fetch, subtle: webcrypto.subtle }).match(url), { code: 'unverified-model' });
  await assert.rejects(createVerifiedModelCache({ model, fetch: hub({}).fetch, subtle: webcrypto.subtle }).match(url), { code: 'download-failed' });
  await assert.rejects(createVerifiedModelCache({ model, label: 'search model', fetch: hub({}).fetch, subtle: webcrypto.subtle }).match(url), /The search model could not be downloaded/);
  await assert.rejects(createVerifiedModelCache({ model, fetch: hub({}).fetch, subtle: webcrypto.subtle }).match(url), /The model could not be downloaded/, 'another model is not called a depth model');
  await assert.rejects(createVerifiedModelCache({ model, fetch: async () => { throw new TypeError('offline'); }, subtle: webcrypto.subtle }).match(url), error => error.code === 'download-failed' && error.cause.message === 'offline');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createVerifiedModelCache({ model, fetch: hub(files).fetch, subtle: webcrypto.subtle, signal: controller.signal }).match(url), { name: 'AbortError' });
  // A cached copy that no longer matches is dropped and fetched again.
  const caches = memoryCaches(), { fetch, calls } = hub(files);
  await createVerifiedModelCache({ model, fetch, caches, subtle: webcrypto.subtle }).match(url);
  const [store] = caches.stores.values(); for (const bytes of store.map.values()) bytes[0] ^= 1;
  await createVerifiedModelCache({ model, fetch, caches, subtle: webcrypto.subtle }).match(url);
  assert.equal(calls.length, 2);
});

test('isDepthModelCached looks for the planned weights by hash and never throws', async () => {
  const caches = memoryCaches();
  assert.equal(await isDepthModelCached({ gpu: false, caches }), false);
  const store = await caches.open('optimai-depth-models-v1');
  await store.put(`http://localhost/__optimai_depth_models__/${DEPTH_MODEL.weights.q8.sha256}`, new Response('x'));
  assert.equal(await isDepthModelCached({ gpu: false, caches }), true);
  assert.equal(await isDepthModelCached({ gpu: true, caches }), false, 'WebGPU plans the fp16 file');
  assert.equal(await isDepthModelCached({ caches: { open: async () => { throw new Error('blocked'); } } }), false);
  assert.equal(await isDepthModelCached({ caches: undefined, gpu: false }), false);
  assert.equal(await isModelFileCached(DEPTH_MODEL.weights.q8, { caches }), true, 'any pinned file can be checked');
  assert.equal(await isModelFileCached({ bytes: 1 }, { caches }), false);
});

test('depthModelPlan picks fp16 on WebGPU and q8 on WebAssembly', () => {
  assert.deepEqual({ ...depthModelPlan({ gpu: true }) }, { device: 'webgpu', dtype: 'fp16', file: 'onnx/model_fp16.onnx', bytes: DEPTH_MODEL.weights.fp16.bytes + 499 });
  assert.equal(depthModelPlan({ gpu: false }).dtype, 'q8');
  assert.equal(depthModelPlan({ device: 'wasm', dtype: 'q4f16' }).file, 'onnx/model_q4f16.onnx');
  assert.throws(() => depthModelPlan({ device: 'cuda' }), RangeError);
  assert.throws(() => depthModelPlan({ dtype: 'fp8' }), RangeError);
});

// A fake transformers.js 4.3.2 surface: env, RawImage and a pipeline that reads `files` through env.customCache.
function fakeTransformers({ output = 'depth', files = ['config.json', 'preprocessor_config.json', 'weights'] } = {}) {
  const log = [];
  class RawImage { constructor(data, width, height, channels) { Object.assign(this, { data, width, height, channels }); } }
  const env = { allowLocalModels: true, useBrowserCache: true, useCustomCache: false, customCache: null };
  async function pipeline(task, repo, options) {
    log.push({ task, repo, options });
    for (const name of files) {
      const path = name === 'weights' ? (options.dtype === 'q8' ? 'onnx/model_quantized.onnx' : 'onnx/model_fp16.onnx') : name;
      const response = await env.customCache.match(`https://huggingface.co/${repo}/resolve/${options.revision}/${path}`);
      if (!response) throw new Error(`no ${path}`);
    }
    const run = async image => {
      log.push({ image: [image.width, image.height, image.channels, image instanceof RawImage] });
      // Disparity: brighter = nearer. The disc's red channel stands in for it.
      const depth = new Uint8Array(image.width * image.height);
      for (let i = 0; i < depth.length; i++) depth[i] = image.data[i * 4] > 150 ? 220 : 30;
      return output === 'depth' ? { depth: new RawImage(depth, image.width, image.height, 1) } : [{ predicted_depth: { dims: [1, image.height, image.width], data: Float32Array.from(depth, v => v / 10) } }];
    };
    run.dispose = async () => log.push('disposed');
    return run;
  }
  return { module: { env, RawImage, pipeline }, log };
}

test('createDepthEstimator loads the pinned revision through the peer and refuses weights that do not match', async () => {
  const { files } = fakeModel(), { fetch, calls } = hub(files);
  const fake = fakeTransformers(), host = { async match() { return 'host'; }, async put() {} };
  fake.module.env.useCustomCache = true; fake.module.env.customCache = host;
  // The fake Hub serves made-up bytes under the real pinned names, so the pin rejects them before anything runs.
  await assert.rejects(createDepthEstimator({ transformers: fake.module, gpu: false, fetch, caches: memoryCaches(), subtle: webcrypto.subtle }), { code: 'unverified-model' });
  const { env } = fake.module;
  assert.deepEqual([env.allowLocalModels, env.useBrowserCache, env.useCustomCache], [false, false, true]);
  assert.deepEqual(fake.log[0], { task: 'depth-estimation', repo: DEPTH_MODEL.repo, options: { revision: DEPTH_MODEL.revision, device: 'wasm', dtype: 'q8' } });
  assert.ok(calls.length && calls.every(call => call.url.includes(`/resolve/${DEPTH_MODEL.revision}/`)));
  assert.equal(await env.customCache.match('https://example.com/other-model.json'), 'host', 'the host cache still answers its own URLs');
  assert.throws(() => { DEPTH_MODEL.weights.q8 = {}; }, TypeError, 'the pin cannot be changed at run time');
});

test('createDepthEstimator normalizes RawImage and tensor outputs, shrinks large inputs and needs the peer', async () => {
  const { image } = scene();
  for (const output of ['depth', 'tensor']) {
    // Through the module (no files requested by this fake), and through a host-built pipeline.
    const fake = fakeTransformers({ output, files: [] });
    const viaModule = await createDepthEstimator({ transformers: fake.module, gpu: true });
    assert.deepEqual([viaModule.device, viaModule.dtype], ['webgpu', 'fp16']);
    const map = await viaModule.estimate(image);
    assert.equal(map.source, 'model'); assert.equal(map.model, 'depth-anything-v2-small');
    assert.deepEqual(fake.log[1], { image: [W, H, 4, true] });
    assert.deepEqual([map.width, map.height, map.inputWidth], [W, H, W]);
    assert.ok(map.data[48 * W + 80] > 0.9 && map.data[5 * W + 5] < 0.1, 'the disc is near, the stripes far');
    await viaModule.dispose();
    await assert.rejects(viaModule.estimate(image), { code: 'closed' });
    assert.equal(fake.log.at(-1), 'disposed');
    const run = await fakeTransformers({ output, files: [] }).module.pipeline('depth-estimation', DEPTH_MODEL.repo, { revision: DEPTH_MODEL.revision, dtype: 'q8' });
    const viaHost = await createDepthEstimator({ pipeline: run });
    assert.equal(viaHost.device, 'host');
    const hosted = await viaHost.estimate(image);
    assert.equal(hosted.source, 'host'); assert.deepEqual([...hosted.data], [...map.data]);
  }
  const big = { width: 2048, height: 1024, data: new Uint8ClampedArray(2048 * 1024 * 4) }, seen = [];
  const estimator = await createDepthEstimator({ pipeline: async input => { seen.push([input.width, input.height]); return { predicted_depth: { dims: [input.height, input.width], data: new Float32Array(input.width * input.height) } }; } });
  await estimator.estimate(big);
  assert.deepEqual(seen, [[1024, 512]]);
  await assert.rejects(createDepthEstimator({}), { code: 'runtime-missing' });
  await assert.rejects(createDepthEstimator({ pipeline: async () => ({}) }).then(e => e.estimate(image)), { code: 'bad-output' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createDepthEstimator({ pipeline: async () => ({}), signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(createDepthEstimator({ pipeline: async () => ({}) }).then(e => e.estimate(image, { signal: controller.signal })), { name: 'AbortError' });
  const failing = fakeTransformers(); failing.module.pipeline = async () => { throw new Error('no backend'); };
  await assert.rejects(createDepthEstimator({ transformers: failing.module, gpu: false }), error => error.code === 'load-failed' && error.cause.message === 'no backend');
});

test('depth helpers: shrink, normalize, guess and preview', () => {
  const { image } = scene();
  const small = shrinkPixels(image, 40);
  assert.deepEqual([small.width, small.height], [40, 24]);
  assert.equal(shrinkPixels(image, 400), image);
  const n = normalizeDepth({ width: 4, height: 1, data: [10, 20, 30, 40] });
  assert.deepEqual([...n.data], [0, 1 / 3, 2 / 3, 1].map(v => Math.fround(v)));
  assert.deepEqual([...normalizeDepth({ width: 2, height: 1, data: [5, 5] }).data], [0, 0]);
  assert.equal(normalizeDepth({ width: 2, height: 1, data: [0, 1] }, { invert: true }).data[0], 1);
  const guess = guessDepth(image);
  assert.equal(guess.source, 'guess'); assert.deepEqual([guess.width, guess.height], [W, H]);
  const row = y => guess.data.slice(y * W, (y + 1) * W).reduce((a, b) => a + b) / W;
  assert.ok(row(H - 2) > row(1) + 0.3, 'lower reads nearer');
  assert.ok(guess.data.every(v => v >= 0 && v <= 1));
  const preview = depthToPixels(guess);
  assert.equal(preview.data.length, W * H * 4); assert.equal(preview.data[3], 255);
  assert.throws(() => guessDepth({ width: 2, height: 2, data: new Uint8Array(3) }), TypeError);
  assert.throws(() => shrinkPixels({ width: 5000, height: 4000, data: { length: 5000 * 4000 * 4 } }, 10), { code: 'image-too-large' });
});

test('recipe settings and camera paths: every move stays in bounds and starts where it should', () => {
  assert.deepEqual({ ...depthMotionSettings() }, { camera: 'slow push', depth: 'subtle', strength: 0.022 });
  assert.equal(depthMotionSettings({ depth: 'medium' }).strength, 0.045);
  assert.equal(depthMotionSettings({ depth: 0.03 }).depth, 'custom');
  assert.throws(() => depthMotionSettings({ camera: 'crane' }), RangeError);
  assert.throws(() => depthMotionSettings({ depth: 'huge' }), RangeError);
  for (const camera of DEPTH_CAMERAS) for (const depth of ['subtle', 'medium']) {
    const settings = depthMotionSettings({ camera, depth }), over = depthOverscan(settings);
    for (let t = 0; t <= 1; t += 0.05) {
      const view = depthCameraAt(settings, t);
      assert.ok(Math.abs(view.x) <= settings.strength * 1.01 && Math.abs(view.y) <= settings.strength && view.zoom >= 0 && view.zoom <= settings.strength * 2.5, `${camera} ${t}`);
      // The far edge moves at most |x|·focus of the short side; overscan covers it on a square frame.
      assert.ok(1 + 2 * Math.abs(view.x) * Math.max(view.focus, 1 - view.focus) <= over, `${camera} needs more overscan`);
    }
  }
  assert.deepEqual(depthCameraAt({ camera: 'slow push' }, 0), { x: 0, y: -0, zoom: 0, focus: 0 });
  assert.ok(depthCameraAt({ camera: 'tracking' }, 0).x < 0 && depthCameraAt({ camera: 'tracking' }, 1).x > 0);
  assert.equal(depthCameraAt({ camera: 'locked' }, 0).zoom, 0);
});

test('the parallax renderer moves near layers more than far ones, and a still view is the overscanned photo', () => {
  const { image, depth } = scene(), renderer = createParallaxRenderer(image, depth, { overscan: 1 });
  const still = renderer.render({ x: 0, y: 0, zoom: 0, focus: 0.5 });
  let diff = 0; for (let i = 0; i < still.length; i++) diff = Math.max(diff, Math.abs(still[i] - image.data[i]));
  assert.ok(diff <= 1, 'no camera move gives the photo back');
  const base = discCentre(still, W, H), shift = 0.05;
  const right = renderer.render({ x: shift, y: 0, zoom: 0, focus: 0.1 }), moved = discCentre(right, W, H);
  const expected = shift * H * (renderer.depth[48 * W + 80] - 0.1);
  assert.ok(Math.abs(moved.x - base.x - expected) < 1.2, `disc moved ${moved.x - base.x}, expected ${expected}`);
  assert.ok(Math.abs(moved.y - base.y) < 0.5);
  // The far stripes sit at the focus depth, so they do not move.
  for (const x of [4, 12, 150]) assert.deepEqual([...right.slice((2 * W + x) * 4, (2 * W + x) * 4 + 4)], [...image.data.slice((2 * W + x) * 4, (2 * W + x) * 4 + 4)]);
  // A hard depth edge leaves no ghost copy behind: every red pixel is inside the moved disc, and the disc keeps its size.
  for (const view of [{ x: 0.08, y: 0, zoom: 0, focus: 0.1 }, { x: -0.06, y: 0.04, zoom: 0.1, focus: 0.5 }]) {
    const frame = renderer.render(view), centre = discCentre(frame, W, H);
    let stray = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (frame[i] > 150 && frame[i + 2] < 100 && Math.hypot(x - centre.x, y - centre.y) > 26) stray++; }
    assert.equal(stray, 0, `ghost pixels for ${JSON.stringify(view)}`);
    assert.ok(Math.abs(centre.n - base.n) / base.n < 0.2, `disc area ${centre.n} vs ${base.n}`);
  }
  // A push grows the near disc and keeps it whole (the grown depth keeps its edge with it).
  const push = renderer.render({ x: 0, y: 0, zoom: 0.3, focus: 0 });
  assert.ok(discCentre(push, W, H).n > base.n * 1.3);
  const into = new Uint8Array(W * H * 4);
  assert.equal(renderer.render({ x: 0.01 }, into), into);
  assert.throws(() => renderer.render({}, new Uint8Array(4)), TypeError);
  assert.throws(() => createParallaxRenderer(image, depth, { overscan: 3 }), RangeError);
  assert.throws(() => createParallaxRenderer(image, { width: 2, height: 2, data: new Float32Array(3) }), TypeError);
  // Any depth size is resampled to the photo.
  assert.equal(createParallaxRenderer(image, { width: 16, height: 8, data: new Float32Array(128).fill(0.5) }).depth.length, W * H);
});

test('a depth motion clip draws each frame of the recipe move onto a canvas', () => {
  const { image, depth } = scene(), puts = [];
  const canvas = { width: 0, height: 0, getContext: () => ({ createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), putImageData: frame => puts.push(discCentre(frame.data, W, H).x) }) };
  const clip = createDepthMotionClip({ image, depth, values: { camera: 'tracking', depth: 'medium' }, canvas });
  assert.deepEqual([clip.width, clip.height, clip.seconds, clip.camera, clip.depth, clip.source, canvas.width], [W, H, 4, 'tracking', 'medium', 'host', W]);
  for (let i = 0; i < 5; i++) clip.draw(i, 5);
  assert.ok(puts.every((x, i) => i === 0 || x > puts[i - 1]), `the disc tracks across: ${puts.map(x => x.toFixed(1))}`);
  assert.ok(clip.view(0, 5).x < 0 && clip.view(4, 5).x > 0);
  assert.throws(() => clip.draw(5, 5), RangeError);
  clip.close();
  assert.throws(() => clip.draw(0, 5), { code: 'closed' });
  assert.equal(canvas.width, 0);
  assert.throws(() => createDepthMotionClip({ image, depth, seconds: 60, canvas }), RangeError);
  assert.throws(() => createDepthMotionClip({ image, depth }), { code: 'unsupported-browser' });
  assert.equal(createDepthMotionClip({ image, depth: guessDepth(image), canvas }).source, 'guess');
  // Resolved settings pass straight through, custom strengths included.
  assert.equal(createDepthMotionClip({ image, depth, values: depthMotionSettings({ camera: 'orbit', depth: 0.03 }), canvas }).depth, 'custom');
});

test('depthInputSize and depthInputTensor follow the pinned preprocessor', () => {
  assert.deepEqual(depthInputSize(1920, 1080), { width: 924, height: 518 });
  assert.deepEqual(depthInputSize(1080, 1920), { width: 518, height: 924 });
  assert.deepEqual(depthInputSize(320, 240), { width: 518, height: 392 });
  assert.deepEqual(depthInputSize(518, 518), { width: 518, height: 518 });
  assert.throws(() => depthInputSize(0, 10), RangeError);
  const { image } = scene(), input = depthInputTensor(image), plane = input.width * input.height;
  assert.deepEqual(input.dims, [1, 3, input.height, input.width]);
  assert.deepEqual([input.width, input.height], [518, 308]);
  const red = (230 / 255 - 0.485) / 0.229, centre = Math.round(input.height / 2) * input.width + Math.round(input.width / 2);
  assert.ok(Math.abs(input.data[centre] - red) < 1e-3, 'the disc centre is normalized red');
  assert.ok(Math.abs(input.data[plane * 2 + centre] - (30 / 255 - 0.406) / 0.225) < 1e-3);
  assert.equal(DEPTH_ORT_RUNTIME.version, '1.31.1');
});

// Real-size weights of zeros, and a crypto stand-in that reports the pinned hash for a file of the pinned size, so the
// ONNX Runtime path can be followed end to end (verification itself is tested above with real hashes).
function pinnedHub() {
  const calls = [];
  const fetch = async url => {
    calls.push(url);
    const spec = Object.values(DEPTH_MODEL.weights).find(item => url.endsWith(`/${item.file}`));
    let left = spec.bytes;
    return new Response(new ReadableStream({ pull(controller) { if (!left) return controller.close(); const size = Math.min(left, 4 << 20); left -= size; controller.enqueue(new Uint8Array(size)); } }), { headers: { 'content-length': String(spec.bytes) } });
  };
  const subtle = { async digest(algorithm, data) { const spec = Object.values(DEPTH_MODEL.weights).find(item => item.bytes === data.byteLength); return Uint8Array.from(spec.sha256.match(/../g), byte => parseInt(byte, 16)).buffer; } };
  return { fetch, subtle, calls };
}
function fakeOrt({ failGpu = false } = {}) {
  const log = [];
  class Tensor { constructor(type, data, dims) { Object.assign(this, { type, data, dims }); } }
  const InferenceSession = {
    async create(bytes, options) {
      log.push({ create: bytes.byteLength, providers: options.executionProviders });
      assert.equal(options.logSeverityLevel, 3, 'ORT logs errors only');
      if (failGpu && options.executionProviders[0] === 'webgpu') throw new Error('no adapter');
      return {
        inputNames: ['pixel_values'], outputNames: ['predicted_depth'],
        async run(feeds) {
          const input = feeds.pixel_values, [, , h, w] = input.dims;
          log.push({ run: input.dims, tensor: input instanceof Tensor && input.type === 'float32' });
          const data = new Float32Array(w * h); for (let i = 0; i < data.length; i++) data[i] = input.data[i] > 0 ? 9 : 1;
          return { predicted_depth: { dims: [1, h, w], data, dispose() { log.push('tensor disposed'); } } };
        },
        async release() { log.push('released'); },
      };
    },
  };
  return { ort: { Tensor, InferenceSession }, log };
}

test('createDepthEstimator runs verified weights on ONNX Runtime and falls back from WebGPU to WebAssembly once', async () => {
  const { image } = scene();
  {
    const hub = pinnedHub(), { ort, log } = fakeOrt(), events = [];
    const estimator = await createDepthEstimator({ ort, gpu: false, fetch: hub.fetch, subtle: hub.subtle, caches: null, onProgress: event => events.push(event) });
    assert.deepEqual([estimator.device, estimator.dtype], ['wasm', 'q8']);
    assert.deepEqual(hub.calls, [depthModelUrl('onnx/model_quantized.onnx')]);
    assert.deepEqual(log[0], { create: DEPTH_MODEL.weights.q8.bytes, providers: ['wasm'] });
    assert.ok(events.some(event => event.stage === 'download') && events.at(-1).stage === 'verify' && events.at(-1).model === 'depth-anything-v2-small');
    const map = await estimator.estimate(image);
    assert.deepEqual(log[1], { run: [1, 3, 308, 518], tensor: true });
    assert.equal(log[2], 'tensor disposed');
    assert.deepEqual([map.width, map.height, map.source], [518, 308, 'model']);
    assert.ok(map.data[154 * 518 + 259] > 0.9 && map.data[5 * 518 + 5] < 0.1);
    await estimator.dispose();
    assert.equal(log.at(-1), 'released');
  }
  {
    const hub = pinnedHub(), { ort, log } = fakeOrt({ failGpu: true });
    const estimator = await createDepthEstimator({ ort, gpu: true, fetch: hub.fetch, subtle: hub.subtle, caches: null });
    assert.deepEqual([estimator.device, estimator.dtype], ['wasm', 'q8']);
    assert.deepEqual(log.map(entry => entry.providers?.[0]), ['webgpu', 'wasm']);
    assert.deepEqual(hub.calls.map(url => url.split('/').at(-1)), ['model_fp16.onnx', 'model_quantized.onnx']);
    // Asking for WebGPU explicitly means no silent fallback.
    await assert.rejects(createDepthEstimator({ ort: fakeOrt({ failGpu: true }).ort, device: 'webgpu', fetch: pinnedHub().fetch, subtle: pinnedHub().subtle, caches: null }), error => error.code === 'load-failed' && error.cause.message === 'no adapter');
  }
  // Unverified bytes never reach ONNX Runtime.
  const { ort, log } = fakeOrt(), hub = pinnedHub();
  await assert.rejects(createDepthEstimator({ ort, gpu: false, fetch: hub.fetch, subtle: webcrypto.subtle, caches: null }), { code: 'unverified-model' });
  assert.equal(log.length, 0);
  await assert.rejects(createDepthEstimator({ ort: {} }), { code: 'runtime-missing' });
});
