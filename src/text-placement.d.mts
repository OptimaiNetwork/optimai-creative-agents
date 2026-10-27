import type { FocusMap } from './smart-crop.mjs';

/** `auto` moves a title to the calmest region; the others are fixed. */
export type TextPosition = 'auto' | 'top' | 'center' | 'bottom';
export declare const TEXT_POSITIONS: readonly TextPosition[];
export declare const PLACEMENT_LIMITS: Readonly<{ maxSteps: 33; maxOpacity: 0.85 }>;

export type Size = { width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type TextPlacement = Rect & {
  /** The vertical third the block's centre is in. */
  position: 'top' | 'center' | 'bottom';
  /** Interest under the block (with its breathing room), relative to the image mean: 0 calm, 1 average. */
  interest: number;
  /** The same, at the home spot. */
  homeInterest: number;
  /** True when the block left its home spot. */
  moved: boolean;
};
/** Where an engine drew a title block, in output pixels, as reported by Poster Lab, Letter Pose and Title Frame. */
export type TitlePlacement = { position: 'top' | 'center' | 'bottom'; x: number; y: number; moved: boolean };
/** A scrim behind a title: a solid color at an opacity, drawn with `source-over`. */
export type TextScrim = { color: string; opacity: number };
export type FittedScrim = TextScrim & {
  /** Worst WCAG contrast of the ink over the scrimmed backgrounds. */
  contrast: number;
  passes: boolean;
  /** The backgrounds as seen through the scrim. */
  surfaces: string[];
};
type Background = string | [number, number, number] | { color: string };

/** Interest under a canvas-pixel region relative to the image mean (0 calm, 1 average); `canvas` is the size the map covers. */
export declare function regionInterest(focus: FocusMap, region: Rect, canvas: Size): number;
/**
 * Where to put a title block: the calmest spot inside `bounds` for `auto`, or a fixed `top`, `center` or `bottom`.
 * `home` ({ x, y }, 0–1 across the free space, default bottom-left) is the usual spot; `homeBias` (default 0.25)
 * is the cost of moving all the way across in units of average interest; the block moves only when at least `minGain`
 * (default 0.25) calmer. A missing or flat focus map stays home.
 */
export declare function placeTextBlock(
  focus: FocusMap | null,
  options: { canvas: Size; block: Size; bounds?: Rect; position?: TextPosition; home?: { x?: number; y?: number }; homeBias?: number; minGain?: number; columns?: number; rows?: number; breathing?: number },
): TextPlacement;
/** The lightest scrim (black behind light ink, white behind dark ink) that lifts `ink` to `minContrast` (default 3), or null when it already passes. */
export declare function fitScrim(backgrounds: Background | Background[], ink: string, options?: { minContrast?: number; minOpacity?: number; maxOpacity?: number; color?: string }): FittedScrim | null;
/**
 * Ink and optional scrim for a title: keep a passing preferred color, accept a lightness move of at most `maxShift`
 * (OKLab L, default 0.08), otherwise keep the first preferred color behind a scrim (`scrim: false` only moves lightness). Scrims are at least `minOpacity` (default 0.15).
 */
export declare function chooseTitleInk(
  surfaces: Background[],
  options?: { prefer?: Array<string | null | undefined>; minContrast?: number; scrim?: boolean; maxShift?: number; minOpacity?: number; maxOpacity?: number },
): { ink: string; scrim: TextScrim | null; surfaces: string[] };
