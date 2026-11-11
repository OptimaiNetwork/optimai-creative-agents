#!/usr/bin/env node
// Release ritual: one command turns the changelog's Unreleased notes into a
// dated section and moves every living version mention (package.json, README,
// release guide, llms.txt, llms-full.txt; the MCP adapter reads package.json)
// together.
// It edits local files only: no Git, tag, npm or network call.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { AGENT_CATALOG, AGENT_WORKSPACE_CONTRACT_VERSION } from '../src/index.mjs';

export const RELEASE_FILES = Object.freeze(['package.json', 'CHANGELOG.md', 'README.md', 'docs/release-and-feature.md', 'llms.txt', 'llms-full.txt']);
export const LLMS_FILES = Object.freeze(['llms.txt', 'llms-full.txt']);
export const LLMS_SKILL = 'skills/build-a-recipe/SKILL.md';
export const LLMS_DOCS = Object.freeze(['docs/README.md', 'docs/quickstart.md', 'docs/catalog.md', 'docs/runtimes.md', 'docs/host-integration.md', 'docs/CAMERA.md', 'docs/MUSIC-MOTION.md', 'docs/mcp.md', 'docs/release-and-feature.md']);
const SEMVER = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;
const GROUPS = [['canvas', ['canvas']], ['browser vision', ['vision']], ['writing', ['writing']], ['interactive', ['3d', 'camera', 'music', 'frame']], ['guided', ['workflow', 'sketch']]];
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fail = message => { throw new Error(message); };

