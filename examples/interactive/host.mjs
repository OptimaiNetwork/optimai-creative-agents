/** Reusable host wiring. All executable/model/WASM paths are reviewed local constants. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { scene3DRecipeSettings } from '../../src/scene-3d.mjs';
import { createScene3DStageWithRuntime } from '../../src/scene-3d-runtime.mjs';
import { cameraRecipeSettings, createCameraLease, createFaceRigSmoother, faceRigAt, demoFaceRig } from '../../src/camera-runtime.mjs';
import { createCameraAvatar, drawCameraSource, drawCameraEffect, drawFaceHalo } from '../../src/camera-renderer.mjs';
import { createFaceTracker } from '../../src/camera-tracking.mjs';
import { VISION_MODELS, loadVisionModelBuffer } from '../../src/vision-runtime.mjs';
import { getModelSetupPolicy } from '../../src/model-setup.mjs';

export function createExampleScene(container, values = {}, onError = console.error) {
  const recipe = scene3DRecipeSettings('scene-lighting', values);
  const stage = createScene3DStageWithRuntime(container, recipe.settings, onError, { THREE, OrbitControls, GLTFLoader, RoomEnvironment });
  stage.camera(recipe.camera);
  return stage;
}

export function createExampleCamera(output, video, values = {}, { onStatus = () => {}, onError = console.error } = {}) {
  let settings = cameraRecipeSettings('avatar-stage', values), closed = false, frame = 0, tracker = null, latestFace = null, preparing = false;
  const lease = createCameraLease(), preparation = new AbortController(), source = document.createElement('canvas'), avatarCanvas = document.createElement('canvas');
  output.width = source.width = 960; output.height = source.height = 540;
  const context = output.getContext('2d'), sourceContext = source.getContext('2d');
  if (!context || !sourceContext) throw new Error('Canvas 2D is unavailable.');
  const avatar = createCameraAvatar(avatarCanvas, settings.look, { THREE });
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)'), smoother = createFaceRigSmoother();
  function paint(now) {
    frame = 0; if (closed || document.hidden) return;
    const live = lease.active && video.readyState >= 2;
    if (live) {
      drawCameraSource(sourceContext, video, video.videoWidth, video.videoHeight, source.width, source.height, false);
      tracker?.submit(source, now);
    }
    const rig = live && tracker ? faceRigAt(latestFace, now, settings.mirror) : demoFaceRig(reducedMotion.matches ? 0 : now / 1000);
    avatar.render(smoother.next(rig, now));
    if (live && !settings.avatar) {
      drawCameraEffect(context, source, settings.effect, settings.strength, settings.mirror, now / 1000);
      if (settings.effect === 'halo') drawFaceHalo(context, latestFace, settings.mirror, now / 1000, settings.strength);
    } else context.drawImage(avatarCanvas, 0, 0, output.width, output.height);
    frame = requestAnimationFrame(paint);
  }
  const stopCamera = () => { lease.stop(); video.srcObject = null; latestFace = null; };
  const visibility = () => { if (document.hidden) { stopCamera(); if (frame) cancelAnimationFrame(frame); frame = 0; } else if (!closed && !frame) frame = requestAnimationFrame(paint); };
  document.addEventListener('visibilitychange', visibility); visibility();
  return {
    update(agentId, values) { settings = cameraRecipeSettings(agentId, values); },
    async prepareTracking({ manual = false } = {}) {
      if (closed || preparing || tracker) return null;
      const policy = getModelSetupPolicy(VISION_MODELS['face-reference'], {
        browser: true, saveData: navigator.connection?.saveData,
        effectiveType: navigator.connection?.effectiveType, deviceMemory: navigator.deviceMemory
      });
      onStatus(policy.reason);
      if (policy.mode === 'unsupported' || policy.mode === 'manual' && !manual) return policy;
      preparing = true;
      try {
        const bytes = await loadVisionModelBuffer('face-reference', { signal: preparation.signal, onProgress: progress => onStatus(progress.message) });
        const created = await createFaceTracker(bytes, {
          workerFactory: () => new Worker(new URL('./camera-worker.mjs', import.meta.url), { type: 'module' }),
          wasmBaseUrl: new URL('./vendor/mediapipe/1.1.0', import.meta.url).href,
          signal: preparation.signal, onFace: face => { latestFace = face; }, onError
        });
        if (closed) created.dispose(); else { tracker = created; onStatus('Face tracking is ready. Start camera when you choose.'); }
      } finally { preparing = false; }
      return policy;
    },
    async startCamera() {
      if (closed) return;
      const stream = await lease.start(() => navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }));
      if (!stream) return;
      video.srcObject = stream;
      try { await video.play(); } catch (error) { stopCamera(); throw error; }
    },
    stopCamera,
    snapshot() { return new Promise((resolve, reject) => output.toBlob(blob => blob ? resolve(blob) : reject(new Error('Snapshot unavailable.')), 'image/png')); },
    dispose() { if (closed) return; closed = true; preparation.abort(); lease.close(); tracker?.dispose(); avatar.dispose(); video.srcObject = null; if (frame) cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visibility); }
  };
}
