#!/usr/bin/env node
// Your own stdio MCP server: a short list of agents you choose, offered as tools that prepare creative recipes.
// It reads no files, opens no network connections and runs no model. Newline-delimited JSON-RPC on stdin/stdout.
import { getAgentTemplate, validateRecipeValues } from '@optimai/creative-agents';
import { MCP_PROTOCOL_VERSION, mcpToolDefinitions, mcpToolName, prepareMcpRecipe } from '@optimai/creative-agents/mcp-tools';

const SERVER = { name: '{{NAME}}', version: '0.1.0' };
const PROTOCOL = MCP_PROTOCOL_VERSION;
const AGENTS = ['poster-lab', 'story-seed', 'image-grid']; // Pick any catalog IDs; `npm run verify` in the SDK lists them.
const MAX_LINE = 65536;

// Same definitions as the SDK adapter: settings from the form schema, an outputSchema for the
// recipe, a small icon, and a stable order; run: false because this server never runs a model (sorted by name). Tool names are the IDs with _ for -.
const naming = { prefix: '', separator: '_' };
const definitions = mcpToolDefinitions({ ids: AGENTS, ...naming, run: false });
const agents = new Map(AGENTS.map(id => [mcpToolName(id, naming), getAgentTemplate(id)]));

let ready = false, initialized = false;
const send = message => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function call({ name, arguments: args = {} }) {
  const agent = agents.get(name);
  if (!agent) return { error: { code: -32602, message: 'Unknown tool. Use tools/list to see the names.' } };
  if (!isObject(args) || Object.keys(args).some(key => !['values', 'brief'].includes(key))) return { error: { code: -32602, message: 'Arguments accept values and brief only.' } };
  const values = args.values ?? {}, brief = typeof args.brief === 'string' ? args.brief : '';
  const problems = validateRecipeValues(agent.id, values);
  if (problems.length) return { result: { content: [{ type: 'text', text: problems.join('\n') }], isError: true } };
  const recipe = prepareMcpRecipe(agent, values, brief);
  return { result: { content: [{ type: 'text', text: JSON.stringify(recipe) }], structuredContent: recipe, isError: false } };
}

function handle(message) {
  if (!isObject(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return send({ id: null, error: { code: -32600, message: 'Invalid JSON-RPC request.' } });
  const { id, method, params = {} } = message;
  if (!Object.hasOwn(message, 'id')) { if (method === 'notifications/initialized' && initialized) ready = true; return; }
  if (method === 'ping') return send({ id, result: {} });
  if (method === 'initialize') {
    if (initialized) return send({ id, error: { code: -32600, message: 'Already initialized.' } });
    initialized = true;
    return send({ id, result: { protocolVersion: PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER, instructions: 'Each tool prepares a bounded creative recipe and brief. Nothing is generated, uploaded or charged.' } });
  }
  if (!ready) return send({ id, error: { code: -32600, message: 'Send initialize and notifications/initialized first.' } });
  if (method === 'tools/list') return send({ id, result: { tools: definitions } });
  if (method === 'tools/call' && isObject(params)) return send({ id, ...call(params) });
  send({ id, error: { code: -32601, message: 'Method not supported.' } });
}

let pending = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  pending += chunk;
  for (let end = pending.indexOf('\n'); end !== -1; end = pending.indexOf('\n')) {
    const line = pending.slice(0, end); pending = pending.slice(end + 1);
    if (!line.trim()) continue;
    if (line.length > MAX_LINE) { send({ id: null, error: { code: -32600, message: 'Message too large.' } }); continue; }
    try { handle(JSON.parse(line)); } catch { send({ id: null, error: { code: -32700, message: 'Invalid JSON.' } }); }
  }
  if (pending.length > MAX_LINE) { pending = ''; send({ id: null, error: { code: -32600, message: 'Message too large.' } }); }
});
