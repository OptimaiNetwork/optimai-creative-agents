# Runtimes and model setup

Choose the runtime for the result you need. The canvas SDK runs without a model or external dependency. Vision, tracking and browser writing use reviewed optional model runtimes. Interactive scenes and avatars use the shared Three.js engine. Node writing uses your own installed Ollama service. Guided recipes prepare direction for a separate host workflow.

The examples below use relative imports from an entry file at the cloned repository root. An application can bundle these source modules or use the exported package entry points through a local source dependency; the package is not distributed on npm yet. For a working model-free browser workspace, see [examples/browser](../examples/browser/README.md).

| Runtime | Setup | Output |
| --- | --- | --- |
| [Canvas](#canvas-processing) | Local browser; no model or dependency install | PNG images and design artboards |
| [Browser writing](#browser-writing) | WebGPU, pinned WebLLM dependency, local worker and selected-agent model setup | Validated written documents |
| [Browser vision](#browser-vision) | Pinned MediaPipe dependency, local WASM/worker and selected-agent model setup | Person cutout PNGs, pose or face landmarks |
| [Interactive 3D](#interactive-3d-scenes) | Optional pinned Three.js; browser WebGL | Real scene preview, PNG and scene recipe |
| [Camera and avatar](#camera-effects-and-face-driven-avatars) | Explicit camera permission; optional pinned face tracking worker | Canvas filters and original avatar rendering |
| [Local Ollama](#local-ollama-writing) | Already running local service and installed eligible model | Validated written documents |
| [MCP](./mcp.md) | Node stdio adapter; Ollama only for explicit writing runs | Prepared recipes or local written results |

## Canvas processing

Import the dependency-free engine from a local web page or bundler. Package consumers can import `@optimai/creative-agents/browser-runtime`; direct browser imports use `./src/browser-runtime.mjs`. No Studio account, credential, host application or network service is needed. The module does not touch browser APIs until you run an operation, so its pure size and validation helpers can also run in Node.

```js
import { runLocalTool, validateLocalImageFile } from './src/browser-runtime.mjs';

// Obtain this File from an <input type="file"> or a local drag-and-drop action.
const file = imageInput.files[0];
const error = validateLocalImageFile(file);
if (error) throw new Error(error);

const controller = new AbortController();
const result = await runLocalTool('image-resize', [file], {
  width: 1600, ratio: '16:9', fit: 'contain', background: '#101312'
}, controller.signal);

const url = URL.createObjectURL(result.blob);
preview.src = url;
download.href = url;
download.download = result.filename;
// Keep this URL until the preview is replaced or removed, then release it.
// URL.revokeObjectURL(url);
```

The engine accepts actual local `File` objects only. PNG, JPEG and WebP signatures are checked before decoding; URLs, SVG and other file formats are rejected. Each file and exported PNG is limited to 20 MiB, images to 4096 pixels on either side, and retained decoded images and output canvases to 16 million pixels. Image Grid supports up to eight files within that combined pixel limit; the other processors use one. The engine cleans up bitmap, canvas and temporary object URL resources on success, failure and cancellation. The consumer owns and must revoke any URL it creates from the returned Blob.

| Operation | Settings |
| --- | --- |
| `image-filter` | `preset`: original, noir, warm, cool or punchy; `intensity`: 0–100 |
| `image-resize` | `width`, `height`: positive integers up to 4096; `ratio`: original, 1:1, 16:9, 9:16 or 4:5; `fit`: cover or contain; `crop`: smart or center; `background`: hex color |
| `image-grid` | `columns`: 1–4; `gap`: 0–80 pixels; `crop`: smart or center; `background`: hex color |
| `type-overlay` | `title`: 1–300 characters; `fontSize`: 12–240; `color`: hex color; `position`: top, center or bottom; `ink`: readable, image or exact ([readable titles](#readable-titles-and-image-palettes)) |

For a fixed resize ratio, width determines height when supplied; supplying only height determines width. With the original ratio, a single supplied side preserves the source proportions, while supplying both sides creates that exact canvas. The cover or contain setting determines how the image fits this canvas. Cover fits use [focus-aware cropping](#focus-aware-cropping) unless `crop` is `center`. Browser color-filter support is required for the color-finish operation. Rendering and PNG encoding run in the browser; Node tests use controlled canvas and image fixtures to verify the real exported engine, validation, geometry and resource cleanup.

### Composition workspaces

```js
import { CANVAS_LAB_AGENTS, runCanvasLab } from './src/canvas-lab.mjs';

const controller = new AbortController();
const output = await runCanvasLab(CANVAS_LAB_AGENTS['poster-lab'], [], {
  title: 'EXPLORE\nSOMETHING NEW', color: '#c6f87d', ratio: '4:5', treatment: 'editorial'
}, controller.signal);
```

`mockup` creates a phone, desktop or gallery frame from one image. `bento` fits up to eight images into an asymmetric layout. `blend` and `transition` require exactly two images and use `mix: 0–100`. `glitch` displaces still-image bands with `amount: 0–100`. `poster` and `letter` accept one optional background image and a plain-text title of 1–180 characters. Ratios are 1:1, 4:5, 16:9 and 9:16; output width is 1200 pixels. Each image retains the signature and size checks of the original processor, and retained normalized inputs share a 16-million-pixel budget. Pending decode and export can be cancelled; late bitmaps and temporary canvases are disposed. Every image these compositions cover, crop or frame uses [focus-aware cropping](#focus-aware-cropping); pass `crop: 'center'` for a classic centred fit. Poster and letter titles use [readable ink](#readable-titles-and-image-palettes) by default; pass `ink: 'exact'` to draw `color` unchanged. These tools export PNGs, not video or model-generated artwork.

### Focus-aware cropping

A cover fit can only slide its crop along one axis, so a centred crop often cuts off an off-centre subject. Each image is analysed once from a thumbnail of at most 96 pixels on its long side, about a millisecond of work on a recent laptop. Two signals are combined:

- **Detail**: Sobel gradient magnitude of luminance.
- **Distinctiveness**: OKLab distance from the image's mean color, after the frequency-tuned salient-region method of Achanta et al., 2009.

The crop then moves toward the window that holds the most interest near its centre. A small centre prior breaks ties. Transparent pixels score zero. The analysis has no model, network, face recognition or skin-tone heuristic. Flat images, matching aspect ratios and environments that cannot read canvas pixels keep the centred crop, so the result is never worse than a plain cover fit.

The same engine is available on its own for your own layouts:

```js
import { analyzeImageFocus, focusCoverRect } from './src/smart-crop.mjs';

const bitmap = await createImageBitmap(file);
const focus = analyzeImageFocus(bitmap, bitmap.width, bitmap.height); // null keeps a centred crop
const area = focusCoverRect(bitmap.width, bitmap.height, 1080, 1350, focus);
context.drawImage(bitmap, area.x, area.y, area.width, area.height, 0, 0, 1080, 1350);
```

`computeFocusMap(rgba, width, height)` and `findFocusCrop(map, width, height, aspect)` expose the pure steps, which also run in Node. Package consumers import `@optimai/creative-agents/smart-crop`.

### Readable titles and image palettes

A title color that reads on a dark photo can vanish on a bright one. Poster Lab, Letter Pose and Title Frame sample the composition behind the title block (a thumbnail of at most 64 pixels), find its dominant colors, and check the ink against every color that covers at least 5% of that area. The `ink` setting chooses what happens:

| `ink` | Behaviour |
| --- | --- |
| `readable` (default) | Keep `color` when it reaches 3:1 WCAG contrast (AA for large text) over each of those colors. Otherwise move only its OKLCH lightness, by the smallest step that passes, so the hue the creator chose survives. |
| `image` | Start from the photo's accent (its most vivid color that is also present), then apply the same check. Falls back to `color`. |
| `exact` | Draw `color` unchanged, as before. |

The result reports the ink actually drawn as `output.ink`, so a host can say so ("Ink adjusted to #5c8300 to stay readable"). Title Frame also draws its outline on the far side of the background: a light halo behind a title darker than the image. Environments that cannot read canvas pixels draw `color` unchanged. Saved recipes need no new field.

The color engine is a public module that runs in Node and the browser:

```js
import { analyzeImageColors, mixColors, pickAccentColor, pickLegibleColor } from '@optimai/creative-agents/color';

const palette = analyzeImageColors(bitmap, bitmap.width, bitmap.height); // [{ color, weight, oklch }], or null
const accent = pickAccentColor(palette ?? []);                           // '#2452c4', or null for a neutral image
const behind = analyzeImageColors(canvas, canvas.width, canvas.height, { region: { x: 96, y: 1100, width: 1008, height: 260 } });
const { color, contrast, passes } = pickLegibleColor(behind, { prefer: [accent, '#c6f87d'], minContrast: 4.5 });
const hover = mixColors(color, '#ffffff', 0.2);                          // mixed in OKLab
```

| Export | What it does |
| --- | --- |
| `toOklab`, `toOklch`, `fromOklab`, `fromOklch` | Conversions after [Björn Ottosson's OKLab](https://bottosson.github.io/posts/oklab/). Out-of-gamut colors keep lightness and hue and lose chroma. |
| `parseHexColor`, `formatHexColor` | `#rgb`/`#rrggbb` ↔ `[r, g, b]`. Every function takes either form and returns `#rrggbb`. |
| `mixColors(a, b, amount)` | Perceptual mix in OKLab: black and white mix to a true mid-grey, red and blue stay colorful. |
| `contrastRatio`, `relativeLuminance` | WCAG 2.x, shared with [tier-0 verification](#tier-0-verification). Use these for conformance. |
| `lightnessContrast(text, background)` | A polarity-aware OKLab lightness difference on an Lc-like −100…100 scale, positive for dark text on a light background. It is a simple ranking aid, not APCA. |
| `pickLegibleColor(backgrounds, { prefer, minContrast })` | Tries each preferred color in order, keeps it or moves its lightness the least distance that passes over every background. With no passing option (black *and* white behind the text) it returns the strongest candidate, often a mid-tone, with `passes: false`: add a scrim. |
| `dominantColors(rgba, width, height, { count })` | Weighted k-means in OKLab over a 15-bit histogram with deterministic seeding, so the same pixels always give the same palette. Alpha weights each pixel. At most 262,144 pixels and 12 colors. |
| `pickAccentColor(palette)` | The swatch with the highest chroma × √weight, or null below `minChroma`. |
| `analyzeImageColors(source, width, height, { region, count })` | Palette of an image, video frame or canvas (or a region of it) from a 64-pixel thumbnail; null when pixels cannot be read. |

### Tier-0 verification

Before paying a model to judge a draft, an agent can reject the obviously broken ones locally. `@optimai/creative-agents/verify` provides deterministic checks with no model, network or dependency. They run in Node and the browser in milliseconds:

| Check | Passes when |
| --- | --- |
| `checkTextContrast` | The 5th-percentile WCAG contrast of known-color text over the pixels behind it reaches `minRatio` (4.5 by default; 3 for large text). A low percentile, not the mean, so a busy background cannot hide. |
| `checkTextSize` | Rendered text is at least `minPx` tall. |
| `checkTextOverlap` | Text boxes cover at most `maxShare` of the image's visual interest, measured on the focus map above. |
| `checkSafeZone`, `checkAspect`, `checkDuration`, `checkCount` | Boxes stay inside the safe zone; the delivered size, duration and detector count are within bounds. |
| `checkPalette` | Enough opaque pixels are within `maxDeltaE` of a brand color in OKLab. |
| `checkCutAlignment` | Enough edit cuts land within `tolerance` seconds of a beat, from any beat tracker. |

```js
import { computeFocusMap } from './src/smart-crop.mjs';
import { checkTextContrast, checkTextOverlap, summarizeChecks } from './src/verify.mjs';

const { data } = context.getImageData(0, 0, 96, 120); // a thumbnail of the poster
const headline = { x: 0.08, y: 0.06, width: 0.84, height: 0.14 };
const summary = summarizeChecks([
  checkTextContrast(data, 96, 120, headline, [255, 255, 255]),
  checkTextOverlap({ map: computeFocusMap(data, 96, 120), width: 96, height: 120 }, [headline]),
]);
if (!summary.pass) console.log('Regenerate before judging:', summary.failed);
```

Every result is `{ check, pass, score, threshold, confidence, costMs }`. Scores are oriented so that higher is better and `pass` means `score >= threshold`, so a host can calibrate any score into a probability with one monotone fit. `confidence` is a margin from the threshold (0.5–1), not a probability. Pass thumbnails: pixel checks read at most 262,144 pixels.

To execute a saved composition recipe, normalize its fields before rendering:

```js
import { canvasLabRecipeSettings, runCanvasLab } from './src/canvas-lab.mjs';

const settings = canvasLabRecipeSettings('poster-lab', {
  title: 'A NEW PERSPECTIVE', format: 'wide banner', style: 'cinematic'
});
const output = await runCanvasLab(settings.operation, [], settings, controller.signal);
```

The normalizer merges source defaults, maps legacy poster `format` to `ratio`, letter `text` to `title`, `style` to `treatment` and glitch `intensity` to `amount`. Explicit canonical values win. It validates recipe values and the final engine settings. Do not merge defaults into supplied values before calling it: that would conceal whether a canonical setting was explicitly selected. Raw `runCanvasLab` remains available for applications using direct bounded engine settings.

## Selected-agent model setup

`getModelSetupPolicy(model, environment)` is a pure public policy: it never fetches a model, starts a worker or asks for camera permission. A host applies it when the user opens a model-backed agent, then calls the reviewed download/load API in code. This keeps preparation convenient while making size, progress, cancellation and retry visible.

```js
import { getModelSetupPolicy } from './src/model-setup.mjs';
import { VISION_MODELS, loadVisionModelBuffer } from './src/vision-runtime.mjs';

const policy = getModelSetupPolicy(VISION_MODELS['face-reference'], {
  browser: true, webGPU: Boolean(navigator.gpu),
  saveData: navigator.connection?.saveData,
  effectiveType: navigator.connection?.effectiveType,
  deviceMemory: navigator.deviceMemory
});
// Always show policy.reason, model size, progress and a Stop control in the host.
if (policy.mode === 'automatic') {
  const bytes = await loadVisionModelBuffer('face-reference', {
    signal: controller.signal, onProgress: progress => showProgress(progress.message)
  });
  // Pass these owned verified bytes to the reviewed local tracking worker.
}
// manual: display Download and let that click call the same preparation API.
// unsupported: keep basic filters, procedural demos, canvas tools or guided direction available.
```

Data Saver and 2G connections use manual setup. Large models also use manual setup on 3G or when reported device memory is below 4 GB. A required but unavailable WebGPU environment is unsupported. Automatic mode prepares only the selected reviewed model; it does not download every catalog model. The host still performs capability checks beyond this coarse policy. Cancel preparation when a workspace closes, preserve its user's input and offer a deliberate retry; cancel is not permission to restart a download automatically.

### Setup controller and sizes

`createModelSetupController({ load, check, cancel, bytes, name, policy })` runs the visible setup flow so every host shows the same states: `idle → checking → downloading (loaded, total) → verifying → ready`, or `failed` / `unsupported`. It never fetches by itself. `load({ signal, onProgress })` is your reviewed call (`downloadVisionModel`, browser writer `load()`…), and the optional `check({ signal })` returns `{ ready, available, loading, cached, message }`.

```js
import { createModelSetupController, describeModelSetup, getModelSetupPolicy } from './src/model-setup.mjs';
import { BROWSER_AGENT_MODEL } from './src/browser-writing-runtime.mjs';

const size = describeModelSetup(BROWSER_AGENT_MODEL); // { download: '453 MB', memory: 'about 1.7 GB GPU memory', label }
const setup = createModelSetupController({
  name: 'writing AI', bytes: BROWSER_AGENT_MODEL.downloadBytes,
  policy: () => getModelSetupPolicy({ bytes: BROWSER_AGENT_MODEL.downloadBytes, requiresWebGPU: true }, readEnvironment()),
  check: async () => ({ ...await runtime.status(), cached: await isCached() }),
  load: ({ signal, onProgress }) => runtime.load({ signal, onProgress }),
  cancel: () => runtime.cancel(),
});
setup.subscribe(state => render(state.state, state.progress, state.progressLabel)); // "120 MB of 453 MB"
await setup.check({ autoStart: true }); // ready, unsupported, observes a load already running, or starts when cached/automatic
stopButton.onclick = () => setup.abort(); // back to idle; late progress from the stopped run is ignored
```

The state object is frozen and replaced on every change, so `subscribe`/`getState` work directly with React's `useSyncExternalStore`. Progress accepts `{ stage | phase, loaded, total, progress, message }`: a fraction is converted to bytes with the declared `bytes`, a reported `total` replaces it, and bytes never move backwards within one run. A `verify` stage becomes `verifying`. A second `start()` joins the running one, a user's `start()` or `abort()` during `check()` wins over the late check result, and a check that finds a load already running polls it (`pollMs`, default 800) instead of starting a duplicate download; `abort()` then calls your `cancel`. `reset({ state, message })` resyncs after the model was released elsewhere. With a `check`, the controller starts in `checking` so no Download button flashes before the first check; `policy` may be a function so browser hints are read at check time rather than during server rendering; `dispose()` on unmount stops only this controller's own download and polling, never a load it merely observed. `formatBytes` uses decimal units as operating systems show downloads (`453 MB`, `3.8 MB`, `1.7 GB`), and `describeModelProgress({ loaded, total })` gives `"120 MB of 453 MB"`.

`downloadVisionModel`, `loadVisionModelBuffer` and browser writer `load()` remain explicit function calls internally. Recipes contain neither download policy nor model/worker URLs. Inference stays separate from setup: preparing a model does not generate a new take, request a camera or trigger paid production.

## Browser writing

Install the reviewed optional dependency in your isolated browser host:

```sh
npm install --save-exact @mlc-ai/web-llm@0.2.85
```

Create a local worker entry that imports `WebWorkerMLCEngineHandler` from the installed WebLLM dependency and calls the kit's `attachBrowserWritingWorker(WebWorkerMLCEngineHandler)`. Bundle that entry locally; a recipe cannot supply its own worker URL. The runtime downloads only the configured public Qwen 3.5 0.8B model and matching compiled WebGPU library when the host calls `load()`, either automatically after agent selection under the setup policy or through a manual Download control. The first download is approximately **453.2 MB**; HTTPS or localhost, Web Workers, WebGPU with `shader-f16` and sufficient GPU memory are required. The configured context is 4096 tokens, and the official model estimate is approximately 1.63 GB of GPU memory. Device support checks are conservative and cannot guarantee successful allocation on every GPU.

```js
import { createBrowserAgentRuntime } from './src/browser-writing-runtime.mjs';

const controller = new AbortController();
const writer = createBrowserAgentRuntime({
  createWorker: () => new Worker(new URL('./writing-worker.mjs', import.meta.url), { type: 'module' }),
  loadEngine: () => import('@mlc-ai/web-llm')
});
const support = await writer.status(); // No engine or model download.
if (!support.available) throw new Error(support.message);
await writer.load({ signal: controller.signal }); // Host calls this after the setup policy permits preparation.
const draft = await writer.run({
  templateId: 'story-seed', brief: 'An explorer helps a lost cloud.',
  values: { form: 'manga', style: 'manga' }, signal: controller.signal
});
console.log(draft.sections); // Plain untrusted text; never raw HTML.
```

The host's `writing-worker.mjs` contains only the reviewed SDK wiring:

```js
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';
import { attachBrowserWritingWorker } from './src/browser-writing-worker.mjs';
attachBrowserWritingWorker(WebWorkerMLCEngineHandler);
```

The five writing contracts are Cast Notes, Style Brief, Storyboard Builder, Prompt Branches and Story Seed. Briefs are limited to 2,000 characters in the browser, with a 2,048-token output budget. New storyboards start with three scenes for a quick draft. Longer storyboards can take several minutes on a compact model. Storyboards longer than three scenes are written scene by scene with preceding actions as continuity context, then the combined artifact is validated. A malformed or incomplete draft receives one bounded repair; failure is reported without substituting a canned document. `cancel()` terminates the active worker, and `unload()` releases the session. Model files are fetched and cached, while creative prompts and generated text remain in the browser. There is no server or Ollama fallback in this browser engine.

The model weights are pinned to Hugging Face commit `0ec138972555613c1d7812a821778ad0398c8790`; the compiled library is pinned to commit `025bcaf3780fa8254f5e5efd3bfea0a5397248f4`. Config, tokenizer files and compiled library use fixed integrity checks. WebLLM does not provide a per-shard integrity check for all weights, so the kit does not claim that guarantee. The WebLLM library and Qwen weights retain their upstream Apache-2.0 licenses; the kit's MIT license does not replace them.

## Browser vision

Install the reviewed optional dependency in your isolated browser host:

```sh
npm install --save-exact @mediapipe/tasks-vision@1.1.0
```

Bundle a local worker that imports the MediaPipe namespace and calls `installVisionWorker(vision)` from `src/vision-processor.mjs`. Copy the official `vision_wasm_module_internal.js` and `.wasm` files into the host's local static assets, and supply their same-origin directory as `wasmBaseUrl`. No worker, executable URL or WASM path is taken from a recipe. The host is responsible for serving reviewed dependency assets and retaining their upstream licenses.

```js
import { downloadVisionModel, runBrowserVision } from './src/vision-runtime.mjs';

const controller = new AbortController();
const file = imageInput.files[0]; // A local file selected by the user.
await downloadVisionModel('person-cutout', { signal: controller.signal }); // Host policy or manual Download action.
const result = await runBrowserVision('person-cutout', file, {
  background: 'transparent', threshold: .5, softness: .12
}, {
  workerFactory: () => new Worker(new URL('./vision-worker.mjs', import.meta.url), { type: 'module' }),
  wasmBaseUrl: new URL('./vision-wasm/', location.href).href,
  signal: controller.signal
});
console.log(result.blob, result.analysis);
```

Person Cutout uses Selfie Segmenter (249,537 bytes) for people in portrait photos. Motion Pose uses Pose Landmarker Lite (5,777,746 bytes) for one person's 33 body landmarks. Face Performance uses Face Landmarker (3,758,596 bytes) for one visible face's 478 landmarks and raw blendshape coefficients. It does not identify people, infer personality or emotions, or swap faces. Model URLs are fixed official Google storage version-1 assets and checked against exact byte lengths and SHA-256 hashes. `getVisionModelStatus()` reads local cache only; `runBrowserVision()` never implicitly downloads a model. `loadVisionModelBuffer()` returns owned verified bytes and can prepare a missing model when `downloadIfMissing: true`; use `false` for cache-only access.

Vision requires HTTPS or localhost, Web Crypto, Web Workers, ImageBitmap, OffscreenCanvas and WASM SIMD support. It uses a CPU worker and does not require WebGPU. Check the target browser before enabling the workspace.

Selected PNG, JPEG and WebP images remain in the browser. Inputs are limited to 20 MiB, 4096 pixels per side and 16 million pixels; analysis and PNG output are scaled to at most 1600 pixels per side. A CPU WASM worker is stopped after 60 seconds or on cancellation. Results depend on subject visibility and the model's training scope; an undetected subject produces a useful error rather than a fabricated landmark result. Raw landmark analysis is available in `result.analysis`; the consumer can create a reviewed JSON export if needed.

## Interactive 3D scenes

Install the optional reviewed peer in the host: `npm install --save-exact three@0.186.1`. TypeScript hosts can install `@types/three@0.186.0` for its declarations. Nothing is fetched by the scene engine itself. Public entry points are `scene-3d` for pure input/settings helpers and `scene-3d-runtime` for the browser renderer. The root manifest entry does not import Three.js.

```js
import { scene3DRecipeSettings } from './src/scene-3d.mjs';
import { createScene3DStage } from './src/scene-3d-runtime.mjs';

const recipe = scene3DRecipeSettings('scene-lighting', {
  demo: 'architecture', lighting: 'sunset', finish: 'original',
  view: 'iso', focalLength: 50, exposure: 120
});
const stage = await createScene3DStage(mountedContainer, recipe.settings, {
  signal: controller.signal, onError: message => showError(message)
});
stage.camera(recipe.camera);
// A selected self-contained file only; never pass a URL.
await stage.importGLB(await glbInput.files[0].arrayBuffer(), glbInput.files[0].name);
const png = await stage.png();
const recipeJson = stage.configuration();
// Call stage.dispose() on route/dialog close; this releases GPU objects and controls.
```

`createScene3DStage()` loads the installed optional peer only when called. A host that already bundles reviewed Three modules can avoid another module loading boundary with synchronous `createScene3DStageWithRuntime(container, settings, onError, { THREE, OrbitControls, GLTFLoader, RoomEnvironment })`. `loadScene3DRuntime()` exposes the same optional peer loader. The [interactive example](../examples/interactive/README.md) demonstrates local dependency injection.

The controller supports `update(settings)`, `demo('sculpture'|'product'|'architecture')`, `camera('isometric'|'front'|'side'|'top')`, `fit()`, `zoom('in'|'out')`, `importGLB(bytes, name)`, `png()`, `configuration()` and `dispose()`. Procedural demos contain original sculpture, headphone and architectural geometry. Materials can remain original or use ceramic, metal or clay; light presets are studio, sunset and neon. Lens controls use real 24–100 mm focal lengths. A portable recipe uses `finish`, `view` and exposure in 25–200 percent; `scene3DRecipeSettings` maps them to material, camera and renderer settings. Saved free-text subject/material fields remain compatible.

`validateAgentGLB()` runs before the glTF loader. It accepts one static embedded scene up to 20 MiB with 300,000 visible vertices, 128 primitives and 256 nodes. It validates accessor storage, indices, finite coordinates and a usable visible scene. Up to eight embedded PNG/JPEG images share a 16-megapixel budget and a 4096-pixel side limit. External/data URLs, compressed decoders, instancing, skins, morph targets and animations are rejected. A failed or late import preserves the prior scene or releases its unused result.

The renderer caps pixel density, renders manual previews only on change, and suspends turntable motion when hidden, offscreen or reduced motion is requested. Exports render the current camera immediately before PNG readback. The scene recipe contains settings and camera state; imported GLB geometry is not included. Keep the original model with it. `dispose()` releases geometry, material, textures, decoded bitmaps, environment/shadow targets, renderer and listeners. These ownership choices follow the [Three glTF loader's bitmap guidance](https://threejs.org/docs/pages/GLTFLoader.html); interaction uses [OrbitControls](https://threejs.org/docs/pages/OrbitControls.html).

## Camera effects and face-driven avatars

`camera-runtime`, `camera-renderer`, `camera-tracking` and `camera-worker` are reusable public modules. They do not import Studio services. The host owns camera permission, selected media decoding, its render loop, snapshot/recording UI and any subsequent handoff. Basic clean/neon/prism/duotone/film canvas effects and the original avatar demo do not require a face-model download. Halo anchoring and face-driven avatar controls use a local Face Landmarker worker.

```js
import { cameraRecipeSettings, createCameraLease, createFaceRigSmoother, faceRigAt } from './src/camera-runtime.mjs';
import { createCameraAvatar, drawCameraEffect, drawFaceHalo } from './src/camera-renderer.mjs';
import { createFaceTracker } from './src/camera-tracking.mjs';
import { loadVisionModelBuffer } from './src/vision-runtime.mjs';

const settings = cameraRecipeSettings('avatar-stage', { look: 'orbit', mirror: 'yes' });
const bytes = await loadVisionModelBuffer('face-reference', { signal: controller.signal });
let latestFace = null;
const tracker = await createFaceTracker(bytes, {
  workerFactory: () => new Worker(new URL('./camera-worker.mjs', import.meta.url), { type: 'module' }),
  wasmBaseUrl: new URL('./vision-assets/1.1.0', location.href).href,
  signal: controller.signal, onFace: frame => { latestFace = frame; }, onError: showError
});
const avatar = createCameraAvatar(avatarCanvas, settings.look, { THREE });
const lease = createCameraLease();
// Wire this to the user's Start camera button, not model preparation.
const stream = await lease.start(() => navigator.mediaDevices.getUserMedia({
  video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false
}));
if (stream) video.srcObject = stream;
// In your visible preview loop, first draw video into an unmirrored <=1280×720 input canvas:
tracker.submit(sourceCanvas, performance.now()); // At most one frame in flight; inference stays in worker.
const now = performance.now(); // Create one smoother per preview: const smoother = createFaceRigSmoother();
avatar.render(smoother.next(faceRigAt(latestFace, now, settings.mirror), now));
// Close/hidden/cancel: tracker.dispose(); avatar.dispose(); lease.close(); cancelAnimationFrame(loop);
```

The host's same-origin worker entry imports its locally served pinned MediaPipe bundle, then calls `installCameraWorker(vision)`. Use `loadVisionModelBuffer('face-reference')` to obtain cache-first verified bytes; the camera worker checks the exact model length and SHA-256 again before creating the task. `createFaceTracker` transfers ownership of the buffer to the worker. Worker and WASM paths are trusted host code; they must not come from recipe values. Its processing canvas is 640 × 360, face frames are compact, and the tracking pipeline keeps one bitmap/inference in flight at a 100 ms interval. Missing or stale faces return neutral rig values rather than retaining a previous person's motion.

`drawCameraSource` performs a cover crop; `drawCameraEffect` draws selected filters; `drawFaceHalo` draws landmark-aligned graphics. `faceRigFromFrame`, `faceRigAt` and `createFaceRigSmoother` map bounded transform/blendshape data into an original procedural avatar. Mirroring is applied after inference. Live camera access requires HTTPS/localhost and explicit browser permission, as documented by [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia). Face Landmarker calls are synchronous, so this implementation follows [Google's Web Worker recommendation](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js).

The public camera engines render canvases, not a finished recording container. A host can capture snapshots or use a browser-supported `MediaRecorder` on the canvas stream, enforce its recording duration/size limits and offer an explicit download. Studio's host limits recording to 30 seconds/32 MiB. It requests no microphone track for this feature. These effects are not identity face swaps, emotion detection or a guarantee of frame-rate on every device. Stop all camera tracks when the workspace closes or becomes hidden, including late permission responses; `createCameraLease` handles that late-response ownership.

### Landmark smoothing

Raw face and pose landmarks jitter by a pixel or two at rest, and a fixed low-pass that hides the jitter also lags behind a fast turn. `landmark-filter` implements the [One-Euro filter](https://gery.casiez.net/1euro/) (Casiez, Roussel and Vogel, CHI 2012): its cutoff rises with the signal's speed, so values hold still at rest and follow quick moves. It runs anywhere, including Node, and has no dependencies.

```js
import { createOneEuroFilter, createOneEuroVectorFilter } from '@optimai/creative-agents/landmark-filter';

const x = createOneEuroFilter({ minCutoff: 1, beta: .5 });
x.filter(rawX, performance.now()); // timestamps in ms; cutoffs in Hz

// 33 pose landmarks × (x, y, z): each landmark adapts to its own 3D speed.
const pose = createOneEuroVectorFilter(33 * 3, { minCutoff: .8, beta: 2, stride: 3 });
const smoothed = pose.filter(flatLandmarks, performance.now());
```

`minCutoff` sets stillness at rest (lower is steadier), `beta` sets how quickly the cutoff opens with speed (higher lags less) and `dCutoff` smooths the speed estimate. With `stride`, components are grouped into points that adapt to their Euclidean speed, so a diagonal move is filtered like a straight one and a moving hand does not unlock a still shoulder. The first sample passes through unchanged. A repeated or earlier timestamp, or a non-finite value, holds the previous output. `reset()` starts over, for example after the subject changes.

`createFaceRigSmoother()` in `camera-runtime` applies this to a `FaceRig`. Head rotation (yaw, pitch, roll) adapts to its combined angular speed; each expression coefficient adapts on its own, so a blink closes fully without unlocking the jaw. Tune with `{ pose, expression }` over the `FACE_RIG_FILTER` defaults. The output stays within the range of its inputs. `smoothFaceRig(current, target, elapsedMs)`, a fixed 80 ms moving average, remains available.

## Local Ollama writing

Import `@optimai/creative-agents/agent-runtime` in a bundler or `./src/agent-runtime.mjs` directly. The runtime uses native fetch and accepts only a literal loopback HTTP Ollama endpoint (`127.0.0.1` or `[::1]`), defaulting to `http://127.0.0.1:11434`. It rejects remote URLs, DNS hostnames including `localhost`, credentials, query strings, redirects and cloud model identifiers. It first checks the installed model list and model metadata, then requests structured generation. It validates the returned document and allows one bounded repair attempt for malformed model output. There is no automatic model download, fallback to a paid remote provider or proprietary Studio dependency.

```js
import { getLocalModelStatus, runCreativeAgent } from './src/agent-runtime.mjs';

const controller = new AbortController();
const status = await getLocalModelStatus({ signal: controller.signal });
if (!status.available) throw new Error('Start your local Ollama service first.');
console.log(status.models.map((entry) => entry.name));

// Choose a name from the installed-model list, for example from your UI selector.
const model = modelSelect.value;
const document = await runCreativeAgent({
  templateId: 'story-seed',
  values: { form: 'manga', style: 'manga', audience: 'all ages' },
  brief: 'An explorer helps a lost cloud find its way home.',
  model,
  signal: controller.signal
});
console.log(document.title, document.summary, document.sections);
// AbortController cancels the inference request.
// document.studioPrompt can be reviewed before a separate Studio handoff.
```

The result contains a title, summary, sections with headings and body text, a reviewed Studio prompt, model name, provider and template ID. It is a written creative artifact rather than an image, animation or completed Studio project. Treat model output as plain untrusted text; do not evaluate it or render it as raw HTML. Run only one local model job at a time and let users stop it. Model size and hardware determine inference speed; the SDK does not promise a universal completion time.

Eligible installed models must support local completion and have a reported size of at most 8 GiB. Cloud and embedding-only models are excluded. The runtime checks eligibility before sending a generation request.

Storyboard Builder generates a purpose, action, visual treatment, framing, dialogue and sound direction for every scene. Prompt Branches generates a shared premise, complete prompt and explanation of the difference for every alternative. The model writes these as separate structured fields; the SDK validates them and formats their public body text as labeled lines. Explicit art direction must remain in every scene or prompt, and branches retain a supported paired-cast premise. Scene and direction numbers are supplied by the SDK. These structural checks help preserve the brief; users should still review the creative result before production.

The recipe's `network: "none"` and `execution: "declarative"` describe the **recipe's privileges**: it cannot supply code, choose remote endpoints or grant itself access. The trusted host may explicitly download the fixed browser model assets or perform validated loopback inference. A host that supplies a `baseUrl` must still use a validated local endpoint. `fetchImpl` exists for controlled tests and dependency injection, not to enable an untrusted recipe to choose its own transport.

## Run a standalone agent from the command line

Choose an eligible model already installed in your Ollama service. These commands perform real local inference and print the validated artifact as JSON. `--agent` and `--manifest` are mutually exclusive; `--model` is always explicit. A manifest supplies its own approved settings and creative brief, with optional additional direction from `--brief`.

```sh
npm run run -- --agent story-seed --model qwen3.5:2b --brief "An explorer helps a lost cloud find its way home."
npm run run -- --manifest agents/cloud-companion/agent.json --model qwen3.5:2b
```

For a local Ollama service on another port, the host can set `OPTIMAI_OLLAMA_URL`. The Node SDK honors this host setting when `baseUrl` is omitted; an explicit `baseUrl` takes precedence. The CLI and MCP adapter pass the same configuration through the literal-loopback validator. A browser does not read host environment variables, and an endpoint cannot be supplied by a recipe or point at a remote provider.

```sh
OPTIMAI_OLLAMA_URL=http://127.0.0.1:11435 npm run run -- --agent style-brief --model qwen3.5:2b --brief "A warm, illustrated cloud adventure."
```

Use `node scripts/run.mjs ...` or `npm --silent run run -- ...` when a program needs only JSON on stdout, without npm's command banner. Errors are structured JSON on stderr. Ctrl+C cancels the inference request. The run command does not download a model or write a generated artifact unless you intentionally redirect its output.

The smoke command runs all five writing agents sequentially with public example text and their default settings. The runtime validates each artifact's structure, exact section count, required headings, bounded content and absence of repeated filler. The report includes each artifact and elapsed time. It stops with an error if an agent fails validation; it does not fabricate a successful result. `--report` writes only a specifically requested new JSON file and refuses to overwrite an existing file.

```sh
OPTIMAI_OLLAMA_URL=http://127.0.0.1:11435 npm run smoke -- --model qwen3.5:2b --report /absolute/path/to/new-agent-smoke-report.json
```

`npm test` needs no Ollama installation or model. CLI and MCP integration tests start a controlled mock HTTP provider on an ephemeral literal-loopback port; they verify the real public SDK and subprocess commands without installing or invoking a model. A sandbox must permit that local listener for these integration tests.


## MCP

The stdio adapter is documented in [the MCP guide](./mcp.md). It implements protocol version `2025-11-25`. Preparing a recipe does not execute a Studio workflow; only an explicit writing run with a selected installed model invokes local inference.

## MediaPipe worker packaging

For MediaPipe 1.1.0, preserve the native ES module's dynamic WASM import. Copy `vision_bundle.mjs` next to the pinned WASM assets and import that same-origin static bundle with your bundler's dynamic-import-ignore option inside the local worker. Install the worker handler before dispatching inference, or queue the first message until initialization completes. Importing the package through a bundler that rewrites its variable WASM import can fail at runtime even when the build succeeds.

The equivalent worker entry uses the reviewed SDK handler:

```js
import * as vision from '/vision-assets/vision_bundle.mjs';
import { installVisionWorker } from './src/vision-processor.mjs';
installVisionWorker(vision);
```

Serve this entry and the static dependency assets on the host's own origin. The recipe does not select their paths. Keep the upstream dependency and model licenses with any redistributed assets.

## Compatibility and troubleshooting

| Symptom | Check |
| --- | --- |
| Canvas preview fails | Serve the repository over localhost; use a real PNG, JPEG or WebP within the documented pixel limits. |
| Browser writer is unavailable | Check secure context, WebGPU with `shader-f16`, workers and available GPU memory. No remote fallback is enabled. |
| Vision says a model is missing | Check selected-agent setup progress, or use Download after Data Saver/manual setup. Cache-only loading cannot download it. |
| MediaPipe WASM fails to load | Serve the pinned native bundle and its WASM files together on the same origin; preserve its variable imports. |
| Ollama is unavailable | Start the service outside this SDK and use a literal-loopback endpoint. `localhost` is deliberately rejected by the Node runtime. |
| A writing run fails validation | Try a shorter brief or another eligible installed model. Invalid output is reported after one bounded repair attempt. |
| CLI reports unknown arguments | Use `node scripts/run.mjs --help` and `node scripts/smoke.mjs --help`; scaffold usage is `npm run create -- my-agent --template story-seed`. |

Model quality depends on the task and device. Tests cover orchestration, contracts, resource cleanup and controlled provider responses; they are not a benchmark of every GPU or model's creative quality.
