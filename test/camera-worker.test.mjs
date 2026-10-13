import test from 'node:test';
import assert from 'node:assert/strict';
import { installCameraWorker } from '../src/camera-worker.mjs';
import { VISION_MODELS } from '../src/vision-runtime.mjs';

const MODEL = VISION_MODELS['face-reference'];
const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
function fixture({ badHash = false, createTask } = {}) {
  const descriptors = new Map(['crypto', 'OffscreenCanvas'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const posted = [], files = [], detected = []; let createdOptions, closed = 0, bitmapClosed = 0;
  Object.defineProperty(globalThis, 'crypto', { value: { subtle: { digest: async () => badHash ? new Uint8Array(32).buffer : Uint8Array.from(MODEL.sha256.match(/../g), byte => parseInt(byte, 16)).buffer } }, configurable: true });
  globalThis.OffscreenCanvas = class { constructor(width, height) { this.width = width; this.height = height; } getContext() { return { drawImage() {} }; } };
  const points = Array.from({ length: 478 }, (_, i) => ({ x: i / 478, y: .5 }));
  const task = { close() { closed++; }, detectForVideo(canvas, timestamp) { detected.push({ canvas, timestamp }); return { faceLandmarks: [points], faceBlendshapes: [{ categories: [{ categoryName: 'jawOpen', score: .6 }] }], facialTransformationMatrixes: [{ data: Array(16).fill(0) }] }; } };
  const vision = { FilesetResolver: { isSimdSupported: async () => true, forVisionTasks: async (...values) => { files.push(values); return {}; } }, FaceLandmarker: { createFromOptions: async (_files, options) => { createdOptions = options; return createTask ? createTask(task) : task; } } };
  const scope = { location: { origin: 'https://host.example' }, postMessage: data => posted.push(data), onmessage: null };
  const runtime = installCameraWorker(vision, { scope });
  return { runtime, scope, posted, files, detected, get closed() { return closed; }, get options() { return createdOptions; }, get bitmapClosed() { return bitmapClosed; },
    init: () => scope.onmessage({ data: { type: 'init', modelBuffer: new ArrayBuffer(MODEL.bytes), wasmBaseUrl: 'https://host.example/reviewed-runtime' } }),
    frame: (timestamp, width = 640) => scope.onmessage({ data: { type: 'frame', timestamp, bitmap: { width, height: 360, close() { bitmapClosed++; } } } }),
    restore() { runtime.dispose(); for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } },
  };
}
test('canonical face worker verifies model and configures host runtime once for video blendshapes and pose', async () => {
  const f = fixture();
  try {
    f.init(); await flush(); assert.equal(f.posted[0].type, 'ready');
    assert.equal(f.options.runningMode, 'VIDEO'); assert.equal(f.options.numFaces, 1); assert.equal(f.options.outputFaceBlendshapes, true); assert.equal(f.options.outputFacialTransformationMatrixes, true);
    assert.ok(f.options.canvas instanceof OffscreenCanvas); assert.deepEqual(f.files, [['https://host.example/reviewed-runtime', true]]);
    f.init(); await flush(); assert.equal(f.files.length, 1, 'initialization is reused across all live frames');
    f.frame(1000); assert.equal(f.bitmapClosed, 1); assert.equal(f.detected[0].timestamp, 1000); assert.ok(f.detected[0].canvas instanceof OffscreenCanvas);
    const frame = f.posted.at(-1).frame; assert.equal(frame.found, true); assert.equal(frame.blendshapes.jawOpen, .6); assert.equal(frame.matrix.length, 16); assert.equal(frame.anchors.length, 4);
    f.frame(1000); assert.equal(f.bitmapClosed, 2); assert.equal(f.detected.length, 1, 'timestamps must increase for VIDEO inference');
    assert.equal(f.posted.at(-1).type, 'error');
    f.frame(1100, 2000); assert.equal(f.bitmapClosed, 3); assert.equal(f.detected.length, 1, 'frames remain bounded');
    f.runtime.dispose(); f.runtime.dispose(); assert.equal(f.closed, 1); assert.equal(f.scope.onmessage, null);
  } finally { f.restore(); }
});
test('corrupt model bytes or remote WASM are rejected before ML task creation', async () => {
  for (const reason of ['hash', 'origin']) {
    const f = fixture({ badHash: reason === 'hash' });
    try {
      if (reason === 'hash') f.init(); else f.scope.onmessage({ data: { type: 'init', modelBuffer: new ArrayBuffer(MODEL.bytes), wasmBaseUrl: 'https://external.example/runtime' } });
      await flush(); assert.equal(f.posted.at(-1).type, 'error'); assert.equal(f.options, undefined); assert.equal(f.files.length, 0);
    } finally { f.restore(); }
  }
});
test('disposing while the task is initializing closes late task results and never announces ready', async () => {
  let resolve;
  const f = fixture({ createTask: task => new Promise(done => { resolve = () => done(task); }) });
  try {
    f.init(); await flush(); assert.equal(typeof resolve, 'function'); f.runtime.dispose(); resolve(); await flush();
    assert.equal(f.closed, 1); assert.deepEqual(f.posted, []); assert.equal(f.scope.onmessage, null);
  } finally { f.restore(); }
});
