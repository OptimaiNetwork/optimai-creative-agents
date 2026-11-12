import test from 'node:test';
import assert from 'node:assert/strict';
import { VIDEO_EXPORT_LIMITS, VIDEO_EXPORT_FORMATS, RECORDER_VIDEO_TYPES, VideoExportError, chooseRecorderType, checkExportDuration, exportFrameCount, videoExtension, videoExportFilename, waitForExportSetup, readMediaForExport, waitMediaReady, rewindMedia, saveBlob, probeVideoExport, encodeCanvasVideo } from '../src/video-export.mjs';

// A fake mediabunny with the same surface as 1.62.1: it records every call and builds a byte "file" from frames.
function fakeMediabunny({ encodable = () => true, failAt, noAudio } = {}) {
  const log = [];
  class Output {
    constructor({ format, target }) { this.format = format; this.target = target; this.state = 'pending'; this.tracks = []; log.push(['output', format.kind]); }
    addVideoTrack(source, meta) { this.tracks.push(source); source.output = this; log.push(['video-track', source.config.codec, meta.frameRate]); }
    addAudioTrack(source) { this.tracks.push(source); log.push(['audio-track', source.config.codec]); }
    async start() { this.state = 'started'; log.push(['start']); }
    async finalize() { this.state = 'finalized'; this.target.buffer = new Uint8Array(this.tracks[0].frames.length * 10 + 8).buffer; log.push(['finalize']); }
    async cancel() { this.state = 'canceled'; log.push(['cancel']); }
  }
  class CanvasSource {
    constructor(canvas, config) { this.canvas = canvas; this.config = config; this.frames = []; }
    async add(timestamp, duration) { if (failAt === this.frames.length) throw new Error('GPU lost'); this.frames.push([timestamp, duration, this.canvas.drawn]); }
  }
  const mb = { log, Output, CanvasSource, BufferTarget: class { buffer = null; }, Mp4OutputFormat: class { kind = 'mp4'; }, WebMOutputFormat: class { kind = 'webm'; },
    canEncodeVideo: async (codec, options) => { log.push(['can-video', codec, options.width]); return encodable(codec); },
    canEncodeAudio: async codec => { log.push(['can-audio', codec]); return encodable(codec); } };
  if (!noAudio) mb.AudioBufferSource = class { constructor(config) { this.config = config; } async add(buffer) { log.push(['audio', buffer.duration]); } };
  return mb;
}
const webCodecs = (extra = {}) => ({ VideoEncoder: function () {}, VideoFrame: function () {}, AudioEncoder: function () {}, ...extra });
const recorder = supported => ({ MediaRecorder: { isTypeSupported: type => supported.includes(type) } });
const fakeTimers = () => { const timers = new Map(); let id = 0; return { timers, setTimeout: (fn, ms) => { timers.set(++id, { fn, ms }); return id; }, clearTimeout: key => timers.delete(key), fire(ms) { for (const [key, timer] of timers) if (timer.ms === ms) { timers.delete(key); timer.fn(); } } }; };

test('recorder types keep the old order, skip throwing encoders and respect silence and container', () => {
  assert.equal(RECORDER_VIDEO_TYPES[0], 'video/webm;codecs=vp9,opus');
  assert.equal(chooseRecorderType(mime => mime === 'video/mp4'), 'video/mp4');
  assert.equal(chooseRecorderType(mime => mime === 'video/webm;codecs=vp8,opus'), 'video/webm;codecs=vp8,opus');
  assert.equal(chooseRecorderType(() => false), null);
  assert.equal(chooseRecorderType(() => { throw new Error('nope'); }), null);
  assert.equal(chooseRecorderType(() => true, { audio: false }), 'video/webm;codecs=vp9');
  assert.equal(chooseRecorderType(() => true, { container: 'mp4' }), 'video/mp4');
});

