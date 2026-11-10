/**
 * Starter kits: small runnable folders a builder copies with `npm run create -- --kit <id>` and makes their own.
 * This module is the catalog and the fill rules only; it reads no files, so a host can list kits or build the same
 * folder in a browser. Kit templates live in `kits/<id>/` and import the SDK by package name.
 */
const deepFreeze = value => { for (const item of Object.values(value)) if (item && typeof item === 'object') deepFreeze(item); return Object.freeze(value); };

export const STARTER_KIT_LIMITS = Object.freeze({ name: 64, fileBytes: 32768, files: 8 });
export const STARTER_KIT_PLACEHOLDERS = Object.freeze(['NAME', 'TITLE', 'KIT', 'SDK_PATH', 'IMPORT_MAP']);
const NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
// Relative POSIX folders only: `..`, `../..`, `../vendor/optimai-agents`. No scheme, root, backslash or quote.
const SDK_PATH = /^(?:\.\.?|[A-Za-z0-9_@][A-Za-z0-9._@-]*)(?:\/(?:\.\.|[A-Za-z0-9_@][A-Za-z0-9._@-]*))*$/;
const BROWSER_FILES = ['README.md', 'package.json', 'index.html', 'app.mjs', 'styles.css'];

export const STARTER_KITS = deepFreeze([
  { id: 'poster-app', title: 'Poster app', runtime: 'browser', agents: ['poster-lab'],
    summary: 'A one-page poster maker: a settings form drawn from the Poster Lab schema, an on-device render, alt text and a PNG download.',
    subpaths: ['form-schema', 'playground', 'canvas-lab', 'progress', 'accessibility'], files: BROWSER_FILES },
  { id: 'music-visualizer', title: 'Music visualizer', runtime: 'browser', agents: ['music-reactive'],
    summary: 'Pick a song on your device and watch four looks react to it, with a flash-limited beat pulse and a still cover export.',
    subpaths: ['music-reactive', 'beat-tracker', 'accessibility'], files: BROWSER_FILES },
  { id: 'camera-filter', title: 'Camera filter', runtime: 'browser', agents: ['camera-stage'],
    summary: 'Live camera effects from the Camera Stage recipe, with a photo fallback when there is no camera and a snapshot button.',
    subpaths: ['form-schema', 'camera-runtime', 'camera-renderer'], files: BROWSER_FILES },
  { id: 'mcp-creative-server', title: 'MCP creative server', runtime: 'node', agents: ['poster-lab', 'story-seed', 'image-grid'],
    summary: 'Your own stdio MCP server that offers a short list of agents you choose as tools for AI assistants. It prepares recipes and needs no model.',
    subpaths: ['.', 'mcp-tools'], files: ['README.md', 'package.json', 'server.mjs'] },
]);

/** Every kit, in catalog order. */
export function listStarterKits({ runtime } = {}) { return STARTER_KITS.filter(kit => !runtime || kit.runtime === runtime); }
/** One kit by ID, or undefined. */
export function getStarterKit(id) { return STARTER_KITS.find(kit => kit.id === id); }
const kitOf = idOrKit => {
  const kit = getStarterKit(typeof idOrKit === 'string' ? idOrKit : idOrKit?.id);
  if (!kit) throw new Error(`Unknown starter kit. Choose ${STARTER_KITS.map(item => item.id).join(', ')}.`);
  return kit;
};

/** The command that creates a kit folder from a checkout or the starter ZIP. */
export function starterKitCommand(idOrKit, name) {
  const kit = kitOf(idOrKit);
  return name == null || name === kit.id ? `npm run create -- --kit ${kit.id}` : `npm run create -- ${starterKitName(name)} --kit ${kit.id}`;
}
/** A lowercase hyphenated folder name, at most 64 characters, never a path. */
export function starterKitName(name) {
  if (typeof name !== 'string' || name.length > STARTER_KIT_LIMITS.name || !NAME.test(name)) throw new Error('Use a lowercase hyphenated name such as my-poster, not a path.');
  return name;
}

/** An import map for a browser kit: each subpath it uses, pointing at the SDK folder `sdkPath` (relative to the page). */
export function starterKitImportMap(idOrKit, sdkPath) {
  const kit = kitOf(idOrKit), base = sdkFolder(sdkPath);
  return { imports: Object.fromEntries(kit.subpaths.map(subpath => [subpath === '.' ? '@optimai/creative-agents' : `@optimai/creative-agents/${subpath}`, `${base}/src/${subpath === '.' ? 'index' : subpath}.mjs`])) };
}
function sdkFolder(sdkPath) {
  if (typeof sdkPath !== 'string' || sdkPath.length > 512 || !SDK_PATH.test(sdkPath)) throw new Error('sdkPath must be a relative folder such as ../.. (forward slashes, no scheme or root).');
  return sdkPath;
}

/**
 * The values a kit's templates are filled with. `sdkPath` is the SDK folder relative to the new kit folder;
 * browser pages and `package.json` (`file:` dependency) both use it, so nothing is downloaded.
 */
export function starterKitVariables(idOrKit, { name, sdkPath } = {}) {
  const kit = kitOf(idOrKit), folder = starterKitName(name ?? kit.id), sdk = sdkFolder(sdkPath);
  const title = folder.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ');
  return Object.freeze({ NAME: folder, TITLE: title, KIT: kit.id, SDK_PATH: sdk, IMPORT_MAP: kit.runtime === 'browser' ? JSON.stringify(starterKitImportMap(kit, sdk), null, 2) : '' });
}

/** Replace `{{NAME}}`-style placeholders. Unknown or unfilled placeholders throw, so a kit never ships half-filled. */
export function fillStarterFile(text, variables) {
  if (typeof text !== 'string' || text.length > STARTER_KIT_LIMITS.fileBytes) throw new Error(`A kit file must be text of at most ${STARTER_KIT_LIMITS.fileBytes} characters.`);
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => {
    if (!STARTER_KIT_PLACEHOLDERS.includes(key) || typeof variables?.[key] !== 'string') throw new Error(`The kit file uses ${match}, which has no value.`);
    return variables[key];
  });
}

/** What `create` writes: `{ kit, folder, files: [{ path, template }] }`, files in the kit's order, for any host to fill. */
export function planStarterKit(idOrKit, { name } = {}) {
  const kit = kitOf(idOrKit);
  return { kit, folder: starterKitName(name ?? kit.id), files: kit.files.map(path => ({ path, template: `kits/${kit.id}/${path}` })) };
}