export function parseVersion(value) {
  const match = SEMVER.exec(String(value));
  if (!match) fail(`Use a plain x.y.z version, not ${JSON.stringify(value)}.`);
  return match.slice(1).map(Number);
}
const newer = (a, b) => { const x = parseVersion(a), y = parseVersion(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };

/** Split the changelog into the text before Unreleased, its notes and everything after. */
export function splitChangelog(text) {
  const start = /^## Unreleased[ \t]*$/m.exec(text) ?? fail('CHANGELOG.md needs a "## Unreleased" section.');
  const bodyStart = start.index + start[0].length;
  const next = /^## /m.exec(text.slice(bodyStart));
  const end = next ? bodyStart + next.index : text.length;
  return { head: text.slice(0, start.index), notes: text.slice(bodyStart, end).trim(), rest: text.slice(end) };
}

/** Pre-1.0: Added, Changed or Removed notes make a minor release, Fixed-only a patch. */
export function suggestBump(notes) {
  return /^### (Added|Changed|Removed|Deprecated)\b/m.test(notes) ? 'minor' : 'patch';
}
export function nextVersion(current, bump) {
  const [major, minor, patch] = parseVersion(current);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`;
  parseVersion(bump);
  if (newer(bump, current) <= 0) fail(`Version ${bump} must be newer than ${current}.`);
  return bump;
}
export function checkDate(date) {
  const [year, month, day] = (/^(\d{4})-(\d{2})-(\d{2})$/.exec(date) ?? fail(`Use a YYYY-MM-DD date, not ${JSON.stringify(date)}.`)).slice(1).map(Number);
  const real = new Date(Date.UTC(year, month - 1, day));
  if (real.getUTCFullYear() !== year || real.getUTCMonth() !== month - 1 || real.getUTCDate() !== day) fail(`${date} is not a calendar date.`);
  return date;
}
export const localDate = (now = new Date()) => [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((part, index) => String(part).padStart(index ? 2 : 4, '0')).join('-');

/** The bold lead of each top-level bullet, e.g. "Titles that stay readable on any photo". */
export function releaseHighlights(notes) {
  return [...notes.matchAll(/^- \*\*(.+?)\*\*/gm)].map(match => match[1].replace(/[.:]\s*$/, '').trim());
}
/** GitHub's heading anchor for a changelog section. */
export const changelogAnchor = (version, date) => `${version}--${date}`.replaceAll('.', '');

export function catalogGroups(catalog = AGENT_CATALOG) {
  return GROUPS.map(([label, kinds]) => [label, catalog.filter(agent => kinds.includes(agent.workspace.kind))]);
}

export function cutChangelog(text, version, date) {
  const { head, notes, rest } = splitChangelog(text);
  if (!/^- /m.test(notes)) fail('Unreleased has no notes; add at least one bullet before cutting a release.');
  if (new RegExp(`^## ${escape(version)}\\b`, 'm').test(rest)) fail(`CHANGELOG.md already has a ${version} section.`);
  return `${head}## Unreleased\n\n## ${version} — ${date}\n\n${notes}\n\n${rest.replace(/^\n+/, '')}`;
}

export function releaseSection({ version, date, notes, contract = AGENT_WORKSPACE_CONTRACT_VERSION, catalog = AGENT_CATALOG }) {
  const groups = catalogGroups(catalog).map(([label, agents]) => `${agents.length} ${label}`);
  const counts = `${groups.slice(0, -1).join(', ')} and ${groups.at(-1)}`;
  const highlights = releaseHighlights(notes).map(item => `- ${item}`).join('\n');
  return `## SDK ${version}\n\nReleased ${date} with workspace contract ${contract}. The catalog has ${catalog.length} templates: ${counts} entries. Portable v1 manifests and saved recipe fields stay compatible.\n\n${highlights ? `${highlights}\n\n` : ''}Every change is described in the [changelog](../CHANGELOG.md#${changelogAnchor(version, date)}).\n\n`;
}

/** Exported names per public subpath, read from the shipped declarations. */
export function declarationNames(source) {
  const values = new Set(), types = new Set();
  for (const [, kind, name] of source.matchAll(/^export (?:declare )?(function|const|let|class|type|interface|enum) ([A-Za-z_$][\w$]*)/gm)) (kind === 'type' || kind === 'interface' ? types : values).add(name);
  // Re-exports: `export { a, b as c } from '…'` and `export type { T } from '…'`.
  for (const [, typeOnly, list] of source.matchAll(/^export (type )?\{([^}]*)\}/gm)) for (const item of list.split(',')) {
    const [, itemType, name] = /^\s*(type\s+)?(?:[\w$]+\s+as\s+)?([A-Za-z_$][\w$]*)\s*$/.exec(item) ?? [];
    if (name) (typeOnly || itemType ? types : values).add(name);
  }
  return { values: [...values], types: [...types] };
}
const firstSentence = markdown => {
  const paragraph = markdown.split(/\n\s*\n/).map(block => block.trim()).find(block => block && !/^(?:#|\||```|!|<|>|- |\[)/.test(block)) ?? '';
  const sentence = (paragraph.replace(/\s+/g, ' ').match(/^.+?[.!?](?=\s|$)/)?.[0] ?? paragraph).replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*/g, '');
  return sentence.length > 200 ? `${sentence.slice(0, 197).trimEnd()}…` : sentence;
};

const llmsSummary = (pkg, contract, catalog) => `${pkg.description.replace(/^OptimAI Creative Agents:\s*/, '').replace(/^./, letter => letter.toUpperCase())}. MIT-licensed JavaScript SDK, version ${pkg.version}, workspace contract ${contract}, ${catalog.length} reviewed agent templates. Node.js ${pkg.engines?.node ?? '>=20'} and modern browsers; no runtime dependencies.`;
const llmsRules = pkg => [
  'How to work with this SDK:', '',
  '- A recipe is a portable v1 JSON manifest: a reviewed template ID, approved setting values and a creative brief. It never carries code, model URLs or credentials.',
  '- Scaffold with `npm run create`, validate with `node scripts/verify.mjs path/to/agent.json`, and run `npm test` before proposing a change.',
  '- Import the public subpaths below; each module ships a `.d.mts` declaration beside it. Files without a subpath are internal. `npm run mcp` starts the local stdio MCP adapter.',
  `- Optional peers stay optional and pinned: ${Object.entries(pkg.peerDependencies ?? {}).map(([name, version]) => `\`${name}@${version}\``).join(', ')}. Canvas, catalog, color, crop, verify and beat modules need none.`,
  '- Selected media stays on the device. Media generation, accounts and billing belong to the host application, not this SDK.', '',
];
const llmsTemplates = catalog => catalogGroups(catalog).map(([label, agents]) => `- ${label[0].toUpperCase()}${label.slice(1)} (${agents.length}): ${agents.map(agent => `\`${agent.id}\``).join(', ')}`);
const subpathName = (pkg, subpath) => `${pkg.name}${subpath === '.' ? '' : subpath.slice(1)}`;

/** Apply `change` to every line outside fenced code blocks. */
const outsideFences = (markdown, change) => {
  let fence = null;
  return markdown.split('\n').map(line => {
    const mark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (mark && !fence) { fence = mark; return line; }
    if (fence) { if (mark && mark[0] === fence[0] && mark.length >= fence.length && line.trim() === mark) fence = null; return line; }
    return change(line);
  }).join('\n');
};
const joinPath = (directory, target) => {
  const parts = directory ? directory.split('/') : [];
  for (const part of target.split('/')) { if (part === '..') { if (!parts.length) fail(`Link ${target} leaves the kit.`); parts.pop(); } else if (part && part !== '.') parts.push(part); }
  return parts.join('/');
};
/**
 * A guide made to sit inside one long file: headings move `levels` deeper (capped at h6), relative
 * links are rewritten from the guide's folder to the package root and same-page anchors point back
 * at the guide. Code blocks are untouched.
 */
export function embedGuide(markdown, path, levels = 2) {
  const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  return outsideFences(markdown.trim(), line => line
    .replace(/^(#{1,6})(?= )/, marks => '#'.repeat(Math.min(6, marks.length + levels)))
    .replace(/\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g, (whole, target, title) => {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(target)) return whole;
      if (target.startsWith('#')) return `](${path}${target}${title})`;
      const [file, anchor = ''] = target.split(/(?=#)/);
      return `](${joinPath(directory, file)}${anchor}${title})`;
    }));
}

/** llms.txt (llmstxt.org layout): a deterministic map of the SDK for AI coding agents. */
export function buildLlmsTxt({ pkg, declarations, docs, contract = AGENT_WORKSPACE_CONTRACT_VERSION, catalog = AGENT_CATALOG }) {
  const modules = Object.entries(pkg.exports).flatMap(([subpath, target]) => {
    const name = subpathName(pkg, subpath);
    if (typeof target === 'string') return [`- [\`${name}\`](${target.slice(2)}): JSON Schema.`];
    const { values, types } = declarationNames(declarations[target.types] ?? fail(`Missing declaration ${target.types}.`));
    return [`- [\`${name}\`](${target.types.slice(2)}): ${values.join(', ') || 'types only'}.${types.length ? ` Types: ${types.join(', ')}.` : ''}`];
  });
  const guides = Object.entries(docs).map(([path, text]) => `- [${(/^# (.+)$/m.exec(text)?.[1] ?? path).trim()}](${path}): ${firstSentence(text.replace(/^# .+$/m, ''))}`);
  return [
    `# OptimAI Creative Agents`, '',
    `> ${llmsSummary(pkg, contract, catalog)}`, '',
    ...llmsRules(pkg),
    '## Modules', '', ...modules, '',
    '## Guides', '', ...guides, '',
    '## Templates', '', ...llmsTemplates(catalog), '',
    '## Optional', '',
    `- [Full reference](llms-full.txt): every public declaration and guide inlined in one file, for agents that cannot follow links.`,
    `- [Recipe skill](${LLMS_SKILL}): step-by-step instructions an AI coding agent can load to build and verify a recipe.`,
    '- [Changelog](CHANGELOG.md): what each release lets builders and creators do.',
    '- [Contributing](CONTRIBUTING.md): how new reviewed operations, tests and docs are proposed.',
    '- [Manifest schema](schema/agent-manifest.schema.json): the strict v1 recipe format.', '',
  ].join('\n');
}

