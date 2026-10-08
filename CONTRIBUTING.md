# Contributing to OptimAI Creative Agents

## Recipe contributions

1. Work in an isolated copy of this kit, not the proprietary Studio repository.
2. Scaffold a lowercase agent ID: `npm run create -- my-agent --template story-seed`.
3. Customize the title, description, creative brief and approved settings. The template ID determines the permitted operations and input types.
4. Run `node scripts/verify.mjs agents/my-agent/agent.json`, then `npm test`.
5. Import the manifest into the local AI Agents builder, try realistic inputs and narrow-screen layouts, and verify that every claimed feature actually works.
6. Prepare a review with the recipe JSON, description, license, test cases and before/after examples made from media you own. Importing is private; a catalog listing requires review. The public submission repository and release policy have not been launched yet.

Do not include credentials, private prompts, user media, executable JavaScript, HTML, remote code URLs or packages. Do not claim affiliation with a reference product. Label assisted workflows as assisted workflows and disclose any remaining generation or export step.

## New reviewed operations

A new agent template must have a unique slug, category, original title and description, runtime, approved destination, bounded settings, a complete prompt template and tags. Every placeholder must map to a declared field. Local operations must use an explicit allowlisted implementation. Prefer operations that accept selected media and return a preview before export. Arbitrary network access, filesystem access, account access and background execution are outside the v1 recipe contract; user-selected loopback model inference is handled by the trusted SDK.

Changing `src/catalog.mjs` changes the reviewed contract. Update the generated schema and add tests for the new agent template, defaults, malformed values, oversized input and privilege boundaries. Breaking contract changes require a new `schemaVersion`; do not silently relax validation. Keep core APIs dependency-free ESM, with matching TypeScript declarations. Browser engines use the exact reviewed optional peers: WebLLM 0.2.85 and MediaPipe Tasks Vision 1.1.0. Model download is always an explicit host action; manifests cannot choose model or executable URLs. Test invalid output, cancellation, timeout, stale workers, model integrity and local-only processing. Never silently fall back to a cloud model or install an Ollama model. No proprietary imports or service assumptions belong in this package.

An implementation contribution requires more than a catalog card. For a new browser processor, add a reviewed operation to `browser-runtime.mjs` or `canvas-lab.mjs` and its declarations, enforce file/pixel/resource limits and provide meaningful tests. For a browser vision operation, extend the reviewed model registry and `vision-processor.mjs` with fixed model metadata, exact byte length and SHA-256 verification, a bounded locally bundled worker, no-subject errors and cleanup tests. For a writing agent, add its task-specific output contract to `agent-runtime.mjs`, including section count, required headings, content validation and bounded repair; the browser writer reuses that same contract. The v1 catalog `executionKind` is a legacy dispatch hint: reviewed host capability maps resolve added canvas and vision engines by ID. Do not label a guided prompt as an implemented renderer or describe still-image composition as video generation. A community recipe cannot upload new JavaScript into the host; any source changes need maintainer review and an explicitly versioned release.

```sh
npm test
npm run verify
node --input-type=module -e 'import { writeFile } from "node:fs/promises"; import { AGENT_MANIFEST_SCHEMA } from "./src/index.mjs"; await writeFile("schema/agent-manifest.schema.json", JSON.stringify(AGENT_MANIFEST_SCHEMA, null, 2) + "\n");'
```

With an eligible model already installed and your local service running, use `npm run smoke -- --model installed-model` to verify actual writing. Use host-only `OPTIMAI_OLLAMA_URL` to select a literal loopback port. Never put an endpoint, model installation instruction, token or credential inside a recipe manifest. Automated package tests use a controlled loopback provider and require no model installation.

## Host integration responsibilities

The host validates an agent manifest before saving or running it, resolves reviewed implementations by ID, and grants access only to media explicitly selected for that run. It must show a preview, estimated AI cost and the Studio destination before handing off paid work. Community metadata and model output remain untrusted. An agent description cannot grant permissions or waive the host's billing, publishing, data access or consent controls.

GitHub is a source collaboration channel, not an execution trust boundary. Any future automatic fetching must use reviewed releases, pinned content hashes, license checks and an independently isolated runtime. An MCP tool annotation is metadata rather than proof of safety. Do not expose a remote MCP server merely because its manifest calls itself safe.

## License scope

Contribute only code and recipe text you have the right to license under MIT. The kit's license applies to its own code and documentation. It does not cover user-selected assets, third-party brands, reference sites or the proprietary OptimAI application. No public upload is performed by scaffolding, validation, tests or the MCP adapter. Local inference uses the explicitly selected installed model and does not grant a recipe arbitrary network access.
