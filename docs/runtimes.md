# Runtimes and model setup

Choose the runtime for the result you need. The canvas SDK runs without a model or external dependency. Vision and browser writing use reviewed optional model runtimes. Node writing uses your own installed Ollama service. Guided recipes prepare direction for a separate host workflow.

The examples below use relative imports from an entry file at the cloned repository root. An application can bundle these source modules or use the exported package entry points through a local source dependency; the package is not distributed on npm yet. For a working model-free browser workspace, see [examples/browser](../examples/browser/README.md).

| Runtime | Setup | Output |
| --- | --- | --- |
| [Canvas](#canvas-processing) | Local browser; no model or dependency install | PNG images and design artboards |
| [Browser writing](#browser-writing) | WebGPU, pinned WebLLM dependency, local worker and explicit model download | Validated written documents |
| [Browser vision](#browser-vision) | Pinned MediaPipe dependency, local WASM/worker and explicit model download | Person cutout PNGs, pose or face landmarks |
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
| `image-resize` | `width`, `height`: positive integers up to 4096; `ratio`: original, 1:1, 16:9, 9:16 or 4:5; `fit`: cover or contain; `background`: hex color |
| `image-grid` | `columns`: 1–4; `gap`: 0–80 pixels; `background`: hex color |
| `type-overlay` | `title`: 1–300 characters; `fontSize`: 12–240; `color`: hex color; `position`: top, center or bottom |

For a fixed resize ratio, width determines height when supplied; supplying only height determines width. With the original ratio, a single supplied side preserves the source proportions, while supplying both sides creates that exact canvas. The cover or contain setting determines how the image fits this canvas. Browser color-filter support is required for the color-finish operation. Rendering and PNG encoding run in the browser; Node tests use controlled canvas and image fixtures to verify the real exported engine, validation, geometry and resource cleanup.

### Composition workspaces

```js
import { CANVAS_LAB_AGENTS, runCanvasLab } from './src/canvas-lab.mjs';

const controller = new AbortController();
const output = await runCanvasLab(CANVAS_LAB_AGENTS['poster-lab'], [], {
  title: 'EXPLORE\nSOMETHING NEW', color: '#c6f87d', ratio: '4:5', treatment: 'editorial'
}, controller.signal);
```

`mockup` creates a phone, desktop or gallery frame from one image. `bento` fits up to eight images into an asymmetric layout. `blend` and `transition` require exactly two images and use `mix: 0–100`. `glitch` displaces still-image bands with `amount: 0–100`. `poster` and `letter` accept one optional background image and a plain-text title of 1–180 characters. Ratios are 1:1, 4:5, 16:9 and 9:16; output width is 1200 pixels. Each image retains the signature and size checks of the original processor, and retained normalized inputs share a 16-million-pixel budget. Pending decode and export can be cancelled; late bitmaps and temporary canvases are disposed. These tools export PNGs, not video or model-generated artwork.

To execute a saved composition recipe, normalize its fields before rendering:

```js
import { canvasLabRecipeSettings, runCanvasLab } from './src/canvas-lab.mjs';

const settings = canvasLabRecipeSettings('poster-lab', {
  title: 'A NEW PERSPECTIVE', format: 'wide banner', style: 'cinematic'
});
const output = await runCanvasLab(settings.operation, [], settings, controller.signal);
```

The normalizer merges source defaults, maps legacy poster `format` to `ratio`, letter `text` to `title`, `style` to `treatment` and glitch `intensity` to `amount`. Explicit canonical values win. It validates recipe values and the final engine settings. Do not merge defaults into supplied values before calling it: that would conceal whether a canonical setting was explicitly selected. Raw `runCanvasLab` remains available for applications using direct bounded engine settings.

## Browser writing

Install the reviewed optional dependency in your isolated browser host:

```sh
npm install --save-exact @mlc-ai/web-llm@0.2.85
```

Create a local worker entry that imports `WebWorkerMLCEngineHandler` from the installed WebLLM dependency and calls the kit's `attachBrowserWritingWorker(WebWorkerMLCEngineHandler)`. Bundle that entry locally; a recipe cannot supply its own worker URL. The runtime downloads only the configured public Qwen 3.5 0.8B model and matching compiled WebGPU library when `load()` is explicitly called. The first download is approximately **453.2 MB**; HTTPS or localhost, Web Workers, WebGPU with `shader-f16` and sufficient GPU memory are required. The configured context is 4096 tokens, and the official model estimate is approximately 1.63 GB of GPU memory. Device support checks are conservative and cannot guarantee successful allocation on every GPU.

```js
import { createBrowserAgentRuntime } from './src/browser-writing-runtime.mjs';

const controller = new AbortController();
const writer = createBrowserAgentRuntime({
  createWorker: () => new Worker(new URL('./writing-worker.mjs', import.meta.url), { type: 'module' }),
  loadEngine: () => import('@mlc-ai/web-llm')
});
const support = await writer.status(); // No engine or model download.
if (!support.available) throw new Error(support.message);
await writer.load({ signal: controller.signal }); // Wire to an explicit Download button.
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
await downloadVisionModel('person-cutout', { signal: controller.signal }); // Explicit Download action.
const result = await runBrowserVision('person-cutout', file, {
  background: 'transparent', threshold: .5, softness: .12
}, {
  workerFactory: () => new Worker(new URL('./vision-worker.mjs', import.meta.url), { type: 'module' }),
  wasmBaseUrl: new URL('./vision-wasm/', location.href).href,
  signal: controller.signal
});
console.log(result.blob, result.analysis);
```

Person Cutout uses Selfie Segmenter (249,537 bytes) for people in portrait photos. Motion Pose uses Pose Landmarker Lite (5,777,746 bytes) for one person's 33 body landmarks. Face Performance uses Face Landmarker (3,758,596 bytes) for one visible face's 478 landmarks and raw blendshape coefficients. It does not identify people, infer personality or emotions, or swap faces. Model URLs are fixed official Google storage version-1 assets and checked against exact byte lengths and SHA-256 hashes. `getVisionModelStatus()` reads local cache only; `runBrowserVision()` never implicitly downloads a model.

Vision requires HTTPS or localhost, Web Crypto, Web Workers, ImageBitmap, OffscreenCanvas and WASM SIMD support. It uses a CPU worker and does not require WebGPU. Check the target browser before enabling the workspace.

Selected PNG, JPEG and WebP images remain in the browser. Inputs are limited to 20 MiB, 4096 pixels per side and 16 million pixels; analysis and PNG output are scaled to at most 1600 pixels per side. A CPU WASM worker is stopped after 60 seconds or on cancellation. Results depend on subject visibility and the model's training scope; an undetected subject produces a useful error rather than a fabricated landmark result. Raw landmark analysis is available in `result.analysis`; the consumer can create a reviewed JSON export if needed.

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
| Vision says a model is missing | Download the selected reviewed model explicitly in this browser before running it. |
| MediaPipe WASM fails to load | Serve the pinned native bundle and its WASM files together on the same origin; preserve its variable imports. |
| Ollama is unavailable | Start the service outside this SDK and use a literal-loopback endpoint. `localhost` is deliberately rejected by the Node runtime. |
| A writing run fails validation | Try a shorter brief or another eligible installed model. Invalid output is reported after one bounded repair attempt. |
| CLI reports unknown arguments | Use `node scripts/run.mjs --help` and `node scripts/smoke.mjs --help`; scaffold usage is `npm run create -- my-agent --template story-seed`. |

Model quality depends on the task and device. Tests cover orchestration, contracts, resource cleanup and controlled provider responses; they are not a benchmark of every GPU or model's creative quality.
