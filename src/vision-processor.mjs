/** Worker-only MediaPipe adapter. The host supplies its pinned, bundled Tasks Vision module. */
import { VISION_MODELS, VISION_LIMITS, VisionError, getVisionAnalysisSize, normalizeVisionValues } from './vision-runtime.mjs';

export function personMaskAlpha(confidence, threshold = 0.5, softness = 0.12) {
  if (!Number.isFinite(confidence)) return 0;
  const t = Math.min(1, Math.max(0, (confidence - threshold + softness) / (softness * 2)));
  return Math.round(255 * t * t * (3 - 2 * t));
}
function point(p, index) {
  if (!p || ![p.x, p.y, p.z].every(Number.isFinite)) throw new VisionError('invalid-result', 'The vision model returned invalid landmarks.');
  return { index, x: p.x, y: p.y, z: p.z, ...(Number.isFinite(p.visibility) ? { visibility: p.visibility } : {}), ...(Number.isFinite(p.presence) ? { presence: p.presence } : {}) };
}
function overlay(ctx, points, connections, width, height, color) {
  ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.2, Math.min(width, height) / 300); ctx.lineCap = 'round';
  for (const { start, end } of connections) {
    const a = points[start], b = points[end];
    if (!a || !b || (a.visibility ?? 1) < 0.35 || (b.visibility ?? 1) < 0.35) continue;
    ctx.beginPath(); ctx.moveTo(a.x * width, a.y * height); ctx.lineTo(b.x * width, b.y * height); ctx.stroke();
  }
  ctx.fillStyle = '#fff9ed';
  const radius = Math.max(1.6, Math.min(width, height) / 250);
  for (const p of points) { if ((p.visibility ?? 1) < 0.35) continue; ctx.beginPath(); ctx.arc(p.x * width, p.y * height, radius, 0, Math.PI * 2); ctx.fill(); }
}
async function checkModel(operation, buffer) {
  const model = VISION_MODELS[operation];
  if (!model || !(buffer instanceof ArrayBuffer) || buffer.byteLength !== model.bytes) throw new VisionError('invalid-model', 'The vision worker received an invalid model.');
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), n => n.toString(16).padStart(2, '0')).join('');
  if (hash !== model.sha256) throw new VisionError('invalid-model', 'The vision worker rejected an unverified model.');
}
/** Executes one image in a dedicated worker; releases every task, mask and bitmap. */
export async function executeVisionTask({ vision, operation, bitmap, modelBuffer, wasmBaseUrl, values = {}, onProgress }) {
  let task, inference, canvas, maskCanvas;
  try {
    if (!vision?.FilesetResolver || typeof OffscreenCanvas === 'undefined') throw new VisionError('unsupported-browser', 'This browser does not support worker vision processing.');
    const options = normalizeVisionValues(operation, values);
    await checkModel(operation, modelBuffer);
    const base = new URL(wasmBaseUrl, globalThis.location?.origin);
    if (base.origin !== globalThis.location?.origin || base.search || base.hash || base.username || base.password) throw new VisionError('invalid-runtime', 'The vision worker requires a same-origin WASM runtime.');
    const { width, height } = getVisionAnalysisSize(bitmap.width, bitmap.height);
    onProgress?.({ phase: 'initialize', message: 'Starting the local vision model.' });
    // The pinned module build requires SIMD. This is available in current major browsers.
    if (!(await vision.FilesetResolver.isSimdSupported())) throw new VisionError('unsupported-browser', 'Vision utilities require WebAssembly SIMD. Update your browser and try again.');
    const fileset = await vision.FilesetResolver.forVisionTasks(base.href, true);
    const baseOptions = { modelAssetBuffer: new Uint8Array(modelBuffer), delegate: 'CPU' };
    if (operation === 'person-cutout') task = await vision.ImageSegmenter.createFromOptions(fileset, { baseOptions, runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false });
    else if (operation === 'pose-reference') task = await vision.PoseLandmarker.createFromOptions(fileset, { baseOptions, runningMode: 'IMAGE', numPoses: 1, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, outputSegmentationMasks: false });
    else task = await vision.FaceLandmarker.createFromOptions(fileset, { baseOptions, runningMode: 'IMAGE', numFaces: 1, minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: false });
    canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: operation === 'person-cutout' });
    if (!ctx) throw new VisionError('unsupported-browser', 'The browser could not create an image processing canvas.');
    ctx.drawImage(bitmap, 0, 0, width, height);
    onProgress?.({ phase: 'analyze', message: operation === 'person-cutout' ? 'Finding the person and refining the silhouette.' : 'Detecting visible landmarks in your image.' });
    let analysis;
    if (operation === 'person-cutout') {
      inference = task.segment(canvas);
      // Selfie Segmenter returns one sigmoid foreground mask; multiclass models include background first.
      const masks = inference.confidenceMasks;
      const mask = masks?.length === 1 ? masks[0] : masks?.[1];
      if (!mask) throw new VisionError('invalid-result', 'The segmentation model did not return a person mask.');
      const confidence = mask.getAsFloat32Array();
      if (!mask.width || !mask.height || confidence.length !== mask.width * mask.height || confidence.length > VISION_LIMITS.pixels) throw new VisionError('invalid-result', 'The segmentation mask has invalid dimensions.');
      maskCanvas = new OffscreenCanvas(mask.width, mask.height);
      const maskCtx = maskCanvas.getContext('2d');
      if (!maskCtx) throw new VisionError('unsupported-browser', 'The browser could not create a segmentation mask.');
      const pixels = maskCtx.createImageData(mask.width, mask.height); let foreground = 0;
      for (let i = 0; i < confidence.length; i++) {
        const alpha = personMaskAlpha(confidence[i], options.threshold, options.softness);
        pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = 255;
        pixels.data[i * 4 + 3] = alpha; foreground += alpha / 255;
      }
      const coverage = foreground / confidence.length;
      if (coverage < 0.01) throw new VisionError('no-subject', 'No clear person was found. Use a well-lit portrait with a visible silhouette.');
      maskCtx.putImageData(pixels, 0, 0);
      ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(maskCanvas, 0, 0, width, height);
      if (options.background !== 'transparent') { ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = options.background; ctx.fillRect(0, 0, width, height); }
      ctx.globalCompositeOperation = 'source-over';
      analysis = { kind: 'person-segmentation', personCoverage: Math.round(coverage * 10000) / 10000, threshold: options.threshold, softness: options.softness, background: options.background, limits: 'People only. Fine hair, transparent fabric and occluded edges may need manual editing.' };
    } else if (operation === 'pose-reference') {
      inference = task.detect(canvas);
      if (!inference.landmarks?.[0]?.length) throw new VisionError('no-subject', 'No clear pose was found. Use a photo with one person and visible arms and legs.');
      const landmarks = inference.landmarks[0].map(point);
      if (landmarks.length !== 33) throw new VisionError('invalid-result', 'The model returned an incomplete pose.');
      overlay(ctx, landmarks, vision.PoseLandmarker.POSE_CONNECTIONS, width, height, '#b8f575');
      analysis = { kind: 'pose-landmarks', coordinateSpace: 'Normalized image coordinates; z is relative depth, not measured distance.', landmarks, worldCoordinateSpace: 'Model-estimated meters, origin at the midpoint between hips. These are not measured distances.', worldLandmarks: (inference.worldLandmarks?.[0] || []).map(point), limits: 'A still-image pose reference. Occlusion, perspective and body proportions affect accuracy; this does not create animation.' };
    } else {
      inference = task.detect(canvas);
      if (!inference.faceLandmarks?.[0]?.length) throw new VisionError('no-subject', 'No clear face was found. Use a well-lit, front-facing photo with a visible face.');
      const landmarks = inference.faceLandmarks[0].map(point);
      if (landmarks.length !== 478) throw new VisionError('invalid-result', 'The model returned an incomplete face reference.');
      overlay(ctx, landmarks, vision.FaceLandmarker.FACE_LANDMARKS_CONTOURS, width, height, '#b8f575');
      const blendshapes = (inference.faceBlendshapes?.[0]?.categories || []).map(c => ({ name: String(c.categoryName).slice(0, 80), score: Number.isFinite(c.score) ? c.score : 0 }));
      analysis = { kind: 'face-landmarks', coordinateSpace: 'Normalized image coordinates; z is relative depth.', landmarks, blendshapes, limits: 'Geometric references and raw rig coefficients only. These values do not determine emotion, personality, identity or intent.' };
    }
    onProgress?.({ phase: 'render', message: 'Rendering your downloadable reference.' });
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    if (blob.size > VISION_LIMITS.outputBytes) throw new VisionError('output-too-large', 'The resulting PNG is too large. Try a smaller image.');
    return { blob, width, height, analysis };
  } finally {
    for (const resource of [inference, task, bitmap]) { try { resource?.close?.(); } catch { /* Release the remaining resources even if a provider close fails. */ } }
    if (canvas) { canvas.width = 1; canvas.height = 1; }
    if (maskCanvas) { maskCanvas.width = 1; maskCanvas.height = 1; }
  }
}
/** Install on the host's reviewed bundled module worker. One request per worker. */
export function installVisionWorker(vision, scope = globalThis) {
  let started = false;
  scope.onmessage = async ({ data }) => {
    if (started || data?.type !== 'run') return;
    started = true;
    try {
      const result = await executeVisionTask({ ...data, vision, onProgress: p => scope.postMessage({ type: 'progress', ...p }) });
      scope.postMessage({ type: 'result', result });
    } catch (error) { scope.postMessage({ type: 'error', code: error instanceof VisionError ? error.code : 'inference-failed', message: error instanceof VisionError ? error.message : 'The local vision model could not process this image. Try a clearer portrait.' }); }
  };
}
