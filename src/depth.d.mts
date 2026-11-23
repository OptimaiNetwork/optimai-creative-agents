/** Pixels a host read from a canvas: RGBA bytes, row by row. */
export type DepthPixels = { width: number; height: number; data: Uint8ClampedArray | Uint8Array };
/** A relative depth map, one value per pixel: 0 = far, 1 = near (not metres). */
export type DepthMap = { width: number; height: number; data: Float32Array; source?: 'model' | 'guess' | 'host' };
export type DepthWeightFile = Readonly<{ file: string; bytes: number; sha256: string }>;
export type DepthConfigFile = Readonly<{ bytes: number; gitSha1: string }>;
export type DepthDtype = 'fp32' | 'fp16' | 'q8' | 'int8' | 'uint8' | 'q4' | 'q4f16' | 'bnb4';
export type DepthDevice = 'webgpu' | 'wasm';
export type DepthCamera = 'locked' | 'slow push' | 'orbit' | 'tracking' | 'handheld';
export type DepthStrength = 'subtle' | 'medium';

/** The optional peer that runs the model, pinned. */
export declare const DEPTH_RUNTIME: Readonly<{ package: '@huggingface/transformers'; version: '4.3.2'; license: 'Apache-2.0' }>;
/** The smaller peer: ONNX Runtime Web alone, pinned. */
export declare const DEPTH_ORT_RUNTIME: Readonly<{ package: 'onnxruntime-web'; version: '1.31.1'; license: 'MIT' }>;
export type DepthPreprocess = Readonly<{ size: number; multiple: number; mean: readonly [number, number, number]; std: readonly [number, number, number] }>;
/** Depth Anything V2 Small (Apache-2.0) pinned to one Hub commit, with the size and hash of every file. */
export declare const DEPTH_MODEL: Readonly<{
  id: 'depth-anything-v2-small'; name: string; license: 'Apache-2.0'; repo: string; revision: string; host: string; inputSize: number;
  /** From the pinned preprocessor config. */
  preprocess: DepthPreprocess;
  config: Readonly<Record<'config.json' | 'preprocessor_config.json', DepthConfigFile>>;
  weights: Readonly<Record<DepthDtype, DepthWeightFile>>;
}>;
export declare const DEPTH_LIMITS: Readonly<{ pixels: number; inputSide: number; guessSide: number; depthPixels: number }>;
/** Recipe depth names → largest shift of the nearest layer, as a fraction of the short side. */
export declare const DEPTH_STRENGTHS: Readonly<Record<DepthStrength, number>>;
export declare const DEPTH_CAMERAS: readonly DepthCamera[];
export declare const DEPTH_MOTION_CLIP: Readonly<{ seconds: 4; fps: 30 }>;

export type DepthErrorCode = 'runtime-missing' | 'unverified-model' | 'download-failed' | 'load-failed' | 'unsupported-browser' | 'image-too-large' | 'bad-output' | 'closed';
export declare class DepthError extends Error {
  constructor(code: DepthErrorCode, message: string, options?: { cause?: unknown });
  name: 'DepthError';
  code: DepthErrorCode;
}

export type DepthModelFileMatch = { kind: 'weights' | 'config' | 'other'; path: string; spec: DepthWeightFile | DepthConfigFile | null; pinned: boolean };
/** Which pinned file a Hub URL names, or `null` for any other URL. */
export function depthModelFile(url: string, model?: typeof DEPTH_MODEL): DepthModelFileMatch | null;
/** The pinned URL of a model file. */
export function depthModelUrl(path: string, model?: typeof DEPTH_MODEL): string;
/** Check bytes against a pinned file: SHA-256 for weights, the Git blob id for config. */
export function verifyDepthFile(bytes: ArrayBuffer | ArrayBufferView, spec: DepthWeightFile | DepthConfigFile, options?: { subtle?: SubtleCrypto }): Promise<boolean>;

export type DepthProgressEvent = { stage: 'download' | 'verify'; file: string; loaded: number; total: number; cached?: boolean; model?: string };
/** The cache shape transformers.js reads from `env.customCache`. */
export type DepthModelCache = { match(request: string | Request): Promise<Response | undefined>; put(request: string | Request, response: Response): Promise<void> };
/** A transformers.js custom cache that serves only verified bytes for the pinned model and refuses other weights. */
export function createVerifiedModelCache(options?: {
  model?: typeof DEPTH_MODEL; fetch?: typeof fetch; caches?: CacheStorage; subtle?: SubtleCrypto;
  /** The host's own cache for every other URL. */
  fallback?: DepthModelCache | null;
  signal?: AbortSignal; onProgress?: (event: DepthProgressEvent) => void;
}): Readonly<DepthModelCache & { model: typeof DEPTH_MODEL; configBytes: number }>;
/** Whether the weights `depthModelPlan` would pick are already stored in this browser (they are checked again on load). */
export function isDepthModelCached(options?: { device?: DepthDevice; dtype?: DepthDtype; gpu?: boolean; caches?: CacheStorage }): Promise<boolean>;
/** WebGPU with fp16 when available, otherwise WebAssembly with q8; `bytes` is the download. */
export function depthModelPlan(options?: { device?: DepthDevice; dtype?: DepthDtype; gpu?: boolean }): Readonly<{ device: DepthDevice; dtype: DepthDtype; file: string; bytes: number }>;

