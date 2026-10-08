# OptimAI Creative Agents

## Builder documentation

Start with a small working recipe, test it locally, then prepare it for review. Importing an agent into your browser and publishing it to a community catalog are separate actions. Community submission and featured placement are not available yet.

| Guide | What you will build or learn |
| --- | --- |
| [Quickstart](./docs/quickstart.md) | Scaffold, validate, import and export your first recipe |
| [Manifest and host integration](./docs/host-integration.md) | Resolve reviewed runtimes and hand work to Studio without granting recipes extra access |
| [Local MCP adapter](./docs/mcp.md) | Connect the kit to a compatible MCP client and understand what calls actually execute |
| [Release and featuring](./docs/release-and-feature.md) | Prepare a separate open-source repository and a reviewable community submission |
| [Documentation index](./docs/README.md) | Choose between a recipe, a reviewed engine contribution and a host integration |

The execution boundary is explicit: **10 canvas agents**, **3 browser vision agents**, **5 writing agents**, and **16 guided Studio workflows**. Eleven canvas operations serve ten agent cards because Mockup Maker adds a device composition to its existing resize engine. Browser AI runs locally after an explicit download of reviewed public model assets. The five writing contracts also support an already installed Ollama model through the Node SDK. In the Studio, two guided workflows add drawing canvases before their generation handoff; those drawing interfaces are host code, outside this package.

## Run locally

Requires Node.js 20 or newer for package commands. No dependency installation or credentials are needed for validation, tests, canvas processing or recipe preparation. Ollama writing requires your own already running service and an already installed model; this kit does not install either. Browser writing and vision require a bundler, the pinned optional dependency, a local worker and the explicit model download described below. Compact browser writing is a draft aid; creators should review its narrative choices before production.

```sh
cd optimai-creative-agents
npm test
npm run verify
npm run create -- my-story-agent --template story-seed
node scripts/verify.mjs agents/my-story-agent/agent.json
```

In the private Studio workspace, this same package lives at `packages/optimai-agents/`; in the standalone repository or starter download, use `optimai-creative-agents/` as shown above.

The scaffold creates a fresh `agents/my-story-agent/` directory containing a JSON recipe and README. It refuses path traversal, symlink output roots and overwriting existing agents. Edit the JSON, validate it, and import it through the Studio's local AI Agents builder. Scaffolding and import do not publish a community listing.

## The v1 contract

```json
{
  "schemaVersion": "1.0",
  "id": "my-story-agent",
  "version": "1.0.0",
  "title": "My Story Agent",
  "description": "Plan a gentle manga adventure for young readers.",
  "category": "writing",
  "license": "MIT",
  "capabilities": {
    "network": "none",
    "execution": "declarative",
    "dataAccess": "selected-inputs"
  },
  "recipe": {
    "templateId": "story-seed",
    "values": { "form": "manga", "style": "manga", "audience": "all ages" },
    "brief": "A curious explorer learns to help a lost cloud find its way home."
  }
}
```

`schema/agent-manifest.schema.json` is JSON Schema 2020-12. `validateAgentManifest` is the runtime authority and also rejects prototype-shaped keys, getters, inherited objects, hidden properties, circular data and excessive nesting in direct JavaScript calls. Unknown fields, unknown template IDs, invalid select values, non-finite numbers and out-of-range dimensions are rejected with paths and corrective messages. Values are data, never JavaScript or template source. The v1 object format is unchanged: legacy `ToolManifest` JSON, `TOOL_CATALOG` and the old Tool API aliases remain accepted for saved recipes. The legacy schema stays at `schema/tool-manifest.schema.json`.

Limits: IDs 64 characters, titles 80, descriptions 600, creative briefs 4,000, regular text settings 2,000, overlay text 300, compiled prompts 12,000. CLI and MCP input manifests/messages are limited to 64 KiB. Exported manifest values are detached from input objects.

```js
import { AGENT_CATALOG, createAgentManifest, validateAgentManifest, compileAgentPrompt } from './src/index.mjs';

const recipe = createAgentManifest('story-seed', {
  id: 'cloud-adventure', title: 'Cloud Adventure', brief: 'A lost cloud finds a friend.'
});
const result = validateAgentManifest(recipe);
if (!result.success) throw new Error(result.errors.join('\n'));
const prompt = compileAgentPrompt(result.manifest, { style: 'manga' });
console.log(prompt);
```

TypeScript consumers use the included `src/index.d.mts` declarations. `AGENT_CATALOG` is deeply frozen. `compileAgentPrompt` always resolves a reviewed catalog template by ID; it ignores any supplied replacement template code. Prompts are bounded creative input, not a security boundary for downstream AI. The host must still keep media selection, generation, payment, publishing and privileged operations behind its own authorization.

