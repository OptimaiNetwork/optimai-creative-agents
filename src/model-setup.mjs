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
