import assert from 'node:assert/strict';
import test from 'node:test';
import { FRAME_SCULPTURE_LIMITS, FRAME_SCULPTURE_TURNTABLE, createFrameSculptureStageWithRuntime, turntableAngle, turntableSize, frameSampleTimes, frameTextureSize, frameSculpturePose, validateFrameSculptureSettings, validateFrameSamples, extractFrameSamples } from '../src/frame-sculpture.mjs';

test('frame sampling covers equal intervals without seeking the ended position', () => {
  assert.deepEqual(frameSampleTimes(4, 4), [.5, 1.5, 2.5, 3.5]);
  for (const duration of [.01, 3.42, 60]) {
    const values = frameSampleTimes(duration, 12);
    assert.equal(values.length, 12); assert.ok(values.every((value, index) => value > 0 && value < duration && (!index || value > values[index - 1])));
  }
  for (const duration of [0, NaN, Infinity, -1, 61]) assert.throws(() => frameSampleTimes(duration));
  for (const count of [0, 1, 13, 2.5]) assert.throws(() => frameSampleTimes(3, count));
});
test('texture allocation preserves aspect ratio and caps source and retained pixels', () => {
  assert.deepEqual(frameTextureSize(1920, 1080), { width: 768, height: 432 });
  assert.deepEqual(frameTextureSize(1080, 1920), { width: 432, height: 768 });
  assert.deepEqual(frameTextureSize(100, 100), { width: 100, height: 100 });
  for (const size of [[0, 20], [10000, 200], [8192, 8192], [NaN, 40]]) assert.throws(() => frameTextureSize(...size));
});
test('all layouts produce finite bounded poses and keep one-frame compositions centered', () => {
  const poses = [];
  for (const layout of ['stack', 'fan', 'ribbon']) {
    const all = Array.from({ length: 12 }, (_, index) => frameSculpturePose(index, 12, { layout }));
    assert.ok(all.every(pose => Object.values(pose).every(Number.isFinite)));
    assert.equal(all[0].z, -all.at(-1).z); poses.push(all);
    const single = frameSculpturePose(0, 1, { layout }); assert.equal(single.x, 0); assert.equal(single.y, 0); assert.equal(single.z, 0);
  }
  assert.notDeepEqual(poses[0], poses[1]); assert.notDeepEqual(poses[1], poses[2]);
  for (const settings of [{ spacing: 0 }, { opacity: 0 }, { spread: 3 }, { tilt: 41 }, { layout: 'remote' }, { background: 'url(https://invalid.test)' }]) assert.throws(() => validateFrameSculptureSettings(settings));
});

test('default fan and ribbon expose the sequence across the perspective camera rather than collapsing behind one plane', () => {
  for (const layout of ['fan', 'ribbon']) {
    const poses = Array.from({ length: 8 }, (_, index) => frameSculpturePose(index, 8, { layout }));
    // Horizontal projection for the installed perspective direction (.95, .5, 1.15).
    const projected = poses.map(pose => pose.x * 1.15 - pose.z * .95);
    assert.ok(Math.abs(projected.at(-1) - projected[0]) > 4, 'All sampled planes should occupy a visible horizontal span.');
    assert.ok(projected.every((value, index) => !index || value < projected[index - 1]));
  }
});

