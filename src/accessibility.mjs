/**
 * Accessible motion kit: one reduced-motion preference every stage can share,
 * the reduced variant of each agent's settings, the WCAG 2.3.1 flash limiter
 * and a flash meter for rendered frames, and alt text for every export written
 * from the settings that made it. No dependencies; runs in Node, workers and the browser.
 * https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold
 */
import { getAgentTemplate } from './index.mjs';
import { getAgentFieldRoles } from './form-schema.mjs';

/** The same WCAG 2.3.1 limiter the beat tracker uses, for any host-drawn flash or pulse. */
export { createFlashLimiter, prefersReducedMotion } from './beat-tracker.mjs';

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
/** `system` follows the device; `reduce` and `full` are an in-app override. */
export const MOTION_PREFERENCES = Object.freeze(['system', 'reduce', 'full']);
export const FLASH_LIMITS = Object.freeze({ maxFlashesPerSecond: 3, luminanceChange: .1, darkerBelow: .8, windowMs: 1000, samples: 1_000_000, pixels: 65536 });
export const ALT_TEXT_LIMIT = 300;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const preferenceOf = value => MOTION_PREFERENCES.includes(value) ? value : 'system';

/**
 * A `MediaQueryList` look-alike for reduced motion: `matches`, `media` and
 * `change` events, plus `set('system' | 'reduce' | 'full')` for an in-app
 * toggle. Pass it as `motion` to the 3D and frame sculpture stages. Safe where
 * `matchMedia` is missing or throws.
 */
export function createMotionPreference({ preference = 'system', scope = globalThis } = {}) {
  let mode = preferenceOf(preference), query = null;
  try { query = scope?.matchMedia?.(REDUCED_MOTION_QUERY) ?? null; } catch { query = null; }
  const listeners = new Set();
  const compute = () => mode === 'reduce' || (mode === 'system' && !!query?.matches);
  let current = compute();
  const notify = () => {
    const next = compute(); if (next === current) return; current = next;
    const event = Object.freeze({ type: 'change', matches: next, media: REDUCED_MOTION_QUERY });
    [...listeners].forEach(listener => { try { listener(event); } catch { /* One listener cannot break the others. */ } });
  };
  if (query?.addEventListener) query.addEventListener('change', notify); else query?.addListener?.(notify);
  return {
    media: REDUCED_MOTION_QUERY,
    get matches() { return current; },
    get preference() { return mode; },
    get system() { return !!query?.matches; },
    set(next) { mode = preferenceOf(next); notify(); },
    addEventListener(type, listener) { if (type === 'change' && typeof listener === 'function') listeners.add(listener); },
    removeEventListener(type, listener) { if (type === 'change') listeners.delete(listener); },
    dispose() { listeners.clear(); if (query?.removeEventListener) query.removeEventListener('change', notify); else query?.removeListener?.(notify); },
  };
}

const MOTION = Object.freeze({
  'music:reactive': ['calm', 'Reduced motion keeps a calm, still composition and turns beat pulses off.'],
  '3d:scene': ['paused', 'Turntable rotation pauses for reduced motion; you can still orbit by hand.'],
  'frame:sculpture': ['paused', 'Orbit animation pauses for reduced motion; you can still orbit by hand.'],
  'camera:effects': ['still', 'Animated effects hold still for reduced motion.'],
  'camera:avatar': ['still', 'The demo avatar holds still for reduced motion.'],
});
const kindOf = id => {
  const workspace = getAgentTemplate(id)?.workspace;
  if (!workspace) throw new Error('Choose a catalog template.');
  return { kind: workspace.kind, key: `${workspace.kind}:${workspace.operation ?? ''}` };
};

/** Whether an agent moves on its own, and what its reduced-motion variant does. */
export function getAgentMotion(id) {
  const [reduced, note] = MOTION[kindOf(id).key] ?? ['none', ''];
  return Object.freeze({ moves: reduced !== 'none', reduced, note });
}

