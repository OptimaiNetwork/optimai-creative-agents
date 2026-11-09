#!/usr/bin/env node
// Your own stdio MCP server: a short list of agents you choose, offered as tools that prepare creative recipes.
// It reads no files, opens no network connections and runs no model. Newline-delimited JSON-RPC on stdin/stdout.
import { getAgentTemplate, validateRecipeValues, compileAgentPrompt } from '@optimai/creative-agents';
import { getAgentFormSchema, plainFormSchema } from '@optimai/creative-agents/form-schema';

const SERVER = { name: '{{NAME}}', version: '0.1.0' };
const PROTOCOL = '2025-11-25';
const AGENTS = ['poster-lab', 'story-seed', 'image-grid']; // Pick any catalog IDs; `npm run verify` in the SDK lists them.
const MAX_LINE = 65536;

const tools = AGENTS.map(id => {
  const agent = getAgentTemplate(id);
  if (!agent) throw new Error(`Unknown agent ${id}.`);
  const { properties } = plainFormSchema(getAgentFormSchema(id));
  return { agent, definition: {
    name: id.replaceAll('-', '_'), title: agent.title, description: `${agent.description} Prepares a recipe and a creative brief; does not generate media.`,
    inputSchema: { type: 'object', additionalProperties: false, properties: { values: { type: 'object', additionalProperties: false, properties }, brief: { type: 'string', maxLength: 4000 } } },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  } };
});

let ready = false, initialized = false;
const send = message => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function call({ name, arguments: args = {} }) {
  const tool = tools.find(item => item.definition.name === name);
  if (!tool) return { error: { code: -32602, message: 'Unknown tool. Use tools/list to see the names.' } };
  if (!isObject(args) || Object.keys(args).some(key => !['values', 'brief'].includes(key))) return { error: { code: -32602, message: 'Arguments accept values and brief only.' } };
  const values = args.values ?? {}, brief = typeof args.brief === 'string' ? args.brief : '';
  const problems = validateRecipeValues(tool.agent.id, values);
  if (problems.length) return { result: { content: [{ type: 'text', text: problems.join('\n') }], isError: true } };
  const recipe = { templateId: tool.agent.id, values: Object.fromEntries(tool.agent.fields.map(field => [field.id, Object.hasOwn(values, field.id) ? values[field.id] : field.default])), prompt: compileAgentPrompt(tool.agent, values, brief) };
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
  if (method === 'tools/list') return send({ id, result: { tools: tools.map(tool => tool.definition) } });
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