## What the 34 agents do

These are original OptimAI names and implementations informed by the publicly visible functions in the Google Flow template gallery. No Google source code, illustrations, brand assets or internal APIs are included. The source-template column is a research mapping, not an endorsement or compatibility guarantee.

| Category | OptimAI recipe | Researched Flow function | Actual v1 behavior |
| --- | --- | --- | --- |
| Image | Sketch to Scene | Simple Sketch | Host drawing canvas and Image Studio generation direction |
| Image | World Finder | Scene Explorer | Image Studio location and atmosphere direction |
| Image | Mockup Maker | Mockup | Local device mockup, gallery frame and resize |
| Image | Image Finish | Image Editor | Local still-image color filter |
| Image | Shot Atlas | Shot Explorer | Image Studio alternate-shot direction |
| Image | Select & Replace | Mask Magic | Local person segmentation with transparent or solid background; not arbitrary object editing |
| Image | Reference Blend | Converge | Local two-image alpha composition; not semantic AI blending |
| Image | Image Grid | Grid Architect | Local contact sheet |
| Video | Motion Finish | Shader Effects | Editor Studio effect direction |
| Video | Title Frame | Type Overlays | Local title overlay on a still image |
| Video | Pixel Layout | pixelBento | Local still-image bento layout |
| Video | Poster Lab | Poster Designer | Local still-image poster typography and artboard |
| Video | Sketch to Motion | Video Sketch | Host drawing canvas and Video Studio generation direction |
| Video | Transition Lab | Transition Machine | Local still-image transition preview; separate Video Studio production |
| Video | Dream Signal | Weirdcore | Video Studio surreal scene direction |
| Video | Frame Fit | Video Resizer | Editor Studio resize/crop brief |
| Video | Rough Cut | Stringout Creator | Editor Studio sequence plan |
| Video | Rhythm Cut | Video Granulator | Editor Studio rhythmic-fragment plan |
| Writing | Cast Notes | Character X-Ray | Local-model character bible and visual notes |
| Writing | Style Brief | Style Writer | Local-model art-direction document |
| Writing | Storyboard Builder | Storyboard Studio | Local-model scene-by-scene storyboard |
| Writing | Prompt Branches | Prompt Tree | Local-model creative direction alternatives |
| Writing | Story Seed | Story Sketch | Local-model story treatment and production outline |
| Experimental | Frame Study | Frame Deconstructor | Image Studio visual-analysis brief |
| Experimental | Motion Tracker | Blob Tracking | Editor Studio tracking plan |
| Experimental | Depth Motion | DepthWarp4D | Video Studio layered-depth direction |
| Experimental | Camera Stage | Webcam Set | Image Studio virtual-set direction from a selected still |
| Experimental | Glitch Cut | Datamosh | Local still-image displaced bands and tint; not a video datamosh codec |
| Experimental | Model Turntable | 3D Model Visualizer | Video Studio turntable concept from renders |
| Experimental | Scene Scout | Scout360 | Image Studio location-scouting board brief |
| Experimental | Motion Pose | Ribbit | Local still-image pose landmarks and reference PNG |
| Experimental | Scene Remix | Whisk | Image Studio subject/setting/style brief |
| Experimental | Letter Pose | Pose Text | Local letterform artboard and PNG |
| Experimental | Face Performance | 3D Face Swap | Local face landmarks and raw blendshape coefficients; not face swapping or identity recognition |

The original four canvas processors live in `src/browser-runtime.mjs`; seven additional composition operations live in `src/canvas-lab.mjs`. Vision engines live in `src/vision-runtime.mjs` and `src/vision-processor.mjs`. The browser writer shares the task contracts and output validator of the Ollama engine. Sixteen catalog recipes still require Studio generation or editing: they provide direction rather than implementing tracking, webcam capture, 3D rendering or full video processing. Legacy catalog `runtime` and `executionKind` fields describe the v1 recipe dispatch; a host resolves these additional reviewed SDK operations by agent ID instead of treating the legacy fields as a complete feature inventory.

## Run the image processors in your browser

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

