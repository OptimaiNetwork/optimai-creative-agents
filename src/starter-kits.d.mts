export type StarterKitId = 'poster-app' | 'music-visualizer' | 'camera-filter' | 'mcp-creative-server';
export type StarterKit = Readonly<{
  id: StarterKitId; title: string; summary: string;
  /** `browser` kits run from a static page; `node` kits run with Node 20+. */
  runtime: 'browser' | 'node';
  /** Catalog templates the kit is built on. */
  agents: readonly string[];
  /** Public subpaths the kit imports by package name (`.` is the package root). */
  subpaths: readonly string[];
  /** Files under `kits/<id>/`, in write order. */
  files: readonly string[];
}>;
export type StarterKitPlaceholder = 'NAME' | 'TITLE' | 'KIT' | 'SDK_PATH' | 'IMPORT_MAP';
export declare const STARTER_KIT_LIMITS: Readonly<{ name: 64; fileBytes: 32768; files: 8 }>;
export declare const STARTER_KIT_PLACEHOLDERS: readonly StarterKitPlaceholder[];
export declare const STARTER_KITS: readonly StarterKit[];
export declare function listStarterKits(options?: { runtime?: 'browser' | 'node' }): StarterKit[];
export declare function getStarterKit(id: string): StarterKit | undefined;
/** `npm run create -- --kit poster-app`, or with a folder name: `npm run create -- my-poster --kit poster-app`. */
export declare function starterKitCommand(kit: string | StarterKit, name?: string): string;
/** Returns the name when it is a lowercase hyphenated folder name of at most 64 characters; throws otherwise. */
export declare function starterKitName(name: string): string;
/** Import map entries for each subpath the kit uses, relative to `sdkPath`. */
export declare function starterKitImportMap(kit: string | StarterKit, sdkPath: string): { imports: Record<string, string> };
export declare function starterKitVariables(kit: string | StarterKit, options: { name?: string; sdkPath: string }): Readonly<Record<StarterKitPlaceholder, string>>;
/** Fills `{{NAME}}`-style placeholders; throws on an unknown or unfilled one. */
export declare function fillStarterFile(text: string, variables: Readonly<Partial<Record<StarterKitPlaceholder, string>>>): string;
export declare function planStarterKit(kit: string | StarterKit, options?: { name?: string }): { kit: StarterKit; folder: string; files: { path: string; template: string }[] };
