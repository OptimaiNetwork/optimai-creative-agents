# A standalone 3D, camera and avatar host

This example consumes the same public modules that Studio adapts. It renders a procedural 3D pavilion with orbit/camera controls and static GLB import, plus an original avatar demo and local camera filters. Face tracking uses the public worker pipeline and verified Face Landmarker bytes. There is no Studio account, API key, billing, project persistence or upload path.

## Serve reviewed dependencies locally

From the repository root, install the optional pinned peers and copy their public assets. These commands modify this local checkout only; they do not publish anything:

```sh
npm install --ignore-scripts --no-save --package-lock=false three@0.186.1 @mediapipe/tasks-vision@1.1.0
mkdir -p examples/interactive/vendor/three/0.186.1/build
mkdir -p examples/interactive/vendor/three/0.186.1/examples
mkdir -p examples/interactive/vendor/mediapipe/1.1.0
cp node_modules/three/build/three.module.js node_modules/three/build/three.core.js examples/interactive/vendor/three/0.186.1/build/
cp -R node_modules/three/examples/jsm examples/interactive/vendor/three/0.186.1/examples/
cp node_modules/three/LICENSE examples/interactive/vendor/three/0.186.1/
cp node_modules/@mediapipe/tasks-vision/vision_bundle.mjs examples/interactive/vendor/mediapipe/1.1.0/
cp node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm examples/interactive/vendor/mediapipe/1.1.0/
cp node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.js node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.wasm examples/interactive/vendor/mediapipe/1.1.0/
python3 -m http.server 8080 --bind 127.0.0.1
```

Retain MediaPipe's upstream license/notice when redistributing its assets. The SDK's MIT license does not relicense dependency code or model weights. Do not commit `vendor` or `node_modules` as a runtime contribution; they are local host setup assets.

Open **http://127.0.0.1:8080/examples/interactive/**. The import map points only to this host's copied Three.js code. `camera-worker.mjs` imports the local native MediaPipe bundle next to its WASM files, preserving its variable imports. There is no CDN, user-supplied dependency URL or dynamic recipe code.

1. Orbit the real 3D scene, use Front/3D view, save its PNG, or choose a self-contained static GLB.
2. Inspect the original avatar demo; it works without a camera or face-model download.
3. Click **Prepare tracking** to download/reuse the pinned verified model. Progress appears below the preview. This example uses the manual control; `host.mjs` also supports automatic preparation when the selected-agent policy permits.
4. Click **Start camera** to request browser permission. Switch between Avatar demo and Neon filter. Stop camera releases its tracks; moving the page to the background stops it too.
5. Save a snapshot. Closing the page disposes camera/worker/GPU resources and cancels pending model setup.

WebGL is required for scenes and avatars. Tracking additionally needs secure localhost/HTTPS, Web Crypto, workers, OffscreenCanvas, ImageBitmap and WASM SIMD. If tracking is unavailable, filters and the procedural demo still work. Live camera requires a camera device and browser permission; the example never requests a microphone.

## Build your own interface

`host.mjs` exports `createExampleScene(container, values, onError)` and `createExampleCamera(canvas, video, values, callbacks)`. The functions wire public APIs; neither relies on private Studio code. Use the stage's `update`, `camera`, `importGLB`, `png`, `configuration` and `dispose` methods. The camera adapter exposes `prepareTracking`, `startCamera`, `stopCamera`, `update`, `snapshot` and `dispose`.

A bundled host can replace the local import map with imports from its own pinned installed peers and keep the same public API calls. Keep worker/WASM configuration in trusted source, and normalize portable recipes with `scene3DRecipeSettings` or `cameraRecipeSettings` before applying values.

`getModelSetupPolicy` returns `automatic`, `manual` or `unsupported`. On agent selection, an automatic host calls `prepareTracking()`; manual setup shows Download and passes `{manual:true}` on that click. Data Saver, slow connections or constrained large-model devices stay manual. The policy does not download anything itself or request camera access. Keep cancellation and deliberate retry in your interface; preparation does not imply permission to generate or publish.

The public engines render the preview and return snapshots/configuration. Recording/export containers, account state, your asset library and any paid production handoff remain the host's responsibility. GLB composition references do not produce new downloadable 3D meshes, and original avatars do not swap a person's identity.
