import type { VisionOperation, VisionProgress } from './vision-runtime.mjs';
/** Host-injected pinned @mediapipe/tasks-vision namespace; it must not come from a submitted manifest. */
export declare function executeVisionTask(options: { vision: unknown; operation: VisionOperation; bitmap: ImageBitmap; modelBuffer: ArrayBuffer; wasmBaseUrl: string; values?: Record<string, string | number>; onProgress?: (progress: VisionProgress) => void }): Promise<{ blob: Blob; width: number; height: number; analysis: Record<string, unknown> }>;
export declare function personMaskAlpha(confidence: number, threshold?: number, softness?: number): number;
export declare function installVisionWorker(vision: unknown, scope?: unknown): void;
