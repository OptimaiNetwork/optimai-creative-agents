import test from 'node:test';
import assert from 'node:assert/strict';
import * as camera from '../src/camera-runtime.mjs';
import { createFaceTracker } from '../src/camera-tracking.mjs';
const oldLocation = Object.getOwnPropertyDescriptor(globalThis,'location');
Object.defineProperty(globalThis,'location',{value:{origin:'http://localhost'},configurable:true});
test.after(()=>{if(oldLocation)Object.defineProperty(globalThis,'location',oldLocation);else delete globalThis.location;});
const tracking = { createFaceTracker: (buffer, options) => createFaceTracker(buffer,{...options,wasmBaseUrl:'/vendor/vision'}) };
test('camera recipes normalize only reviewed scalar controls without invoking accessors', () => {
  assert.deepEqual(camera.cameraRecipeSettings('camera-stage', { effect: 'studio', intensity: 45, mirror: 'no' }), { effect: 'clean', look: 'orbit', strength: .45, mirror: false, avatar: false });
  assert.deepEqual(camera.cameraRecipeSettings('avatar-stage', { look: 'luna' }), { effect: 'neon', look: 'luna', strength: .8, mirror: true, avatar: true });
  assert.equal(camera.cameraRecipeSettings('camera-stage', { intensity: 500 }).strength, 1);
  const malicious = { get effect() { assert.fail('recipe must not execute accessors'); } };
  assert.equal(camera.cameraRecipeSettings('camera-stage', malicious).effect, 'neon');
  assert.equal(camera.cameraRecipeSettings('avatar-stage', { look: 'https://external.example' }).look, 'orbit');
});
test('tracking refuses executable WASM outside the host origin before creating a worker', async () => {
  await assert.rejects(createFaceTracker(new ArrayBuffer(4), { workerFactory: () => assert.fail('remote WASM must not create a worker'), wasmBaseUrl: 'https://remote.example/runtime', onFace() {}, onError() {} }), /origin/);
});
const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function stream() { let stops = 0; return { getTracks: () => [{ stop() { stops += 1; } }], get stops() { return stops; } }; }

test('camera leases stop existing tracks and revoke late permission results on stop, close and replacement', async () => {
  const lease = camera.createCameraLease(), first = stream(), waiting = deferred(), late = stream();
  assert.equal(await lease.start(() => Promise.resolve(first)), first);
  const pending = lease.start(() => waiting.promise);
  assert.equal(first.stops, 1);
  lease.stop(); waiting.resolve(late);
  assert.equal(await pending, null); assert.equal(late.stops, 1); assert.equal(lease.active, null);
  const oldPermission = deferred(), newPermission = deferred(), old = stream(), current = stream();
  const oldStart = lease.start(() => oldPermission.promise), newStart = lease.start(() => newPermission.promise);
  newPermission.resolve(current); assert.equal(await newStart, current);
  oldPermission.resolve(old); assert.equal(await oldStart, null); assert.equal(old.stops, 1); assert.equal(current.stops, 0);
  lease.close(); assert.equal(current.stops, 1); assert.equal(await lease.start(() => assert.fail('closed lease must not request a camera')), null);
});

test('rig math mirrors pose and subject-eye coefficients, bounds malformed values and releases a lost face', () => {
  const angle = .45, matrix = [Math.cos(angle), 0, -Math.sin(angle), 0, 0, 1, 0, 0, Math.sin(angle), 0, Math.cos(angle), 0, 0, 0, -30, 1];
  const frame = { found: true, timestamp: 1000, matrix, anchors: [], blendshapes: { jawOpen: 9, eyeBlinkLeft: .8, eyeBlinkRight: .1, mouthSmileLeft: .6, mouthSmileRight: .4, browInnerUp: NaN } };
  const normal = camera.faceRigFromFrame(frame), mirrored = camera.faceRigFromFrame(frame, true);
  assert.ok(Math.abs(normal.yaw - angle) < 1e-9); assert.ok(Math.abs(mirrored.yaw + angle) < 1e-9);
  assert.equal(normal.jaw, 1); assert.equal(normal.brow, 0); assert.equal(normal.smile, .5);
  assert.equal(mirrored.blinkLeft, normal.blinkRight); assert.equal(mirrored.blinkRight, normal.blinkLeft);
  assert.deepEqual(camera.faceRigAt(frame, 1600), camera.NEUTRAL_FACE);
  assert.deepEqual(camera.faceRigAt(frame, 999), camera.NEUTRAL_FACE);
  const smooth = camera.smoothFaceRig(normal, camera.NEUTRAL_FACE, 80);
  assert.ok(smooth.jaw > 0 && smooth.jaw < 1);
  const reset = camera.smoothFaceRig(camera.NEUTRAL_FACE, normal, 0); assert.deepEqual(reset, camera.NEUTRAL_FACE);
  assert.deepEqual(camera.faceRigFromFrame({ ...frame, found: false }), camera.NEUTRAL_FACE);
});

test('source crop preserves aspect ratio and bounded illustrated demo expressions stay valid', () => {
  assert.deepEqual(camera.coverCrop(1200, 600, 640, 360), { scale: .6, x: -40, y: 0, width: 720, height: 360 });
  for (let time = 0; time < 120; time += .13) { const rig = camera.demoFaceRig(time); assert.ok(Object.values(rig).every(Number.isFinite)); for (const key of ['jaw', 'smile', 'blinkLeft', 'blinkRight', 'brow']) assert.ok(rig[key] >= 0 && rig[key] <= 1); }
  assert.match(camera.cameraPermissionMessage({ name: 'NotAllowedError' }), /local portrait/);
  assert.match(camera.cameraPermissionMessage({ name: 'NotFoundError' }), /No camera/);
});

