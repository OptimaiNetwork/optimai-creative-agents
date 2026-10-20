/**
 * Local beat and onset tracking from AnalyserNode frequency bytes. No audio
 * device, timer, model or network: the caller pushes one analyser frame per
 * animation frame with the playback time, and reads back onset, tempo, beat
 * and a flash-limited visual pulse.
 *
 * 1. Log-band spectral flux: the half-wave rectified rise of 24 logarithmic
 *    bands (bytes are already dB-scaled, so this is log-magnitude flux).
 * 2. Adaptive median threshold: an onset is a rising crossing of
 *    `floor + sensitivity × median(flux over the last second)`.
 * 3. Tempo: autocorrelation of the onset train, accumulated as an inter-onset
 *    interval histogram (with multiples) over BPM bins and a mild 120 BPM prior.
 * 4. Beat clock: a phase-locked loop that predicts beats from the tempo and
 *    nudges its phase toward onsets that land near a predicted beat.
 *
 * The visual pulse honours WCAG 2.3.1 (Three Flashes or Below Threshold): pulses
 * are never closer than 1000 / maxFlashesPerSecond ms, so no one-second window
 * holds more than three. Reduced motion keeps tempo and beats but turns the
 * pulse off. https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold
 */
export const BEAT_TRACKER_DEFAULTS = Object.freeze({ minBpm: 70, maxBpm: 180, sensitivity: 1.5, minConfidence: 0.4, maxFlashesPerSecond: 3, pulseMs: 180 });
export const BEAT_TRACKER_LIMITS = Object.freeze({ bands: 24, maxFrequencyBins: 16384, thresholdMs: 1000, historyMs: 8000, maxOnsets: 64, minOnsetGapMs: 100 });
const FLUX_FLOOR = 0.012, PLL_GAIN = 0.3, PERIOD_GAIN = 0.05, TEMPO_BLEND = 0.25;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const number = (value, fallback, low, high) => typeof value === 'number' && Number.isFinite(value) ? clamp(value, low, high) : fallback;

function bpmRange(options = {}) {
  const minBpm = number(options.minBpm, BEAT_TRACKER_DEFAULTS.minBpm, 30, 300);
  const maxBpm = number(options.maxBpm, BEAT_TRACKER_DEFAULTS.maxBpm, 30, 300);
  if (maxBpm < minBpm * 1.25) throw new RangeError('maxBpm must be at least 1.25 × minBpm.');
  return { minBpm, maxBpm };
}

/** Mean of each of 24 log bands (30 Hz to min(11 kHz, Nyquist)), normalized 0–1. */
export function logBandSpectrum(frequencyBytes, { sampleRate = 48000, fftSize = 2048 } = {}, out = new Float32Array(BEAT_TRACKER_LIMITS.bands)) {
  if (Object.prototype.toString.call(frequencyBytes) !== '[object Uint8Array]') throw new TypeError('Frequency data must be a Uint8Array from an AnalyserNode.');
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new RangeError('Use the actual sample rate between 8,000 and 192,000 Hz.');
  if (!Number.isInteger(fftSize) || fftSize < 32 || fftSize > 32768 || (fftSize & (fftSize - 1))) throw new RangeError('FFT size must be a power of two between 32 and 32,768.');
  const size = Math.min(frequencyBytes.length, fftSize / 2, BEAT_TRACKER_LIMITS.maxFrequencyBins), n = BEAT_TRACKER_LIMITS.bands;
  const hzPerBin = sampleRate / fftSize, top = Math.min(11000, sampleRate / 2);
  for (let band = 0; band < n; band++) {
    const low = 30 * Math.pow(top / 30, band / n), high = 30 * Math.pow(top / 30, (band + 1) / n);
    const start = clamp(Math.ceil(low / hzPerBin), 1, size), end = clamp(Math.ceil(high / hzPerBin), start, size);
    let sum = 0;
    for (let bin = start; bin < end; bin++) sum += frequencyBytes[bin];
    // A band narrower than one bin reads the bin nearest its centre.
    const nearest = Math.round(Math.sqrt(low * high) / hzPerBin);
    out[band] = end > start ? sum / (end - start) / 255 : nearest > 0 && nearest < size ? frequencyBytes[nearest] / 255 : 0;
  }
  return out;
}

/** Half-wave rectified spectral flux: the mean rise per band, 0–1. */
export function spectralFlux(previous, current) {
  if (!previous || !current || previous.length !== current.length || !current.length) return 0;
  let rise = 0;
  for (let i = 0; i < current.length; i++) { const d = current[i] - previous[i]; if (d > 0) rise += d; }
  return rise / current.length;
}

/**
 * Tempo from onset times (ms). Every pair of onsets votes for the BPM of its
 * interval and of its halves, thirds and quarters (weight 1/k) on a log-tempo
 * axis (1/120 octave bins), which is the autocorrelation of the onset train.
 * A mild prior around 120 BPM breaks ties, and a doubled tempo that the onsets
 * support almost as well wins over its half (off-beats would otherwise vanish).
 * Confidence is how tightly the onsets sit on the chosen beat or half-beat grid
 * (the circular mean resultant of their phases), above what chance would give. Returns { bpm: 0 } until four
 * onsets are available.
 */
