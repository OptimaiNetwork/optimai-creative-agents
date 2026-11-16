// Benchmark page: runs the SDK's operations with this browser's clock and canvas, then shows the table and its Markdown.
import { describeBenchmarkDevice, formatBenchmarkTable, runBenchmarks } from '../../src/benchmark.mjs';

const $ = id => document.getElementById(id);
let controller;
const createCanvas = (width, height) => Object.assign(document.createElement('canvas'), { width, height });
const cell = (text) => Object.assign(document.createElement('td'), { textContent: text });
const num = (value, digits = 2) => value >= 100 ? value.toFixed(0) : value.toFixed(digits);

async function run() {
  const [width, height] = $('size').value.split('x').map(Number);
  controller = new AbortController();
  $('run').disabled = true; $('stop').disabled = false; $('table').hidden = true; $('markdown').value = '';
  try {
    const report = await runBenchmarks({ now: () => performance.now(), createCanvas, width, height, signal: controller.signal, onProgress: ({ index, total, id }) => { $('status').textContent = `Running ${index + 1} of ${total}: ${id}`; } });
    const rows = report.results.map(result => {
      const tr = document.createElement('tr'), name = cell(result.title);
      if (result.error || result.skipped) { const note = cell(result.error ?? result.skipped); note.colSpan = 4; tr.append(name, note); }
      else tr.append(name, cell(num(result.median)), cell(num(result.p95)), cell(result.megapixelsPerSecond ? num(result.megapixelsPerSecond, 1) : '–'), cell(String(result.runs)));
      return tr;
    });
    $('table').tBodies[0].replaceChildren(...rows); $('table').hidden = false;
    $('markdown').value = formatBenchmarkTable(report, describeBenchmarkDevice(navigator, { pixelRatio: devicePixelRatio }));
    $('status').textContent = controller.signal.aborted ? 'Stopped. Showing what finished.' : 'Done.';
    window.__benchmarkDone = true;
  } catch (error) { $('status').textContent = `Could not run: ${error.message}`; }
  finally { $('run').disabled = false; $('stop').disabled = true; }
}
$('run').addEventListener('click', run);
$('stop').addEventListener('click', () => controller?.abort());
if (new URLSearchParams(location.search).has('auto')) run();