class FakeWorker {
  constructor({ ready = true } = {}) { this.messages = []; this.terminated = 0; this.ready = ready; this.onmessage = null; this.onerror = null; }
  postMessage(message) { this.messages.push(message); if (message.type === 'init' && this.ready) queueMicrotask(() => this.emit({ type: 'ready' })); }
  emit(data) { this.onmessage?.({ data }); }
  terminate() { this.terminated += 1; }
}
const result = (timestamp = 1000) => ({ type: 'face', frame: { found: true, timestamp, matrix: [], anchors: [], blendshapes: { jawOpen: .5 } } });

test('tracking applies single-frame backpressure during bitmap creation and inference, then throttles strictly monotonic timestamps', async () => {
  const worker = new FakeWorker(), bitmapWait = deferred(), frames = [], errors = []; let creations = 0;
  const engine = await tracking.createFaceTracker(new ArrayBuffer(4), { workerFactory: () => worker, createBitmap: () => { creations += 1; return bitmapWait.promise; }, onFace: frame => frames.push(frame), onError: error => errors.push(error) });
  assert.equal(engine.submit({}, 1000), true); assert.equal(engine.submit({}, 1100), false); assert.equal(creations, 1);
  let closed = 0; bitmapWait.resolve({ close() { closed += 1; } }); await flush();
  assert.equal(worker.messages.filter(message => message.type === 'frame').length, 1);
  assert.equal(engine.submit({}, 1200), false, 'one frame remains in flight until its result');
  worker.emit(result()); assert.equal(frames.length, 1);
  assert.equal(engine.submit({}, 1050), false); assert.equal(engine.submit({}, 999), false); assert.equal(engine.submit({}, NaN), false);
  assert.equal(engine.submit({}, 1100), true); await flush(); engine.dispose();
  assert.equal(engine.submit({}, 2000), false); assert.equal(worker.terminated, 1); assert.equal(closed, 0, 'transferred bitmaps are owned and closed by the worker'); assert.deepEqual(errors, []);
});

test('closing while a bitmap is opening releases it and does not send a stale frame', async () => {
  const worker = new FakeWorker(), bitmapWait = deferred(); let closed = 0;
  const engine = await tracking.createFaceTracker(new ArrayBuffer(4), { workerFactory: () => worker, createBitmap: () => bitmapWait.promise, onFace: () => assert.fail('closed tracker must not publish'), onError: () => assert.fail('intentional close is not a failure') });
  engine.submit({}, 1000); engine.dispose(); bitmapWait.resolve({ close() { closed += 1; } }); await flush();
  assert.equal(closed, 1); assert.equal(worker.messages.length, 1); engine.dispose(); assert.equal(worker.terminated, 1);
});

test('invalid worker output and worker errors release the engine with an actionable message', async () => {
  for (const data of [{ type: 'face', frame: { timestamp: 1000, matrix: [], anchors: [], blendshapes: null } }, { type: 'error', message: 'Please restart tracking.' }]) {
    const worker = new FakeWorker(), errors = [];
    const engine = await tracking.createFaceTracker(new ArrayBuffer(4), { workerFactory: () => worker, onFace: () => assert.fail('invalid output must not drive a rig'), onError: message => errors.push(message) });
    worker.emit(data); assert.equal(worker.terminated, 1); assert.equal(errors.length, 1); assert.equal(engine.submit({}, 1000), false);
  }
});

test('initialization abort terminates a pending worker, and a cancelled request never creates one', async () => {
  const controller = new AbortController(), worker = new FakeWorker({ ready: false });
  const pending = tracking.createFaceTracker(new ArrayBuffer(4), { signal: controller.signal, workerFactory: () => worker, onFace() {}, onError() {} });
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' }); assert.equal(worker.terminated, 1);
  await assert.rejects(tracking.createFaceTracker(new ArrayBuffer(4), { signal: controller.signal, workerFactory: () => assert.fail('already aborted'), onFace() {}, onError() {} }), { name: 'AbortError' });
});

test('worker initialization and inference timeouts both terminate stalled engines', async () => {
  const originalSet = global.setTimeout, originalClear = global.clearTimeout; const timers = new Map(); let next = 0;
  global.setTimeout = callback => { const key = ++next; timers.set(key, callback); return key; }; global.clearTimeout = key => timers.delete(key);
  try {
    const stalled = new FakeWorker({ ready: false });
    const pending = tracking.createFaceTracker(new ArrayBuffer(4), { workerFactory: () => stalled, onFace() {}, onError() {} });
    const failure = assert.rejects(pending, /too long/); timers.values().next().value(); await failure; assert.equal(stalled.terminated, 1);
    const worker = new FakeWorker(), bitmapWait = deferred(), errors = [];
    const engine = await tracking.createFaceTracker(new ArrayBuffer(4), { workerFactory: () => worker, createBitmap: () => bitmapWait.promise, onFace() {}, onError: message => errors.push(message) });
    engine.submit({}, 1000); timers.values().next().value(); assert.equal(worker.terminated, 1); assert.match(errors[0], /unresponsive/); let closed = 0; bitmapWait.resolve({ close() { closed += 1; } }); await flush(); assert.equal(closed, 1); assert.equal(timers.size, 0);
  } finally { global.setTimeout = originalSet; global.clearTimeout = originalClear; }
});