test('durations, frame counts and file names are bounded and safe', () => {
  for (const seconds of [NaN, Infinity, -1, 0]) assert.equal(checkExportDuration(seconds), 'unreadable');
  assert.equal(checkExportDuration(300.1), 'too-long');
  for (const seconds of [0.1, 120, 300]) assert.equal(checkExportDuration(seconds), null);
  assert.equal(checkExportDuration(61, { maximumSeconds: 60 }), 'too-long');
  assert.equal(exportFrameCount(2, 30), 60); assert.equal(exportFrameCount(2.01, 30), 61); assert.equal(exportFrameCount(0.001, 30), 1);
  assert.throws(() => exportFrameCount(0, 30), RangeError);
  assert.equal(videoExtension('video/mp4;codecs=avc1'), 'mp4'); assert.equal(videoExtension('video/webm;codecs=vp9'), 'webm');
  assert.equal(videoExportFilename('After the rain', 'video/mp4', { suffix: '· visualizer' }), 'After the rain · visualizer.mp4');
  assert.equal(videoExportFilename('test/../../a <b>', 'video/webm'), 'test....a b.webm');
  assert.equal(videoExportFilename('  \u0000 ', 'video/webm', { fallback: 'Sound Canvas' }), 'Sound Canvas.webm');
  assert.equal(videoExportFilename('x'.repeat(300), 'video/mp4').length, 104);
  assert.ok(videoExportFilename('우리 노래', 'video/mp4').startsWith('우리 노래'));
});

