/**
 * Depth to 2.5D parallax, all on the device.
 *
 * - `DEPTH_MODEL` pins Depth Anything V2 Small (Apache-2.0; the Base and Large sizes are
 *   CC-BY-NC-4.0 and are deliberately not offered) at one Hub commit, with the byte size and
 *   SHA-256 of every weight file and the Git blob id of every config file.
 * - `createDepthEstimator` runs it through an optional peer the host passes: `onnxruntime-web`
 *   (`DEPTH_ORT_RUNTIME`, the small one) or `@huggingface/transformers` (`DEPTH_RUNTIME`).
 *   The SDK never imports either.
 *   Pinned files are fetched and checked by the SDK, and weights that do not match never run.
 * - `guessDepth` is a model-free stand-in (lower and busier = nearer) for a preview before the
 *   download, and for tests.
 * - `createParallaxRenderer` warps one photo by its depth map for a camera view;
 *   `depthCameraAt` turns the Depth Motion recipe (`camera`, `depth`) into views over time and
 *   `createDepthMotionClip` draws them frame by frame for `exportCanvasVideo`.
 *
 * Depth maps are `{ width, height, data: Float32Array }` with 0 = far and 1 = near (relative,
 * not metres), plus `source`: `model`, `guess` or `host`.
 */

export const DEPTH_RUNTIME = Object.freeze({ package: '@huggingface/transformers', version: '4.3.2', license: 'Apache-2.0' });
/** The smaller peer: ONNX Runtime Web alone (no native packages). The SDK does the model's resize and normalize itself. */
export const DEPTH_ORT_RUNTIME = Object.freeze({ package: 'onnxruntime-web', version: '1.31.1', license: 'MIT' });
const weight = (file, bytes, sha256) => Object.freeze({ file, bytes, sha256 });
export const DEPTH_MODEL = Object.freeze({
  id: 'depth-anything-v2-small', name: 'Depth Anything V2 Small', license: 'Apache-2.0',
  repo: 'onnx-community/depth-anything-v2-small', revision: '4472b7362082ad9968fee890ca0f1e5aca36b93d', host: 'https://huggingface.co',
  inputSize: 518,
  // From the pinned preprocessor_config.json: keep the aspect ratio, sides a multiple of 14, ImageNet mean and std.
  preprocess: Object.freeze({ size: 518, multiple: 14, mean: Object.freeze([0.485, 0.456, 0.406]), std: Object.freeze([0.229, 0.224, 0.225]) }),
  config: Object.freeze({
    'config.json': Object.freeze({ bytes: 38, gitSha1: 'e6abe62678884ee132d00225851fd4b79c943edb' }),
    'preprocessor_config.json': Object.freeze({ bytes: 461, gitSha1: 'a75aa1ee872be3855a1d40c3050dbea9063e411f' }),
  }),
  // transformers.js dtype → file. fp16 suits WebGPU, q8 suits WebAssembly.
  weights: Object.freeze({
    fp32: weight('onnx/model.onnx', 99060839, 'afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c'),
    fp16: weight('onnx/model_fp16.onnx', 49642442, '2df6223f206b5164e21f664ace61dabeb9bb6a49b8b5a3e00510b4807d0f5b04'),
    q8: weight('onnx/model_quantized.onnx', 27258801, 'fcf51f1b230362b28690bb9d1809bf0431f29cad20534e3f589bd7285547f20d'),
    int8: weight('onnx/model_int8.onnx', 27258801, '01aa7a23de3f4a0ee1a2bb9997e6918104c85a9f95dea46d27b9b3fb0c6b9001'),
    uint8: weight('onnx/model_uint8.onnx', 27258801, 'fcf51f1b230362b28690bb9d1809bf0431f29cad20534e3f589bd7285547f20d'),
    q4: weight('onnx/model_q4.onnx', 27404416, '5d55b02762e1907589158af3e366bd61ddf648155852a07bbf5e3a074639fcf8'),
    q4f16: weight('onnx/model_q4f16.onnx', 19126267, 'eca72971aea64216d767c70c534160de53b5435b588d362bac6dbd5a73f9bf1e'),
    bnb4: weight('onnx/model_bnb4.onnx', 26077648, '0312c94ffd25c662880df1d55b336f028115166eb574ebc1622901d39e984185'),
  }),
});
const DEPTH_CONFIG_BYTES = 499;
export const DEPTH_LIMITS = Object.freeze({ pixels: 16_000_000, inputSide: 1024, guessSide: 256, depthPixels: 4_194_304 });
export const DEPTH_STRENGTHS = Object.freeze({ subtle: 0.022, medium: 0.045 });
export const DEPTH_CAMERAS = Object.freeze(['locked', 'slow push', 'orbit', 'tracking', 'handheld']);
export const DEPTH_MOTION_CLIP = Object.freeze({ seconds: 4, fps: 30 });

