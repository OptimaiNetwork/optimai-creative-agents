import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AGENT_CATALOG, validateAgentManifest, getAgentTemplate } from '../src/index.mjs';
import { getAgentFormSchema } from '../src/form-schema.mjs';
import { LLMS_SKILL, buildLlmsFullTxt, declarationNames, embedGuide, readLlmsInputs } from '../scripts/release-notes.mjs';
import { TYPECHECK_AMBIENT, TYPECHECK_SAMPLES, TYPESCRIPT_VERSION, loadTypeScript, typecheck, typecheckFiles } from '../scripts/typecheck.mjs';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const exists = path => access(new URL(path, root));
const pkg = JSON.parse(await read('package.json'));
// A compiler from TYPESCRIPT_DIR, the SDK cache or a parent install; the gate tests skip without one.
const ts = loadTypeScript();
const noCompiler = ts ? false : `TypeScript not found; run \`npm run typecheck\` after caching ${TYPESCRIPT_VERSION}.`;

test('every public subpath declares exactly the names its module exports', async () => {
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    if (typeof target === 'string') continue;
    const declared = declarationNames(await read(target.types.slice(2))).values.sort();
    const actual = Object.keys(await import(new URL(target.import, root))).filter(name => name !== 'default').sort();
    assert.deepEqual(declared, actual, `${target.types} must declare every runtime export of ${subpath} and nothing else.`);
  }
});

test('declaration names include re-exports, aliases and type-only re-exports', () => {
  const names = declarationNames("export { a, b as c } from './x.mjs';\nexport type { T, U as V } from './y.mjs';\nexport { type W, d } from './z.mjs';\nexport declare const e: 1;\n");
  assert.deepEqual(names, { values: ['e', 'a', 'c', 'd'], types: ['T', 'V', 'W'] });
});

