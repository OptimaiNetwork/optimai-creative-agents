/** Host-supplied, pinned MediaPipe module. Frame inference stays in this worker. */
import { VISION_MODELS } from './vision-runtime.mjs';
import { CAMERA_LIMITS } from './camera-runtime.mjs';

function compact(result, timestamp) {
  const points = result.faceLandmarks?.[0];
  return {
    found: Boolean(points?.length), timestamp,
    blendshapes: Object.fromEntries((result.faceBlendshapes?.[0]?.categories ?? []).filter(value => Number.isFinite(value.score)).map(value => [value.categoryName, value.score])),
    matrix: Array.from(result.facialTransformationMatrixes?.[0]?.data ?? []),
    anchors: points ? [33, 263, 1, 152].map(index => ({ x: points[index].x, y: points[index].y })) : [],
  };
}
async function verifyModel(buffer) {
  const model = VISION_MODELS['face-reference'];
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== model.bytes || !globalThis.crypto?.subtle) throw new Error('The face tracker requires the pinned verified model.');
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), value => value.toString(16).padStart(2, '0')).join('');
  if (digest !== model.sha256) throw new Error('The face tracker rejected an unverified model.');
}
export function installCameraWorker(vision, { scope = globalThis } = {}) {
  let task = null, initializing = false, closed = false, lastTimestamp = -Infinity, frameCanvas = null, frameContext = null;
  const sendError = message => { if (!closed) scope.postMessage({ type: 'error', message }); };
  const dispose = () => { if (closed) return; closed = true; task?.close(); task = null; scope.onmessage = null; };
  async function initialize(data) {
    if (initializing || task || closed) return;
    initializing = true;
    await verifyModel(data.modelBuffer);
    if (typeof data.wasmBaseUrl !== 'string' || !data.wasmBaseUrl.trim()) throw new Error('Provide a pinned same-origin tracking WASM path.');
    const base = new URL(data.wasmBaseUrl, scope.location?.origin);
    if (base.origin !== scope.location?.origin || !['http:', 'https:'].includes(base.protocol) || base.search || base.hash || base.username || base.password) throw new Error('The tracking worker requires a same-origin WASM runtime.');
    if (!vision?.FilesetResolver || !vision?.FaceLandmarker || typeof OffscreenCanvas === 'undefined') throw new Error('This browser does not support worker face tracking.');
    if (!(await vision.FilesetResolver.isSimdSupported())) throw new Error('Face tracking needs WebAssembly SIMD. Update your browser and try again.');
    const files = await vision.FilesetResolver.forVisionTasks(base.href, true);
    const created = await vision.FaceLandmarker.createFromOptions(files, {
      canvas: new OffscreenCanvas(640, 360),
      baseOptions: { modelAssetBuffer: new Uint8Array(data.modelBuffer), delegate: 'CPU' },
      runningMode: 'VIDEO', numFaces: 1, minFaceDetectionConfidence: .5, minFacePresenceConfidence: .5, minTrackingConfidence: .5,
      outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
    });
    if (closed) { created.close(); return; }
    task = created; frameCanvas = new OffscreenCanvas(640, 360); frameContext = frameCanvas.getContext('2d');
    if (!frameContext) throw new Error('The tracker could not create a local frame canvas.');
    scope.postMessage({ type: 'ready' });
  }
  scope.onmessage = event => {
    const data = event.data;
    if (data?.type === 'init') { void initialize(data).catch(reason => { task?.close(); task = null; initializing = false; sendError(reason instanceof Error ? reason.message : 'Face tracking could not initialize.'); }); }
    else if (data?.type === 'dispose') dispose();
    else if (data?.type === 'frame') {
      const bitmap = data.bitmap;
      try {
        if (!task || closed || !frameContext || !Number.isFinite(data.timestamp) || data.timestamp <= lastTimestamp || !bitmap || !Number.isInteger(bitmap.width) || !Number.isInteger(bitmap.height) || bitmap.width < 1 || bitmap.height < 1 || bitmap.width > CAMERA_LIMITS.width || bitmap.height > CAMERA_LIMITS.height) throw new Error('Tracking is not ready for this frame.');
        lastTimestamp = data.timestamp; frameContext.drawImage(bitmap, 0, 0, frameCanvas.width, frameCanvas.height);
        scope.postMessage({ type: 'face', frame: compact(task.detectForVideo(frameCanvas, data.timestamp), data.timestamp) });
      } catch (reason) { sendError(reason instanceof Error ? reason.message : 'Face tracking could not read this frame.'); }
      finally { bitmap?.close?.(); }
    }
  };
  return { dispose };
}
