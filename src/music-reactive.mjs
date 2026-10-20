/**
 * Local, deterministic music visuals. This module never opens an audio device,
 * loads a model, sends media, creates a timer, or owns the caller's canvas.
 *
 * Frequency bytes encode the analyser's configured dB range, not PCM amplitude.
 * These are visual control signals, not a loudness, BPM or beat detector; for
 * onsets, tempo and a flash-limited beat pulse use ./beat-tracker.mjs.
 * https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/getByteFrequencyData
 */
export const MUSIC_REACTIVE_LOOKS = Object.freeze([
  Object.freeze({ id: 'orbital', title: 'Orbital bloom', description: 'Luminous orbit rings expand with the low end.' }),
  Object.freeze({ id: 'ribbons', title: 'Silk ribbons', description: 'Flowing contours turn your sound into a living sculpture.' }),
  Object.freeze({ id: 'spectrum', title: 'Spectrum stage', description: 'A sculpted frequency spectrum with a cinematic reflection.' }),
  Object.freeze({ id: 'aurora', title: 'Midnight aurora', description: 'Violet and mint light trails drift through a quiet star field.' }),
]);

export const MUSIC_REACTIVE_LIMITS = Object.freeze({ bands: 48, maxFrequencyBins: 16384, maxDimension: 4096, maxPixels: 8_388_608 });
const TAU = Math.PI * 2;
const unit = value => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const finite = (value, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const quietFeatures = () => ({ energy: 0, bass: 0, treble: 0, bands: Array(MUSIC_REACTIVE_LIMITS.bands).fill(0) });

/**
 * Read at most 16,384 Uint8Array bins. Supply the actual AudioContext.sampleRate
 * and AnalyserNode.fftSize: a shortened buffer does not change bin frequencies.
 * Bands are 48 logarithmic display bands from 40 Hz to min(8 kHz, Nyquist).
 * Bass: 20–250 Hz; treble: 2–8 kHz; energy: RMS of display bytes at 20–8 kHz.
 * Set analyser.smoothingTimeConstant to 0 when using our elapsed-time smoother
 * to avoid applying two unrelated temporal filters.
 */
export function extractMusicReactiveFeatures(frequencyBytes, { sampleRate = 48000, fftSize = 2048 } = {}) {
  if (!ArrayBuffer.isView(frequencyBytes) || Object.prototype.toString.call(frequencyBytes) !== '[object Uint8Array]') {
    throw new TypeError('Frequency data must be a Uint8Array from an AnalyserNode.');
  }
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
    throw new RangeError('Use the actual sample rate between 8,000 and 192,000 Hz.');
  }
  if (!Number.isInteger(fftSize) || fftSize < 32 || fftSize > 32768 || (fftSize & (fftSize - 1)) !== 0) {
    throw new RangeError('FFT size must be a power of two between 32 and 32,768.');
  }
  const size = Math.min(frequencyBytes.length, fftSize / 2, MUSIC_REACTIVE_LIMITS.maxFrequencyBins);
  if (!size) return quietFeatures();
  const hzPerBin = sampleRate / fftSize;
  const upperHz = Math.min(8000, sampleRate / 2);
  const range = (low, high, rms = false) => {
    const start = clamp(Math.ceil(low / hzPerBin), 1, size);
    const end = clamp(Math.ceil(high / hzPerBin), start, size);
    if (end <= start) return 0;
    let sum = 0;
    for (let index = start; index < end; index++) {
      const value = frequencyBytes[index] / 255;
      sum += rms ? value * value : value;
    }
    return rms ? Math.sqrt(sum / (end - start)) : sum / (end - start);
  };
  const bands = Array.from({ length: MUSIC_REACTIVE_LIMITS.bands }, (_, index) => {
    const low = 40 * Math.pow(upperHz / 40, index / MUSIC_REACTIVE_LIMITS.bands);
    const high = 40 * Math.pow(upperHz / 40, (index + 1) / MUSIC_REACTIVE_LIMITS.bands);
    // Narrow low-frequency bands can contain no FFT centre; use the nearest bin.
    const value = range(low, high);
    if (Math.ceil(high / hzPerBin) > Math.ceil(low / hzPerBin)) return value;
    const nearest = Math.round(Math.sqrt(low * high) / hzPerBin);
    return nearest > 0 && nearest < size ? frequencyBytes[nearest] / 255 : 0;
  });
  return { energy: range(20, upperHz, true), bass: range(20, Math.min(250, upperHz)), treble: range(2000, upperHz), bands };
}

