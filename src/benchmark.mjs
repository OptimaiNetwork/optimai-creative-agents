// Benchmarks: ms/op for the SDK's pixel and canvas operations on this device. Pure measuring code: the host passes the clock and,
// for the canvas group, a canvas factory, so the same list runs in Node tests, a browser page and a worker.
import { gradePixels } from './color-grade.mjs';
import { applyLut, filmLut } from './lut.mjs';
import { glitchPixels } from './glitch.mjs';
import { printPixels } from './print.mjs';
import { composeTransition } from './transition.mjs';
import { computeFocusMap } from './smart-crop.mjs';
import { dominantColors } from './color.mjs';
import { compareOutputs } from './compare.mjs';
import { fitTitle } from './typeset.mjs';

export const BENCHMARK_LIMITS = Object.freeze({ minSide: 16, maxSide: 4096, minMs: 20, maxMs: 10_000, maxRuns: 1000 });
export const BENCHMARK_DEFAULTS = Object.freeze({ width: 1024, height: 576, warmup: 2, minRuns: 5, maxRuns: 60, budgetMs: 400 });

/** A deterministic RGBA test picture (gradients, rings and fine grain), so every device times identical pixels. */
export function createBenchmarkImage(width, height, shift = 0) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < BENCHMARK_LIMITS.minSide || height < BENCHMARK_LIMITS.minSide || width > BENCHMARK_LIMITS.maxSide || height > BENCHMARK_LIMITS.maxSide) throw new RangeError(`Benchmark images are ${BENCHMARK_LIMITS.minSide} to ${BENCHMARK_LIMITS.maxSide} pixels per side.`);
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0, i = 0; y < height; y++) for (let x = 0; x < width; x++, i += 4) {
    const dx = x / width - 0.5 - shift, dy = y / height - 0.5, ring = Math.sin(Math.hypot(dx, dy) * 38) * 0.5 + 0.5, grain = ((x * 73856093) ^ (y * 19349663)) & 15;
    out[i] = 255 * (x / width) * 0.7 + ring * 60 + grain; out[i + 1] = 255 * (y / height) * 0.6 + ring * 80 + grain; out[i + 2] = 255 * (1 - x / width) * 0.5 + ring * 90 + grain; out[i + 3] = 255;
  }
  return out;
}

const measure = (text, size) => text.length * size * 0.52;
const TITLE = 'A very long poster headline that has to find its size and its line breaks';
/** The analysis thumbnail the SDK's own analysers read (longest side `edge`), taken by nearest sampling. */
function thumbnail(pixels, width, height, edge = 256) {
  const scale = Math.min(1, edge / Math.max(width, height)), w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale)), out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i += 4) {
    const source = (Math.min(height - 1, Math.floor(y / scale)) * width + Math.min(width - 1, Math.floor(x / scale))) * 4;
    out.set(pixels.subarray(source, source + 4), i);
  }
  return { data: out, width: w, height: h };
}
const copy = pixels => new Uint8ClampedArray(pixels);
const pixelGroup = [
  ['grade-punchy', 'Colour grade · punchy', ({ a, w, h }) => gradePixels(copy(a), w, h, 'punchy', { seed: 1 })],
  ['lut-matte', 'Film LUT · matte', ({ a, w, h }) => applyLut(copy(a), w, h, filmLut('matte'))],
  ['glitch-blocks', 'Glitch · block displacement', ({ a, w, h }) => glitchPixels(a, w, h, { effect: 'blocks', seed: 7 })],
  ['print-riso', 'Print · riso duotone', ({ a, w, h }) => printPixels(a, w, h, { look: 'riso', scale: 2 })],
  ['print-floyd', 'Print · error diffusion', ({ a, w, h }) => printPixels(a, w, h, { look: 'floyd-steinberg', scale: 1 })],
  ['transition-luma', 'Transition frame · luma', ({ a, b, w, h }) => composeTransition(a, b, w, h, 0.5, { style: 'luma' })],
  ['transition-push', 'Transition frame · push', ({ a, b, w, h }) => composeTransition(a, b, w, h, 0.5, { style: 'push' })],
  ['focus-map', 'Smart crop · focus map (256 px thumbnail)', ({ t }) => computeFocusMap(t.data, t.width, t.height)],
  ['palette', 'Palette · dominant colours (256 px thumbnail)', ({ t }) => dominantColors(t.data, t.width, t.height, { count: 5 })],
  ['compare', 'Compare · SSIM and ΔE', ({ a, b, w, h }) => compareOutputs({ data: a, width: w, height: h }, { data: b, width: w, height: h })],
].map(([id, title, run]) => ({ id, title, group: 'pixels', perPixel: !/thumbnail/.test(title), run }));
const textOp = { id: 'fit-title', title: 'Typeset · fit a title', group: 'text', perPixel: false, run: () => fitTitle(TITLE, { measure, width: 900, height: 400, maxSize: 160, minSize: 12 }) };
const canvasGroup = [
  ['canvas-draw-scale', 'Canvas · drawImage downscale + 1 px readback', ({ canvas, source, w, h }) => { const c = canvas.getContext('2d'); c.drawImage(source, 0, 0, w >> 1, h >> 1); c.getImageData(0, 0, 1, 1); }],
  ['canvas-read', 'Canvas · getImageData', ({ canvas, w, h }) => canvas.getContext('2d').getImageData(0, 0, w, h)],
  ['canvas-write', 'Canvas · putImageData + 1 px readback', ({ canvas, image }) => { const c = canvas.getContext('2d'); c.putImageData(image, 0, 0); c.getImageData(0, 0, 1, 1); }],
].map(([id, title, run]) => ({ id, title, group: 'canvas', perPixel: true, run }));

