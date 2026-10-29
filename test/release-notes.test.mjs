import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { AGENT_CATALOG } from '../src/index.mjs';
import {
  RELEASE_FILES, buildLlmsTxt, changelogAnchor, checkDate, cutChangelog, declarationNames, localDate, nextVersion,
  parseReleaseArgs, planRelease, readLlmsInputs, releaseHighlights, splitChangelog, suggestBump,
} from '../scripts/release-notes.mjs';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const script = fileURLToPath(new URL('../scripts/release-notes.mjs', import.meta.url));
const cli = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 15000 });

const changelog = `# Changelog\n\nIntro.\n\n## Unreleased\n\n### Added\n\n- **Readable titles.** Details.\n  - Nested detail.\n- **\`@x/color\`.** Module.\n\n### Fixed\n\n- A fix.\n\n## 0.4.0 — 2026-10-14\n\n### Added\n\n- Old.\n`;
const fixture = () => ({
  'package.json': '{\n  "name": "@optimai/creative-agents",\n  "version": "0.4.0",\n  "dependencies": { "x": { "version": "9.9.9" } }\n}\n',
  'CHANGELOG.md': changelog,
  'README.md': 'Intro.\n\nVersion `0.4.0` contains **38 agent templates**.\n',
  'docs/release-and-feature.md': '# Share\n\nText.\n\n## SDK 0.4.0\n\nOld notes.\n\n## SDK 0.3.0\n\nOlder.\n',
});