const output = await runCanvasLab(CANVAS_LAB_AGENTS['poster-lab'], [], {
  title: 'EXPLORE\nSOMETHING NEW', color: '#c6f87d', ratio: '4:5', treatment: 'editorial'
}, controller.signal);
```

`mockup` creates a phone, desktop or gallery frame from one image. `bento` fits up to eight images into an asymmetric layout. `blend` and `transition` require exactly two images and use `mix: 0–100`. `glitch` displaces still-image bands with `amount: 0–100`. `poster` and `letter` accept one optional background image and a plain-text title of 1–180 characters. Ratios are 1:1, 4:5, 16:9 and 9:16; output width is 1200 pixels. Each image retains the signature and size checks of the original processor, and retained normalized inputs share a 16-million-pixel budget. Pending decode and export can be cancelled; late bitmaps and temporary canvases are disposed. These tools export PNGs, not video or model-generated artwork.

## Browser writing with an explicit model download

Install the reviewed optional dependency in your isolated browser host:

```sh
npm install --save-exact @mlc-ai/web-llm@0.2.85
```

Create a local worker entry that imports `WebWorkerMLCEngineHandler` from the installed WebLLM dependency and calls the kit's `attachBrowserWritingWorker(WebWorkerMLCEngineHandler)`. Bundle that entry locally; a recipe cannot supply its own worker URL. The runtime downloads only the configured public Qwen 3.5 0.8B model and matching compiled WebGPU library when `load()` is explicitly called. The first download is approximately **453.2 MB**; HTTPS or localhost, Web Workers, WebGPU with `shader-f16` and sufficient GPU memory are required. The configured context is 4096 tokens, and the official model estimate is approximately 1.63 GB of GPU memory. Device support checks are conservative and cannot guarantee successful allocation on every GPU.

```js
import { createBrowserAgentRuntime } from './src/browser-writing-runtime.mjs';

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

## Browser vision on selected images

Install the reviewed optional dependency in your isolated browser host:

```sh
npm install --save-exact @mediapipe/tasks-vision@1.1.0
```

Bundle a local worker that imports the MediaPipe namespace and calls `installVisionWorker(vision)` from `src/vision-processor.mjs`. Copy the official `vision_wasm_module_internal.js` and `.wasm` files into the host's local static assets, and supply their same-origin directory as `wasmBaseUrl`. No worker, executable URL or WASM path is taken from a recipe. The host is responsible for serving reviewed dependency assets and retaining their upstream licenses.

