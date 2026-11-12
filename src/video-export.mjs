import { normalizeProgress } from './progress.mjs';
/**
 * Video export for canvas agents. `probeVideoExport` picks the best local path for a size and frame rate: WebCodecs
 * through the optional `mediabunny` peer (MP4 or WebM, faster than real time, frame-exact, works in a hidden tab) or
 * the browser's MediaRecorder (real time, WebM or MP4). `encodeCanvasVideo` renders frames one by one into a file;
 * the recorder helpers (`chooseRecorderType`, `readMediaForExport`, `waitMediaReady`, `rewindMedia`,
 * `waitForExportSetup`) keep a real-time recording honest: bounded input, a real seek to the start, setup that can
 * be cancelled or time out. Errors carry a `code` so a host can word them itself. No dependencies; the peer is
 * passed in by the host, never imported here.
 */
export const VIDEO_EXPORT_LIMITS = Object.freeze({ maximumSeconds: 300, maximumInputBytes: 64 * 1024 * 1024, maximumOutputBytes: 128 * 1024 * 1024, maximumSide: 4096, maximumFps: 120, setupTimeoutMs: 15_000, seekTimeoutMs: 5_000 });
/** Recorder MIME types, best first: WebM with VP9 or VP8 and Opus, then MP4, then any WebM. */
export const RECORDER_VIDEO_TYPES = Object.freeze(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/mp4', 'video/webm']);
const SILENT_RECORDER_TYPES = Object.freeze(['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/mp4', 'video/webm']);
/** Containers the WebCodecs path writes, with codecs in preference order (mediabunny codec names). */
export const VIDEO_EXPORT_FORMATS = Object.freeze({
  mp4: Object.freeze({ container: 'mp4', mime: 'video/mp4', extension: 'mp4', video: Object.freeze(['avc', 'vp9', 'av1', 'hevc']), audio: Object.freeze(['aac', 'opus']) }),
  webm: Object.freeze({ container: 'webm', mime: 'video/webm', extension: 'webm', video: Object.freeze(['vp9', 'vp8', 'av1']), audio: Object.freeze(['opus']) }),
});
// WebCodecs strings used only when the peer's own probe is missing: H.264 High 4.0, VP9 profile 0 level 4, AV1 main 4.0, HEVC main.
const VIDEO_STRINGS = Object.freeze({ avc: 'avc1.640028', vp9: 'vp09.00.40.08', vp8: 'vp8', av1: 'av01.0.08M.08', hevc: 'hvc1.1.6.L120.B0' });
const AUDIO_STRINGS = Object.freeze({ aac: 'mp4a.40.2', opus: 'opus' });
const SAMPLE_RATE = 48_000, CHANNELS = 2;

/** An export failure a host can word itself: `code` is stable, `message` is a plain English default. */
export class VideoExportError extends Error {
  constructor(code, message) { super(message); this.name = 'VideoExportError'; this.code = code; }
}
const fail = (code, message) => new VideoExportError(code, message);
const aborted = () => new DOMException('Export canceled.', 'AbortError');
const fn = value => typeof value === 'function';
const clock = timers => ({ set: timers?.setTimeout ?? globalThis.setTimeout, clear: timers?.clearTimeout ?? globalThis.clearTimeout });

/** The first recorder type the browser supports (`supports` is usually `MediaRecorder.isTypeSupported`), or null. */
export function chooseRecorderType(supports, { audio = true, container } = {}) {
  for (const mime of audio ? RECORDER_VIDEO_TYPES : SILENT_RECORDER_TYPES) {
    if (container && !mime.startsWith(`video/${container}`)) continue;
    try { if (supports(mime)) return mime; } catch { /* An encoder that throws is treated as missing. */ }
  }
  return null;
}
/** Null when a source duration can be exported, else `'unreadable'` (NaN, Infinity, ≤ 0) or `'too-long'`. */
export function checkExportDuration(seconds, { maximumSeconds = VIDEO_EXPORT_LIMITS.maximumSeconds } = {}) {
  return !Number.isFinite(seconds) || seconds <= 0 ? 'unreadable' : seconds > maximumSeconds ? 'too-long' : null;
}
/** Frames needed to cover `seconds` at `fps` (at least one). */
export function exportFrameCount(seconds, fps = 30) {
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(fps) || fps <= 0) throw new RangeError('Duration and frame rate must be positive.');
  return Math.max(1, Math.ceil(seconds * fps - 1e-9));
}
/** File extension for a video MIME type (`mp4` or `webm`). */
export const videoExtension = mime => String(mime).toLowerCase().startsWith('video/mp4') ? 'mp4' : 'webm';
/** A safe download name: control and path characters removed, spaces collapsed, at most 100 characters before the suffix. */
export function videoExportFilename(title, mime, { fallback = 'Creative Agents', suffix = '' } = {}) {
  const clean = value => String(value ?? '').normalize('NFKC').replace(/[\p{Cc}<>:"/\\|?*]/gu, '').replace(/\s+/g, ' ').trim();
  return `${clean(title).slice(0, 100).trim() || clean(fallback) || 'export'}${clean(suffix) ? ` ${clean(suffix)}` : ''}.${videoExtension(mime)}`;
}

/** Wait for a browser promise that may never settle (`resume()`, `play()`), with cancel and a timeout. */
export function waitForExportSetup(start, { signal, timeoutMs = VIDEO_EXPORT_LIMITS.setupTimeoutMs, message = 'Export setup took too long.', timers } = {}) {
  if (signal?.aborted) return Promise.reject(aborted());
  const { set, clear } = clock(timers);
  return new Promise((resolve, reject) => {
    let settled = false, timer;
    const finish = complete => { if (settled) return; settled = true; clear(timer); signal?.removeEventListener('abort', canceled); complete(); };
    const canceled = () => finish(() => reject(aborted()));
    timer = set(() => finish(() => reject(fail('setup-timeout', message))), timeoutMs);
    signal?.addEventListener('abort', canceled, { once: true });
    try { Promise.resolve(start()).then(value => finish(() => resolve(value)), cause => finish(() => reject(cause))); }
    catch (cause) { finish(() => reject(cause)); }
  });
}

/** Read a whole source (URL or `Response`) into a Blob with a byte cap, so a recording never starts from a partial stream. */
export async function readMediaForExport(source, { signal, maxBytes = VIDEO_EXPORT_LIMITS.maximumInputBytes, fetch: get = globalThis.fetch, type = 'application/octet-stream' } = {}) {
  if (signal?.aborted) throw aborted();
  const response = typeof source === 'string' ? await get(source, { signal }) : source;
  if (!response?.ok || !response.body) throw fail('source-unavailable', 'The source could not be read in full.');
  const tooLarge = () => fail('source-too-large', `Choose a source smaller than ${Math.round(maxBytes / 1048576)} MB.`);
  if (Number(response.headers?.get?.('content-length')) > maxBytes) { await response.body.cancel?.().catch?.(() => {}); throw tooLarge(); }
  const reader = response.body.getReader(), chunks = []; let bytes = 0;
  try {
    for (;;) {
      if (signal?.aborted) throw aborted();
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength; if (bytes > maxBytes) throw tooLarge();
      chunks.push(value);
    }
    if (!bytes) throw fail('source-empty', 'The source is empty.');
    return new Blob(chunks, { type: response.headers?.get?.('content-type') || type });
  } catch (cause) { await reader.cancel().catch(() => {}); throw cause; }
  finally { reader.releaseLock?.(); }
}

function mediaWait(media, { signal, timeoutMs, timers, ready, done, start, failCode, timeoutCode, failMessage, timeoutMessage }) {
  if (signal?.aborted) return Promise.reject(aborted());
  if (ready()) return Promise.resolve();
  const { set, clear } = clock(timers);
  return new Promise((resolve, reject) => {
    let timer;
    const finish = cause => { clear(timer); media.removeEventListener(done, ok); media.removeEventListener('error', bad); signal?.removeEventListener('abort', canceled); cause ? reject(cause) : resolve(); };
    const ok = () => finish(), bad = () => finish(fail(failCode, failMessage)), canceled = () => finish(aborted());
    timer = set(() => finish(fail(timeoutCode, timeoutMessage)), timeoutMs);
    media.addEventListener(done, ok, { once: true }); media.addEventListener('error', bad, { once: true });
    signal?.addEventListener('abort', canceled, { once: true });
    try { start(); } catch { bad(); }
  });
}
/** Resolve once a media element can play through its start (`readyState ≥ 3`), loading it if needed. */
export const waitMediaReady = (media, { signal, timeoutMs = VIDEO_EXPORT_LIMITS.setupTimeoutMs, timers } = {}) => mediaWait(media, {
  signal, timeoutMs, timers, ready: () => media.readyState >= 3, done: 'canplay', start: () => { media.preload = 'auto'; media.load(); },
  failCode: 'media-error', failMessage: 'The media could not prepare for a complete export.', timeoutCode: 'media-timeout', timeoutMessage: 'The media took too long to prepare.',
});
/** Seek to 0 and wait for the real `seeked` event, so an export always starts at the beginning. */
export const rewindMedia = (media, { signal, timeoutMs = VIDEO_EXPORT_LIMITS.seekTimeoutMs, timers } = {}) => mediaWait(media, {
  signal, timeoutMs, timers, ready: () => media.currentTime === 0 && !media.seeking, done: 'seeked', start: () => { media.currentTime = 0; },
  failCode: 'seek-error', failMessage: 'The media could not return to its beginning.', timeoutCode: 'seek-timeout', timeoutMessage: 'The media could not seek in time.',
});

/** Offer a Blob as a download; the object URL is revoked after `revokeAfterMs`. */
export function saveBlob(blob, filename, { document: doc = globalThis.document, URL: urls = globalThis.URL, revokeAfterMs = 30_000, timers } = {}) {
  const url = urls.createObjectURL(blob), link = doc.createElement('a');
  link.href = url; link.download = filename; link.rel = 'noopener'; link.click();
  clock(timers).set(() => urls.revokeObjectURL(url), revokeAfterMs);
}

function size({ width = 1280, height = 720, fps = 30 }) {
  const side = value => Number.isInteger(value) && value >= 2 && value <= VIDEO_EXPORT_LIMITS.maximumSide && value % 2 === 0;
  if (!side(width) || !side(height)) throw new RangeError(`Video sides must be even integers from 2 to ${VIDEO_EXPORT_LIMITS.maximumSide}.`);
  if (!Number.isFinite(fps) || fps <= 0 || fps > VIDEO_EXPORT_LIMITS.maximumFps) throw new RangeError(`Frame rate must be above 0 and at most ${VIDEO_EXPORT_LIMITS.maximumFps}.`);
  return { width, height, fps };
}
const muxer = mb => !!mb && ['Output', 'BufferTarget', 'CanvasSource', 'Mp4OutputFormat', 'WebMOutputFormat'].every(name => fn(mb[name]));
async function firstEncodable(codecs, check) {
  for (const codec of codecs) { try { if (await check(codec)) return codec; } catch { /* Next codec. */ } }
  return null;
}
const defaultBitrate = (width, height, fps) => Math.round(Math.min(40e6, Math.max(1e6, width * height * fps * 0.1)));

/**
 * Which export path works here. Resolves to `{ engine: 'webcodecs' | 'recorder' | 'none', container, mime, extension,
 * videoCodec, audioCodec, recorderType, reason }`; `recorderType` is the real-time fallback even when WebCodecs wins,
 * and `reason` says why WebCodecs was not used (`muxer-missing`, `webcodecs-missing`, `codec-missing`), else null.
 */
export async function probeVideoExport({ width, height, fps, audio = true, format = 'auto', bitrate, mediabunny, env = globalThis } = {}) {
  ({ width, height, fps } = size({ width, height, fps }));
  if (!['auto', 'mp4', 'webm'].includes(format)) throw new RangeError('format must be auto, mp4 or webm.');
  const formats = format === 'auto' ? ['mp4', 'webm'] : [format], rate = bitrate ?? defaultBitrate(width, height, fps);
  let recorderType = null;
  try { if (fn(env.MediaRecorder?.isTypeSupported)) recorderType = chooseRecorderType(type => env.MediaRecorder.isTypeSupported(type), { audio, container: format === 'auto' ? undefined : format }); } catch { recorderType = null; }
  let reason = null;
  if (!fn(env.VideoEncoder) || !fn(env.VideoFrame) || (audio && !fn(env.AudioEncoder))) reason = 'webcodecs-missing';
  else if (!muxer(mediabunny) || (audio && !fn(mediabunny.AudioBufferSource))) reason = 'muxer-missing';
  else {
    const video = codec => fn(mediabunny.canEncodeVideo) ? mediabunny.canEncodeVideo(codec, { width, height, bitrate: rate, frameRate: fps })
      : env.VideoEncoder.isConfigSupported({ codec: VIDEO_STRINGS[codec], width, height, bitrate: rate, framerate: fps }).then(result => !!result?.supported);
    const sound = codec => fn(mediabunny.canEncodeAudio) ? mediabunny.canEncodeAudio(codec, { numberOfChannels: CHANNELS, sampleRate: SAMPLE_RATE })
      : env.AudioEncoder.isConfigSupported({ codec: AUDIO_STRINGS[codec], numberOfChannels: CHANNELS, sampleRate: SAMPLE_RATE, bitrate: 128_000 }).then(result => !!result?.supported);
    for (const id of formats) {
      const spec = VIDEO_EXPORT_FORMATS[id], videoCodec = await firstEncodable(spec.video, video);
      const audioCodec = videoCodec && audio ? await firstEncodable(spec.audio, sound) : null;
      if (videoCodec && (!audio || audioCodec)) return Object.freeze({ engine: 'webcodecs', container: id, mime: spec.mime, extension: spec.extension, videoCodec, audioCodec, recorderType, reason: null });
    }
    reason = 'codec-missing';
  }
  if (recorderType) return Object.freeze({ engine: 'recorder', container: videoExtension(recorderType), mime: recorderType, extension: videoExtension(recorderType), videoCodec: null, audioCodec: null, recorderType, reason });
  return Object.freeze({ engine: 'none', container: null, mime: null, extension: null, videoCodec: null, audioCodec: null, recorderType: null, reason });
}

/**
 * Render `frames` canvas frames one by one and encode them to MP4 or WebM with the host's `mediabunny` module.
 * `render(frame, seconds)` draws frame N (it may be async); `audio` is an optional `AudioBuffer` laid from 0 s.
 * Progress follows the shared contract (`prepare` → `frame` N of M → `export`). Cancelling or any failure cancels the
 * output, so a partial file is never returned.
 */
export async function encodeCanvasVideo({ mediabunny: mb, canvas, render, frames, fps = 30, audio, format = 'mp4', videoCodec, audioCodec, bitrate, audioBitrate = 192_000, keyFrameSeconds = 2, signal, onProgress, maxBytes = VIDEO_EXPORT_LIMITS.maximumOutputBytes } = {}) {
  if (!muxer(mb)) throw fail('muxer-missing', 'Pass the mediabunny module to encode with WebCodecs.');
  if (!canvas || !fn(render)) throw new TypeError('encodeCanvasVideo needs a canvas and a render(frame, seconds) function.');
  const spec = VIDEO_EXPORT_FORMATS[format]; if (!spec) throw new RangeError('format must be mp4 or webm.');
  ({ fps } = size({ width: canvas.width, height: canvas.height, fps }));
  if (!Number.isInteger(frames) || frames < 1 || frames / fps > VIDEO_EXPORT_LIMITS.maximumSeconds) throw new RangeError(`frames must be a positive integer covering at most ${VIDEO_EXPORT_LIMITS.maximumSeconds} seconds.`);
  const video = videoCodec ?? spec.video[0], sound = audio ? audioCodec ?? spec.audio[0] : null;
  if (!spec.video.includes(video) || (sound && !spec.audio.includes(sound))) throw new RangeError(`${spec.container} cannot carry ${sound && !spec.audio.includes(sound) ? sound : video}.`);
  if (audio && !fn(mb.AudioBufferSource)) throw fail('muxer-missing', 'This mediabunny build has no AudioBufferSource.');
  const progress = event => { try { onProgress?.(normalizeProgress(event)); } catch { /* A host callback never breaks an export. */ } };
  if (signal?.aborted) throw aborted();
  progress({ stage: 'prepare' });
  const output = new mb.Output({ format: format === 'mp4' ? new mb.Mp4OutputFormat() : new mb.WebMOutputFormat(), target: new mb.BufferTarget() });
  try {
    const source = new mb.CanvasSource(canvas, { codec: video, bitrate: bitrate ?? defaultBitrate(canvas.width, canvas.height, fps), keyFrameInterval: keyFrameSeconds });
    output.addVideoTrack(source, { frameRate: fps });
    const track = sound ? new mb.AudioBufferSource({ codec: sound, bitrate: audioBitrate }) : null;
    if (track) output.addAudioTrack(track);
    await output.start();
    if (track) await track.add(audio);
    for (let frame = 0; frame < frames; frame++) {
      if (signal?.aborted) throw aborted();
      await render(frame, frame / fps);
      if (signal?.aborted) throw aborted();
      await source.add(frame / fps, 1 / fps);
      progress({ stage: 'frame', frame: frame + 1, frames });
    }
    progress({ stage: 'export' });
    await output.finalize();
    const buffer = output.target?.buffer, bytes = buffer?.byteLength ?? 0;
    if (!bytes) throw fail('encoder-failed', 'The encoder finished without a file.');
    if (bytes > maxBytes) throw fail('output-too-large', 'This export is larger than the device memory limit.');
    const blob = new Blob([buffer], { type: spec.mime });
    progress({ stage: 'ready' });
    return Object.freeze({ blob, mime: spec.mime, container: spec.container, extension: spec.extension, videoCodec: video, audioCodec: sound, frames, fps, duration: frames / fps, bytes });
  } catch (cause) {
    if (output.state !== 'finalized' && output.state !== 'canceled') await Promise.resolve().then(() => output.cancel()).catch(() => {});
    if (cause instanceof VideoExportError || cause?.name === 'AbortError') throw cause;
    const wrapped = fail('encoder-failed', cause?.message ? `The encoder stopped: ${cause.message}` : 'The encoder stopped.'); wrapped.cause = cause; throw wrapped;
  }
}
