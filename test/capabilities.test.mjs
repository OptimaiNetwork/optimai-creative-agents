import assert from 'node:assert/strict';
import test from 'node:test';
import { AGENT_CATALOG, AGENT_INPUT_NEEDS, getAgentInputPolicy } from '../src/index.mjs';
import { assessAgentCapabilities, capabilityLabel, CREATIVE_CAPABILITIES, detectCreativeCapabilities, modelSetupEnvironment, probeCreativeCapabilities } from '../src/capabilities.mjs';
import { getModelSetupPolicy } from '../src/model-setup.mjs';

// A browser stand-in: every global the probe reads, each switchable, with a log of what it touched.
function browser({ gl = true, filter = true, gpu = 'adapter', cameras = ['videoinput'], secure = true, memory = 8, cores = 8, saveData = false, queries = {}, drop = [] } = {}) {
  const log = { contexts: [], lost: 0, getUserMedia: 0 };
  const context2d = filter ? { _f: 'none', get filter() { return this._f; }, set filter(value) { this._f = value; } } : {};
  const canvas = () => ({ width: 0, height: 0, getContext(type) {
    log.contexts.push(type);
    if (type === '2d') return context2d;
    return gl && type === 'webgl2' ? { getExtension: (name) => name === 'WEBGL_lose_context' ? { loseContext: () => { log.lost++; } } : null } : null;
  } });
  const fnc = function () {};
  const env = {
    document: { createElement: (tag) => { assert.equal(tag, 'canvas'); return canvas(); } },
    OffscreenCanvas: fnc, createImageBitmap: fnc, Worker: fnc, AudioContext: fnc, PointerEvent: fnc, MediaRecorder: fnc, VideoEncoder: fnc, VideoFrame: fnc,
    WebAssembly: { instantiate: fnc }, isSecureContext: secure,
    matchMedia: (query) => ({ matches: !!queries[query] }),
    navigator: {
      deviceMemory: memory, hardwareConcurrency: cores, connection: { saveData, effectiveType: '4g' },
      gpu: gpu && { requestAdapter: () => gpu === 'hang' ? new Promise(() => {}) : gpu === 'throw' ? Promise.reject(new Error('no')) : Promise.resolve(gpu === 'none' ? null : { info: { isFallbackAdapter: gpu === 'software' } }) },
      mediaDevices: { getUserMedia: () => { log.getUserMedia++; }, enumerateDevices: async () => cameras.map((kind) => ({ kind, label: '' })) },
    },
  };
  for (const key of drop) delete env[key];
  return { env, log };
}

test('a sync report covers every policy need plus engine extras, frozen, with plain labels', () => {
  assert.ok(AGENT_INPUT_NEEDS.every((need) => CREATIVE_CAPABILITIES.includes(need)) && CREATIVE_CAPABILITIES.includes('webcodecs') && CREATIVE_CAPABILITIES.includes('canvas-filter'));
  const { env, log } = browser({ queries: { '(prefers-reduced-motion: reduce)': true } });
  const report = detectCreativeCapabilities(env);
  assert.deepEqual(Object.keys(report.features).sort(), [...CREATIVE_CAPABILITIES].sort());
  assert.ok(Object.values(report.features).every((value) => value === true));
  assert.deepEqual(report.device, { memoryGB: 8, cores: 8, saveData: false, effectiveType: '4g', reducedMotion: true, coarsePointer: false });
  assert.equal(report.browser, true); assert.equal(report.probed, false);
  assert.ok(Object.isFrozen(report) && Object.isFrozen(report.features) && Object.isFrozen(report.device));
  assert.equal(log.lost, 1, 'the WebGL test context is released at once');
  assert.equal(log.getUserMedia, 0, 'never asks for the camera');
  assert.equal(capabilityLabel('webgl'), 'WebGL'); assert.equal(capabilityLabel('camera'), 'a camera'); assert.equal(capabilityLabel('new-thing'), 'new-thing');
});

test('missing features read false: no WebGL, filter that does not stick, insecure camera, no workers', () => {
  const { env } = browser({ gl: false, filter: false, secure: false, drop: ['Worker', 'VideoEncoder', 'createImageBitmap'], memory: 0 });
  const { features, device } = detectCreativeCapabilities(env);
  assert.equal(features.webgl, false); assert.equal(features['canvas-filter'], false); assert.equal(features.camera, false);
  assert.equal(features.worker, false); assert.equal(features.webcodecs, false); assert.equal(features['offscreen-canvas'], false);
  assert.ok(!('memoryGB' in device));
  const node = detectCreativeCapabilities({});
  assert.equal(node.browser, false); assert.ok(Object.values(node.features).every((value) => value === false));
  assert.equal(detectCreativeCapabilities(null).browser, false);
  assert.equal(detectCreativeCapabilities().browser, false, 'Node globals are not a browser');
});

