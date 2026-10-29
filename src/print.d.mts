export type PrintLook = 'riso' | 'halftone' | 'floyd-steinberg' | 'bayer' | 'blue-noise';
export type PrintStyle = 'riso duotone' | 'halftone dots' | 'error diffusion' | 'ordered dither' | 'blue-noise grain';
export type RisoInkPair = 'pink + blue' | 'orange + teal' | 'yellow + purple' | 'red + black';
export declare const PRINT_LOOKS: readonly PrintLook[];
/** Recipe style names (the Print Shop `look` field) and the look each one draws. */
export declare const PRINT_STYLES: Readonly<Record<PrintStyle, PrintLook>>;
/** Riso-style ink pairs as screen approximations, first ink then second. */
export declare const RISO_INKS: Readonly<Record<RisoInkPair, readonly [string, string]>>;
export declare const PRINT_PAPER: '#f4efe6';
export declare const PRINT_INK: '#1f2433';
export declare const PRINT_LIMITS: Readonly<{ scale: 12; seed: 999999; pixels: 16000000 }>;
/** Default midtone lightening before screening, as prepress does for dot gain. */
export declare const PRINT_DOT_GAIN: 0.45;
export type PrintOptions = {
  /** A look or a recipe style name. Default `riso`. */
  look?: PrintLook | PrintStyle;
  /** Dither cell size in pixels, 1–12; halftone cells are four times this. Default 3. */
  scale?: number;
  /** How much of the print covers the original, 0 (untouched) to 100. Default 100. */
  amount?: number;
  /** Moves the blue-noise grain and the riso misregistration; 0–999999. Default 1. */
  seed?: number;
  /** Midtone lightening before screening, 0 (linear tone) to 1: coverage becomes x·(1 − g) + x²·g. Default 0.45. */
  dotGain?: number;
  /** Ink for the one-color looks, `#rrggbb`. Default `#1f2433`. */
  ink?: string;
  /** Paper, `#rrggbb`. Default `#f4efe6`. */
  paper?: string;
  /** Riso ink pair name, or two `#rrggbb` inks. Default `pink + blue`. */
  inks?: RisoInkPair | readonly [string, string];
};
export type PrintSettings = Readonly<{ look: PrintLook; scale: number; amount: number; seed: number; dotGain: number; ink: string; paper: string; inks: readonly [string, string] }>;
/** Validate print settings; recipe style names are accepted as aliases. */
export function resolvePrint(options?: PrintOptions): PrintSettings;
/** The recursive Bayer matrix (2, 4, 8 or 16 wide): ranks 0 … size² − 1, row by row. */
export function bayerMatrix(size?: 2 | 4 | 8 | 16): Uint16Array;
/** A tileable void-and-cluster blue-noise matrix (16, 32 or 64 wide): ranks 0 … size² − 1, row by row. A fresh copy each call. */
export function blueNoiseMatrix(size?: 16 | 32 | 64): Uint16Array;
/** Coverages [a, b] (0–1) of two `#rrggbb` inks that best reproduce an [r, g, b] color. */
export function separateDuotone(color: readonly [number, number, number] | readonly number[], inkA: string, inkB: string): [number, number];
/** Print an RGBA buffer into `out` (which may be the input). Alpha is kept. */
export function printPixels<T extends Uint8ClampedArray | Uint8Array = Uint8ClampedArray>(pixels: Uint8ClampedArray | Uint8Array, width: number, height: number, options?: PrintOptions, out?: T): T;
