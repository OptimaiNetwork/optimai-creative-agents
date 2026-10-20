import assert from 'node:assert/strict';
import test from 'node:test';
import { BEAT_TRACKER_DEFAULTS, BEAT_TRACKER_LIMITS, createBeatTracker, createFlashLimiter, estimateTempo, logBandSpectrum, prefersReducedMotion, spectralFlux } from '../src/beat-tracker.mjs';
import { checkCutAlignment } from '../src/verify.mjs';

const lcg = (seed = 7) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const train = (bpm, ms = 8000, offset = 0) => Array.from({ length: Math.floor((ms - offset) / (60000 / bpm)) + 1 }, (_, i) => offset + i * 60000 / bpm);

/** Analyser frames for a kick on every beat (±jitter ms) over a noisy bed. */
function* song({ bpm, fps = 60, seconds = 12, jitter = 10, offset = 0, quietFrom = Infinity, seed = 7 }) {
  const random = lcg(seed), beats = train(bpm, seconds * 1000, offset).map(time => time + (random() - .5) * jitter);
  for (let frame = 0; frame < seconds * fps; frame++) {
    const time = frame * 1000 / fps, bytes = new Uint8Array(1024);
    const hit = beats.filter(beat => beat <= time && beat < quietFrom).at(-1), since = hit == null ? Infinity : time - hit;
    for (let bin = 0; bin < bytes.length; bin++) bytes[bin] = 70 + random() * 20 + 120 * Math.exp(-since / 90) * (bin < 40 ? 1 : .4);
    yield { time, bytes, beats };
  }
}
const run = (options, tracker = createBeatTracker({ sampleRate: 48000, fftSize: 2048, ...options.tracker })) => {
  const frames = []; let beats = [];
  for (const { time, bytes, beats: truth } of song(options)) { frames.push(tracker.push(bytes, time)); beats = truth; }
  return { frames, beats, tracker };
};
const nearest = (time, list) => Math.min(...list.map(value => Math.abs(value - time)));

test('constants are frozen and the package subpath resolves to this module', async () => {
  assert.ok(Object.isFrozen(BEAT_TRACKER_DEFAULTS) && Object.isFrozen(BEAT_TRACKER_LIMITS));
  assert.equal(BEAT_TRACKER_DEFAULTS.maxFlashesPerSecond, 3);
  assert.equal((await import('@optimai/creative-agents/beat-tracker')).createBeatTracker, createBeatTracker);
});

test('log bands validate analyser settings and spectral flux only counts rises', () => {
  assert.throws(() => logBandSpectrum([1, 2, 3]), TypeError);
  assert.throws(() => logBandSpectrum(new Uint8Array(8), { fftSize: 1000 }), RangeError);
  assert.throws(() => logBandSpectrum(new Uint8Array(8), { sampleRate: 4000 }), RangeError);
  const bytes = new Uint8Array(1024).fill(255), bands = logBandSpectrum(bytes);
  assert.equal(bands.length, BEAT_TRACKER_LIMITS.bands);
  assert.ok(bands.every(value => value === 1), 'narrow low bands fall back to their nearest bin');
  assert.ok(logBandSpectrum(new Uint8Array(0)).every(value => value === 0));
  assert.equal(spectralFlux([0, .5, 1], [.5, .5, 0]), .5 / 3);
  assert.equal(spectralFlux([1, 1], [0, 0]), 0, 'a decay is not an onset');
  assert.equal(spectralFlux([1], [1, 1]), 0);
});

test('tempo from onset autocorrelation is accurate, keeps off-beats, and distrusts noise', () => {
  for (const bpm of [72, 90, 120, 128, 150, 174]) {
    const estimate = estimateTempo(train(bpm));
    assert.ok(Math.abs(estimate.bpm - bpm) < bpm * .01, `${bpm} BPM read as ${estimate.bpm}`);
    assert.ok(estimate.confidence > .9);
    assert.ok(Math.abs(estimate.periodMs - 60000 / estimate.bpm) < 1e-9);
  }
  // Kicks on the beat and softer hats between them: still 120, not 240 or 60.
  const kicksAndHats = train(240).slice(0, 32);
  assert.ok(Math.abs(estimateTempo(kicksAndHats, { weights: kicksAndHats.map((_, i) => i % 2 ? .5 : 1) }).bpm - 120) < 1.5);
  // Only quarter notes at 87 stay at 87 rather than doubling.
  assert.ok(Math.abs(estimateTempo(train(87)).bpm - 87) < 1);
  const random = lcg(3), noisy = Array.from({ length: 100 }, (_, i) => estimateTempo(Array.from({ length: 8 + i % 30 }, () => random() * 8000)).confidence);
  assert.ok(noisy.filter(value => value >= BEAT_TRACKER_DEFAULTS.minConfidence).length <= 2, 'irregular onsets almost never lock a beat clock');
  assert.deepEqual(estimateTempo([0, 500, 1000]), { bpm: 0, periodMs: 0, confidence: 0 });
  assert.deepEqual(estimateTempo('not a list'), { bpm: 0, periodMs: 0, confidence: 0 });
  assert.throws(() => estimateTempo(train(120), { minBpm: 100, maxBpm: 110 }), RangeError);
});