test('setup waits resolve, time out with a code, cancel, and ignore late results', async () => {
  const clock = fakeTimers();
  assert.equal(await waitForExportSetup(() => 'ok', { timers: clock }), 'ok');
  assert.equal(clock.timers.size, 0, 'the deadline is cleared once setup settles');
  let pending = waitForExportSetup(() => new Promise(() => {}), { timers: clock, message: 'Playback could not start in time.' });
  assert.equal([...clock.timers.values()][0].ms, VIDEO_EXPORT_LIMITS.setupTimeoutMs);
  clock.fire(15_000);
  await assert.rejects(pending, error => error instanceof VideoExportError && error.code === 'setup-timeout' && /in time/.test(error.message));
  const controller = new AbortController();
  pending = waitForExportSetup(() => new Promise(() => {}), { signal: controller.signal, timers: clock });
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' }); assert.equal(clock.timers.size, 0);
  await assert.rejects(waitForExportSetup(() => 1, { signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(waitForExportSetup(() => { throw new Error('sync'); }, { timers: clock }), /sync/);
});

test('media reads are whole, capped and never partial', async () => {
  const body = (...parts) => new Response(new ReadableStream({ start(c) { for (const part of parts) c.enqueue(new TextEncoder().encode(part)); c.close(); } }), { headers: { 'content-type': 'audio/mpeg' } });
  const blob = await readMediaForExport('https://example.invalid/song.mp3', { fetch: async () => body('complete ', 'song') });
  assert.equal(await blob.text(), 'complete song'); assert.equal(blob.type, 'audio/mpeg');
  await assert.rejects(readMediaForExport(body('0123456789', 'abc'), { maxBytes: 12 }), { code: 'source-too-large' });
  await assert.rejects(readMediaForExport(new Response('x', { headers: { 'content-length': '100' } }), { maxBytes: 10 }), { code: 'source-too-large' });
  await assert.rejects(readMediaForExport(new Response(null, { status: 404 })), { code: 'source-unavailable' });
  await assert.rejects(readMediaForExport(body()), { code: 'source-empty' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readMediaForExport(body('x'), { signal: controller.signal }), { name: 'AbortError' });
});

test('ready and rewind wait for real media events and map failures to codes', async () => {
  const clock = fakeTimers();
  const media = new EventTarget(); let time = 30, loads = 0;
  Object.defineProperty(media, 'currentTime', { get: () => time, set: value => { time = value; queueMicrotask(() => media.dispatchEvent(new Event('seeked'))); } });
  media.readyState = 1; media.load = () => { loads++; queueMicrotask(() => media.dispatchEvent(new Event('canplay'))); };
  await waitMediaReady(media, { timers: clock }); assert.equal(loads, 1); assert.equal(media.preload, 'auto');
  media.readyState = 4; await waitMediaReady(media, { timers: clock }); assert.equal(loads, 1, 'a ready element is not reloaded');
  await rewindMedia(media, { timers: clock }); assert.equal(time, 0);
  await rewindMedia(media, { timers: clock });
  assert.equal(clock.timers.size, 0);
  const bad = new EventTarget(); Object.defineProperty(bad, 'currentTime', { get: () => 10, set: () => queueMicrotask(() => bad.dispatchEvent(new Event('error'))) });
  await assert.rejects(rewindMedia(bad, { timers: clock }), { code: 'seek-error' });
  const stuck = new EventTarget(); stuck.currentTime = 10;
  const pending = rewindMedia(stuck, { timers: clock }); clock.fire(VIDEO_EXPORT_LIMITS.seekTimeoutMs);
  await assert.rejects(pending, { code: 'seek-timeout' });
  const slow = new EventTarget(); slow.readyState = 0; slow.load = () => {};
  const loading = waitMediaReady(slow, { timers: clock }); clock.fire(VIDEO_EXPORT_LIMITS.setupTimeoutMs);
  await assert.rejects(loading, { code: 'media-timeout' });
});

test('saveBlob clicks a download link and revokes its URL later', () => {
  const clock = fakeTimers(), revoked = [], link = { clicked: 0, click() { this.clicked++; } };
  saveBlob(new Blob(['v']), 'Song.webm', { document: { createElement: () => link }, URL: { createObjectURL: () => 'blob:1', revokeObjectURL: url => revoked.push(url) }, timers: clock });
  assert.deepEqual([link.href, link.download, link.clicked], ['blob:1', 'Song.webm', 1]);
  assert.deepEqual(revoked, []); clock.fire(30_000); assert.deepEqual(revoked, ['blob:1']);
});

test('the probe prefers WebCodecs MP4, falls back by codec, container and peer, and always names the recorder fallback', async () => {
  const supported = ['video/webm;codecs=vp9,opus', 'video/mp4'];
  let plan = await probeVideoExport({ width: 1280, height: 720, mediabunny: fakeMediabunny(), env: { ...webCodecs(), ...recorder(supported) } });
  assert.deepEqual({ ...plan }, { engine: 'webcodecs', container: 'mp4', mime: 'video/mp4', extension: 'mp4', videoCodec: 'avc', audioCodec: 'aac', recorderType: 'video/webm;codecs=vp9,opus', reason: null });
  assert.ok(Object.isFrozen(plan));
  // No AAC encoder (common on Linux Chromium): MP4 can still carry Opus.
  plan = await probeVideoExport({ mediabunny: fakeMediabunny({ encodable: codec => codec !== 'aac' }), env: webCodecs() });
  assert.deepEqual([plan.container, plan.videoCodec, plan.audioCodec], ['mp4', 'avc', 'opus']);
  // No H.264 or AAC at all, WebM only.
  plan = await probeVideoExport({ format: 'webm', mediabunny: fakeMediabunny({ encodable: codec => ['vp8', 'opus'].includes(codec) }), env: webCodecs() });
  assert.deepEqual([plan.container, plan.videoCodec, plan.audioCodec], ['webm', 'vp8', 'opus']);
  // A silent export needs no audio encoder.
  plan = await probeVideoExport({ audio: false, mediabunny: fakeMediabunny({ noAudio: true }), env: webCodecs({ AudioEncoder: undefined }) });
  assert.deepEqual([plan.engine, plan.audioCodec], ['webcodecs', null]);
  plan = await probeVideoExport({ env: { ...webCodecs(), ...recorder(supported) } });
  assert.deepEqual([plan.engine, plan.mime, plan.reason], ['recorder', 'video/webm;codecs=vp9,opus', 'muxer-missing']);
  plan = await probeVideoExport({ mediabunny: fakeMediabunny(), env: recorder(['video/mp4']) });
  assert.deepEqual([plan.engine, plan.extension, plan.reason], ['recorder', 'mp4', 'webcodecs-missing']);
  plan = await probeVideoExport({ mediabunny: fakeMediabunny({ encodable: () => false }), env: webCodecs() });
  assert.deepEqual([plan.engine, plan.reason, plan.recorderType], ['none', 'codec-missing', null]);
  plan = await probeVideoExport({ format: 'mp4', env: recorder(['video/webm;codecs=vp9,opus']) });
  assert.equal(plan.engine, 'none', 'an MP4-only request never returns a WebM recorder');
  await assert.rejects(probeVideoExport({ width: 1281 }), RangeError);
  await assert.rejects(probeVideoExport({ width: 8192 }), RangeError);
  await assert.rejects(probeVideoExport({ fps: 0 }), RangeError);
  await assert.rejects(probeVideoExport({ format: 'gif' }), RangeError);
});

test('without the peer probe the browser encoder config check decides', async () => {
  const asked = [], mb = fakeMediabunny(); delete mb.canEncodeVideo; delete mb.canEncodeAudio;
  const env = webCodecs({ VideoEncoder: class { static async isConfigSupported(config) { asked.push(config.codec); return { supported: config.codec.startsWith('vp09') }; } }, AudioEncoder: class { static async isConfigSupported(config) { return { supported: config.codec === 'opus' }; } } });
  const plan = await probeVideoExport({ width: 640, height: 360, mediabunny: mb, env });
  assert.deepEqual([plan.container, plan.videoCodec, plan.audioCodec], ['mp4', 'vp9', 'opus']);
  assert.deepEqual(asked, ['avc1.640028', 'vp09.00.40.08']);
});

test('frame-by-frame encoding is exact, ordered and reports shared progress', async () => {
  const mb = fakeMediabunny(), canvas = { width: 320, height: 180, drawn: -1 }, events = [];
  const result = await encodeCanvasVideo({ mediabunny: mb, canvas, frames: 6, fps: 3, audio: { duration: 2 }, render: async (frame, seconds) => { canvas.drawn = frame; assert.equal(seconds, frame / 3); }, onProgress: event => events.push(event.stage === 'frame' ? `frame ${event.frame}/${event.frames}` : event.stage) });
  assert.deepEqual([result.mime, result.container, result.videoCodec, result.audioCodec, result.frames, result.duration, result.bytes], ['video/mp4', 'mp4', 'avc', 'aac', 6, 2, 68]);
  assert.equal(result.blob.type, 'video/mp4'); assert.equal(result.blob.size, 68);
  const source = mb.log.find(([kind]) => kind === 'video-track');
  assert.deepEqual(source, ['video-track', 'avc', 3]);
  assert.deepEqual(mb.log.map(([kind]) => kind), ['output', 'video-track', 'audio-track', 'start', 'audio', 'finalize']);
  assert.deepEqual(events, ['prepare', 'frame 1/6', 'frame 2/6', 'frame 3/6', 'frame 4/6', 'frame 5/6', 'frame 6/6', 'export', 'ready']);
  const webm = await encodeCanvasVideo({ mediabunny: mb, canvas, frames: 2, format: 'webm', videoCodec: 'vp8', render() {} });
  assert.deepEqual([webm.mime, webm.videoCodec, webm.audioCodec], ['video/webm', 'vp8', null]);
});

test('every encode failure cancels the output and never returns a partial file', async () => {
  const canvas = { width: 64, height: 64 };
  let mb = fakeMediabunny({ failAt: 2 });
  await assert.rejects(encodeCanvasVideo({ mediabunny: mb, canvas, frames: 5, render() {} }), error => error.code === 'encoder-failed' && /GPU lost/.test(error.message) && error.cause instanceof Error);
  assert.equal(mb.log.at(-1)[0], 'cancel');
  mb = fakeMediabunny(); const controller = new AbortController();
  await assert.rejects(encodeCanvasVideo({ mediabunny: mb, canvas, frames: 5, signal: controller.signal, render(frame) { if (frame === 1) controller.abort(); } }), { name: 'AbortError' });
  assert.equal(mb.log.at(-1)[0], 'cancel'); assert.ok(!mb.log.some(([kind]) => kind === 'finalize'));
  mb = fakeMediabunny();
  await assert.rejects(encodeCanvasVideo({ mediabunny: mb, canvas, frames: 4, maxBytes: 10, render() {} }), { code: 'output-too-large' });
  await assert.rejects(encodeCanvasVideo({ mediabunny: null, canvas, frames: 1, render() {} }), { code: 'muxer-missing' });
  await assert.rejects(encodeCanvasVideo({ mediabunny: fakeMediabunny({ noAudio: true }), canvas, frames: 1, audio: {}, render() {} }), { code: 'muxer-missing' });
  await assert.rejects(encodeCanvasVideo({ mediabunny: mb, canvas, frames: 1, format: 'webm', videoCodec: 'avc', render() {} }), RangeError);
  await assert.rejects(encodeCanvasVideo({ mediabunny: mb, canvas, frames: 1, format: 'webm', audio: {}, audioCodec: 'aac', render() {} }), /cannot carry aac/);
  await assert.rejects(encodeCanvasVideo({ mediabunny: mb, canvas, frames: 30 * 301, render() {} }), RangeError);
  await assert.rejects(encodeCanvasVideo({ mediabunny: mb, canvas: { width: 63, height: 64 }, frames: 1, render() {} }), RangeError);
  const progressThrows = await encodeCanvasVideo({ mediabunny: fakeMediabunny(), canvas, frames: 1, render() {}, onProgress() { throw new Error('host bug'); } });
  assert.equal(progressThrows.frames, 1, 'a throwing progress callback never breaks an export');
});

test('formats describe what each container can carry', () => {
  assert.deepEqual([...VIDEO_EXPORT_FORMATS.mp4.video], ['avc', 'vp9', 'av1', 'hevc']);
  assert.deepEqual([...VIDEO_EXPORT_FORMATS.webm.audio], ['opus']);
  assert.ok(Object.isFrozen(VIDEO_EXPORT_FORMATS.webm.video));
});