export class DepthError extends Error {
  constructor(code, message, options) { super(message, options); this.name = 'DepthError'; this.code = code; }
}
const aborted = signal => { if (signal?.aborted) throw new DOMException('Depth was cancelled.', 'AbortError'); };
const hex = buffer => Array.from(new Uint8Array(buffer), value => value.toString(16).padStart(2, '0')).join('');
const clamp01 = value => value < 0 ? 0 : value > 1 ? 1 : value;
const isPixels = image => image && Number.isInteger(image.width) && Number.isInteger(image.height) && image.width > 0 && image.height > 0 && image.data?.length === image.width * image.height * 4;
const checkPixels = image => {
  if (!isPixels(image)) throw new TypeError('Pass an image as { width, height, data } with RGBA bytes.');
  if (image.width * image.height > DEPTH_LIMITS.pixels) throw new DepthError('image-too-large', `Depth works on images up to ${DEPTH_LIMITS.pixels / 1e6} megapixels.`);
};
const checkDepth = depth => {
  if (!depth || !Number.isInteger(depth.width) || !Number.isInteger(depth.height) || depth.width < 1 || depth.height < 1 || !(depth.data?.length === depth.width * depth.height)) throw new TypeError('Pass a depth map as { width, height, data } with one value per pixel.');
};

/** Which pinned file a Hub URL names: `{ kind: 'weights' | 'config', path, spec, pinned }`, or `null` for any other URL. */
export function depthModelFile(url, model = DEPTH_MODEL) {
  let parsed; try { parsed = new URL(String(url)); } catch { return null; }
  const prefix = `/${model.repo}/resolve/`;
  if (parsed.origin !== new URL(model.host).origin || !parsed.pathname.startsWith(prefix)) return null;
  const rest = decodeURIComponent(parsed.pathname.slice(prefix.length)), cut = rest.indexOf('/');
  if (cut < 1) return null;
  const revision = rest.slice(0, cut), path = rest.slice(cut + 1), pinned = revision === model.revision;
  const weights = Object.values(model.weights).find(spec => spec.file === path);
  if (weights) return { kind: 'weights', path, spec: weights, pinned };
  if (Object.hasOwn(model.config, path)) return { kind: 'config', path, spec: model.config[path], pinned };
  // Unlisted ONNX files are still weights: they are never allowed through unverified.
  return /\.onnx(?:_data)?$/i.test(path) ? { kind: 'weights', path, spec: null, pinned } : { kind: 'other', path, spec: null, pinned };
}
/** The pinned URL of a model file. */
export const depthModelUrl = (path, model = DEPTH_MODEL) => `${model.host}/${model.repo}/resolve/${model.revision}/${path}`;

/** Check bytes against a pinned file: SHA-256 for weights, the Git blob id (SHA-1 of `blob <size>\0…`) for config. */
export async function verifyDepthFile(bytes, spec, { subtle = globalThis.crypto?.subtle } = {}) {
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : null;
  if (!view || !spec || view.byteLength !== spec.bytes) return false;
  if (!subtle) throw new DepthError('unsupported-browser', 'This browser needs secure-context Web Crypto to verify model downloads.');
  if (spec.sha256) return hex(await subtle.digest('SHA-256', view)) === spec.sha256;
  const head = new TextEncoder().encode(`blob ${view.byteLength}\0`), joined = new Uint8Array(head.length + view.byteLength);
  joined.set(head); joined.set(view, head.length);
  return hex(await subtle.digest('SHA-1', joined)) === spec.gitSha1;
}

async function readCapped(response, limit, signal, onBytes) {
  if (Number(response.headers?.get?.('content-length')) > limit) throw new DepthError('unverified-model', 'The model file is larger than its reviewed size.');
  if (!response.body?.getReader) { const buffer = await response.arrayBuffer(); if (buffer.byteLength > limit) throw new DepthError('unverified-model', 'The model file is larger than its reviewed size.'); onBytes?.(buffer.byteLength); return new Uint8Array(buffer); }
  const reader = response.body.getReader(), chunks = []; let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      aborted(signal); const item = await reader.read(); if (item.done) break;
      size += item.value.byteLength;
      if (size > limit) throw new DepthError('unverified-model', 'The model file is larger than its reviewed size.');
      chunks.push(item.value); onBytes?.(size);
    }
  } finally { signal?.removeEventListener('abort', cancel); }
  aborted(signal);
  const out = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.byteLength; }
  return out;
}

