import type { DepthConfigFile, DepthProgressEvent, DepthWeightFile } from './depth.mjs';

export type AssetEmbedderDevice = 'webgpu' | 'wasm';
export type AssetEmbedderDtype = 'q8' | 'q4f16' | 'fp16';
export type AssetEmbedderPart = 'vision' | 'text';
export type AssetEmbedderErrorCode = 'runtime-missing' | 'unverified-model' | 'download-failed' | 'load-failed' | 'unsupported-browser' | 'image-too-large' | 'bad-output' | 'closed';

/** The optional peer that runs the encoders: ONNX Runtime Web, pinned (shared with depth). */
export declare const ASSET_EMBEDDER_RUNTIME: Readonly<{ package: 'onnxruntime-web'; version: '1.31.1'; license: 'MIT' }>;
/** Google SigLIP base, patch 16, 224 px (Apache-2.0) as one pinned ONNX export, with every file hashed. */
export declare const SIGLIP_MODEL: Readonly<{
    id: 'siglip-base-patch16-224'; name: string; license: 'Apache-2.0'; author: 'Google'; source: 'google/siglip-base-patch16-224';
    repo: string; revision: string; host: string;
    /** The `model` name for `createAssetIndex`, so vectors from any other model are never compared with these. */
    index: string;
    dims: 768; textLength: 64; template: string;
    preprocess: Readonly<{ size: 224; mean: readonly [number, number, number]; std: readonly [number, number, number] }>;
    /** SigLIP's match calibration: chance = sigmoid(scale × cosine + bias). */
    logit: Readonly<{ scale: number; bias: number }>;
    tokens: Readonly<{ pad: 1; eos: 1; unk: 2 }>;
    config: Readonly<{ 'tokenizer.json': DepthConfigFile }>;
    weights: Readonly<Record<`${AssetEmbedderPart}-${AssetEmbedderDtype}`, DepthWeightFile>>;
}>;
export declare const ASSET_EMBEDDER_DTYPES: readonly AssetEmbedderDtype[];
export declare const ASSET_EMBEDDER_LIMITS: Readonly<{ pixels: number; text: number; vocab: number; piece: number }>;
export declare class AssetEmbedderError extends Error {
    constructor(code: AssetEmbedderErrorCode, message: string, options?: { cause?: unknown });
    name: 'AssetEmbedderError';
    code: AssetEmbedderErrorCode;
}

/** Lowercase, no ASCII punctuation, single spaces, NFKC: how SigLIP's text was prepared. */
export declare function canonicalSiglipText(text: unknown): string;
export type SiglipTokenizer = Readonly<{
    size: number;
    length: number;
    /** Piece ids for already-canonical text. */
    split(text: string): number[];
    /** Canonicalized, split, `</s>`-terminated and padded to `length` ids; `count` includes `</s>`. */
    encode(text: string): { ids: number[]; count: number };
}>;
/** A SentencePiece Unigram tokenizer over a `tokenizer.json` (Viterbi split, UTF-8 byte fallback, fixed length). */
export declare function createSiglipTokenizer(json: string | object, options?: { length?: number }): SiglipTokenizer;
/** RGBA pixels → float32 NCHW `[1, 3, 224, 224]` in −1…1, squashed to the square. */
export declare function siglipImageTensor(image: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }, options?: { preprocess?: typeof SIGLIP_MODEL.preprocess }): { data: Float32Array; dims: [1, 3, number, number] };
/** SigLIP's own match probability for a cosine, 0–1. Pass it as `calibrate` to `AssetIndex.search`. */
export declare function siglipMatchChance(cosine: number): number;

export type AssetEmbedderPartPlan = Readonly<{ device: AssetEmbedderDevice; dtype: AssetEmbedderDtype; file: string; bytes: number }>;
export type AssetEmbedderPlan = Readonly<{ vision: AssetEmbedderPartPlan; text: AssetEmbedderPartPlan; bytes: number }>;
export type AssetEmbedderPartChoice = { device?: AssetEmbedderDevice; dtype?: AssetEmbedderDtype };
/** Pictures on WebGPU (q4f16) when available, else WebAssembly (q8); searches on WebAssembly (q8). q8 on WebGPU is refused. */
export declare function assetEmbedderPlan(options?: { vision?: AssetEmbedderPartChoice; text?: AssetEmbedderPartChoice; gpu?: boolean }): AssetEmbedderPlan;
/** Which halves of the planned model are already stored in this browser (checked again when they load). */
export declare function isAssetEmbedderCached(options?: { vision?: AssetEmbedderPartChoice; text?: AssetEmbedderPartChoice; gpu?: boolean; caches?: CacheStorage }): Promise<{ vision: boolean; text: boolean }>;

export type AssetEmbedderProgressEvent = DepthProgressEvent & { part: AssetEmbedderPart; model: 'siglip-base-patch16-224' };
export type AssetEmbedder = Readonly<{
    model: 'siglip-base-patch16-224';
    index: string;
    dims: 768;
    /** Where each half runs now (a WebGPU half that failed to start shows its WebAssembly fallback). */
    readonly plan: AssetEmbedderPlan;
    ready(part: AssetEmbedderPart): boolean;
    prepare(part?: AssetEmbedderPart): Promise<void>;
    embedImage(image: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }, options?: { signal?: AbortSignal }): Promise<Float32Array>;
    embedText(text: string, options?: { signal?: AbortSignal }): Promise<Float32Array>;
    matchChance(cosine: number): number;
    dispose(): Promise<void>;
}>;
/** Minimal shape of the `onnxruntime-web` module the embedder needs. */
export type AssetEmbedderOrt = {
    Tensor: new (type: 'float32' | 'int64', data: Float32Array | BigInt64Array, dims: number[]) => unknown;
    InferenceSession: { create(model: Uint8Array, options?: object): Promise<{ inputNames: readonly string[]; outputNames: readonly string[]; run(feeds: Record<string, unknown>): Promise<Record<string, { data: ArrayLike<number | bigint>; dispose?(): void }>>; release?(): Promise<void> }> };
};
/** Lazy SigLIP embeddings on the host's ONNX Runtime Web: nothing downloads until `prepare` or the first embed. */
export declare function createAssetEmbedder(options: {
    ort: AssetEmbedderOrt;
    vision?: AssetEmbedderPartChoice;
    text?: AssetEmbedderPartChoice;
    gpu?: boolean;
    fetch?: typeof fetch;
    caches?: CacheStorage | null;
    subtle?: SubtleCrypto | { digest(algorithm: string, data: BufferSource): Promise<ArrayBuffer> };
    signal?: AbortSignal;
    onProgress?: (event: AssetEmbedderProgressEvent) => void;
    /** Where the search goes, default "a photo of {}". */
    template?: string;
}): AssetEmbedder;
