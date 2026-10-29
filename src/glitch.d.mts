export type GlitchEffect = 'blocks' | 'trails' | 'echoes';
export type GlitchTreatment = 'block displacement' | 'colour trails' | 'frame echoes';
export declare const GLITCH_EFFECTS: readonly GlitchEffect[];
/** Recipe treatment names (the Glitch Cut `effect` field) and the effect each one draws. */
export declare const GLITCH_TREATMENTS: Readonly<Record<GlitchTreatment, GlitchEffect>>;
export declare const GLITCH_LIMITS: Readonly<{ seed: 999999; pixels: 16000000 }>;
export type GlitchOptions = {
  /** An effect or a recipe treatment name. Default `blocks`. */
  effect?: GlitchEffect | GlitchTreatment;
  /** Strength, 0 (untouched) to 100. Default 35. */
  amount?: number;
  /** Whole number from 0 to 999999. Default 1. */
  seed?: number;
};
export type GlitchSettings = Readonly<{ effect: GlitchEffect; amount: number; seed: number }>;
export type GlitchBand = Readonly<{ y: number; height: number; shift: number }>;
export type GlitchBlock = Readonly<{ x: number; y: number; width: number; height: number; dx: number; dy: number }>;
export type GlitchEcho = Readonly<{ dx: number; dy: number; alpha: number }>;
/** The deterministic layout of one glitch at one size. */
export type GlitchPlan = Readonly<GlitchSettings & {
  width: number; height: number;
  bands: readonly GlitchBand[]; blocks: readonly GlitchBlock[]; echoes: readonly GlitchEcho[];
  /** Red leads and blue trails by this many pixels. */ split: number;
  /** 1, or 3 for a smeared colour trail. */ taps: 1 | 3;
  /** Every other `period / 2` rows are darkened by `depth / 256`. */ scanlines: Readonly<{ period: number; depth: number }>;
}>;
/** The mulberry32 generator: floats in [0, 1) from a 32-bit seed. */
export function mulberry32(seed: number): () => number;
/** A fresh seed (0–999999) for a new look. */
export function randomGlitchSeed(): number;
/** Validate glitch settings; recipe treatment names are accepted as aliases. */
export function resolveGlitch(options?: GlitchOptions): GlitchSettings;
/** The same seed, effect, amount and size always give the same plan. */
export function planGlitch(width: number, height: number, options?: GlitchOptions): GlitchPlan;
/** Glitch an RGBA buffer into `out` (which may be the input). Pass options or a plan made for this size. */
export function glitchPixels<T extends Uint8ClampedArray | Uint8Array = Uint8ClampedArray>(pixels: Uint8ClampedArray | Uint8Array, width: number, height: number, options?: GlitchOptions | GlitchPlan, out?: T): T;