test('the changelog cut moves Unreleased notes into a dated section and leaves Unreleased empty', () => {
  const cut = cutChangelog(changelog, '0.5.0', '2026-10-24');
  assert.match(cut, /## Unreleased\n\n## 0\.5\.0 — 2026-10-24\n\n### Added\n\n- \*\*Readable titles\.\*\*/);
  assert.equal(splitChangelog(cut).notes, '');
  assert.ok(cut.startsWith('# Changelog\n\nIntro.\n\n'), 'Text above Unreleased is untouched.');
  assert.ok(cut.endsWith('## 0.4.0 — 2026-10-14\n\n### Added\n\n- Old.\n'), 'History is untouched.');
  assert.equal(cut.match(/Nested detail/g).length, 1);
  assert.throws(() => cutChangelog(cut, '0.6.0', '2026-10-25'), /no notes/);
  assert.throws(() => cutChangelog(changelog, '0.4.0', '2026-10-24'), /already has a 0\.4\.0/);
  assert.throws(() => splitChangelog('# Changelog\n'), /Unreleased/);
});

test('versions bump by kind of change and must move forward', () => {
  assert.equal(suggestBump(splitChangelog(changelog).notes), 'minor');
  assert.equal(suggestBump('### Fixed\n\n- A fix.'), 'patch');
  assert.equal(nextVersion('0.4.0', 'minor'), '0.5.0');
  assert.equal(nextVersion('0.4.2', 'patch'), '0.4.3');
  assert.equal(nextVersion('0.4.2', 'major'), '1.0.0');
  assert.equal(nextVersion('0.4.0', '0.10.0'), '0.10.0', 'Numeric, not string, comparison.');
  for (const bad of ['0.4.0', '0.3.9', '1.0', 'v1.0.0', '1.0.0-beta', '../1.0.0']) assert.throws(() => nextVersion('0.4.0', bad));
  assert.equal(checkDate('2028-02-29'), '2028-02-29');
  for (const bad of ['2026-02-30', '2026-13-01', '26-10-24', '2026-10-24T00:00']) assert.throws(() => checkDate(bad));
  assert.equal(localDate(new Date(2026, 0, 5, 23, 30)), '2026-01-05', 'Uses the maintainer’s local calendar day.');
  assert.equal(changelogAnchor('0.5.0', '2026-10-24'), '050--2026-10-24');
});

test('a release plan moves every living version mention together without writing anything', () => {
  const files = fixture(), before = structuredClone(files);
  const plan = planRelease({ files, date: '2026-10-24' });
  assert.deepEqual(files, before, 'Inputs are not mutated.');
  assert.equal(plan.version, '0.5.0');
  assert.deepEqual(plan.highlights, ['Readable titles', '`@x/color`']);
  assert.equal(plan.files['package.json'], before['package.json'].replace('"0.4.0"', '"0.5.0"'), 'Only the top-level version changes; formatting survives.');
  assert.equal(JSON.parse(plan.files['package.json']).dependencies.x.version, '9.9.9');
  assert.match(plan.files['README.md'], /Version `0\.5\.0` contains/);
  const guide = plan.files['docs/release-and-feature.md'];
  assert.ok(guide.indexOf('## SDK 0.5.0') < guide.indexOf('## SDK 0.4.0'), 'Newest release reads first.');
  assert.match(guide, /Released 2026-10-24 with workspace contract \d+\.\d+\. The catalog has 39 templates: 11 canvas, 3 browser vision, 5 writing, 6 interactive and 14 guided entries\./);
  assert.match(guide, /- Readable titles\n- `@x\/color`\n/);
  assert.match(guide, /\(\.\.\/CHANGELOG\.md#050--2026-10-24\)/);
  assert.equal(plan.files['llms.txt'], undefined, 'llms.txt is only planned when its inputs are given.');
  assert.equal(planRelease({ files, bump: 'patch', date: '2026-10-24' }).version, '0.4.1');
});

test('a release plan refuses inconsistent sources before any file would change', () => {
  const broken = { ...fixture(), 'README.md': 'Version `0.3.0`.\n' };
  assert.throws(() => planRelease({ files: broken, date: '2026-10-24' }), /README\.md must state/);
  assert.throws(() => planRelease({ files: { ...fixture(), 'docs/release-and-feature.md': '# Share\n' }, date: '2026-10-24' }), /needs an "## SDK/);
  assert.throws(() => planRelease({ files: fixture(), date: 'today' }), /YYYY-MM-DD/);
  assert.throws(() => planRelease({ files: fixture(), bump: '0.4.0', date: '2026-10-24' }), /newer/);
});

test('release arguments are strict', () => {
  assert.deepEqual(parseReleaseArgs(['minor', '--date', '2026-10-24', '--dry-run']), { dryRun: true, llms: false, check: false, bump: 'minor', date: '2026-10-24' });
  assert.equal(parseReleaseArgs(['--date=2026-10-24']).date, '2026-10-24');
  assert.equal(parseReleaseArgs(['1.2.3']).bump, '1.2.3');
  for (const bad of [['--force'], ['minor', 'patch'], ['latest'], ['--tag']]) assert.throws(() => parseReleaseArgs(bad));
});

test('declaration parsing separates values from types', () => {
  const names = declarationNames('export declare const A: 1;\nexport type B = 1;\nexport interface C {}\nexport declare function d(): void;\nexport declare class E {}\nexport function f(): void;\n  export const nested = 1;\n');
  assert.deepEqual(names, { values: ['A', 'd', 'E', 'f'], types: ['B', 'C'] });
});

test('llms.txt is current and maps every public subpath, guide and template', async () => {
  const inputs = await readLlmsInputs();
  const text = await read('llms.txt');
  assert.equal(text, buildLlmsTxt(inputs), 'Run `npm run llms` after changing exports, declarations, docs or the catalog.');
  assert.match(text, /^# OptimAI Creative Agents\n\n> /);
  assert.ok(text.includes(`version ${inputs.pkg.version}`));
  for (const subpath of Object.keys(inputs.pkg.exports)) assert.ok(text.includes(`[\`${inputs.pkg.name}${subpath === '.' ? '' : subpath.slice(1)}\`]`), `llms.txt lists ${subpath}.`);
  for (const agent of AGENT_CATALOG) assert.ok(text.includes(`\`${agent.id}\``), `llms.txt lists ${agent.id}.`);
  for (const [, link] of text.matchAll(/\]\(([^)]+)\)/g)) await read(link);
  assert.ok(!/frontend\/|backend\/|\.\.\//.test(text), 'llms.txt links only inside the kit.');
  assert.ok(inputs.pkg.files.includes('llms.txt') && RELEASE_FILES.includes('llms.txt'));
  assert.ok(text.length < 24_000, 'Small enough for an agent to read in one go.');
});

test('the CLI checks llms.txt and dry-runs a release without writing', async () => {
  const before = await Promise.all(RELEASE_FILES.map(read));
  const check = cli('--check');
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /llms\.txt is current/);
  const dry = cli('patch', '--date', '2030-01-02', '--dry-run');
  // Right after a release Unreleased is empty and the CLI must refuse; otherwise it plans.
  if (/^- /m.test(splitChangelog(await read('CHANGELOG.md')).notes)) {
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /Dry run, nothing written\. \d+\.\d+\.\d+ → \d+\.\d+\.\d+ \(2030-01-02\)/);
  } else { assert.equal(dry.status, 1); assert.match(dry.stderr, /no notes/); }
  const bad = cli('--publish');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Unknown option --publish/);
  assert.deepEqual(await Promise.all(RELEASE_FILES.map(read)), before, 'No release file changed.');
});
