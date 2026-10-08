# Release, review and featuring

**Current availability:** local import, remixing and JSON export work today. Public community submissions, automatic GitHub integration, a registry endpoint and applications for featuring are not launched. This guide prepares reviewable material; it does not submit or publish anything.

An agent can be useful in your own Studio library before it is publicly listed. Source publication, Studio integration and editorial featuring are distinct steps.

## 1. Prepare a portable recipe

Include these files in a new agent's directory:

```text
agents/cloud-companion/
  agent.json
  README.md
  examples/
    input.md
    expected-behavior.md
```

`agent.json` is the only imported recipe. The README explains the intended input, output, supported runtime and limitations. Example notes describe reproducible, non-private inputs and the behavior a reviewer should verify. Media examples must have a license that permits their distribution; the recipe's MIT license does not relicense them.

Run these commands from the kit root:

```sh
node scripts/verify.mjs agents/cloud-companion/agent.json
npm test
npm run verify
```

For a writing-engine contribution, also test real inference with a model you have deliberately installed. `npm run smoke -- --model installed-model` exercises all five reviewed writing contracts using public example text. A controlled mock-provider test is useful, but it is not evidence of creative quality or speed on a real device.

## 2. Keep the source release isolated

Use the repository name **`optimai-creative-agents`** and display name **OptimAI Creative Agents** for the isolated kit. Start from the downloaded starter archive or copy only this package's reviewed contents into a fresh directory. Initialize new Git history there if you choose to publish later.

Never copy the parent Studio repository, its Git history, frontend, backend, environment files, credentials, database dumps, account code, billing code, selected user media or private project prompts into that release. The MIT license in this kit covers this kit's own code and documentation; it does not apply to the proprietary application.

Review the exact files in your new standalone directory before any external publication. The kit is intentionally marked `private: true`; this allows a public source repository while preventing accidental npm publication. A future npm release is a separate deliberate action.

The starter archive includes original SVG artwork. Third-party models and libraries retain their upstream licenses. Do not copy a reference product's source, branding or assets into an agent submission. Clearly distinguish inspiration from affiliation.

## 3. Prepare a review package

Until a submission channel launches, keep the following material locally with your agent. A GitHub repository alone does not install or list an agent in OptimAI Studio.

| Review material | What it should demonstrate |
| --- | --- |
| Identity and version | Stable ID, descriptive title, version, author/contact details outside the strict v1 manifest |
| Capability and limits | The concrete result, selected inputs, runtime, device/model requirements and steps that still need Studio |
| Valid contract | Passing manifest validation and a known reviewed template ID |
| Reproducible examples | Clear original inputs, expected behavior and rights to any included media |
| Quality evidence | Successful output plus empty, malformed, oversized, failure and cancellation cases |
| Source and licenses | Reviewed source revision, MIT contribution rights and third-party dependency/model notices |
| Integration notes | Preview/export behavior, accessibility, mobile layout and separate credit or publishing handoffs |

Do not add author, repository URL, submission status or remote runtime fields to `agent.json`; v1 rejects unknown fields. Put release and review metadata in the README or a separate document until a versioned submission contract exists.

## 4. Understand what review would cover

A future catalog review should establish that the agent does what it claims, has an appropriate license, uses reviewed code and model assets, respects selected-input boundaries and has reproducible tests. New source operations require a versioned SDK and host release before they can run in Studio. Recipe-only submissions reuse a reviewed operation.

Automatic execution of arbitrary repository code is outside v1. GitHub popularity, a license badge or an MCP `readOnlyHint` is not a substitute for a runtime review. Any future registry should use reviewed releases, pinned revisions/content hashes, provenance, deprecation notices and an explicit host capability policy.

## 5. Prepare for possible featuring

Featured placement is an editorial decision, separate from validation or acceptance into a catalog. No automatic placement, response time or selection guarantee is offered by this kit.

A strong candidate has a clear useful outcome, original presentation, honest capability labels, excellent first-run behavior and examples people can reproduce. Its controls work by keyboard and on small screens. It explains an optional model download before starting it, handles cancellation and failures clearly, preserves user inputs, and avoids unnecessary privileges. The result should be easy to inspect, export and carry into the next creative step.

Release locally now; publish or submit only through an official channel that OptimAI explicitly launches later. Follow [CONTRIBUTING.md](../CONTRIBUTING.md) for current code contribution requirements.
