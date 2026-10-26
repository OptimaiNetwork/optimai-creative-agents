/**
 * Display typography for titles. Original and dependency-free: a minimum-raggedness
 * line breaker (a small Knuth–Plass-style dynamic program over whole words) and
 * optical sizing that tightens tracking and leading as type grows.
 *
 * Widths come from a host `measure(text, fontSize)` (canvas `measureText`, a font
 * table, a test stub) and are assumed to scale with size, so each word is measured
 * once. Words wider than the measure are split between characters so text never
 * leaves the canvas. Hard line breaks (`\n`) always start a new line.
 */
export const TYPESET_LIMITS = Object.freeze({ characters: 2000, size: 1000, lines: 200 });
export const WRAP_MODES = Object.freeze(['balance', 'pretty', 'greedy']);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * Tracking (em) and leading (× size) for a display size: +0.01em and 1.25 at 16px or
 * less, easing on a log scale to −0.02em and 1.08 at 128px or more.
 */
export function opticalSize(fontSize) {
  if (!(fontSize > 0)) throw new RangeError('Font size must be a positive number.');
  const t = clamp((Math.log2(fontSize) - 4) / 3, 0, 1);
  return { tracking: +(0.01 - 0.03 * t).toFixed(4), leading: +(1.25 - 0.17 * t).toFixed(4) };
}

/** Split a paragraph into tokens; a word wider than `width` becomes glued character runs. */
function tokens(words, charWidths, width, tracking) {
  const out = [];
  words.forEach(word => {
    if (word.width + tracking * word.chars.length <= width) { out.push({ text: word.text, width: word.width, chars: word.chars.length, glue: false }); return; }
    let piece = '', pieceWidth = 0, count = 0, glue = false;
    word.chars.forEach((character, index) => {
      const next = charWidths[index + word.offset];
      if (piece && pieceWidth + next + tracking * (count + 1) > width) { out.push({ text: piece, width: pieceWidth, chars: count, glue }); piece = ''; pieceWidth = 0; count = 0; glue = true; }
      piece += character; pieceWidth += next; count++;
    });
    out.push({ text: piece, width: pieceWidth, chars: count, glue });
  });
  return out;
}

/** Break one paragraph's tokens. Returns line start indexes (plus the end). */
function breakTokens(list, space, width, tracking, wrap) {
  const n = list.length;
  if (!n) return [0, 0];
  // Prefix sums give any line's width in O(1): token widths, joining spaces and tracked characters.
  const sumWidth = [0], sumSpace = [0], sumChars = [0];
  list.forEach((token, index) => {
    sumWidth.push(sumWidth[index] + token.width);
    const joins = index > 0 && !token.glue ? 1 : 0;
    sumSpace.push(sumSpace[index] + joins);
    sumChars.push(sumChars[index] + token.chars + joins);
  });
  const lineWidth = (from, to) => sumWidth[to] - sumWidth[from] + space * (sumSpace[to] - sumSpace[from + 1]) + tracking * (sumChars[to] - sumChars[from] - (sumSpace[from + 1] - sumSpace[from]));
  const greedy = [0];
  for (let index = 1; index < n; index++) if (lineWidth(greedy.at(-1), index + 1) > width) greedy.push(index);
  greedy.push(n);
  if (wrap === 'greedy' || greedy.length <= 2) return greedy;
  const lines = greedy.length - 1;
  const slack = (from, to) => ((width - lineWidth(from, to)) / width) ** 2;
  // Every line must fit, so each end only looks back while the line still does.
  const starts = function* (to, first) { for (let start = to - 1; start >= first && (start === to - 1 || lineWidth(start, to) <= width); start--) yield start; };
  if (wrap === 'balance') {
    // Exactly the greedy (minimum) line count, with every line, the last included, as even as possible.
    const cost = Array.from({ length: lines + 1 }, () => new Float64Array(n + 1).fill(Infinity));
    const from = Array.from({ length: lines + 1 }, () => new Int32Array(n + 1));
    cost[0][0] = 0;
    for (let line = 1; line <= lines; line++) for (let to = line; to <= n; to++) for (const start of starts(to, line - 1)) {
      const value = cost[line - 1][start] + slack(start, to);
      if (value < cost[line][to]) { cost[line][to] = value; from[line][to] = start; }
    }
    if (!Number.isFinite(cost[lines][n])) return greedy;
    const breaks = [n];
    for (let line = lines; line > 0; line--) breaks.unshift(from[line][breaks[0]]);
    return breaks;
  }
  // pretty: free line count; the last line costs nothing unless it is a lone short word (a runt); a small cost per line.
  const cost = new Float64Array(n + 1).fill(Infinity), from = new Int32Array(n + 1);
  cost[0] = 0;
  for (let to = 1; to <= n; to++) for (const start of starts(to, 0)) {
    const last = to === n;
    const runt = last && to - start === 1 && start > 0 && lineWidth(start, to) < width / 3 ? 0.5 : 0;
    const value = cost[start] + (last ? 0 : slack(start, to)) + runt + 0.02;
    if (value < cost[to]) { cost[to] = value; from[to] = start; }
  }
  const breaks = [n];
  while (breaks[0] > 0) breaks.unshift(from[breaks[0]]);
  return breaks;
}