test('the async probe confirms WebGPU and cameras, flags software GPUs and keeps sync answers on timeout or abort', async () => {
  const probe = (options, extra) => probeCreativeCapabilities({ environment: browser(options).env, ...extra });
  const full = await probe();
  assert.equal(full.probed, true); assert.equal(full.features.webgpu, true); assert.deepEqual(full.gpu, { fallback: false }); assert.equal(full.features.camera, true);
  assert.equal((await probe({ gpu: 'software' })).gpu.fallback, true);
  assert.equal((await probe({ gpu: 'none' })).features.webgpu, false);
  assert.equal((await probe({ gpu: 'throw' })).features.webgpu, false);
  assert.equal((await probe({ cameras: ['audioinput'] })).features.camera, false, 'no video input attached');
  const hung = await probe({ gpu: 'hang' }, { timeoutMs: 5 });
  assert.equal(hung.features.webgpu, true, 'a slow adapter keeps the sync answer'); assert.equal(hung.gpu, undefined);
  const controller = new AbortController(); controller.abort();
  const aborted = await probe({ gpu: 'hang' }, { signal: controller.signal });
  assert.equal(aborted.probed, false); assert.equal(aborted.features.webgpu, true);
  assert.equal((await probe({}, { gpu: false })).gpu, undefined, 'gpu: false skips the adapter');
  assert.ok(Object.isFrozen(full) && Object.isFrozen(full.features));
});

test('assessments turn a report into card words for every template', () => {
  const ok = detectCreativeCapabilities(browser().env);
  for (const agent of AGENT_CATALOG) assert.deepEqual(assessAgentCapabilities(agent.id, ok), { status: 'ready', message: '', missing: [], unavailable: [], notes: [] }, agent.id);
  assert.equal(assessAgentCapabilities('missing-agent', ok), undefined);
  assert.equal(assessAgentCapabilities('model-turntable').status, 'ready', 'no report yet reads ready');

  const noGl = detectCreativeCapabilities(browser({ gl: false }).env);
  assert.deepEqual(assessAgentCapabilities('model-turntable', noGl), { status: 'unsupported', message: 'Needs WebGL, which this browser doesn’t offer.', missing: ['webgl'], unavailable: [], notes: [] });
  assert.equal(assessAgentCapabilities('image-finish', noGl).status, 'ready', 'canvas agents need no WebGL');
  const old = detectCreativeCapabilities(browser({ drop: ['Worker', 'WebAssembly', 'OffscreenCanvas'] }).env);
  assert.equal(assessAgentCapabilities(AGENT_CATALOG.find((agent) => agent.workspace.kind === 'vision').id, old).message, 'Needs Web Workers, WebAssembly and OffscreenCanvas, which this browser doesn’t offer.');

  const noCamera = detectCreativeCapabilities(browser({ secure: false }).env);
  const camera = assessAgentCapabilities('camera-stage', noCamera);
  assert.equal(camera.status, 'limited'); assert.equal(camera.message, 'No camera found here. Try it with a photo.'); assert.deepEqual(camera.unavailable, ['camera']);
  const writing = AGENT_CATALOG.find((agent) => agent.workspace.kind === 'writing').id;
  assert.match(assessAgentCapabilities(writing, detectCreativeCapabilities(browser({ gpu: false }).env)).message, /local model/);

  const small = detectCreativeCapabilities(browser({ memory: 2 }).env);
  assert.equal(assessAgentCapabilities('frame-sculpture', small).message, 'Runs slower on this device.');
  assert.equal(assessAgentCapabilities('image-finish', small).status, 'ready', 'light canvas work is unaffected');
  assert.equal(assessAgentCapabilities('camera-stage', detectCreativeCapabilities(browser({ saveData: true }).env)).status, 'slow');
  const both = assessAgentCapabilities('camera-stage', detectCreativeCapabilities(browser({ cores: 2, secure: false }).env));
  assert.equal(both.status, 'slow'); assert.equal(both.notes.length, 2, 'every note is kept, the strongest first');
  assert.equal(assessAgentCapabilities(getAgentInputPolicy('model-turntable'), noGl).status, 'unsupported', 'accepts a policy too');
});

test('assessments use the software-GPU flag from a probe', async () => {
  const report = await probeCreativeCapabilities({ environment: browser({ gpu: 'software' }).env });
  assert.match(assessAgentCapabilities('model-turntable', report).message, /without the graphics card/);
});

test('modelSetupEnvironment feeds getModelSetupPolicy from the same report', () => {
  assert.deepEqual(modelSetupEnvironment(null), { browser: false });
  assert.equal(getModelSetupPolicy({ bytes: 1 }, modelSetupEnvironment(detectCreativeCapabilities({}))).mode, 'unsupported');
  const env = modelSetupEnvironment(detectCreativeCapabilities(browser({ saveData: true, memory: 2 }).env));
  assert.deepEqual(env, { browser: true, webGPU: true, saveData: true, effectiveType: '4g', deviceMemory: 2 });
  assert.equal(getModelSetupPolicy({ bytes: 453e6, requiresWebGPU: true }, env).mode, 'manual');
  assert.equal(getModelSetupPolicy({ bytes: 1, requiresWebGPU: true }, modelSetupEnvironment(detectCreativeCapabilities(browser({ gpu: false }).env))).mode, 'unsupported');
});
