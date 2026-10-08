# Use the local MCP adapter

The optional adapter exposes the 34 reviewed agent templates as local MCP tools. It uses stdio and the fixed protocol version **2025-11-25**. A compatible client initializes the connection, lists tools and calls them. The adapter does not host a remote endpoint or install arbitrary community servers into OptimAI Studio.

## Configure a compatible client

Point the client's MCP configuration at your isolated kit. Client configuration formats can differ; this is the common `mcpServers` shape, not a promise that every client uses this exact file format:

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

Use an actual absolute path and Node.js 20 or newer. Launch Node directly: npm's command banners can corrupt JSON-RPC stdout. The adapter does not need an API key, Studio account or model just to list tools and prepare recipes.

The client must complete `initialize` and `notifications/initialized` before `tools/list` or `tools/call`. The adapter also supports `ping` and cancellation of an active local writing run. Tool names remain `optimai.<template-id>` for compatibility.

## Prepare a recipe

After initialization, an MCP `tools/call` request can use:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "optimai.story-seed",
    "arguments": {
      "values": { "form": "manga", "style": "manga", "audience": "all ages" },
      "brief": "An explorer helps a lost cloud find its way home."
    }
  }
}
```

The default result is prepared direction: validated settings, a prompt and its Studio destination. This call does not generate a storybook, modify images, read media, spend Studio credits or publish a project. The client or application must separately authorize and implement any production handoff.

## Execute a writing agent locally

Five writing templates also accept explicit `execution: "run"` plus the name of an eligible model already installed in your own Ollama service:

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

This is the `params` object for a `tools/call` request. Replace `installed-model` with your actual installed model name. The adapter returns a validated written artifact, with one bounded repair for malformed model output. Only one local writing run is accepted at a time; the client can send `notifications/cancelled` for its request ID.

The default endpoint is `http://127.0.0.1:11434`. If your service uses another port, the trusted client configuration can set:

```json
{
  "OPTIMAI_OLLAMA_URL": "http://127.0.0.1:11435"
}
```

Put this object in the server configuration's `env` field. Only literal-loopback HTTP endpoints are accepted; remote services, redirects, credentials and DNS hostnames are rejected. No recipe can choose an endpoint, install a model or silently fall back to a paid provider.

## Compatibility and boundaries

- The adapter supports a fixed catalog, no pagination cursor, JSON-RPC messages up to 64 KiB and newline-delimited stdio messages.
- It implements recipe tool messages, not every MCP optional capability, browser media processing or remote transport.
- Only the five writing agents execute local model inference. Canvas and vision work use the browser SDK in an explicitly integrated host.
- Annotations describe intent. They do not authorize access, prove the downstream host is safe or waive spending and publishing controls.
- Installing this adapter in a client is separate from importing JSON into OptimAI Studio's **Saved** library or seeking a future catalog listing.

The adapter's [lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), [stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) and [tool messages](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) follow the named version of the MCP specification. Use that version's documentation when checking compatibility, rather than assuming this minimal adapter implements newer protocol behavior.
