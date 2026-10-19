# Reusable camera and avatar agents

`camera-stage` and `avatar-stage` share portable browser engines. The Studio supplies its dialog, authentication, camera permission buttons, capture controls and explicit media handoff. These UI responsibilities do not enter the SDK.

| Module | Responsibility |
| --- | --- |
| `camera-runtime` | Bounded rig math, speed-adaptive rig smoothing, face-loss reset, safe recipe settings and camera leases |
| `landmark-filter` | One-Euro scalar and vector filters for face and pose landmarks |
| `camera-tracking` | One frame in flight, throttling, timeout/cancellation and worker lifecycle |
| `camera-worker` | Checksum verification and MediaPipe VIDEO inference in a host worker |
| `camera-renderer` | Canvas effects, face-anchored halo and original procedural avatars |
| `vision-runtime` | Shared cache-first, checksum-verified model download and owned model buffers |

The host pins its MediaPipe executable module and WASM files on its own origin. `installCameraWorker(vision)` receives that imported module. `createFaceTracker(buffer, { workerFactory, wasmBaseUrl, onFace, onError, signal })` receives a host worker factory and a same-origin WASM path; it never downloads executable code. Its initialized task uses VIDEO mode, one face, blendshapes and transformation matrices. The worker checks the fixed face-model checksum again before task creation.

```js
import { loadVisionModelBuffer } from '@optimai/creative-agents/vision-runtime';
import { createFaceTracker } from '@optimai/creative-agents/camera-tracking';

const modelBuffer = await loadVisionModelBuffer('face-reference', {
  signal,
  onProgress,
  downloadIfMissing: true,
});
const tracker = await createFaceTracker(modelBuffer, {
  signal,
  workerFactory: () => new Worker(new URL('./camera.worker.js', import.meta.url), { type: 'module' }),
  wasmBaseUrl: '/vendor/mediapipe/1.1.0',
  onFace,
  onError,
});
tracker.submit(unmirroredFrameCanvas, performance.now());
// On close, account change or hidden document:
tracker.dispose();
```

`loadVisionModelBuffer` returns an owned copy. It reuses the same verified memory/Cache API weights as still-image vision agents. `downloadIfMissing: false` is strictly cache-only. Automatic setup should be visible, cancellable, cache-first and defer network on data-saving or slow connections. Camera permission must remain a separate user action. The face model is about 3.6 MB; the pinned local runtime/WASM is loaded separately during worker initialization.

For 3D rendering, inject a host's pinned Three module:

```js
import { createCameraAvatar } from '@optimai/creative-agents/camera-renderer';

const avatar = createCameraAvatar(canvas, 'orbit', { THREE });
const smoother = createFaceRigSmoother(); // one per preview loop
avatar.render(smoother.next(faceRigAt(frame, now, mirror), now));
avatar.dispose();
```

Avatars are original procedural characters. They animate geometry from bounded face coefficients and use no likeness texture. Matrix packing is column-major, matching MediaPipe's serialized MatrixData. Mirroring is applied to the visible output and rig, after unmirrored inference, so left/right face coefficients remain consistent. A missing live face releases the rig toward neutral after 500 ms. The One-Euro rig smoother keeps the avatar still while the head rests and lets turns and blinks through without the lag of a fixed moving average; see [landmark smoothing](./runtimes.md#landmark-smoothing).

Camera and portrait pixels remain local. Model requests contact only the fixed official weight URL, with credentials omitted and no referrer. Cache and network responses are size-bounded before SHA-256 validation. Hosts retain ownership of consent, local exports and any later cloud Studio handoff.
