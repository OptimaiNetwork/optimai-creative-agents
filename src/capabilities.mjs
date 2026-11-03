/** Capability probe: what this browser and device can run, read before a click instead of failing after it. Never asks for a permission. */
import { AGENT_INPUT_NEEDS, getAgentInputPolicy, getAgentWorkspace } from './index.mjs';

export const CAPABILITY_REPORT_VERSION = '1.0';
/** Every feature a report covers: the input-policy needs plus engine extras (`canvas-filter` for the legacy CSS grade, `webcodecs` for video export). */
export const CREATIVE_CAPABILITIES = Object.freeze([...AGENT_INPUT_NEEDS, 'canvas-filter', 'webcodecs']);
const LABELS = Object.freeze({
  canvas: 'Canvas', webgl: 'WebGL', webgpu: 'WebGPU', 'web-audio': 'Web Audio', worker: 'Web Workers', wasm: 'WebAssembly', camera: 'a camera',
  pointer: 'pointer input', 'media-recorder': 'video recording', 'offscreen-canvas': 'OffscreenCanvas', 'canvas-filter': 'canvas filters', webcodecs: 'WebCodecs',
});
/** Plain words for a feature: "WebGL", "a camera". */
export const capabilityLabel = (name) => LABELS[name] ?? String(name ?? '');
// Kinds whose engines load a model or a GPU scene, so a small device feels it.
const HEAVY = new Set(['vision', '3d', 'camera', 'frame']);
const MODELS = new Set(['vision', 'camera']);

const fn = (value) => typeof value === 'function';
const attempt = (read, fallback = false) => { try { return read(); } catch { return fallback; } };
function surface(env, width = 1, height = 1) {
  if (fn(env.document?.createElement)) { const canvas = env.document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas; }
  return fn(env.OffscreenCanvas) ? new env.OffscreenCanvas(width, height) : null;
}
function canvasFilter(env) {
  const context = attempt(() => surface(env)?.getContext('2d'), null);
  if (!context || !('filter' in context)) return false;
  context.filter = 'blur(1px)';
  return context.filter === 'blur(1px)';
}
function webgl(env) {
  const canvas = attempt(() => surface(env), null);
  const gl = canvas && attempt(() => canvas.getContext('webgl2') || canvas.getContext('webgl'), null);
  if (!gl) return false;
  attempt(() => gl.getExtension('WEBGL_lose_context')?.loseContext()); // hand the context back right away
  return true;
}
const media = (env, query) => attempt(() => !!env.matchMedia?.(query).matches);
const positive = (value) => Number.isFinite(value) && value > 0 ? value : undefined;

/** A synchronous report from feature presence alone. WebGPU and camera mean "the API exists"; `probeCreativeCapabilities` confirms them. */
export function detectCreativeCapabilities(environment = globalThis) {
  const env = environment ?? {}, nav = env.navigator ?? {}, connection = nav.connection ?? {};
  const browser = fn(env.document?.createElement) || fn(env.OffscreenCanvas);
  const features = {
    canvas: attempt(() => !!surface(env)?.getContext('2d')),
    webgl: browser && webgl(env),
    webgpu: !!nav.gpu && fn(nav.gpu.requestAdapter),
    'web-audio': fn(env.AudioContext) || fn(env.webkitAudioContext),
    worker: fn(env.Worker),
    wasm: typeof env.WebAssembly === 'object' && fn(env.WebAssembly?.instantiate),
    camera: env.isSecureContext !== false && fn(nav.mediaDevices?.getUserMedia),
    pointer: fn(env.PointerEvent),
    'media-recorder': fn(env.MediaRecorder),
    'offscreen-canvas': fn(env.OffscreenCanvas) && fn(env.createImageBitmap),
    'canvas-filter': browser && canvasFilter(env),
    webcodecs: fn(env.VideoEncoder) && fn(env.VideoFrame),
  };
  const device = {
    memoryGB: positive(nav.deviceMemory), cores: positive(nav.hardwareConcurrency),
    saveData: connection.saveData === true || media(env, '(prefers-reduced-data: reduce)'),
    effectiveType: typeof connection.effectiveType === 'string' ? connection.effectiveType : undefined,
    reducedMotion: media(env, '(prefers-reduced-motion: reduce)'), coarsePointer: media(env, '(pointer: coarse)'),
  };
  for (const key of Object.keys(device)) if (device[key] === undefined) delete device[key];
  return Object.freeze({ version: CAPABILITY_REPORT_VERSION, browser, probed: false, features: Object.freeze(features), device: Object.freeze(device) });
}

