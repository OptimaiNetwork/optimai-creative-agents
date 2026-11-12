import type { ProgressEvent } from './progress.mjs';
/**
 * Video export for canvas agents: probe the best local path, encode frame by frame with WebCodecs through the
 * optional `mediabunny` peer, or record in real time with MediaRecorder using the honest-recording helpers.
 */
export declare const VIDEO_EXPORT_LIMITS: Readonly<{ maximumSeconds: 300; maximumInputBytes: number; maximumOutputBytes: number; maximumSide: 4096; maximumFps: 120; setupTimeoutMs: 15000; seekTimeoutMs: 5000 }>;
export declare const RECORDER_VIDEO_TYPES: readonly string[];
export type VideoContainer = 'mp4' | 'webm';
/** mediabunny codec names the WebCodecs path uses. */
export type ExportVideoCodec = 'avc' | 'vp9' | 'vp8' | 'av1' | 'hevc';
export type ExportAudioCodec = 'aac' | 'opus';
export type VideoExportFormat = Readonly<{ container: VideoContainer; mime: string; extension: VideoContainer; video: readonly ExportVideoCodec[]; audio: readonly ExportAudioCodec[] }>;
export declare const VIDEO_EXPORT_FORMATS: Readonly<Record<VideoContainer, VideoExportFormat>>;
export type VideoExportErrorCode = 'setup-timeout' | 'source-unavailable' | 'source-too-large' | 'source-empty' | 'media-error' | 'media-timeout' | 'seek-error' | 'seek-timeout' | 'muxer-missing' | 'encoder-failed' | 'output-too-large';
/** An export failure with a stable `code`; `message` is a plain English default a host may replace. */
export declare class VideoExportError extends Error {
  constructor(code: VideoExportErrorCode, message: string);
  readonly code: VideoExportErrorCode;
}
/** Injectable timers (for tests or hosts with their own clock). */
export type ExportTimers = { setTimeout: (callback: () => void, ms: number) => unknown; clearTimeout: (id: any) => void };

export declare function chooseRecorderType(supports: (mime: string) => boolean, options?: { audio?: boolean; container?: VideoContainer }): string | null;
export declare function checkExportDuration(seconds: number, options?: { maximumSeconds?: number }): null | 'unreadable' | 'too-long';
export declare function exportFrameCount(seconds: number, fps?: number): number;
export declare function videoExtension(mime: string): VideoContainer;
export declare function videoExportFilename(title: string, mime: string, options?: { fallback?: string; suffix?: string }): string;
export declare function waitForExportSetup<T>(start: () => T | PromiseLike<T>, options?: { signal?: AbortSignal; timeoutMs?: number; message?: string; timers?: ExportTimers }): Promise<T>;
export declare function readMediaForExport(source: string | Response, options?: { signal?: AbortSignal; maxBytes?: number; fetch?: typeof fetch; type?: string }): Promise<Blob>;
/** The parts of an `HTMLMediaElement` the wait helpers touch. */
export type ExportMedia = Pick<EventTarget, 'addEventListener' | 'removeEventListener'> & { readyState?: number; currentTime: number; seeking?: boolean; preload?: string; load?: () => void };
export declare function waitMediaReady(media: ExportMedia, options?: { signal?: AbortSignal; timeoutMs?: number; timers?: ExportTimers }): Promise<void>;
export declare function rewindMedia(media: ExportMedia, options?: { signal?: AbortSignal; timeoutMs?: number; timers?: ExportTimers }): Promise<void>;
export declare function saveBlob(blob: Blob, filename: string, options?: { document?: Document; URL?: { createObjectURL(blob: Blob): string; revokeObjectURL(url: string): void }; revokeAfterMs?: number; timers?: ExportTimers }): void;

/** The subset of the `mediabunny` module the SDK uses; pass the module itself (`await import('mediabunny')`). */
export type MediabunnyLike = {
  Output: new (options: { format: unknown; target: unknown }) => { state: string; target: { buffer: ArrayBuffer | null }; addVideoTrack(source: unknown, metadata?: { frameRate?: number }): unknown; addAudioTrack(source: unknown): unknown; start(): Promise<void>; finalize(): Promise<void>; cancel(): Promise<void> };
  BufferTarget: new () => unknown;
  Mp4OutputFormat: new () => unknown;
  WebMOutputFormat: new () => unknown;
  CanvasSource: new (canvas: HTMLCanvasElement | OffscreenCanvas, config: { codec: string; bitrate?: unknown; keyFrameInterval?: number }) => { add(timestamp: number, duration?: number): Promise<void> };
  AudioBufferSource?: new (config: { codec: string; bitrate?: unknown }) => { add(buffer: AudioBuffer): Promise<void> };
  canEncodeVideo?: (codec: any, options?: object) => Promise<boolean>;
  canEncodeAudio?: (codec: any, options?: object) => Promise<boolean>;
};
export type VideoExportPlan = Readonly<{
  engine: 'webcodecs' | 'recorder' | 'none';
  container: VideoContainer | null; mime: string | null; extension: VideoContainer | null;
  videoCodec: ExportVideoCodec | null; audioCodec: ExportAudioCodec | null;
  /** The real-time MediaRecorder fallback, even when WebCodecs wins. */
  recorderType: string | null;
  /** Why WebCodecs was not chosen, else null. */
  reason: null | 'muxer-missing' | 'webcodecs-missing' | 'codec-missing';
}>;
export declare function probeVideoExport(options?: { width?: number; height?: number; fps?: number; audio?: boolean; format?: 'auto' | VideoContainer; bitrate?: number; mediabunny?: MediabunnyLike | null; env?: object }): Promise<VideoExportPlan>;
export type EncodedVideo = Readonly<{ blob: Blob; mime: string; container: VideoContainer; extension: VideoContainer; videoCodec: ExportVideoCodec; audioCodec: ExportAudioCodec | null; frames: number; fps: number; duration: number; bytes: number }>;
export declare function encodeCanvasVideo(options: {
  mediabunny: MediabunnyLike;
  canvas: HTMLCanvasElement | OffscreenCanvas;
  /** Draw frame N at `seconds` onto the canvas. */
  render: (frame: number, seconds: number) => void | Promise<void>;
  frames: number;
  fps?: number;
  audio?: AudioBuffer | null;
  format?: VideoContainer;
  videoCodec?: ExportVideoCodec;
  audioCodec?: ExportAudioCodec;
  bitrate?: number;
  audioBitrate?: number;
  keyFrameSeconds?: number;
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
  maxBytes?: number;
}): Promise<EncodedVideo>;