function decoderFixture(t, duration = 4) {
  const draws = [], canvases = [], revoked = [], video = new EventTarget(); let time = 0, src = '';
  Object.assign(video, { videoWidth: 1920, videoHeight: 1080, duration, readyState: 2, pause() {}, removeAttribute() { src = ''; }, load() { if (src) queueMicrotask(() => video.dispatchEvent(new Event('loadeddata'))); } });
  Object.defineProperties(video, { src: { set(value) { src = value; }, get() { return src; } }, currentTime: { set(value) { time = value; queueMicrotask(() => video.dispatchEvent(new Event('seeked'))); }, get() { return time; } } });
  const originalDocument = globalThis.document, create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  globalThis.document = { createElement(kind) { if (kind === 'video') return video; assert.equal(kind, 'canvas'); const canvas = { width: 0, height: 0, getContext() { return { drawImage() { draws.push(time); } }; } }; canvases.push(canvas); return canvas; } };
  URL.createObjectURL = () => 'blob:local-fixture'; URL.revokeObjectURL = value => revoked.push(value);
  t.after(() => { globalThis.document = originalDocument; URL.createObjectURL = create; URL.revokeObjectURL = revoke; });
  return { draws, canvases, revoked, video, file: { size: 1000, type: 'video/mp4', name: 'original.mp4' } };
}
test('extraction decodes actual requested timestamps and releases the source URL', async t => {
  const fixture = decoderFixture(t), progress = [];
  const result = await extractFrameSamples(fixture.file, { count: 4, onProgress: (...value) => progress.push(value) });
  assert.deepEqual(fixture.draws, [.5, 1.5, 2.5, 3.5]); assert.deepEqual(result.frames.map(frame => frame.time), fixture.draws);
  assert.deepEqual(progress.map(value => value.slice(0, 2)), [[1, 4], [2, 4], [3, 4], [4, 4]], 'the positional (complete, total) arguments are unchanged');
  assert.deepEqual(progress.map(value => value[2]), [1, 2, 3, 4].map(frame => ({ stage: 'frame', message: 'Sampling frames on this device.', frame, frames: 4, progress: frame / 4 })), 'the third argument is the canonical progress event');
  assert.deepEqual(fixture.revoked, ['blob:local-fixture']);
  assert.equal(result.name, 'original.mp4'); assert.equal(result.kind, 'video'); assert.equal(result.duration, 4);
});
test('canceling halfway releases retained frame pixels and never returns partial frames', async t => {
  const fixture = decoderFixture(t), abort = new AbortController();
  await assert.rejects(extractFrameSamples(fixture.file, { count: 4, signal: abort.signal, onProgress: () => abort.abort() }), { name: 'AbortError' });
  assert.equal(fixture.draws.length, 1); assert.ok(fixture.canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
  assert.deepEqual(fixture.revoked, ['blob:local-fixture']);
});
test('unsupported and oversized media fail before any decoder allocation', async () => {
  for (const file of [{ size: FRAME_SCULPTURE_LIMITS.bytes + 1, type: 'video/mp4' }, { size: 20, type: 'image/gif', name: 'animated.gif' }, { size: 0, type: 'video/mp4' }]) await assert.rejects(extractFrameSamples(file));
});
test('repeated or overlapping ownership cannot clear existing frame pixels', () => {
  const canvas = { width: 640, height: 360, getContext() {} }, owned = [{ canvas, time: 1 }];
  assert.throws(() => validateFrameSamples(owned, owned), /already belong/);
  assert.throws(() => validateFrameSamples([{ canvas, time: 2 }], owned), /already belong/);
  assert.throws(() => validateFrameSamples([...owned, ...owned]), /distinct canvas/);
  assert.equal(canvas.width, 640); assert.equal(canvas.height, 360);
  assert.doesNotThrow(() => validateFrameSamples([{ canvas: { ...canvas }, time: 2 }], owned));
});

// A minimal Three.js stand-in: real vector maths, a renderer that records each camera position it draws.
class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { return this.set(v.x, v.y, v.z); } clone() { return new V3(this.x, this.y, this.z); }
  add(v) { return this.set(this.x + v.x, this.y + v.y, this.z + v.z); } sub(v) { return this.set(this.x - v.x, this.y - v.y, this.z - v.z); }
  addScaledVector(v, s) { return this.set(this.x + v.x * s, this.y + v.y * s, this.z + v.z * s); }
  length() { return Math.hypot(this.x, this.y, this.z); } normalize() { const l = this.length() || 1; return this.set(this.x / l, this.y / l, this.z / l); }
  setLength(l) { return this.normalize().set(this.x * l, this.y * l, this.z * l); } toArray() { return [this.x, this.y, this.z]; }
  applyAxisAngle(axis, angle) { // Rodrigues' rotation about a unit axis.
    const { x, y, z } = this, c = Math.cos(angle), s = Math.sin(angle), d = axis.x * x + axis.y * y + axis.z * z;
    return this.set(x * c + (axis.y * z - axis.z * y) * s + axis.x * d * (1 - c), y * c + (axis.z * x - axis.x * z) * s + axis.y * d * (1 - c), z * c + (axis.x * y - axis.y * x) * s + axis.z * d * (1 - c));
  }
}
function stageFixture(t) {
  const drawn = [], listeners = new EventTarget(), saved = Object.fromEntries(['document', 'window', 'requestAnimationFrame', 'cancelAnimationFrame'].map(key => [key, globalThis[key]]));
  const element = () => Object.assign(new EventTarget(), { width: 300, height: 150, style: {}, setAttribute() {}, remove() {} });
  globalThis.document = Object.assign(listeners, { hidden: false, createElement(kind) { assert.equal(kind, 'canvas'); const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: (source, x, y, w, h) => drawn.push({ source, size: [w, h] }) }) }; return canvas; } });
  globalThis.window = Object.assign(new EventTarget(), { devicePixelRatio: 2 });
  globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {};
  t.after(() => { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value; });
  const THREE = {
    SRGBColorSpace: 'srgb', LinearFilter: 1, DoubleSide: 2, Vector3: V3,
    WebGLRenderer: class { constructor() { this.domElement = element(); this.ratio = 1; this.size = [0, 0]; this.renders = []; THREE.renderer = this; } setPixelRatio(r) { this.ratio = r; } getPixelRatio() { return this.ratio; } setSize(w, h) { this.size = [w, h]; } render(scene, camera) { this.renders.push({ position: camera.position.clone(), size: [...this.size], aspect: camera.aspect }); } dispose() {} forceContextLoss() {} },
    Scene: class { add() {} }, Group: class { add() {} remove() {} }, Color: class { set() {} },
    PerspectiveCamera: class { constructor(fov, aspect) { this.fov = fov; this.aspect = aspect; this.far = 100; this.position = new V3(); THREE.camera = this; } updateProjectionMatrix() {} lookAt(target) { this.looking = target.clone(); } },
    GridHelper: class { position = new V3(); geometry = { dispose() {} }; material = { dispose() {} }; },
    Box3: class { setFromObject() { return this; } getCenter(v) { v.set(0, 0, 0); } getSize(v) { v.set(4, 3, 3); } },
    CanvasTexture: class { dispose() {} }, PlaneGeometry: class { dispose() {} }, MeshBasicMaterial: class { constructor(options) { Object.assign(this, options); } dispose() {} },
    Mesh: class { constructor(geometry, material) { this.geometry = geometry; this.material = material; this.position = new V3(); this.rotation = new V3(); } },
  };
  class OrbitControls extends EventTarget { constructor(camera) { super(); this.camera = camera; this.target = new V3(); this.enabled = true; } update() {} dispose() {} }
  const container = { clientWidth: 800, clientHeight: 450, appendChild() {} }, motion = Object.assign(new EventTarget(), { matches: false });
  const stage = createFrameSculptureStageWithRuntime(container, {}, () => {}, { THREE, OrbitControls }, { motion });
  const sample = () => ({ canvas: { width: 320, height: 180, getContext() { return {}; } }, time: 0 });
  return { THREE, stage, drawn, container, sample };
}
test('a turntable orbits the chosen view at video size, keeps the stage still and restores it', t => {
  const { THREE, stage, drawn, sample } = stageFixture(t);
  assert.throws(() => stage.turntable(), /Prepare a frame sculpture/);
  stage.frames([sample(), sample(), sample()]);
  const start = THREE.camera.position.clone(), before = { size: [...THREE.renderer.size], ratio: THREE.renderer.ratio, aspect: THREE.camera.aspect };
  const spin = stage.turntable();
  assert.deepEqual([spin.width, spin.height, spin.degrees], [1280, 720, 360], 'video sides follow the stage aspect');
  assert.deepEqual([THREE.renderer.size, THREE.renderer.ratio, THREE.camera.aspect], [[1280, 720], 1, 1280 / 720]);
  assert.throws(() => stage.turntable(), /already running/);
  const frames = 8, radius = Math.hypot(start.x, start.z);
  for (let frame = 0; frame < frames; frame++) spin.draw(frame, frames);
  const positions = THREE.renderer.renders.slice(-frames).map(render => render.position);
  assert.ok(positions.every(p => Math.abs(Math.hypot(p.x, p.z) - radius) < 1e-9 && Math.abs(p.y - start.y) < 1e-9), 'the camera keeps its distance and height');
  assert.deepEqual(positions[0].toArray(), start.toArray(), 'frame 0 is the chosen view');
  const quarter = positions[2], angle = Math.atan2(quarter.x, quarter.z) - Math.atan2(start.x, start.z);
  assert.ok(Math.abs(Math.cos(angle)) < 1e-9 && Math.abs(Math.sin(angle) - 1) < 1e-9, 'a quarter of the clip is a quarter turn');
  assert.ok(THREE.renderer.renders.slice(-frames).every(render => render.size[0] === 1280 && render.aspect === 1280 / 720));
  assert.equal(drawn.length, frames); assert.ok(drawn.every(call => call.source === THREE.renderer.domElement && call.size[0] === 1280 && call.size[1] === 720));
  spin.close(); spin.close();
  assert.deepEqual(THREE.camera.position.toArray(), start.toArray(), 'closing restores the camera');
  assert.deepEqual([THREE.renderer.size, THREE.renderer.ratio, THREE.camera.aspect], [before.size, before.ratio, before.aspect]);
  assert.deepEqual([spin.canvas.width, spin.canvas.height], [0, 0]);
  assert.throws(() => spin.draw(0, 8), /closed/);
  const square = stage.turntable({ width: 720, height: 720, degrees: -180 });
  square.draw(4, 8); const back = THREE.renderer.renders.at(-1).position, turned = Math.atan2(back.x, back.z) - Math.atan2(start.x, start.z);
  assert.ok(Math.abs(Math.sin(turned) + 1) < 1e-9, 'frame 4 of an 8-frame −180° clip is a quarter turn the other way');
  assert.deepEqual(THREE.renderer.renders.at(-1).size, [720, 720]);
  square.close();
  assert.throws(() => stage.turntable({ width: 721, height: 720 }), /even/);
  assert.throws(() => stage.turntable({ degrees: 0 }), /degrees/);
  stage.dispose();
});
test('turntable angles loop without repeating the first frame, and video sides stay even', () => {
  assert.equal(turntableAngle(0, 180), 0);
  assert.ok(Math.abs(turntableAngle(90, 180) - Math.PI) < 1e-12);
  assert.ok(turntableAngle(179, 180) < 2 * Math.PI, 'the last frame stops short of the first');
  assert.ok(Math.abs(turntableAngle(1, 4, { degrees: -90 }) + Math.PI / 8) < 1e-12);
  for (const [frame, frames, options] of [[0, 0], [4, 4], [-1, 4], [.5, 4], [0, 4, { degrees: 0 }], [0, 4, { degrees: 721 }], [0, 4, { degrees: NaN }]]) assert.throws(() => turntableAngle(frame, frames, options));
  assert.deepEqual(FRAME_SCULPTURE_TURNTABLE, { seconds: 6, fps: 30, degrees: 360, edge: 1280 });
  assert.deepEqual(turntableSize(16 / 9), { width: 1280, height: 720 });
  assert.deepEqual(turntableSize(9 / 16, 1280), { width: 720, height: 1280 });
  assert.deepEqual(turntableSize(1.37, 999 + 1), { width: 1000, height: 730 });
  assert.deepEqual(turntableSize(NaN), { width: 1280, height: 720 }, 'an unreadable aspect falls back to 16:9');
  assert.deepEqual(turntableSize(100), { width: 1280, height: 320 }, 'extreme aspects are capped at 4:1');
  assert.throws(() => turntableSize(1, 1921)); assert.throws(() => turntableSize(1, 1));
});
