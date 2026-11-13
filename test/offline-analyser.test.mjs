import test from 'node:test';
import assert from 'node:assert/strict';
import { OFFLINE_ANALYSER_DEFAULTS, OFFLINE_ANALYSER_LIMITS, createOfflineAnalyser, fft } from '../src/offline-analyser.mjs';
import { extractMusicReactiveFeatures } from '../src/music-reactive.mjs';

const RATE = 48_000;
const tone = (hz, seconds = 1, amplitude = 0.5, rate = RATE) => Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => amplitude * Math.sin(2 * Math.PI * hz * i / rate));
const peak = bytes => bytes.indexOf(Math.max(...bytes));

test('the FFT matches a direct DFT', () => {
  const n = 64, input = Array.from({ length: n }, (_, i) => Math.sin(i * 0.7) + 0.3 * Math.cos(i * 2.1) + (i % 5) / 10);
  const re = Float64Array.from(input), im = new Float64Array(n);
  fft(re, im);
  for (const k of [0, 1, 7, 31, 32, 50]) {
    let dr = 0, di = 0;
    for (let i = 0; i < n; i++) { dr += input[i] * Math.cos(-2 * Math.PI * k * i / n); di += input[i] * Math.sin(-2 * Math.PI * k * i / n); }
    assert.ok(Math.abs(re[k] - dr) < 1e-9 && Math.abs(im[k] - di) < 1e-9, `bin ${k}`);
  }
  assert.throws(() => fft(new Float64Array(6), new Float64Array(6)), RangeError);
  assert.throws(() => fft(new Float64Array(8), new Float64Array(4)), RangeError);
});

test('a tone lands in its bin with the analyser’s decibel scale, like a live AnalyserNode', () => {
  const analyser = createOfflineAnalyser({ sampleRate: RATE, channels: [tone(43 * RATE / 2048)] }, { smoothingTimeConstant: 0 });
  assert.deepEqual([analyser.fftSize, analyser.frequencyBinCount, analyser.duration], [2048, 1024, 1]);
  const bytes = analyser.getByteFrequencyData(new Uint8Array(1024), 0.5);
  // A full-window sine of amplitude A under a Blackman window peaks near A × 0.42 / 2 ≈ 0.105 → about −19.6 dB, above maxDecibels.
  assert.equal(bytes[43], 255);
  assert.ok(bytes[400] < 40, 'far bins stay quiet');
  const db = analyser.getFloatFrequencyData(new Float32Array(1024), 0.5);
  assert.equal(peak(db), 43, 'a bin-centred 1,008 Hz tone peaks in bin 43');
  assert.ok(db[43] > -22 && db[43] < -18, `peak ${db[43]} dB`);
  assert.equal(analyser.getByteFrequencyData(new Uint8Array(1024), 0)[43], 0, 'at 0 s the window holds only silence');
  assert.equal(analyser.getFloatFrequencyData(new Float32Array(4), 0)[0], -Infinity);
});

test('smoothing carries over between reads, a repeated time is stable, and reset clears it', () => {
  const samples = new Float32Array(RATE * 2); samples.set(tone(2000, 1));
  const analyser = createOfflineAnalyser({ sampleRate: RATE, channels: [samples] }, { smoothingTimeConstant: 0.5 });
  const bin = Math.round(2000 / (RATE / 2048)), db = time => analyser.getFloatFrequencyData(new Float32Array(1024), time)[bin];
  const first = db(0.5); assert.equal(db(0.5), first, 'the same moment reads the same');
  const loud = db(0.6); assert.ok(loud > first, 'a second loud read climbs toward the true level');
  const after = db(1.5); assert.ok(Math.abs(loud - 6.0206 - after) < 0.01, 'silence after the tone halves the magnitude: −6 dB');
  analyser.reset(); assert.equal(db(1.5), -Infinity);
});

test('stereo and AudioBuffer-shaped input down-mix to mono, and features follow the song', () => {
  const left = tone(80), right = tone(80);
  const buffer = { sampleRate: RATE, numberOfChannels: 2, length: left.length, getChannelData: index => [left, right][index] };
  const bass = createOfflineAnalyser(buffer, { smoothingTimeConstant: 0 }), treble = createOfflineAnalyser({ sampleRate: RATE, channels: [tone(6000), tone(6000)] }, { smoothingTimeConstant: 0 });
  const features = analyser => extractMusicReactiveFeatures(analyser.getByteFrequencyData(new Uint8Array(1024), 0.5), { sampleRate: RATE, fftSize: 2048 });
  const low = features(bass), high = features(treble);
  assert.ok(low.bass > high.bass && high.treble > low.treble, 'a bass line drives bass; a hi-hat drives treble');
  const cancel = createOfflineAnalyser({ sampleRate: RATE, channels: [tone(500), tone(500, 1, -0.5)] }, { smoothingTimeConstant: 0 });
  assert.ok(cancel.getByteFrequencyData(new Uint8Array(1024), 0.5).every(value => value === 0), 'opposite channels cancel, as a mono down-mix does');
});

test('inputs, options and lengths are validated and bounded', () => {
  assert.deepEqual(OFFLINE_ANALYSER_DEFAULTS, { fftSize: 2048, smoothingTimeConstant: 0.8, minDecibels: -100, maxDecibels: -30 });
  const ok = { sampleRate: RATE, channels: [new Float32Array(10)] };
  for (const audio of [null, {}, { sampleRate: 100, channels: [new Float32Array(1)] }, { sampleRate: RATE, channels: [] }, { sampleRate: RATE, channels: [[0, 1]] }, { sampleRate: RATE, channels: [new Float32Array(2), new Float32Array(3)] }])
    assert.throws(() => createOfflineAnalyser(audio));
  assert.throws(() => createOfflineAnalyser({ sampleRate: 3000, channels: [new Float32Array(3000 * (OFFLINE_ANALYSER_LIMITS.maximumSeconds + 1))] }), /at most 300/);
  for (const options of [{ fftSize: 1000 }, { fftSize: 16 }, { smoothingTimeConstant: 2 }, { minDecibels: -10, maxDecibels: -20 }]) assert.throws(() => createOfflineAnalyser(ok, options), RangeError);
  const analyser = createOfflineAnalyser(ok, { fftSize: 32, smoothingTimeConstant: undefined });
  assert.equal(analyser.smoothingTimeConstant, 0.8, 'undefined options keep the defaults');
  assert.throws(() => analyser.getByteFrequencyData(new Uint8Array(16), -1), RangeError);
  assert.throws(() => analyser.getByteFrequencyData(new Float32Array(16), 0), TypeError);
  assert.equal(analyser.getByteFrequencyData(new Uint8Array(4), 1).length, 4, 'a short buffer gets the first bins; time past the end reads silence');
});
