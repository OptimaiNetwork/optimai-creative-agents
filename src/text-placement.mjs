/**
 * Calm-region text placement. Original, deterministic and dependency-free; the
 * pure steps run in Node. A title block slides over a grid of candidate spots
 * inside its bounds and lands where the smart-crop focus map holds the least
 * interest, with a gentle pull toward the layout's usual (home) spot so a flat
 * or evenly busy image keeps the classic layout.
 *
 * Interest under a box is read from a summed-area table sampled bilinearly, so a
 * box costs four lookups at any size. A scrim is fitted only when the chosen ink
 * still fails contrast there: the smallest opacity of a black or white panel
 * that lifts the ink to the target over every background color it covers.
 */
import { contrastRatio, formatHexColor, parseHexColor, pickLegibleColor, toOklab } from './color.mjs';

export const TEXT_POSITIONS = Object.freeze(['auto', 'top', 'center', 'bottom']);
export const PLACEMENT_LIMITS = Object.freeze({ maxSteps: 33, maxOpacity: 0.85 });
const HOMES = Object.freeze({ top: 0, center: 0.5, bottom: 1 });

const clamp01 = value => Math.min(1, Math.max(0, value));
function checkFocus(focus) {
  if (!focus || !(focus.map instanceof Float32Array) || !Number.isInteger(focus.width) || !Number.isInteger(focus.height) || focus.map.length !== focus.width * focus.height) {
    throw new TypeError('Pass a focus map from computeFocusMap or analyzeImageFocus.');
  }
}
function checkRect(rect, name, origin = true) {
  if (!rect || ![...(origin ? [rect.x, rect.y] : []), rect.width, rect.height].every(Number.isFinite) || rect.width < 0 || rect.height < 0) {
    throw new RangeError(`${name} must be { ${origin ? 'x, y, ' : ''}width, height } with finite, non-negative sizes.`);
  }
}

