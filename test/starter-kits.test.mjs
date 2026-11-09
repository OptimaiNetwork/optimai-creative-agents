import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getAgentTemplate } from '../src/index.mjs';
import { STARTER_KITS, STARTER_KIT_LIMITS, STARTER_KIT_PLACEHOLDERS, fillStarterFile, getStarterKit, listStarterKits, planStarterKit, starterKitCommand, starterKitImportMap, starterKitName, starterKitVariables } from '../src/starter-kits.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const read = path => readFile(join(root, path), 'utf8');
const specifier = subpath => subpath === '.' ? pkg.name : `${pkg.name}/${subpath}`;
const importsOf = text => [...text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(@optimai\/creative-agents[^']*)'/g)].map(([, names, from]) => ({ from, names: names.split(',').map(name => name.trim()).filter(Boolean) }));

function run(args, cwd, stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Subprocess timed out.')); }, 15000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.end(stdin);
  });
}
const create = (args, cwd) => run([join(root, 'scripts/create.mjs'), ...args], cwd);

test('the catalog offers the four kits, each built on real agents and public subpaths', async () => {
  assert.deepEqual(listStarterKits().map(kit => kit.id), ['poster-app', 'music-visualizer', 'camera-filter', 'mcp-creative-server']);
  assert.deepEqual(listStarterKits({ runtime: 'node' }).map(kit => kit.id), ['mcp-creative-server']);
  assert.equal(getStarterKit('nope'), undefined);
  assert.ok(Object.isFrozen(STARTER_KITS[0].files), 'The catalog is deeply frozen.');
  for (const kit of STARTER_KITS) {
    for (const id of kit.agents) assert.ok(getAgentTemplate(id), `${kit.id} uses catalog agent ${id}.`);
    for (const subpath of kit.subpaths) assert.ok(Object.hasOwn(pkg.exports, subpath === '.' ? '.' : `./${subpath}`), `${kit.id}: ${subpath} is a public subpath.`);
    assert.ok(kit.files.includes('README.md') && kit.files.includes('package.json') && kit.files.length <= STARTER_KIT_LIMITS.files);
    assert.deepEqual((await readdir(join(root, 'kits', kit.id))).sort(), [...kit.files].sort(), `kits/${kit.id} holds exactly its listed files.`);
    for (const file of kit.files) assert.ok((await stat(join(root, 'kits', kit.id, file))).size <= STARTER_KIT_LIMITS.fileBytes);
  }
});

