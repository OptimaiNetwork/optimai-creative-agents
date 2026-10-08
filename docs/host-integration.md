# Manifest and host integration

The agent manifest is plain data. The host application validates it, resolves an implementation that the host already trusts and supplies only the user-selected inputs. A manifest cannot install JavaScript, choose a worker URL, select a remote model service or grant itself Studio permissions.

## Understand the three extension paths

| Path | What a builder supplies | What the host does |
| --- | --- | --- |
| Recipe remix | Known template ID, typed defaults, creative brief and metadata | Validates and dispatches an existing reviewed capability |
| New engine or template | SDK source, declarations, tests and documentation for review | Reviews and bundles a versioned implementation before exposing it |
| MCP client integration | Local stdio adapter configuration | Authorizes each prepared recipe or explicit local writing run |

Importing a recipe is not a plugin installation. Adding an unknown `templateId` does not create a capability. The fixed v1 contract rejects it. New operations require reviewed source changes and host integration; remote MCP installation and a public package registry are outside the current release.

## Validate at every boundary

```js
import {
  getAgentTemplate,
  validateAgentManifest,
  compileAgentPrompt
} from './src/index.mjs';

// Read JSON from an explicit file selection. Bound its size before parsing.
if (file.size > 64_000) throw new Error('Choose a manifest smaller than 64 KB.');
const parsed = JSON.parse(await file.text());
const validated = validateAgentManifest(parsed);
if (!validated.success) throw new Error(validated.errors.join('\n'));

const manifest = validated.manifest;
const template = getAgentTemplate(manifest.recipe.templateId);
if (!template) throw new Error('This template is not installed in this host.');
const preparedPrompt = compileAgentPrompt(manifest);
```

Use the detached `validated.manifest` result rather than continuing to read the source object. Validate again after editing settings and before dispatch. Treat title, description, brief, prompt and model output as plain untrusted text. Render with text nodes or your framework's escaped text rendering, never raw HTML or executable templates.

The static schema is [agent-manifest.schema.json](../schema/agent-manifest.schema.json), JSON Schema 2020-12. The runtime validator additionally checks plain-data structure and rejects accessors, hidden keys, prototype-shaped data, circular objects and excessive nesting in direct JavaScript calls. Unknown fields are rejected rather than silently ignored.

The recipe's `network: "none"` describes its privileges. A trusted host can separately download fixed public model assets after an explicit user action or run inference on a validated literal-loopback endpoint. That does not allow a recipe to request arbitrary network access.

## Resolve the real runtime

Use an explicit reviewed map, not a title, category or model-generated instruction, to dispatch operations. The catalog's v1 `executionKind` and `runtime` are legacy hints and do not describe every later canvas and vision addition.

```js
import { CANVAS_LAB_AGENTS } from './src/canvas-lab.mjs';
import { getAgentTemplate } from './src/index.mjs';

const vision = Object.freeze({
  'select-and-replace': 'person-cutout',
  'motion-pose': 'pose-reference',
  'face-performance': 'face-reference'
});

function capabilityFor(templateId) {
  const template = getAgentTemplate(templateId);
  if (!template) throw new Error('Unknown reviewed template.');
  if (Object.hasOwn(CANVAS_LAB_AGENTS, templateId)) {
    return { kind: 'canvas-lab', operation: CANVAS_LAB_AGENTS[templateId] };
  }
  if (Object.hasOwn(vision, templateId)) {
    return { kind: 'vision', operation: vision[templateId] };
  }
  if (template.executionKind === 'local-model') return { kind: 'writing' };
  if (template.executionKind === 'browser') {
    return { kind: 'image', operation: template.localOperation };
  }
  return { kind: 'studio-guided', destination: template.studioMode };
}
```

This resolver distinguishes the package's four original image processors, additional canvas engines, three vision engines, five writers and guided workflows. Mockup Maker supports both the original resize operation and the added device composition; choose that workspace intentionally. A prepared production brief is not an executed renderer, tracker or video codec.

Dispatch also needs a reviewed settings adapter. Catalog recipe fields and direct engine settings are not always identical: Poster Lab's recipe has `format` and `style`, while the canvas operation expects settings such as `ratio` and `treatment`. Do not blindly forward a manifest's values into an unrelated engine. Map the supported fields explicitly, apply the operation's validator and let the workspace expose any additional trusted controls.

## Run the reviewed engines

| Result needed | SDK entry | Host responsibilities |
| --- | --- | --- |
| Filter, resize, contact sheet or title on a still image | `browser-runtime` → `runLocalTool` | Supply selected `File` objects and reviewed settings; show the returned PNG |
| Mockup, bento, blend, transition preview, glitch, poster or letter artboard | `canvas-lab` → `runCanvasLab` | Map the template to the reviewed operation; describe still-image output accurately |
| Person cutout, pose or face landmarks | `vision-runtime` → `downloadVisionModel`, `runBrowserVision` | Explicit download, pinned dependency, same-origin reviewed worker and WASM assets |
| Written treatment, cast notes, style brief, storyboard or prompt branches | `browser-writing-runtime` or `agent-runtime` | Explicit local model choice/download, progress, cancellation and review of the validated document |
| Production in Image, Video, Story, Character or Editor Studio | `compileAgentPrompt` plus a trusted host handoff | Preview direction, selected references, destination and separate spending controls |

See the [main README](../README.md) for executable API examples, operation settings, file and pixel limits, browser requirements and model versions. Keep `AbortSignal` wired through every asynchronous operation. Release workers, decoded images, canvases, GPU sessions and temporary object URLs when a job stops or its preview is replaced. The SDK returns owned results; object URLs created by your application remain your responsibility to revoke.

Browser engines do not need a Studio account. Paid Studio generation, account access, project persistence, domains and publishing belong to the host, outside this kit. Do not infer approval to spend credits or publish from an agent's prose.

## Design the workspace around the result

Use a clear input → run → preview → export sequence. Keep one primary action for the current step and name the actual output, such as **Export PNG**, **Create storyboard** or **Continue in Story Studio**.

Show model size and local storage requirements before a download. Keep downloads optional and let people browse other agents while preparation runs. During inference, expose meaningful progress and a Stop action. Preserve the input after a failure and explain the recovery action without substituting fabricated output. A no-person result from a pose model should say that a suitable person was not detected.

Support keyboard operation, visible focus, labeled inputs, readable text, reduced motion and narrow screens. Avoid relying on a hover tooltip or color alone to explain a required step. Verify export, cancellation, retry and no-subject flows on real browser devices, in addition to controlled unit tests.

## Evolve without breaking saved recipes

Keep stable agent IDs and increment the manifest version for a new recipe revision. A breaking format needs a new `schemaVersion` and a deliberate migration. Legacy Tool-named APIs and manifests remain aliases of the v1 Agent contract; renaming the product does not require rewriting saved recipes.

For a new reviewed operation, update the implementation, matching TypeScript declarations, catalog metadata, generated schema and meaningful tests together. Document the real capability, constraints, model/dependency licenses and hardware requirements. See [CONTRIBUTING.md](../CONTRIBUTING.md#new-reviewed-operations) for the source contribution checklist.
