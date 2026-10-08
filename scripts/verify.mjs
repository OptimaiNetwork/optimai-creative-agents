#!/usr/bin/env node
import { AGENT_CATALOG, validateAgentManifest, verifyRegistry } from '../src/index.mjs';
import { readAgentManifest } from './cli-input.mjs';
import { CANVAS_LAB_AGENTS } from '../src/canvas-lab.mjs';
const visionAgents = { 'select-and-replace': 'person-cutout', 'motion-pose': 'pose-reference', 'face-performance': 'face-reference' };
const capability = agent => Object.hasOwn(CANVAS_LAB_AGENTS, agent.id) ? `browser canvas ${CANVAS_LAB_AGENTS[agent.id]}`
  : Object.hasOwn(visionAgents, agent.id) ? `browser vision ${visionAgents[agent.id]} (explicit model download)`
  : agent.executionKind === 'local-model' ? 'browser writing AI or installed Ollama model'
  : agent.executionKind === 'browser' ? `browser canvas ${agent.localOperation}` : `${agent.studioMode} Studio guided workflow`;
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
