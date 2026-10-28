export type TransitionStyle = 'wipe' | 'radial' | 'luma' | 'push' | 'dissolve';
export type TransitionDirection = 'right' | 'left' | 'down' | 'up';
export type TransitionEase = 'linear' | 'in-out' | 'out';
export type TransitionPace = 'quick' | 'gentle' | 'slow cinematic';
export type TransitionTechnique = 'match cut' | 'camera move' | 'light wipe' | 'morph';
export declare const TRANSITION_STYLES: readonly TransitionStyle[];
export declare const TRANSITION_DIRECTIONS: readonly TransitionDirection[];
export declare const TRANSITION_EASES: readonly TransitionEase[];
/** Recipe pace names: how soft the moving edge is (a quick cut is nearly hard; a slow one melts). */
export declare const TRANSITION_PACES: Readonly<Record<TransitionPace, Readonly<{ ease: TransitionEase; softness: number }>>>;
/** Recipe technique names (the Transition Lab `transition` field) and the style each one draws. */
export declare const TRANSITION_TECHNIQUES: Readonly<Record<TransitionTechnique, TransitionStyle>>;
export declare const TRANSITION_LIMITS: Readonly<{ frames: 12; pixels: 16000000 }>;
export type TransitionOptions = {
  style?: TransitionStyle;
  /** Wipe and push travel; ignored by radial, luma and dissolve. Default `right`. */
  direction?: TransitionDirection;
  /** Supplies `ease` and `softness` unless they are given. Default `gentle`. */
  pace?: TransitionPace;
  ease?: TransitionEase;
  /** Feathered edge width, 0 (hard) to 1, in the matte's 0–1 units. */
  softness?: number;
  /** Radial iris centre, as fractions of width and height. Default `[0.5, 0.5]`. */
  center?: readonly [number, number];
};
export type TransitionSettings = Readonly<{ style: TransitionStyle; direction: TransitionDirection; ease: TransitionEase; softness: number; center: readonly [number, number] }>;
/** Validate and complete transition settings. */
export function resolveTransition(options?: TransitionOptions): TransitionSettings;
/** Eased progress for a time from 0 to 1 (clamped); `in-out` is smoothstep, `out` a cubic ease-out. */
export function transitionProgress(time: number, ease?: TransitionEase): number;
/** `count` (2–12) evenly spaced times from 0 to 1 inclusive. */
export function transitionTimes(count: number): number[];
/** Compose one opaque frame of `from` → `to` at an eased progress into `out` (which may alias an input, except for push). */
export function composeTransition<T extends Uint8ClampedArray | Uint8Array = Uint8ClampedArray>(from: Uint8ClampedArray | Uint8Array, to: Uint8ClampedArray | Uint8Array, width: number, height: number, progress: number, options?: TransitionOptions, out?: T): T;