/**
 * The reduced-motion variant of an agent's settings: turntables and sculptures
 * stop rotating, Sound Canvas renders its calm cover without beat pulses, and
 * camera stages hold their animated effects. Still agents come back unchanged.
 * Returns a fresh plain object and never adds keys a strict validator rejects.
 */
export function reducedMotionSettings(id, settings = {}) {
  const { key } = kindOf(id);
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Pass plain settings.');
  const next = { ...settings };
  if (key === '3d:scene' || key === 'frame:sculpture') next.rotating = false;
  else if (key === 'music:reactive') Object.assign(next, { reducedMotion: true, beatSync: false, pulse: 0 });
  else if (key.startsWith('camera:')) next.reducedMotion = true;
  return next;
}

const LINEAR = Float64Array.from({ length: 256 }, (_, i) => { const c = i / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });

/** Mean WCAG relative luminance (0–1) of an RGBA buffer, sampling at most 65,536 pixels. Alpha is ignored. */
export function frameLuminance(data) {
  if (!data || typeof data.length !== 'number' || data.length < 4 || data.length % 4) throw new TypeError('Pass RGBA pixel data.');
  const pixels = data.length / 4, stride = Math.max(1, Math.ceil(pixels / FLASH_LIMITS.pixels));
  let total = 0, count = 0;
  for (let p = 0; p < pixels; p += stride, count++) {
    const i = p * 4;
    total += .2126 * LINEAR[data[i] & 255] + .7152 * LINEAR[data[i + 1] & 255] + .0722 * LINEAR[data[i + 2] & 255];
  }
  return total / count;
}

/**
 * Count general flashes in a luminance series: a flash is a pair of opposing
 * changes of at least 0.1 relative luminance where the darker state is below
 * 0.8. Pass numbers sampled at `fps`, or `{ time, luminance }` with time in ms.
 * Frame averages miss small-area flashes and red flashes; treat `safe` as a
 * floor, not a certificate.
 */
export function measureFlashes(samples, { fps = 30, maxFlashesPerSecond = FLASH_LIMITS.maxFlashesPerSecond } = {}) {
  if (!Array.isArray(samples) && !ArrayBuffer.isView(samples)) throw new TypeError('Pass an array of luminance samples.');
  if (samples.length > FLASH_LIMITS.samples) throw new RangeError('Measure at most one million frames at a time.');
  if (!(fps > 0 && fps <= 1000)) throw new RangeError('fps must be between 0 and 1000.');
  const limit = Number.isFinite(maxFlashesPerSecond) ? clamp(maxFlashesPerSecond, 0, FLASH_LIMITS.maxFlashesPerSecond) : FLASH_LIMITS.maxFlashesPerSecond;
  const { luminanceChange: step, darkerBelow: dark, windowMs } = FLASH_LIMITS, transitions = [];
  let direction = 0, low = Infinity, high = -Infinity, extreme = 0, previousTime = -Infinity;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i], timed = sample !== null && typeof sample === 'object';
    const value = timed ? sample.luminance : sample, time = timed ? sample.time : i * 1000 / fps;
    if (!Number.isFinite(value) || value < 0 || value > 1 || !Number.isFinite(time) || time < previousTime) throw new RangeError('Samples need luminance from 0 to 1 and times that never go backwards.');
    previousTime = time;
    if (direction === 0) {
      low = Math.min(low, value); high = Math.max(high, value);
      if (value - low >= step && low < dark) { direction = 1; extreme = value; transitions.push(time); }
      else if (high - value >= step && value < dark) { direction = -1; extreme = value; transitions.push(time); }
    } else if (direction > 0) {
      if (value > extreme) extreme = value;
      else if (extreme - value >= step && value < dark) { direction = -1; extreme = value; transitions.push(time); }
    } else if (value < extreme) extreme = value;
    else if (value - extreme >= step && extreme < dark) { direction = 1; extreme = value; transitions.push(time); }
  }
  // Worst one-second window: transitions in [t, t + windowMs), two to a flash.
  let worst = 0, worstAtMs = null;
  for (let start = 0, end = 0; start < transitions.length; start++) {
    while (end < transitions.length && transitions[end] - transitions[start] < windowMs) end++;
    const flashes = Math.floor((end - start) / 2);
    if (flashes > worst) { worst = flashes; worstAtMs = transitions[start]; }
  }
  return Object.freeze({ transitions: transitions.length, flashes: Math.floor(transitions.length / 2), maxFlashesPerSecond: worst, worstAtMs, safe: worst <= limit });
}

