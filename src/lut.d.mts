export declare const LUT_LIMITS: Readonly<{ size: 65; bytes: 16777216; title: 200; pixels: 16000000 }>;

/** A 3D LUT: `size`³ RGB entries on encoded sRGB, red fastest, then green, then blue. */
export type CubeLut = Readonly<{
  title: string;
  size: number;
  domainMin: readonly [number, number, number];
  domainMax: readonly [number, number, number];
  table: Float32Array;
}>;
export type FilmLook = 'golden' | 'teal-amber' | 'matte';
/** A film look as data: channel gains, saturation around luma, split tone, S-curve contrast, lifted black and soft white. */
export type FilmLookSettings = Readonly<{
  title: string;
  gain: readonly [number, number, number];
  saturation: number;
  shadow: readonly [number, number, number];
  highlight: readonly [number, number, number];
  contrast: number;
  black: number;
  white: number;
}>;

/** The built-in film looks as data. */
export declare const FILM_LOOKS: Readonly<Record<FilmLook, FilmLookSettings>>;
/**
 * Parse `.cube` text strictly: 3D only, LUT_3D_SIZE 2–65 before the table, optional TITLE, DOMAIN_MIN/DOMAIN_MAX or
 * LUT_3D_INPUT_RANGE, `#` comments, exactly size³ rows; up to 16 MiB. Errors name the line.
 */
export declare function parseCubeLut(text: string): CubeLut;
/** Write a LUT as `.cube` text with six decimals. */
export declare function formatCubeLut(lut: CubeLut): string;
/** Bake a transform of encoded sRGB (0–1) into a LUT; `size` 2–65 (33). */
export declare function createLut(transform: (rgb: [number, number, number]) => [number, number, number] | number[], options?: { size?: number; title?: string }): CubeLut;
/**
 * Apply a LUT to RGBA pixels in place (alpha kept) with trilinear interpolation and return them. `amount` (0–1, default 1)
 * mixes from the original; `rows: [start, end)` applies one band with results identical to a single pass.
 */
export declare function applyLut<T extends Uint8ClampedArray | Uint8Array>(rgba: T, width: number, height: number, lut: CubeLut, options?: { amount?: number; rows?: [number, number] }): T;
/** One `#rgb`/`#rrggbb` color through a LUT, as `#rrggbb`. */
export declare function lutColor(color: string, lut: CubeLut, amount?: number): string;
/** A built-in film look baked into a shared 33³ LUT. */
export declare function filmLut(name: FilmLook): CubeLut;