/**
 * Pure, frame-rate-independent attack/release smoothing (milliseconds). A null
 * previous value explicitly resets to the current frame; use it after a seek,
 * source change or restart. For silence, supply zero target features and allow
 * release to decay; do not reuse the previous song's state. Long background-tab
 * gaps settle the state rather than creating a spring overshoot. Inputs remain
 * untouched and every output signal is normalized to 0–1.
 */
export function smoothMusicReactiveFeatures(previous, target, elapsedMs, { attackMs = 80, releaseMs = 300 } = {}) {
  const next = target && typeof target === 'object' ? target : quietFeatures();
  const elapsed = clamp(finite(elapsedMs), 0, 10000);
  const attack = clamp(finite(attackMs, 80), 16, 2000);
  const release = clamp(finite(releaseMs, 300), 16, 5000);
  const smooth = (from, to) => {
    const value = unit(to);
    if (previous == null) return value;
    const old = unit(from);
    return old + (value - old) * -Math.expm1(-elapsed / (value > old ? attack : release));
  };
  return {
    energy: smooth(previous?.energy, next.energy), bass: smooth(previous?.bass, next.bass), treble: smooth(previous?.treble, next.treble),
    bands: Array.from({ length: MUSIC_REACTIVE_LIMITS.bands }, (_, index) => smooth(previous?.bands?.[index], next.bands?.[index])),
  };
}

function backdrop(ctx, width, height, look) {
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, look === 'spectrum' ? '#11151b' : '#080b16');
  bg.addColorStop(.55, look === 'ribbons' ? '#172024' : '#111125');
  bg.addColorStop(1, '#06090e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(width * .5, height * .43, 0, width * .5, height * .43, Math.max(width, height) * .66);
  glow.addColorStop(0, look === 'orbital' ? '#b6e97715' : '#9882f51b');
  glow.addColorStop(1, '#10121a00');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
}

