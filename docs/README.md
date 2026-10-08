# Builder guides

Build a focused creative tool, remix an existing agent, or embed a reviewed runtime in your own application. OptimAI Creative Agents is an MIT-licensed SDK with a public source repository; you can use it without the OptimAI Studio application.

Start with a **recipe** when an existing template already does the job. A recipe is JSON containing a reviewed template ID, approved setting values and a creative brief. It can be validated, shared as a file and imported by a compatible host. A **runtime contribution** adds the implementation for a new operation and needs source review, tests and a host release.

## Choose a starting point

| Goal | Guide | What you will finish with |
| --- | --- | --- |
| Choose a capability | [Agent catalog](./catalog.md) | All 34 templates, their execution paths and actual outputs |
| Create your first recipe | [Quickstart](./quickstart.md) | A validated manga-planning recipe and its prepared prompt, with no model required |
| Run a browser tool or add optional local AI | [Runtime guide](./runtimes.md) | The correct API, requirements and output for each runtime |
| Embed recipes in your own application | [Host integration](./host-integration.md) | Validation, reviewed dispatch, selected inputs and portable export |
| Connect an MCP client | [MCP adapter](./mcp.md) | A local stdio server that prepares recipes and can explicitly run local writing |
| Share your work or contribute it upstream | [Release and review](./release-and-feature.md) | Reproducible examples and a reviewable pull request |
| Implement a new capability | [Contributing](../CONTRIBUTING.md#new-reviewed-operations) | Source, declarations, contract updates and meaningful tests |

## What runs today

The catalog contains 34 reviewed templates: 10 have canvas implementations, 3 have browser vision implementations, 5 have writing implementations, and 16 prepare direction for a separate Studio workflow. Canvas tools export still-image PNGs. Vision and browser writing require an explicit model download; writing can also use an eligible model already installed in a local Ollama service. A guided workflow prepares a brief rather than generating its final media.

The core manifest, canvas and Ollama SDKs use no package dependencies. Browser writing and vision use pinned optional dependencies installed by the host. The package has no Studio account system, billing, project database or private asset library.

Clone [OptimaiNetwork/optimai-creative-agents](https://github.com/OptimaiNetwork/optimai-creative-agents) and follow the quickstart with Node.js 20 or newer. The source is public; `private: true` in `package.json` currently prevents npm publication. Use the checkout directly or install it from a local path as described in the [main README](../README.md).

## Share locally, contribute publicly

Recipe files and public source contributions are available now. A compatible host, including OptimAI Studio's **Saved** library, can import and export recipe JSON. Studio saves that library in the browser and account scope; export your recipes before moving devices or clearing browser storage.

A public community catalog submission service and applications for featured placement have not launched. Opening a pull request proposes a source change; importing a file saves a local recipe. Neither action creates a catalog listing or guarantees featuring. The [release guide](./release-and-feature.md) explains those boundaries and the material to prepare for review.
