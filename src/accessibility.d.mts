export { createFlashLimiter, prefersReducedMotion } from './beat-tracker.mjs';
export type { FlashLimiter } from './beat-tracker.mjs';

export declare const REDUCED_MOTION_QUERY: '(prefers-reduced-motion: reduce)';
export type MotionPreferenceMode = 'system' | 'reduce' | 'full';
export declare const MOTION_PREFERENCES: readonly MotionPreferenceMode[];
export declare const FLASH_LIMITS: Readonly<{ maxFlashesPerSecond: 3; luminanceChange: number; darkerBelow: number; windowMs: number; samples: number; pixels: number }>;
export declare const ALT_TEXT_LIMIT: 300;

/** What a stage needs from a reduced-motion source; a real `MediaQueryList` also fits. */
export type MotionPreferenceLike = {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: (event: { matches: boolean }) => void): void;
  removeEventListener(type: 'change', listener: (event: { matches: boolean }) => void): void;
};
export type MotionPreference = MotionPreferenceLike & {
  readonly media: '(prefers-reduced-motion: reduce)';
  /** What the user chose in the app. */
  readonly preference: MotionPreferenceMode;
  /** What the device asks for, regardless of the override. */
  readonly system: boolean;
  set(preference: MotionPreferenceMode): void;
  dispose(): void;
};
/** A `MediaQueryList` look-alike for reduced motion with an in-app override. Safe without `matchMedia`. */
export function createMotionPreference(options?: { preference?: MotionPreferenceMode; scope?: { matchMedia?(query: string): unknown } }): MotionPreference;

export type AgentMotion = Readonly<{
  /** True when the agent animates on its own (turntable, orbit, visualizer, live effects). */
  moves: boolean;
  /** What reduced motion does: hold a calm cover, pause rotation, hold effects still, or nothing (`none`). */
  reduced: 'calm' | 'paused' | 'still' | 'none';
  /** One line a workspace can show; empty for still agents. */
  note: string;
}>;
export function getAgentMotion(id: string): AgentMotion;
/** The reduced-motion variant of an agent's settings. Fresh object; never adds keys a strict validator rejects. */
export function reducedMotionSettings<T extends Record<string, unknown>>(id: string, settings?: T): T & { rotating?: false; reducedMotion?: true; beatSync?: false; pulse?: 0 };

/** Mean WCAG relative luminance (0–1) of RGBA data, sampling at most 65,536 pixels. */
export function frameLuminance(data: ArrayLike<number>): number;
export type FlashSample = number | { time: number; luminance: number };
export type FlashReport = Readonly<{
  transitions: number;
  flashes: number;
  /** Most flashes in any one-second window. */
  maxFlashesPerSecond: number;
  worstAtMs: number | null;
  /** `maxFlashesPerSecond` is at most the limit (3 by default). Frame averages miss small-area and red flashes. */
  safe: boolean;
}>;
export function measureFlashes(samples: ArrayLike<FlashSample>, options?: { fps?: number; maxFlashesPerSecond?: number }): FlashReport;

/** "dark blue", "light grey", "white"… for a six-digit hex; empty for anything else. */
export function colorName(hex: string): string;
export type OutputDetails = {
  width?: number;
  height?: number;
  /** The title lines the engine actually drew. */
  lines?: string[];
  media?: 'image' | 'video';
  frames?: number;
  subject?: string;
  camera?: string;
  reducedMotion?: boolean;
};
/** Alt text (at most 300 characters) for an export, written from the settings that made it. */
export function describeAgentOutput(id: string, values?: Record<string, unknown>, details?: OutputDetails): string;