/**
 * A transformers.js custom cache (`env.customCache`) that serves only verified bytes for the pinned model.
 * Pinned files are fetched once, checked and kept in Cache Storage under their hash; weights from any other
 * revision, or ONNX files that are not pinned, throw `unverified-model` instead of downloading. Every other URL
 * falls through to `fallback` (or a miss), so the host's other models are untouched.
 */
const CACHE_NAME = 'optimai-depth-models-v1';
const cacheKey = spec => new URL(`/__optimai_depth_models__/${spec.sha256 || spec.gitSha1}`, globalThis.location?.origin || 'http://localhost').href;
/** Whether the weights `depthModelPlan` would pick are already stored in this browser (checked again when they load). */
export async function isDepthModelCached({ device, dtype, gpu, caches = globalThis.caches } = {}) {
  const spec = DEPTH_MODEL.weights[depthModelPlan({ device, dtype, gpu }).dtype];
  try { return Boolean(await (await caches?.open(CACHE_NAME))?.match(cacheKey(spec))); } catch { return false; }
}

export function createVerifiedModelCache({ model = DEPTH_MODEL, fetch = globalThis.fetch, caches = globalThis.caches, subtle = globalThis.crypto?.subtle, fallback = null, signal, onProgress } = {}) {
  const pending = new Map(), name = CACHE_NAME;
  const total = Object.values(model.config).reduce((sum, spec) => sum + spec.bytes, 0);
  async function load(path, spec) {
    aborted(signal);
    const key = cacheKey(spec);
    const store = await caches?.open?.(name).catch(() => null);
    const hit = await store?.match(key).catch(() => null);
    if (hit) {
      const bytes = await readCapped(hit, spec.bytes, signal);
      if (await verifyDepthFile(bytes, spec, { subtle })) { onProgress?.({ stage: 'verify', file: path, loaded: spec.bytes, total: spec.bytes, cached: true }); return bytes; }
      await store.delete(key).catch(() => {});
    }
    if (typeof fetch !== 'function') throw new DepthError('download-failed', 'This browser cannot download the depth model.');
    let response;
    try { response = await fetch(depthModelUrl(path, model), { signal, credentials: 'omit', redirect: 'follow' }); }
    catch (error) { if (error?.name === 'AbortError') throw error; throw new DepthError('download-failed', 'The depth model could not be downloaded. Check your connection and try again.', { cause: error }); }
    if (!response?.ok) throw new DepthError('download-failed', `The depth model could not be downloaded (${response?.status ?? 'no response'}).`);
    const bytes = await readCapped(response, spec.bytes, signal, loaded => onProgress?.({ stage: 'download', file: path, loaded, total: spec.bytes }));
    onProgress?.({ stage: 'verify', file: path, loaded: spec.bytes, total: spec.bytes });
    if (!(await verifyDepthFile(bytes, spec, { subtle }))) throw new DepthError('unverified-model', `${path} does not match its reviewed checksum, so it will not run.`);
    await store?.put(key, new Response(bytes, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(spec.bytes) } })).catch(() => {});
    return bytes;
  }
  return Object.freeze({
    model, configBytes: total,
    async match(request) {
      const url = typeof request === 'string' ? request : request?.url, file = depthModelFile(url, model);
      if (!file) return fallback?.match ? fallback.match(request) : undefined;
      if (file.kind === 'weights' && (!file.pinned || !file.spec)) throw new DepthError('unverified-model', `${file.path} is not a reviewed depth model file, so it will not run.`);
      if (!file.spec || !file.pinned) return fallback?.match ? fallback.match(request) : undefined;
      if (!pending.has(file.path)) pending.set(file.path, load(file.path, file.spec).catch(error => { pending.delete(file.path); throw error; }));
      const bytes = await pending.get(file.path);
      return new Response(bytes.slice(), { status: 200, headers: { 'content-type': file.kind === 'config' ? 'application/json' : 'application/octet-stream', 'content-length': String(bytes.byteLength) } });
    },
    // Pinned files are already stored by hash; anything else goes to the host's own cache.
    async put(request, response) { const url = typeof request === 'string' ? request : request?.url; if (!depthModelFile(url, model) && fallback?.put) return fallback.put(request, response); },
  });
}

/** Choose the device and weight precision: WebGPU with fp16 when the browser has it, otherwise WebAssembly with q8. */
export function depthModelPlan({ device, dtype, gpu = Boolean(globalThis.navigator?.gpu) } = {}) {
  const chosen = device ?? (gpu ? 'webgpu' : 'wasm');
  if (!['webgpu', 'wasm'].includes(chosen)) throw new RangeError('Depth runs on webgpu or wasm.');
  const precision = dtype ?? (chosen === 'webgpu' ? 'fp16' : 'q8');
  if (!Object.hasOwn(DEPTH_MODEL.weights, precision)) throw new RangeError(`Depth weights come as ${Object.keys(DEPTH_MODEL.weights).join(', ')}.`);
  const spec = DEPTH_MODEL.weights[precision];
  return Object.freeze({ device: chosen, dtype: precision, file: spec.file, bytes: spec.bytes + Object.values(DEPTH_MODEL.config).reduce((sum, item) => sum + item.bytes, 0) });
}