export function estimateTempo(onsetTimes, options = {}) {
  const { minBpm, maxBpm } = bpmRange(options), none = { bpm: 0, periodMs: 0, confidence: 0 };
  const times = Array.isArray(onsetTimes) ? onsetTimes.filter(Number.isFinite).slice(-BEAT_TRACKER_LIMITS.maxOnsets).sort((a, b) => a - b) : [];
  const weights = times.map((_, i) => Array.isArray(options.weights) ? number(options.weights[options.weights.length - times.length + i], 1, 0, 1) : 1);
  if (times.length < 4) return none;
  const perOctave = 120, octave = Math.log2(maxBpm / minBpm), bins = new Float64Array(Math.ceil(octave * perOctave) + 1), longest = 4 * 60000 / minBpm;
  for (let i = 0; i < times.length; i++) {
    for (let j = i + 1; j < times.length; j++) {
      const dt = times[j] - times[i];
      if (dt > longest) break;
      for (let k = 1; k <= 4; k++) {
        // Timing jitter of a few ms is about 1.5% of a beat: spread by σ = 2 bins (1.2%).
        const centre = Math.log2(60000 * k / dt / minBpm) * perOctave;
        if (centre < -6 || centre > bins.length + 5) continue;
        for (let b = Math.max(0, Math.floor(centre - 6)); b <= Math.min(bins.length - 1, Math.ceil(centre + 6)); b++) bins[b] += weights[i] * weights[j] / k * Math.exp(-((b - centre) ** 2) / 8);
      }
    }
  }
  const bpmAt = b => minBpm * 2 ** (b / perOctave);
  const peakNear = (from, to) => { let best = -1; for (let b = Math.max(0, from); b <= Math.min(bins.length - 1, to); b++) if (best < 0 || bins[b] > bins[best]) best = b; return best; };
  let best = 0;
  for (let b = 0; b < bins.length; b++) if (bins[b] * Math.exp(-0.5 * Math.log2(bpmAt(b) / 120) ** 2) > bins[best] * Math.exp(-0.5 * Math.log2(bpmAt(best) / 120) ** 2)) best = b;
  if (!(bins[best] > 0)) return none;
  const doubled = peakNear(best + perOctave - 4, best + perOctave + 4);
  if (doubled >= 0 && bins[doubled] >= 0.6 * bins[best]) best = doubled;
  const left = bins[best - 1] ?? bins[best], right = bins[best + 1] ?? bins[best], curve = left - 2 * bins[best] + right;
  const bpm = clamp(bpmAt(best + (curve < 0 ? 0.5 * (left - right) / curve : 0)), minBpm, maxBpm), periodMs = 60000 / bpm;
  const resultant = period => {
    let x = 0, y = 0, total = 0;
    times.forEach((t, i) => { const a = 2 * Math.PI * t / period; x += weights[i] * Math.cos(a); y += weights[i] * Math.sin(a); total += weights[i]; });
    return total ? Math.hypot(x, y) / total : 0;
  };
  // Random onsets reach a resultant near 1/√n by chance (more after picking the best period), so rescale from 1.5/√n.
  const chance = 1.5 / Math.sqrt(times.length), fit = Math.max(resultant(periodMs), resultant(periodMs / 2));
  return { bpm, periodMs, confidence: clamp((fit - chance) / (1 - chance), 0, 1) };
}

/** WCAG 2.3.1 limiter: `allow(timeMs)` is true at most `maxPerSecond` times per second, evenly spaced. */
export function createFlashLimiter({ maxFlashesPerSecond = BEAT_TRACKER_DEFAULTS.maxFlashesPerSecond } = {}) {
  const gap = 1000 / number(maxFlashesPerSecond, 3, 0.1, 3);
  let last = -Infinity;
  return {
    allow(timeMs) {
      if (!Number.isFinite(timeMs)) return false;
      if (timeMs < last) last = -Infinity; // Time moved backwards (seek or restart).
      if (!(timeMs - last > gap)) return false;
      last = timeMs; return true;
    },
    reset() { last = -Infinity; },
    get minGapMs() { return gap; },
  };
}

/** True when the user asked the system for reduced motion. Safe in Node and workers. */
export function prefersReducedMotion(scope = globalThis) {
  try { return !!scope?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; } catch { return false; }
}

/**
 * Stateful tracker. Call `push(frequencyBytes, timeMs)` once per frame with the
 * playback time in ms (audio.currentTime × 1000). A backwards step or a jump of
 * more than a second (seek, new song) resets it.
 */