/** Box-average down so the long side is at most `side`; returns the input when it fits. */
export function shrinkPixels(image: DepthPixels, side: number): DepthPixels;
/** Stretch to 0–1 between the 2nd and 98th percentile. */
export function normalizeDepth(depth: { width: number; height: number; data: ArrayLike<number>; source?: DepthMap['source'] }, options?: { invert?: boolean }): DepthMap;
/** A model-free stand-in: lower and busier reads as nearer. `source: 'guess'`. */
export function guessDepth(image: DepthPixels, options?: { side?: number }): DepthMap;
/** Grey RGBA of a depth map, near = white. */
export function depthToPixels(depth: DepthMap): { width: number; height: number; data: Uint8ClampedArray };

/** The model's input size for a picture: scale as little as possible, sides a multiple of 14. */
export function depthInputSize(width: number, height: number, preprocess?: Pick<DepthPreprocess, 'size' | 'multiple'>): { width: number; height: number };
/** RGBA pixels → the model's float32 NCHW input (bilinear resize, ImageNet normalize). */
export function depthInputTensor(image: DepthPixels, options?: { preprocess?: DepthPreprocess }): { data: Float32Array; dims: [1, 3, number, number]; width: number; height: number };

export type DepthEstimate = DepthMap & { source: 'model' | 'host'; model: string; inputWidth: number; inputHeight: number };
export type DepthEstimator = Readonly<{
  model: string; device: DepthDevice | 'host'; dtype: DepthDtype | 'host';
  estimate(image: DepthPixels, options?: { signal?: AbortSignal }): Promise<DepthEstimate>;
  dispose(): Promise<void>;
}>;
/**
 * Run Depth Anything V2 Small through the host's `onnxruntime-web` module, its `@huggingface/transformers` module, or a
 * depth-estimation function the host built. With either module, pinned files are fetched and verified by the SDK before they run.
 */
export function createDepthEstimator(options?: {
  /** The imported `onnxruntime-web` module (1.31.1). Falls back once from WebGPU to WebAssembly with q8 weights. */
  ort?: any;
  /** The imported `@huggingface/transformers` module (4.3.2). */
  transformers?: any;
  /** Or a ready depth-estimation function: `(image) => { depth } | { predicted_depth }`. */
  pipeline?: (image: any) => Promise<any>;
  device?: DepthDevice; dtype?: DepthDtype; gpu?: boolean;
  fetch?: typeof fetch; caches?: CacheStorage; subtle?: SubtleCrypto;
  signal?: AbortSignal; onProgress?: (event: DepthProgressEvent) => void;
}): Promise<DepthEstimator>;

export type DepthMotionSettings = Readonly<{ camera: DepthCamera; depth: DepthStrength | 'custom'; strength: number }>;
/** Depth Motion recipe values → settings (defaults: `slow push`, `subtle`). */
export function depthMotionSettings(values?: { camera?: DepthCamera; depth?: DepthStrength | number }): DepthMotionSettings;
/** Shift of the nearest layer (fraction of the short side), its extra scale and the depth that stays still. */
export type DepthView = { x: number; y: number; zoom: number; focus: number };
/** The camera view at `time` (0–1) through the clip. */
export function depthCameraAt(values: DepthMotionSettings | { camera?: DepthCamera; depth?: DepthStrength | number }, time: number): DepthView;
/** The scale-up that keeps every view in the clip free of borders. */
export function depthOverscan(values: DepthMotionSettings | { camera?: DepthCamera; depth?: DepthStrength | number }): number;
export type ParallaxRenderer = Readonly<{
  width: number; height: number;
  /** The prepared depth at the photo's size. */
  depth: Float32Array;
  render<T extends Uint8ClampedArray | Uint8Array = Uint8ClampedArray>(view?: Partial<DepthView>, out?: T): T;
}>;
/** Prepare a photo and its depth map, then warp it for any camera view (nearest layer wins; gaps stretch the background). */
export function createParallaxRenderer(image: DepthPixels, depth: DepthMap, options?: { overscan?: number }): ParallaxRenderer;
export type DepthMotionClip = Readonly<{
  canvas: HTMLCanvasElement | OffscreenCanvas; width: number; height: number; seconds: number; camera: DepthCamera; depth: DepthStrength | 'custom'; source: 'model' | 'guess' | 'host';
  view(index: number, frames: number): DepthView;
  /** Draw frame `index` of a `frames`-long clip. */
  draw(index: number, frames: number): void;
  close(): void;
}>;
/** Depth Motion as a video clip for `exportCanvasVideo`. */
export function createDepthMotionClip(options: { image: DepthPixels; depth: DepthMap; values?: DepthMotionSettings | { camera?: DepthCamera; depth?: DepthStrength | number }; seconds?: number; canvas?: HTMLCanvasElement | OffscreenCanvas }): DepthMotionClip;