/**
 * llms-full.txt: the same map with nothing behind a link. Every public declaration is inlined
 * verbatim, then the recipe skill and every guide, so one fetch gives an agent the whole API.
 */
export function buildLlmsFullTxt({ pkg, declarations, docs, skill, contract = AGENT_WORKSPACE_CONTRACT_VERSION, catalog = AGENT_CATALOG }) {
  const modules = Object.entries(pkg.exports).flatMap(([subpath, target]) => {
    const name = subpathName(pkg, subpath);
    if (typeof target === 'string') return [`### \`${name}\``, '', `JSON Schema: [${target.slice(2)}](${target.slice(2)}).`, ''];
    const source = (declarations[target.types] ?? fail(`Missing declaration ${target.types}.`)).trim();
    if (source.includes('```')) fail(`${target.types} cannot be inlined: it contains a code fence.`);
    return [`### \`${name}\``, '', `Declared in \`${target.types.slice(2)}\`, implemented in \`${target.import.slice(2)}\`.`, '', '```ts', source, '```', ''];
  });
  const guides = Object.entries(docs).flatMap(([path, text]) => [`<!-- ${path} -->`, '', embedGuide(text, path), '']);
  const recipe = skill ? ['## Building a recipe', '', `<!-- ${LLMS_SKILL} -->`, '', embedGuide(skill.replace(/^---\n[\s\S]*?\n---\n/, ''), LLMS_SKILL), ''] : [];
  return [
    `# OptimAI Creative Agents: full reference`, '',
    `> ${llmsSummary(pkg, contract, catalog)} This file inlines every public declaration and guide; [llms.txt](llms.txt) is the short map.`, '',
    ...llmsRules(pkg),
    '## Templates', '', ...llmsTemplates(catalog), '',
    ...recipe,
    '## Declarations', '', ...modules,
    '## Guides', '', ...guides,
  ].join('\n');
}
const llmsBuilders = { 'llms.txt': buildLlmsTxt, 'llms-full.txt': buildLlmsFullTxt };

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
export async function readLlmsInputs() {
  const pkg = JSON.parse(await read('package.json'));
  const declarations = Object.fromEntries(await Promise.all(Object.values(pkg.exports).filter(target => typeof target !== 'string').map(async target => [target.types, await read(target.types.slice(2))])));
  const docs = Object.fromEntries(await Promise.all(LLMS_DOCS.map(async path => [path, await read(path)])));
  return { pkg, declarations, docs, skill: await read(LLMS_SKILL) };
}

