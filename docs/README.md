# Build for OptimAI Studio

OptimAI Creative Agents is a local-first builder kit for focused creative tasks. Start with a declarative recipe that configures one of the reviewed agents. A recipe can be inspected, validated, saved in the Studio's browser library and exported as JSON without installing new executable code.

**Current status:** the kit and local recipe workflow work today. A public community submission service, public registry and featured-agent application process have not launched. Nothing is uploaded, submitted or published by these guides.

## Choose your path

| Your goal | Start here | Integration boundary |
| --- | --- | --- |
| Make an existing agent suit a particular creative task | [Quickstart](./quickstart.md) | Customize a reviewed template's brief and approved values |
| Embed reviewed agent capabilities in your own application | [Host integration](./host-integration.md) | The host selects and bundles the SDK runtime |
| Add a genuinely new algorithm, model or operation | [CONTRIBUTING.md](../CONTRIBUTING.md#new-reviewed-operations) | Contribute source and tests for maintainer review; JSON import cannot install an engine |
| Use the recipe catalog from an MCP client | [MCP adapter](./mcp.md) | Launch the local stdio adapter; media processing remains in the browser host |
| Prepare an agent for source release or future featuring | [Release and featuring](./release-and-feature.md) | Separate source publication from catalog review and editorial selection |

## What is in the kit

The reviewed library has 34 agent templates: 10 canvas agents, 3 browser vision agents, 5 writing agents and 16 guided Studio workflows. Some are local utilities; some need an explicit browser-model download; others prepare a brief for a Studio generation or editing workflow. A successful prompt preparation is not proof that media was generated.

The kit includes versioned manifests, validation, typed settings, browser processors, optional local AI runtimes, a scaffold, examples, tests, original SVG artwork and a local MCP adapter. It contains no Studio account system, billing implementation, project database, private asset library or proprietary application source.

## Recommended building sequence

1. Define the selected input, concrete result and supported limits.
2. Scaffold a recipe and validate its JSON against the reviewed template.
3. Import it into the Studio's **Saved** collection and test realistic inputs.
4. Show useful loading, failure, cancellation and empty states in your host integration.
5. Export the recipe and prepare reproducible examples using media you own.
6. Keep your source release separate from any future catalog submission or featuring decision.

See the [SDK reference in the main README](../README.md) for the exact current runtime APIs and limits. [CONTRIBUTING.md](../CONTRIBUTING.md) covers implementation contributions and ownership requirements.
