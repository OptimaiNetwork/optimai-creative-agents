# Integrate agents into your application

A host reads a recipe, validates it, resolves a reviewed implementation and supplies the user's selected inputs. The SDK works independently of OptimAI Studio. Start with the [browser example](../examples/browser/) for a complete canvas input → preview → export flow, then use the [runtime guide](./runtimes.md) for optional writing and vision engines.

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

Choose operations by an explicit implementation map. Category, title and generated prose are display data. The catalog's legacy `executionKind` and `runtime` hints do not identify every added canvas and vision capability, so they are insufficient as a universal dispatcher.

For example, this host deliberately exposes the four original still-image processors:

```js
import { getAgentTemplate, validateAgentManifest } from './src/index.mjs';
import { runLocalTool } from './src/browser-runtime.mjs';

const IMAGE_OPERATIONS = Object.freeze({
  'image-finish': 'image-filter',
  'mockup-maker': 'image-resize',
  'image-grid': 'image-grid',
  'title-frame': 'type-overlay'
});

export async function runImageRecipe(candidate, files, signal) {
  const checked = validateAgentManifest(candidate);
  if (!checked.success) throw new Error(checked.errors.join('\n'));
  const manifest = checked.manifest;
  const templateId = manifest.recipe.templateId;
  if (!Object.hasOwn(IMAGE_OPERATIONS, templateId)) {
    throw new Error('This host does not run this recipe. Choose an installed image tool.');
  }
  const template = getAgentTemplate(templateId);
  const values = Object.fromEntries(template.fields.map(field => [field.id, field.default]));
  Object.assign(values, manifest.recipe.values);
  return runLocalTool(IMAGE_OPERATIONS[templateId], files, values, signal);
}
```

Supply selected browser `File` objects, pass an `AbortSignal` from your Stop control and show the returned `{ blob, width, height, filename }` as a PNG preview. The engine validates actual image signatures, dimensions and resource limits. No recipe can supply a media URL or cause this processor to fetch it. Revoke object URLs your application creates when a preview is replaced or removed.

A broader host can add these reviewed runtime adapters:

| Capability | SDK entry and dispatch | Output and host requirements |
| --- | --- | --- |
| Original image processing | `browser-runtime` → `runLocalTool` | PNG; selected PNG/JPEG/WebP files and bounded settings |
| Additional composition | `canvas-lab` → `CANVAS_LAB_AGENTS`, `runCanvasLab` | PNG; map recipe settings to the operation's settings explicitly |
| Browser vision | `vision-runtime` → `downloadVisionModel`, `runBrowserVision` | PNG and analysis; explicit model download, reviewed local worker and WASM assets |
| Browser writing | `browser-writing-runtime` → `createBrowserAgentRuntime` | Validated written artifact; explicit download, supported WebGPU device and local worker |
| Local Ollama writing | `agent-runtime` → `runCreativeAgent` | Validated written artifact; explicitly selected eligible installed model and loopback service |
| Guided production | `compileAgentPrompt` and a host handoff | Prepared direction; the destination host runs Image, Video, Story, Character or Editor production |

The vision template map is `select-and-replace` → `person-cutout`, `motion-pose` → `pose-reference`, and `face-performance` → `face-reference`. `CANVAS_LAB_AGENTS` declares the additional composition map. Mockup Maker supports both original resizing and added device composition; expose the workspace you intend to support.

Recipe fields and direct engine settings can differ. Poster Lab's recipe uses `format` and `style`, while its canvas engine uses `ratio` and `treatment`. A host must map supported fields explicitly and validate the resulting engine settings; forwarding recipe values blindly can ignore the builder's intent. See [runtime APIs and limits](./runtimes.md) for the exact options, dependencies and browser requirements.

## Keep model setup explicit

`network: "none"` and `execution: "declarative"` describe the recipe's privileges. A trusted host can separately download fixed public model assets after a user action or run inference against a validated literal-loopback service. Model configuration stays in host code or host environment settings; it is never read from a recipe.

Before a download, show its size, device requirements and browser storage behavior. Keep downloads optional and allow users to browse other tools while preparation runs. Run writing jobs sequentially, expose progress and cancellation, and display model failures without substituting canned creative output. Vision work should report a missing subject when detection fails.

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
