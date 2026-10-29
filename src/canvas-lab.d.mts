import type { TextPosition, TextScrim, TitlePlacement } from './text-placement.mjs';
import type { GlitchEffect } from './glitch.mjs';
import type { PrintLook, RisoInkPair } from './print.mjs';
import type { TransitionDirection, TransitionPace, TransitionStyle } from './transition.mjs';
/** What Transition Lab drew; `requested` is set when a canvas without pixel reads fell back to a dissolve. */
export type DrawnTransition = { style: TransitionStyle; requested?: TransitionStyle; direction: TransitionDirection; pace: TransitionPace; /** Eased progress of the exported frame, 0–1. */ progress: number };
/** The whole move as one PNG of evenly spaced frames; `frames` holds each frame's time in percent. */
export type TransitionStrip = { blob: Blob; width: number; height: number; frames: number[] };
/** What Glitch Cut drew: `pixels` is the full seeded glitch; `bands` the seeded band shifts only, where a canvas cannot read pixels. */
export type DrawnGlitch = { effect: GlitchEffect; seed: number; amount: number; engine: 'pixels' | 'bands' };
/** What Print Shop drew: `inks` for a riso duotone, `ink` for the one-color looks. */
export type DrawnPrint = { look: PrintLook; scale: number; amount: number; seed: number; inks?: [string, string]; ink?: string; paper: string };
export const CANVAS_LAB_AGENTS: Readonly<Record<string, string>>;
/** Merge template defaults with explicit recipe values and normalize legacy aliases. */
export function canvasLabRecipeSettings(templateId: string, values?: Record<string, string | number>): ReturnType<typeof canvasLabSettings>;
export function canvasLabSettings(operation: string, values?: Record<string, string | number>): { operation: string; title: string; color: string; layout: string; ratio: string; treatment: string; amount: number; mix: number; crop: 'smart' | 'center'; ink: 'readable' | 'image' | 'exact'; position: TextPosition; scrim: 'auto' | 'off'; transition: TransitionStyle; direction: TransitionDirection; pace: TransitionPace; effect: GlitchEffect; seed: number; look: PrintLook; inks: RisoInkPair; scale: number; frames: number };
export function runCanvasLab(operation: string, files?: File[], values?: Record<string, string | number>, signal?: AbortSignal): Promise<{blob: Blob; width: number; height: number; filename: string; /** Title color actually drawn (poster and letter). */ ink?: string; /** Title lines as drawn (poster and letter). */ lines?: string[]; /** Where the title block was drawn (poster and letter). */ placement?: TitlePlacement; /** Scrim drawn behind the title, or null (poster and letter). */ scrim?: TextScrim | null; /** Transition drawn (transition only). */ transition?: DrawnTransition; /** Preview strip, or null when `frames` is 0 or pixels cannot be read (transition only). */ strip?: TransitionStrip | null; /** Glitch drawn, with the seed that reproduces it (glitch only). */ glitch?: DrawnGlitch; /** Print drawn, with the seed that reproduces its grain (print only). */ print?: DrawnPrint}>;