function orbit(ctx, s) {
  const { width: w, height: h, time: t, bass, energy, intensity, pulse } = s;
  const cx = w * .5, cy = h * .43, radius = Math.min(w * .43, h * .36);
  const tilt = .42 + Math.sin(t * .12) * .07;
  ctx.save();
  try {
  ctx.translate(cx, cy); ctx.rotate(Math.sin(t * .1) * .18 - .18);
  for (let ring = 0; ring < 19; ring++) {
    const r = radius * (.19 + ring / 23) * (1 + bass * intensity * .12 + pulse * intensity * .05);
    const gradient = ctx.createLinearGradient(-r, -r, r, r);
    gradient.addColorStop(0, `rgba(207,246,119,${.18 + ring / 70})`);
    gradient.addColorStop(.52, 'rgba(109,245,213,.65)');
    gradient.addColorStop(1, 'rgba(163,136,244,.2)');
    ctx.strokeStyle = gradient;
    ctx.lineWidth = Math.max(.75, Math.min(w, h) * .0016) * (ring % 4 === 0 ? 1.7 : 1);
    ctx.beginPath();
    for (let step = 0; step <= 96; step++) {
      const angle = step / 96 * TAU;
      const ripple = 1 + Math.sin(angle * 3 + t * .6 + ring * .22) * (.012 + energy * intensity * .028);
      const x = Math.cos(angle) * r * ripple, y = Math.sin(angle) * r * tilt * ripple;
      if (step === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.stroke();
  }
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * .22);
  core.addColorStop(0, '#e9ffb44a'); core.addColorStop(.3, '#a1edbc22'); core.addColorStop(1, '#84ccea00');
  ctx.fillStyle = core; ctx.beginPath(); ctx.arc(0, 0, radius * .22, 0, TAU); ctx.fill();
  for (let dot = 0; dot < 6; dot++) {
    const angle = t * .18 + dot * TAU / 6;
    const r = radius * (.57 + dot * .065);
    ctx.fillStyle = dot % 2 ? '#b6a1ec' : '#d5f795';
    ctx.beginPath(); ctx.arc(Math.cos(angle) * r, Math.sin(angle) * r * tilt, Math.max(1.5, w * .0028), 0, TAU); ctx.fill();
  }
  } finally { ctx.restore(); }
}

function ribbons(ctx, s) {
  const { width: w, height: h, time: t, energy, treble, intensity, pulse } = s;
  for (let ribbon = 0; ribbon < 26; ribbon++) {
    const z = ribbon / 25;
    const gradient = ctx.createLinearGradient(0, h * .2, w, h * .7);
    gradient.addColorStop(0, `rgba(156,136,238,${.15 + z * .2})`);
    gradient.addColorStop(.48, `rgba(201,243,130,${.4 + z * .2})`);
    gradient.addColorStop(1, 'rgba(77,231,204,.2)');
    ctx.strokeStyle = gradient; ctx.lineWidth = Math.max(.6, Math.min(w, h) * .0015);
    ctx.beginPath();
    for (let step = 0; step <= 80; step++) {
      const x = step / 80;
      const envelope = Math.sin(x * Math.PI);
      const wave = Math.sin(x * TAU * 1.1 + t * .38 + z * 1.8) * .12 + Math.sin(x * TAU * 2.1 - t * .22 + z * 2) * (.035 + treble * intensity * .018);
      const y = h * (.4 + z * .19 + envelope * wave * (1 + energy * intensity * .5 + pulse * intensity * .3)) - x * h * .1;
      if (!step) ctx.moveTo(x * w, y); else ctx.lineTo(x * w, y);
    }
    ctx.stroke();
  }
}

function spectrum(ctx, s) {
  const { width: w, height: h, bass, energy, treble, intensity, bands, pulse } = s;
  const count = MUSIC_REACTIVE_LIMITS.bands, left = w * .1, span = w * .8, floor = h * .57;
  const gap = span / count, barWidth = gap * .52;
  const gradient = ctx.createLinearGradient(left, 0, left + span, 0);
  gradient.addColorStop(0, '#a28feb'); gradient.addColorStop(.46, '#d8f783'); gradient.addColorStop(1, '#5addc9');
  for (let index = 0; index < count; index++) {
    const position = index / (count - 1);
    const signal = bands ? unit(bands[index]) : (position < .2 ? bass : position > .65 ? treble : energy);
    const height = Math.max(h * .009, Math.pow(signal, .75) * h * .32 * intensity * (1 + pulse * .12));
    const x = left + gap * index;
    ctx.strokeStyle = gradient; ctx.lineWidth = barWidth; ctx.beginPath(); ctx.moveTo(x, floor); ctx.lineTo(x, floor - height); ctx.stroke();
    ctx.globalAlpha = .12; ctx.beginPath(); ctx.moveTo(x, floor + gap); ctx.lineTo(x, floor + gap + height * .34); ctx.stroke(); ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = '#d5e6cd20'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(left, floor + gap * .5); ctx.lineTo(left + span, floor + gap * .5); ctx.stroke();
}

function aurora(ctx, s) {
  const { width: w, height: h, time: t, energy, bass, intensity, pulse } = s;
  for (let field = 0; field < 3; field++) {
    const x = w * (.3 + field * .2 + Math.sin(t * .09 + field * 2) * .06);
    const y = h * (.39 + Math.cos(t * .07 + field) * .08);
    const radius = Math.min(w, h) * (.36 + energy * intensity * .04 + pulse * intensity * .025);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, ['#8772d637', '#8ed6be28', '#c5e48224'][field]); glow.addColorStop(1, '#11112400');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
  }
  for (let line = 0; line < 17; line++) {
    ctx.strokeStyle = line % 3 === 0 ? '#c9f19455' : '#a897eb33';
    ctx.lineWidth = Math.max(.6, w * .001);
    ctx.beginPath();
    for (let step = 0; step <= 64; step++) {
      const x = step / 64, phase = x * TAU * .85 + t * .16 + line * .05;
      const y = h * (.38 + line * .012 + Math.sin(phase) * (.13 + bass * intensity * .025)) + Math.sin(x * TAU * 2 - t * .2) * h * .026;
      if (!step) ctx.moveTo(x * w, y); else ctx.lineTo(x * w, y);
    }
    ctx.stroke();
  }
  // Deterministic, stationary stars: no random frame noise or blinking.
  for (let star = 0; star < 32; star++) {
    const x = ((star * 137.508) % 997) / 997 * w, y = ((star * 79.713 + 43) % 811) / 811 * h * .7;
    ctx.fillStyle = '#d2d7ec44'; ctx.beginPath(); ctx.arc(x, y, Math.max(.8, w * .0009), 0, TAU); ctx.fill();
  }
}

const plainText = value => typeof value === 'string' ? Array.from(value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()).slice(0, 120).join('') : '';
function caption(ctx, width, height, title, artist) {
  if (!title && !artist) return;
  const margin = Math.min(width * .085, height * .085), maxWidth = width - margin * 2;
  const fontSize = Math.max(12, Math.min(width * .047, height * .065, 78));
  const scrim = ctx.createLinearGradient(0, height * .62, 0, height);
  scrim.addColorStop(0, '#06090e00'); scrim.addColorStop(1, '#06090ec9');
  ctx.fillStyle = scrim; ctx.fillRect(0, height * .62, width, height * .38);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const fit = (text, size) => {
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) return text;
    const points = Array.from(text);
    while (points.length && ctx.measureText(`${points.join('')}…`).width > maxWidth) points.pop();
    return `${points.join('')}…`;
  };
  const baseline = height - margin;
  if (artist) {
    ctx.fillStyle = '#cad2dd';
    ctx.fillText(fit(artist, fontSize * .42), margin, baseline - (title ? fontSize * 1.38 : 0));
  }
  if (title) {
    ctx.fillStyle = '#f5f7ef';
    ctx.fillText(fit(title, fontSize), margin, baseline);
  }
}

