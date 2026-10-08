import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createAgentManifest } from '../src/index.mjs';
import { parseOptions, readAgentManifest } from '../scripts/cli-input.mjs';
const MODEL = 'qwen3.5:0.8b';
const pathTo = (file) => fileURLToPath(new URL(`../${file}`, import.meta.url));
function command(file, args = [], baseUrl = 'http://127.0.0.1:1', stdin, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [pathTo(file), ...args], { cwd, env: { ...process.env, OPTIMAI_OLLAMA_URL: baseUrl }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('CLI subprocess timed out.')); }, 15000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.end(stdin);
  });
}
async function mockOllama(work) {
  const calls = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const input = body ? JSON.parse(body) : {};
    calls.push({ path: request.url, input });
    let result;
    if (request.url === '/api/tags') result = { models: [{ name: MODEL, size: 1_300_000_000, details: { family: 'qwen', parameter_size: '0.8B' } }] };
    else if (request.url === '/api/version') result = { version: '0.40.0' };
    else if (request.url === '/api/show') result = { capabilities: ['completion'], model_info: { 'general.parameter_count': 800_000_000 } };
    else if (request.url === '/api/chat') {
      const system = input.messages[0].content;
      const listed = system.match(/Use these section headings exactly and in order: ([^.]+)\./)?.[1];
      const count = input.format.properties.sections.minItems;
      const headings = listed ? listed.split('; ') : Array.from({ length: count }, (_, index) => `${system.includes('complete scenes') ? 'Scene' : 'Direction'} ${index + 1} — A warm discovery`);
      const properties = input.format.properties.sections.items.properties;
      const sections = headings.map((heading, index) => {
        const artDirection = properties.artDirection ? { artDirection: properties.artDirection.enum[0] } : {};
        if (properties.purpose) return {
          heading,
          purpose: `Beat ${index + 1} helps the explorer and cloud learn a new way to cooperate.`,
          action: `The explorer follows clue ${index + 1} along the river while the cloud lights their way home.`,
          visual: 'Japanese manga ink silhouettes, expressive faces and soft screentone shading make the explorer and cloud easy to recognize.',
          framing: `Frame clue ${index + 1} in a readable close-up, followed by an open view of the shared path.`,
          dialogue: `The explorer says, "Our next clue is number ${index + 1}; let us look together."`,
          sound: 'A gentle bell and quiet river sounds support this warm discovery.',
          ...artDirection,
        };
        if (properties.sharedPremise) return {
          heading,
          sharedPremise: properties.sharedPremise.enum?.[0] || 'A curious young explorer helps a lost cloud find its way home.',
          prompt: `Direction ${index + 1}: The explorer helps the lost cloud return home through a distinct riverside setting. Use Japanese manga ink linework, expressive faces, legible panel framing and soft screentone shading.`,
          difference: `Variation ${index + 1} uses a different riverside landmark, keeping the explorer, cloud and shared goal consistent.`,
          ...artDirection,
        };
        return { heading, body: `Beat ${index + 1}: The explorer notices a different clue beside the river and helps the cloud make a thoughtful choice. Use Japanese manga linework, expressive ink silhouettes, screentone shading and readable panel framing. A gentle bell gives this moment its own purpose.` };
      });
      const artifact = { title: 'The explorer and the lost cloud', summary: 'A warm original adventure about friendship, patient listening and finding a shared path home.', sections };
      result = { done: true, message: { role: 'assistant', content: JSON.stringify(artifact) } };
    } else { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(result));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  try { return await work(`http://127.0.0.1:${server.address().port}`, calls); }
  finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}

