import test from 'node:test';
import assert from 'node:assert/strict';
import * as input from '../src/scene-3d.mjs';
import * as publicRuntime from '../src/scene-3d-runtime.mjs';
let THREE; test.before(async () => { try { THREE = await import('three'); } catch { /* Optional peer is not needed by core validation tests. */ } });
function glb(document, binary = new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer)) {
  const json = new TextEncoder().encode(JSON.stringify(document)), jsonSize = Math.ceil(json.length / 4) * 4, binSize = Math.ceil(binary.length / 4) * 4;
  const buffer = new ArrayBuffer(28 + jsonSize + binSize), view = new DataView(buffer), bytes = new Uint8Array(buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, buffer.byteLength, true); view.setUint32(12, jsonSize, true); view.setUint32(16, 0x4e4f534a, true); bytes.fill(32, 20, 20 + jsonSize); bytes.set(json, 20);
  view.setUint32(20 + jsonSize, binSize, true); view.setUint32(24 + jsonSize, 0x004e4942, true); bytes.set(binary, 28 + jsonSize); return buffer;
}
function document() { return { asset: { version: '2.0' }, buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 }; }
test('portable recipe fields map to real lens, exposure, subject, finish and view while legacy text remains compatible', () => {
  const recipe = input.scene3DRecipeSettings('scene-lighting', { demo: 'product', lighting: 'neon', finish: 'metal', view: 'side', focalLength: 85, exposure: 25 });
  assert.equal(recipe.camera, 'side'); assert.equal(recipe.settings.focalLength, 85); assert.equal(recipe.settings.exposure, .25); assert.equal(recipe.settings.material, 'metal'); assert.equal(recipe.settings.demo, 'product');
  assert.equal(input.scene3DRecipeSettings('model-turntable', { subject: 'an old saved product', material: 'brushed copper and glass' }).settings.material, 'original');
  assert.throws(() => input.scene3DRecipeSettings('model-turntable', { view: 'unknown' }), /camera view/);
  assert.throws(() => input.scene3DRecipeSettings('model-turntable', { exposure: 500 }), /exposure/);
  assert.throws(() => input.scene3DRecipeSettings('model-turntable', { focalLength: 2 }), /focalLength/);
});
test('public scene settings reject unsupported values and never execute accessors', () => {
  const settings = input.defaultAgent3DSettings('model-turntable'); assert.deepEqual(input.validateScene3DSettings(settings), settings);
  assert.throws(() => input.validateScene3DSettings({ ...settings, material: '__proto__' }), /material/);
  assert.throws(() => input.validateScene3DSettings({ ...settings, color: 'https://example.invalid' }), /hex/);
  assert.throws(() => input.validateScene3DSettings({ ...settings, exposure: NaN }), /exposure/);
  let ran = false; Object.defineProperty(settings, 'color', { enumerable: true, get() { ran = true; return '#123456'; } }); assert.throws(() => input.validateScene3DSettings(settings), /accessors/); assert.equal(ran, false);
});
test('a cancelled public stage never imports optional peers or starts graphics', async () => {
  const signal = AbortSignal.abort(); await assert.rejects(publicRuntime.createScene3DStage({}, input.defaultAgent3DSettings('model-turntable'), { signal }), { name: 'AbortError' });
});

