/** Decide whether an opened agent should warm its model. Does not download or request permissions. */
export function getModelSetupPolicy({ bytes = 0, requiresWebGPU = false } = {}, environment = {}) {
  if (environment.browser === false) return { mode: 'unsupported', reason: 'Open this agent in a supported browser.' };
  if (requiresWebGPU && environment.webGPU === false) return { mode: 'unsupported', reason: 'This model needs WebGPU. Try a current browser with GPU support, or use an installed local model.' };
  if (environment.saveData === true) return { mode: 'manual', reason: 'Data Saver is on. Download when you are ready.' };
  if (['slow-2g', '2g'].includes(environment.effectiveType)) return { mode: 'manual', reason: 'Your connection looks slow. Start the download when it suits you.' };
  if (bytes > 100_000_000 && environment.effectiveType === '3g') return { mode: 'manual', reason: 'This is a large model. A faster connection is recommended.' };
  if (bytes > 100_000_000 && typeof environment.deviceMemory === 'number' && environment.deviceMemory < 4) return { mode: 'manual', reason: 'This model needs substantial memory. Close other tabs before loading it.' };
  return { mode: 'automatic', reason: 'Preparing this agent automatically. Verified models are reused when available.' };
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
/** Decimal (SI) sizes, as operating systems show downloads: 453205372 → "453 MB", 3758596 → "3.8 MB", 13e6 → "13 MB". */
export function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '';
  let size = value, unit = 0;
  while (size >= 999.5 && unit < UNITS.length - 1) { size /= 1000; unit++; }
  return unit === 0 ? `${Math.round(size)} B` : `${size >= 99.95 ? Math.round(size) : size.toFixed(1).replace(/\.0$/, '')} ${UNITS[unit]}`;
}
/** "120 MB of 453 MB"; "120 MB" when the total is unknown; "" before any byte is known. */
export function describeModelProgress({ loaded, total, progress } = {}) {
  const whole = Number.isFinite(total) && total > 0 ? total : undefined;
  const done = Number.isFinite(loaded) ? loaded : whole && Number.isFinite(progress) ? progress * whole : undefined;
  if (done === undefined) return '';
  return whole ? `${formatBytes(Math.min(done, whole))} of ${formatBytes(whole)}` : formatBytes(done);
}
/** Human size facts for a model. Accepts `{ bytes | downloadBytes, gpuBytes | gpuMemoryMB, runtimeBytes }`. */
export function describeModelSetup(model = {}) {
  const bytes = model.bytes ?? model.downloadBytes, gpu = model.gpuBytes ?? (Number.isFinite(model.gpuMemoryMB) ? model.gpuMemoryMB * 1048576 : undefined);
  const download = formatBytes(bytes), runtime = model.runtimeBytes ? `about ${formatBytes(model.runtimeBytes)} local runtime` : '', memory = gpu ? `about ${formatBytes(gpu)} GPU memory` : '';
  return { download, runtime, memory, label: [download, runtime, memory].filter(Boolean).join(' · ') };
}

const BUSY = new Set(['checking', 'downloading', 'verifying']);
const VERIFY = new Set(['verify', 'verifying', 'checksum']);
const unit = value => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : undefined;
/**
 * One setup state machine for any reviewed model: idle → checking → downloading(loaded, total) → verifying → ready | failed,
 * plus unsupported. `load({ signal, onProgress })` and the optional `check({ signal })` are the host's reviewed calls; the
 * controller never fetches on its own. Progress from an aborted or replaced run is ignored, a second `start()` joins the
 * first, and `subscribe`/`getState` fit React's useSyncExternalStore. `wait(ms, signal)` schedules the observe poll (fake timers in tests). `name` is used mid-sentence ("writing AI"). With a `check`
 * the controller starts in `checking` until `check()` runs. `policy` may be a function, read when `check()` runs.
 */
