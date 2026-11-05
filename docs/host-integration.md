# Integrate agents into your application

A host reads a recipe, validates it, resolves a reviewed implementation and supplies the user's selected inputs. The SDK works independently of OptimAI Studio. Start with the [browser example](../examples/browser/) for a complete canvas input → preview → export flow, then use the [runtime guide](./runtimes.md) for optional writing, vision, 3D and camera engines. The [interactive example](../examples/interactive/README.md) shows the same engines without the private Studio app.

A recipe is configuration for code you have already chosen to ship. It cannot install JavaScript, select a worker URL, add a new model service or grant itself account access.

## Use the SDK from source

Clone the [public repository](https://github.com/OptimaiNetwork/optimai-creative-agents) to use its modules directly. The snippets below assume a JavaScript module at the repository root; adjust relative imports for your application's layout. A host that installs the checkout from a local path can use package exports such as `@optimai/creative-agents` and `@optimai/creative-agents/browser-runtime`. The package is not currently published to npm.

## Import and export validated JSON

```js
import { validateAgentManifest, compileAgentPrompt } from './src/index.mjs';

export async function readRecipe(file) {
  if (file.size > 65_536) throw new Error('Choose a manifest no larger than 64 KiB.');
  const result = validateAgentManifest(JSON.parse(await file.text()));
  if (!result.success) throw new Error(result.errors.join('\n'));
  return result.manifest;
}

export function serializeRecipe(candidate) {
  const result = validateAgentManifest(candidate);
  if (!result.success) throw new Error(result.errors.join('\n'));
  return JSON.stringify(result.manifest, null, 2) + '\n';
}

export function prepareRecipe(candidate) {
  const result = validateAgentManifest(candidate);
  if (!result.success) throw new Error(result.errors.join('\n'));
  return compileAgentPrompt(result.manifest);
}
```

Wire `readRecipe` to an explicit file picker. Show parse and validation failures in the UI, and validate again after editing settings and before execution. Save the detached `result.manifest` rather than retaining the original mutable object. `serializeRecipe` produces portable JSON for a download or host-owned storage; persistence is a host decision. Preparing a prompt performs no inference or media processing.

The static [manifest schema](../schema/agent-manifest.schema.json) uses JSON Schema 2020-12. The SDK additionally checks plain-data structure, the chosen template's category and fields, string limits and privilege values. It rejects unknown properties, accessors, hidden keys, prototype-shaped data and excessive nesting in direct JavaScript calls. Recipe briefs allow up to 4,000 characters; individual runtimes can enforce a smaller limit.

Treat recipe metadata, compiled prompts and model output as untrusted plain text. Use text nodes or your framework's escaped text rendering. Do not evaluate them or render them as raw HTML.

## Dispatch a reviewed operation

Use the source catalog's versioned `workspace` descriptor to select an adapter your application already bundles. `getAgentWorkspace(id)` returns its `kind`, reviewed `operation` and optional presentation `headline`; `AGENT_WORKSPACE_CONTRACT_VERSION` is `1.3`; the v1 recipe schema remains unchanged. Template titles, descriptions, fields and artwork remain public presentation data. Legacy `executionKind` and `runtime` exports are retained for older consumers.

### Input policy

`getAgentInputPolicy(id)` tells a host what to ask for before it opens a workspace. It is derived from the same `workspace` descriptor, so it needs no contract bump and no recipe change:

```js
import { getAgentInputPolicy } from '@optimai/creative-agents';

const { minFiles, maxFiles, accept, maxBytes, needs, optional, onDevice } = getAgentInputPolicy('reference-blend');
// { minFiles: 2, maxFiles: 2, accept: 'image/png,image/jpeg,image/webp', maxBytes: 20971520,
//   needs: ['canvas'], optional: [], onDevice: true }
```

Use `accept` for the file input, `maxFiles > 1` for `multiple`, and `minFiles` for empty-state copy. `needs` lists browser features from `AGENT_INPUT_NEEDS` that the agent cannot run without (`webgl` for 3D and Frame Sculpture, `web-audio` for Sound Canvas, `worker`, `wasm` and `offscreen-canvas` for vision). `optional` lists features that only enhance it: a camera, face tracking or `media-recorder` export for camera agents, and `webgpu` for writing, which can also use a local Ollama runtime. `onDevice` is `false` only for guided and sketch templates, whose result comes from a host production step. The engines stay the authority: they re-check counts, types and bytes on every run, so a policy is for interface decisions, not validation.

Keep a host-owned allowlist of supported workspace versions and operations. The catalog can describe an operation, but it cannot install an adapter in a running application. A new template that reuses a supported operation can appear and open its workspace after a reviewed SDK upgrade; a new operation or custom interface needs integration and testing first.

For example, this host deliberately exposes the four original still-image processors:

```js
import { getAgentTemplate, getAgentWorkspace, validateAgentManifest } from './src/index.mjs';
import { runLocalTool } from './src/browser-runtime.mjs';

const IMAGE_OPERATIONS = new Set(['image-filter', 'image-resize', 'image-grid', 'type-overlay']);

export async function runImageRecipe(candidate, files, signal) {
  const checked = validateAgentManifest(candidate);
  if (!checked.success) throw new Error(checked.errors.join('\n'));
  const manifest = checked.manifest;
  const templateId = manifest.recipe.templateId;
  const workspace = getAgentWorkspace(templateId);
  if (workspace?.kind !== 'canvas' || !IMAGE_OPERATIONS.has(workspace.operation)) {
    throw new Error('This host does not run this recipe. Choose an installed image tool.');
  }
  const template = getAgentTemplate(templateId);
  const values = Object.fromEntries(template.fields.map(field => [field.id, field.default]));
  Object.assign(values, manifest.recipe.values);
  return runLocalTool(workspace.operation, files, values, signal);
}
```

Supply selected browser `File` objects, pass an `AbortSignal` from your Stop control and show the returned `{ blob, width, height, filename }` as a PNG preview. The engine validates actual image signatures, dimensions and resource limits. No recipe can supply a media URL or cause this processor to fetch it. Revoke object URLs your application creates when a preview is replaced or removed.

A broader host can add these reviewed runtime adapters:

| Capability | SDK entry and dispatch | Output and host requirements |
| --- | --- | --- |
| Original image processing | `browser-runtime` → `runLocalTool` | PNG; selected PNG/JPEG/WebP files and bounded settings |
| Additional composition | `canvas-lab` → `canvasLabRecipeSettings`, `runCanvasLab` | PNG and the title ink, lines, placement and scrim, transition, glitch seed or print look actually drawn; normalize defaults, canonical settings and saved v1 aliases |
| Color | `color` → `pickLegibleColor`, `analyzeImageColors`, `dominantColors`, `mixColors`; `color-grade` → `gradePixels`, `resolveGrade`, `gradeColor`; `lut` → `parseCubeLut`, `applyLut`, `filmLut`, `lutColor` | OKLab/OKLCH conversions, WCAG contrast, readable ink, deterministic image palettes, a per-pixel OKLab grade and strict `.cube` LUTs; Node and browser |
| Transitions | `transition` → `composeTransition`, `resolveTransition`, `transitionProgress`, `transitionTimes` | Wipe, iris, light-key, push and dissolve frames between two RGBA buffers with eased time and feathered edges; Node and browser |
| Glitch | `glitch` → `glitchPixels`, `planGlitch`, `randomGlitchSeed`, `mulberry32` | Seeded block, colour-trail and echo glitches on an RGBA buffer, identical bytes for the same seed; Node and browser |
| Print looks | `print` → `printPixels`, `resolvePrint`, `separateDuotone`, `bayerMatrix`, `blueNoiseMatrix` | Riso duotone, halftone dots and Floyd–Steinberg, Bayer and blue-noise dithers on an RGBA buffer, identical bytes for the same settings; Node and browser |
| Typography | `typeset` → `fitTitle`, `breakLines`, `opticalSize`, `canvasMeasure`; `text-placement` → `placeTextBlock`, `chooseTitleInk`, `fitScrim`, `regionInterest` | Balanced or paragraph line breaks and optical tracking and leading for titles, against any measure function; title placement in the calmest region of a focus map and the lightest scrim that keeps an ink readable; Node and browser |
| Browser vision | `vision-runtime` → `downloadVisionModel`, `runBrowserVision` | PNG and analysis; selected-agent setup policy, reviewed local worker and WASM assets |
| Browser writing | `browser-writing-runtime` → `createBrowserAgentRuntime` | Validated written artifact; selected-agent setup policy, supported WebGPU device and local worker |
| 3D scene | `scene-3d` → `scene3DRecipeSettings`; `scene-3d-runtime` → `createScene3DStage` | Procedural/local GLB WebGL stage, PNG and scene recipe; optional reviewed Three peer |
| Camera effects/avatar | `camera-runtime`, `camera-renderer`, `camera-tracking`, `camera-worker`, `landmark-filter` | Canvas effects and original face-driven avatar; explicit permission and local verified tracking worker |
| Music visuals | `music-reactive`, `beat-tracker` | Measured spectrum looks with an optional flash-limited beat pulse; the host owns the audio graph, playback and recording |
| Run records | `run-record` → `createRunRecord`, `digestInputs`, `parseRunRecord`, `createRunHistory`, `runRecipeValues`; `canvas-lab` → `canvasLabRecipeValues` | A stable hash per result over template, settings, seed, SDK version and an input digest; tamper-checked JSON; a de-duplicated run list; settings back to recipe values for Remix; Node and browser |
| Settings forms | `form-schema` → `getAgentFormSchema`, `listFormFields`, `getAgentFieldRoles`, `plainFormSchema` | JSON Schema 2020-12 per template with control, step, group and role hints; one source for builders, docs, MCP and host gates; Node and browser |
| Capability probe | `capabilities` → `probeCreativeCapabilities`, `detectCreativeCapabilities`, `assessAgentCapabilities`, `modelSetupEnvironment` | What this browser and device can run (WebGPU adapter, WebGL, WebCodecs, OffscreenCanvas, `ctx.filter`, camera, memory, Save-Data) and the card words for each template, without asking for any permission; browser, testable in Node |
| Accessible motion and alt text | `accessibility` → `createMotionPreference`, `reducedMotionSettings`, `getAgentMotion`, `measureFlashes`, `frameLuminance`, `createFlashLimiter`, `describeAgentOutput`, `colorName` | One reduced-motion source with an in-app override for the 3D and frame sculpture stages, each agent's reduced variant, the WCAG 2.3.1 flash limiter and a flash meter for rendered frames, and alt text for any export written from its settings; Node and browser |
| Card previews | `card-preview` → `renderAgentPreview`, `createPreviewPlayer`, `getAgentPreview` | A small deterministic looping animation per agent for gallery cards (shapes only, no text or images, nothing flashes); hover-to-play with a poster frame for reduced motion; Node, workers and the browser |
| A/B compare | `compare` → `compareOutputs`, `compareImages`, `describeComparison`, `splitView`, `stepSplit` | How two results differ (share changed, PSNR, SSIM-lite structure, OKLab colour shift, changed region, optional diff heatmap) in numbers and plain words, plus the clip and keyboard steps for a before/after slider; Node and browser |
| Progress | `progress` → `normalizeProgress`, `describeProgress`, `progressSteps`, `createProgressReporter`, `ENGINE_PROGRESS_STAGES` | One `{ stage, message, loaded, total, frame, frames, progress }` event from vision, writing, frame sampling and canvas runs, staged words for it and a stepper; Node and browser |
| Model preparation | `model-setup` → `getModelSetupPolicy`, `createModelSetupController`, `describeModelSetup`, `formatBytes` | Automatic/manual/unsupported decision, one abortable setup state machine with byte progress, and readable sizes; host supplies the reviewed load and check calls |
| Local Ollama writing | `agent-runtime` → `runCreativeAgent` | Validated written artifact; explicitly selected eligible installed model and loopback service |
| Guided production | `compileAgentPrompt` and a host handoff | Prepared direction; the destination host runs Image, Video, Story, Character or Editor production |

Vision workspace descriptors identify `person-cutout`, `pose-reference` or `face-reference`. `CANVAS_LAB_AGENTS` derives its composition map from the same catalog. Writing descriptors use the five implemented output-contract IDs; declaring an unknown writer does not implement its output validation. Sketch descriptors identify a browser drawing workspace followed by a separate Studio production step.

Recipe fields and direct engine settings can differ. Use `canvasLabRecipeSettings(templateId, manifest.recipe.values)` for compositions: it merges template defaults, preserves legacy `format`, `text`, `style` and `intensity` aliases, and gives explicit canonical settings priority. Pass the resulting settings to `runCanvasLab(settings.operation, files, settings, signal)`. The engine validates its bounded settings again. Mockup Maker keeps its original image-resize recipe fields for compatibility, while its default workspace now selects device composition. See [runtime APIs and limits](./runtimes.md) for exact options and requirements.

## Normalize portable interactive recipes

`3d:scene`, `camera:effects` and `camera:avatar` (workspace contract 1.1), `music:reactive` and `frame:sculpture` (contract 1.2), and the `canvas:print` composition (contract 1.3) are source-reviewed bindings. Keep these operations on the host allowlist; an untrusted recipe cannot add another binding. Studio consumes the same public engine modules through thin adapters. Its dialog layout, account state, asset picker, credits and production services remain private host code.

```js
import { getAgentWorkspace, validateAgentManifest } from './src/index.mjs';
import { scene3DRecipeSettings } from './src/scene-3d.mjs';
import { createScene3DStage } from './src/scene-3d-runtime.mjs';
import { cameraRecipeSettings } from './src/camera-runtime.mjs';

export async function openInteractiveRecipe(candidate, mountedContainer, options) {
  const checked = validateAgentManifest(candidate);
  if (!checked.success) throw new Error(checked.errors.join('\n'));
  const { templateId, values } = checked.manifest.recipe;
  const workspace = getAgentWorkspace(templateId);
  if (workspace?.kind === '3d' && workspace.operation === 'scene') {
    const recipe = scene3DRecipeSettings(templateId, values);
    const stage = await createScene3DStage(mountedContainer, recipe.settings, options);
    stage.camera(recipe.camera);
    return stage; // Host closes it with dispose(), and owns PNG download/reference handoff.
  }
  if (workspace?.kind === 'camera' && ['effects', 'avatar'].includes(workspace.operation)) {
    return { settings: cameraRecipeSettings(templateId, values), workspace };
    // Render with the shared camera modules; requesting camera permission is another user action.
  }
  throw new Error('This host does not support this interactive workspace.');
}
```

Use `scene3DRecipeSettings` before rendering so `finish`, `view`, focal length and percent exposure change actual materials, camera and lighting. The normalizer preserves accepted legacy free-text material fields. `cameraRecipeSettings` maps recipe effect/look/intensity/mirror controls into bounded renderer settings. Do not interpret arbitrary recipe text as executable shader, model path or worker URL.

The scene engine either loads the installed optional `three@0.186.1` peer on creation or accepts trusted injected Three/addon modules. The camera avatar renderer requires a host-supplied pinned `THREE` module; its tracker requires a host-created worker, same-origin WASM path and verified model buffer. Review these code/assets together with their licenses before shipping. See [runtime ownership and exact APIs](./runtimes.md#interactive-3d-scenes).

## Promote a source release into Studio

OptimAI Studio bundles a reviewed, pinned SDK commit. Public pull-request checks validate the SDK; Studio integration additionally checks its own adapters and build. Approved title, description, settings, artwork and processor changes ship with that frontend release. Compatible new source catalog templates are listed from the bundled catalog without adding a second host ID map.

Merging the public repository does not alter the live site immediately. Maintainers promote the reviewed source revision through Studio integration checks and deploy its frontend. An incompatible new operation must wait for a host adapter; it should fail the compatibility gate rather than appear as a working agent. Account, billing, project and production API changes remain separate host work and may need a backend release.

Portable JSON recipes customize existing templates. Adding an example recipe to a GitHub pull request does not automatically turn it into a built-in catalog template or featured listing. Contribute the source catalog entry, implementation or supported operation binding, original artwork, declarations, schemas and relevant tests when proposing a new built-in agent. Editorial featuring remains a separate decision.

## Prepare only the selected model

`network: "none"` and `execution: "declarative"` describe the recipe's privileges. A trusted host can prepare fixed public model assets after the user selects an agent, or run inference against a validated literal-loopback service. `getModelSetupPolicy` recommends automatic setup on supported devices and manual setup for Data Saver, slow connections and large-model memory limits; it performs no network request itself. Model configuration stays in host code or host environment settings; it is never read from a recipe.

Show model size, device requirements, progress and browser storage behavior as preparation starts. In manual mode, offer Download; in unsupported mode, offer basic filters, procedural demos, canvas tools or guided direction. Camera permission is a separate explicit action. Stop/cancel a download when the workspace closes and keep retry deliberate. Allow users to browse other tools while preparation runs. Run writing jobs sequentially, expose progress and cancellation, and display model failures without substituting canned creative output. Vision work should report a missing subject when detection fails.

Connect cancellation and cleanup to every asynchronous operation. Release workers, decoded images, canvases, GPU sessions and temporary URLs after completion, failure or cancellation. The [runtime guide](./runtimes.md) explains each engine's ownership and disposal API.

## Show staged progress with one event shape

Vision, writing, frame sampling and canvas runs all report the same event: `{ stage, message, loaded?, total?, frame?, frames?, attempt?, progress? }`. Bytes are `loaded`/`total`, counted work is `frame`/`frames`, and `progress` (0–1) is derived when an engine does not give one. Render it once for every workspace:

```js
import { describeProgress, progressSteps } from '@optimai/creative-agents/progress';
import { runCanvasLab } from '@optimai/creative-agents/canvas-lab';

const controller = new AbortController();
const show = event => {
  status.textContent = describeProgress(event);        // "Downloading 3.1 MB of 5.8 MB · 53%", "Warming up", "Frame 4 of 8"
  stepper.render(progressSteps('canvas', event));      // [{ stage, label, state: 'done' | 'current' | 'pending' }]
  bar.value = event.progress ?? 0;
};
stop.onclick = () => controller.abort();
const result = await runCanvasLab('transition', files, values, { signal: controller.signal, onProgress: show });
```

Stages come from one list (`PROGRESS_STAGES`: check, download, verify, warmup, prepare, plan, generate, validate, repair, analyze, render, frame, export, ready), and `ENGINE_PROGRESS_STAGES` gives each engine's order for a stepper. `runCanvasLab` takes `{ signal, onProgress }` as its fourth argument (a bare `AbortSignal` still works) and reports prepare → render → frame (the transition strip) → export → ready. Vision events keep their old `phase` next to `stage` (the worker's `initialize` is now `warmup`) and downloads carry bytes; writing download events carry the reviewed model size as `total`; `extractFrameSamples` keeps its `(complete, total)` arguments and adds the event as a third. `normalizeProgress` reads older shapes, so a host can pass any of them through the same renderer.

Build your own engine's progress with `createProgressReporter(onProgress, { signal })`: it sends canonical, frozen events, stops reporting once the signal aborts (a cancelled run never repaints a stale status), and ignores a listener that throws. Cancellation itself stays with the engine's `signal`; check it between steps.

## Warn before a click with the capability probe

Probe once per page, then let each gallery card say what will happen before anyone opens it:

```js
import { assessAgentCapabilities, probeCreativeCapabilities } from '@optimai/creative-agents/capabilities';

const report = await probeCreativeCapabilities({ timeoutMs: 1500 });
const { status, message } = assessAgentCapabilities('model-turntable', report);
// status: 'ready' | 'limited' | 'slow' | 'unsupported'
// message: '' | 'No camera found here. Try it with a photo.' | 'Runs slower on this device.' | 'Needs WebGL, which this browser doesn’t offer.'
```

`detectCreativeCapabilities()` is the synchronous half: feature presence for every `AGENT_INPUT_NEEDS` entry plus `canvas-filter` and `webcodecs`, and device hints (`memoryGB`, `cores`, `saveData`, `effectiveType`, `reducedMotion`, `coarsePointer`). `probeCreativeCapabilities` adds the two answers that need a promise: whether a WebGPU adapter exists (a software adapter sets `gpu.fallback`) and whether any camera is attached. It never calls `getUserMedia` or asks for a permission, releases its WebGL test context at once, and keeps the synchronous answer for a step that times out or is aborted.

`assessAgentCapabilities(id, report)` reads the template's input policy: a missing hard need is `unsupported`; a small device (under 4 GB or two cores), a software GPU or Data Saver before a model download is `slow` for vision, 3D, camera, frame and browser writing; a missing optional feature (camera, recording, face tracking, WebGPU for writing) is `limited` with a line that says what still works. With no report every template reads `ready`, so server rendering shows no warnings. Pass the same report to `getModelSetupPolicy(model, modelSetupEnvironment(report))` to keep one source of device facts. The engines still check on every run; a report is for interface decisions.

## Respect reduced motion and describe every export

Every agent that moves on its own has a calm variant, and every export can carry alt text written from the settings that made it:

```js
import { createMotionPreference, describeAgentOutput, getAgentMotion, measureFlashes, frameLuminance, reducedMotionSettings } from '@optimai/creative-agents/accessibility';

const motion = createMotionPreference();            // follows the device…
motion.set('reduce');                                // …or an in-app toggle: 'system' | 'reduce' | 'full'
const stage = await createScene3DStage(container, settings, { motion }); // also createFrameSculptureStage
getAgentMotion('model-turntable').note;              // 'Turntable rotation pauses for reduced motion; you can still orbit by hand.'
if (motion.matches) settings = reducedMotionSettings('model-turntable', settings); // rotating: false

img.alt = describeAgentOutput('print-shop', values, { width: 1080, height: 1350 });
// 'Print Shop image, 1080 × 1350: print look halftone dots, riso inks pink + blue, ink color dark blue, …'
```

`createMotionPreference` is a `MediaQueryList` look-alike (`matches`, `change` events) over `(prefers-reduced-motion: reduce)`, so a stage that already listened to the device query accepts it unchanged; without a `motion` option the stages keep reading the device. `reducedMotionSettings(id, settings)` returns the reduced variant without adding keys a strict validator rejects: turntables and frame sculptures stop rotating, Sound Canvas gets `reducedMotion: true` (its calm cover, no beat pulse), and camera stages hold their animated effects. Still agents come back unchanged.

`createFlashLimiter` is the same WCAG 2.3.1 limiter the beat tracker uses (at most three evenly spaced flashes a second; the cap cannot be raised). To check rendered output, take `frameLuminance(imageData.data)` per frame and pass the series to `measureFlashes(series, { fps })`: it counts pairs of opposing changes of at least 0.1 relative luminance where the darker state is below 0.8, and reports the worst one-second window and `safe`. It measures frame averages, so it misses small-area and saturated-red flashes; treat it as a floor, not a certificate.

`describeAgentOutput(id, values, details)` writes at most 300 characters from the settings the engine actually read (`form-schema` roles), names colours in plain words (`colorName('#102031')` → `dark blue`), quotes titles, leaves seeds out and keeps the template title first. Pass what only the host knows in `details`: `width`, `height`, the drawn title `lines`, `media: 'video'`, `frames`, the 3D `subject` and `camera`, and `reducedMotion`.

## Play a live preview on gallery cards

Every agent has a small animated preview built from the catalog, so a gallery card can show what the agent does before anyone opens it:

```js
import { createPreviewPlayer, renderAgentPreview } from '@optimai/creative-agents/card-preview';

const player = createPreviewPlayer(canvas, 'transition-lab', { motion }); // draws the poster frame now
card.addEventListener('pointerenter', () => player.play());              // false, and still the poster, under reduced motion
card.addEventListener('pointerleave', () => player.pause());             // back to the poster
card.addEventListener('focusin', () => player.play());
card.addEventListener('focusout', () => player.pause());

renderAgentPreview('poster-lab', offscreenCtx, 1200, { width: 240, height: 135 }); // one frame, anywhere
```

`renderAgentPreview(agent, ctx, t, { width, height, reducedMotion })` draws in a 480×270 space scaled to your size. A frame depends only on the agent and `t`: the loop repeats every `PREVIEW_LOOP_MS` (4.8 s), `t = 0` is a composed poster frame, and `reducedMotion` always draws it. Previews use shapes and gradients only, with no text, fonts or images, so they look the same in every browser, worker and test. Every shape keeps its colour for the whole loop and only geometry moves (a few layers fade in slowly), so nothing flashes.

`getAgentPreview(agent)` names the motif (`grade` wipes a finished look across a picture, `iris` opens a transition, `bars` is Sound Canvas, `strip` is a guided workflow's filmstrip…) and an OKLab palette from the catalog accent; music, frame, 3D and camera agents get a dark stage. Pass a template-like object (`{ id, accent, workspace: { kind, operation } }`) to preview a community agent from its manifest; unknown IDs get the filmstrip. `createPreviewPlayer` sizes the canvas to its CSS box at up to 2× density, caps playback at 30 frames a second, and stops at once when a `motion` preference (a boolean, `createMotionPreference()` or a `MediaQueryList`) turns on reduced motion.

## Compare two results with a before/after slider

Show what a finish, a new seed or a different run actually changed, side by side on one artboard:

```js
import { compareImages, describeComparison, splitView, stepSplit } from '@optimai/creative-agents/compare';

const result = await compareImages(earlierBlob, latestBlob, { signal });   // Blobs, blob: URLs, bitmaps or ImageData
note.textContent = describeComparison(result);   // "Small changes to 4% of the image · structure 93% kept"
const view = splitView(slider.value / 100);       // the earlier layer sits over the latest one
earlierImage.style.clipPath = view.clipPath;      // "inset(0 50% 0 0)"
divider.style.left = `${view.position * 100}%`;
handle.addEventListener('keydown', event => { const next = stepSplit(position, event.key); if (next !== undefined) setPosition(next); });
```

`compareOutputs(a, b, options)` measures two RGBA buffers (`ImageData` or `{ data, width, height }`) on one grid: `a`'s aspect, no larger than either image, and at most `maxSide` (512 by default) on the long side, so a 4K export costs the same as a thumbnail. Pixels are box-averaged onto the grid and transparent ones are read over mid grey. It returns `changed` (the share of pixels whose largest channel moved more than `threshold`, 8 by default), `meanDelta` and `maxDelta` (0–1), `psnr` in dB (`Infinity` when identical), `ssim` (SSIM-lite: the mean SSIM of half-overlapping 8 × 8 windows on luma; 1 is the same structure), `deltaE` (the mean OKLab distance), `overall` (the same colour shift and structure on a grid of at most 24 pixels, where grain, dither and halftone dots average out), `bounds` (the changed region in `a`'s pixels) and, with `{ diff: true }`, an RGBA heatmap of the change. The same two buffers always give the same numbers, and the metrics are symmetric when the sizes match. Different sizes still compare (`sameSize: false`); `b` is stretched to `a`'s aspect.

`compareImages` is the browser path: it decodes each source once straight onto the comparison grid, reports `width`, `height` and `bounds` in `a`'s full pixels, closes the bitmaps it opened and stops when `signal` aborts. `describeComparison` says *Identical*, *No visible change* (only sub-threshold noise), *Small changes to …*, *Same picture with new grain or texture across …* (pixels differ but the overall look moved less than about one just-noticeable OKLab step, as when only a Print Shop or Glitch Cut seed changed), *Changed …* or *A new look across …*, with the share of the image and how much structure was kept. `splitView(position, width, height, { orientation })` gives the visible before and after rectangles, the divider line and the CSS `clipPath`; `stepSplit` moves a custom handle by 5% per arrow key, 20% per Page key, and to the ends on Home and End. A native range input needs neither.

## Render settings from the form schema

Build settings forms, docs tables and host checks from one schema instead of copying field IDs and choices:

```js
import { getAgentFormSchema, listFormFields } from '@optimai/creative-agents/form-schema';

const schema = getAgentFormSchema('poster-lab');      // JSON Schema 2020-12 for recipe `values`
for (const group of schema['x-ui'].groups) {          // content, look, color, layout, motion (non-empty, in order)
  renderHeading(group.title);
  for (const field of listFormFields(schema).filter(entry => entry.group === group.id)) renderControl(field);
}
```

Each property has the same bounds `validateRecipeValues` enforces (`enum`, `minimum`/`maximum`, `maxLength`, the hex `pattern` for colors), a `title`, a `default` and an `x-ui` object:

| Hint | Values |
| --- | --- |
| `control` | `text`, `textarea`, `select`, `color` (hex settings), `slider`, `stepper` (ranges of 12 or less), `number` (wide ranges such as pixel sizes), `seed` (offer a reroll) |
| `step` | Number controls only; `1` for whole-number settings |
| `group`, `order` | Where the setting goes; `x-ui.order` lists every setting in display order, aliases after the setting they stand in for |
| `role` | `engine` (the on-device workspace reads it), `alias` (an older recipe name used only when `aliasOf` is missing, such as Poster Lab's `format` for `ratio`), `brief` (shapes the prepared brief only), `unused` (reaches neither; only possible for unreviewed templates) |

Alias and brief settings in on-device workspaces carry a `description` that says so, which a builder can show as a hint. `getAgentFormSchema` also accepts a template object, so a host can check a candidate before promoting it: refuse `unused` roles and controls it cannot draw, and run every `engine` choice and endpoint through the engine's normalizer. `plainFormSchema` drops the `x-` hints for strict validators; the [MCP adapter](./mcp.md) builds each tool's `values` schema from it. Schemas are fresh plain JSON on every call and describe saved recipe values only; engine-only settings (for example a canvas title's `ink`) stay outside v1 recipes.

## Keep run records and remix exact settings

Give every result a run record, so a creator can return to it, compare it and remix it with the exact settings that drew it:

```js
import { createRunHistory, createRunRecord, digestInputs } from '@optimai/creative-agents/run-record';
import { canvasLabRecipeValues } from '@optimai/creative-agents/canvas-lab';

const history = createRunHistory({ limit: 8, settleMs: 1500 });
const inputsDigest = await digestInputs(files);            // bytes only, in order; names never count
const record = createRunRecord({ templateId: 'glitch-cut', settings, sdkVersion: '0.5.0', inputsDigest, output: { width, height } });
const { evicted } = history.add(record, URL.createObjectURL(blob));
for (const entry of evicted) URL.revokeObjectURL(entry.attachment);
const { values, extra } = canvasLabRecipeValues(record.templateId, record.settings);   // Remix: v1 recipe values
```

`record.hash` is 16 hex characters over the template, the settings as canonical JSON, the seed (taken from `settings.seed` when present), the SDK version and the input digest, so the same run gets the same hash in every browser and any change gets a new one; `createdAt` and `output` are carried but not hashed. `digestInputs` uses SHA-256 from Web Crypto and falls back to a 64-bit hash (`h64:`) where Web Crypto is missing. `parseRunRecord` reads shared JSON and throws when its contents no longer match its hash; `verifyRunRecord` returns a boolean.

`createRunHistory` keeps runs newest first and never twice: adding a hash it already has moves that run to the front. With `settleMs`, a run made within that time of the previous one replaces it, so a slider drag leaves one entry; `settle()` keeps the newest run (call it on export). Release each `evicted` attachment.

For Remix, `canvasLabRecipeValues` turns canvas engine settings back into the template's v1 recipe values (engine names such as `push` become recipe names such as *camera move*) and returns the engine-only settings that differ from the defaults as `extra`; `runRecipeValues` does the same split for any template without aliases. A run record is not a manifest: keep sharing recipes as manifests, and treat records as provenance next to the result.

## Design around the actual result

Use one clear primary action for each step: choose input, run, review and export. Name the output accurately, for example **Export PNG**, **Write storyboard**, or **Continue in Story Studio**. A still-image transition preview is a PNG, and a prepared video brief is direction for an editor.

Preserve user inputs after a failure and explain the next recovery step. Support labeled controls, keyboard use, visible focus, readable text, reduced motion and small screens. Verify export, retry, cancellation and no-subject flows in a real browser in addition to controlled tests.

Canvas and model runtimes do not need a Studio account. If your application hands off paid production or publishing, display the selected references, destination, preview and applicable cost before that action. Account access, billing, project persistence and publishing belong to the host; an agent's prose cannot authorize them.

## Extend the contract deliberately

| Change | Required work |
| --- | --- |
| Remix a reviewed recipe | Keep a known template ID, approved values and v1 capability fields; validate and share JSON |
| Add a new operation or model | Contribute implementation, declarations, contract changes, tests and documentation; release and integrate reviewed source |
| Add MCP client support | Configure the local [stdio adapter](./mcp.md); authorize prepared direction and explicit writing runs in the client |

Keep stable agent IDs and increment a recipe's `version` when releasing a revision. A breaking manifest format needs a new `schemaVersion` and a deliberate migration. Legacy Tool-named exports and manifests remain aliases of the v1 Agent contract, so saved recipes can reopen.

Unknown template IDs are rejected. JSON import cannot install a new capability; new source requires maintainer review and a host that bundles it. Follow [CONTRIBUTING.md](../CONTRIBUTING.md#new-reviewed-operations) for source changes, including generated schemas, model/dependency licenses and hardware requirements.

The `music/reactive` and `frame/sculpture` adapters are installed with workspace contract 1.2. Contract 1.3 adds the `print` canvas operation (Print Shop); a host that bundles `canvas-lab` runs it through `runCanvasLab` like the other compositions. See [music and motion engines](./MUSIC-MOTION.md) for their host lifecycle and export contracts.
