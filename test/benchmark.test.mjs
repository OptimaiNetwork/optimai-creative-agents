import assert from 'node:assert/strict';
import test from 'node:test';
import { BENCHMARK_OPERATIONS, createBenchmarkImage, describeBenchmarkDevice, formatBenchmarkTable, runBenchmarks, summarizeSamples } from '../src/benchmark.mjs';

const clock = () => { let t = 0; return () => (t += 1); };
const quick = { width: 32, height: 32, warmup: 0, minRuns: 2, maxRuns: 3, budgetMs: 20 };

test('the test picture is deterministic, opaque and varied', () => {
  const a = createBenchmarkImage(32, 24), b = createBenchmarkImage(32, 24);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, createBenchmarkImage(32, 24, 0.2));
  assert.ok(a.every((value, i) => i % 4 !== 3 || value === 255));
  assert.ok(new Set(a).size > 50);
  assert.throws(() => createBenchmarkImage(4, 4), /pixels per side/);
});

test('samples are summarised and bad input is refused', () => {
  const s = summarizeSamples([5, 1, NaN, 3, 2, 4]);
  assert.deepEqual([s.runs, s.min, s.median, s.max, s.mean], [5, 1, 3, 5, 3]);
  assert.throws(() => summarizeSamples([NaN]), /finite/);
});

test('every pixel and text operation really runs, and the canvas group is skipped without a canvas', async () => {
  const progress = [];
  const report = await runBenchmarks({ now: clock(), ...quick, onProgress: event => progress.push(event.id) });
  assert.deepEqual(report.results.map(r => r.id), BENCHMARK_OPERATIONS.map(op => op.id));
  assert.deepEqual(progress, BENCHMARK_OPERATIONS.map(op => op.id));
  for (const result of report.results) {
    if (result.group === 'canvas') { assert.match(result.skipped, /canvas/); continue; }
    assert.equal(result.error, undefined, `${result.id}: ${result.error}`);
    assert.ok(result.runs >= 2 && result.runs <= 3 && result.median > 0);
    assert.equal(typeof result.megapixelsPerSecond, result.group === 'text' || /thumbnail/.test(result.title) ? 'undefined' : 'number');
  }
  assert.ok(Object.isFrozen(report) && Object.isFrozen(report.results[0]));
});

test('the canvas group uses the host canvas, and one failure does not stop the others', async () => {
  globalThis.ImageData ??= class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };
  const calls = [];
  const context = { putImageData: () => calls.push('put'), drawImage: () => calls.push('draw'), getImageData: (x, y, w) => { if (w > 1) throw new Error('tainted'); } };
  const report = await runBenchmarks({ now: clock(), ...quick, only: ['canvas-draw-scale', 'canvas-read', 'canvas-write'], createCanvas: () => ({ getContext: () => context }) });
  assert.equal(report.results[0].runs, 3); assert.equal(report.results[1].error, 'tainted'); assert.equal(report.results[2].runs, 3);
  assert.ok(calls.includes('draw') && calls.includes('put'));
});

test('options are validated, aborting stops cleanly and the budget caps the runs', async () => {
  await assert.rejects(runBenchmarks({}), /now/);
  await assert.rejects(runBenchmarks({ now: clock(), width: 8 }), /width/);
  await assert.rejects(runBenchmarks({ now: clock(), minRuns: 9, maxRuns: 3 }), /Runs/);
  await assert.rejects(runBenchmarks({ now: clock(), only: ['nope'] }), /Unknown/);
  const controller = new AbortController(); controller.abort();
  assert.equal((await runBenchmarks({ now: clock(), signal: controller.signal, ...quick })).results.length, 0);
  const slow = await runBenchmarks({ now: clock(), only: ['fit-title'], ...quick, minRuns: 1, maxRuns: 500, budgetMs: 20 });
  assert.ok(slow.results[0].runs < 500, 'the time budget ends the loop before maxRuns');
});

test('the device description reads only a few fields and the table is Markdown', async () => {
  const device = describeBenchmarkDevice({ userAgentData: { brands: [{ brand: 'Not A Brand', version: '8' }, { brand: 'Chromium', version: '142' }], platform: 'macOS' }, hardwareConcurrency: 10, deviceMemory: 8, secret: 'x' }, { pixelRatio: 2 });
  assert.deepEqual({ ...device }, { browser: 'Chromium 142', platform: 'macOS', cores: 10, memoryGb: 8, pixelRatio: 2 });
  assert.equal(describeBenchmarkDevice().browser, null);
  const table = formatBenchmarkTable(await runBenchmarks({ now: clock(), only: ['fit-title', 'canvas-read'], ...quick }), device);
  assert.match(table, /^Chromium 142 · macOS · 10 cores · 32×32\n\n\| Operation \| Median ms/);
  assert.match(table, /\| Typeset · fit a title \| \d/);
  assert.match(table, /not run/);
});
