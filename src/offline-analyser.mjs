/**
 * An offline AnalyserNode. It reads a decoded song (an `AudioBuffer`, or `{ sampleRate, channels }`) at any time
 * and returns the same frequency bytes a live `AnalyserNode.getByteFrequencyData` would show at that moment:
 * mono down-mix, Blackman window over the `fftSize` samples that end at the time, magnitude / N, the analyser's
 * smoothing over successive reads, then decibels mapped onto 0–255 between `minDecibels` and `maxDecibels`.
 * So a music-reactive canvas can be rendered frame by frame for a video export, faster than real time and in a
 * hidden tab, with the same look as playback. Original radix-2 FFT; no dependencies, Node and browser.
 * https://webaudio.github.io/web-audio-api/#fft-windowing-and-smoothing-over-time
 */
export const OFFLINE_ANALYSER_LIMITS = Object.freeze({ maximumSeconds: 300, maximumSampleRate: 192_000, maximumChannels: 32 });
export const OFFLINE_ANALYSER_DEFAULTS = Object.freeze({ fftSize: 2048, smoothingTimeConstant: 0.8, minDecibels: -100, maxDecibels: -30 });

const tables = new Map();
// Bit-reversal order, twiddles and the Blackman window for one size, built once and shared.
function table(n) {
  if (tables.has(n)) return tables.get(n);
  const bits = Math.log2(n), reverse = new Uint32Array(n), cos = new Float64Array(n / 2), sin = new Float64Array(n / 2), window = new Float64Array(n);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0, v = i; b < bits; b++, v >>= 1) r = (r << 1) | (v & 1); reverse[i] = r; }
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(-2 * Math.PI * i / n); sin[i] = Math.sin(-2 * Math.PI * i / n); }
  for (let i = 0; i < n; i++) window[i] = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / n) + 0.08 * Math.cos(4 * Math.PI * i / n);
  const entry = Object.freeze({ reverse, cos, sin, window });
  tables.set(n, entry); return entry;
}
/** In-place complex FFT of `re` and `im` (length a power of two). Exported for tests and hosts that need a spectrum. */
export function fft(re, im) {
  const n = re.length;
  if (n < 2 || (n & (n - 1)) || im.length !== n) throw new RangeError('FFT buffers are two equal power-of-two lengths.');
  const { reverse, cos, sin } = table(n);
  for (let i = 0; i < n; i++) { const j = reverse[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let start = 0; start < n; start += size) for (let k = 0; k < half; k++) {
      const a = start + k, b = a + half, wr = cos[k * step], wi = sin[k * step];
      const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  }
  return { re, im };
}

// A decoded song as mono samples: the mean of its channels (the speaker down-mix for mono, stereo and quad).
function monoSamples(audio) {
  const sampleRate = Number(audio?.sampleRate);
  if (!Number.isFinite(sampleRate) || sampleRate < 3000 || sampleRate > OFFLINE_ANALYSER_LIMITS.maximumSampleRate) throw new RangeError('Pass decoded audio with a sample rate from 3,000 to 192,000 Hz.');
  const channels = Array.isArray(audio.channels) ? audio.channels
    : typeof audio.getChannelData === 'function' && Number.isInteger(audio.numberOfChannels) ? Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index)) : null;
  if (!channels?.length || channels.length > OFFLINE_ANALYSER_LIMITS.maximumChannels || !channels.every(data => data instanceof Float32Array && data.length === channels[0].length)) throw new TypeError('Pass an AudioBuffer or { sampleRate, channels: Float32Array[] } with equal-length channels.');
  if (channels[0].length / sampleRate > OFFLINE_ANALYSER_LIMITS.maximumSeconds) throw new RangeError(`Songs for offline analysis are at most ${OFFLINE_ANALYSER_LIMITS.maximumSeconds} seconds.`);
  if (channels.length === 1) return { sampleRate, samples: channels[0] };
  const samples = new Float32Array(channels[0].length), scale = 1 / channels.length;
  for (const data of channels) for (let i = 0; i < data.length; i++) samples[i] += data[i] * scale;
  return { sampleRate, samples };
}
function checkOptions({ fftSize, smoothingTimeConstant, minDecibels, maxDecibels }) {
  if (!Number.isInteger(fftSize) || fftSize < 32 || fftSize > 32768 || (fftSize & (fftSize - 1))) throw new RangeError('FFT size must be a power of two between 32 and 32,768.');
  if (!Number.isFinite(smoothingTimeConstant) || smoothingTimeConstant < 0 || smoothingTimeConstant > 1) throw new RangeError('Smoothing must be between 0 and 1.');
  if (!Number.isFinite(minDecibels) || !Number.isFinite(maxDecibels) || minDecibels >= maxDecibels) throw new RangeError('minDecibels must be below maxDecibels.');
}

/**
 * Create an offline analyser over decoded audio. Read times in order (as a live analyser would see them): smoothing
 * carries over from one read to the next, and reading the same time twice returns the same values. `reset()`
 * clears the smoothing, for example before a second export.
 */
export function createOfflineAnalyser(audio, options = {}) {
  const settings = { ...OFFLINE_ANALYSER_DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)) };
  checkOptions(settings);
  const { sampleRate, samples } = monoSamples(audio), { fftSize: n, smoothingTimeConstant: tau, minDecibels, maxDecibels } = settings;
  const bins = n / 2, re = new Float64Array(n), im = new Float64Array(n), smoothed = new Float64Array(bins), { window } = table(n);
  let last = null;
  const analyse = seconds => {
    const time = Number(seconds);
    if (!Number.isFinite(time) || time < 0) throw new RangeError('Analysis time must be a number of seconds from 0.');
    const end = Math.round(time * sampleRate);
    if (end === last) return;
    last = end;
    for (let i = 0, from = end - n; i < n; i++) { const at = from + i; re[i] = (at >= 0 && at < samples.length ? samples[at] : 0) * window[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < bins; k++) {
      const value = tau * smoothed[k] + (1 - tau) * Math.hypot(re[k], im[k]) / n;
      smoothed[k] = Number.isFinite(value) ? value : 0;
    }
  };
  const view = (out, type) => {
    if (!(out instanceof type)) throw new TypeError(`Pass a ${type.name} for the frequency data.`);
    return Math.min(out.length, bins);
  };
  return Object.freeze({
    sampleRate, fftSize: n, frequencyBinCount: bins, smoothingTimeConstant: tau, minDecibels, maxDecibels, duration: samples.length / sampleRate,
    /** Write 0–255 frequency bytes for the moment `seconds` into `out` (a `Uint8Array`, usually `frequencyBinCount` long); returns `out`. */
    getByteFrequencyData(out, seconds) {
      const count = view(out, Uint8Array); analyse(seconds);
      const scale = 255 / (maxDecibels - minDecibels);
      for (let k = 0; k < count; k++) { const db = smoothed[k] > 0 ? 20 * Math.log10(smoothed[k]) : -Infinity; out[k] = Math.max(0, Math.min(255, Math.floor(scale * (db - minDecibels)))); }
      return out;
    },
    /** Write decibel values (−Infinity for silence) for the moment `seconds` into `out` (a `Float32Array`); returns `out`. */
    getFloatFrequencyData(out, seconds) {
      const count = view(out, Float32Array); analyse(seconds);
      for (let k = 0; k < count; k++) out[k] = smoothed[k] > 0 ? 20 * Math.log10(smoothed[k]) : -Infinity;
      return out;
    },
    reset() { smoothed.fill(0); last = null; },
  });
}
