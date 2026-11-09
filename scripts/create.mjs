#!/usr/bin/env node
import { mkdir, lstat, open, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentManifest, getAgentTemplate } from '../src/index.mjs';
import { STARTER_KIT_LIMITS, fillStarterFile, getStarterKit, listStarterKits, planStarterKit, starterKitVariables } from '../src/starter-kits.mjs';
const args = process.argv.slice(2);
const USAGE = 'Usage: npm run create -- my-agent [--template story-seed], npm run create -- [my-app] --kit poster-app, or npm run create -- --kits. Use a lowercase slug, not a path.';
const SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const sdkRoot = fileURLToPath(new URL('..', import.meta.url));

// A real local folder under the working directory; never a symlink, never an existing entry.
async function outputFolder(parentName, slug) {
  const root = join(process.cwd(), parentName);
  try { await mkdir(root); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const parent = await lstat(root);
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error(`The ${parentName} output directory must be a real local directory, not a symlink.`);
  const directory = join(root, slug);
  try { await mkdir(directory); } catch (error) { throw error.code === 'EEXIST' ? new Error(`${parentName}/${slug} already exists. Choose another name; nothing was overwritten.`) : error; }
  return directory;
}
// Kit templates are bounded text read from the SDK's own kits/ folder.
async function readTemplate(path) {
  const handle = await open(join(sdkRoot, path), 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > STARTER_KIT_LIMITS.fileBytes) throw new Error(`${path} is not a kit file of at most ${STARTER_KIT_LIMITS.fileBytes} bytes.`);
    return await handle.readFile('utf8');
  } finally { await handle.close(); }
}

async function createKit(kitId, slug) {
  const kit = getStarterKit(kitId);
  if (!kit) throw new Error(`Unknown kit: ${kitId}. Choose ${listStarterKits().map(item => item.id).join(', ')}.`);
  const plan = planStarterKit(kit, { name: slug });
  // Fill every file before writing any, so a broken template never leaves half a folder.
  const directory = join(process.cwd(), 'apps', plan.folder);
  const variables = starterKitVariables(kit, { name: plan.folder, sdkPath: relative(directory, sdkRoot).split(sep).join('/') || '.' });
  const files = await Promise.all(plan.files.map(async file => [file.path, fillStarterFile(await readTemplate(file.template), variables)]));
  await outputFolder('apps', plan.folder);
  for (const [path, text] of files) await writeFile(join(directory, path), text, { flag: 'wx' });
  // A browser kit's import map reaches into the SDK, so serve a folder that holds both. Never suggest serving a whole disk.
  const sdkInside = !relative(process.cwd(), sdkRoot).startsWith('..');
  const start = kit.runtime === 'node' ? `cd apps/${plan.folder} && npm install && npm start`
    : sdkInside ? `python3 -m http.server 8080 --bind 127.0.0.1, then open http://127.0.0.1:8080/${relative(process.cwd(), directory).split(sep).join('/')}/`
      : `serve a folder that contains both apps/${plan.folder} and the SDK at ${sdkRoot} (or run npm run create inside the SDK folder), then open the kit's folder.`;
  process.stdout.write(`Created apps/${plan.folder}/ from the ${kit.title} kit (${files.length} files). Nothing was installed or published.\nRun it: ${start}\nSee apps/${plan.folder}/README.md.\n`);
}

try {
  if (args.length === 1 && args[0] === '--kits') {
    for (const kit of listStarterKits()) process.stdout.write(`${kit.id.padEnd(20)} ${kit.runtime.padEnd(8)} ${kit.summary}\n`);
  } else if ((args.length === 2 && args[0] === '--kit') || (args.length === 3 && args[1] === '--kit')) {
    const [slug, kitId] = args.length === 2 ? [args[1], args[1]] : [args[0], args[2]];
    if (!kitId || kitId.startsWith('--') || !SLUG.test(slug) || slug.length > 64) throw new Error(USAGE);
    await createKit(kitId, slug);
  } else {
    const [slug, flag, requestedTemplate] = args;
    const supportedArgs = args.length === 1 || (args.length === 3 && flag === '--template' && requestedTemplate);
    if (!supportedArgs || !slug || !SLUG.test(slug) || slug.length > 64) throw new Error(USAGE);
    const templateId = requestedTemplate ?? 'story-seed';
    if (!getAgentTemplate(templateId)) throw new Error(`Unknown template: ${templateId}. Run npm run verify to inspect the kit.`);
    const directory = await outputFolder('agents', slug);
    const manifest = createAgentManifest(templateId, { id: slug, title: slug.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join(' '), brief: 'Describe the creative outcome for this agent.' });
    await writeFile(join(directory, 'agent.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
    await writeFile(join(directory, 'README.md'), `# ${manifest.title}\n\nA bounded OptimAI agent recipe based on ${templateId}. Edit agent.json, then validate it from the starter repository root with:\n\n\`node scripts/verify.mjs agents/${slug}/agent.json\`\n\nValidation and prompt preparation need no model. To generate writing, the host can use the browser writer after an explicit model download or an explicitly selected model already installed in a local Ollama service. See docs/runtimes.md in the starter repository for setup.\n\nImport the JSON in the local AI Agents builder for a preview. No executable scripts, arbitrary network permissions or secrets belong in this recipe. You can share the public recipe source on GitHub; community catalog placement is a separate review process and is not available in this release.\n`, { flag: 'wx' });
    process.stdout.write(`Created agents/${slug}/agent.json. Nothing was published.\n`);
  }
} catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
