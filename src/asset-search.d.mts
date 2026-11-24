export type AssetColorFamily = 'red' | 'orange' | 'yellow' | 'green' | 'cyan' | 'blue' | 'purple' | 'pink' | 'brown' | 'black' | 'white' | 'grey';
export type AssetTone = 'dark' | 'bright' | 'mono' | 'colorful' | 'muted' | 'warm' | 'cool' | 'contrast';
export type AssetShape = 'portrait' | 'landscape' | 'square' | 'panorama';
export declare const ASSET_INDEX_VERSION: 1;
export declare const ASSET_INDEX_KIND: 'optimai.asset-index';
export declare const ASSET_SEARCH_LIMITS: Readonly<{ assets: 5000; id: 128; name: 256; text: 512; tags: 32; tag: 64; query: 200; terms: 16; dims: 2048; results: 200; analysisEdge: 64; maxPixels: 262144 }>;
export declare const ASSET_SEARCH_COLORS: readonly AssetColorFamily[];
export declare const ASSET_SEARCH_TONES: readonly AssetTone[];
export declare const ASSET_SEARCH_SHAPES: readonly AssetShape[];

/** A storable visual signature: each color family's share of the image and how light it is there, plus overall tone and shape (width ÷ height). */
export type AssetFeatures = {
    readonly version: 1;
    readonly aspect: number;
    readonly lightness: number;
    readonly contrast: number;
    readonly chroma: number;
    readonly chromatic: number;
    readonly warmth: number;
    readonly colors: Readonly<Partial<Record<AssetColorFamily, { readonly weight: number; readonly lightness: number }>>>;
};
export type AssetHint =
    | { readonly kind: 'color'; readonly value: AssetColorFamily; readonly shade?: 'light' | 'dark'; readonly negate: boolean; readonly label: string }
    | { readonly kind: 'tone'; readonly value: AssetTone; readonly negate: boolean; readonly label: string }
    | { readonly kind: 'shape'; readonly value: AssetShape; readonly negate: boolean; readonly label: string };
export type AssetQuery = { readonly text: string; readonly hints: readonly AssetHint[]; readonly terms: readonly { readonly word: string; readonly negate: boolean }[] };
export type AssetVector = Float32Array | Float64Array | readonly number[];
export type AssetInput = { id: string; name?: string; tags?: readonly string[]; text?: string; features?: AssetFeatures | null; vector?: AssetVector | null };
export type AssetEntry = { readonly id: string; readonly name: string; readonly tags: readonly string[]; readonly text: string; readonly features: AssetFeatures | null; readonly hasVector: boolean };
/** `matches` are labels of the hints and words this asset fits; `similarity` is the embedding cosine (null without a vector) when a query vector was given. */
export type AssetSearchResult = { readonly id: string; readonly name: string; readonly score: number; readonly matches: readonly string[]; readonly similarity?: number | null };
export type AssetSearch = { readonly query: AssetQuery; readonly results: readonly AssetSearchResult[]; readonly unmatched: readonly string[]; readonly total: number };
export type SavedAssetIndex = {
    kind: 'optimai.asset-index';
    version: 1;
    model: string | null;
    dims: number | null;
    entries: Array<{ id: string; name?: string; tags?: string[]; text?: string; features?: AssetFeatures; vector?: string }>;
};
export type AssetIndex = {
    readonly model: string | null;
    readonly dims: number | null;
    readonly size: number;
    has(id: string): boolean;
    get(id: string): AssetEntry | null;
    ids(): string[];
    /** Add or replace an asset. Vectors need a named `model` and one length per index. */
    add(asset: AssetInput): AssetEntry;
    remove(id: string): boolean;
    clear(): void;
    /**
     * `calibrate` maps a cosine to a 0–1 match chance (SigLIP: `siglipMatchChance`); meaning then counts relative to the best match.
     * `vectorWeight` defaults to 0.7, or 0.4 when every word is a color, tone or shape word.
     */
    search(query: string | AssetQuery, options?: { vector?: AssetVector | null; vectorWeight?: number; calibrate?: ((cosine: number) => number) | null; limit?: number; minScore?: number }): AssetSearch;
    toJSON(): SavedAssetIndex;
};

/** The plain color family a searcher would give one sRGB pixel. */
export declare function colorFamily(r: number, g: number, b: number): AssetColorFamily;
/** Signature of RGBA thumbnail pixels (≤ 262,144); `aspect` is the original width ÷ height. */
export declare function describeImage(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, options?: { aspect?: number }): AssetFeatures;
/** Signature of a decoded image, video frame or canvas from a ≤ 64 px thumbnail, or null when pixels can't be read. */
export declare function readImageFeatures(source: CanvasImageSource, sourceWidth: number, sourceHeight: number): AssetFeatures | null;
/** Plain words → color, shade, tone and shape hints plus words to match names, tags and captions. */
export declare function parseAssetQuery(text: string): AssetQuery;
/** How well a signature fits one hint, 0–1, before negation. */
export declare function hintScore(features: AssetFeatures | null, hint: AssetHint): number;
/** A unit-length Float32Array copy; throws on a zero or non-finite vector. */
export declare function normalizeVector(vector: AssetVector): Float32Array;
export declare function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number;
/** An in-memory index; `model` names the embedding model its vectors come from. */
export declare function createAssetIndex(options?: { model?: string | null; dims?: number | null }): AssetIndex;
/** Rebuild a saved index; vectors from another model (or none) are dropped, entries stay searchable by look and name. */
export declare function loadAssetIndex(saved: SavedAssetIndex | string, options?: { model?: string | null }): { index: AssetIndex; dropped: { entries: number; vectors: number } };
