# Connect the local MCP adapter

The optional adapter exposes all 34 reviewed templates to an MCP client over local stdio. Calls prepare recipes by default. Five writing templates can also run an explicitly selected model already installed in a local Ollama service. Browser canvas and vision execution use the browser SDK in a host application.

The adapter implements the fixed protocol version **2025-11-25**. It does not provide a remote endpoint or install arbitrary community servers in OptimAI Studio.

## Configure your client

Clone the [public repository](https://github.com/OptimaiNetwork/optimai-creative-agents) as described in the [quickstart](./quickstart.md). Use Node.js 20 or newer and the actual absolute path to your checkout:

```json
{
  "mcpServers": {
    "optimai-creative-agents": {
      "command": "node",
      "args": ["/absolute/path/to/optimai-creative-agents/src/mcp-server.mjs"]
    }
  }
}
```

This is a common `mcpServers` configuration shape; use your client's documented equivalent if its format differs. Launch Node directly because npm's banners can corrupt JSON-RPC stdout. The adapter needs no dependency installation, API key, Studio account or model to list tools and prepare recipes.

The client sends `initialize`, checks the returned protocol version, sends `notifications/initialized`, then uses `tools/list` or `tools/call`. Stable tool names are `optimai.<template-id>`. The adapter also supports `ping` and cancellation of an active local writing run.

## Try a preparation call without a client

Run this from the repository root to exercise the real adapter with newline-delimited requests:

```sh
node src/mcp-server.mjs <<'JSONRPC'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"builder-check","version":"1.0.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"optimai.story-seed","arguments":{"values":{"form":"manga","style":"manga","audience":"all ages"},"brief":"An explorer helps a lost cloud find its way home."}}}
JSONRPC
```

You should receive two JSON responses: initialization with `protocolVersion: "2025-11-25"`, then a successful call with `structuredContent.templateId: "story-seed"`, the settings and prepared prompt. The notification has no response. No inference occurs, and the process exits when stdin closes.

In a connected client, the equivalent tool-call parameters are:

```json
{
  "name": "optimai.story-seed",
  "arguments": {
    "values": { "form": "manga", "style": "manga", "audience": "all ages" },
    "brief": "An explorer helps a lost cloud find its way home."
  }
}
```

Preparation returns validated settings, a prompt, a Studio destination and the source template's `workspace` descriptor. It does not read media, generate a storybook, modify an image or publish a project. The returned `runtime` and `localOperation` remain legacy catalog metadata; use a supported workspace adapter as described in [host integration](./host-integration.md).

## Run local writing explicitly

For Cast Notes, Style Brief, Storyboard Builder, Prompt Branches or Story Seed, set `execution: "run"` and name an eligible installed model:

```json
{
  "name": "optimai.story-seed",
  "arguments": {
    "execution": "run",
    "model": "installed-model",
    "values": { "form": "manga", "style": "manga" },
    "brief": "An explorer helps a lost cloud find its way home."
  }
}
```

Use this as the `params` object of `tools/call`; replace `installed-model` with its actual installed name. The service must already be running and the model installed outside this kit. The SDK checks eligibility and validates the written artifact, allowing one bounded repair for malformed output. See [local Ollama writing](./runtimes.md#local-ollama-writing) for model and resource limits.

Only one local writing run is accepted at a time. A client can cancel an active request with:

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/cancelled",
  "params": { "requestId": 2, "reason": "User stopped writing." }
}
```

Set `requestId` to the ID of the active `tools/call`. Cancellation is a notification and has no separate response.

The default Ollama endpoint is `http://127.0.0.1:11434`. If the trusted host uses another port, add an `env` field to the server configuration:

```json
{
  "OPTIMAI_OLLAMA_URL": "http://127.0.0.1:11435"
}
```

Only literal-loopback HTTP endpoints (`127.0.0.1` or `[::1]`) are accepted. DNS hostnames, including `localhost`, remote services, redirects and URL credentials are rejected. A recipe cannot choose an endpoint, install a model or trigger a cloud fallback.

## Compatibility and troubleshooting

| Symptom | Check |
| --- | --- |
| Protocol parse failures at startup | Launch `node src/mcp-server.mjs` directly; keep stdout reserved for newline-delimited JSON-RPC |
| Calls fail before initialization | Send `initialize`, inspect its response, then send `notifications/initialized` |
| Unknown tool or invalid settings | Inspect `tools/list`; use its exact name and declared input fields |
| Local writing fails | Confirm the local service, exact installed model name and literal-loopback endpoint; inspect the returned error text |
| Canvas or vision call returns a prompt | This adapter prepares those recipes; execute them with a browser host |

The adapter has a fixed catalog with no pagination cursor and accepts JSON-RPC messages up to 64 KiB. It implements recipe tools, rather than every optional MCP capability or transport. Tool annotations describe intent; the client still controls authorization for any downstream action, spending or publishing.

Its [lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), [stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) and [tool messages](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) follow the named specification version. Clients must accept that returned version or stop the connection. `npm test` exercises the actual subprocess protocol, malformed messages, initialization and prepared recipes; local writing integration uses a controlled loopback provider.

Configuring this adapter, importing a recipe into Studio's **Saved** library and contributing source are separate workflows. A public catalog submission service and featured-placement applications have not launched.