const HUES = [[15, 'red'], [40, 'orange'], [65, 'yellow'], [150, 'green'], [190, 'teal'], [250, 'blue'], [290, 'purple'], [345, 'pink'], [360, 'red']];

/** A plain colour name for a six-digit hex ("dark blue", "light grey"), for alt text. */
export function colorName(hex) {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return '';
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), light = (max + min) / 2, chroma = max - min;
  if (light < .08) return 'black';
  if (light > .94 && chroma < .15) return 'white';
  const tone = light < .3 ? 'dark ' : light > .72 ? 'light ' : '';
  if (chroma < .04 || chroma / (1 - Math.abs(2 * light - 1)) < .15) return `${tone}grey`;
  const hue = (max === r ? 60 * (((g - b) / chroma) % 6) : max === g ? 60 * ((b - r) / chroma + 2) : 60 * ((r - g) / chroma + 4)) + 360;
  return `${tone}${HUES.find(([edge]) => hue % 360 < edge)[1]}`;
}

const NOUN = { canvas: 'image', vision: 'image', '3d': 'render', frame: 'snapshot', sketch: 'brief', workflow: 'brief', writing: 'brief' };
const text = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) : '';
const quote = value => (value = text(value)) ? `“${value}”` : '';
const percent = value => `${Math.round(value)}%`;
const join = parts => parts.filter(Boolean).join(', ');
function finish(head, parts) {
  let body = join(parts), out = body ? `${head}: ${body}.` : `${head}.`;
  while (out.length > ALT_TEXT_LIMIT && parts.length) { parts = parts.slice(0, -1); body = join(parts); out = body ? `${head}: ${body}.` : `${head}.`; }
  return out.length > ALT_TEXT_LIMIT ? `${out.slice(0, ALT_TEXT_LIMIT - 1)}…` : out;
}
function size({ width, height } = {}) { return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 ? `, ${width} × ${height}` : ''; }

