import assert from 'node:assert/strict';
import test from 'node:test';
import { createProgressReporter, describeProgress, ENGINE_PROGRESS_STAGES, normalizeProgress, PROGRESS_STAGES, progressStage, progressSteps } from '../src/progress.mjs';

test('stages are one closed vocabulary; legacy phases map onto it and newer words pass through', () => {
  assert.ok(Object.isFrozen(PROGRESS_STAGES) && Object.isFrozen(ENGINE_PROGRESS_STAGES));
  for (const stages of Object.values(ENGINE_PROGRESS_STAGES)) for (const stage of stages) assert.ok(PROGRESS_STAGES.includes(stage), stage);
  assert.deepEqual(['initialize', 'Verifying', 'checksum', 'downloading', ' render ', undefined, '', 'segment'].map(progressStage), ['warmup', 'verify', 'verify', 'download', 'render', 'prepare', 'prepare', 'segment']);
});

test('normalizeProgress derives progress from bytes or frames, clamps, drops junk and freezes', () => {
  assert.deepEqual(normalizeProgress({ phase: 'download', message: 'Fetching', loaded: 3_100_000, total: 5_800_000 }), { stage: 'download', message: 'Fetching', loaded: 3_100_000, total: 5_800_000, progress: 3_100_000 / 5_800_000 });
  assert.deepEqual(normalizeProgress({ stage: 'frame', frame: 4, frames: 8 }), { stage: 'frame', message: '', frame: 4, frames: 8, progress: .5 });
  assert.deepEqual(normalizeProgress({ stage: 'frame', frame: 12.7, frames: 8.9 }), { stage: 'frame', message: '', frame: 8, frames: 8, progress: 1 }, 'whole frames, never past the end');
  assert.deepEqual(normalizeProgress({ stage: 'download', loaded: 9e9, total: 100 }), { stage: 'download', message: '', loaded: 100, total: 100, progress: 1 });
  assert.equal(normalizeProgress({ stage: 'download', progress: 0.25, loaded: 90, total: 100 }).progress, .25, 'a reported fraction wins');
  assert.deepEqual(normalizeProgress({ stage: 'render', loaded: -1, total: 0, frame: NaN, frames: 0, attempt: 3, progress: 'half', message: 7 }), { stage: 'render', message: '' });
  assert.equal(normalizeProgress({ stage: 'ready' }).progress, 1);
  assert.equal(normalizeProgress({ stage: 'generate', progress: 4 }).progress, 1);
  assert.deepEqual(normalizeProgress({ stage: 'generate' }, { attempt: 2, message: 'Default' }), { stage: 'generate', message: 'Default', attempt: 2 });
  assert.ok(Object.isFrozen(normalizeProgress()));
});

test('describeProgress gives the staged words a host shows', () => {
  assert.equal(describeProgress({ stage: 'download', loaded: 3_100_000, total: 5_800_000 }), 'Downloading 3.1 MB of 5.8 MB · 53%');
  assert.equal(describeProgress({ stage: 'download', progress: .26, total: 453_205_372 }), 'Downloading 118 MB of 453 MB · 26%', 'a fraction of a known size reads as bytes');
  assert.equal(describeProgress({ stage: 'download', progress: .42 }), 'Downloading · 42%');
  assert.equal(describeProgress({ stage: 'download', loaded: 2_000_000 }), 'Downloading 2 MB', 'no percentage without a total');
  assert.equal(describeProgress({ phase: 'initialize' }), 'Warming up');
  assert.equal(describeProgress({ stage: 'frame', frame: 4, frames: 8 }), 'Frame 4 of 8');
  assert.equal(describeProgress({ stage: 'frame', frame: 0, frames: 8 }), 'Frame 1 of 8');
  assert.equal(describeProgress({ stage: 'prepare', frame: 2, frames: 3 }), 'Opening your files · 2 of 3');
  assert.equal(describeProgress({ stage: 'generate', attempt: 2 }), 'Writing · second try');
  assert.equal(describeProgress({ stage: 'render', progress: .5 }), 'Rendering · 50%');
  assert.equal(describeProgress({ stage: 'ready', loaded: 1, total: 2 }), 'Ready');
  assert.equal(describeProgress({ stage: 'segment', message: 'Segmenting hair' }), 'Segmenting hair', 'unknown stages fall back to the message');
  assert.equal(describeProgress({ stage: 'segment' }), 'Working');
});

test('progressSteps marks a stepper from a plan or an engine name', () => {
  const steps = progressSteps('vision', { stage: 'warmup' });
  assert.deepEqual(steps.map(step => step.state), ['done', 'done', 'done', 'current', 'pending', 'pending']);
  assert.equal(steps[3].label, 'Warming up');
  const download = progressSteps(['download', 'warmup', 'frame', 'ready'], { stage: 'download', loaded: 3_100_000, total: 5_800_000 });
  assert.deepEqual(download.map(step => step.label), ['Downloading 3.1 MB of 5.8 MB · 53%', 'Warming up', 'Rendering frames'], '`ready` is implied, not a step');
  assert.ok(progressSteps('canvas', { stage: 'ready' }).every(step => step.state === 'done'));
  assert.ok(progressSteps('canvas').every(step => step.state === 'pending'));
  assert.deepEqual(progressSteps(['render'], { stage: 'segment', message: 'Segmenting' }).at(-1), { stage: 'segment', label: 'Segmenting', state: 'current' });
  assert.deepEqual(progressSteps(['initialize', 'warmup'], null).map(step => step.stage), ['warmup'], 'aliases collapse');
  assert.deepEqual(progressSteps('unknown-engine'), []);
});

test('a reporter sends canonical events, goes quiet after cancel and survives a throwing listener', () => {
  const seen = [], controller = new AbortController();
  const report = createProgressReporter(event => { seen.push(event); if (event.stage === 'render') throw new Error('host bug'); }, { signal: controller.signal, defaults: { message: 'Working locally' } });
  assert.deepEqual(report('prepare', { frame: 1, frames: 2 }), { stage: 'prepare', message: 'Working locally', frame: 1, frames: 2, progress: .5 });
  assert.doesNotThrow(() => report('render'));
  controller.abort();
  assert.equal(report('export'), undefined);
  assert.deepEqual(seen.map(event => event.stage), ['prepare', 'render']);
  assert.equal(createProgressReporter(null)('frame', { frame: 1, frames: 1 }).progress, 1, 'without a listener it still returns the event');
});
