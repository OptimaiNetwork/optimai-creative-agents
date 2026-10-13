#!/usr/bin/env node
import { AGENT_CATALOG, validateAgentManifest, verifyRegistry } from '../src/index.mjs';
import { readAgentManifest } from './cli-input.mjs';
const capability = agent => agent.workspace.kind === 'canvas' ? `browser canvas ${agent.workspace.operation}`
  : agent.workspace.kind === 'vision' ? `browser vision ${agent.workspace.operation} (verified on-device model)`
  : agent.workspace.kind === 'writing' ? 'browser writing AI or installed Ollama model'
  : agent.workspace.kind === 'sketch' ? `browser drawing + ${agent.studioMode} Studio guided workflow`
  : ['3d', 'camera'].includes(agent.workspace.kind) ? `interactive browser ${agent.workspace.kind} ${agent.workspace.operation} (host permission controls)`
  : `${agent.studioMode} Studio guided workflow`;
const path = process.argv[2];
try {
  const registry = verifyRegistry();
  if (!registry.success) throw new Error(registry.errors.join('\n'));
  if (path) {
    const result = validateAgentManifest(await readAgentManifest(path));
    if (!result.success) throw new Error(result.errors.join('\n'));
    process.stdout.write(`Validated ${result.manifest.id} (${result.manifest.recipe.templateId}).\n`);
  } else {
    process.stdout.write(`Validated ${registry.count} reviewed agent templates.\n${AGENT_CATALOG.map((agent) => `${agent.id}: ${capability(agent)}`).join('\n')}\n`);
  }
} catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
