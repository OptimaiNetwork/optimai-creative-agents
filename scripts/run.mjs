#!/usr/bin/env node
import { runCreativeAgent } from '../src/agent-runtime.mjs';
import { parseOptions, readAgentManifest, reportFailure } from './cli-input.mjs';

const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: npm run run -- --agent story-seed --model installed-model --brief "Public creative idea"\n       npm run run -- --manifest agents/my-agent/agent.json --model installed-model [--brief "Extra direction"]\nEndpoint: OPTIMAI_OLLAMA_URL (loopback HTTP only; default http://127.0.0.1:11434). No model is installed automatically.\n');
  } else {
    const options = parseOptions(args, ['--agent', '--manifest', '--model', '--brief']);
    if (!options['--model'] || (!!options['--agent'] === !!options['--manifest'])) throw new Error('Choose exactly one --agent or --manifest, and explicitly select an installed --model. Use --help for examples.');
    const manifest = options['--manifest'] ? await readAgentManifest(options['--manifest']) : null;
    const result = await runCreativeAgent({
      templateId: manifest?.recipe.templateId ?? options['--agent'],
      values: manifest?.recipe.values ?? {},
      brief: [manifest?.recipe.brief, options['--brief']].filter(Boolean).join('\n'),
      model: options['--model'],
      baseUrl: process.env.OPTIMAI_OLLAMA_URL,
      signal: controller.signal,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
} catch (problem) { reportFailure(problem); }