/** Pure: every file a release changes, computed before anything is written. */
export function planRelease({ files, bump, date, contract = AGENT_WORKSPACE_CONTRACT_VERSION, catalog = AGENT_CATALOG, llms }) {
  checkDate(date);
  const pkg = JSON.parse(files['package.json']);
  const { notes } = splitChangelog(files['CHANGELOG.md']);
  const version = nextVersion(pkg.version, bump ?? suggestBump(notes));
  const versionLine = /("version"\s*:\s*")([^"]+)(")/;
  if (!versionLine.test(files['package.json'])) fail('package.json has no version field.');
  const readmeLine = new RegExp(`Version \`${escape(pkg.version)}\``);
  if (!readmeLine.test(files['README.md'])) fail(`README.md must state "Version \`${pkg.version}\`".`);
  const guide = files['docs/release-and-feature.md'], firstSection = guide.search(/^## SDK /m);
  if (firstSection < 0) fail('docs/release-and-feature.md needs an "## SDK x.y.z" section to insert above.');
  const next = {
    'package.json': files['package.json'].replace(versionLine, `$1${version}$3`),
    'CHANGELOG.md': cutChangelog(files['CHANGELOG.md'], version, date),
    'README.md': files['README.md'].replace(readmeLine, `Version \`${version}\``),
    'docs/release-and-feature.md': `${guide.slice(0, firstSection)}${releaseSection({ version, date, notes, contract, catalog })}${guide.slice(firstSection)}`,
  };
  if (llms) for (const path of LLMS_FILES) next[path] = llmsBuilders[path]({ ...llms, pkg: { ...llms.pkg, version }, docs: { ...llms.docs, 'docs/release-and-feature.md': next['docs/release-and-feature.md'] }, contract, catalog });
  return { from: pkg.version, version, date, highlights: releaseHighlights(notes), files: next };
}

export function parseReleaseArgs(argv) {
  const options = { dryRun: false, llms: false, check: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--llms') options.llms = true;
    else if (arg === '--check') options.check = true;
    else if (arg === '--date' || arg.startsWith('--date=')) options.date = arg === '--date' ? argv[++index] : arg.slice(7);
    else if (!arg.startsWith('-') && options.bump === undefined) options.bump = arg;
    else fail(`Unknown option ${arg}. Use [major|minor|patch|x.y.z] [--date YYYY-MM-DD] [--dry-run], --llms or --check.`);
  }
  if (options.bump !== undefined && !['major', 'minor', 'patch'].includes(options.bump)) parseVersion(options.bump);
  return options;
}

async function main(argv) {
  const options = parseReleaseArgs(argv);
  if (options.llms || options.check) {
    const inputs = await readLlmsInputs();
    for (const path of LLMS_FILES) {
      const expected = llmsBuilders[path](inputs), current = await read(path).catch(() => '');
      if (current === expected) process.stdout.write(`${path} is current.\n`);
      else if (options.check) fail(`${path} is out of date. Run \`npm run llms\`.`);
      else { await writeFile(new URL(path, root), expected); process.stdout.write(`Updated ${path}.\n`); }
    }
    return;
  }
  const files = Object.fromEntries(await Promise.all(RELEASE_FILES.filter(path => !LLMS_FILES.includes(path)).map(async path => [path, await read(path)])));
  const plan = planRelease({ files, bump: options.bump, date: options.date ?? localDate(), llms: await readLlmsInputs() });
  const summary = `${plan.from} → ${plan.version} (${plan.date}): ${plan.highlights.length} highlights; ${Object.keys(plan.files).join(', ')}`;
  if (options.dryRun) { process.stdout.write(`Dry run, nothing written. ${summary}\n`); return; }
  for (const [path, text] of Object.entries(plan.files)) await writeFile(new URL(path, root), text);
  process.stdout.write(`Released ${summary}.\nReview the diff, commit, then tag v${plan.version} yourself.\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { await main(process.argv.slice(2)); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