/** Box-average RGBA down so the long side is at most `side`; returns the input when it already fits. */
export function shrinkPixels(image, side) {
  checkPixels(image);
  const scale = Math.min(1, side / Math.max(image.width, image.height));
  if (scale === 1) return image;
  const width = Math.max(1, Math.round(image.width * scale)), height = Math.max(1, Math.round(image.height * scale)), data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * image.height / height), y1 = Math.max(y0 + 1, Math.floor((y + 1) * image.height / height));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * image.width / width), x1 = Math.max(x0 + 1, Math.floor((x + 1) * image.width / width));
      let r = 0, g = 0, b = 0, a = 0; const n = (x1 - x0) * (y1 - y0);
      for (let yy = y0; yy < y1; yy++) for (let xx = x0, i = (yy * image.width + xx) * 4; xx < x1; xx++, i += 4) { r += image.data[i]; g += image.data[i + 1]; b += image.data[i + 2]; a += image.data[i + 3]; }
      const o = (y * width + x) * 4; data[o] = r / n; data[o + 1] = g / n; data[o + 2] = b / n; data[o + 3] = a / n;
    }
  }
  return { width, height, data };
}

/** Stretch a depth map to 0–1 (2nd to 98th percentile), keeping its size. */
export function normalizeDepth(depth, { invert = false } = {}) {
  checkDepth(depth);
  const sorted = Float32Array.from(depth.data).sort(), n = sorted.length;
  const lo = sorted[Math.floor(n * 0.02)], hi = sorted[Math.min(n - 1, Math.ceil(n * 0.98))], span = hi - lo || 1, data = new Float32Array(n);
  for (let i = 0; i < n; i++) { const value = clamp01((depth.data[i] - lo) / span); data[i] = invert ? 1 - value : value; }
  return { width: depth.width, height: depth.height, data, source: depth.source ?? 'host' };
}

function blur(data, width, height, radius) {
  if (radius < 1) return data;
  const tmp = new Float32Array(data.length), out = new Float32Array(data.length);
  for (let y = 0; y < height; y++) {
    let sum = 0; const row = y * width;
    for (let x = -radius; x <= radius; x++) sum += data[row + Math.min(width - 1, Math.max(0, x))];
    for (let x = 0; x < width; x++) { tmp[row + x] = sum / (radius * 2 + 1); sum += data[row + Math.min(width - 1, x + radius + 1)] - data[row + Math.max(0, x - radius)]; }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(height - 1, Math.max(0, y)) * width + x];
    for (let y = 0; y < height; y++) { out[y * width + x] = sum / (radius * 2 + 1); sum += tmp[Math.min(height - 1, y + radius + 1) * width + x] - tmp[Math.max(0, y - radius) * width + x]; }
  }
  return out;
}

/**
 * A model-free depth guess: lower in the frame and busier (more local detail) reads as nearer, blurred so it
 * moves in soft layers. It is a stand-in for previews, not an estimate. `source: 'guess'`.
 */
export function guessDepth(image, { side = DEPTH_LIMITS.guessSide } = {}) {
  const small = shrinkPixels(image, side), { width, height } = small, luma = new Float32Array(width * height), detail = new Float32Array(width * height);
  for (let i = 0; i < luma.length; i++) luma[i] = (small.data[i * 4] * 0.2126 + small.data[i * 4 + 1] * 0.7152 + small.data[i * 4 + 2] * 0.0722) / 255;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, dx = luma[y * width + Math.min(width - 1, x + 1)] - luma[y * width + Math.max(0, x - 1)], dy = luma[Math.min(height - 1, y + 1) * width + x] - luma[Math.max(0, y - 1) * width + x];
    detail[i] = Math.hypot(dx, dy);
  }
  const radius = Math.max(1, Math.round(Math.max(width, height) / 24)), busy = normalizeDepth({ width, height, data: blur(detail, width, height, radius) }).data, mix = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) mix[y * width + x] = 0.6 * (height > 1 ? y / (height - 1) : 0.5) + 0.4 * busy[y * width + x];
  return { ...normalizeDepth({ width, height, data: blur(mix, width, height, radius) }), source: 'guess' };
}

/** Grey RGBA of a depth map (near = white) for showing it next to the photo. */
export function depthToPixels(depth) {
  checkDepth(depth);
  const data = new Uint8ClampedArray(depth.width * depth.height * 4);
  for (let i = 0; i < depth.data.length; i++) { const v = Math.round(clamp01(depth.data[i]) * 255); data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v; data[i * 4 + 3] = 255; }
  return { width: depth.width, height: depth.height, data };
}

