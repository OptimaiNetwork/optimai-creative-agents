export declare const MATTE_DEFAULTS: Readonly<{ radius: number; epsilon: number; band: number; maxSide: number; foreground: boolean }>;
export declare const MATTE_LIMITS: Readonly<{ minRadius: number; maxRadius: number; minEpsilon: number; maxEpsilon: number; minBand: number; maxBand: number; minSide: number; maxSide: number; maxPixels: number }>;
export type MatteOptions = {
  /** Window radius on the working grid; 0 (default) picks about 1/80 of its long side. */
  radius?: number;
  /** How much colour change counts as an edge (0–1 colour units, squared). Smaller follows finer detail. */
  epsilon?: number;
  /** Half-width around alpha 0.5 kept soft after filtering; 0.5 keeps the filter's own ramp. */
  band?: number;
  /** Long side of the working grid (64–1024). The result is always full size. */
  maxSide?: number;
  /** `apply` only: remove the old background from edge colours (blur-fusion foreground estimate). */
  foreground?: boolean;
};
export type MatteImage = { data: Uint8ClampedArray | Uint8Array | number[]; width: number; height: number };
/** One value per pixel at any size: float arrays are read as 0–1, byte arrays as 0–255. */
export type MatteMask = { data: Float32Array | Float64Array | Uint8ClampedArray | Uint8Array; width: number; height: number };
export type MatteResult = Readonly<{ alpha: Uint8ClampedArray; width: number; height: number; coverage: number; radius: number; epsilon: number; band: number; workWidth: number; workHeight: number }>;
export declare function resolveMatteOptions(options?: MatteOptions): Required<MatteOptions>;
export declare function matteWorkSize(width: number, height: number, maxSide?: number): { width: number; height: number };
/** Mean over a (2r+1)² window clamped at the borders, in linear time for any radius. */
export declare function boxMean(src: ArrayLike<number>, width: number, height: number, radius: number, out?: Float32Array, tmp?: Float32Array): Float32Array;
/** The full-size refined alpha (0–255) for an RGBA image from a coarse mask of any size. */
export declare function refineMatte(image: MatteImage, mask: MatteMask, options?: MatteOptions): MatteResult;
/** Refine, clean edge colours (unless `foreground: false`) and write alpha into `image.data` in place. */
export declare function applyMatte(image: MatteImage, mask: MatteMask, options?: MatteOptions): MatteResult;
export type MatteRefiner = { refine(image: MatteImage, mask: MatteMask, options?: MatteOptions): MatteResult; apply(image: MatteImage, mask: MatteMask, options?: MatteOptions): MatteResult; dispose(): void };
/** Keeps scratch planes between calls (one per video stream); `defaults` apply to every call. */
export declare function createMatteRefiner(defaults?: MatteOptions): MatteRefiner;
