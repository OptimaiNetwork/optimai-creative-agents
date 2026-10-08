# Share, contribute and prepare for review

The SDK source is public at [OptimaiNetwork/optimai-creative-agents](https://github.com/OptimaiNetwork/optimai-creative-agents). You can share recipe files, embed the SDK in an application and propose changes through GitHub pull requests today. A public community catalog submission service, automatic GitHub import and applications for featured placement have not launched.

Source collaboration, local recipe import, catalog acceptance and editorial featuring are separate steps. A useful recipe can run in a compatible host before any public listing exists.

## Package a recipe people can reproduce

Keep the manifest and usage notes together. For the [quickstart recipe](./quickstart.md), a useful contribution looks like:

```text
agents/cloud-companion/
  agent.json
  README.md
  examples/
    input.md
    expected-behavior.md
```

Only `agent.json` is imported as a recipe. The README should explain the input, actual result, selected template, runtime requirements, settings, limitations and how to validate or run it. Example notes give a short reproducible input, expected behavior and any remaining production step. Include example media only when you have redistribution rights; the recipe's MIT license does not relicense those assets.

Keep author/contact details, repository links and review metadata in the README or another document. The strict v1 manifest rejects these extra fields, including a submission status, remote runtime or model endpoint.

From the repository root, run:

```sh
node scripts/verify.mjs agents/cloud-companion/agent.json
npm test
npm run verify
```

Validation checks that your recipe uses a reviewed template and approved settings. Tests check SDK behavior. Neither proves that a model produced a useful creative result on your device. For a writing contribution, include representative output from an eligible model you deliberately installed, along with its name and relevant device details. `npm run smoke -- --model installed-model` exercises all five writing contracts with public example text when your local Ollama service is ready.

## Open a source pull request

Fork the public repository using GitHub, then clone your fork. Replace `YOUR-USERNAME` with the owner of that fork:

```sh
git clone https://github.com/YOUR-USERNAME/optimai-creative-agents.git
cd optimai-creative-agents
git switch -c recipe/cloud-companion
```

Scaffold and edit your recipe following the [quickstart](./quickstart.md), add reproducible notes, and run the checks above. Review the exact files you intend to contribute, then commit and push them to your fork:

```sh
git diff --check
git status --short
git add agents/cloud-companion
git diff --cached

git commit -m "Add Cloud Companion story recipe"
git push -u origin recipe/cloud-companion
```

Open a pull request from your branch to `main` in [OptimaiNetwork/optimai-creative-agents](https://github.com/OptimaiNetwork/optimai-creative-agents). Describe the problem the recipe solves, its actual output, a reproducible example and your validation results. Source implementation changes should also explain behavior, limits and relevant tests. Follow [CONTRIBUTING.md](../CONTRIBUTING.md) and the repository's pull request template.

A recipe PR reuses reviewed code. A new operation needs SDK source, declarations, contract and schema updates, meaningful tests and documentation. Merging source does not automatically deploy it to every host; a host must ship the reviewed version before the capability can execute there.

## SDK 0.2.0 and Studio promotion

This release introduces a versioned public `workspace` descriptor for actual canvas, vision, writing, sketch and guided capabilities. Titles, descriptions, workspace headlines, fields and artwork ship from the reviewed package. Canvas composition defaults now honor saved recipe values and normalize legacy aliases; existing v1 fields and Tool aliases remain accepted. MCP preparation includes the workspace descriptor alongside its legacy metadata.

A built-in agent must be a reviewed source catalog entry with an implemented or supported operation binding, original artwork, matching declarations and schemas, and meaningful tests. Adding a standalone recipe example does not create a built-in listing.

Studio promotes an exact SDK source revision through its own integration checks before deploying the frontend. Compatible new catalog entries then appear from that bundled catalog. An unsupported engine, model, writing output contract or custom interface needs a host integration change first. Source review, frontend deployment and editorial featuring remain distinct decisions. See [the host release boundary](./host-integration.md#promote-a-source-release-into-studio).

## Share a standalone recipe or application

You can distribute a recipe JSON file or publish your own repository with its documentation. Use a name that identifies your work and explain which reviewed template and SDK revision it uses. Recipients validate the JSON and import it into a compatible host. Studio's **Saved** library remains scoped to the browser and account, so export a copy for transfer or backup.

You can also embed the MIT-licensed SDK in your own application. Keep its license notice with redistributed source. Third-party models, libraries and assets retain their own licenses, and the kit's license does not cover the proprietary OptimAI Studio application. The public SDK repository is the source boundary for this work; no Studio checkout is needed.

The SDK package currently has `private: true` to prevent npm publication. Publishing an application or source fork does not require changing that flag. An official npm package release would be a separate maintainer action.

## Prepare material for a future catalog review

Until an official submission channel launches, keep review evidence with your project:

| Material | What a reviewer should be able to check |
| --- | --- |
| Identity and revision | Stable recipe ID, version, author/contact notes and exact source revision |
| Capability and limits | Selected inputs, actual output, supported runtime and remaining host steps |
| Valid contract | Passing validation, reviewed template and approved values |
| Reproducible examples | Original inputs, expected behavior and distribution rights for included media |
| Quality evidence | Useful results plus relevant invalid-input, failure, cancellation and no-subject cases |
| Source and licenses | Contribution rights, SDK revision and third-party model/dependency notices |
| Host behavior | Clear preview/export, accessible controls, mobile layout and explicit paid production or publishing handoffs |

A future catalog review would need to assess behavior, licenses, source provenance and the selected-input boundary. A repository link, popularity or MCP annotation does not establish execution trust. New operations need a reviewed source release and host integration; recipe-only contributions reuse an installed operation. Automatic execution of arbitrary repository code is outside the v1 manifest contract.

## Understand featuring

Featured placement is an editorial decision beyond validation or catalog acceptance. There is no active application channel, automatic placement, promised response time or selection guarantee in this kit.

Prepare a clear useful outcome, original presentation, honest capability labels and examples another person can reproduce. Make the first run understandable, state optional download requirements, preserve inputs after a failure and support stopping a job. Controls should work by keyboard and on small screens, and the result should be easy to inspect and export.

Contribute through the public source workflow now. Treat any future catalog or featuring process as available only when OptimAI announces its official channel and requirements.
