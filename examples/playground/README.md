# Agent Playground

Every canvas and vision agent in the catalog, each with a settings form built from its [form schema](../../docs/host-integration.md#render-settings-from-the-form-schema). Pick an agent, use your own images or the samples, change settings and run it. Nothing is installed and nothing is uploaded: the canvas agents run on this page, and the vision agents run a pinned on-device model.

## Run it

From the repository root, with Python 3 installed:

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

Open **http://127.0.0.1:8080/examples/playground/**. ES modules need an HTTP origin, so `file://` won't work. Stop the server with Ctrl+C.

1. Choose **Poster Lab** and click **Run agent**. A poster appears without any image.
2. Choose **Transition Lab**, click **Use sample images** (the SDK draws two samples itself), and run it.
3. Change **Mix** and run again. **Compare with the previous run** puts the last result over the new one, with a line such as *Small changes to 12% of the image*.
4. Click **Copy share link**. The link holds the agent and the settings you changed, never your images. Opening it restores the form; settings that don't fit the agent are named and left at their defaults.

**Vision agents** (Select and Replace, Motion Pose, Face Performance) need the pinned MediaPipe files the [interactive example](../interactive/README.md#serve-reviewed-dependencies-locally) copies into `examples/interactive/vendor/`. The model itself downloads only when you click **Download model**, from the official model host, and is checked against its pinned size and SHA-256 before it is used.

## What each part uses

| Part | SDK call |
| --- | --- |
| Agent list and runners | `listPlaygroundAgents()` |
| Thumbnails and header animation | `renderAgentPreview`, `createPreviewPlayer` (holds still with reduced motion) |
| Settings form | `getAgentFormSchema`, `listFormFields`, `formDefaults`, `readFormValue`, `colorInputValue`, `rerollSeed` |
| Run | `playgroundRunPlan` → `runCanvasLab`, `runLocalTool` or `runBrowserVision` |
| Progress and Stop | `normalizeProgress`, `describeProgress`, an `AbortController` |
| Device note | `detectCreativeCapabilities`, `assessAgentCapabilities` |
| Result alt text | `describeAgentOutput` |
| Compare | `compareImages`, `describeComparison`, `splitView` |
| Share link | `encodePlaygroundState`, `decodePlaygroundState` |

Writing, 3D, camera, music and frame agents have their own workspaces. See the [browser example](../browser/README.md), the [interactive example](../interactive/README.md) and the [runtime guide](../../docs/runtimes.md).

## Make it your own

- [index.html](./index.html) is the page shell and its accessible controls.
- [app.mjs](./app.mjs) builds every form from the schema and dispatches runs.
- [vision-worker.mjs](./vision-worker.mjs) is the module worker that runs vision models.
- [styles.css](./styles.css) gives a responsive layout in light and dark.

In a bundled app, import the same functions from `@optimai/creative-agents/playground` and the other subpaths. All example files are [MIT licensed](../../LICENSE); the page loads no CDN, font or analytics.
