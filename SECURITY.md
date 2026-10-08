# Security policy

## Scope and supported revisions

This policy covers the public OptimAI Creative Agents SDK: manifest validation, reviewed runtimes, CLI tools and the stdio MCP adapter. The package currently carries version `0.1.0`. Report the affected commit or version and, when safe, check whether the issue remains on `main`. No maintenance window for older snapshots is promised.

Issues in a consuming application or an upstream model/library should also be reported to that project's maintainers. Include the integration boundary when an SDK issue affects a host application.

## Report a vulnerability

Do not disclose an exploitable vulnerability, credentials, private media or personal information in a public issue or pull request.

Check the repository's [security advisory reporting page](https://github.com/OptimaiNetwork/optimai-creative-agents/security/advisories/new). If GitHub offers **Report a vulnerability** for this repository, use that private reporting flow. This document does not assert that private vulnerability reporting has been enabled.

If a private reporting flow is unavailable, open a minimal public issue asking maintainers for a private security contact. Include only that you have a security report to share; withhold the vulnerability details, proof of concept and sensitive data until a private route is agreed. No public security email or response-time guarantee is currently specified.

In the private report, provide:

- Affected revision, module and host/runtime environment.
- Expected boundary and observed impact.
- Minimal reproduction steps using synthetic data and the smallest necessary proof of concept.
- Relevant logs with credentials, personal information and private content removed.
- A proposed mitigation if you have one.

Limit testing to systems and data you are authorized to use. Coordinate any public disclosure with maintainers after a fix or mitigation can be assessed.

## Boundaries to preserve

Recipes are declarative data. They cannot add executable code, permissions, remote runtime sources or worker implementations. Hosts must validate imported manifests and resolve reviewed code by template or operation ID.

Selected media and model output remain untrusted. Hosts must enforce input and resource limits, render generated text safely and own preview, export, billing and publishing decisions. A recipe description or MCP annotation is not an authorization mechanism.

Browser model downloads occur only through explicit host actions with reviewed assets. Ollama execution uses an explicitly selected installed model and literal loopback HTTP endpoints. Neither path is an invitation to expose local inference or the stdio MCP adapter as an unauthenticated remote service. See [host integration](./docs/host-integration.md) for integration requirements and [the README](./README.md) for engine-specific limitations.
