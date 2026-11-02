/**
 * One progress event for every engine — `{ stage, message, loaded?, total?, frame?, frames?, attempt?, progress? }` —
 * and the words a host shows for it ("Downloading 3.1 MB of 5.8 MB · 53%" → "Warming up" → "Frame 4 of 8").
 * Bytes are `loaded`/`total`, counted work is `frame`/`frames`, and `progress` (0–1) is derived when it is not given.
 */
import { describeModelProgress } from './model-setup.mjs';

export const PROGRESS_STAGES = Object.freeze(['check', 'download', 'verify', 'warmup', 'prepare', 'plan', 'generate', 'validate', 'repair', 'analyze', 'render', 'frame', 'export', 'ready']);
/** The stages each engine reports, in order, for a host's stepper. `ready` is implied at the end of every run. */
export const ENGINE_PROGRESS_STAGES = Object.freeze({
  vision: Object.freeze(['download', 'verify', 'prepare', 'warmup', 'analyze', 'render']),
  writing: Object.freeze(['download', 'plan', 'generate', 'validate', 'repair']),
  'frame-sculpture': Object.freeze(['prepare', 'frame']),
  canvas: Object.freeze(['prepare', 'render', 'frame', 'export']),
});
// Older engine and host words for the same stages.
const ALIASES = Object.freeze({ checking: 'check', downloading: 'download', verifying: 'verify', checksum: 'verify', initialize: 'warmup', loading: 'warmup', decode: 'prepare', encode: 'export', done: 'ready' });
const LABELS = Object.freeze({ check: 'Checking this device', download: 'Downloading', verify: 'Checking the download', warmup: 'Warming up', prepare: 'Opening your files', plan: 'Planning', generate: 'Writing', validate: 'Checking the result', repair: 'Repairing the draft', analyze: 'Analyzing', render: 'Rendering', frame: 'Rendering frames', export: 'Exporting', ready: 'Ready' });
const unit = value => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : undefined;
const amount = value => Number.isFinite(value) && value >= 0 ? value : undefined;
const percent = value => `${Math.round(value * 100)}%`;

/** A known stage for `value` (`phase: 'initialize'` → `warmup`); unknown words pass through so newer engines still report. */
export function progressStage(value) {
  const stage = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return PROGRESS_STAGES.includes(stage) ? stage : ALIASES[stage] ?? (stage || 'prepare');
}

/** The canonical, frozen event. Accepts `stage` or a legacy `phase`; `defaults` fills fields the event leaves out. */
export function normalizeProgress(event = {}, defaults = {}) {
  const value = { ...defaults, ...event }, stage = progressStage(value.stage ?? value.phase);
  let total = amount(value.total), loaded = amount(value.loaded), frames = amount(value.frames), frame = amount(value.frame);
  if (total === 0) total = undefined;
  if (total !== undefined && loaded !== undefined) loaded = Math.min(loaded, total);
  frames = frames >= 1 ? Math.floor(frames) : undefined;
  if (frame !== undefined) frame = Math.floor(frames ? Math.min(frame, frames) : frame);
  const given = unit(value.progress);
  const progress = stage === 'ready' ? 1 : given ?? (total && loaded !== undefined ? loaded / total : frames && frame !== undefined ? frame / frames : undefined);
  return Object.freeze({
    stage, message: typeof value.message === 'string' ? value.message : '',
    ...(loaded !== undefined ? { loaded } : {}), ...(total !== undefined ? { total } : {}),
    ...(frame !== undefined ? { frame } : {}), ...(frames !== undefined ? { frames } : {}),
    ...(value.attempt === 1 || value.attempt === 2 ? { attempt: value.attempt } : {}),
    ...(progress !== undefined ? { progress } : {}),
  });
}

/** Short status words for an event: "Downloading 3.1 MB of 5.8 MB · 53%", "Warming up", "Frame 4 of 8", "Writing · second try". */
export function describeProgress(event = {}) {
  const e = normalizeProgress(event), label = LABELS[e.stage];
  if (!label) return e.message || 'Working';
  if (e.stage === 'ready') return label;
  if (e.stage === 'download') {
    const bytes = describeModelProgress(e);
    return [bytes ? `${label} ${bytes}` : label, e.progress !== undefined && (bytes ? e.total : true) ? percent(e.progress) : ''].filter(Boolean).join(' · ');
  }
  if (e.frames) return e.stage === 'frame' ? `Frame ${Math.max(1, e.frame ?? 1)} of ${e.frames}` : `${label} · ${Math.max(1, e.frame ?? 1)} of ${e.frames}`;
  return [label, e.attempt === 2 && ['generate', 'validate'].includes(e.stage) ? 'second try' : '', e.progress !== undefined ? percent(e.progress) : ''].filter(Boolean).join(' · ');
}

/**
 * Steps for a stepper: every planned stage is `done`, `current` or `pending`, and the current one carries the event's words.
 * A stage outside the plan is shown as its own current step at the end; `ready` marks every step done.
 */
export function progressSteps(stages, event) {
  const plan = [...new Set((Array.isArray(stages) ? stages : ENGINE_PROGRESS_STAGES[stages] ?? []).map(progressStage))].filter(stage => stage !== 'ready');
  const e = event ? normalizeProgress(event) : null, at = e ? plan.indexOf(e.stage) : -1, finished = e?.stage === 'ready';
  const steps = plan.map((stage, index) => ({ stage, label: index === at ? describeProgress(e) : LABELS[stage] ?? stage, state: finished || (at >= 0 && index < at) ? 'done' : index === at ? 'current' : 'pending' }));
  if (e && !finished && at < 0) steps.push({ stage: e.stage, label: describeProgress(e), state: 'current' });
  return steps;
}

/**
 * `report(stage, fields)` sends one canonical event to `onProgress` and returns it. After `signal` aborts nothing more is
 * sent, so a cancelled run never repaints a stale status, and a listener that throws never breaks the run it watches.
 */
export function createProgressReporter(onProgress, { signal, defaults } = {}) {
  return (stage, fields = {}) => {
    if (signal?.aborted) return undefined;
    const event = normalizeProgress({ ...fields, stage }, defaults);
    if (typeof onProgress === 'function') try { onProgress(event); } catch {}
    return event;
  };
}
