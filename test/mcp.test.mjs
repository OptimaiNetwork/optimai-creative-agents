import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const server = fileURLToPath(new URL('../src/mcp-server.mjs', import.meta.url));
const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } } };
const ready = { jsonrpc: '2.0', method: 'notifications/initialized' };
function run(messages) {
  const result = spawnSync(process.execPath, [server], { input: messages.map((value) => typeof value === 'string' ? value : JSON.stringify(value)).join('\n') + '\n', encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}
test('stdio MCP initializes, lists exactly 34 tools and prepares a structured recipe', () => {
  const results = run([initialize, ready, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'optimai.image-finish', arguments: { values: { preset: 'noir', intensity: 80 }, brief: 'A calm portrait.' } } }]);
  assert.equal(results.length, 3, 'notifications have no response');
  assert.equal(results[0].result.protocolVersion, '2025-11-25');
  assert.equal(results[1].result.tools.length, 34);
  assert.equal(results[2].result.structuredContent.localOperation, 'image-filter');
  assert.equal(results[2].result.structuredContent.values.preset, 'noir');
  assert.equal(results[2].result.isError, false);
  assert.deepEqual(JSON.parse(results[2].result.content[0].text), results[2].result.structuredContent);
});
test('MCP rejects calls before initialization, unknown tools and invalid setting values', () => {
  const results = run([{ jsonrpc: '2.0', id: 0, method: 'tools/list' }, initialize, ready, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'remote.exec', arguments: {} } }, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'optimai.image-grid', arguments: { values: { columns: 200 } } } }]);
  assert.equal(results[0].error.code, -32600);
  assert.equal(results[2].error.code, -32602);
  assert.equal(results[3].result.isError, true);
  assert.match(results[3].result.content[0].text, /1 to 4/);
});
test('MCP handles malformed JSON, unknown notifications and fixed protocol negotiation', () => {
  const results = run(['{broken', { ...initialize, params: { ...initialize.params, protocolVersion: '2099-01-01' } }, { jsonrpc: '2.0', method: 'notifications/unknown' }, ready, { jsonrpc: '2.0', id: 4, method: 'ping' }]);
  assert.equal(results[0].error.code, -32700);
  assert.equal(results[1].result.protocolVersion, '2025-11-25');
  assert.deepEqual(results[2].result, {});
});
test('every MCP tool can prepare a default recipe without performing host actions', () => {
  const listed = run([initialize, ready, { jsonrpc: '2.0', id: 2, method: 'tools/list' }])[1].result.tools;
  const results = run([initialize, ready, ...listed.map((tool, index) => ({ jsonrpc: '2.0', id: index + 2, method: 'tools/call', params: { name: tool.name, arguments: {} } }))]);
  assert.equal(results.length, 35);
  assert.ok(results.slice(1).every((result) => result.result.isError === false && result.result.structuredContent.prompt.length < 12000));
});
test('MCP does not coerce explicit null arguments, settings or brief to valid defaults', () => {
  const results = run([initialize, ready, ...[null, { values: null }, { brief: null }].map((args, index) => ({ jsonrpc: '2.0', id: index + 2, method: 'tools/call', params: { name: 'optimai.story-seed', arguments: args } }))]);
  assert.equal(results[1].error.code, -32602);
  assert.equal(results[2].result.isError, true);
  assert.equal(results[3].result.isError, true);
});
test('MCP writing-agent execution requires a model and leaves other 25 workflows guided', () => {
  const results = run([initialize, ready, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'optimai.story-seed', arguments: { execution: 'run' } } }, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'optimai.motion-tracker', arguments: { execution: 'run', model: 'local-model' } } }]);
  const definitions = results[1].result.tools;
  assert.equal(definitions.filter((entry) => entry.inputSchema.properties.execution).length, 5);
  assert.equal(results[2].result.isError, true);
  assert.match(results[2].result.content[0].text, /model/);
  assert.equal(results[3].error.code, -32602);
});
