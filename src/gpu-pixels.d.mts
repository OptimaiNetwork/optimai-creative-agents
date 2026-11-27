import type { GradePreset, GradeSettings, ResolvedGrade } from './color-grade.mjs';
import type { CubeLut } from './lut.mjs';

export declare const GPU_PIXEL_LIMITS: Readonly<{ pixels: 16000000; workgroup: 64; dispatch: 65535 }>;
/** The WGSL compute shader: bindings 0 pixels (RGBA8 as u32), 1 settings, 2 decode table then LUT, 3 encode table. */
export declare const GPU_PIXEL_SHADER: string;

export type GpuPixelRun = {
  /** A preset name, partial settings or a `resolveGrade` result; omit (or null) for a LUT only. */
  grade?: GradePreset | Partial<GradeSettings> | ResolvedGrade | null;
  /** Grain seed, 0–4294967295 (0). */
  seed?: number;
  /** Applied after the grade; omit (or null) for a grade only. */
  lut?: CubeLut | null;
  /** LUT mix from the graded pixels, 0–1 (1). */
  amount?: number;
  /** `[start, end)` rows; the rest of the image is untouched. */
  rows?: [number, number];
  /** Stops a run still waiting in the queue. */
  signal?: AbortSignal;
};
export type GpuPixelProcessor = Readonly<{
  /** Where runs go now: `webgpu`, or `cpu` after WebGPU was missing, refused or lost. */
  readonly backend: 'webgpu' | 'cpu';
  /** Why the processor is on the CPU (empty on the graphics card). */
  readonly reason: string;
  /** Grade, then LUT, in place in one pass; resolves to the same array. Runs are queued in call order. */
  run<T extends Uint8ClampedArray | Uint8Array>(rgba: T, width: number, height: number, options?: GpuPixelRun): Promise<T>;
  /** `gradePixels` with the same arguments, resolved when done. */
  gradePixels<T extends Uint8ClampedArray | Uint8Array>(rgba: T, width: number, height: number, grade?: GradePreset | Partial<GradeSettings> | ResolvedGrade, options?: { seed?: number; rows?: [number, number]; signal?: AbortSignal }): Promise<T>;
  /** `applyLut` with the same arguments, resolved when done. */
  applyLut<T extends Uint8ClampedArray | Uint8Array>(rgba: T, width: number, height: number, lut: CubeLut, options?: { amount?: number; rows?: [number, number]; signal?: AbortSignal }): Promise<T>;
  /** Free the graphics buffers (and the device, unless it was passed in). */
  destroy(): void;
}>;

/**
 * A grade-and-LUT processor on WebGPU (`gpu` defaults to `navigator.gpu`; pass `device` to share one) that falls back to
 * the CPU functions, with the same results to within one level per channel. `fallback: false` throws instead.
 */
export declare function createGpuPixelProcessor(options?: { gpu?: { requestAdapter(options?: object): Promise<any> } | null; device?: any; powerPreference?: 'high-performance' | 'low-power'; fallback?: boolean; signal?: AbortSignal }): Promise<GpuPixelProcessor>;
/** The shader's 128-byte settings block for one run, and its flags (1 grade, 2 LUT, 4 grain). */
export declare function gpuPixelSettings(options: { width: number; start?: number; count: number; grade?: ResolvedGrade | null; seed?: number; lut?: CubeLut | null; amount?: number }): { buffer: ArrayBuffer; flags: number };
/** The `[x, y]` workgroup grid for a pixel count, within the per-dimension dispatch limit. */
export declare function gpuPixelDispatch(count: number): [number, number];