```js
import { downloadVisionModel, runBrowserVision } from './src/vision-runtime.mjs';

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

Selected PNG, JPEG and WebP images remain in the browser. Inputs are limited to 20 MiB, 4096 pixels per side and 16 million pixels; analysis and PNG output are scaled to at most 1600 pixels per side. A CPU WASM worker is stopped after 60 seconds or on cancellation. Results depend on subject visibility and the model's training scope; an undetected subject produces a useful error rather than a fabricated landmark result. Raw landmark analysis is available in `result.analysis`; the consumer can create a reviewed JSON export if needed.

## Execute a writing agent with a local model

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

Storyboard Builder generates a purpose, action, visual treatment, framing, dialogue and sound direction for every scene. Prompt Branches generates a shared premise, complete prompt and explanation of the difference for every alternative. The model writes these as separate structured fields; the SDK validates them and formats their public body text as labeled lines. Explicit art direction must remain in every scene or prompt, and branches retain a supported paired-cast premise. Scene and direction numbers are supplied by the SDK. These structural checks help preserve the brief; users should still review the creative result before production.

The recipe's `network: "none"` and `execution: "declarative"` describe the **recipe's privileges**: it cannot supply code, choose remote endpoints or grant itself access. The trusted host may explicitly download the fixed browser model assets or perform validated loopback inference. A host that supplies a `baseUrl` must still use a validated local endpoint. `fetchImpl` exists for controlled tests and dependency injection, not to enable an untrusted recipe to choose its own transport.

## Run a standalone agent from the command line

Choose an eligible model already installed in your Ollama service. These commands perform real local inference and print the validated artifact as JSON. `--agent` and `--manifest` are mutually exclusive; `--model` is always explicit. A manifest supplies its own approved settings and creative brief, with optional additional direction from `--brief`.

```sh
npm run run -- --agent story-seed --model qwen3.5:2b --brief "An explorer helps a lost cloud find its way home."
npm run run -- --manifest agents/my-story-agent/agent.json --model qwen3.5:2b
```

For a local Ollama service on another port, the host can set `OPTIMAI_OLLAMA_URL`. The Node SDK honors this host setting when `baseUrl` is omitted; an explicit `baseUrl` takes precedence. The CLI and MCP adapter pass the same configuration through the literal-loopback validator. A browser does not read host environment variables, and an endpoint cannot be supplied by a recipe or point at a remote provider.

```sh
OPTIMAI_OLLAMA_URL=http://127.0.0.1:11435 npm run run -- --agent style-brief --model qwen3.5:2b --brief "A warm, illustrated cloud adventure."
```

Use `node scripts/run.mjs ...` or `npm --silent run run -- ...` when a program needs only JSON on stdout, without npm's command banner. Errors are structured JSON on stderr. Ctrl+C cancels the inference request. No command downloads a model or writes a generated artifact unless you intentionally redirect its output.

The smoke command runs all five writing agents sequentially with public example text and their default settings. The runtime validates each artifact's structure, exact section count, required headings, bounded content and absence of repeated filler. The report includes each artifact and elapsed time. It stops with an error if an agent fails validation; it does not fabricate a successful result. `--report` writes only a specifically requested new JSON file and refuses to overwrite an existing file.

```sh
OPTIMAI_OLLAMA_URL=http://127.0.0.1:11435 npm run smoke -- --model qwen3.5:2b --report /absolute/path/to/new-agent-smoke-report.json
```

`npm test` needs no Ollama installation or model. CLI and MCP integration tests start a controlled mock HTTP provider on an ephemeral literal-loopback port; they verify the real public SDK and subprocess commands without installing or invoking a model. A sandbox must permit that local listener for these integration tests.

## MCP adapter

An optional, runnable stdio adapter exposes all 34 recipes as MCP tools. It supports the **fixed protocol version 2025-11-25**, not a claim of the latest specification or every optional MCP capability. It implements JSON-RPC initialization, `notifications/initialized`, `ping`, `tools/list` and `tools/call`.

Configure an MCP client to launch Node directly, avoiding npm's command banners on protocol stdout:

```json
{
  "mcpServers": {
    "optimai-creative-agents": {
      "command": "node",
      "args": ["/absolute/path/to/optimai-creative-agents/src/mcp-server.mjs"],
      "env": { "OPTIMAI_OLLAMA_URL": "http://127.0.0.1:11435" }
    }
  }
}
```

By default each call returns a structured, validated recipe with the prompt, runtime, selected settings and Studio destination. A writing-agent call can explicitly set `execution: "run"` and an installed `model` to return its generated written result. These runs contact the local Ollama service on loopback; they do not access remote models, read selected files, spend Studio credits or publish anything. Browser image processing uses the browser SDK rather than this Node adapter. The client and host are responsible for authorization when turning a prepared recipe into a real action. This adapter is written against the [official lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), [stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) and [tool messages](https://modelcontextprotocol.io/specification/2025-11-25/server/tools). Tests exercise the actual subprocess protocol, including malformed input and lifecycle handling.

Only one local-model MCP run is accepted at a time. `notifications/cancelled` aborts that request. The stable MCP tool names remain `optimai.<template-id>`; renaming the platform to AI Agents does not break previously configured clients.

## Community integration and release

The lowest-risk extension path is a declarative recipe: builders customize reviewed agent templates and typed values without executable code. Adding a genuinely new operation requires source review, tests, capability review and a host implementation. Arbitrary GitHub JavaScript, npm dependencies, remote manifests, camera access and remote MCP endpoints are not installed by this kit.

Create a separate repository named **`optimai-creative-agents`**, with the display title **OptimAI Creative Agents**. Start from the reviewed starter ZIP or copy only the contents of this package. Initialize fresh Git history in that separate directory; the private Studio repository and its history remain outside the release. The starter ZIP includes the SDK, examples, schemas, tests, documentation and original artwork. It excludes the Studio frontend, backend, account system, billing, database and selected user media.

Run `npm test` and `npm run verify` in the standalone directory. Public GitHub source releases may keep `private: true`; change npm publishing settings only when intentionally preparing a separate npm release. A future agent registry must review ownership, licenses, permissions, version pinning and behavior before promoting a submission into the public catalog.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the coding and review workflow.

## Original agent artwork

`artwork/` contains 34 original standalone SVG thumbnails, one named after each reviewed agent ID. They are covered by this kit's MIT license, have no scripts or external assets, and can be used independently of the proprietary Studio. Host them as static images; the Studio's interactive React artwork renderer remains separate host code.

For MediaPipe 1.1.0, preserve the native ES module's dynamic WASM import. Copy `vision_bundle.mjs` next to the pinned WASM assets and import that same-origin static bundle with your bundler's dynamic-import-ignore option inside the local worker. Install the worker handler before dispatching inference, or queue the first message until initialization completes. Importing the package through a bundler that rewrites its variable WASM import can fail at runtime even when the build succeeds.


**Repository name:** `optimai-creative-agents` · **SDK package:** `@optimai/creative-agents` · **License:** MIT

A local-first SDK and starter for bounded creative agents. Its manifest, canvas and Ollama engines are dependency-free; browser model engines use explicitly installed, pinned optional dependencies. The kit is isolated from OptimAI Studio's proprietary application: it has no host imports, account access, API keys, billing logic, user database or asset library.