/** Summed-area table, (width + 1) × (height + 1), with a zero first row and column. */
function integral({ map, width, height }) {
  const sat = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) { row += map[y * width + x]; sat[(y + 1) * (width + 1) + x + 1] = sat[y * (width + 1) + x + 1] + row; }
  }
  return sat;
}
// Area-exact for whole cells and linear inside a cell: the table sampled bilinearly.
function sampleSat(sat, width, height, x, y) {
  x = Math.min(width, Math.max(0, x)); y = Math.min(height, Math.max(0, y));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(width, x0 + 1), y1 = Math.min(height, y0 + 1), fx = x - x0, fy = y - y0, stride = width + 1;
  const top = sat[y0 * stride + x0] * (1 - fx) + sat[y0 * stride + x1] * fx;
  const bottom = sat[y1 * stride + x0] * (1 - fx) + sat[y1 * stride + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}
function interestReader(focus, canvasWidth, canvasHeight) {
  const sat = integral(focus), { width, height } = focus;
  const total = sat[sat.length - 1], mean = total / (width * height);
  const sx = width / canvasWidth, sy = height / canvasHeight;
  // Mean interest per map cell under a canvas rectangle, relative to the image mean (1 = average).
  return rect => {
    const x0 = rect.x * sx, y0 = rect.y * sy, x1 = (rect.x + rect.width) * sx, y1 = (rect.y + rect.height) * sy;
    const area = Math.max(1e-9, (Math.min(width, x1) - Math.max(0, x0)) * (Math.min(height, y1) - Math.max(0, y0)));
    if (!(mean > 0) || x1 <= 0 || y1 <= 0 || x0 >= width || y0 >= height) return 0;
    const sum = sampleSat(sat, width, height, x1, y1) - sampleSat(sat, width, height, x0, y1) - sampleSat(sat, width, height, x1, y0) + sampleSat(sat, width, height, x0, y0);
    return Math.max(0, sum) / area / mean;
  };
}

/**
 * Interest under `region` (canvas pixels) relative to the whole image: 0 is
 * calm, 1 is average, above 1 is busier than average. A flat map reads 0.
 * `canvas` is the `{ width, height }` the focus map was read from.
 */
export function regionInterest(focus, region, canvas) {
  checkFocus(focus); checkRect(region, 'Region');
  if (!(canvas?.width > 0) || !(canvas?.height > 0)) throw new RangeError('Pass the canvas { width, height } the focus map covers.');
  return interestReader(focus, canvas.width, canvas.height)(region);
}

/**
 * Where to put a `block` ({ width, height }) inside `bounds` on a `canvas`
 * ({ width, height }), all in canvas pixels. `position` is `auto` (the calmest
 * spot) or a fixed `top`, `center` or `bottom`. `home` ({ x, y }, 0–1 across the
 * free space) is the layout's usual spot; `homeBias` is the cost of moving all
 * the way across, in units of average interest. `columns` and `rows` set the
 * candidate grid (home is always a candidate). Interest is read over the block
 * grown by `breathing` pixels on each side (default 4% of the shorter canvas
 * side), so the title keeps some air around a subject. The block leaves home
 * only when that is at least `minGain` (in units of average interest) calmer,
 * so a weak focus map never shuffles a classic layout. Without a focus map, or with a
 * flat one, the block stays home. Returns `{ x, y, width, height, position,
 * interest, homeInterest, moved }`, where `position` names the vertical third.
 */
export function placeTextBlock(focus, { canvas, block, bounds, position = 'auto', home = { x: 0, y: 1 }, homeBias = 0.25, minGain = 0.25, columns = 1, rows = 9, breathing } = {}) {
  if (!(canvas?.width > 0) || !(canvas?.height > 0)) throw new RangeError('Pass the canvas { width, height }.');
  const area = bounds ?? { x: 0, y: 0, width: canvas.width, height: canvas.height };
  checkRect(block, 'Block', false); checkRect(area, 'Bounds');
  if (!TEXT_POSITIONS.includes(position)) throw new RangeError(`Choose a position: ${TEXT_POSITIONS.join(', ')}.`);
  if (focus) checkFocus(focus);
  const steps = value => Math.max(1, Math.min(PLACEMENT_LIMITS.maxSteps, Math.round(Number(value) || 1)));
  const bias = Math.max(0, Number(homeBias) || 0);
  const start = { x: clamp01(Number(home?.x ?? 0)), y: position === 'auto' ? clamp01(Number(home?.y ?? 1)) : HOMES[position] };
  const freeX = Math.max(0, area.width - block.width), freeY = Math.max(0, area.height - block.height);
  const air = Math.max(0, Number(breathing ?? Math.min(canvas.width, canvas.height) * 0.04) || 0);
  const reader = focus ? interestReader(focus, canvas.width, canvas.height) : () => 0;
  const read = rect => reader({ x: rect.x - air, y: rect.y - air, width: rect.width + air * 2, height: rect.height + air * 2 });
  const at = (u, v) => ({ x: area.x + freeX * u, y: area.y + freeY * v, width: block.width, height: block.height });
  const axis = (count, value) => [...new Set([value, ...Array.from({ length: count }, (_, index) => count > 1 ? index / (count - 1) : value)])];
  const homeInterest = read(at(start.x, start.y));
  let best = { u: start.x, v: start.y, interest: homeInterest, cost: homeInterest };
  if (position === 'auto' && focus) {
    for (const v of axis(freeY > 0 ? steps(rows) : 1, start.y)) {
      for (const u of axis(freeX > 0 ? steps(columns) : 1, start.x)) {
        const interest = read(at(u, v)), cost = interest + bias * Math.hypot(u - start.x, v - start.y);
        if (cost < best.cost - 1e-9 && homeInterest - interest >= Math.max(0, Number(minGain) || 0)) best = { u, v, interest, cost };
      }
    }
  }
  const rect = at(best.u, best.v), middle = (rect.y + rect.height / 2) / canvas.height;
  return { ...rect, position: middle < 1 / 3 ? 'top' : middle > 2 / 3 ? 'bottom' : 'center', interest: best.interest, homeInterest, moved: best.u !== start.x || best.v !== start.y };
}

/**
 * The lightest scrim that makes `ink` reach `minContrast` (WCAG ratio) over
 * every background (hex strings or `{ color }` from `analyzeImageColors`).
 * Returns null when the ink already passes. The scrim is black behind light ink
 * and white behind dark ink unless `color` is given; opacity rises in 1% steps
 * from `minOpacity` (so a scrim is never invisibly faint) up to `maxOpacity`. Returns `{ color, opacity, contrast, passes, surfaces }`,
 * where `surfaces` are the backgrounds as seen through the scrim (blended in
 * sRGB, as canvas `source-over` draws it); `passes: false` means even
 * `maxOpacity` falls short, so pick an ink over those surfaces too.
 */
export function fitScrim(backgrounds, ink, { minContrast = 3, minOpacity = 0, maxOpacity = 0.6, color } = {}) {
  const list = (Array.isArray(backgrounds) ? backgrounds : [backgrounds]).map(entry => (entry && typeof entry === 'object' && !Array.isArray(entry) ? entry.color : entry));
  if (!list.length || list.length > 64) throw new RangeError('Pass between 1 and 64 background colors.');
  const surfaces = list.map(value => (typeof value === 'string' ? parseHexColor(value) : value));
  const target = Number(minContrast), ceiling = Number(maxOpacity), floor = Math.min(ceiling, Math.max(0, Number(minOpacity) || 0));
  if (!Number.isFinite(target) || target < 1 || target > 21) throw new RangeError('minContrast must be a WCAG ratio from 1 to 21.');
  if (!(ceiling >= 0 && ceiling <= PLACEMENT_LIMITS.maxOpacity)) throw new RangeError(`maxOpacity must be 0–${PLACEMENT_LIMITS.maxOpacity}.`);
  const worst = colors => Math.min(...colors.map(surface => contrastRatio(ink, surface)));
  if (worst(surfaces) >= target) return null;
  const scrim = color ? formatHexColor(parseHexColor(color)) : contrastRatio(ink, '#000000') >= contrastRatio(ink, '#ffffff') ? '#000000' : '#ffffff';
  const tone = parseHexColor(scrim);
  const through = opacity => surfaces.map(surface => surface.map((value, index) => Math.round(value + (tone[index] - value) * opacity)));
  let opacity = ceiling, seen = through(ceiling);
  for (let step = Math.max(1, Math.round(floor * 100)); step <= Math.round(ceiling * 100); step++) {
    const blended = through(step / 100);
    if (worst(blended) >= target) { opacity = step / 100; seen = blended; break; }
  }
  const contrast = worst(seen);
  return { color: scrim, opacity, contrast, passes: contrast >= target, surfaces: seen.map(formatHexColor) };
}

/**
 * Ink and scrim for a title over `surfaces`. `prefer` lists colors in order
 * (an image accent, then the creator's color). A preferred color that passes is
 * kept; one that needs only a small lightness move (at most `maxShift` in OKLab
 * L) is moved; otherwise, with `scrim` on, a scrim goes behind the first
 * preferred color, and only if the scrim alone falls short does the ink move as
 * well, over what the scrim leaves. Returns `{ ink, scrim, surfaces }`, where
 * `scrim` is `{ color, opacity }` (at least `minOpacity`, default 15%) or null and
 * `surfaces` are what the ink sits on.
 */
export function chooseTitleInk(surfaces, { prefer = [], minContrast = 3, scrim = true, maxShift = 0.08, minOpacity = 0.15, maxOpacity = 0.6 } = {}) {
  const wanted = (Array.isArray(prefer) ? prefer : [prefer]).filter(Boolean);
  const colors = surfaces.map(entry => (entry && typeof entry === 'object' && !Array.isArray(entry) ? entry.color : entry));
  const picked = pickLegibleColor(colors, { prefer: wanted, minContrast });
  const plain = { ink: picked.color, scrim: null, surfaces: colors };
  if (!scrim || !wanted.length) return plain;
  const first = formatHexColor(parseHexColor(wanted[0]));
  if (picked.passes && (picked.color === first || Math.abs(toOklab(picked.color)[0] - toOklab(first)[0]) <= maxShift)) return plain;
  const fitted = fitScrim(colors, first, { minContrast, minOpacity, maxOpacity });
  if (!fitted) return plain;
  const ink = fitted.passes ? first : pickLegibleColor(fitted.surfaces, { prefer: wanted, minContrast }).color;
  return { ink, scrim: { color: fitted.color, opacity: fitted.opacity }, surfaces: fitted.surfaces };
}