/** Measure each word and character once at `fontSize`. */
function measureText(text, measure, fontSize) {
  if (typeof measure !== 'function') throw new TypeError('Pass measure(text, fontSize) returning a width in pixels.');
  if (typeof text !== 'string' || text.length > TYPESET_LIMITS.characters) throw new RangeError(`Text must be a string of at most ${TYPESET_LIMITS.characters} characters.`);
  const read = value => { const width = Number(measure(value, fontSize)); if (!Number.isFinite(width) || width < 0) throw new RangeError('measure() must return a finite, non-negative width.'); return width; };
  const cache = new Map(), at = value => { if (!cache.has(value)) cache.set(value, read(value)); return cache.get(value); };
  const charWidths = [];
  const paragraphs = text.replace(/\r\n?/g, '\n').split('\n').map(paragraph => paragraph.split(/\s+/).filter(Boolean).map(word => {
    const chars = Array.from(word), offset = charWidths.length;
    chars.forEach(character => charWidths.push(at(character)));
    return { text: word, chars, offset, width: at(word) };
  }));
  return { paragraphs, charWidths, space: at(' ') };
}

/** Lay out measured paragraphs at one size. */
function layoutAt(measured, base, fontSize, width, wrap, trackingEm) {
  const scale = fontSize / base, tracking = trackingEm * fontSize;
  const words = measured.paragraphs.map(paragraph => paragraph.map(word => ({ ...word, width: word.width * scale })));
  const charWidths = measured.charWidths.map(value => value * scale);
  const lines = [], widths = [];
  let split = false;
  for (const paragraph of words) {
    const list = tokens(paragraph, charWidths, width, tracking);
    split ||= list.some(token => token.glue);
    const breaks = breakTokens(list, measured.space * scale, width, tracking, wrap);
    for (let index = 0; index + 1 < breaks.length; index++) {
      const part = list.slice(breaks[index], breaks[index + 1]);
      lines.push(part.map((token, at) => (at && !token.glue ? ' ' : '') + token.text).join(''));
      const chars = part.reduce((sum, token, at) => sum + token.chars + (at && !token.glue ? 1 : 0), 0);
      widths.push(part.reduce((sum, token, at) => sum + token.width + (at && !token.glue ? measured.space * scale : 0), 0) + tracking * chars);
    }
  }
  return { lines, widths, split };
}

/**
 * Break text into lines at one size. `wrap`: `balance` (default; the minimum number of
 * lines, all as even as possible), `pretty` (paragraph style: even lines, a free last
 * line without a lone short word) or `greedy` (first fit). `tracking` is in em.
 */
export function breakLines(text, { measure, fontSize = 16, width, wrap = 'balance', tracking = 0 } = {}) {
  if (!WRAP_MODES.includes(wrap)) throw new RangeError(`wrap must be one of ${WRAP_MODES.join(', ')}.`);
  if (!(width > 0) || !Number.isFinite(width)) throw new RangeError('width must be a positive number.');
  if (!(fontSize > 0) || fontSize > TYPESET_LIMITS.size) throw new RangeError(`fontSize must be between 0 and ${TYPESET_LIMITS.size}.`);
  const { lines, widths } = layoutAt(measureText(text, measure, fontSize), fontSize, fontSize, width, wrap, Number(tracking) || 0);
  return { lines, widths };
}

/**
 * The largest size from `maxSize` down to `minSize` at which `text` fits `width` × `height`
 * in at most `maxLines` lines, with optical tracking and leading unless given. Returns the
 * lines, their widths, the size, line height and tracking in pixels, and `fits: false`
 * (laid out at `minSize`) when nothing fits.
 */
export function fitTitle(text, { measure, width, height = Infinity, maxSize, minSize = 1, maxLines = TYPESET_LIMITS.lines, wrap = 'balance', leading, tracking } = {}) {
  if (!WRAP_MODES.includes(wrap)) throw new RangeError(`wrap must be one of ${WRAP_MODES.join(', ')}.`);
  if (!(width > 0) || !Number.isFinite(width)) throw new RangeError('width must be a positive number.');
  if (!(height > 0)) throw new RangeError('height must be a positive number.');
  if (!(maxSize > 0) || maxSize > TYPESET_LIMITS.size || !(minSize > 0) || minSize > maxSize) throw new RangeError(`Sizes must satisfy 0 < minSize ≤ maxSize ≤ ${TYPESET_LIMITS.size}.`);
  const top = Math.floor(maxSize), bottom = Math.max(1, Math.ceil(minSize));
  const measured = measureText(text, measure, top);
  const at = fontSize => {
    const optical = opticalSize(fontSize);
    const trackingEm = tracking ?? optical.tracking, lineHeight = fontSize * (leading ?? optical.leading);
    const { lines, widths, split } = layoutAt(measured, top, fontSize, width, wrap, trackingEm);
    const fits = lines.length <= maxLines && lines.length * lineHeight <= height && widths.every(value => value <= width + 1e-6);
    return { lines, widths, fontSize, lineHeight, tracking: trackingEm * fontSize, width: Math.max(0, ...widths), height: lines.length * lineHeight, fits, split };
  };
  // Larger type needs more lines and taller ones, so the fit is monotone: binary search it. Whole words first;
  // a word is split between characters only when it is wider than the measure even at minSize.
  const search = whole => {
    let low = bottom, high = top, best = null;
    while (low <= high) {
      const middle = (low + high) >> 1, layout = at(middle);
      if (layout.fits && !(whole && layout.split)) { best = layout; low = middle + 1; } else high = middle - 1;
    }
    return best;
  };
  return search(true) ?? search(false) ?? at(bottom);
}

/** A `measure` for fitTitle/breakLines from a 2D context and a CSS font for a size, measured without letter spacing. */
export function canvasMeasure(context, font) {
  return (text, fontSize) => {
    context.font = font(fontSize);
    if ('letterSpacing' in context) context.letterSpacing = '0px';
    return context.measureText(text).width;
  };
}
