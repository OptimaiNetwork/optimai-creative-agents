import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AGENT_CATALOG, validateAgentManifest } from '../src/index.mjs';
import { MCP_PROTOCOL_VERSION, mcpArtworkId, mcpArtworkResources, mcpArtworkUri, mcpOutputSchema, mcpRecipeExports, mcpRecipeManifest, mcpToolDefinition, mcpToolDefinitions, mcpToolIconSvg, mcpToolIcons, mcpToolName, prepareMcpRecipe } from '../src/mcp-tools.mjs';

// The JSON Schema keywords these definitions use; anything else fails loudly so the checker cannot pass by ignoring it.
const KEYWORDS = new Set(['type', 'const', 'enum', 'required', 'properties', 'additionalProperties', 'anyOf', 'items', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'default', 'description', 'title', 'multipleOf']);
function conforms(schema, value, path = '$') {
  for (const key of Object.keys(schema)) if (!KEYWORDS.has(key)) throw new Error(`${path}: unchecked keyword ${key}`);
  const errors = [];
  if (schema.anyOf && !schema.anyOf.some((branch) => !conforms(branch, value, path).length)) errors.push(`${path}: matches no anyOf branch`);
  const kind = Array.isArray(value) ? 'array' : value === null ? 'null' : Number.isInteger(value) ? 'integer' : typeof value;
  if (schema.type && !(schema.type === kind || (schema.type === 'number' && kind === 'integer'))) return [`${path}: expected ${schema.type}, got ${kind}`];
  if ('const' in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) errors.push(`${path}: not the constant`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: not in enum`);
  if (typeof value === 'number') { if (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) errors.push(`${path}: out of range`); }
  if (typeof value === 'string') { if (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity) || (schema.pattern && !new RegExp(schema.pattern).test(value))) errors.push(`${path}: bad string`); }
  if (kind === 'array' && schema.items) value.forEach((item, index) => errors.push(...conforms(schema.items, item, `${path}[${index}]`)));
  if (kind === 'object') {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: missing`);
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key]) errors.push(...conforms(schema.properties[key], item, `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: not allowed`);
    }
  }
  return errors;
}

test('the checker rejects what the schemas forbid', () => {
  const schema = mcpOutputSchema('image-grid');
  const recipe = prepareMcpRecipe('image-grid');
  assert.deepEqual(conforms(schema, recipe), []);
  assert.notDeepEqual(conforms(schema, { ...recipe, extra: 1 }), []);
  assert.notDeepEqual(conforms(schema, { ...recipe, values: { ...recipe.values, columns: 99 } }), []);
  assert.notDeepEqual(conforms(schema, { ...recipe, templateId: 'poster-lab' }), []);
  assert.throws(() => conforms({ type: 'object', oneOf: [] }, {}), /unchecked keyword/);
});

test('every definition is a valid 2025-11-25 tool: object schemas, read-only, one safe icon, stable sorted names', () => {
  assert.equal(MCP_PROTOCOL_VERSION, '2025-11-25');
  const tools = mcpToolDefinitions();
  assert.equal(tools.length, AGENT_CATALOG.length);
  assert.deepEqual(tools.map((tool) => tool.name), AGENT_CATALOG.map((tool) => `optimai.${tool.id}`).sort());
  assert.deepEqual(mcpToolDefinitions(), tools, 'Same output every time.');
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.outputSchema.type, 'object', 'MCP restricts outputSchema to an object root.');
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.icons.length, 1);
    const [{ src, mimeType, sizes }] = tool.icons;
    assert.deepEqual([mimeType, sizes], ['image/svg+xml', ['any']]);
    const svg = Buffer.from(src.slice('data:image/svg+xml;base64,'.length), 'base64').toString('utf8');
    assert.equal(svg, mcpToolIconSvg(tool.name.slice('optimai.'.length)));
    assert.ok(svg.length < 600, `${tool.name} icon stays tiny`);
    assert.equal(/<script|<foreignObject|\son[a-z]+\s*=|(?:href|src)\s*=|url\(/i.test(svg), false, tool.name);
  }
  assert.ok(Buffer.byteLength(JSON.stringify(tools)) < 160000, 'tools/list stays small enough for any client.');
});

test('custom names, a chosen subset and recipe-only writing tools for your own server', () => {
  const tools = mcpToolDefinitions({ ids: ['story-seed', 'image-grid'], prefix: '', separator: '_', run: false, icons: false });
  assert.deepEqual(tools.map((tool) => tool.name), ['image_grid', 'story_seed']);
  assert.ok(tools.every((tool) => !tool.icons && !tool.inputSchema.properties.execution && !tool.outputSchema.anyOf));
  assert.equal(mcpToolName('glitch-cut', { prefix: 'my.' }), 'my.glitch-cut');
  assert.ok(mcpToolDefinition('story-seed').inputSchema.properties.execution, 'The SDK adapter keeps local runs by default.');
  assert.throws(() => mcpToolDefinitions({ ids: ['not-an-agent'] }), /Unknown agent/);
  assert.throws(() => mcpToolIcons('../etc'), /Unknown agent/);
});

