# Build your first agent

This guide creates a reusable manga-planning recipe based on **Story Seed**. It customizes a reviewed writing agent; it does not install a new model or implement a manga renderer. The recipe produces a written treatment when run with writing AI, and it can prepare direction for a separate Story Studio build.

## 1. Open an isolated copy of the kit

Download the builder kit from OptimAI Studio's AI Agents page and extract it. In its standalone directory:

```sh
cd optimai-creative-agents
node --version
npm run verify
```

Node.js 20 or newer is required. No dependency installation, account or API key is needed to scaffold and validate recipes. The package is prepared locally for release; do not assume it is already installable from npm or a public GitHub URL.

In the private Studio workspace, the same directory is `packages/optimai-agents/`. Copy only that isolated kit for a source release; do not publish the parent repository or its Git history.

## 2. Scaffold a recipe

```sh
npm run create -- cloud-companion --template story-seed
```

This creates `agents/cloud-companion/agent.json` and a README. The command refuses to overwrite an existing agent. Use a new lowercase slug if you have already run it.

Replace the generated JSON with this complete valid manifest:

```json
{
  "schemaVersion": "1.0",
  "id": "cloud-companion",
  "version": "1.0.0",
  "title": "Cloud Companion",
  "description": "Plan a gentle manga adventure about finding courage with a friend.",
  "category": "writing",
  "license": "MIT",
  "capabilities": {
    "network": "none",
    "execution": "declarative",
    "dataAccess": "selected-inputs"
  },
  "recipe": {
    "templateId": "story-seed",
    "values": {
      "form": "manga",
      "style": "manga",
      "audience": "all ages"
    },
    "brief": "A young explorer helps a lost cloud find its way home. Preserve the manga art direction, give the pair a clear shared goal, and end with a small act of courage."
  }
}
```

The template ID determines the settings you may supply. Inspect `getAgentTemplate('story-seed').fields` or the manifest schema for the allowed fields and select values. Do not add a `script`, `url`, model endpoint, API key or arbitrary custom property; validation rejects them.

## 3. Validate before importing

```sh
node scripts/verify.mjs agents/cloud-companion/agent.json
npm test
npm run verify
```

The first command should print `Validated cloud-companion (story-seed).` The test suite uses controlled fixtures and a local mock provider, not a paid service or a downloaded model. CLI and MCP integration tests need permission to start a temporary loopback listener.

Keep the distinction between these checks clear: manifest validation checks your recipe; the package tests check SDK behavior. Neither assesses your story's creative quality. Try a realistic short brief, a long brief, an empty optional brief and invalid settings, then review the generated result yourself.

## 4. Import into OptimAI Studio

1. Open **AI Agents → Saved → Import agent**.
2. Choose `agents/cloud-companion/agent.json`.
3. Open **Cloud Companion**, inspect its settings and try a short creative brief.
4. For writing AI, explicitly load the browser model or select an already installed local Ollama model from the workspace's supported controls.
5. Review the written artifact before continuing to Story Studio. Generation and any credit confirmation remain a separate Studio action.

The **Saved** library is stored in this browser and account scope. It is not a server-published project or a community listing. Export a copy before clearing browser storage or moving to another device. Use the agent workspace's **Export agent manifest** action to download the JSON.

The optional compact browser writer requires WebGPU and an explicit first download of approximately 453 MB. Model files are kept in the browser's site storage for reuse; the recipe is not a model download. Some devices will need a different supported route. See [browser writing requirements](../README.md#browser-writing-with-an-explicit-model-download).

## 5. Run writing locally from the CLI, if needed

This is optional. First start your own Ollama service and install an eligible model outside this kit. Substitute its installed name for `installed-model`:

```sh
node scripts/run.mjs --manifest agents/cloud-companion/agent.json --model installed-model
```

The default endpoint is `http://127.0.0.1:11434`. The SDK checks the installed model metadata and validates the generated document, with one bounded repair for malformed output. It does not install a model or fall back to a cloud provider. Ctrl+C cancels the request.

For a preparation-only check that needs no model:

```js
import { readFile } from 'node:fs/promises';
import { validateAgentManifest, compileAgentPrompt } from './src/index.mjs';

const source = JSON.parse(await readFile('agents/cloud-companion/agent.json', 'utf8'));
const result = validateAgentManifest(source);
if (!result.success) throw new Error(result.errors.join('\n'));
console.log(compileAgentPrompt(result.manifest));
```

## Next steps

Read [host integration](./host-integration.md) to embed the runtime in an application, or [release and featuring](./release-and-feature.md) to prepare a portable source release and a future catalog review package.
