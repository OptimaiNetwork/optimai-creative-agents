# {{TITLE}}

Your own [Model Context Protocol](https://modelcontextprotocol.io) server built on [OptimAI Creative Agents](https://github.com/OptimaiNetwork/optimai-creative-agents) (starter kit `{{KIT}}`). It offers a short list of agents you choose as tools. Each tool checks its settings against the agent's form schema and returns a recipe with a creative brief. It runs no model, reads no files and opens no network connections.

## Run it

Use Node.js 20 or newer. In this folder:

```sh
npm install
npm start
```

`npm install` links the local SDK folder at `{{SDK_PATH}}` and downloads nothing. The server then waits for JSON-RPC messages on stdin, one per line; an MCP client normally starts it for you.

## Connect a client

Most clients take a config like this. Use the absolute path to this folder:

```json
{
  "mcpServers": {
    "{{NAME}}": { "command": "node", "args": ["/absolute/path/to/{{NAME}}/server.mjs"] }
  }
}
```

Ask the assistant to "make a poster recipe for a jazz night"; it calls `poster_lab` and gets the settings and brief back.

## Make it yours

- Edit `AGENTS` in [server.mjs](./server.mjs) to offer other catalog agents. Tool names are the agent IDs with `_` for `-`.
- Every tool is read-only and prepares a recipe. To run a writing agent on a local model, start from the SDK's own `npm run mcp` adapter instead.

The SDK and this kit are MIT licensed.