test('CLI options and explicitly selected JSON manifests are bounded and reject malformed input', async () => {
  assert.deepEqual({ ...parseOptions(['--agent', 'story-seed', '--model', MODEL], ['--agent', '--model']) }, { '--agent': 'story-seed', '--model': MODEL });
  assert.throws(() => parseOptions(['--agent', 'story-seed', '--agent', 'other'], ['--agent']), /once/);
  assert.throws(() => parseOptions(['--code', 'evil'], ['--agent']), /supported/);
  const directory = await mkdtemp(join(tmpdir(), 'optimai-agent-manifest-'));
  try {
    await writeFile(join(directory, 'huge.json'), ' '.repeat(65537));
    await assert.rejects(readAgentManifest(join(directory, 'huge.json')), /64 KiB/);
    await writeFile(join(directory, 'bad.json'), 'private malformed text');
    await assert.rejects(readAgentManifest(join(directory, 'bad.json')), /^Error: The selected file contains invalid JSON\.$/);
    const manifest = createAgentManifest('story-seed', { id: 'my-agent', title: 'My Agent' });
    await writeFile(join(directory, 'agent.json'), JSON.stringify(manifest));
    assert.deepEqual(await readAgentManifest(join(directory, 'agent.json')), manifest);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('scaffold CLI accepts default and explicit templates while rejecting incomplete or unexpected arguments', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'optimai-agent-create-cli-'));
  try {
    const execute = (args) => command('scripts/create.mjs', args, undefined, undefined, directory);
    for (const [args, templateId] of [[['my-story'], 'story-seed'], [['my-grid', '--template', 'image-grid'], 'image-grid']]) {
      const result = await execute(args);
      assert.equal(result.code, 0, result.stderr);
      const manifest = await readAgentManifest(join(directory, 'agents', args[0], 'agent.json'));
      assert.equal(manifest.id, args[0]);
      assert.equal(manifest.recipe.templateId, templateId);
      const verified = await command('scripts/verify.mjs', [join(directory, 'agents', args[0], 'agent.json')]);
      assert.equal(verified.code, 0, verified.stderr);
      assert.match(verified.stdout, new RegExp(`Validated ${args[0]} \\(${templateId}\\)`));
    }
    for (const args of [[], ['invalid', '--unknown', 'story-seed'], ['invalid', '--template'], ['invalid', '--template', 'story-seed', 'extra'], ['invalid', '--template', 'unknown']]) {
      const result = await execute(args);
      assert.notEqual(result.code, 0);
      assert.match(result.stderr, /Usage:|Unknown template:/);
    }
    assert.deepEqual((await readdir(join(directory, 'agents'))).sort(), ['my-grid', 'my-story']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('standalone CLI runs a real SDK pipeline from a manifest against a controlled loopback provider', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'optimai-agent-cli-'));
  try {
    const manifest = createAgentManifest('story-seed', { id: 'cloud-story', title: 'Cloud Story', brief: 'A lost cloud finds a friend.' });
    const path = join(directory, 'agent.json'); await writeFile(path, JSON.stringify(manifest));
    await mockOllama(async (baseUrl, calls) => {
      const result = await command('scripts/run.mjs', ['--manifest', path, '--model', MODEL, '--brief', 'Keep the ending hopeful.'], baseUrl);
      assert.equal(result.code, 0, result.stderr);
      const artifact = JSON.parse(result.stdout);
      assert.equal(artifact.templateId, 'story-seed'); assert.equal(artifact.provider, 'ollama'); assert.equal(artifact.sections.length, 5);
      assert.match(artifact.studioPrompt, /A lost cloud finds a friend/); assert.match(artifact.studioPrompt, /hopeful/);
      assert.ok(calls.some((call) => call.path === '/api/chat'));
      assert.ok(calls.every((call) => !/pull|create|delete/.test(call.path)));
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('smoke CLI verifies all five writers sequentially and writes only an explicitly requested fresh report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'optimai-agent-smoke-'));
  try {
    await mockOllama(async (baseUrl, calls) => {
      const path = join(directory, 'report.json');
      const result = await command('scripts/smoke.mjs', ['--model', MODEL, '--report', path], baseUrl);
      assert.equal(result.code, 0, result.stderr);
      const report = JSON.parse(await readFile(path, 'utf8'));
      assert.equal(report.success, true); assert.equal(report.agentCount, 5); assert.equal(report.results.length, 5);
      assert.deepEqual(JSON.parse(result.stdout), report);
      assert.equal(calls.filter((call) => call.path === '/api/chat').length, 5);
      const count = calls.length;
      const again = await command('scripts/smoke.mjs', ['--model', MODEL, '--report', path], baseUrl);
      assert.notEqual(again.code, 0); assert.match(again.stderr, /never overwritten/); assert.equal(calls.length, count);
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('CLI requires explicit model selection and rejects unsafe remote endpoints before requesting inference', async () => {
  const missing = await command('scripts/run.mjs', ['--agent', 'story-seed']);
  assert.notEqual(missing.code, 0); assert.match(missing.stderr, /installed --model/);
  const remote = await command('scripts/run.mjs', ['--agent', 'story-seed', '--model', MODEL], 'https://example.com');
  assert.notEqual(remote.code, 0); assert.equal(JSON.parse(remote.stderr).error.code, 'unsafe-endpoint');
});
test('MCP writing execution uses host-only Ollama configuration and returns the actual artifact', async () => {
  await mockOllama(async (baseUrl) => {
    const messages = [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } } }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'optimai.style-brief', arguments: { execution: 'run', model: MODEL, brief: 'A warm cloud adventure.' } } }];
    const result = await command('src/mcp-server.mjs', [], baseUrl, messages.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
    assert.equal(result.code, 0, result.stderr);
    const responses = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(responses.length, 2); assert.equal(responses[1].result.isError, false);
    assert.equal(responses[1].result.structuredContent.provider, 'ollama'); assert.equal(responses[1].result.structuredContent.sections.length, 6);
  });
});