/** The model's input size for a picture, as its preprocessor makes it: scale as little as possible, sides a multiple of 14. */
export function depthInputSize(width, height, { size, multiple } = DEPTH_MODEL.preprocess) {
  if (!(width > 0 && height > 0)) throw new RangeError('A picture has a positive width and height.');
  let sw = size / width, sh = size / height;
  if (Math.abs(1 - sw) < Math.abs(1 - sh)) sh = sw; else sw = sh;
  const fit = value => Math.max(multiple, Math.round(value / multiple) * multiple);
  return { width: fit(width * sw), height: fit(height * sh) };
}
/** RGBA pixels → the model's float32 NCHW input (bilinear resize, ImageNet normalize). */
export function depthInputTensor(image, { preprocess = DEPTH_MODEL.preprocess } = {}) {
  checkPixels(image);
  const { width, height } = depthInputSize(image.width, image.height, preprocess), source = shrinkPixels(image, Math.max(width, height) * 1.5), plane = width * height, data = new Float32Array(plane * 3);
  const { mean, std } = preprocess, sx = source.width / width, sy = source.height / height, px = source.data;
  for (let y = 0; y < height; y++) {
    const v = Math.min(source.height - 1, Math.max(0, (y + 0.5) * sy - 0.5)), y0 = Math.floor(v), y1 = Math.min(source.height - 1, y0 + 1), fy = v - y0;
    for (let x = 0; x < width; x++) {
      const u = Math.min(source.width - 1, Math.max(0, (x + 0.5) * sx - 0.5)), x0 = Math.floor(u), x1 = Math.min(source.width - 1, x0 + 1), fx = u - x0;
      const a = (y0 * source.width + x0) * 4, b = (y0 * source.width + x1) * 4, c = (y1 * source.width + x0) * 4, d = (y1 * source.width + x1) * 4;
      for (let ch = 0; ch < 3; ch++) data[ch * plane + y * width + x] = ((px[a + ch] * (1 - fx) + px[b + ch] * fx) * (1 - fy) + (px[c + ch] * (1 - fx) + px[d + ch] * fx) * fy) / 255 / std[ch] - mean[ch] / std[ch];
    }
  }
  return { data, dims: [1, 3, height, width], width, height };
}

async function verifiedWeights(plan, options) {
  const cache = createVerifiedModelCache(options), response = await cache.match(depthModelUrl(plan.file));
  return new Uint8Array(await response.arrayBuffer());
}
async function ortSession(ort, plan, options) {
  const bytes = await verifiedWeights(plan, options); aborted(options.signal);
  // Severity 3 = errors only: ORT otherwise logs routine placement notes (shape ops on the CPU) through console.error.
  return ort.InferenceSession.create(bytes, { executionProviders: [plan.device], graphOptimizationLevel: 'all', logSeverityLevel: 3 });
}

/**
 * Run Depth Anything V2 Small through the host's `onnxruntime-web` module (`ort`), its `@huggingface/transformers`
 * module (`transformers`), or a depth-estimation function the host already built (`pipeline`). With `ort`, the SDK
 * fetches and verifies the weights itself, hands the bytes to ONNX Runtime and does the resize and normalize; if
 * WebGPU fails to start it falls back once to WebAssembly with the q8 weights. With `transformers`, the SDK installs
 * `createVerifiedModelCache` (chained to any cache already set), turns off local and browser model caches, and loads
 * the pinned revision with `depthModelPlan` precision. `estimate(image)` takes RGBA pixels and returns a normalized
 * depth map at the (possibly shrunk) input size.
 */
