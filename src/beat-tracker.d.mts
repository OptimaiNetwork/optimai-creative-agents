export type BeatTrackerOptions = {
  /** AudioContext.sampleRate and AnalyserNode.fftSize. */
  sampleRate?: number; fftSize?: number;
  /** Tempo search range; maxBpm must be at least 1.25 × minBpm. */
  minBpm?: number; maxBpm?: number;
  /** Median-threshold multiplier, 1–4 (higher = fewer onsets). */
  sensitivity?: number;
  /** Tempo confidence (0–1) needed before the beat clock locks. */
  minConfidence?: number;
  /** WCAG 2.3.1 cap on visual pulses; clamped to at most 3. */
  maxFlashesPerSecond?: number;
  /** Pulse decay time constant in ms. */
  pulseMs?: number;
  /** Keep tempo and beats but turn the visual pulse off. */
  reducedMotion?: boolean;
};
export declare const BEAT_TRACKER_DEFAULTS: Readonly<{ minBpm: number; maxBpm: number; sensitivity: number; minConfidence: number; maxFlashesPerSecond: number; pulseMs: number }>;
export declare const BEAT_TRACKER_LIMITS: Readonly<{ bands: 24; maxFrequencyBins: 16384; thresholdMs: 1000; historyMs: 8000; maxOnsets: 64; minOnsetGapMs: 100 }>;
/** 24 log bands (30 Hz to 11 kHz), normalized 0–1; fills and returns `out` when given. */
export declare function logBandSpectrum(frequencyBytes: Uint8Array, options?: { sampleRate?: number; fftSize?: number }, out?: Float32Array): Float32Array;
/** Half-wave rectified mean rise per band, 0–1. */
export declare function spectralFlux(previous: ArrayLike<number>, current: ArrayLike<number>): number;
export type TempoEstimate = { bpm: number; periodMs: number; confidence: number };
/** Tempo from onset times in ms (inter-onset autocorrelation); bpm is 0 below four onsets. */
export declare function estimateTempo(onsetTimesMs: readonly number[], options?: { minBpm?: number; maxBpm?: number; weights?: readonly number[] }): TempoEstimate;
export type FlashLimiter = { allow(timeMs: number): boolean; reset(): void; readonly minGapMs: number };
/** WCAG 2.3.1: at most `maxFlashesPerSecond` (≤ 3) evenly spaced flashes per second. */
export declare function createFlashLimiter(options?: { maxFlashesPerSecond?: number }): FlashLimiter;
/** Reads `(prefers-reduced-motion: reduce)`; false where matchMedia is absent. */
export declare function prefersReducedMotion(scope?: { matchMedia?(query: string): { matches: boolean } }): boolean;
export type BeatFrame = {
  time: number; flux: number; threshold: number;
  /** A new onset was detected in this frame; strength is 0–1. */
  onset: boolean; strength: number;
  /** 0 until the clock locks. */
  bpm: number; confidence: number; locked: boolean;
  /** A predicted beat fell in this frame; phase is 0 on a beat, rising to 1. */
  beat: boolean; beatCount: number; phase: number;
  /** Flash-limited beat (false with reduced motion) and its decaying 0–1 envelope. */
  flash: boolean; pulse: number;
};
export type BeatTracker = { push(frequencyBytes: Uint8Array, timeMs: number): BeatFrame; reset(): void; reducedMotion: boolean; readonly bpm: number };
export declare function createBeatTracker(options?: BeatTrackerOptions): BeatTracker;
