#!/usr/bin/env node
// Minimal stdio MCP adapter for the fixed 2025-11-25 protocol. Tool definitions,
// output schemas, icons and order come from mcp-tools.mjs. Calls prepare recipes unless a writing-agent call explicitly selects run + a local model.
// No AI billing, media reads, arbitrary networking or Studio account actions.
import { readFileSync } from 'node:fs';
import { AGENT_CATALOG, validateRecipeValues } from './index.mjs';
import { MCP_PROTOCOL_VERSION as PROTOCOL, mcpArtworkId, mcpArtworkResources, mcpRecipeExports, mcpToolDefinitions, mcpToolName, prepareMcpRecipe } from './mcp-tools.mjs';
// One version source: the package manifest that ships beside this adapter.
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const MAX_MESSAGE_BYTES = 65536;
let lifecycle = 'new';
const activeRuns = new Map();
const TOOLS = mcpToolDefinitions();
function response(id, result) { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`); }
function error(id, code, message) { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
async function handle(message) {
  const validId = typeof message?.id === 'string' || (typeof message?.id === 'number' && Number.isFinite(message.id));
  const notification = object(message) && !Object.hasOwn(message, 'id');
  if (!object(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' || (!notification && !validId) || Object.keys(message).some((key) => !['jsonrpc', 'id', 'method', 'params'].includes(key))) { error(null, -32600, 'Invalid JSON-RPC request.'); return; }
  if (notification) {
    if (message.method === 'notifications/initialized' && lifecycle === 'initializing') lifecycle = 'ready';
    if (message.method === 'notifications/cancelled') activeRuns.get(message.params?.requestId)?.abort();
    return;
  }
  const { id, method, params = {} } = message;
  if (!object(params)) { error(id, -32602, 'Params must be an object.'); return; }
  if (method === 'ping') { response(id, {}); return; }
  if (method === 'initialize') {
    if (lifecycle !== 'new') { error(id, -32600, 'Server has already initialized.'); return; }
    if (typeof params.protocolVersion !== 'string' || !object(params.capabilities) || !object(params.clientInfo) || typeof params.clientInfo.name !== 'string' || typeof params.clientInfo.version !== 'string') { error(id, -32602, 'Provide protocolVersion, capabilities and clientInfo.'); return; }
    lifecycle = 'initializing';
    response(id, { protocolVersion: PROTOCOL, capabilities: { tools: { listChanged: false }, resources: { listChanged: false } }, serverInfo: { name: 'optimai-creative-agents', version: VERSION }, instructions: 'Creative agents prepare bounded recipes. Five writing agents can execute an explicitly selected installed Ollama model. Media generation and spending remain in the authorized host workflow.' });
    return;
  }
  if (lifecycle !== 'ready') { error(id, -32600, 'Initialize and send notifications/initialized before using tools.'); return; }
  if (method === 'tools/list') {
    if (Object.keys(params).length) { error(id, -32602, 'This fixed catalog has no pagination cursor.'); return; }
    response(id, { tools: TOOLS }); return;
  }
  if (method === 'resources/list') {
    if (Object.keys(params).length) { error(id, -32602, 'This fixed list has no pagination cursor.'); return; }
    response(id, { resources: mcpArtworkResources() }); return;
  }
  if (method === 'resources/templates/list') { response(id, { resourceTemplates: [] }); return; }
  if (method === 'resources/read') {
    const agent = mcpArtworkId(params.uri);
    if (!agent || Object.keys(params).some((key) => !['uri', '_meta'].includes(key))) { error(id, -32002, 'Resource not found. Use resources/list to discover artwork.'); return; }
    // Only the package's own reviewed artwork; the request never supplies a path.
    response(id, { contents: [{ uri: params.uri, mimeType: 'image/svg+xml', text: readFileSync(new URL(`../artwork/${agent}.svg`, import.meta.url), 'utf8') }] }); return;
  }
  if (method === 'tools/call') {
    if (typeof params.name !== 'string' || Object.keys(params).some((key) => !['name', 'arguments', '_meta'].includes(key))) { error(id, -32602, 'Provide a known tool name and arguments.'); return; }
    const tool = AGENT_CATALOG.find((entry) => mcpToolName(entry) === params.name);
    if (!tool) { error(id, -32602, 'Unknown tool. Use tools/list to discover names.'); return; }
    const args = Object.hasOwn(params, 'arguments') ? params.arguments : {};
    const allowed = tool.executionKind === 'local-model' ? ['values', 'brief', 'execution', 'model'] : ['values', 'brief'];
    if (!object(args) || Object.keys(args).some((key) => !allowed.includes(key))) { error(id, -32602, `Arguments accept ${allowed.join(', ')} only.`); return; }
    try {
      const values = Object.hasOwn(args, 'values') ? args.values : {};
      const errors = validateRecipeValues(tool.id, values);
      if (errors.length) throw new Error(errors.join('\n'));
      const brief = Object.hasOwn(args, 'brief') ? args.brief : '';
      const structuredContent = prepareMcpRecipe(tool, values, brief);
      if (Object.hasOwn(args, 'execution') && !['prepare', 'run'].includes(args.execution)) throw new Error('execution: choose prepare or run.');
      if (Object.hasOwn(args, 'model') && (typeof args.model !== 'string' || !args.model.trim() || args.model.length > 160)) throw new Error('model: use an installed local model name of 1 to 160 characters.');
      if (args.execution === 'run') {
        if (typeof args.model !== 'string' || !args.model.trim() || args.model.length > 160) throw new Error('model: select an already installed local Ollama model to run this agent.');
        if (activeRuns.size) throw new Error('A local agent is already running. Wait or cancel it before starting another.');
        const controller = new AbortController();
        activeRuns.set(id, controller);
        try {
          const { runCreativeAgent } = await import('./agent-runtime.mjs');
          const output = await runCreativeAgent({ templateId: tool.id, values, brief, model: args.model, baseUrl: process.env.OPTIMAI_OLLAMA_URL, signal: controller.signal });
          response(id, { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output, isError: false });
        } finally { activeRuns.delete(id); }
        return;
      }
      response(id, { content: [{ type: 'text', text: JSON.stringify(structuredContent) }, ...mcpRecipeExports(tool, values, brief)], structuredContent, isError: false });
    } catch (problem) { response(id, { content: [{ type: 'text', text: problem.message }], isError: true }); }
    return;
  }
  error(id, -32601, 'Method not supported by this recipe-only adapter.');
}
let pending = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  pending += chunk;
  let newline;
  while ((newline = pending.indexOf('\n')) !== -1) {
    const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
    if (Buffer.byteLength(line) > MAX_MESSAGE_BYTES) { error(null, -32600, 'Message exceeds 64 KiB.'); continue; }
    try { void handle(JSON.parse(line)).catch(() => error(null, -32603, 'Internal adapter error.')); } catch { error(null, -32700, 'Invalid JSON.'); }
  }
  if (Buffer.byteLength(pending) > MAX_MESSAGE_BYTES) { error(null, -32600, 'Unterminated message exceeds 64 KiB.'); pending = ''; process.stdin.pause(); process.exitCode = 1; process.stdin.destroy(); }
});
process.stdin.on('end', () => { if (pending.trim()) error(null, -32700, 'Each JSON-RPC message must end with a newline.'); });
