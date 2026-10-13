import type { FaceFrame } from './camera-runtime.mjs';
export type FaceTrackerOptions = { workerFactory: () => Worker; wasmBaseUrl: string; createBitmap?: (canvas: HTMLCanvasElement) => Promise<ImageBitmap>; onFace: (frame: FaceFrame) => void; onError: (message: string) => void; signal?: AbortSignal };
export type FaceTracker = { submit(canvas: HTMLCanvasElement, timestamp: number): boolean; dispose(): void };
export declare function createFaceTracker(modelBuffer: ArrayBuffer, options: FaceTrackerOptions): Promise<FaceTracker>;