/** Every operation, in report order: `{ id, title, group: 'pixels' | 'text' | 'canvas', perPixel }`. */
export const BENCHMARK_OPERATIONS = Object.freeze([...pixelGroup, textOp, ...canvasGroup].map(op => Object.freeze({ ...op })));
const RUNNERS = new Map([...pixelGroup, textOp, ...canvasGroup].map(op => [op.id, op.run]));

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
/** Median, p95, min and the rest of a list of millisecond samples. */
export function summarizeSamples(samples) {
  const sorted = samples.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) throw new RangeError('Pass at least one finite timing.');
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  return Object.freeze({ runs: sorted.length, min: sorted[0], median: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), max: sorted.at(-1), mean });
}

function settings(options = {}) {
  const value = { ...BENCHMARK_DEFAULTS, ...options };
  for (const key of ['width', 'height']) if (!Number.isInteger(value[key]) || value[key] < BENCHMARK_LIMITS.minSide || value[key] > BENCHMARK_LIMITS.maxSide) throw new RangeError(`${key} must be a whole number from ${BENCHMARK_LIMITS.minSide} to ${BENCHMARK_LIMITS.maxSide}.`);
  if (!(value.budgetMs >= BENCHMARK_LIMITS.minMs && value.budgetMs <= BENCHMARK_LIMITS.maxMs)) throw new RangeError(`budgetMs must be ${BENCHMARK_LIMITS.minMs} to ${BENCHMARK_LIMITS.maxMs}.`);
  if (!Number.isInteger(value.maxRuns) || value.maxRuns < 1 || value.maxRuns > BENCHMARK_LIMITS.maxRuns || !Number.isInteger(value.minRuns) || value.minRuns < 1 || value.minRuns > value.maxRuns) throw new RangeError(`Runs must satisfy 1 ≤ minRuns ≤ maxRuns ≤ ${BENCHMARK_LIMITS.maxRuns}.`);
  if (!Number.isInteger(value.warmup) || value.warmup < 0 || value.warmup > 20) throw new RangeError('warmup is 0 to 20 runs.');
  return value;
}

/**
 * Time every operation (or `only` a list of ids). `now` is the host clock (`performance.now`); `createCanvas(w, h)` enables the canvas group,
 * which is skipped, with a reason, when it is missing. Each operation runs `warmup` untimed rounds, then at least `minRuns` timed
 * rounds and more until `budgetMs` is spent or `maxRuns` is reached. Returns `{ settings, results }`; a failing operation is reported
 * with its `error` and never stops the rest. `onProgress({ index, total, id })` fires before each one; `signal` stops between operations.
 */
