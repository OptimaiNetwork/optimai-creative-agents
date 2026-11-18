import type { ColorInput, PaletteSwatch } from './color.mjs';

export type PaletteSort = 'weight' | 'lightness' | 'hue';
export type PaletteOrder = 'by presence' | 'by lightness' | 'by hue';
export type PaletteFormat = 'css' | 'json' | 'ase' | 'gpl';
export declare const PALETTE_SORTS: readonly PaletteSort[];
/** Recipe order names (the Palette Pull `sort` field) and the order each one draws. */
export declare const PALETTE_ORDERS: Readonly<Record<PaletteOrder, PaletteSort>>;
export declare const PALETTE_LIMITS: Readonly<{ colors: 12; minColors: 2; name: 64; analysisEdge: 192; aseBytes: 1048576; aseColors: 4096 }>;
export declare const PALETTE_FORMATS: readonly PaletteFormat[];
/** One named color; `oklch` is `[L 0–1, C, h°]`, `css` its `oklch()` text, `weight` its share of the image (all sum to 1). */
export type PaletteColor = { readonly name: string; readonly hex: string; readonly oklch: readonly [number, number, number]; readonly css: string; readonly weight: number };
/** `background` is the most present color, `text` reads over it at 4.5:1, `accent` is the most vivid present color or null. */
export type PaletteRoles = { readonly background: string; readonly text: string; readonly accent: string | null };
export type Palette = { readonly name: string; readonly sort: PaletteSort; readonly colors: readonly PaletteColor[]; readonly roles: PaletteRoles };
export type PaletteFile = { readonly format: PaletteFormat; readonly filename: string; readonly type: string; readonly data: string | Uint8Array<ArrayBuffer> };

/** A plain English name such as `deep teal`, `pale pink` or `warm grey`. */
export declare function colorName(color: ColorInput): string;
/** CSS `oklch()` text, for example `oklch(62.4% 0.142 241.2)`. */
export declare function oklchCss(color: ColorInput): string;
/** Name, order and assign roles to 1–12 swatches (`dominantColors` output, `{ color, weight? }` or hex strings). */
export declare function buildPalette(
    swatches: Array<PaletteSwatch | { color: string; weight?: number } | { hex: string; weight?: number } | string>,
    options?: { sort?: PaletteSort | PaletteOrder; name?: string },
): Palette;
/** Pull a named palette of `count` (2–12) colors from RGBA thumbnail pixels. */
export declare function pullPalette(
    rgba: Uint8ClampedArray | Uint8Array,
    width: number,
    height: number,
    options?: { count?: number; sort?: PaletteSort | PaletteOrder; name?: string },
): Palette;
/** The thumbnail size a palette is read at (longest edge `PALETTE_LIMITS.analysisEdge`, never upscaled). */
export declare function palettePixelSize(width: number, height: number, edge?: number): { width: number; height: number };
/** CSS custom properties `--{prefix}-1…n`, `-bg`, `-text`, `-accent` in hex, upgraded to `oklch()` under `@supports`. */
export declare function paletteCss(palette: Palette, options?: { prefix?: string; selector?: string }): string;
/** `{ format: 'optimai.palette', version: 1, name, sort, colors, roles }` as pretty JSON. */
export declare function paletteJson(palette: Palette): string;
/** A GIMP `.gpl` palette. */
export declare function paletteGpl(palette: Palette): string;
/** Adobe Swatch Exchange (`.ase`) bytes: one group of global RGB swatches. */
export declare function paletteAse(palette: Palette): Uint8Array<ArrayBuffer>;
/** Read `.ase` bytes (RGB, gray, CMYK and Lab swatches); other models are counted in `skipped`. */
export declare function readAse(bytes: Uint8Array | ArrayBuffer): { name: string | null; colors: Array<{ name: string; hex: string }>; skipped: number };
/** Every requested export as `{ format, filename, type, data }`; ASE data is bytes, the rest text. */
export declare function paletteFiles(palette: Palette, options?: { formats?: readonly PaletteFormat[]; basename?: string; prefix?: string }): PaletteFile[];