test('two 3D agents start with distinct useful subjects and transfer a composition brief without generative-3D claims', () => {
  assert.equal(input.defaultAgent3DSettings('model-turntable').demo, 'sculpture'); assert.equal(input.defaultAgent3DSettings('scene-lighting').demo, 'architecture');
  const settings = input.defaultAgent3DSettings('scene-lighting'); settings.lighting = 'sunset';
  const prompt = input.scene3DPrompt(settings, '東京パビリオン.glb', 'Preserve its courtyard.', 'video');
  assert.match(prompt, /東京パビリオン/); assert.match(prompt, /warm sunset/); assert.match(prompt, /supplied 3D scene reference/); assert.match(prompt, /Preserve its courtyard/); assert.doesNotMatch(prompt, /Generate a 3D model/);
});
test('a bounded self-contained static GLB passes with truthful visible geometry metadata', () => {
  const bytes = glb(document()), result = input.validateAgentGLB(bytes); assert.equal(result.bytes, bytes); assert.equal(result.vertices, 3); assert.equal(result.primitives, 1); assert.equal(result.nodes, 1);
});
test('invalid containers, oversized files and unsupported embedded metadata fail before loader execution', () => {
  assert.throws(() => input.validateAgentGLB(new ArrayBuffer(19)), /20 MB/); assert.throws(() => input.validateAgentGLB(new ArrayBuffer(input.AGENT_3D_LIMITS.bytes + 1)), /20 MB/);
  const broken = glb(document()); new DataView(broken).setUint32(4, 1, true); assert.throws(() => input.validateAgentGLB(broken), /glTF 2.0/);
  const wrongLength = glb(document()); new DataView(wrongLength).setUint32(8, 20, true); assert.throws(() => input.validateAgentGLB(wrongLength), /valid glTF/);
});
test('URLs and decoder/instancing extensions cannot create remote requests or expand imports unexpectedly', () => {
  for (const uri of ['https://example.invalid/model.bin', '../texture.png', 'data:image/png;base64,huge']) { const d = document(); d.buffers[0].uri = uri; assert.throws(() => input.validateAgentGLB(glb(d)), /External and data URLs/); }
  for (const extension of ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu', 'EXT_mesh_gpu_instancing', 'KHR_lights_punctual']) { const d = document(); d.extensionsUsed = [extension]; assert.throws(() => input.validateAgentGLB(glb(d)), /uncompressed static GLB/); }
  const d = document(); d.meshes[0].extensions = { EXT_mesh_gpu_instancing: {} }; assert.throws(() => input.validateAgentGLB(glb(d)), /without EXT_mesh_gpu_instancing/);
});
test('geometry counts, offsets, invalid floats and mismatched vertex attributes are rejected', () => {
  const oversized = document(); oversized.accessors[0].count = 900001; assert.throws(() => input.validateAgentGLB(glb(oversized)), /geometry count/);
  const outside = document(); outside.accessors[0].byteOffset = 30; assert.throws(() => input.validateAgentGLB(glb(outside)), /attribute storage/);
  const sparse = document(); sparse.accessors[0].sparse = {}; assert.throws(() => input.validateAgentGLB(glb(sparse)), /non-sparse/);
  const positions = new Float32Array([NaN, 0, 0, 1, 0, 0, 0, 1, 0]); assert.throws(() => input.validateAgentGLB(glb(document(), new Uint8Array(positions.buffer))), /invalid geometry values/);
  const attributes = document(); attributes.accessors.push({ ...attributes.accessors[0], count: 2 }); attributes.meshes[0].primitives[0].attributes.NORMAL = 1; assert.throws(() => input.validateAgentGLB(glb(attributes)), /mismatched/);
});
test('mesh indices may only point to existing vertices and material references must resolve', () => {
  const d = document(), binary = new Uint8Array(40); binary.set(new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer)); binary.set([0, 1, 5], 36);
  d.buffers[0].byteLength = 40; d.bufferViews.push({ buffer: 0, byteOffset: 36, byteLength: 3 }); d.accessors.push({ bufferView: 1, componentType: 5121, count: 3, type: 'SCALAR' }); d.meshes[0].primitives[0].indices = 1;
  assert.throws(() => input.validateAgentGLB(glb(d, binary)), /outside its geometry/); binary[38] = 2; assert.equal(input.validateAgentGLB(glb(d, binary)).vertices, 3);
  d.meshes[0].primitives[0].material = 0; assert.throws(() => input.validateAgentGLB(glb(d, binary)), /mesh material/);
});
test('cyclic/repeated scene graphs, invisible scenes, skins, morph targets and animations do not enter the renderer', () => {
  const cycle = document(); cycle.nodes[0].children = [0]; assert.throws(() => input.validateAgentGLB(glb(cycle)), /circular/);
  const repeated = document(); repeated.nodes.push({}); repeated.nodes[0].children = [1, 1]; assert.throws(() => input.validateAgentGLB(glb(repeated)), /repeats a child/);
  const empty = document(); empty.scenes[0].nodes = []; assert.throws(() => input.validateAgentGLB(glb(empty)), /no visible model/);
  const skin = document(); skin.nodes[0].skin = 0; assert.throws(() => input.validateAgentGLB(glb(skin)), /without a skin/);
  const morph = document(); morph.meshes[0].primitives[0].targets = []; assert.throws(() => input.validateAgentGLB(glb(morph)), /without morph targets/);
  const animated = document(); animated.animations = [{}]; assert.throws(() => input.validateAgentGLB(glb(animated)), /without animations/);
});
test('embedded texture dimensions are inspected before decoding and cannot exceed the pixel budget', () => {
  const d = document(), binary = new Uint8Array(60), image = new DataView(binary.buffer, 36, 24); binary.set(new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer)); image.setUint32(0, 0x89504e47); image.setUint32(4, 0x0d0a1a0a); image.setUint32(12, 0x49484452); image.setUint32(16, 50000); image.setUint32(20, 50000);
  d.buffers[0].byteLength = 60; d.bufferViews.push({ buffer: 0, byteOffset: 36, byteLength: 24 }); d.images = [{ bufferView: 1, mimeType: 'image/png' }]; d.textures = [{ source: 0 }];
  assert.throws(() => input.validateAgentGLB(glb(d, binary)), /4096 pixels/); image.setUint32(16, 32); image.setUint32(20, 32); assert.equal(input.validateAgentGLB(glb(d, binary)).images, 1);
  d.images[0].mimeType = 'image/webp'; assert.throws(() => input.validateAgentGLB(glb(d, binary)), /PNG or JPEG/);
});

