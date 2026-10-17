import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { AGENT_CATALOG, AGENT_WORKSPACE_CONTRACT_VERSION } from '../src/index.mjs';

// Living documents must describe the catalog that actually ships. Dated
// release notes are history and are intentionally not checked here.
const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const kinds = agent => agent.workspace.kind;
const count = (...names) => AGENT_CATALOG.filter(agent => names.includes(kinds(agent))).length;
const groups = { canvas: count('canvas'), vision: count('vision'), writing: count('writing'), interactive: count('3d', 'camera', 'music', 'frame'), guided: count('workflow', 'sketch') };

test('the five capability groups cover every catalog template exactly once', () => {
  assert.equal(Object.values(groups).reduce((sum, value) => sum + value, 0), AGENT_CATALOG.length);
});

test('living docs state the shipped template count, version and capability groups', async () => {
  const pkg = JSON.parse(await read('package.json'));
  // Whole-catalog phrasing only; section counts such as "These 14 templates" are checked below.
  const pattern = /(?:\b[Aa]ll |Validated |has \*\*|contains \*\*|contains )(\d+) (?:reviewed )?(?:agent )?(?:templates|template names|recipes|IDs)\b/g;
  for (const path of ['README.md', 'docs/README.md', 'docs/catalog.md', 'docs/quickstart.md', 'docs/mcp.md']) {
    const text = await read(path);
    const stated = [...text.matchAll(pattern)].map(match => Number(match[1]));
    assert.ok(stated.length, `${path} states the catalog size.`);
    for (const value of stated) assert.equal(value, AGENT_CATALOG.length, `${path} says ${value} templates; the catalog has ${AGENT_CATALOG.length}.`);
  }
  const readme = await read('README.md');
  assert.match(readme, new RegExp(`Version \`${pkg.version.replaceAll('.', '\\.')}\``), 'README names the package version.');
  const table = Object.fromEntries([...readme.matchAll(/^\| (Canvas processing|Browser vision|Local writing|Interactive[^|]*|Guided Studio workflows) \| (\d+) \|/gm)].map(match => [match[1].split(' ')[0], Number(match[2])]));
  assert.deepEqual(table, { Canvas: groups.canvas, Browser: groups.vision, Local: groups.writing, Interactive: groups.interactive, Guided: groups.guided });
  assert.match(await read('docs/catalog.md'), new RegExp(`${groups.canvas} canvas, ${groups.vision} browser vision, ${groups.writing} writing, ${groups.interactive} interactive and ${groups.guided} guided`));
  for (const agent of AGENT_CATALOG) assert.ok((await read('docs/catalog.md')).includes(`\`${agent.id}\``), `docs/catalog.md lists ${agent.id}.`);
  assert.ok((await read('docs/release-and-feature.md')).includes(`## SDK ${pkg.version}`), 'Release notes describe the current version.');
  assert.ok((await read('docs/MUSIC-MOTION.md')).includes(`contract ${AGENT_WORKSPACE_CONTRACT_VERSION}`));
});

test('the changelog has an Unreleased section and a section for the current version', async () => {
  const pkg = JSON.parse(await read('package.json'));
  const changelog = await read('CHANGELOG.md');
  assert.match(changelog, /^## Unreleased$/m);
  assert.match(changelog, new RegExp(`^## ${pkg.version.replaceAll('.', '\\.')} — \\d{4}-\\d{2}-\\d{2}$`, 'm'));
});