function bounded(promise, signal, timeoutMs) {
  return new Promise((resolve) => {
    let timer;
    const done = (value) => { clearTimeout(timer); signal?.removeEventListener?.('abort', stop); resolve(value); };
    const stop = () => done(undefined);
    if (signal?.aborted) return stop();
    signal?.addEventListener?.('abort', stop, { once: true });
    timer = setTimeout(stop, timeoutMs);
    Promise.resolve(promise).then(done, () => done(null));
  });
}
/**
 * Confirm the async features without prompting: a WebGPU adapter (a software adapter is flagged `gpu.fallback`) and whether any
 * camera is attached (`enumerateDevices`, which never asks for permission). A step that times out or is aborted keeps its sync answer.
 */
export async function probeCreativeCapabilities({ environment = globalThis, signal, timeoutMs = 1500, gpu = true, devices = true } = {}) {
  const base = detectCreativeCapabilities(environment), env = environment ?? {}, nav = env.navigator ?? {};
  const features = { ...base.features }, extra = {};
  const [adapter, cameras] = await Promise.all([
    gpu && features.webgpu ? bounded(attempt(() => nav.gpu.requestAdapter(), null), signal, timeoutMs) : undefined,
    devices && features.camera && fn(nav.mediaDevices?.enumerateDevices) ? bounded(attempt(() => nav.mediaDevices.enumerateDevices(), null), signal, timeoutMs) : undefined,
  ]);
  if (adapter !== undefined) {
    features.webgpu = !!adapter;
    if (adapter) extra.gpu = Object.freeze({ fallback: !!(adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter) });
  }
  if (Array.isArray(cameras)) features.camera = cameras.some((item) => item?.kind === 'videoinput');
  return Object.freeze({ ...base, probed: !signal?.aborted, features: Object.freeze(features), ...extra });
}

const list = (names) => names.map(capabilityLabel).join(names.length > 2 ? ', ' : ' and ').replace(/, ([^,]+)$/, ' and $1');
// One line per optional feature, said the way a creator acts on it.
const OPTIONAL_NOTES = Object.freeze({
  camera: 'No camera found here. Try it with a photo.',
  webgpu: 'Browser AI needs WebGPU, which this browser lacks. Connect a local model instead.',
  'media-recorder': 'Recording isn’t available in this browser. The preview still works.',
  worker: 'Face tracking isn’t available in this browser. Effects still work.',
  wasm: 'Face tracking isn’t available in this browser. Effects still work.',
});
/**
 * What a gallery card should say before anyone clicks: `ready`, `limited` (works, without an optional feature), `slow`
 * (small device, software GPU or Data Saver for a model download) or `unsupported` (a hard need is missing).
 * Accepts a template id or an input policy, and a report from either probe; with no report everything reads `ready`.
 */
export function assessAgentCapabilities(idOrPolicy, report) {
  const policy = typeof idOrPolicy === 'string' ? getAgentInputPolicy(idOrPolicy) : idOrPolicy;
  if (!policy) return undefined;
  const kind = typeof idOrPolicy === 'string' ? getAgentWorkspace(idOrPolicy)?.kind : undefined;
  const features = report?.features ?? {}, device = report?.device ?? {};
  const missing = policy.needs.filter((need) => features[need] === false);
  const unavailable = policy.optional.filter((need) => features[need] === false);
  const notes = [...new Set(unavailable.map((need) => OPTIONAL_NOTES[need]).filter(Boolean))];
  const heavy = HEAVY.has(kind) || (kind === 'writing' && features.webgpu !== false);
  const small = (device.memoryGB !== undefined && device.memoryGB < 4) || (device.cores !== undefined && device.cores <= 2);
  const slow = [
    heavy && small && 'Runs slower on this device.',
    heavy && report?.gpu?.fallback && 'This browser is drawing without the graphics card, so it runs slower.',
    (MODELS.has(kind) || (kind === 'writing' && features.webgpu !== false)) && device.saveData && 'Data Saver is on. The model downloads when you choose.',
  ].filter(Boolean);
  const status = missing.length ? 'unsupported' : slow.length ? 'slow' : notes.length ? 'limited' : 'ready';
  const message = missing.length ? `Needs ${list(missing)}, which this browser doesn’t offer.` : slow[0] ?? notes[0] ?? '';
  return Object.freeze({ status, message, missing: Object.freeze(missing), unavailable: Object.freeze(unavailable), notes: Object.freeze([...slow, ...notes]) });
}

/** The environment `getModelSetupPolicy` reads, from a report, so a host keeps one source of device facts. */
export function modelSetupEnvironment(report) {
  if (!report?.browser) return { browser: false };
  const { memoryGB, saveData, effectiveType } = report.device ?? {};
  return { browser: true, webGPU: report.features?.webgpu === true, saveData, effectiveType, deviceMemory: memoryGB };
}