function runtimeHarness({ environmentFails = false } = {}) {
  const old = { window: global.window, document: global.document, ResizeObserver: global.ResizeObserver, IntersectionObserver: global.IntersectionObserver, requestAnimationFrame: global.requestAnimationFrame, cancelAnimationFrame: global.cancelAnimationFrame };
  const frames = new Map(), documentListeners = new Map(), motionListeners = new Map(), pending = [], renderers = [], observers = [];
  let nextFrame = 0, loaderCalls = 0;
  const query = { matches: false, addEventListener: (name, fn) => motionListeners.set(name, fn), removeEventListener: name => motionListeners.delete(name) };
  global.window = { devicePixelRatio: 3, matchMedia: () => query, addEventListener() {}, removeEventListener() {} };
  global.document = { hidden: false, addEventListener: (name, fn) => documentListeners.set(name, fn), removeEventListener: name => documentListeners.delete(name) };
  global.requestAnimationFrame = callback => { const id = ++nextFrame; frames.set(id, callback); return id; }; global.cancelAnimationFrame = id => frames.delete(id);
  global.ResizeObserver = class { constructor(fn) { this.fn = fn; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } };
  global.IntersectionObserver = class { constructor(fn) { this.fn = fn; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } };
  const container = { clientWidth: 800, clientHeight: 450, appendChild(element) { element.attached = true; } };
  class Renderer {
    constructor() { this.shadowMap = {}; this.domElement = { setAttribute() {}, addEventListener: () => {}, removeEventListener: () => {}, remove: () => { this.removed = true; }, toBlob: callback => callback(new Blob(['scene'], { type: 'image/png' })) }; this.renders = 0; renderers.push(this); }
    setPixelRatio(value) { this.pixelRatio = value; } setSize(width, height) { this.size = [width, height]; } render(scene, camera) { this.renders++; this.scene = scene; this.camera = camera; } dispose() { this.disposed = true; } forceContextLoss() { this.lost = true; }
  }
  class Controls extends THREE.EventDispatcher { constructor(camera) { super(); this.camera = camera; this.target = new THREE.Vector3(); } listenToKeyEvents() { this.keys = true; } stopListenToKeyEvents() { this.keys = false; } update() {} saveState() {} dispose() { this.disposed = true; } }
  class Environment extends THREE.Scene { constructor() { super(); this.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial())); } }
  class PMREM { fromScene() { if (environmentFails) throw new Error('Graphics initialization failed'); return { texture: new THREE.Texture(), dispose() { this.texture.dispose(); } }; } dispose() {} }
  class GLTFLoader { constructor(manager) { this.manager = manager; } parseAsync() { loaderCalls++; return new Promise((resolve, reject) => pending.push({ resolve, reject, manager: this.manager })); } }
  const engine = { THREE: { ...THREE, WebGLRenderer: Renderer, PMREMGenerator: PMREM }, OrbitControls: Controls, GLTFLoader, RoomEnvironment: Environment };
  const runtime = { ...publicRuntime, createAgent3DStage: (container, settings, error) => publicRuntime.createScene3DStageWithRuntime(container, settings, error, engine) };
  return { runtime, engine, container, frames, query, documentListeners, motionListeners, pending, renderers, observers, get loaderCalls() { return loaderCalls; }, tick(time) { const [id, callback] = frames.entries().next().value; frames.delete(id); callback(time); }, restore() { Object.assign(global, old); } };
}
test('3D runtime responds to camera/material controls and gates turntable work by visibility and reduced motion', async context => {
  if (!THREE) { context.skip('Install optional three@0.186.1 to run renderer regressions.'); return; }
  const h = runtimeHarness();
  try {
    const initial = input.defaultAgent3DSettings('model-turntable'), controller = h.runtime.createAgent3DStage(h.container, initial, () => {}), renderer = h.renderers[0];
    assert.equal(renderer.pixelRatio, 1.5); assert.deepEqual(renderer.size, [800, 450]); assert.equal(h.frames.size, 0, 'manual preview is event-driven');
    controller.camera('front'); assert.equal(renderer.camera.position.x, controller.configuration().camera.target[0]); controller.zoom('in'); const before = renderer.camera.position.distanceTo(new THREE.Vector3(...controller.configuration().camera.target)); controller.zoom('out'); assert.ok(renderer.camera.position.distanceTo(new THREE.Vector3(...controller.configuration().camera.target)) > before);
    controller.update({ ...initial, material: 'clay', color: '#b58867', rotating: true }); assert.equal(h.frames.size, 1); h.tick(1000); assert.equal(h.frames.size, 1);
    h.query.matches = true; h.motionListeners.get('change')(); assert.equal(h.frames.size, 0); h.query.matches = false; h.motionListeners.get('change')(); assert.equal(h.frames.size, 1);
    global.document.hidden = true; h.documentListeners.get('visibilitychange')(); assert.equal(h.frames.size, 0); global.document.hidden = false; h.documentListeners.get('visibilitychange')(); assert.equal(h.frames.size, 1);
    h.observers[1].fn([{ isIntersecting: false }]); assert.equal(h.frames.size, 0); h.observers[1].fn([{ isIntersecting: true }]); assert.equal(h.frames.size, 1);
    const png = await controller.png(); assert.equal(png.type, 'image/png'); controller.dispose(); assert.equal(h.frames.size, 0); assert.equal(h.documentListeners.size, 0); assert.equal(h.motionListeners.size, 0); assert.ok(h.observers.every(value => value.disconnected)); assert.ok(renderer.disposed && renderer.removed && renderer.lost); controller.dispose();
    await assert.rejects(controller.png(), /unavailable/);
  } finally { h.restore(); }
});
test('GLB import validates before parsing, blocks loader requests, and disposes late results after demo change/close', async context => {
  if (!THREE) { context.skip('Install optional three@0.186.1 to run renderer regressions.'); return; }
  const h = runtimeHarness();
  try {
    const controller = h.runtime.createAgent3DStage(h.container, input.defaultAgent3DSettings('model-turntable'), () => {});
    const remote = document(); remote.buffers[0].uri = 'https://example.invalid/model.bin'; await assert.rejects(controller.importGLB(glb(remote), 'model.glb'), /External and data URLs/); assert.equal(h.loaderCalls, 0);
    const importPromise = controller.importGLB(glb(document()), '東京モデル.glb'); const task = h.pending[0]; assert.throws(() => task.manager.resolveURL('https://example.invalid/texture.png'), /External model resources/);
    const scene = new THREE.Group(), geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial(); scene.add(new THREE.Mesh(geometry, material)); let disposed = 0; geometry.addEventListener('dispose', () => disposed++);
    controller.demo('architecture'); task.resolve({ scene, scenes: [scene] }); await assert.rejects(importPromise, /cancelled/); assert.equal(disposed, 1); assert.equal(controller.configuration().model, 'Courtyard pavilion');
    const late = controller.importGLB(glb(document()), 'late.glb'); const lateScene = new THREE.Group(), lateGeometry = new THREE.BoxGeometry(); lateScene.add(new THREE.Mesh(lateGeometry, new THREE.MeshStandardMaterial())); let lateDisposed = 0; lateGeometry.addEventListener('dispose', () => lateDisposed++); controller.dispose(); h.pending[1].resolve({ scene: lateScene, scenes: [lateScene] }); await assert.rejects(late, /cancelled/); assert.equal(lateDisposed, 1);
  } finally { h.restore(); }
});
test('a successful imported scene keeps its meaningful name and malformed visible geometry preserves the prior scene', async context => {
  if (!THREE) { context.skip('Install optional three@0.186.1 to run renderer regressions.'); return; }
  const h = runtimeHarness();
  try {
    const controller = h.runtime.createAgent3DStage(h.container, input.defaultAgent3DSettings('model-turntable'), () => {});
    const importing = controller.importGLB(glb(document()), '東京パビリオン.glb'), scene = new THREE.Group(); scene.add(new THREE.Mesh(new THREE.BoxGeometry(20, 10, 8), new THREE.MeshStandardMaterial())); h.pending[0].resolve({ scene, scenes: [scene] });
    assert.deepEqual(await importing, { name: '東京パビリオン', vertices: 3 }); assert.equal(controller.configuration().model, '東京パビリオン'); const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3()); assert.equal(Math.max(size.x, size.y, size.z), 3);
    const replacing = controller.importGLB(glb(document()), 'broken.glb'), broken = new THREE.Group(), empty = new THREE.BufferGeometry(); empty.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3)); broken.add(new THREE.Mesh(empty, new THREE.MeshStandardMaterial())); let disposed = 0; empty.addEventListener('dispose', () => disposed++); h.pending[1].resolve({ scene: broken, scenes: [broken] });
    await assert.rejects(replacing, /previous scene is unchanged/); assert.equal(disposed, 1); assert.equal(controller.configuration().model, '東京パビリオン'); controller.dispose();
  } finally { h.restore(); }
});
test('failed graphics initialization releases its renderer and canvas before reporting the fallback', context => {
  if (!THREE) { context.skip('Install optional three@0.186.1 to run renderer regressions.'); return; }
  const h = runtimeHarness({ environmentFails: true });
  try { assert.throws(() => h.runtime.createAgent3DStage(h.container, input.defaultAgent3DSettings('model-turntable'), () => {}), /initialization failed/); assert.ok(h.renderers[0].disposed && h.renderers[0].removed && h.renderers[0].lost); assert.equal(h.frames.size, 0); }
  finally { h.restore(); }
});
test('GPU resources shared by multiple mesh objects and decoded images are released exactly once', context => {
  if (!THREE) { context.skip('Install optional three@0.186.1 to run renderer regressions.'); return; }
  const h = runtimeHarness();
  try {
    const geometry = new THREE.BoxGeometry(), texture = new THREE.Texture(), material = new THREE.MeshStandardMaterial({ map: texture }), scene = new THREE.Group(); let g = 0, m = 0, t = 0, closed = 0;
    texture.image = { close() { closed++; } }; geometry.addEventListener('dispose', () => g++); material.addEventListener('dispose', () => m++); texture.addEventListener('dispose', () => t++); scene.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material)); h.runtime.disposeAgent3DObjects([scene]); assert.deepEqual([g, m, t, closed], [1, 1, 1, 1]);
  } finally { h.restore(); }
});
test('public async stage supports an injected peer runtime and abort disposes the mounted graphics session', async context => {
  if (!THREE) { context.skip('Install optional three@0.186.1 to run renderer regressions.'); return; }
  const h = runtimeHarness();
  try {
    const abort = new AbortController();
    const controller = await publicRuntime.createScene3DStage(h.container, input.defaultAgent3DSettings('model-turntable'), { runtime: h.engine, signal: abort.signal }); abort.abort(); await assert.rejects(controller.png(), /unavailable/); assert.equal(h.frames.size, 0);
  } finally { h.restore(); }
});