export async function createDepthEstimator({ ort, transformers, pipeline, device, dtype, gpu, fetch, caches, subtle, signal, onProgress } = {}) {
  aborted(signal);
  let run, plan = null, session = null, RawImage = transformers?.RawImage;
  if (typeof pipeline === 'function') run = pipeline;
  else if (ort) {
    if (typeof ort.InferenceSession?.create !== 'function' || typeof ort.Tensor !== 'function') throw new DepthError('runtime-missing', `Pass the ${DEPTH_ORT_RUNTIME.package}@${DEPTH_ORT_RUNTIME.version} module as { ort }.`);
    plan = depthModelPlan({ device, dtype, gpu });
    const load = () => ortSession(ort, plan, { fetch, caches, subtle, signal, onProgress: event => onProgress?.({ ...event, total: plan.bytes - DEPTH_CONFIG_BYTES, model: DEPTH_MODEL.id }) });
    try { session = await load(); }
    catch (error) {
      if (error instanceof DepthError || error?.name === 'AbortError') throw error;
      if (plan.device !== 'webgpu' || device === 'webgpu') throw new DepthError('load-failed', 'The depth model could not start on this device.', { cause: error });
      plan = depthModelPlan({ device: 'wasm' });
      try { session = await load(); } catch (again) { if (again instanceof DepthError || again?.name === 'AbortError') throw again; throw new DepthError('load-failed', 'The depth model could not start on this device.', { cause: again }); }
    }
    aborted(signal);
    run = async image => {
      const input = depthInputTensor(image), feeds = { [session.inputNames[0]]: new ort.Tensor('float32', input.data, input.dims) };
      const results = await session.run(feeds), output = results[session.outputNames[0]];
      const value = { predicted_depth: { dims: [...output.dims], data: Float32Array.from(output.data) } };
      for (const tensor of Object.values(results)) tensor.dispose?.();
      return value;
    };
  } else {
    if (typeof transformers?.pipeline !== 'function' || !transformers.env || typeof RawImage !== 'function') throw new DepthError('runtime-missing', `Install ${DEPTH_RUNTIME.package}@${DEPTH_RUNTIME.version} and pass the module as { transformers }.`);
    plan = depthModelPlan({ device, dtype, gpu });
    const { env } = transformers, previous = env.useCustomCache ? env.customCache : null;
    Object.assign(env, { allowLocalModels: false, useBrowserCache: false, useCustomCache: true, customCache: createVerifiedModelCache({ fetch, caches, subtle, signal, fallback: previous, onProgress: event => onProgress?.({ ...event, total: plan.bytes, model: DEPTH_MODEL.id }) }) });
    try { run = await transformers.pipeline('depth-estimation', DEPTH_MODEL.repo, { revision: DEPTH_MODEL.revision, device: plan.device, dtype: plan.dtype }); }
    catch (error) { if (error instanceof DepthError || error?.name === 'AbortError') throw error; throw new DepthError('load-failed', 'The depth model could not start on this device.', { cause: error }); }
    aborted(signal);
  }
  let closed = false;
  return Object.freeze({
    model: DEPTH_MODEL.id, device: plan?.device ?? 'host', dtype: plan?.dtype ?? 'host',
    async estimate(image, { signal: runSignal } = {}) {
      if (closed) throw new DepthError('closed', 'This depth estimator was closed.');
      aborted(runSignal);
      const input = shrinkPixels(image, DEPTH_LIMITS.inputSide);
      const raw = RawImage && !session ? new RawImage(input.data instanceof Uint8ClampedArray ? input.data : Uint8ClampedArray.from(input.data), input.width, input.height, 4) : input;
      const result = await run(raw); aborted(runSignal);
      const map = Array.isArray(result) ? result[0] : result, picture = map?.depth, tensor = map?.predicted_depth;
      let depth;
      if (picture?.data && picture.width && picture.height) {
        const channels = picture.channels ?? picture.data.length / (picture.width * picture.height), data = new Float32Array(picture.width * picture.height);
        for (let i = 0; i < data.length; i++) data[i] = picture.data[i * channels];
        depth = { width: picture.width, height: picture.height, data };
      } else if (tensor?.data && tensor.dims?.length >= 2) {
        const [height, width] = tensor.dims.slice(-2); depth = { width, height, data: Float32Array.from(tensor.data) };
      } else throw new DepthError('bad-output', 'The depth model returned no depth map.');
      if (depth.width * depth.height > DEPTH_LIMITS.depthPixels) throw new DepthError('bad-output', 'The depth map is larger than expected.');
      return { ...normalizeDepth(depth), source: plan ? 'model' : 'host', model: DEPTH_MODEL.id, inputWidth: input.width, inputHeight: input.height };
    },
    async dispose() { closed = true; await run?.dispose?.(); await session?.release?.(); },
  });
}

/** Depth Motion recipe values → `{ camera, strength, depth }` (defaults: `slow push`, `subtle`). */
export function depthMotionSettings(values = {}) {
  const camera = values.camera ?? 'slow push', depth = values.depth ?? 'subtle';
  if (!DEPTH_CAMERAS.includes(camera)) throw new RangeError(`Camera movement is one of ${DEPTH_CAMERAS.join(', ')}.`);
  const strength = typeof depth === 'number' ? depth : DEPTH_STRENGTHS[depth];
  if (!Number.isFinite(strength) || strength < 0 || strength > 0.1) throw new RangeError('Depth strength is subtle, medium or a number from 0 to 0.1.');
  return Object.freeze({ camera, depth: typeof depth === 'number' ? 'custom' : depth, strength });
}