function fieldPhrase(field, value) {
  const label = field.label.replace(/\s*\((?:mm|%)\)\s*$/i, '').toLowerCase();
  if (field.type === 'number') {
    if (!Number.isFinite(value)) return '';
    if (/\(mm\)/i.test(field.label)) return `${label} ${value} mm`;
    return `${label} ${/\(%\)/.test(field.label) || (field.min === 0 && field.max === 100) ? percent(value) : value}`;
  }
  if (['color', 'background', 'inks'].includes(field.id) || /^#[0-9a-f]{6}$/i.test(value)) return colorName(value) ? `${label} ${colorName(value)}` : text(value) && `${label} ${text(value)}`;
  if (field.type === 'select') return text(value) && `${label} ${text(value)}`;
  return quote(value) && `${label} ${quote(value)}`;
}

/**
 * Alt text for an export, written from the settings that made it: what it is,
 * its size and the settings the engine actually used (colours named, titles
 * quoted, seeds left out), at most 300 characters. `details` adds what only the
 * host knows: `width`, `height`, `lines` (drawn title), `media` (`image` or
 * `video`), `frames`, `subject`, `camera`, `reducedMotion`.
 */
export function describeAgentOutput(id, values = {}, details = {}) {
  const tool = getAgentTemplate(id);
  if (!tool) throw new Error('Choose a catalog template.');
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Pass plain settings.');
  details = details && typeof details === 'object' ? details : {};
  const { kind, key } = kindOf(id), reduced = details.reducedMotion === true || values.reducedMotion === true;
  const video = details.media === 'video';
  if (key === 'music:reactive') {
    const head = `${tool.title} ${video ? 'music visualizer video' : 'cover frame'}${quote(values.title) ? ` for ${quote(values.title)}` : ''}${text(values.artist) ? ` by ${text(values.artist)}` : ''}${size(details)}`;
    return finish(head, [text(values.look) && `${text(values.look)} look`, text(values.ratio), !reduced && Number.isFinite(values.intensity) && `motion intensity ${percent(values.intensity <= 1 ? values.intensity * 100 : values.intensity)}`, reduced ? 'calm still composition for reduced motion' : values.beatSync === false ? '' : video && 'shapes swell on the beat']);
  }
  if (key === 'frame:sculpture') {
    const count = Number.isInteger(details.frames) ? details.frames : null;
    const head = `${tool.title} ${NOUN.frame}${count ? ` of ${count} video frames` : ''}${size(details)}`;
    return finish(head, [text(values.layout) && `${text(values.layout)} layout`, Number.isFinite(values.tilt) && values.tilt !== 0 && `tilted ${Math.round(values.tilt)}°`, Number.isFinite(values.opacity) && values.opacity < 1 && `frames ${percent(values.opacity * 100)} opaque`, colorName(values.background) && `on a ${colorName(values.background)} stage`]);
  }
  if (key === '3d:scene') {
    const material = values.finish ?? (['original', 'ceramic', 'metal', 'clay'].includes(values.material) ? values.material : undefined);
    const exposure = Number.isFinite(values.exposure) ? (values.exposure <= 2.2 ? values.exposure * 100 : values.exposure) : null;
    const view = { iso: 'isometric', isometric: 'isometric', perspective: 'three-quarter' }[details.camera ?? values.view] ?? text(details.camera ?? values.view);
    const head = `${tool.title} ${NOUN['3d']}${text(details.subject) ? ` of ${text(details.subject)}` : text(values.demo) ? ` of the ${text(values.demo)} scene` : ''}${size(details)}`;
    return finish(head, [text(values.lighting) && `${text(values.lighting)} lighting`, material === 'original' ? 'original materials' : text(material) && `${text(material)} finish${colorName(values.color) ? ` in ${colorName(values.color)}` : ''}`, view && `${view} view`, Number.isFinite(values.focalLength) && `${values.focalLength} mm lens`, exposure !== null && exposure !== 100 && `exposure ${percent(exposure)}`, colorName(values.background) && `${colorName(values.background)} background`]);
  }
  const roles = getAgentFieldRoles(tool), engine = tool.fields.filter(field => roles[field.id] === 'engine');
  const fields = (engine.length ? engine : tool.fields).filter(field => !['seed', 'width', 'height'].includes(field.id));
  const lines = Array.isArray(details.lines) ? details.lines.map(text).filter(Boolean).join(' ') : '';
  const parts = fields.map(field => {
    const value = Object.hasOwn(values, field.id) ? values[field.id] : field.default;
    if (lines && ['title', 'text'].includes(field.id)) return `${field.label.toLowerCase()} ${quote(lines)}`;
    if (field.id === 'mirror') return value === 'yes' ? 'mirrored' : '';
    return fieldPhrase(field, value);
  });
  if (kind === 'camera' && reduced) parts.push('held still for reduced motion');
  const noun = kind === 'camera' ? (video ? 'recording' : 'capture') : NOUN[kind] ?? 'result';
  return finish(`${tool.title}${tool.title.toLowerCase().endsWith(noun) ? '' : ` ${noun}`}${size(details)}`, parts);
}