test('the beat clock locks to a song and predicts beats within one frame', () => {
  for (const [bpm, fps, tolerance] of [[90, 60, 25], [120, 60, 25], [128, 60, 25], [150, 60, 25], [120, 30, 45], [100, 30, 45]]) {
    const { frames, beats } = run({ bpm, fps, offset: 37 });
    const lockedAt = frames.find(frame => frame.locked)?.time;
    assert.ok(lockedAt < 4000, `${bpm} BPM at ${fps} fps locks within four seconds (${lockedAt})`);
    const last = frames.at(-1);
    assert.ok(Math.abs(last.bpm - bpm) < bpm * .02, `${bpm} BPM at ${fps} fps read as ${last.bpm}`);
    const late = frames.filter(frame => frame.beat && frame.time > 6000);
    assert.ok(late.length >= Math.floor(bpm / 60 * 5.5), `${bpm} BPM fires its beats (${late.length})`);
    const error = late.reduce((sum, frame) => sum + nearest(frame.time, beats), 0) / late.length;
    assert.ok(error < tolerance, `${bpm} BPM at ${fps} fps: mean beat error ${error.toFixed(1)} ms`);
    // Tier-0 verify accepts the tracker's beats as cut points for an edit on the true beats.
    assert.equal(checkCutAlignment(beats.filter(time => time > 6000).map(time => time / 1000), late.map(frame => frame.time / 1000), { tolerance: .05 }).pass, true);
    for (const frame of frames) {
      assert.ok(frame.phase >= 0 && frame.phase <= 1 && frame.pulse >= 0 && frame.pulse <= 1);
      if (frame.beat) assert.ok(frame.phase < 1000 / fps / (60000 / bpm) + .01, 'phase restarts on a beat');
    }
  }
});

test('flash limiter allows at most three evenly spaced flashes in any one-second window', () => {
  const limiter = createFlashLimiter(), allowed = [];
  for (let time = 0; time < 5000; time += 1000 / 60) if (limiter.allow(time)) allowed.push(time);
  for (const start of allowed) assert.ok(allowed.filter(time => time >= start && time <= start + 1000).length <= 3);
  assert.ok(allowed.slice(1).every((time, i) => time - allowed[i] > 1000 / 3));
  assert.equal(createFlashLimiter({ maxFlashesPerSecond: 10 }).minGapMs, 1000 / 3, 'the cap cannot be raised above WCAG 2.3.1');
  assert.equal(createFlashLimiter({ maxFlashesPerSecond: 1 }).minGapMs, 1000);
  assert.equal(limiter.allow(NaN), false);
  assert.equal(limiter.allow(100), true, 'time moving backwards (a seek) starts a fresh window');
});

test('a fast song pulses no more than three times a second while beats keep their count', () => {
  const { frames } = run({ bpm: 240, fps: 60, jitter: 0, tracker: { minBpm: 120, maxBpm: 300 } });
  const flashes = frames.filter(frame => frame.flash).map(frame => frame.time), beats = frames.filter(frame => frame.beat && frame.time > 6000);
  assert.ok(Math.abs(frames.at(-1).bpm - 240) < 5);
  assert.ok(beats.length > flashes.filter(time => time > 6000).length, 'some beats are not flashed');
  for (const start of flashes) assert.ok(flashes.filter(time => time >= start && time <= start + 1000).length <= 3);
});

test('reduced motion keeps tempo and beats but never pulses', () => {
  const quiet = run({ bpm: 120, tracker: { reducedMotion: true } });
  assert.ok(quiet.frames.some(frame => frame.beat));
  assert.ok(quiet.frames.every(frame => !frame.flash && frame.pulse === 0));
  quiet.tracker.reducedMotion = false;
  assert.equal(quiet.tracker.reducedMotion, false);
  const loud = run({ bpm: 120 });
  assert.ok(loud.frames.some(frame => frame.flash) && Math.max(...loud.frames.map(frame => frame.pulse)) > .9);
  assert.equal(prefersReducedMotion({ matchMedia: query => ({ matches: query === '(prefers-reduced-motion: reduce)' }) }), true);
  assert.equal(prefersReducedMotion({}), false);
  assert.equal(prefersReducedMotion({ matchMedia() { throw new Error('blocked'); } }), false);
});

test('silence never locks, a quiet passage drops the lock, and a seek resets', () => {
  const tracker = createBeatTracker();
  for (let time = 0; time < 5000; time += 20) assert.equal(tracker.push(new Uint8Array(1024).fill(80), time).onset, false);
  assert.equal(tracker.bpm, 0);
  const { frames, tracker: song120 } = run({ bpm: 120, seconds: 16, quietFrom: 7000 });
  assert.ok(frames.find(frame => frame.time > 5000 && frame.time < 7000).locked);
  assert.equal(frames.at(-1).locked, false);
  assert.equal(frames.at(-1).bpm, 0);
  const restarted = song120.push(new Uint8Array(1024), 0);
  assert.equal(restarted.beatCount, 0);
  assert.equal(song120.bpm, 0);
  assert.throws(() => tracker.push(new Uint8Array(4), NaN), RangeError);
  assert.throws(() => createBeatTracker({ fftSize: 3 }), RangeError);
});
