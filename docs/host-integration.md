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

Use the source catalog's versioned `workspace` descriptor to select an adapter your application already bundles. `getAgentWorkspace(id)` returns its `kind`, reviewed `operation` and optional presentation `headline`; `AGENT_WORKSPACE_CONTRACT_VERSION` is `1.2`; the v1 recipe schema remains unchanged. Template titles, descriptions, fields and artwork remain public presentation data. Legacy `executionKind` and `runtime` exports are retained for older consumers.

### Input policy

`getAgentInputPolicy(id)` tells a host what to ask for before it opens a workspace. It is derived from the same `workspace` descriptor, so it needs no contract bump and no recipe change:

```js
import { getAgentInputPolicy } from '@optimai/creative-agents';

const { minFiles, maxFiles, accept, maxBytes, needs, optional, onDevice } = getAgentInputPolicy('reference-blend');
// { minFiles: 2, maxFiles: 2, accept: 'image/png,image/jpeg,image/webp', maxBytes: 20971520,
//   needs: ['canvas'], optional: [], onDevice: true }
```

Use `accept` for the file input, `maxFiles > 1` for `multiple`, and `minFiles` for empty-state copy. `needs` lists browser features from `AGENT_INPUT_NEEDS` that the agent cannot run without (`webgl` for 3D and Frame Sculpture, `web-audio` for Sound Canvas, `worker` and `wasm` for vision). `optional` lists features that only enhance it: a camera, face tracking or `media-recorder` export for camera agents, and `webgpu` for writing, which can also use a local Ollama runtime. `onDevice` is `false` only for guided and sketch templates, whose result comes from a host production step. The engines stay the authority: they re-check counts, types and bytes on every run, so a policy is for interface decisions, not validation.

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
| Additional composition | `canvas-lab` → `canvasLabRecipeSettings`, `runCanvasLab` | PNG; normalize defaults, canonical settings and saved v1 aliases |
| Browser vision | `vision-runtime` → `downloadVisionModel`, `runBrowserVision` | PNG and analysis; selected-agent setup policy, reviewed local worker and WASM assets |
| Browser writing | `browser-writing-runtime` → `createBrowserAgentRuntime` | Validated written artifact; selected-agent setup policy, supported WebGPU device and local worker |
| 3D scene | `scene-3d` → `scene3DRecipeSettings`; `scene-3d-runtime` → `createScene3DStage` | Procedural/local GLB WebGL stage, PNG and scene recipe; optional reviewed Three peer |
| Camera effects/avatar | `camera-runtime`, `camera-renderer`, `camera-tracking`, `camera-worker`, `landmark-filter` | Canvas effects and original face-driven avatar; explicit permission and local verified tracking worker |
| Music visuals | `music-reactive`, `beat-tracker` | Measured spectrum looks with an optional flash-limited beat pulse; the host owns the audio graph, playback and recording |
| Model preparation | `model-setup` → `getModelSetupPolicy`, `createModelSetupController`, `describeModelSetup`, `formatBytes` | Automatic/manual/unsupported decision, one abortable setup state machine with byte progress, and readable sizes; host supplies the reviewed load and check calls |
| Local Ollama writing | `agent-runtime` → `runCreativeAgent` | Validated written artifact; explicitly selected eligible installed model and loopback service |
| Guided production | `compileAgentPrompt` and a host handoff | Prepared direction; the destination host runs Image, Video, Story, Character or Editor production |

Vision workspace descriptors identify `person-cutout`, `pose-reference` or `face-reference`. `CANVAS_LAB_AGENTS` derives its composition map from the same catalog. Writing descriptors use the five implemented output-contract IDs; declaring an unknown writer does not implement its output validation. Sketch descriptors identify a browser drawing workspace followed by a separate Studio production step.

Recipe fields and direct engine settings can differ. Use `canvasLabRecipeSettings(templateId, manifest.recipe.values)` for compositions: it merges template defaults, preserves legacy `format`, `text`, `style` and `intensity` aliases, and gives explicit canonical settings priority. Pass the resulting settings to `runCanvasLab(settings.operation, files, settings, signal)`. The engine validates its bounded settings again. Mockup Maker keeps its original image-resize recipe fields for compatibility, while its default workspace now selects device composition. See [runtime APIs and limits](./runtimes.md) for exact options and requirements.

## Normalize portable interactive recipes

`3d:scene`, `camera:effects` and `camera:avatar` (workspace contract 1.1), and `music:reactive` and `frame:sculpture` (contract 1.2) are source-reviewed bindings. Keep these operations on the host allowlist; an untrusted recipe cannot add another binding. Studio consumes the same public engine modules through thin adapters. Its dialog layout, account state, asset picker, credits and production services remain private host code.

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

The `music/reactive` and `frame/sculpture` adapters are installed with workspace contract 1.2. See [music and motion engines](./MUSIC-MOTION.md) for their host lifecycle and export contracts.
