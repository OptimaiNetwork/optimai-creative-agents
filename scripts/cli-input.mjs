import { open } from 'node:fs/promises';
import { validateAgentManifest } from '../src/index.mjs';

export function parseOptions(args, allowed) {
  const options = Object.create(null);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!allowed.includes(key) || typeof value !== 'string' || !value || value.startsWith('--') || Object.hasOwn(options, key)) throw new Error(`Use each supported option once with a value: ${allowed.join(', ')}.`);
    options[key] = value;
  }
  return options;
}

// Explicitly selected JSON only. Stat and bounded reads happen on the same file
// handle; oversized files are never read into memory and a growth race is bounded.
export async function readAgentManifest(path) {
  if (typeof path !== 'string' || !/\.json$/i.test(path)) throw new Error('Select a local JSON agent manifest.');
  const handle = await open(path, 'r');
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > 65536) throw new Error('Agent manifest must be a regular JSON file of at most 64 KiB.');
    const bytes = Buffer.alloc(65537);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    if (offset > 65536) throw new Error('Agent manifest exceeds 64 KiB.');
    let value;
    try { value = JSON.parse(bytes.subarray(0, offset).toString('utf8')); } catch { throw new Error('The selected file contains invalid JSON.'); }
    const result = validateAgentManifest(value);
    if (!result.success) throw new Error(result.errors.join('\n'));
    return result.manifest;
  } finally { await handle.close(); }
}

export function reportFailure(problem) {
  const cancelled = problem?.name === 'AbortError';
  process.stderr.write(`${JSON.stringify({ error: { code: cancelled ? 'cancelled' : problem?.code || 'invalid-input', message: problem?.message || 'Agent command failed.' } })}\n`);
  process.exitCode = cancelled ? 130 : 1;
}
