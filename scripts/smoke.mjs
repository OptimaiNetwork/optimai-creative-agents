#!/usr/bin/env node
import { lstat, writeFile } from 'node:fs/promises';
import { AGENT_CATALOG } from '../src/index.mjs';
import { runCreativeAgent } from '../src/agent-runtime.mjs';
import { parseOptions, reportFailure } from './cli-input.mjs';

const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: npm run smoke -- --model installed-model [--report /path/to/new-report.json]\nRuns the five writing agents sequentially with public test briefs and default settings. Endpoint: OPTIMAI_OLLAMA_URL (loopback HTTP only). No installation or publishing.\n');
  } else {
    const options = parseOptions(args, ['--model', '--report']);
    if (!options['--model']) throw new Error('Explicitly select an installed --model. Use --help for examples.');
    if (options['--report']) {
      if (!/\.json$/i.test(options['--report'])) throw new Error('Use a new .json file for the smoke report.');
      try { await lstat(options['--report']); throw new Error('The report already exists. Choose a new path; reports are never overwritten.'); } catch (problem) { if (problem.code !== 'ENOENT') throw problem; }
    }
    const agents = AGENT_CATALOG.filter((agent) => agent.executionKind === 'local-model');
    const results = [];
    for (const agent of agents) {
      const started = Date.now();
      const artifact = await runCreativeAgent({ templateId: agent.id, values: {}, brief: 'A curious young explorer helps a lost cloud find its way home. Develop an original, warm, all-ages creative direction with clear practical details.', model: options['--model'], baseUrl: process.env.OPTIMAI_OLLAMA_URL, signal: controller.signal });
      // The shared runtime validates exact section counts, headings and bounded
      // plain-text content before returning; this also verifies artifact identity.
      if (artifact.provider !== 'ollama' || artifact.templateId !== agent.id || artifact.model !== options['--model'] || !artifact.sections.length || !artifact.title.trim() || !artifact.studioPrompt.trim()) throw new Error(`Smoke verification failed for ${agent.id}.`);
      results.push({ agentId: agent.id, elapsedMs: Date.now() - started, artifact });
      process.stderr.write(`Verified ${agent.title}.\n`);
    }
    const report = { schemaVersion: '1.0', success: true, generatedAt: new Date().toISOString(), provider: 'ollama', model: options['--model'], agentCount: results.length, results };
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (options['--report']) await writeFile(options['--report'], json, { flag: 'wx' });
    process.stdout.write(json);
  }
} catch (problem) { reportFailure(problem); }
