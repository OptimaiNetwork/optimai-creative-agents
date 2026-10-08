# Create your first recipe

This guide creates **Cloud Companion**, a manga-planning recipe based on the reviewed **Story Seed** template. You will scaffold it, customize its settings, validate it and prepare a prompt locally. Those steps need no account, API key, model or dependency installation. Optional writing inference produces a written treatment; rendering a manga remains a separate production step.

## 1. Clone the public repository

Install Node.js 20 or newer and Git, then run:

```sh
git clone https://github.com/OptimaiNetwork/optimai-creative-agents.git
cd optimai-creative-agents
node --version
npm run verify
```

Verification should begin with `Validated 34 reviewed agent templates.` and list each template's actual capability. These commands run from the repository root throughout this guide. You do not need the Studio source repository. The package is not currently published to npm; `npm install @optimai/creative-agents` is not the onboarding path.

## 2. Scaffold Cloud Companion

```sh
npm run create -- cloud-companion --template story-seed
```

The command creates `agents/cloud-companion/agent.json` and `agents/cloud-companion/README.md`. It refuses to overwrite an existing directory. On a repeat run, choose a fresh lowercase slug and use that ID and path throughout the guide. Omitting `--template` selects `story-seed` by default.

Replace the contents of `agents/cloud-companion/agent.json` with:

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

`templateId` selects an existing implementation. `values` overrides its declared defaults, and `brief` supplies creative direction. Change the title, description and brief to make your own recipe. Keep the category consistent with the template and the v1 capability values as shown.

To discover supported settings before editing:

```sh
node --input-type=module -e 'import { getAgentTemplate } from "./src/index.mjs"; console.log(JSON.stringify(getAgentTemplate("story-seed").fields, null, 2));'
```

The [manifest schema](../schema/agent-manifest.schema.json) is useful for editor validation. The runtime validator also checks the selected template's fields. Unknown settings, unsupported select values and extra properties are errors. Author/contact details and repository links belong in the README; executable scripts, model endpoints and credentials do not belong in the manifest.

## 3. Validate and prepare the prompt

```sh
node scripts/verify.mjs agents/cloud-companion/agent.json
```

Expected output: `Validated cloud-companion (story-seed).`

Run this complete command to read your recipe and print its prepared prompt:

```sh
node --input-type=module <<'JS'
import { readFile } from 'node:fs/promises';
import { validateAgentManifest, compileAgentPrompt } from './src/index.mjs';

const source = JSON.parse(await readFile('agents/cloud-companion/agent.json', 'utf8'));
const result = validateAgentManifest(source);
if (!result.success) throw new Error(result.errors.join('\n'));
console.log(compileAgentPrompt(result.manifest));
JS
```

The output names **Story Seed**, includes manga direction, the audience and your cloud-adventure brief, and describes the eventual Story Studio handoff. It prepares text; it does not invoke a model or generate artwork. You have now completed a working recipe authoring flow.

Check the package before contributing changes:

```sh
npm test
npm run verify
```

The tests use controlled fixtures and a local mock provider; they need no paid service or downloaded model. CLI and MCP integration tests start a temporary loopback listener, so a restricted sandbox must permit that listener. Manifest validation checks your recipe's contract; package tests check SDK behavior. Review actual creative output separately when you run a writer.

## 4. Use the recipe

**In your own host:** validate the JSON, choose the reviewed runtime and supply only selected inputs. [Host integration](./host-integration.md) covers this boundary; the [runtime guide](./runtimes.md) covers execution. For a first browser integration without AI downloads, try the [browser example](../examples/browser/):

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

From the repository root, this serves the example at [http://127.0.0.1:8080/examples/browser/](http://127.0.0.1:8080/examples/browser/). Python 3 is needed only for this optional static server. Open the page in a browser, use the sample artwork or choose your own image, then preview and export a PNG. The example demonstrates the canvas SDK; Story Seed uses a writing runtime instead.

**In OptimAI Studio:** open **AI Agents → Saved → Import agent**, select `agents/cloud-companion/agent.json`, then open Cloud Companion. Choose a supported browser writing model or an eligible installed local Ollama model through the workspace controls and review the written result. Continue to Story Studio as a separate action when you want production. The recipe JSON alone does not download a model or authorize spending.

Saved recipes stay in this browser and account scope. Use **Export agent manifest** to keep a portable copy before clearing browser storage or moving devices. Importing or exporting does not publish a community listing.

**From the CLI, optionally:** start your own Ollama service and install a supported model outside this kit. Replace `installed-model` with its exact installed name:

```sh
node scripts/run.mjs --manifest agents/cloud-companion/agent.json --model installed-model
```

The default endpoint is `http://127.0.0.1:11434`. The SDK checks installed model metadata, requests a structured document and validates its output, with one bounded repair attempt. It prints the written artifact as JSON; Ctrl+C cancels the request. It never installs a model or falls back to a cloud provider. See the [runtime guide](./runtimes.md) for eligibility, limits and host configuration.

## 5. Share or contribute

You can share `agent.json` with anyone using a compatible host. Add reproducible input and expected-behavior notes to the generated README so another builder can assess the result. For an upstream change, fork the [public repository](https://github.com/OptimaiNetwork/optimai-creative-agents), work on a branch, run the checks and open a pull request against `main` following [CONTRIBUTING.md](../CONTRIBUTING.md).

A recipe contribution reuses an existing runtime. A new renderer, model or operation requires reviewed SDK source and a host integration; a new JSON field or template ID cannot install it. Public catalog acceptance and editorial featuring are separate processes that have not launched. See [release and review](./release-and-feature.md).
