export declare const OFFLINE_ANALYSER_LIMITS: Readonly<{ maximumSeconds: number; maximumSampleRate: number; maximumChannels: number }>;
export declare const OFFLINE_ANALYSER_DEFAULTS: Readonly<{ fftSize: 2048; smoothingTimeConstant: 0.8; minDecibels: -100; maxDecibels: -30 }>;
/** Decoded audio: a Web Audio `AudioBuffer`, or plain channels with their sample rate. */
export type OfflineAudioSource = { sampleRate: number; numberOfChannels: number; length?: number; getChannelData(channel: number): Float32Array } | { sampleRate: number; channels: readonly Float32Array[] };
export type OfflineAnalyserOptions = {
  /** Power of two from 32 to 32,768. Default 2048, like `AnalyserNode`. */
  fftSize?: number;
  /** 0–1, like `AnalyserNode.smoothingTimeConstant`. Default 0.8; pass 0 when an elapsed-time smoother runs after it. */
  smoothingTimeConstant?: number;
  minDecibels?: number;
  maxDecibels?: number;
};
export type OfflineAnalyser = Readonly<{
  sampleRate: number; fftSize: number; frequencyBinCount: number; smoothingTimeConstant: number; minDecibels: number; maxDecibels: number;
  /** Song length in seconds. */
  duration: number;
  /** 0–255 bytes for the moment `seconds`, matching a live `AnalyserNode.getByteFrequencyData`. */
  getByteFrequencyData<T extends Uint8Array>(out: T, seconds: number): T;
  /** Decibels (−Infinity for silence) for the moment `seconds`. */
  getFloatFrequencyData<T extends Float32Array>(out: T, seconds: number): T;
  /** Clear the smoothing history. */
  reset(): void;
}>;
/** In-place complex FFT (power-of-two length, forward, unscaled). */
export function fft<T extends Float64Array | Float32Array>(re: T, im: T): { re: T; im: T };
/** An offline `AnalyserNode` over decoded audio: read times in order for frame-by-frame video export. */
export function createOfflineAnalyser(audio: OfflineAudioSource, options?: OfflineAnalyserOptions): OfflineAnalyser;