/**
 * Draw one complete frame; time is audio playback seconds, intensity is 0–1.
 * Look IDs are allowlisted. Optional bands preserve a measured spectrum; if
 * absent the spectrum uses the three aggregate signals without invented beats.
 * Reduced motion produces an invariant cover frame (including audio signals),
 * suitable for a still export. No strobes, flashing backgrounds, or frame noise.
 * Optional pulse (0–1, e.g. from beat-tracker) swells geometry on the beat; it
 * never changes colour or brightness, and reduced motion ignores it.
 * Work is fixed/bounded and caller state is restored even if drawing throws.
 */
export function renderMusicReactiveFrame(ctx, options = {}) {
  if (!ctx || typeof ctx.save !== 'function' || typeof ctx.restore !== 'function' || typeof ctx.setTransform !== 'function') {
    throw new TypeError('A CanvasRenderingContext2D is required.');
  }
  const { width, height } = options;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MUSIC_REACTIVE_LIMITS.maxDimension || height > MUSIC_REACTIVE_LIMITS.maxDimension || width * height > MUSIC_REACTIVE_LIMITS.maxPixels) {
    throw new RangeError('Frame dimensions must be positive integers, at most 4,096 per side and 8 million pixels.');
  }
  const look = MUSIC_REACTIVE_LOOKS.some(item => item.id === options.look) ? options.look : 'orbital';
  const reduced = options.reducedMotion === true;
  const settings = {
    width, height, look, intensity: options.intensity == null ? .8 : unit(options.intensity),
    time: reduced ? 0 : clamp(finite(options.time), 0, 86400),
    energy: reduced ? .25 : unit(options.energy), bass: reduced ? .2 : unit(options.bass), treble: reduced ? .15 : unit(options.treble),
    bands: reduced ? Array(MUSIC_REACTIVE_LIMITS.bands).fill(.23) : options.bands, pulse: reduced ? 0 : unit(options.pulse),
  };
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.shadowBlur = 0; ctx.filter = 'none'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
    backdrop(ctx, width, height, look);
    ({ orbital: orbit, ribbons, spectrum, aurora })[look](ctx, settings);
    caption(ctx, width, height, plainText(options.title), plainText(options.artist));
  } finally { ctx.restore(); }
}
