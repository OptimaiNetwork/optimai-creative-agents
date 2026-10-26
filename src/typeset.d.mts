export declare const TYPESET_LIMITS: Readonly<{ characters: 2000; size: 1000; lines: 200 }>;
/** `balance`: the minimum line count, every line as even as possible. `pretty`: paragraph style, no lone short last word. `greedy`: first fit. */
export type WrapMode = 'balance' | 'pretty' | 'greedy';
export declare const WRAP_MODES: readonly WrapMode[];
/** Width of `text` set at `fontSize`, in pixels, without letter spacing. Widths are assumed to scale with size. */
export type MeasureText = (text: string, fontSize: number) => number;
export type LineBreaks = { lines: string[]; /** Width of each line in pixels, tracking included. */ widths: number[] };
export type TitleLayout = LineBreaks & {
  fontSize: number;
  /** Baseline-to-baseline distance in pixels. */
  lineHeight: number;
  /** Letter spacing in pixels (for `context.letterSpacing`). */
  tracking: number;
  /** Widest line in pixels. */
  width: number;
  /** `lines.length × lineHeight`. */
  height: number;
  /** False when nothing from maxSize to minSize fits; the layout is then at minSize. */
  fits: boolean;
  /** True when a word wider than the measure had to be split between characters. */
  split: boolean;
};

/** Tracking (em) and leading (× size) for a display size: +0.01em / 1.25 at ≤16px easing to −0.02em / 1.08 at ≥128px. */
export declare function opticalSize(fontSize: number): { tracking: number; leading: number };
/** Break text into lines at one size. Hard `\n` breaks are kept; words wider than `width` split between characters. `tracking` is in em. */
export declare function breakLines(text: string, options: { measure: MeasureText; width: number; fontSize?: number; wrap?: WrapMode; tracking?: number }): LineBreaks;
/**
 * The largest size from `maxSize` down to `minSize` (default 1) at which `text` fits `width` × `height` in at most
 * `maxLines` lines, keeping words whole when any size allows it. Optical tracking and leading unless `tracking` (em)
 * or `leading` (× size) are given. `measure` is called once per word and character, at `maxSize`.
 */
export declare function fitTitle(text: string, options: { measure: MeasureText; width: number; maxSize: number; height?: number; minSize?: number; maxLines?: number; wrap?: WrapMode; leading?: number; tracking?: number }): TitleLayout;
/** A `measure` from a 2D context and a CSS font for a size; measures with `letterSpacing` reset to 0px. */
export declare function canvasMeasure(context: { font: string; measureText(text: string): { width: number }; letterSpacing?: string }, font: (fontSize: number) => string): MeasureText;