export async function runBenchmarks({ now, createCanvas, only, signal, onProgress, ...options } = {}) {
  if (typeof now !== 'function') throw new TypeError('Pass now (for example performance.now.bind(performance)).');
  const config = settings(options), { width: w, height: h } = config;
  const list = BENCHMARK_OPERATIONS.filter(op => !only || only.includes(op.id));
  if (only) for (const id of only) if (!RUNNERS.has(id)) throw new RangeError(`Unknown benchmark "${id}".`);
  const a = createBenchmarkImage(w, h), b = createBenchmarkImage(w, h, 0.2);
  const t = thumbnail(a, w, h);
  let context = null;
  const results = [];
  for (const [index, op] of list.entries()) {
    if (signal?.aborted) break;
    onProgress?.({ index, total: list.length, id: op.id });
    if (op.group === 'canvas' && typeof createCanvas !== 'function') { results.push(Object.freeze({ id: op.id, title: op.title, group: op.group, skipped: 'No canvas available here.' })); continue; }
    try {
      if (op.group === 'canvas' && !context) {
        const canvas = createCanvas(w, h), source = createCanvas(w, h), image = new ImageData(copy(a), w, h);
        source.getContext('2d').putImageData(image, 0, 0); canvas.getContext('2d').putImageData(image, 0, 0);
        context = { canvas, source, image };
      }
      const input = { a, b, t, w, h, ...context }, run = RUNNERS.get(op.id), samples = [];
      for (let i = 0; i < config.warmup; i++) await run(input);
      const started = now();
      while (samples.length < config.maxRuns && (samples.length < config.minRuns || now() - started < config.budgetMs)) {
        const t = now(); await run(input); samples.push(now() - t);
        if (signal?.aborted) break;
      }
      const stats = summarizeSamples(samples);
      results.push(Object.freeze({ id: op.id, title: op.title, group: op.group, ...stats, ...(op.perPixel && stats.median > 0 ? { megapixelsPerSecond: (w * h / 1e6) / (stats.median / 1000) } : {}) }));
    } catch (error) { results.push(Object.freeze({ id: op.id, title: op.title, group: op.group, error: String(error?.message ?? error) })); }
  }
  return Object.freeze({ settings: Object.freeze({ width: w, height: h, warmup: config.warmup, minRuns: config.minRuns, maxRuns: config.maxRuns, budgetMs: config.budgetMs }), results: Object.freeze(results) });
}

/** What the page can say about the device, from a `navigator`-like object. Never throws, never reads more than these fields. */
export function describeBenchmarkDevice(nav = {}, extras = {}) {
  const brands = nav.userAgentData?.brands?.filter(entry => !/not.?a.?brand/i.test(entry.brand)).map(entry => `${entry.brand} ${entry.version}`) ?? [];
  const text = value => typeof value === 'string' ? value.slice(0, 120) : null;
  return Object.freeze({ browser: brands.at(-1) ?? text(nav.userAgent), platform: text(nav.userAgentData?.platform ?? nav.platform), cores: Number.isInteger(nav.hardwareConcurrency) ? nav.hardwareConcurrency : null, memoryGb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null, pixelRatio: typeof extras.pixelRatio === 'number' ? extras.pixelRatio : null });
}

const fixed = (value, digits) => value >= 100 ? value.toFixed(0) : value.toFixed(digits);
/** The results as a Markdown table (what the docs publish), with the device and size above it. */
export function formatBenchmarkTable({ settings: config, results }, device = {}) {
  const line = [device.browser, device.platform, device.cores ? `${device.cores} cores` : null].filter(Boolean).join(' · ') || 'unknown device';
  const rows = results.map(result => result.error ? `| ${result.title} | failed | | | ${result.error.replace(/\|/g, '/')} |` : result.skipped ? `| ${result.title} | not run | | | ${result.skipped} |` : `| ${result.title} | ${fixed(result.median, 2)} | ${fixed(result.p95, 2)} | ${result.megapixelsPerSecond ? fixed(result.megapixelsPerSecond, 1) : '–'} | ${result.runs} |`);
  return [`${line} · ${config.width}×${config.height}`, '', '| Operation | Median ms | p95 ms | Mpx/s | Runs |', '| --- | ---: | ---: | ---: | ---: |', ...rows].join('\n');
}
