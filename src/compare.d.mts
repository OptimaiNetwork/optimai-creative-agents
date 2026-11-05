/** An RGBA image: `ImageData` or any `{ data, width, height }` with width × height × 4 bytes. */
export type CompareImage = { data: ArrayLike<number>; width: number; height: number };
export type CompareRect = Readonly<{ x: number; y: number; width: number; height: number }>;
export type CompareOptions = {
  /** Longest side of the sampled grid (16–2048, default 512). */
  maxSide?: number;
  /** A grid pixel counts as changed when its largest channel moves more than this (0–254, default 8). */
  threshold?: number;
  /** SSIM window size in grid pixels (2–32, default 8). */
  window?: number;
  /** Also return an RGBA heatmap of the change on the grid. */
  diff?: boolean;
};
export type Comparison = Readonly<{
  width: number; height: number; grid: Readonly<{ width: number; height: number }>;
  sameSize: boolean; identical: boolean; threshold: number;
  /** Share of grid pixels that changed (0–1). */
  changed: number;
  /** Mean and peak channel change (0–1). */
  meanDelta: number; maxDelta: number;
  /** Peak signal-to-noise ratio in dB; `Infinity` when identical. */
  psnr: number;
  /** SSIM-lite on luma (−1…1; 1 is the same structure). */
  ssim: number;
  /** Mean OKLab colour distance per pixel. */
  deltaE: number;
  /** The overall look on a ≤24-pixel grid, where grain, dither and dot patterns average out: mean OKLab shift and SSIM-lite. */
  overall: Readonly<{ deltaE: number; ssim: number }>;
  /** The changed region in `a`'s pixels, or null. */
  bounds: CompareRect | null;
  diff?: Readonly<{ data: Uint8ClampedArray; width: number; height: number }>;
}>;
export type SplitView = Readonly<{
  position: number; orientation: 'horizontal' | 'vertical';
  before: CompareRect; after: CompareRect;
  line: Readonly<{ x1: number; y1: number; x2: number; y2: number }>;
  /** CSS `inset()` that shows the `before` layer over a stacked `after` layer. */
  clipPath: string;
}>;
/** Anything `compareImages` can decode in a browser. */
export type ComparableSource = CompareImage | Blob | string | CanvasImageSource;
export declare const COMPARE_LIMITS: Readonly<{ maxSide: number; minSide: number; maxSampleSide: number; window: number; threshold: number; overallSide: number; maxInputPixels: number }>;
export declare function compareGrid(a: { width: number; height: number }, b: { width: number; height: number }, maxSide?: number): { width: number; height: number };
export declare function compareOutputs(a: CompareImage, b: CompareImage, options?: CompareOptions): Comparison;
export declare function describeComparison(result: Comparison | null | undefined): string;
export declare function splitView(position?: number, width?: number, height?: number, options?: { orientation?: 'horizontal' | 'vertical' }): SplitView;
export declare function stepSplit(position: number, key: string, options?: { step?: number }): number | undefined;
export declare function compareImages(a: ComparableSource, b: ComparableSource, options?: CompareOptions & { signal?: AbortSignal }): Promise<Comparison>;
