# Contributing to OptimAI Creative Agents

Thank you for helping make creative tools easier to build and reuse. Contributions can improve a recipe, a reviewed SDK operation, documentation, examples or tests. Keep each pull request focused on a concrete result that another builder can reproduce.

This repository contains the public Creative Agents kit. Contributions must stand on their own without proprietary Studio source, accounts or services. A merged source change does not automatically install an agent in Studio, publish to npm or grant a community catalog listing.

## Get started

Fork [OptimaiNetwork/optimai-creative-agents](https://github.com/OptimaiNetwork/optimai-creative-agents), then work in your standalone checkout. Replace `YOUR_USERNAME` with your GitHub username:

```sh
git clone https://github.com/YOUR_USERNAME/optimai-creative-agents.git
cd optimai-creative-agents
git switch -c improve-story-recipe
node --version
npm test
npm run verify
```

Use Node.js 20 or newer. CI runs the package checks on Node.js 20, 22 and 24. The core and tests are dependency-free ESM: `npm install` is not needed. Browser hosts install the reviewed optional peers only when integrating their respective engines.

The tests use controlled browser fixtures and local model responses. CLI and MCP integration tests start a temporary HTTP listener on `127.0.0.1`; run them in an environment that permits loopback connections. They do not require Ollama, a GPU, model weights or an API key. Passing these tests is evidence of SDK behavior, not of model quality or compatibility with every browser or device.

Search existing issues before opening one. For a substantial new operation or contract change, describe the intended input, output, implementation and limits in a proposal so maintainers can discuss the scope before you invest in it. Report vulnerabilities through [SECURITY.md](./SECURITY.md).

## Track 1: recipes and examples

A recipe customizes a reviewed template through JSON. It can change its identity, description, brief and permitted settings; it cannot install new code or grant new privileges.

1. Inspect the catalog with `npm run verify`, then scaffold a new lowercase ID:

   ```sh
   npm run create -- cloud-companion --template story-seed
   ```

2. Edit `agents/cloud-companion/agent.json`. Keep the template's category and fixed capabilities. Use only settings declared by that template. See the [first-agent guide](./docs/quickstart.md) for a complete example.
3. Validate the recipe:

   ```sh
   node scripts/verify.mjs agents/cloud-companion/agent.json
   ```

4. Try realistic inputs in a compatible host or, for writing, with a deliberately selected local model. Explain the output, requirements, limitations and any remaining production step. Use original or appropriately licensed example material.
5. For a reusable example contribution, copy the manifest into `examples/cloud-companion.agent.json`, validate that file, and include reproducible input and expected-behavior notes in the pull request. Include only the files relevant to the contribution.

Do not include credentials, private prompts, user media, executable JavaScript, HTML, remote code URLs or packages in a recipe. Put author notes and other review metadata in documentation rather than adding unsupported manifest properties. Keep examples small and suitable for a public repository; the recipe's MIT license does not relicense its input media.

Label capabilities accurately. A guided brief is not a renderer, and a still-image composition is not video generation. Describe remaining generation, editing or export steps. Do not imply affiliation with a reference product or promise catalog placement, featuring or rewards.

## New reviewed operations

This second contribution track covers SDK and runtime source changes. These introduce behavior that every consuming host must review. Keep core APIs dependency-free ESM and update their matching TypeScript declarations. New JavaScript is shipped through reviewed source changes and a versioned SDK release; it cannot be uploaded through a recipe.

For a catalog or contract change:

- Use a unique slug, original title and description, category, runtime, destination, bounded settings, complete prompt template and relevant tags. Every placeholder must correspond to a declared field.
- Update both checked-in manifest schemas when their generated contracts change. Preserve the saved v1 Tool aliases and strict validation. Breaking contract changes need an explicit schema-version decision; do not silently accept extra permissions or properties.
- Add meaningful coverage for defaults, malformed and oversized inputs, declared settings and privilege boundaries. Include an original self-contained `480 × 270` SVG thumbnail for a new catalog template.

Regenerate both schemas from the reviewed source contract when necessary:

```sh
node --input-type=module <<'JS'
import { writeFile } from 'node:fs/promises';
import { AGENT_MANIFEST_SCHEMA, TOOL_MANIFEST_SCHEMA } from './src/index.mjs';
await writeFile('schema/agent-manifest.schema.json', JSON.stringify(AGENT_MANIFEST_SCHEMA, null, 2) + '\n');
await writeFile('schema/tool-manifest.schema.json', JSON.stringify(TOOL_MANIFEST_SCHEMA, null, 2) + '\n');
JS
```

For an engine change, cover the behavior specific to that engine:

| Engine | Review and validation expectations |
| --- | --- |
| Browser canvas | Reviewed operation in `browser-runtime.mjs` or `canvas-lab.mjs`, matching declarations, selected-file validation, file/pixel/resource limits, cancellation and cleanup |
| Browser vision | Fixed model metadata, byte length and SHA-256 validation, reviewed locally bundled worker, bounded processing, no-subject errors and cleanup |
| Writing | Task-specific output contract, required headings and section counts, content validation, bounded repair, cancellation and timeouts; browser writing reuses the shared task contract |
| CLI or MCP | Validated inputs, explicit installed-model selection for execution, bounded responses, loopback-only inference and useful errors |

The v1 catalog's `executionKind` is a legacy dispatch hint. Hosts resolve additional reviewed canvas and vision capabilities by ID; changing a catalog label alone does not implement an engine. See [host integration](./docs/host-integration.md) for the consumer's responsibilities.

Model downloads must remain explicit host actions. Recipes cannot choose executable, worker or model URLs. The reviewed optional browser peers are WebLLM `0.2.85` and MediaPipe Tasks Vision `1.1.0`; dependency or model changes require their own review and license notices. Never silently fall back to a cloud model or install an Ollama model. Arbitrary network, filesystem, account and background access are outside the v1 recipe contract.

Use focused tests for a changed behavior, then run the full checks before requesting review:

```sh
npm test
npm run verify
for manifest in examples/*.agent.json; do
  node scripts/verify.mjs "$manifest"
done
```

For changes to model execution, also record a real-device check when possible: browser and OS, model/runtime version, input, observed output, failure/cancellation behavior and relevant timing. Node fixtures cannot establish WebGPU compatibility or creative quality. If you cannot perform that check, say so in the pull request.

With an eligible model already installed and your own Ollama service running, this optional check exercises all five writing contracts with public test briefs:

```sh
npm run smoke -- --model installed-model
```

Replace `installed-model` with its actual installed name. The host-only `OPTIMAI_OLLAMA_URL` can select a literal loopback HTTP endpoint; never place endpoints, model installation instructions, tokens or credentials in a manifest.

## Submit a pull request

Open a pull request against `main` from your fork. Explain the problem, resulting behavior and how you verified it. Link a related issue when one exists. For a recipe, identify its reviewed template and provide a reproducible example. For runtime work, describe the limits and any compatibility or model changes.

Include tests that demonstrate changed behavior when needed, matching declarations, updated schemas and documentation. Check the diff for generated output, private material and unrelated changes. Source collaboration happens through issues and pull requests; Studio publishing and any future catalog review use separate processes.

Maintainers review functionality, contracts, licensing and integration impact. They may request changes or decline proposals that do not fit the supported SDK. There is no guaranteed review time. A focused patch and clear validation notes make review easier.

## License and community

Submit only code, text and artwork you have the right to contribute under the repository's [MIT license](./LICENSE). Retain required third-party notices. This license covers the kit's own material, not third-party models, selected assets, brands or the proprietary OptimAI application.

Be respectful in reviews and discussions. Follow the [Code of Conduct](./CODE_OF_CONDUCT.md) and keep feedback specific to the work.