const smooth = t => t * t * (3 - 2 * t);
/**
 * The camera view at `time` (0–1 through the clip): `x`, `y` are the shift of the nearest layer as a fraction
 * of the short side, `zoom` the extra scale of the nearest layer, `focus` the depth that stays still.
 * Locked breathes a little; slow push dollies in; orbit circles; tracking slides across; handheld drifts.
 */
export function depthCameraAt(values, time) {
  const { camera, strength: a } = values?.strength === undefined ? depthMotionSettings(values) : values, t = clamp01(Number(time) || 0), turn = Math.PI * 2 * t;
  switch (camera) {
    case 'locked': return { x: 0, y: 0, zoom: a * 0.6 * (1 - Math.cos(turn)) / 2, focus: 0.5 };
    case 'slow push': return { x: 0, y: -a * 0.25 * smooth(t), zoom: a * 2.4 * smooth(t), focus: 0 };
    case 'orbit': return { x: a * Math.sin(turn), y: a * 0.3 * (1 - Math.cos(turn)) / 2, zoom: 0, focus: 0.45 };
    case 'tracking': return { x: a * (2 * smooth(t) - 1), y: 0, zoom: 0, focus: 0.45 };
    default: return { x: a * 0.45 * (Math.sin(turn * 1.3) + 0.5 * Math.sin(turn * 3.1 + 1)), y: a * 0.35 * (Math.sin(turn * 1.7 + 2) + 0.5 * Math.sin(turn * 2.9)), zoom: a * 0.3 * (1 - Math.cos(turn)) / 2, focus: 0.5 };
  }
}
/** How far the frame must be scaled up so no view in the clip shows a border. */
export const depthOverscan = values => { const { strength } = values?.strength === undefined ? depthMotionSettings(values) : values; return 1 + strength * 2.6; };

/**
 * Prepare one photo and its depth map for repeated views. The depth is resized to the photo, grown a little toward
 * the near side (so foreground edges stay whole), and `render(view, out?)` warps the photo for a
 * `depthCameraAt` view: every source pixel's depth is splatted to where the camera moves it, nearest wins (so near
 * layers cover far ones without ghosts), each covered pixel samples the photo bilinearly through its winning layer,
 * and uncovered gaps copy the farther covered neighbour on their row (the background stretches, never the subject).
 */
export function createParallaxRenderer(image, depth, { overscan = 1.06 } = {}) {
  checkPixels(image); checkDepth(depth);
  if (!Number.isFinite(overscan) || overscan < 1 || overscan > 1.5) throw new RangeError('Overscan is from 1 to 1.5.');
  const { width, height, data: src } = image, n = width * height, field = new Float32Array(n);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(depth.height - 1, Math.max(0, (y + 0.5) * depth.height / height - 0.5)), y0 = Math.floor(sy), y1 = Math.min(depth.height - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < width; x++) {
      const sx = Math.min(depth.width - 1, Math.max(0, (x + 0.5) * depth.width / width - 0.5)), x0 = Math.floor(sx), x1 = Math.min(depth.width - 1, x0 + 1), fx = sx - x0, d = depth.data;
      field[y * width + x] = clamp01((d[y0 * depth.width + x0] * (1 - fx) + d[y0 * depth.width + x1] * fx) * (1 - fy) + (d[y1 * depth.width + x0] * (1 - fx) + d[y1 * depth.width + x1] * fx) * fy);
    }
  }
  // Grow near regions by a few pixels (max filter, separable) so a warped edge keeps its foreground. No blur: a soft
  // band would smear the subject into the background it uncovers.
  const grow = Math.max(1, Math.round(Math.min(width, height) / 160)), tmp = new Float32Array(n), grown = new Float32Array(n);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { let m = 0; for (let k = -grow; k <= grow; k++) m = Math.max(m, field[y * width + Math.min(width - 1, Math.max(0, x + k))]); tmp[y * width + x] = m; }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { let m = 0; for (let k = -grow; k <= grow; k++) m = Math.max(m, tmp[Math.min(height - 1, Math.max(0, y + k)) * width + x]); grown[y * width + x] = m; }
  const soft = grown, layer = new Float32Array(n), fromX = new Float32Array(n), fromY = new Float32Array(n), left = new Int32Array(width);
  return Object.freeze({
    width, height, depth: soft,
    render(view = {}, out = new Uint8ClampedArray(n * 4)) {
      if (out.length !== n * 4) throw new TypeError('The output must be width × height × 4 bytes.');
      const short = Math.min(width, height), sx = (Number(view.x) || 0) * short, sy = (Number(view.y) || 0) * short, zoom = Number(view.zoom) || 0, focus = Number.isFinite(view.focus) ? view.focus : 0.5, cx = (width - 1) / 2, cy = (height - 1) / 2;
      // Forward: a source pixel q at depth d lands at c + ((q - c)(1 + zoom·k) + shift·k)·overscan, k = d - focus.
      layer.fill(-1);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const d = soft[y * width + x], k = d - focus, s = 1 + zoom * k;
        const ox = cx + ((x - cx) * s + sx * k) * overscan, oy = cy + ((y - cy) * s + sy * k) * overscan, x0 = Math.floor(ox), y0 = Math.floor(oy);
        for (let ty = y0; ty <= y0 + 1; ty++) if (ty >= 0 && ty < height) for (let tx = x0; tx <= x0 + 1; tx++) if (tx >= 0 && tx < width && d > layer[ty * width + tx]) layer[ty * width + tx] = d;
      }
      // Covered pixels walk back through their own layer. A gap copies where the farther of its nearest covered
      // neighbours on the row came from, so the uncovered background stretches from a background pixel.
      for (let i = 0; i < n; i++) {
        if (layer[i] < 0) continue;
        const x = i % width, y = (i - x) / width, k = layer[i] - focus, s = 1 + zoom * k;
        fromX[i] = cx + ((x - cx) / overscan - sx * k) / s; fromY[i] = cy + ((y - cy) / overscan - sy * k) / s;
      }
      for (let y = 0; y < height; y++) {
        const row = y * width; let last = -1;
        for (let x = 0; x < width; x++) { if (layer[row + x] >= 0) last = row + x; left[x] = last; }
        last = -1;
        for (let x = width - 1; x >= 0; x--) {
          const i = row + x;
          if (layer[i] >= 0) { last = i; continue; }
          const a = left[x], pick = a < 0 ? last : last < 0 ? a : layer[a] <= layer[last] ? a : last;
          if (pick < 0) { fromX[i] = cx + (x - cx) / overscan; fromY[i] = cy + (y - cy) / overscan; } else { fromX[i] = fromX[pick]; fromY[i] = fromY[pick]; }
        }
      }
      for (let i = 0; i < n; i++) {
        const u = Math.min(width - 1, Math.max(0, fromX[i])), v = Math.min(height - 1, Math.max(0, fromY[i]));
        const x0 = Math.floor(u), y0 = Math.floor(v), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1), fx = u - x0, fy = v - y0, o = i * 4;
        const a = (y0 * width + x0) * 4, b = (y0 * width + x1) * 4, c = (y1 * width + x0) * 4, d = (y1 * width + x1) * 4;
        for (let ch = 0; ch < 4; ch++) out[o + ch] = (src[a + ch] * (1 - fx) + src[b + ch] * fx) * (1 - fy) + (src[c + ch] * (1 - fx) + src[d + ch] * fx) * fy;
      }
      return out;
    },
  });
}