const sleep = (ms, signal) => new Promise(resolve => { const timer = setTimeout(resolve, ms); signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true }); });
export function createModelSetupController({ load, check, cancel, bytes, name = 'the model', policy, pollMs = 800, wait = sleep } = {}) {
  if (typeof load !== 'function') throw new TypeError('createModelSetupController needs a load({ signal, onProgress }) function.');
  const Name = name.charAt(0).toUpperCase() + name.slice(1), listeners = new Set(), rule = () => typeof policy === 'function' ? policy() : policy;
  let run = 0, controller = null, pending = null, observing = false;
  let state = Object.freeze({ state: check ? 'checking' : 'idle', loaded: 0, total: bytes > 0 ? bytes : undefined, progress: undefined, progressLabel: '', message: check ? `Checking ${name} on this device.` : '', detail: '', reason: typeof policy === 'function' ? '' : policy?.reason || '', automatic: false, cached: false, error: null });
  const set = patch => {
    const next = { ...state, ...patch }, busy = BUSY.has(next.state);
    next.progress = next.state === 'ready' ? 1 : !busy ? undefined : 'progress' in patch ? unit(patch.progress) : next.total && next.loaded > 0 ? Math.min(1, next.loaded / next.total) : BUSY.has(state.state) ? state.progress : undefined;
    next.progressLabel = next.state === 'downloading' && next.loaded > 0 ? describeModelProgress(next) : '';
    state = Object.freeze(next);
    for (const listener of listeners) listener(state);
    return state;
  };
  const halt = () => { run++; observing = false; controller?.abort(); controller = null; pending = null; };
  const fail = error => { const message = error instanceof Error && error.message ? error.message : `${Name} could not load. Check your connection and try again.`; return set({ state: 'failed', message, error: { code: error?.code || 'load-failed', message } }); };
  const progress = (id, event = {}) => {
    const stage = event.stage ?? event.phase;
    if (id !== run || !BUSY.has(state.state) || stage === 'ready') return;
    const total = event.total > 0 ? event.total : state.total, fraction = unit(event.progress), verify = VERIFY.has(stage);
    const reported = Number.isFinite(event.loaded) ? event.loaded : total && fraction !== undefined ? fraction * total : undefined;
    const loaded = reported === undefined ? state.loaded : Math.max(state.loaded, Math.min(reported, total ?? reported));
    set({
      state: verify ? 'verifying' : 'downloading', total, loaded,
      detail: typeof event.message === 'string' ? event.message : state.detail,
      message: verify ? `Checking ${name} before it runs.` : `Downloading ${name} to this browser. Cached files are reused.`,
      // A reported fraction is kept exactly instead of round-tripping through bytes.
      ...(fraction !== undefined && !Number.isFinite(event.loaded) && (!total || loaded > state.loaded) ? { progress: fraction } : verify ? { progress: undefined } : {}),
    });
  };
  function start({ automatic = false } = {}) {
    if (pending) return pending;
    if (state.state === 'ready' || state.state === 'unsupported') return Promise.resolve(state);
    halt();
    const id = run, abort = controller = new AbortController();
    set({ state: 'downloading', loaded: 0, progress: undefined, detail: '', error: null, automatic, message: `Preparing ${name} on this device.` });
    return pending = (async () => {
      try {
        await load({ signal: abort.signal, onProgress: event => progress(id, event) });
        if (id === run) set({ state: 'ready', detail: '', message: `${Name} is ready on this device.` });
      } catch (error) { if (id === run && !abort.signal.aborted) fail(error); }
      finally { if (id === run) { controller = null; pending = null; } }
      return state;
    })();
  }
  async function inspect({ autoStart = false } = {}) {
    if (pending || observing) return state;
    const current = rule();
    if (!check) return state.state === 'idle' ? set({ automatic: current?.mode === 'automatic', reason: current?.reason || '' }) : state;
    halt();
    const id = run, abort = controller = new AbortController();
    set({ state: 'checking', progress: undefined, error: null, message: `Checking ${name} on this device.` });
    try {
      let status = await check({ signal: abort.signal });
      if (id !== run) return state;
      if (status?.ready) { controller = null; return set({ state: 'ready', cached: true, message: `${Name} is ready. Cached files are reused in this browser.` }); }
      if (status?.available === false || current?.mode === 'unsupported') { controller = null; return set({ state: 'unsupported', reason: current?.reason || '', message: status?.message || current?.reason || `${Name} is unavailable on this device.` }); }
      if (status?.loading) {
        observing = true;
        set({ state: 'downloading', loaded: 0, progress: undefined, message: `Reusing ${name} preparation already in progress.`, reason: 'No duplicate download is started.' });
        while (status?.loading) {
          await wait(pollMs, abort.signal);
          if (id !== run) return state;
          status = await check({ signal: abort.signal });
          if (id !== run) return state;
        }
        observing = false; controller = null;
        return set(status?.ready ? { state: 'ready', message: `${Name} is ready on this device.` } : { state: 'idle', message: `${Name} preparation stopped. Start it again when you are ready.`, reason: 'Cached files will be reused.' });
      }
      controller = null;
      const cached = status?.cached === true, automatic = !cached && current?.mode === 'automatic';
      set({ state: 'idle', cached, automatic, message: cached ? `Reusing ${name} files saved in this browser.` : '', reason: cached ? 'Cached model files are reused.' : current?.reason || '' });
      return autoStart && (cached || automatic) ? start({ automatic }) : state;
    } catch (error) {
      if (id !== run || abort.signal.aborted) return state;
      observing = false; controller = null;
      return fail(error);
    }
  }
  function abort() {
    const busy = BUSY.has(state.state);
    if (observing) cancel?.();
    halt();
    return busy ? set({ state: 'idle', loaded: 0, detail: '', automatic: false, message: 'Preparation paused. Your work is kept here.', reason: 'Start again when you are ready. Cached files will be reused.' }) : state;
  }
  return {
    getState: () => state, start, check: inspect, abort,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** Resync after the model was released or lost elsewhere, for example when a run finds it unloaded. */
    reset({ state: next = 'idle', message = '', reason = state.reason } = {}) { halt(); return set({ state: next === 'unsupported' ? 'unsupported' : 'idle', loaded: 0, detail: '', error: null, automatic: false, message, reason }); },
    /** Unmount: stops this controller's own run and polling, never cancels a load it only observed. */
    dispose() { halt(); listeners.clear(); },
  };
}
