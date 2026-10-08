#!/usr/bin/env node
import { mkdir, lstat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createAgentManifest, getAgentTemplate } from '../src/index.mjs';
const [slug, flag, requestedTemplate] = process.argv.slice(2);
try {
  if (!slug || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 64 || (flag && flag !== '--template') || (flag && !requestedTemplate) || process.argv.length > 5) throw new Error('Usage: npm run create -- my-agent [--template story-seed]. Use a lowercase slug, not a path.');
  const templateId = requestedTemplate ?? 'story-seed';
  if (!getAgentTemplate(templateId)) throw new Error(`Unknown template: ${templateId}. Run npm run verify to inspect the kit.`);
  const root = join(process.cwd(), 'agents');
  try { await mkdir(root); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const parent = await lstat(root);
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error('The agents output directory must be a real local directory, not a symlink.');
  const directory = join(root, slug);
  await mkdir(directory); // Existing agents are never overwritten.
  const manifest = createAgentManifest(templateId, { id: slug, title: slug.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join(' '), brief: 'Describe the creative outcome for this agent.' });
  await writeFile(join(directory, 'agent.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  await writeFile(join(directory, 'README.md'), `# ${manifest.title}\n\nA bounded OptimAI agent recipe based on ${templateId}. Edit agent.json, then validate it with:\n\n\`node scripts/verify.mjs agents/${slug}/agent.json\`\n\nNo executable scripts, arbitrary network permissions or secrets belong in this recipe. Import the JSON in the local AI Agents builder for a preview. Writing agents run only with an explicitly selected installed local model. Publication requires catalog review.\n`, { flag: 'wx' });
  process.stdout.write(`Created agents/${slug}/agent.json. Nothing was published.\n`);
} catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