export function createBeatTracker(options = {}) {
  const sampleRate = options.sampleRate ?? 48000, fftSize = options.fftSize ?? 2048;
  logBandSpectrum(new Uint8Array(0), { sampleRate, fftSize }); // Validate once up front.
  const range = bpmRange(options);
  const sensitivity = number(options.sensitivity, BEAT_TRACKER_DEFAULTS.sensitivity, 1, 4);
  const minConfidence = number(options.minConfidence, BEAT_TRACKER_DEFAULTS.minConfidence, 0, 1);
  const pulseMs = number(options.pulseMs, BEAT_TRACKER_DEFAULTS.pulseMs, 40, 1000);
  const limiter = createFlashLimiter(options);
  let reducedMotion = options.reducedMotion === true;
  let bands = new Float32Array(BEAT_TRACKER_LIMITS.bands), previous = new Float32Array(BEAT_TRACKER_LIMITS.bands);
  let primed, lastTime, history, onsets, armed, lastOnset, tempo, periodMs, lastBeat, nextBeat, beatCount, flashAt;
  const reset = () => {
    primed = false; lastTime = NaN; history = []; onsets = []; armed = true; lastOnset = -Infinity;
    tempo = { bpm: 0, periodMs: 0, confidence: 0 }; periodMs = 0; lastBeat = NaN; nextBeat = NaN; beatCount = 0; flashAt = -Infinity;
    limiter.reset();
  };
  reset();
  const median = () => {
    const sorted = history.map(entry => entry.flux).sort((a, b) => a - b), mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const retune = () => {
    tempo = estimateTempo(onsets.map(o => o.time), { ...range, weights: onsets.map(o => o.weight) });
    if (tempo.confidence < minConfidence) return;
    // Small drifts glide; a new tempo (or the first) takes over and re-anchors on the latest onset.
    if (periodMs && Math.abs(tempo.periodMs / periodMs - 1) < 0.08) periodMs += (tempo.periodMs - periodMs) * TEMPO_BLEND;
    else { periodMs = tempo.periodMs; lastBeat = onsets.at(-1).time; nextBeat = lastBeat + periodMs; }
  };
  return {
    push(frequencyBytes, timeMs) {
      if (!Number.isFinite(timeMs)) throw new RangeError('Pass the playback time in milliseconds.');
      if (primed && (timeMs < lastTime || timeMs - lastTime > 1000)) reset();
      [bands, previous] = [previous, bands];
      logBandSpectrum(frequencyBytes, { sampleRate, fftSize }, bands);
      const flux = primed ? spectralFlux(previous, bands) : 0;
      // The rise happened between the two frames; its midpoint halves the frame-rate bias.
      const at = primed ? (lastTime + timeMs) / 2 : timeMs;
      primed = true; lastTime = timeMs;
      history.push({ time: timeMs, flux });
      while (history.length > 1 && history[0].time < timeMs - BEAT_TRACKER_LIMITS.thresholdMs) history.shift();
      const threshold = FLUX_FLOOR + sensitivity * median();
      let onset = false, strength = 0;
      if (flux <= threshold) armed = true;
      else if (armed && timeMs - lastOnset >= BEAT_TRACKER_LIMITS.minOnsetGapMs) {
        onset = true; armed = false; lastOnset = at; strength = clamp((flux - threshold) / flux, 0, 1);
        onsets.push({ time: at, weight: 0.5 + 0.5 * strength });
        while (onsets.length > BEAT_TRACKER_LIMITS.maxOnsets || onsets[0].time < timeMs - BEAT_TRACKER_LIMITS.historyMs) onsets.shift();
        retune();
        // Second-order phase-locked loop: pull the grid's phase part of the way toward an
        // onset near a beat, and its period a little, within 8% of the estimated tempo.
        if (periodMs && Number.isFinite(nextBeat)) {
          const toNext = at - nextBeat, toLast = at - lastBeat;
          const error = Math.abs(toNext) < Math.abs(toLast) ? toNext : toLast;
          if (Math.abs(error) < periodMs * 0.25) {
            nextBeat += PLL_GAIN * error; lastBeat += PLL_GAIN * error;
            periodMs = clamp(periodMs + PERIOD_GAIN * error, tempo.periodMs * 0.92, tempo.periodMs * 1.08);
          }
        }
      }
      // Lose the lock when the onsets stop (a quiet passage or a spoken intro).
      if (periodMs && timeMs - lastOnset > BEAT_TRACKER_LIMITS.historyMs / 2) { periodMs = 0; lastBeat = nextBeat = NaN; tempo = { bpm: 0, periodMs: 0, confidence: 0 }; }
      let beat = false, flash = false;
      if (periodMs && timeMs >= nextBeat) {
        beat = true; beatCount++;
        while (nextBeat <= timeMs) { lastBeat = nextBeat; nextBeat += periodMs; }
        if (!reducedMotion && limiter.allow(timeMs)) { flash = true; flashAt = timeMs; }
      }
      const locked = periodMs > 0;
      return {
        time: timeMs, flux, threshold, onset, strength,
        bpm: locked ? 60000 / periodMs : 0, confidence: locked ? tempo.confidence : 0, locked,
        beat, beatCount, phase: locked ? clamp((timeMs - lastBeat) / periodMs, 0, 1) : 0,
        flash, pulse: reducedMotion ? 0 : Math.exp(-Math.max(0, timeMs - flashAt) / pulseMs),
      };
    },
    reset,
    get reducedMotion() { return reducedMotion; },
    set reducedMotion(value) { reducedMotion = value === true; },
    get bpm() { return periodMs ? 60000 / periodMs : 0; },
  };
}
