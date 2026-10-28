/**
 * Still-frame transitions between two shots. Original, deterministic and
 * dependency-free; everything runs on plain RGBA buffers in Node and the browser.
 *
 * Every style except `push` is a matte: each pixel gets an order `d` in 0–1 (its
 * place along a wipe, its distance from an iris centre, or how dark the outgoing
 * shot is there) and blends to the incoming shot as the edge passes it. The
 * edge travels from 0 to 1 + softness, so progress 0 is the first shot and 1 the
 * second exactly, and `softness` is the width of the feathered edge in the same
 * units. `push` slides both shots along one axis instead. Time is eased by the
 * pace before it moves the edge, so evenly spaced strip frames read as motion.
 */
export const TRANSITION_STYLES = Object.freeze(['wipe', 'radial', 'luma', 'push', 'dissolve']);
export const TRANSITION_DIRECTIONS = Object.freeze(['right', 'left', 'down', 'up']);
export const TRANSITION_EASES = Object.freeze(['linear', 'in-out', 'out']);
/** Recipe pace names: how soft the moving edge is (a quick cut is nearly hard; a slow one melts). */
export const TRANSITION_PACES = Object.freeze({
  quick: Object.freeze({ ease: 'in-out', softness: 0.04 }),
  gentle: Object.freeze({ ease: 'in-out', softness: 0.15 }),
  'slow cinematic': Object.freeze({ ease: 'in-out', softness: 0.35 }),
});
/** Recipe technique names (the template's `transition` field) and the style each one draws. */
export const TRANSITION_TECHNIQUES = Object.freeze({ 'match cut': 'radial', 'camera move': 'push', 'light wipe': 'wipe', morph: 'luma' });
export const TRANSITION_LIMITS = Object.freeze({ frames: 12, pixels: 16_000_000 });

const pick = (value, allowed, name) => { if (!allowed.includes(value)) throw new RangeError(`Choose a supported transition ${name}.`); return value; };

/** Validate and complete transition settings; `pace` supplies `ease` and `softness` unless they are given. */
export function resolveTransition(options = {}) {
  const pace = TRANSITION_PACES[pick(options.pace ?? 'gentle', Object.keys(TRANSITION_PACES), 'pace')];
  const softness = Number(options.softness ?? pace.softness);
  if (!Number.isFinite(softness) || softness < 0 || softness > 1) throw new RangeError('Transition softness must be between 0 and 1.');
  const center = options.center ?? [0.5, 0.5];
  if (!Array.isArray(center) || center.length !== 2 || !center.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new RangeError('A transition center is two numbers from 0 to 1.');
  return Object.freeze({
    style: pick(options.style ?? 'radial', TRANSITION_STYLES, 'style'),
    direction: pick(options.direction ?? 'right', TRANSITION_DIRECTIONS, 'direction'),
    ease: pick(options.ease ?? pace.ease, TRANSITION_EASES, 'ease'),
    softness, center: Object.freeze([...center]),
  });
}

/** Eased progress for a time from 0 to 1. */
export function transitionProgress(time, ease = 'in-out') {
  const t = Number(time);
  if (!Number.isFinite(t)) throw new RangeError('Transition time must be a number from 0 to 1.');
  const x = Math.min(1, Math.max(0, t));
  pick(ease, TRANSITION_EASES, 'ease');
  return ease === 'linear' ? x : ease === 'out' ? 1 - (1 - x) ** 3 : x * x * (3 - 2 * x);
}

/** `count` evenly spaced times from 0 to 1 inclusive, for a preview strip. */
export function transitionTimes(count) {
  if (!Number.isInteger(count) || count < 2 || count > TRANSITION_LIMITS.frames) throw new RangeError(`A transition strip has 2 to ${TRANSITION_LIMITS.frames} frames.`);
  return Array.from({ length: count }, (_, index) => index / (count - 1));
}

/**
 * Compose one frame of `from` → `to` (RGBA, same size) at an eased `progress` into
 * `out` (a new buffer by default; it may be `from` or `to`, except for `push`).
 * Output is opaque; returns `out`.
 */
export function composeTransition(from, to, width, height, progress, options = {}, out = new Uint8ClampedArray(width * height * 4)) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > TRANSITION_LIMITS.pixels) throw new RangeError(`Transition frames are 1 to ${TRANSITION_LIMITS.pixels} pixels.`);
  const size = width * height * 4;
  for (const buffer of [from, to, out]) if (!(buffer?.length === size) || typeof buffer.BYTES_PER_ELEMENT !== 'number') throw new TypeError('Pass RGBA buffers of width × height × 4 bytes.');
  const p = Number(progress);
  if (!Number.isFinite(p) || p < 0 || p > 1) throw new RangeError('Transition progress must be between 0 and 1.');
  const { style, direction, softness, center } = resolveTransition(options);
  if (style === 'push') {
    if (out === from || out === to) throw new TypeError('A push needs a separate output buffer.');
    // Both shots move together: the outgoing one leaves toward `direction` as the incoming one follows it in.
    const horizontal = direction === 'right' || direction === 'left', span = horizontal ? width : height;
    const shift = Math.round(p * span), sign = direction === 'right' || direction === 'down' ? 1 : -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const along = (horizontal ? x : y) - sign * shift, source = along >= 0 && along < span ? from : to;
      const s = along < 0 ? along + span : along >= span ? along - span : along;
      const index = (y * width + x) * 4, read = (horizontal ? y * width + s : s * width + x) * 4;
      out[index] = source[read]; out[index + 1] = source[read + 1]; out[index + 2] = source[read + 2]; out[index + 3] = 255;
    }
    return out;
  }
  const edge = p * (1 + softness);
  const cx = center[0] * (width - 1), cy = center[1] * (height - 1);
  const reach = Math.hypot(Math.max(cx, width - 1 - cx), Math.max(cy, height - 1 - cy)) || 1;
  for (let y = 0, index = 0; y < height; y++) for (let x = 0; x < width; x++, index += 4) {
    let d;
    if (style === 'dissolve') d = 0.5;
    else if (style === 'radial') d = Math.hypot(x - cx, y - cy) / reach;
    else if (style === 'luma') d = 1 - (0.2126 * from[index] + 0.7152 * from[index + 1] + 0.0722 * from[index + 2]) / 255;
    else d = direction === 'right' ? x / Math.max(1, width - 1) : direction === 'left' ? 1 - x / Math.max(1, width - 1) : direction === 'down' ? y / Math.max(1, height - 1) : 1 - y / Math.max(1, height - 1);
    let w;
    if (style === 'dissolve') w = p;
    else if (!softness) w = p > 0 && p >= d ? 1 : 0;
    else { const t = Math.min(1, Math.max(0, (edge - d) / softness)); w = t * t * (3 - 2 * t); }
    for (let channel = 0; channel < 3; channel++) out[index + channel] = from[index + channel] + (to[index + channel] - from[index + channel]) * w;
    out[index + 3] = 255;
  }
  return out;
}
