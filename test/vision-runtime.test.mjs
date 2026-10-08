import test from 'node:test';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { VISION_MODELS, getVisionAnalysisSize, normalizeVisionValues } from '../src/vision-runtime.mjs';
import { executeVisionTask, personMaskAlpha } from '../src/vision-processor.mjs';

let instance = 0;
const fresh = () => import(`../src/vision-runtime.mjs?test=${++instance}`);
function globals(values) {
  const old = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  return () => { for (const [key, descriptor] of old) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; };
}
const buffer = operation => new Uint8Array(VISION_MODELS[operation].bytes).buffer;
const hashCrypto = operation => ({ subtle: { digest: async () => Uint8Array.from(VISION_MODELS[operation].sha256.match(/../g), h => parseInt(h, 16)).buffer } });
const cache = bytes => ({ open: async () => ({ match: async () => bytes ? new Response(bytes) : null, delete: async () => true, put: async () => {} }) });
const pngFile = () => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'portrait.png', { type: 'image/png' });

test('reviewed models use fixed official version URLs, exact sizes and SHA256', () => {
  assert.equal(Object.keys(VISION_MODELS).length, 3);
  for (const m of Object.values(VISION_MODELS)) { assert.equal(new URL(m.url).origin, 'https://storage.googleapis.com'); assert.match(m.url, /\/float16\/1\//); assert.match(m.sha256, /^[a-f0-9]{64}$/); assert.ok(m.bytes > 200000 && m.bytes < 8000000); assert.ok(Object.isFrozen(m)); }
});
test('vision analysis dimensions preserve aspect and reject unbounded pixels', () => {
  assert.deepEqual(getVisionAnalysisSize(4096, 2048), { width: 1600, height: 800 });
  assert.deepEqual(getVisionAnalysisSize(100, 200), { width: 100, height: 200 });
  for (const [w, h] of [[0, 1], [1.5, 2], [4097, 4], [4096, 4096], [NaN, 2]]) assert.throws(() => getVisionAnalysisSize(w, h), /4096/);
});
test('cutout controls are bounded, ignore arbitrary properties and disallow external backgrounds', () => {
  assert.deepEqual(normalizeVisionValues('person-cutout'), { background: 'transparent', threshold: 0.5, softness: 0.12 });
  assert.deepEqual(normalizeVisionValues('pose-reference', { url: 'https://example.com' }), {});
  for (const values of [{ background: 'url(https://example.com)' }, { threshold: 2 }, { softness: 0 }, { background: '#abc' }]) assert.throws(() => normalizeVisionValues('person-cutout', values));
  assert.throws(() => normalizeVisionValues('unknown'));
});
test('model status is local and never starts a network request', async () => {
  const restore = globals({ caches: cache(null), fetch: () => { throw Error('must not fetch'); } });
  try { const runtime = await fresh(); assert.equal((await runtime.getVisionModelStatus('person-cutout')).ready, false); } finally { restore(); }
});
test('explicit model download verifies fixed URL/hash, stores weights, reports progress', async () => {
  const restore = globals({ crypto: hashCrypto('person-cutout'), caches: cache(null) });
  const calls = [], progress = [];
  try {
    const runtime = await fresh();
    const result = await runtime.downloadVisionModel('person-cutout', { fetchImpl: async (url, options) => { calls.push({ url, options }); return new Response(buffer('person-cutout')); }, onProgress: p => progress.push(p.phase) });
    assert.equal(result.ready, true); assert.equal(calls.length, 1); assert.equal(calls[0].url, VISION_MODELS['person-cutout'].url); assert.equal(calls[0].options.redirect, 'error'); assert.equal(calls[0].options.credentials, 'omit'); assert.ok(progress.includes('verify')); assert.equal(progress.at(-1), 'ready');
    await runtime.downloadVisionModel('person-cutout', { fetchImpl: async () => { throw Error('should reuse local weights'); } });
  } finally { restore(); }
});
test('wrong size/hash downloads and redirect responses are rejected without caching', async () => {
  let writes = 0;
  const restore = globals({ crypto: { subtle: { digest: async () => new Uint8Array(32).buffer } }, caches: { open: async () => ({ match: async () => null, put: async () => { writes++; } }) } });
  try {
    for (const response of [new Response(new Uint8Array(20)), new Response(buffer('person-cutout')), { ok: true, redirected: true }]) {
      const runtime = await fresh(); await assert.rejects(runtime.downloadVisionModel('person-cutout', { fetchImpl: async () => response }), e => ['invalid-model', 'download-failed'].includes(e.code));
    }
    assert.equal(writes, 0);
  } finally { restore(); }
});
test('cancelled downloads never fetch or write a model', async () => {
  const runtime = await fresh(), abort = new AbortController(); abort.abort();
  await assert.rejects(runtime.downloadVisionModel('person-cutout', { signal: abort.signal, fetchImpl: async () => { throw Error('must not fetch'); } }), { name: 'AbortError' });
});
test('worker inference refuses missing weights or a remote WASM origin', async () => {
  const restore = globals({ location: { origin: 'https://studio.example' }, caches: cache(null) });
  try {
    const runtime = await fresh(), workerFactory = () => { throw Error('must not start'); };
    await assert.rejects(runtime.runBrowserVision('pose-reference', pngFile(), {}, { workerFactory, wasmBaseUrl: '/vendor/vision' }), { code: 'model-missing' });
    await assert.rejects(runtime.runBrowserVision('pose-reference', pngFile(), {}, { workerFactory, wasmBaseUrl: 'https://other.example/vision' }), { code: 'invalid-runtime' });
  } finally { restore(); }
});
function workerFixture(onPost) {
  const counts = { closed: 0, terminated: 0, posts: 0 };
  class WorkerMock { terminate() { counts.terminated++; } postMessage(data) { counts.posts++; onPost(this, data); } }
  const restore = globals({ File, Worker: WorkerMock, OffscreenCanvas: class {}, crypto: hashCrypto('person-cutout'), caches: cache(buffer('person-cutout')), location: { origin: 'http://localhost' }, createImageBitmap: async () => ({ width: 800, height: 600, close() { counts.closed++; } }) });
  return { restore, counts, workerFactory: () => new WorkerMock() };
}
test('successful worker output is bounded and the worker is released', async () => {
  const f = workerFixture(worker => queueMicrotask(() => worker.onmessage({ data: { type: 'result', result: { blob: new Blob(['png'], { type: 'image/png' }), width: 800, height: 600, analysis: { kind: 'person-segmentation' } } } })));
  try { const runtime = await fresh(); const output = await runtime.runBrowserVision('person-cutout', pngFile(), {}, { workerFactory: f.workerFactory, wasmBaseUrl: '/vendor/vision' }); assert.equal(output.provider, 'mediapipe'); assert.equal(output.originalSize.width, 800); assert.equal(f.counts.terminated, 1); assert.equal(f.counts.posts, 1); } finally { f.restore(); }
});
test('cancellation terminates in-flight worker inference', async () => {
  const abort = new AbortController(); const f = workerFixture(() => queueMicrotask(() => abort.abort()));
  try { const runtime = await fresh(); await assert.rejects(runtime.runBrowserVision('person-cutout', pngFile(), {}, { signal: abort.signal, workerFactory: f.workerFactory, wasmBaseUrl: '/vendor/vision' }), { name: 'AbortError' }); assert.equal(f.counts.terminated, 1); } finally { f.restore(); }
});
test('invalid images and malformed worker results do not escape resource limits', async () => {
  const f = workerFixture(worker => queueMicrotask(() => worker.onmessage({ data: { type: 'result', result: { blob: new Blob(['png'], { type: 'image/png' }), width: 2000, height: 600, analysis: {} } } })));
  try {
    const runtime = await fresh();
    await assert.rejects(runtime.runBrowserVision('person-cutout', new File(['wrong'], 'bad.png', { type: 'image/png' }), {}, { workerFactory: f.workerFactory, wasmBaseUrl: '/vendor/vision' }), { code: 'invalid-image' }); assert.equal(f.counts.posts, 0);
    await assert.rejects(runtime.runBrowserVision('person-cutout', pngFile(), {}, { workerFactory: f.workerFactory, wasmBaseUrl: '/vendor/vision' }), { code: 'invalid-result' }); assert.equal(f.counts.terminated, 1);
  } finally { f.restore(); }
});
test('transfer failure closes the untransferred bitmap and worker', async () => {
  const f = workerFixture(() => { throw Error('DataCloneError'); });
  try { const runtime = await fresh(); await assert.rejects(runtime.runBrowserVision('person-cutout', pngFile(), {}, { workerFactory: f.workerFactory, wasmBaseUrl: '/vendor/vision' }), { code: 'inference-failed' }); assert.equal(f.counts.closed, 1); assert.equal(f.counts.terminated, 1); } finally { f.restore(); }
});
test('mask alpha has smooth, bounded and non-finite-safe transitions', () => {
  assert.equal(personMaskAlpha(0), 0); assert.equal(personMaskAlpha(1), 255); assert.equal(personMaskAlpha(0.5), 128); assert.equal(personMaskAlpha(NaN), 0);
  assert.ok(personMaskAlpha(0.45) < personMaskAlpha(0.55));
});
function processorFixture(operation, fail) {
  const counts = { tasks: 0, results: 0, bitmaps: 0 }, points = Array.from({ length: operation === 'pose-reference' ? 33 : 478 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  const context = { drawImage() {}, createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; }, putImageData() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {} };
  class Canvas { constructor(w, h) { this.width = w; this.height = h; } getContext() { return context; } async convertToBlob() { return new Blob(['png'], { type: 'image/png' }); } }
  const inference = operation === 'person-cutout' ? { confidenceMasks: [...(fail === 'single-mask' ? [] : [null]), { width: 2, height: 2, getAsFloat32Array: () => new Float32Array([1, 0, 1, 0]) }], close() { counts.results++; } } : operation === 'pose-reference' ? { landmarks: fail === 'empty' ? [] : [points], worldLandmarks: [points], close() { counts.results++; } } : { faceLandmarks: [points], faceBlendshapes: [{ categories: [{ categoryName: 'mouthSmileLeft', score: 0.1 }] }] };
  const task = { segment() { if (fail === 'inference') throw Error('model failure'); return inference; }, detect() { if (fail === 'inference') throw Error('model failure'); return inference; }, close() { counts.tasks++; } };
  const factory = { createFromOptions: async () => task, POSE_CONNECTIONS: [{ start: 0, end: 1 }], FACE_LANDMARKS_CONTOURS: [{ start: 0, end: 1 }] };
  const vision = { FilesetResolver: { isSimdSupported: async () => true, forVisionTasks: async () => ({}) }, ImageSegmenter: factory, PoseLandmarker: factory, FaceLandmarker: factory };
  const restore = globals({ crypto: hashCrypto(operation), OffscreenCanvas: Canvas, location: { origin: 'http://localhost' } });
  return { counts, restore, options: { vision, operation, bitmap: { width: 800, height: 600, close() { counts.bitmaps++; } }, modelBuffer: buffer(operation), wasmBaseUrl: 'http://localhost/vendor/vision' } };
}
test('segmentation closes masks, task and bitmap and returns an actual alpha image', async () => {
  const f = processorFixture('person-cutout');
  try { const result = await executeVisionTask(f.options); assert.equal(result.analysis.personCoverage, 0.5); assert.equal(result.blob.type, 'image/png'); assert.deepEqual(f.counts, { tasks: 1, results: 1, bitmaps: 1 }); } finally { f.restore(); }
});
test('the reviewed binary Selfie Segmenter uses its single foreground confidence mask', async () => {
  const f = processorFixture('person-cutout','single-mask');
  try { const result = await executeVisionTask(f.options); assert.equal(result.analysis.personCoverage,0.5); assert.equal(result.blob.type,'image/png'); assert.deepEqual(f.counts,{tasks:1,results:1,bitmaps:1}); } finally { f.restore(); }
});

test('pose and face processors produce all real provider landmarks and bounded rig values', async () => {
  for (const operation of ['pose-reference', 'face-reference']) {
    const f = processorFixture(operation);
    try { const result = await executeVisionTask(f.options); assert.equal(result.analysis.landmarks.length, operation === 'pose-reference' ? 33 : 478); assert.equal(f.counts.tasks, 1); assert.equal(f.counts.bitmaps, 1); if (operation === 'face-reference') assert.deepEqual(result.analysis.blendshapes, [{ name: 'mouthSmileLeft', score: 0.1 }]); } finally { f.restore(); }
  }
});
test('provider errors and no-subject outcomes close every allocated resource', async () => {
  for (const fail of ['inference', 'empty']) {
    const f = processorFixture('pose-reference', fail);
    try { await assert.rejects(executeVisionTask(f.options)); assert.equal(f.counts.tasks, 1); assert.equal(f.counts.bitmaps, 1); if (fail === 'empty') assert.equal(f.counts.results, 1); } finally { f.restore(); }
  }
});
