/** Reviewed browser vision orchestration. Images never leave the browser. */
import { validateLocalImageFile } from './browser-runtime.mjs';

export const VISION_LIMITS = Object.freeze({ inputBytes: 20 * 1024 * 1024, dimension: 4096, pixels: 16000000, analysisDimension: 1600, outputBytes: 20 * 1024 * 1024, modelBytes: 8 * 1024 * 1024, downloadTimeoutMs: 90000, inferenceTimeoutMs: 60000 });
export const VISION_MODELS = Object.freeze({
  'person-cutout': Object.freeze({ id: 'selfie-segmenter-v1', name: 'MediaPipe Selfie Segmenter', bytes: 249537, sha256: '191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b', url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite', task: 'People only · portrait photos · transparent or solid background' }),
  'pose-reference': Object.freeze({ id: 'pose-landmarker-lite-v1', name: 'MediaPipe Pose Landmarker Lite', bytes: 5777746, sha256: '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a', url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task', task: 'One person in a still image · 33 pose landmarks' }),
  'face-reference': Object.freeze({ id: 'face-landmarker-v1', name: 'MediaPipe Face Landmarker', bytes: 3758596, sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff', url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', task: 'One visible face · 478 landmarks and raw blendshape coefficients' }),
});
const memory = new Map();
const CACHE = 'optimai-vision-models-v1';
export class VisionError extends Error {
  constructor(code, message) { super(message); this.name = 'VisionError'; this.code = code; }
}
function modelFor(operation) {
  if (!Object.hasOwn(VISION_MODELS, operation)) throw new VisionError('invalid-operation', 'Choose a supported browser vision utility.');
  return VISION_MODELS[operation];
}
function aborted(signal) { if (signal?.aborted) throw new DOMException('Vision processing was cancelled.', 'AbortError'); }
function emit(onProgress, phase, message, progress) { onProgress?.({ phase, message, ...(progress == null ? {} : { progress }) }); }
function cacheKey(model) { return new URL(`/__optimai_vision_models__/${model.id}-${model.sha256}`, globalThis.location?.origin || 'http://localhost').href; }
async function verified(model, buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== model.bytes) return false;
  if (!globalThis.crypto?.subtle) throw new VisionError('unsupported-browser', 'This browser needs secure-context Web Crypto to verify model downloads.');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  return Array.from(digest, n => n.toString(16).padStart(2, '0')).join('') === model.sha256;
}
async function readModel(model, signal) {
  aborted(signal);
  let buffer = memory.get(model.id);
  if (buffer) return buffer.slice(0);
  try {
    const cached = await (await globalThis.caches?.open(CACHE))?.match(cacheKey(model));
    if (cached) {
      if (Number(cached.headers.get('content-length')) > VISION_LIMITS.modelBytes) throw new Error('oversized');
      buffer = await cached.arrayBuffer();
      aborted(signal);
      if (await verified(model, buffer)) { memory.set(model.id, buffer); return buffer.slice(0); }
      await (await caches.open(CACHE)).delete(cacheKey(model));
    }
  } catch (error) { if (error?.name === 'AbortError' || error instanceof VisionError) throw error; }
  return null;
}
/** Checks local cache only. This function never starts a network request. */
export async function getVisionModelStatus(operation, { signal } = {}) {
  const model = modelFor(operation);
  const buffer = await readModel(model, signal);
  return { operation, model, ready: Boolean(buffer), storage: buffer ? (globalThis.caches ? 'browser-cache' : 'memory') : null };
}
/** Explicit user action: only a pinned official weight URL can be fetched. */
export async function downloadVisionModel(operation, { signal, onProgress, fetchImpl = globalThis.fetch } = {}) {
  const model = modelFor(operation);
  aborted(signal);
  const existing = await readModel(model, signal);
  if (existing) { emit(onProgress, 'ready', 'Model is ready in this browser.', 1); return getVisionModelStatus(operation, { signal }); }
  if (typeof fetchImpl !== 'function') throw new VisionError('unsupported-browser', 'This browser cannot download the vision model.');
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, VISION_LIMITS.downloadTimeoutMs);
  let reader;
  try {
    emit(onProgress, 'download', `Downloading ${model.name} weights.`, 0);
    const response = await fetchImpl(model.url, { signal: controller.signal, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
    if (!response.ok || response.redirected || (response.url && response.url !== model.url)) throw new VisionError('download-failed', 'The official model could not be downloaded. Try again when connected.');
    const declared = Number(response.headers.get('content-length'));
    if (declared > VISION_LIMITS.modelBytes) throw new VisionError('invalid-model', 'The model download is larger than the reviewed limit.');
    if (!response.body?.getReader) throw new VisionError('unsupported-browser', 'Streaming model downloads are required in this browser.');
    reader = response.body.getReader();
    const chunks = []; let size = 0;
    while (true) {
      aborted(controller.signal);
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > model.bytes || size > VISION_LIMITS.modelBytes) throw new VisionError('invalid-model', 'The model download does not match its reviewed size.');
      chunks.push(value); emit(onProgress, 'download', `Downloading ${model.name} weights.`, size / model.bytes);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    emit(onProgress, 'verify', 'Checking the model checksum.');
    if (!(await verified(model, bytes.buffer))) throw new VisionError('invalid-model', 'The model checksum did not match. No model was stored or executed.');
    aborted(controller.signal);
    memory.set(model.id, bytes.buffer);
    let storage = 'memory';
    try { if (globalThis.caches) { await (await caches.open(CACHE)).put(cacheKey(model), new Response(bytes, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(size) } })); storage = 'browser-cache'; } } catch { /* Private browsing/quota: this tab can still run the verified model. */ }
    emit(onProgress, 'ready', storage === 'memory' ? 'Model is ready for this tab. Browser storage is unavailable.' : 'Model downloaded and ready in this browser.', 1);
    return { operation, model, ready: true, storage };
  } catch (error) {
    if (timedOut) throw new VisionError('timeout', 'The model download timed out. Try again when your connection is faster.');
    if (signal?.aborted) throw new DOMException('Model download was cancelled.', 'AbortError');
    if (error instanceof VisionError) throw error;
    throw new VisionError('download-failed', 'The official model could not be downloaded. Check your connection and try again.');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); try { await reader?.cancel(); } catch {} }
}
export function getVisionAnalysisSize(width, height) {
  if (![width, height].every(n => Number.isInteger(n) && n > 0) || width > VISION_LIMITS.dimension || height > VISION_LIMITS.dimension || width * height > VISION_LIMITS.pixels) throw new VisionError('image-too-large', 'Use an image up to 4096 pixels per side and 16 million pixels.');
  const scale = Math.min(1, VISION_LIMITS.analysisDimension / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export function normalizeVisionValues(operation, values = {}) {
  modelFor(operation);
  if (operation !== 'person-cutout') return {};
  const background = values.background ?? 'transparent';
  if (background !== 'transparent' && !(typeof background === 'string' && /^#[0-9a-f]{6}$/i.test(background))) throw new VisionError('invalid-options', 'Choose transparent or a six-digit background color.');
  const threshold = Number(values.threshold ?? 0.5), softness = Number(values.softness ?? 0.12);
  if (!Number.isFinite(threshold) || threshold < 0.1 || threshold > 0.9 || !Number.isFinite(softness) || softness < 0.02 || softness > 0.4) throw new VisionError('invalid-options', 'Mask threshold must be 0.1–0.9 and edge softness 0.02–0.4.');
  return { background, threshold, softness };
}
function safeWasmBase(value) {
  const origin = globalThis.location?.origin;
  if (!origin) throw new VisionError('unsupported-browser', 'Vision utilities run in a browser.');
  const url = new URL(value, origin);
  if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new VisionError('invalid-runtime', 'The vision WASM runtime must be hosted on this application’s origin.');
  return url.href.replace(/\/$/, '');
}
async function imageBitmap(file, signal) {
  if (typeof File === 'undefined' || !(file instanceof File)) throw new VisionError('invalid-image', 'Select a local image file.');
  const message = validateLocalImageFile(file); if (message) throw new VisionError('invalid-image', message);
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer()); aborted(signal);
  const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (!((file.type === 'image/png' && png) || (file.type === 'image/jpeg' && jpeg) || (file.type === 'image/webp' && webp))) throw new VisionError('invalid-image', 'The image contents do not match PNG, JPEG or WebP.');
  if (typeof createImageBitmap !== 'function' || typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') throw new VisionError('unsupported-browser', 'This utility needs a browser with image bitmaps, Web Workers and OffscreenCanvas.');
  let bitmap;
  try { bitmap = await createImageBitmap(file); aborted(signal); getVisionAnalysisSize(bitmap.width, bitmap.height); return bitmap; } catch (error) { bitmap?.close(); if (error instanceof VisionError || error?.name === 'AbortError') throw error; throw new VisionError('invalid-image', 'This image could not be decoded. Try another PNG, JPEG or WebP.'); }
}
/** No model download here: inference uses verified cached weights and a local image only. */
export async function runBrowserVision(operation, file, values = {}, { signal, onProgress, workerFactory, wasmBaseUrl } = {}) {
  const model = modelFor(operation), normalized = normalizeVisionValues(operation, values);
  aborted(signal);
  const wasmBase = safeWasmBase(wasmBaseUrl);
  if (typeof workerFactory !== 'function') throw new VisionError('invalid-runtime', 'Provide a reviewed, bundled vision worker.');
  const modelBuffer = await readModel(model, signal);
  if (!modelBuffer) throw new VisionError('model-missing', 'Download this vision model before running it.');
  emit(onProgress, 'prepare', 'Opening your image locally.');
  let bitmap = await imageBitmap(file, signal), worker;
  const originalSize = { width: bitmap.width, height: bitmap.height };
  try {
    aborted(signal); worker = workerFactory();
    return await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); worker.onmessage = null; worker.onerror = null; error ? reject(error) : resolve(result); };
      const cancel = () => finish(new DOMException('Vision processing was cancelled.', 'AbortError'));
      const timer = setTimeout(() => finish(new VisionError('timeout', 'Vision processing took too long. Try a smaller image.')), VISION_LIMITS.inferenceTimeoutMs);
      signal?.addEventListener('abort', cancel, { once: true });
      worker.onerror = () => finish(new VisionError('inference-failed', 'The browser vision worker could not start. Try a current Chrome, Edge or Safari browser.'));
      worker.onmessage = ({ data }) => {
        if (data?.type === 'progress') { emit(onProgress, data.phase, data.message); return; }
        if (data?.type === 'error') { finish(new VisionError(data.code || 'inference-failed', data.message || 'The vision model could not process this image.')); return; }
        if (data?.type !== 'result') return;
        const result = data.result;
        if (!(result?.blob instanceof Blob) || result.blob.type !== 'image/png' || result.blob.size === 0 || result.blob.size > VISION_LIMITS.outputBytes || !Number.isInteger(result.width) || !Number.isInteger(result.height) || result.width < 1 || result.height < 1 || result.width > VISION_LIMITS.analysisDimension || result.height > VISION_LIMITS.analysisDimension || JSON.stringify(result.analysis).length > 200000) { finish(new VisionError('invalid-result', 'The vision model returned an invalid result.')); return; }
        finish(null, { ...result, operation, model: model.id, provider: 'mediapipe', originalSize, filename: `optimai-${operation}.png` });
      };
      if (signal?.aborted) { cancel(); return; }
      try { worker.postMessage({ type: 'run', operation, values: normalized, bitmap, modelBuffer, wasmBaseUrl: wasmBase }, [bitmap, modelBuffer]); bitmap = null; }
      catch { finish(new VisionError('inference-failed', 'The browser could not transfer the image to its vision worker.')); }
    });
  } finally { bitmap?.close(); worker?.terminate(); }
}