test('a written result from a local run also matches the writing tool schema, a recipe for another agent does not', () => {
  const schema = mcpOutputSchema('story-seed');
  assert.ok(schema.anyOf);
  const written = { title: 'Cloud', summary: 'A lost cloud.', sections: [{ heading: 'Start', body: 'Once.' }], studioPrompt: 'p', model: 'm', provider: 'ollama', templateId: 'story-seed', attempts: 1 };
  assert.deepEqual(conforms(schema, written), []);
  assert.deepEqual(conforms(schema, prepareMcpRecipe('story-seed')), []);
  assert.notDeepEqual(conforms(schema, { ...written, attempts: 3 }), []);
  assert.notDeepEqual(conforms(schema, { ...written, templateId: 'style-brief' }), []);
  assert.notDeepEqual(conforms(mcpOutputSchema('story-seed', { run: false }), written), []);
});

test('exports: an artwork link and a recipe file that imports as a valid v1.0 manifest', () => {
  const [link, file] = mcpRecipeExports('poster-lab', { title: 'Jazz night', color: '#ff9b71' }, 'A late-night jazz poster.');
  assert.deepEqual(link, { type: 'resource_link', uri: 'optimai-agents://artwork/poster-lab.svg', name: 'poster-lab.svg', title: 'Poster Lab artwork', mimeType: 'image/svg+xml' });
  assert.equal(file.type, 'resource');
  assert.equal(file.resource.uri, 'optimai-agents://recipes/poster-lab.agent.json');
  const manifest = JSON.parse(file.resource.text);
  assert.equal(validateAgentManifest(manifest).success, true);
  assert.deepEqual(manifest, mcpRecipeManifest('poster-lab', { title: 'Jazz night', color: '#ff9b71' }, 'A late-night jazz poster.'));
  assert.equal(manifest.recipe.values.title, 'Jazz night');
  assert.equal(manifest.recipe.brief, 'A late-night jazz poster.');
  assert.deepEqual(manifest.recipe.values, prepareMcpRecipe('poster-lab', { title: 'Jazz night', color: '#ff9b71' }).values);
});

test('artwork URIs resolve only to catalog agents', () => {
  const resources = mcpArtworkResources();
  assert.equal(resources.length, AGENT_CATALOG.length);
  assert.deepEqual(resources.map((item) => item.uri), [...resources.map((item) => item.uri)].sort());
  for (const tool of AGENT_CATALOG) assert.equal(mcpArtworkId(mcpArtworkUri(tool)), tool.id);
  for (const uri of ['optimai-agents://artwork/../package.json', 'optimai-agents://artwork/poster-lab.svg?x', 'file:///etc/passwd', 'optimai-agents://artwork/unknown.svg', 'OPTIMAI-AGENTS://artwork/poster-lab.svg', null, 7]) assert.equal(mcpArtworkId(uri), undefined, String(uri));
});

const server = fileURLToPath(new URL('../src/mcp-server.mjs', import.meta.url));
const handshake = [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } } }, { jsonrpc: '2.0', method: 'notifications/initialized' }];
function session(messages) {
  const result = spawnSync(process.execPath, [server], { input: [...handshake, ...messages].map((value) => JSON.stringify(value)).join('\n') + '\n', encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  return Object.fromEntries(result.stdout.trim().split('\n').map((line) => JSON.parse(line)).map((reply) => [reply.id, reply]));
}

test('the stdio adapter: every default call matches its outputSchema and carries the exports', () => {
  const listed = session([{ jsonrpc: '2.0', id: 2, method: 'tools/list' }])[2].result.tools;
  assert.deepEqual(listed, mcpToolDefinitions());
  const replies = session(listed.map((tool, index) => ({ jsonrpc: '2.0', id: index + 10, method: 'tools/call', params: { name: tool.name, arguments: { brief: 'A bright test.' } } })));
  listed.forEach((tool, index) => {
    const { result } = replies[index + 10];
    assert.equal(result.isError, false, tool.name);
    assert.deepEqual(conforms(tool.outputSchema, result.structuredContent), [], tool.name);
    assert.deepEqual(result.content.map((item) => item.type), ['text', 'resource_link', 'resource']);
    assert.equal(validateAgentManifest(JSON.parse(result.content[2].resource.text)).success, true, tool.name);
  });
});

test('the stdio adapter announces resources and reads only its own artwork', () => {
  const replies = session([
    { jsonrpc: '2.0', id: 2, method: 'resources/list' },
    { jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'optimai-agents://artwork/poster-lab.svg' } },
    { jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'optimai-agents://artwork/../package.json' } },
    { jsonrpc: '2.0', id: 5, method: 'resources/read', params: { uri: 'file:///etc/hosts' } },
    { jsonrpc: '2.0', id: 6, method: 'resources/list', params: { cursor: 'x' } },
    { jsonrpc: '2.0', id: 7, method: 'resources/templates/list' },
  ]);
  assert.deepEqual(replies[1].result.capabilities, { tools: { listChanged: false }, resources: { listChanged: false } });
  assert.deepEqual(replies[2].result.resources, mcpArtworkResources());
  assert.deepEqual(replies[3].result.contents, [{ uri: 'optimai-agents://artwork/poster-lab.svg', mimeType: 'image/svg+xml', text: readFileSync(new URL('../artwork/poster-lab.svg', import.meta.url), 'utf8') }]);
  assert.equal(replies[4].error.code, -32002);
  assert.equal(replies[5].error.code, -32002);
  assert.equal(replies[6].error.code, -32602);
  assert.deepEqual(replies[7].result, { resourceTemplates: [] });
});