test('kit code imports only the subpaths it lists, by package name, and every imported name exists', async () => {
  for (const kit of STARTER_KITS) {
    const used = new Set();
    for (const file of kit.files.filter(file => file.endsWith('.mjs'))) {
      const text = await read(`kits/${kit.id}/${file}`);
      assert.doesNotMatch(text, /from\s*'\.\.?\//, `${kit.id}/${file} imports the SDK by name, not by relative path.`);
      assert.doesNotMatch(text, /\bfetch\(|eval\(|new Function|https?:\/\/(?!127\.0\.0\.1)/, `${kit.id}/${file} makes no network calls.`);
      for (const { from, names } of importsOf(text)) {
        const subpath = from === pkg.name ? '.' : from.slice(pkg.name.length + 1);
        assert.ok(kit.subpaths.includes(subpath), `${kit.id}/${file} imports ${from}, which the kit lists.`);
        used.add(subpath);
        const module = await import(from);
        for (const name of names) assert.ok(name in module, `${from} exports ${name}.`);
      }
    }
    assert.deepEqual([...used].sort(), [...kit.subpaths].sort(), `${kit.id} lists exactly the subpaths it uses.`);
  }
});

test('templates fill completely: valid JSON, an import map that reaches the SDK, and no placeholder left', async () => {
  for (const kit of STARTER_KITS) {
    const variables = starterKitVariables(kit, { name: 'my-app', sdkPath: '../..' });
    assert.equal(variables.TITLE, 'My App');
    for (const file of kit.files) {
      const template = await read(`kits/${kit.id}/${file}`);
      for (const [, key] of template.matchAll(/\{\{([A-Z_]+)\}\}/g)) assert.ok(STARTER_KIT_PLACEHOLDERS.includes(key), `${kit.id}/${file} uses a known placeholder.`);
      const filled = fillStarterFile(template, variables);
      assert.doesNotMatch(filled, /\{\{|\}\}/);
      if (file === 'package.json') {
        const manifest = JSON.parse(filled);
        assert.equal(manifest.name, 'my-app');
        assert.deepEqual(manifest.dependencies, { [pkg.name]: 'file:../..' }, 'The only dependency is the local SDK folder.');
      }
      if (file === 'index.html') {
        const map = JSON.parse(filled.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]);
        assert.deepEqual(map, starterKitImportMap(kit, '../..'));
        assert.deepEqual(Object.keys(map.imports).sort(), kit.subpaths.map(specifier).sort());
        // A kit at <sdk>/apps/my-app resolves each entry to the module the package exports.
        const page = pathToFileURL(join(root, 'apps/my-app/index.html'));
        for (const [name, target] of Object.entries(map.imports)) assert.equal(fileURLToPath(new URL(target, page)), fileURLToPath(import.meta.resolve(name)));
      }
    }
    assert.equal(kit.runtime === 'browser', kit.files.includes('index.html'));
  }
});

test('names, SDK paths and placeholders are checked before anything is written', () => {
  assert.equal(starterKitCommand('poster-app'), 'npm run create -- --kit poster-app');
  assert.equal(starterKitCommand(getStarterKit('camera-filter'), 'my-lens'), 'npm run create -- my-lens --kit camera-filter');
  assert.deepEqual(planStarterKit('mcp-creative-server', { name: 'studio-tools' }), { kit: getStarterKit('mcp-creative-server'), folder: 'studio-tools', files: [{ path: 'README.md', template: 'kits/mcp-creative-server/README.md' }, { path: 'package.json', template: 'kits/mcp-creative-server/package.json' }, { path: 'server.mjs', template: 'kits/mcp-creative-server/server.mjs' }] });
  assert.equal(planStarterKit('poster-app').folder, 'poster-app');
  for (const name of ['../x', 'My-App', 'a/b', '', 'x'.repeat(65), 'trailing-']) assert.throws(() => starterKitName(name), /lowercase hyphenated/);
  for (const sdkPath of ['/abs/sdk', 'https://cdn.example/sdk', '..\\sdk', "../a'b", '../a"b', '../', '', '..//x', 'C:/sdk']) assert.throws(() => starterKitVariables('poster-app', { sdkPath }), /relative folder/, sdkPath);
  for (const sdkPath of ['.', '..', '../..', '../vendor/optimai-agents', 'node_modules/@optimai/creative-agents']) assert.equal(starterKitVariables('poster-app', { sdkPath }).SDK_PATH, sdkPath);
  assert.equal(starterKitVariables('mcp-creative-server', { sdkPath: '../..' }).IMPORT_MAP, '', 'Node kits have no import map.');
  assert.throws(() => fillStarterFile('{{SECRET}}', { SECRET: 'x' }), /\{\{SECRET\}\}/);
  assert.throws(() => fillStarterFile('{{NAME}}', {}), /has no value/);
  assert.throws(() => fillStarterFile('x'.repeat(STARTER_KIT_LIMITS.fileBytes + 1), {}), /at most/);
  assert.equal(fillStarterFile('{{NAME}} is {{NAME}}', { NAME: 'a' }), 'a is a');
  assert.throws(() => planStarterKit('nope'), /Unknown starter kit/);
});

test('create --kit writes a runnable folder, refuses to overwrite it and lists the kits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'optimai-agent-kit-cli-'));
  try {
    const listed = await create(['--kits'], directory);
    assert.equal(listed.code, 0, listed.stderr);
    for (const kit of STARTER_KITS) assert.match(listed.stdout, new RegExp(`^${kit.id} `, 'm'));
    const made = await create(['--kit', 'poster-app'], directory);
    assert.equal(made.code, 0, made.stderr);
    assert.match(made.stdout, /Created apps\/poster-app\/ .*5 files.*Nothing was installed or published/s);
    // Made outside the SDK folder, the hint names both folders instead of serving a whole disk.
    assert.match(made.stdout, /Run it: serve a folder that contains both apps\/poster-app and the SDK at /);
    assert.doesNotMatch(made.stdout, /--directory/);
    const html = await readFile(join(directory, 'apps/poster-app/index.html'), 'utf8');
    const page = pathToFileURL(join(directory, 'apps/poster-app/index.html'));
    for (const [name, target] of Object.entries(JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports)) {
      assert.equal(fileURLToPath(new URL(target, page)), fileURLToPath(import.meta.resolve(name)), 'The import map reaches this SDK from wherever the kit was made.');
    }
    const named = await create(['my-lens', '--kit', 'camera-filter'], directory);
    assert.equal(named.code, 0, named.stderr);
    assert.match(await readFile(join(directory, 'apps/my-lens/README.md'), 'utf8'), /^# My Lens\n/);
    await writeFile(join(directory, 'apps/poster-app/app.mjs'), '// mine\n');
    const again = await create(['--kit', 'poster-app'], directory);
    assert.notEqual(again.code, 0);
    assert.match(again.stderr, /apps\/poster-app already exists/);
    assert.equal(await readFile(join(directory, 'apps/poster-app/app.mjs'), 'utf8'), '// mine\n', 'An existing kit folder is never overwritten.');
    for (const args of [['--kit', 'nope'], ['my-app', '--kit', 'nope'], ['--kit'], ['../x', '--kit', 'poster-app'], ['--kit', 'poster-app', 'extra'], ['--kits', 'extra']]) {
      const result = await create(args, directory);
      assert.notEqual(result.code, 0, args.join(' '));
      assert.match(result.stderr, /Usage:|Unknown kit: nope\. Choose poster-app/);
    }
    assert.deepEqual((await readdir(join(directory, 'apps'))).sort(), ['my-lens', 'poster-app'], 'Failed commands leave no folders behind.');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('the MCP kit runs as a real stdio server against the linked SDK', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'optimai-agent-kit-mcp-'));
  try {
    assert.equal((await create(['studio-tools', '--kit', 'mcp-creative-server'], directory)).code, 0);
    const app = join(directory, 'apps/studio-tools');
    // What `npm install` does for the kit's only (file:) dependency: a link to the SDK folder.
    await mkdir(join(app, 'node_modules/@optimai'), { recursive: true });
    await symlink(root, join(app, 'node_modules/@optimai/creative-agents'), 'dir');
    const messages = [
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 3, method: 'tools/list' },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'poster_lab', arguments: { values: { title: 'Jazz night', color: '#ff9b71' }, brief: 'A late-night jazz poster.' } } },
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'poster_lab', arguments: { values: { color: 'orange' } } } },
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'glitch_cut', arguments: {} } },
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'story_seed', arguments: { values: {}, model: 'x' } } },
      { jsonrpc: '2.0', id: 8, method: 'resources/list' },
    ];
    const result = await run([join(app, 'server.mjs')], app, `${messages.map(message => JSON.stringify(message)).join('\n')}\nnot json\n`);
    assert.equal(result.stderr, '');
    const replies = result.stdout.trim().split('\n').map(line => JSON.parse(line));
    const byId = Object.fromEntries(replies.filter(reply => reply.id != null).map(reply => [reply.id, reply]));
    assert.match(byId[1].error.message, /initialize/, 'Tools wait for the handshake.');
    assert.deepEqual(byId[2].result.serverInfo, { name: 'studio-tools', version: '0.1.0' });
    const tools = byId[3].result.tools;
    assert.deepEqual(tools.map(tool => tool.name), ['poster_lab', 'story_seed', 'image_grid']);
    assert.ok(tools.every(tool => tool.annotations.readOnlyHint && tool.inputSchema.properties.values.additionalProperties === false));
    assert.equal(tools[0].inputSchema.properties.values.properties.color.pattern != null, true, 'Settings carry the form schema bounds.');
    const recipe = byId[4].result.structuredContent;
    assert.equal(byId[4].result.isError, false);
    assert.equal(recipe.templateId, 'poster-lab');
    assert.equal(recipe.values.title, 'Jazz night');
    assert.equal(recipe.values.treatment, getAgentTemplate('poster-lab').fields.find(field => field.id === 'treatment').default);
    assert.match(recipe.prompt, /jazz/i);
    assert.equal(byId[5].result.isError, true, 'Invalid settings come back as a tool error the assistant can fix.');
    assert.match(byId[6].error.message, /Unknown tool/);
    assert.match(byId[7].error.message, /values and brief only/);
    assert.equal(byId[8].error.code, -32601);
    assert.equal(replies.at(-1).error.code, -32700);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
