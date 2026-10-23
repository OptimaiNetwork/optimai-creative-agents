export declare const COLOR_LIMITS: Readonly<{ analysisEdge: 64; maxPixels: 262144; maxColors: 12; maxSurfaces: 64; iterations: 10 }>;

/** A `#rgb` / `#rrggbb` string or an sRGB `[r, g, b]` array with 0–255 channels. */
export type ColorInput = string | [number, number, number] | number[];
/** One dominant color; weights in a palette sum to 1. */
export type PaletteSwatch = { color: string; weight: number; oklch: [number, number, number] };
/** Text color chosen by `pickLegibleColor`; `contrast` and `lightness` are the worst case over the backgrounds. */
export type LegibleColor = { color: string; contrast: number; lightness: number; passes: boolean; adjusted: boolean };

/** Parse `#rgb` or `#rrggbb` into `[r, g, b]`. */
export declare function parseHexColor(hex: string): [number, number, number];
/** Format a color (rounded and clamped) as `#rrggbb`. */
export declare function formatHexColor(color: ColorInput): string;
/** WCAG 2.x relative luminance, 0–1. */
export declare function relativeLuminance(color: ColorInput): number;
/** WCAG 2.x contrast ratio, 1–21. */
export declare function contrastRatio(a: ColorInput, b: ColorInput): number;
/** OKLab `[L, a, b]`. */
export declare function toOklab(color: ColorInput): [number, number, number];
/** OKLCH `[L, C, h]`, hue in degrees (0 for neutrals). */
export declare function toOklch(color: ColorInput): [number, number, number];
/** Hex for OKLab `[L, a, b]`, gamut-mapped by lowering chroma. */
export declare function fromOklab(lab: [number, number, number] | number[]): string;
/** Hex for OKLCH `[L, C, h]`, gamut-mapped by lowering chroma. */
export declare function fromOklch(lch: [number, number, number] | number[]): string;
/** Mix in OKLab; `amount` 0 returns `a`, 1 returns `b` (default 0.5). */
export declare function mixColors(a: ColorInput, b: ColorInput, amount?: number): string;
/** Polarity-aware OKLab lightness contrast, about −100 to +100; positive means darker text on a lighter background. Not APCA. */
export declare function lightnessContrast(text: ColorInput, background: ColorInput): number;
/** A text color that meets `minContrast` (WCAG, default 4.5) over every background, keeping a preferred color or only moving its lightness. */
export declare function pickLegibleColor(
    backgrounds: ColorInput | Array<ColorInput | { color: ColorInput }>,
    options?: { prefer?: ColorInput | Array<ColorInput | null | undefined>; minContrast?: number },
): LegibleColor;
/** Deterministic OKLab k-means palette of RGBA pixels, largest first. */
export declare function dominantColors(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, options?: { count?: number }): PaletteSwatch[];
/** The most vivid swatch that is also present, or null for a near-neutral palette. */
export declare function pickAccentColor(palette: Array<{ color: ColorInput; weight: number }>, options?: { minChroma?: number; minWeight?: number }): string | null;
/** Dominant colors of an image or a source-pixel `region` of it, read from a 64-pixel thumbnail; null when pixels cannot be read. */
export declare function analyzeImageColors(
    source: CanvasImageSource,
    sourceWidth: number,
    sourceHeight: number,
    options?: { region?: { x: number; y: number; width: number; height: number }; count?: number },
): PaletteSwatch[] | null;