/**
 * Depth Motion as a video clip: `draw(index, frames)` puts frame `index` of the recipe's camera move on `canvas`
 * (pass one, or a `document` must exist), ready for `exportCanvasVideo`. The photo is RGBA pixels the host read;
 * `depth` comes from `createDepthEstimator`, `guessDepth` or the host. The clip is the photo's size.
 */
export function createDepthMotionClip({ image, depth, values = {}, seconds = DEPTH_MOTION_CLIP.seconds, canvas } = {}) {
  const settings = values?.strength === undefined ? depthMotionSettings(values) : values;
  if (!Number.isFinite(seconds) || seconds < 0.5 || seconds > 30) throw new RangeError('A depth motion clip lasts 0.5 to 30 seconds.');
  const renderer = createParallaxRenderer(image, depth, { overscan: depthOverscan(settings) }), surface = canvas ?? globalThis.document?.createElement('canvas');
  if (!surface) throw new DepthError('unsupported-browser', 'Pass a canvas to draw the clip.');
  surface.width = image.width; surface.height = image.height;
  const ctx = surface.getContext('2d'); if (!ctx) throw new DepthError('unsupported-browser', 'This browser cannot create a canvas.');
  const frame = ctx.createImageData(image.width, image.height);
  let closed = false;
  return Object.freeze({
    canvas: surface, width: image.width, height: image.height, seconds, camera: settings.camera, depth: settings.depth, source: depth.source ?? 'host',
    /** The camera view of frame `index` of `frames`, for a preview strip. */
    view: (index, frames) => depthCameraAt(settings, frames > 1 ? index / (frames - 1) : 0),
    draw(index, frames) {
      if (closed) throw new DepthError('closed', 'This clip was closed.');
      if (!Number.isInteger(frames) || frames < 1 || !Number.isInteger(index) || index < 0 || index >= frames) throw new RangeError('A clip frame is a whole number inside the clip.');
      renderer.render(depthCameraAt(settings, frames > 1 ? index / (frames - 1) : 0), frame.data); ctx.putImageData(frame, 0, 0);
    },
    close() { closed = true; surface.width = surface.height = 0; },
  });
}
