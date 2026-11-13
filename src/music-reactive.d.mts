import type { OfflineAudioSource } from './offline-analyser.mjs';
export type MusicReactiveLook = 'orbital' | 'ribbons' | 'spectrum' | 'aurora';
export const MUSIC_REACTIVE_LOOKS: readonly Readonly<{ id: MusicReactiveLook; title: string; description: string }>[];
export const MUSIC_REACTIVE_LIMITS: Readonly<{ bands: 48; maxFrequencyBins: 16384; maxDimension: 4096; maxPixels: 8388608 }>;
/** Normalized analyser display signals; these are not loudness, BPM or beats. */
export interface MusicReactiveFeatures { energy: number; bass: number; treble: number; bands: number[] }
/** Supply the actual sample rate / FFT size even when the frequency buffer is shortened. */
export function extractMusicReactiveFeatures(frequencyBytes: Uint8Array, options?: { sampleRate?: number; fftSize?: number }): MusicReactiveFeatures;
/** Elapsed-time attack/release smoothing; null previous resets after a seek/source change. */
export function smoothMusicReactiveFeatures(previous: MusicReactiveFeatures | null, target: Partial<MusicReactiveFeatures>, elapsedMs: number, options?: { attackMs?: number; releaseMs?: number }): MusicReactiveFeatures;
export interface MusicReactiveFrame {
  width: number; height: number;
  /** Audio playback position in seconds. */
  time: number;
  energy: number; bass: number; treble: number;
  look: MusicReactiveLook | string;
  /** Normalized 0–1. */
  intensity: number;
  title?: string; artist?: string;
  /** Freezes motion and audio-driven geometry for a stable cover frame. */
  reducedMotion?: boolean;
  /** Optional 48 measured logarithmic frequency bands. */
  bands?: readonly number[];
  /** Beat pulse 0–1 (see beat-tracker). Swells geometry only; ignored with reducedMotion. */
  pulse?: number;
}
/** Draws a bounded frame and restores caller canvas state. No network or timers. */
export function renderMusicReactiveFrame(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, options: MusicReactiveFrame): void;
export type MusicReactiveRendererOptions = Partial<Omit<MusicReactiveFrame, 'time' | 'energy' | 'bass' | 'treble' | 'bands' | 'pulse'>> & {
  /** Video frame rate, above 0 and at most 120. Default 30. */
  fps?: number;
  /** Analyser FFT size. Default 2048, like the live preview. */
  fftSize?: number;
  /** Flash-limited beat pulse, as in playback. Default true. */
  beatSync?: boolean;
};
export type MusicReactiveRenderer = Readonly<{
  /** Song length in seconds. */ duration: number; fps: number; sampleRate: number;
  /** Frames that cover the song at `fps`. */ frames: number;
  /** Draw frame `index` (in order) onto `ctx`, as the live preview would have shown it at `index / fps`. */
  draw(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, index: number): void;
}>;
/** A music video drawn frame by frame from a decoded song, matching the live preview; for `exportCanvasVideo`. */
export function createMusicReactiveRenderer(audio: OfflineAudioSource, options?: MusicReactiveRendererOptions): MusicReactiveRenderer;
