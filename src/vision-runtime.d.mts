export type VisionOperation = 'person-cutout' | 'pose-reference' | 'face-reference';
/** A canonical progress event (`stage`, see `progress.d.mts`) that keeps the legacy `phase`; downloads carry `loaded`/`total` bytes. */
export type VisionProgress = { stage: 'download' | 'verify' | 'ready' | 'prepare' | 'warmup' | 'analyze' | 'render'; /** @deprecated Use `stage` (`initialize` is now `warmup`). */ phase: 'download' | 'verify' | 'ready' | 'prepare' | 'initialize' | 'analyze' | 'render'; message: string; progress?: number; loaded?: number; total?: number };
export type VisionModel = { readonly id: string; readonly name: string; readonly bytes: number; readonly sha256: string; readonly url: string; readonly task: string };
export type VisionModelStatus = { operation: VisionOperation; model: VisionModel; ready: boolean; storage: string | null };
export type VisionResult = { blob: Blob; filename: string; width: number; height: number; operation: VisionOperation; model: string; provider: 'mediapipe'; originalSize: { width: number; height: number }; analysis: Record<string, unknown> };
export declare const VISION_MODELS: Readonly<Record<VisionOperation, VisionModel>>;
export declare const VISION_LIMITS: Readonly<Record<string, number>>;
export declare class VisionError extends Error { code: string; constructor(code: string, message: string); }
export declare function getVisionAnalysisSize(width: number, height: number): { width: number; height: number };
export declare function normalizeVisionValues(operation: VisionOperation, values?: Record<string, string | number>): Record<string, string | number>;
export declare function getVisionModelStatus(operation: VisionOperation, options?: { signal?: AbortSignal }): Promise<VisionModelStatus>;
export declare function downloadVisionModel(operation: VisionOperation, options?: { signal?: AbortSignal; onProgress?: (progress: VisionProgress) => void; fetchImpl?: typeof fetch }): Promise<VisionModelStatus>;
/** Owned verified bytes. Cache-only mode never starts a network request. */
export declare function loadVisionModelBuffer(operation: VisionOperation, options?: { signal?: AbortSignal; onProgress?: (progress: VisionProgress) => void; fetchImpl?: typeof fetch; downloadIfMissing?: boolean }): Promise<ArrayBuffer>;
export declare function runBrowserVision(operation: VisionOperation, file: File, values?: Record<string, string | number>, options?: { signal?: AbortSignal; onProgress?: (progress: VisionProgress) => void; workerFactory: () => Worker; wasmBaseUrl: string }): Promise<VisionResult>;
