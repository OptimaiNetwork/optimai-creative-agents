#!/usr/bin/env node
// Type gate: compiles every shipped declaration under `strict`, plus consumer
// samples that import the SDK by package name the way a host does.
// TypeScript is a tool here, never a dependency: the script uses a compiler it
// is pointed at (TYPESCRIPT_DIR), one cached in .cache/typecheck, or one a
// parent folder already installed. It installs and downloads nothing.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The compiler version CI pins. Other 5.x compilers work; this is the one results are reported for. */
export const TYPESCRIPT_VERSION = '5.9.3';
/** Consumer code compiled with the declarations: real calls, and `@ts-expect-error` lines that must stay errors. */
export const TYPECHECK_SAMPLES = Object.freeze(['test/types/usage.mts']);
/** Optional peers are declared as untyped modules so the gate needs none of them installed. */
export const TYPECHECK_AMBIENT = Object.freeze(['test/types/optional-peers.d.ts']);
export const TYPECHECK_OPTIONS = Object.freeze({
  noEmit: true, strict: true, target: 'es2022', module: 'nodenext', moduleResolution: 'nodenext',
  lib: ['es2022', 'dom', 'dom.iterable'], types: [], skipLibCheck: false,
  noUnusedLocals: true, noUnusedParameters: true, noImplicitOverride: true, noFallthroughCasesInSwitch: true,
});
const root = fileURLToPath(new URL('../', import.meta.url));
export const TYPESCRIPT_INSTALL = `npm install --prefix .cache/typecheck --ignore-scripts --no-save --package-lock=false typescript@${TYPESCRIPT_VERSION}`;

/** The first TypeScript found in `directory`, the SDK's cache, or a folder above the SDK; undefined when there is none. */
export function loadTypeScript(directory = process.env.TYPESCRIPT_DIR) {
  for (const base of [directory, join(root, '.cache/typecheck'), root]) {
    if (!base) continue;
    try { return createRequire(join(resolve(base), 'typecheck.cjs'))('typescript'); } catch { /* try the next place */ }
  }
  return undefined;
}

/** Every declaration the package exports (and the CommonJS-style index twin), then the ambient peers and samples. */
export async function typecheckFiles() {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const declarations = Object.values(pkg.exports).filter(target => typeof target !== 'string').map(target => target.types.slice(2));
  return [...new Set([...declarations, 'src/index.d.ts', ...TYPECHECK_AMBIENT, ...TYPECHECK_SAMPLES])];
}

/** Compile `files` (relative to the SDK, or absolute) and return one `file(line,column): TScode message` string per problem. */
export function typecheck(ts, files, options = TYPECHECK_OPTIONS) {
  const converted = ts.convertCompilerOptionsFromJson({ ...options }, root);
  const program = ts.createProgram(files.map(file => isAbsolute(file) ? file : join(root, file)), converted.options);
  return [...converted.errors, ...ts.getPreEmitDiagnostics(program)].map(diagnostic => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
    if (!diagnostic.file) return `TS${diagnostic.code} ${message}`;
    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    return `${relative(root, diagnostic.file.fileName).split(sep).join('/')}(${line + 1},${character + 1}): TS${diagnostic.code} ${message}`;
  });
}

async function main() {
  const ts = loadTypeScript();
  if (!ts) {
    process.stderr.write(`TypeScript was not found. Point TYPESCRIPT_DIR at a folder that has it installed, or cache the pinned compiler:\n  ${TYPESCRIPT_INSTALL}\n`);
    process.exitCode = 2;
    return;
  }
  const files = await typecheckFiles(), problems = typecheck(ts, files);
  if (problems.length) {
    process.stderr.write(`${problems.join('\n')}\n${problems.length} type problem${problems.length === 1 ? '' : 's'} (TypeScript ${ts.version}).\n`);
    process.exitCode = 1;
  } else process.stdout.write(`Type-checked ${files.length - TYPECHECK_AMBIENT.length - TYPECHECK_SAMPLES.length} declarations and ${TYPECHECK_SAMPLES.length} consumer sample with TypeScript ${ts.version}.\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { await main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
