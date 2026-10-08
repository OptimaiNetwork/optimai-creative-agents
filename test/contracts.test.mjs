import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { AGENT_CATALOG, AGENT_MANIFEST_SCHEMA, getAgentTemplate, getAgentExecutionKind, createAgentManifest, validateAgentManifest, compileAgentPrompt, TOOL_CATALOG, TOOL_MANIFEST_SCHEMA, MAX_PROMPT_LENGTH, getToolTemplate, createToolManifest, validateToolManifest, validateRecipeValues, compileToolPrompt, verifyRegistry } from '../src/index.mjs';
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
function manifest(id = 'my-tool', templateId = 'story-seed') { return createToolManifest(templateId, { id, title: 'My Tool' }); }

test('all 34 original recipes cover the researched function inventory', () => {
  assert.equal(TOOL_CATALOG.length, 34);
  assert.deepEqual(Object.fromEntries(['image', 'video', 'writing', 'experimental'].map((category) => [category, TOOL_CATALOG.filter((tool) => tool.category === category).length])), { image: 8, video: 10, writing: 5, experimental: 11 });
  assert.equal(new Set(TOOL_CATALOG.map((tool) => tool.sourceTemplate)).size, 34);
  assert.deepEqual(verifyRegistry(), { success: true, errors: [], count: 34 });
  assert.ok(Object.isFrozen(TOOL_CATALOG));
  assert.ok(TOOL_CATALOG.every((tool) => tool.title !== tool.sourceTemplate));
});
test('primary Agent API preserves saved v1 Tool recipes and truthful execution kinds', async () => {
  assert.equal(AGENT_CATALOG, TOOL_CATALOG);
  assert.equal(getAgentTemplate, getToolTemplate);
  assert.equal(createAgentManifest, createToolManifest);
  assert.equal(validateAgentManifest, validateToolManifest);
  assert.equal(compileAgentPrompt, compileToolPrompt);
  assert.deepEqual(Object.fromEntries(['browser', 'local-model', 'studio-guided'].map((kind) => [kind, AGENT_CATALOG.filter((agent) => getAgentExecutionKind(agent.id) === kind).length])), { browser: 4, 'local-model': 5, 'studio-guided': 25 });
  const old = manifest();
  assert.equal(validateAgentManifest(old).success, true);
  assert.equal(compileAgentPrompt(old), compileToolPrompt(old));
  const saved = JSON.parse(await readFile(join(packageRoot, 'schema/agent-manifest.schema.json'), 'utf8'));
  assert.deepEqual(saved, AGENT_MANIFEST_SCHEMA);
  assert.deepEqual(saved.properties, TOOL_MANIFEST_SCHEMA.properties);
  assert.deepEqual(saved.allOf, TOOL_MANIFEST_SCHEMA.allOf);
  assert.equal(getAgentExecutionKind('unknown'), undefined);
});
test('every recipe round-trips through the versioned contract and compiles defaults', () => {
  for (const tool of TOOL_CATALOG) {
    const value = manifest(tool.id, tool.id);
    value.recipe.values = Object.fromEntries(tool.fields.map((field) => [field.id, field.default]));
    const result = validateToolManifest(JSON.parse(JSON.stringify(value)));
    assert.equal(result.success, true, result.errors.join('\n'));
    const prompt = compileToolPrompt(result.manifest, {}, 'An original adventure.');
    assert.ok(prompt.length < MAX_PROMPT_LENGTH);
    assert.ok(!prompt.includes('{{'));
    assert.ok(prompt.includes('An original adventure.'));
    assert.ok(prompt.includes('generation and credit confirmation remain in the host'));
  }
});
test('unexpected executable code, remote sources and extra privileges are rejected', () => {
  for (const bad of [
    { ...manifest(), script: 'process.exit()' },
    { ...manifest(), remoteUrl: 'https://example.com/code.js' },
    { ...manifest(), capabilities: { network: 'all', execution: 'declarative', dataAccess: 'selected-inputs' } },
    { ...manifest(), recipe: { templateId: 'story-seed', values: {}, brief: '', code: 'eval()' } },
    { ...manifest(), recipe: { templateId: 'unreviewed-code', values: {}, brief: '' } },
    { ...manifest(), recipe: { templateId: 'story-seed', values: { secret: 'do not read' }, brief: '' } },
  ]) assert.equal(validateToolManifest(bad).success, false);
});
test('prototype pollution, inherited objects, accessors, symbols and circular input are rejected without invoking accessors', () => {
  let invoked = false;
  const getter = manifest();
  Object.defineProperty(getter, 'title', { enumerable: true, get() { invoked = true; return 'Unsafe'; } });
  assert.equal(validateToolManifest(getter).success, false);
  assert.equal(invoked, false);
  assert.equal(validateToolManifest(JSON.parse('{"__proto__":{"polluted":true}}')).success, false);
  assert.equal(validateToolManifest(Object.create(manifest())).success, false);
  const symbol = manifest(); symbol[Symbol('hidden')] = 1;
  assert.equal(validateToolManifest(symbol).success, false);
  const circular = manifest(); circular.recipe.values.loop = circular;
  assert.equal(validateToolManifest(circular).success, false);
  assert.equal({}.polluted, undefined);
  assert.throws(() => compileToolPrompt({ get id() { invoked = true; return 'story-seed'; } }), /Unknown/);
  assert.equal(invoked, false);
});
test('size limits, colors, select values and finite integer ranges are enforced', () => {
  assert.ok(validateRecipeValues('image-finish', { intensity: NaN }).length);
  assert.ok(validateRecipeValues('image-finish', { intensity: 101 }).length);
  assert.ok(validateRecipeValues('image-grid', { columns: 1.2 }).length);
  assert.ok(validateRecipeValues('mockup-maker', { background: 'url(https://example.com)' }).length);
  assert.ok(validateRecipeValues('style-brief', { style: 'anything' }).length);
  const value = manifest(); value.recipe.brief = 'a'.repeat(4001);
  assert.equal(validateToolManifest(value).success, false);
  assert.throws(() => compileToolPrompt('story-seed', {}, 'a'.repeat(4001)), /4000/);
  assert.throws(() => compileToolPrompt('story-seed', { title: 'unsupported' }), /no such setting/);
});
test('compiled prompts ignore a supplied executable or substituted template', () => {
  const supplied = { id: 'image-finish', promptTemplate: 'RUN SECRET EXFILTRATION', runtime: 'remote' };
  const prompt = compileToolPrompt(supplied, { preset: 'noir' });
  assert.ok(prompt.includes('noir'));
  assert.ok(!prompt.includes('EXFILTRATION'));
  const text = compileToolPrompt('story-seed', {}, '\"} ${process.env.SECRET} <script>evil</script>');
  assert.ok(text.includes('process.env.SECRET'));
  assert.ok(text.includes('\\\"'));
});
test('validation returns a detached value and enforces category/version/slug constraints', () => {
  const original = manifest();
  const result = validateToolManifest(original);
  result.manifest.recipe.brief = 'changed';
  assert.equal(original.recipe.brief, '');
  for (const [key, value] of [['schemaVersion', '2.0'], ['version', 'dev'], ['id', '../../private'], ['category', 'image'], ['title', '   ']]) assert.equal(validateToolManifest({ ...original, [key]: value }).success, false);
});
test('checked-in schema is identical to generated schema and rejects unknown properties structurally', async () => {
  const saved = JSON.parse(await readFile(join(packageRoot, 'schema/tool-manifest.schema.json'), 'utf8'));
  assert.deepEqual(saved, TOOL_MANIFEST_SCHEMA);
  assert.equal(saved.additionalProperties, false);
  assert.equal(saved.properties.recipe.oneOf.length, 34);
  assert.ok(saved.properties.recipe.oneOf.every((recipe) => recipe.additionalProperties === false && recipe.properties.values.additionalProperties === false));
});
test('scaffolding only writes a fresh bounded local recipe directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'optimai-tools-scaffold-'));
  try {
    const execute = (args) => spawnSync(process.execPath, [join(packageRoot, 'scripts/create.mjs'), ...args], { cwd: directory, encoding: 'utf8' });
    assert.equal(execute(['my-story']).status, 0);
    const created = JSON.parse(await readFile(join(directory, 'agents/my-story/agent.json'), 'utf8'));
    assert.equal(validateToolManifest(created).success, true);
    assert.notEqual(execute(['my-story']).status, 0, 'existing recipe is never overwritten');
    assert.notEqual(execute(['../escape']).status, 0);
    assert.notEqual(execute(['other', '--template', 'unknown']).status, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('scaffolding rejects a symlink output root', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'optimai-tools-symlink-'));
  try {
    await mkdir(join(directory, 'elsewhere'));
    await symlink(join(directory, 'elsewhere'), join(directory, 'agents'));
    const result = spawnSync(process.execPath, [join(packageRoot, 'scripts/create.mjs'), 'my-tool'], { cwd: directory, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /symlink/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('core stays dependency-free and browser peers are optional, pinned and isolated from proprietary host imports', async () => {
  const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.private, true);
  assert.equal(pkg.name, '@optimai/creative-agents');
  assert.equal(pkg.dependencies, undefined);
  assert.deepEqual(pkg.peerDependencies, { '@mlc-ai/web-llm': '0.2.85', '@mediapipe/tasks-vision': '1.1.0' });
  for (const name of Object.keys(pkg.peerDependencies)) assert.equal(pkg.peerDependenciesMeta[name]?.optional, true);
  for (const [name, target] of Object.entries(pkg.exports)) {
    const paths = typeof target === 'string' ? [target] : Object.values(target);
    for (const pathname of paths) {
      assert.ok(pathname.startsWith('./src/') || pathname.startsWith('./schema/'), `Export ${name} must stay within the kit.`);
      await readFile(join(packageRoot, pathname));
    }
  }
  assert.equal(getToolTemplate('unknown'), undefined);
  for (const file of ['index.mjs', 'catalog.mjs', 'mcp-server.mjs']) {
    const content = await readFile(join(packageRoot, 'src', file), 'utf8');
    assert.ok(!content.includes('fetch('));
    assert.ok(!content.includes('eval('));
    assert.ok(!content.includes('new Function'));
    assert.ok(!content.includes('frontend/'));
  }
  for (const file of ['canvas-lab.mjs', 'browser-writing-runtime.mjs', 'browser-writing-worker.mjs', 'vision-runtime.mjs', 'vision-processor.mjs']) {
    const content = await readFile(join(packageRoot, 'src', file), 'utf8');
    assert.ok(!/frontend\/|backend\/|\.\.\/\.\.\/|eval\(|new Function/.test(content), `${file} cannot import proprietary host code or evaluate recipes.`);
  }
});