test('the type gate covers every exported declaration, the ambient peers and the consumer sample', async () => {
  const files = await typecheckFiles();
  for (const target of Object.values(pkg.exports)) if (typeof target !== 'string') assert.ok(files.includes(target.types.slice(2)), `${target.types} is type-checked.`);
  for (const file of [...TYPECHECK_AMBIENT, ...TYPECHECK_SAMPLES, 'src/index.d.ts']) { assert.ok(files.includes(file)); await read(file); }
  assert.ok(pkg.scripts.typecheck === 'node scripts/typecheck.mjs');
  const sample = await read(TYPECHECK_SAMPLES[0]);
  assert.ok((sample.match(/@ts-expect-error/g) ?? []).length >= 8, 'The sample keeps known mistakes rejected.');
  assert.ok(!/from '\.\.?\//.test(sample), 'The sample imports by package name, the way a host does.');
  const ci = await read('.github/workflows/ci.yml');
  assert.match(ci, new RegExp(`typescript@${TYPESCRIPT_VERSION.replaceAll('.', '\\.')}`), 'CI pins the compiler the docs name.');
  assert.match(ci, /npm run typecheck/);
});

test('the shipped declarations and consumer sample compile under strict', { skip: noCompiler }, async () => {
  assert.deepEqual(typecheck(ts, await typecheckFiles()), []);
});

test('the gate reports a wrong call and an @ts-expect-error that no longer fails', { skip: noCompiler }, async () => {
  // Inside the package (gitignored cache) so the package-name self-reference resolves.
  const folder = new URL('.cache/typecheck-tests/', root), file = new URL('broken.mts', folder);
  await mkdir(folder, { recursive: true });
  try {
    await writeFile(file, "import { contrastRatio } from '@optimai/creative-agents/color';\nexport const a: string = contrastRatio('#000', '#fff');\n// @ts-expect-error\nexport const b: number = contrastRatio('#000', '#fff');\n");
    const problems = typecheck(ts, [...TYPECHECK_AMBIENT, fileURLToPath(file)]);
    assert.ok(problems.some(line => /broken\.mts\(2,\d+\): TS2322/.test(line)), problems.join('\n'));
    assert.ok(problems.some(line => /broken\.mts\(3,\d+\): TS2578/.test(line)), problems.join('\n'));
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('the typecheck CLI explains how to get a compiler instead of failing silently', () => {
  // Without TYPESCRIPT_DIR the CLI finds a compiler only in the cache or a parent install.
  const run = spawnSync(process.execPath, ['scripts/typecheck.mjs'], { cwd: fileURLToPath(root), encoding: 'utf8', env: { ...process.env, TYPESCRIPT_DIR: '' } });
  if (run.status === 2) assert.match(run.stderr, /TypeScript was not found[\s\S]*npm install --prefix \.cache\/typecheck --ignore-scripts --no-save --package-lock=false typescript@/);
  else { assert.equal(run.status, 0, run.stderr); assert.match(run.stdout, /Type-checked \d+ declarations and 1 consumer sample/); }
});

test('llms-full.txt is current and inlines every declaration, the recipe skill and every guide', async () => {
  const inputs = await readLlmsInputs(), text = await read('llms-full.txt');
  assert.equal(text, buildLlmsFullTxt(inputs), 'Run `npm run llms` after changing exports, declarations, docs or the skill.');
  for (const target of Object.values(pkg.exports)) if (typeof target !== 'string') assert.ok(text.includes(inputs.declarations[target.types].trim()), `${target.types} is inlined verbatim.`);
  for (const path of Object.keys(inputs.docs)) assert.ok(text.includes(`<!-- ${path} -->`));
  for (const agent of AGENT_CATALOG) assert.ok(text.includes(`\`${agent.id}\``));
  assert.ok(text.includes('<!-- skills/build-a-recipe/SKILL.md -->') && !text.includes('\nname: build-a-recipe'), 'The skill is inlined without its front matter.');
  assert.equal(text.match(/^# /gm).length, 1, 'One top-level heading; guides sit below it.');
  assert.equal((text.match(/^```/gm) ?? []).length % 2, 0, 'Every code fence closes.');
  for (const [, link] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^[a-z]+:/i.test(link)) continue;
    assert.ok(!link.startsWith('#'), `${link} would point inside the wrong guide.`);
    await exists(link.split('#')[0]);
  }
  assert.ok(!/frontend\/|backend\/|\]\(\.\.\//.test(text), 'llms-full.txt links only inside the kit.');
  assert.ok(pkg.files.includes('llms-full.txt') && pkg.files.includes('skills'));
  assert.ok(Buffer.byteLength(text) < 400_000, `llms-full.txt is ${Buffer.byteLength(text)} bytes; hosts that ship it cap the file at 512 KB, so trim a guide before it grows past 400 KB.`);
  assert.ok((await read('llms.txt')).includes('[Full reference](llms-full.txt)'));
});

test('embedded guides shift headings, rebase links and leave code alone', () => {
  const guide = '# Title\n\nSee [A](../README.md), [B](runtimes.md#x "t"), [C](#local), [D](https://a.test/) and [E](/abs).\n\n###### Deep\n\n```md\n# not a heading [F](#y)\n```\n';
  assert.equal(embedGuide(guide, 'docs/guide.md'), '### Title\n\nSee [A](README.md), [B](docs/runtimes.md#x "t"), [C](docs/guide.md#local), [D](https://a.test/) and [E](/abs).\n\n###### Deep\n\n```md\n# not a heading [F](#y)\n```');
  assert.throws(() => embedGuide('[x](../../outside.md)', 'docs/a.md'), /leaves the kit/);
});

test('the recipe skill is a valid skill whose example recipe and commands work', async () => {
  const skill = await read(LLMS_SKILL);
  const [, front] = /^---\n([\s\S]*?)\n---\n/.exec(skill) ?? [];
  assert.ok(front, 'SKILL.md starts with YAML front matter.');
  const meta = Object.fromEntries(front.split('\n').map(line => /^(\w+): (.+)$/.exec(line)?.slice(1)).filter(Boolean));
  assert.equal(meta.name, 'build-a-recipe', 'The name matches the folder.');
  assert.match(meta.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(meta.description.length > 40 && meta.description.length <= 1024);
  assert.equal(meta.license, 'MIT');
  const recipe = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(skill)[1]);
  const result = validateAgentManifest(recipe);
  assert.equal(result.success, true, result.errors.join('\n'));
  assert.equal(recipe.category, getAgentTemplate(recipe.recipe.templateId).category);
  const properties = getAgentFormSchema(recipe.recipe.templateId).properties;
  for (const key of Object.keys(recipe.recipe.values)) assert.ok(properties[key], `${key} is a declared setting.`);
  for (const [, id] of skill.matchAll(/(?:getAgentFormSchema|createAgentManifest)\("?'?([a-z0-9-]+)/g)) assert.ok(getAgentTemplate(id), `${id} is a reviewed template.`);
  for (const [, script] of skill.matchAll(/npm run (\w[\w:-]*)/g)) assert.ok(pkg.scripts[script], `npm run ${script} exists.`);
  for (const [, path] of skill.matchAll(/`((?:docs|examples|scripts|src)\/[\w./-]+)`/g)) await exists(path);
  assert.ok(!/frontend\/|backend\/|optimai\.studio\/(?!agents)/.test(skill), 'The skill names no host internals.');
});
