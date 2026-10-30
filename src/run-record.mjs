/**
 * Run records: a small, portable provenance record for one agent result. Original
 * and dependency-free; it runs in Node and the browser.
 *
 * A record names the template, the exact settings the engine ran with, the seed,
 * the SDK version and a digest of the selected inputs, and carries a stable
 * 64-bit `hash` of all five. The hash is computed over canonical JSON (sorted
 * keys, no undefined, −0 as 0), so the same run gives the same hash in every
 * engine and key order never matters. `createdAt` and `output` ride along for
 * display and are deliberately not hashed. Input digests use SHA-256 from Web
 * Crypto where it exists and fall back to the same 64-bit hash elsewhere; file
 * names are never part of a digest, only bytes and their order.
 */
import { getAgentTemplate, validateRecipeValues } from './index.mjs';

export const RUN_RECORD_VERSION = 1;
export const RUN_RECORD_LIMITS = Object.freeze({ settings: 32_768, output: 4096, depth: 8, inputs: 16, bytes: 256 * 1024 * 1024, history: 100 });
const DIGEST = /^(?:sha256:[a-f0-9]{64}|h64:[a-f0-9]{16})$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]{1,32})?$/;
const SLUG = /^[a-z][a-z0-9-]{1,63}$/;
const plain = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;

/** JSON with sorted keys and no ambiguity: finite numbers only, −0 written as 0, undefined object keys dropped. */
export function canonicalJson(value, depth = 0) {
  if (depth > RUN_RECORD_LIMITS.depth) throw new RangeError('Run settings are nested too deeply.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new RangeError('Run settings must use finite numbers.'); return JSON.stringify(value === 0 ? 0 : value); }
  if (Array.isArray(value)) return `[${value.map(item => { if (item === undefined) throw new TypeError('Run settings cannot hold undefined in a list.'); return canonicalJson(item, depth + 1); }).join(',')}]`;
  if (!plain(value)) throw new TypeError('Run settings must be plain JSON data.');
  return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key], depth + 1)}`).join(',')}}`;
}

// Two independent 32-bit multiply–xor lanes with a murmur-style finaliser: 16 hex characters.
function hashBytes(bytes, state = [0x811c9dc5, 0x6b43a9b5]) {
  let [a, b] = state;
  for (let i = 0; i < bytes.length; i++) { a = Math.imul(a ^ bytes[i], 0x01000193); b = Math.imul(b ^ bytes[i], 0x5bd1e995); b ^= b >>> 15; }
  return [a, b];
}
function finish([a, b], length) {
  a ^= length; b ^= Math.imul(length, 0x9e3779b1);
  for (let round = 0; round < 2; round++) {
    a = Math.imul(a ^ (a >>> 16), 0x85ebca6b) ^ b; a = Math.imul(a ^ (a >>> 13), 0xc2b2ae35); a ^= a >>> 16;
    b = Math.imul(b ^ (b >>> 16), 0xcc9e2d51) ^ a; b = Math.imul(b ^ (b >>> 13), 0x1b873593); b ^= b >>> 16;
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
const encoder = new TextEncoder();
/** A stable 64-bit hash of a string's UTF-8 bytes, as 16 lowercase hex characters. Not a security hash. */
export function hashText(text) {
  if (typeof text !== 'string') throw new TypeError('hashText expects a string.');
  const bytes = encoder.encode(text);
  return finish(hashBytes(bytes), bytes.length);
}

const abort = signal => { if (signal?.aborted) throw new DOMException('Cancelled.', 'AbortError'); };
async function bytesOf(input) {
  if (typeof input === 'string') return encoder.encode(input);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (input && typeof input.arrayBuffer === 'function' && typeof input.size === 'number') return new Uint8Array(await input.arrayBuffer());
  throw new TypeError('Digest Blob, File, ArrayBuffer, typed array or string inputs.');
}
const hex = buffer => Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');
/**
 * A digest of the selected inputs, in order: `sha256:<64 hex>` with Web Crypto, otherwise `h64:<16 hex>`.
 * Only bytes count, so a renamed file keeps its digest and swapping two inputs changes it.
 */
export async function digestInputs(inputs, { signal, subtle = globalThis.crypto?.subtle } = {}) {
  const list = Array.isArray(inputs) ? inputs : [inputs];
  if (list.length > RUN_RECORD_LIMITS.inputs) throw new RangeError(`Digest at most ${RUN_RECORD_LIMITS.inputs} inputs.`);
  const total = list.reduce((sum, input) => sum + (typeof input?.size === 'number' ? input.size : input?.byteLength ?? input?.length ?? 0), 0);
  if (total > RUN_RECORD_LIMITS.bytes) throw new RangeError('Inputs are too large to digest.');
  const parts = [];
  for (const input of list) {
    abort(signal);
    const bytes = await bytesOf(input);
    parts.push(subtle ? hex(await subtle.digest('SHA-256', bytes)) : finish(hashBytes(bytes), bytes.length));
  }
  abort(signal);
  // Each input's own digest and length, so a boundary between two inputs can never be moved.
  const joined = encoder.encode(`${list.length}\n${parts.join('\n')}`);
  return subtle ? `sha256:${hex(await subtle.digest('SHA-256', joined))}` : `h64:${finish(hashBytes(joined), joined.length)}`;
}

const hashed = record => hashText(canonicalJson({ v: RUN_RECORD_VERSION, templateId: record.templateId, settings: record.settings, seed: record.seed, sdkVersion: record.sdkVersion, inputsDigest: record.inputsDigest }));
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function bounded(value, name, limit) {
  if (!plain(value)) throw new TypeError(`${name} must be a plain object.`);
  const json = canonicalJson(value);
  if (json.length > limit) throw new RangeError(`${name} must stay under ${limit} characters of JSON.`);
  return JSON.parse(json);
}
/**
 * One run, as a frozen record with a stable `hash`. `seed` defaults to a whole-number `settings.seed`;
 * `createdAt` (ISO time) and `output` (plain JSON, such as size and filename) are kept but not hashed.
 */
export function createRunRecord({ templateId, settings = {}, sdkVersion = null, seed, inputsDigest = null, createdAt, output } = {}) {
  if (typeof templateId !== 'string' || !SLUG.test(templateId)) throw new TypeError('templateId must be a lowercase template slug.');
  const owned = bounded(settings, 'settings', RUN_RECORD_LIMITS.settings);
  const chosen = seed ?? (Number.isInteger(owned.seed) && owned.seed >= 0 ? owned.seed : null);
  if (chosen !== null && (!Number.isInteger(chosen) || chosen < 0 || chosen > 0xffffffff)) throw new RangeError('seed must be a whole number from 0 to 4294967295.');
  if (sdkVersion !== null && (typeof sdkVersion !== 'string' || !SEMVER.test(sdkVersion))) throw new TypeError('sdkVersion must be a semantic version such as 0.5.0.');
  if (inputsDigest !== null && (typeof inputsDigest !== 'string' || !DIGEST.test(inputsDigest))) throw new TypeError('inputsDigest must come from digestInputs.');
  if (createdAt !== undefined && (typeof createdAt !== 'string' || createdAt.length > 40 || Number.isNaN(Date.parse(createdAt)))) throw new TypeError('createdAt must be an ISO date string.');
  const record = { version: RUN_RECORD_VERSION, hash: '', templateId, settings: owned, seed: chosen, sdkVersion, inputsDigest };
  record.hash = hashed(record);
  if (createdAt !== undefined) record.createdAt = createdAt;
  if (output !== undefined) record.output = bounded(output, 'output', RUN_RECORD_LIMITS.output);
  return freeze(record);
}

const KEYS = ['version', 'hash', 'templateId', 'settings', 'seed', 'sdkVersion', 'inputsDigest'];
/** Read a stored or shared record (object or JSON text); throws when it is malformed or its hash does not match. */
export function parseRunRecord(value) {
  const data = typeof value === 'string' ? (value.length > RUN_RECORD_LIMITS.settings * 2 ? null : JSON.parse(value)) : value;
  if (!plain(data)) throw new TypeError('A run record is a JSON object.');
  const extra = Object.keys(data).filter(key => !KEYS.includes(key) && key !== 'createdAt' && key !== 'output');
  if (extra.length || KEYS.some(key => !Object.hasOwn(data, key))) throw new TypeError(`A run record has exactly ${KEYS.join(', ')} (plus optional createdAt and output).`);
  if (data.version !== RUN_RECORD_VERSION) throw new RangeError(`Supported run record version is ${RUN_RECORD_VERSION}.`);
  const record = createRunRecord(data);
  if (record.hash !== data.hash) throw new Error('This run record was changed after it was made: its hash does not match.');
  return record;
}
/** True when a record is well formed and its hash matches its contents. */
export function verifyRunRecord(value) {
  try { parseRunRecord(value); return true; } catch { return false; }
}

/**
 * Split run settings into portable recipe `values` (fields the template's v1 recipe accepts, each validated)
 * and `extra` engine-only settings that a recipe cannot hold yet.
 */
export function runRecipeValues(templateId, settings = {}) {
  const template = getAgentTemplate(templateId);
  if (!template) throw new Error('Choose a reviewed catalog template.');
  if (!plain(settings)) throw new TypeError('settings must be a plain object.');
  const values = {}, extra = {};
  for (const [key, value] of Object.entries(settings)) {
    if (value === undefined) continue;
    if (template.fields.some(field => field.id === key) && !validateRecipeValues(templateId, { [key]: value }).length) values[key] = value;
    else extra[key] = value;
  }
  return { values, extra };
}

/**
 * A newest-first, de-duplicated run list for a workspace. `attachment` is anything the host keeps per run
 * (a preview URL, say); every `evicted` entry is one the host should release. With `settleMs`, a run that
 * replaces one made moments earlier takes its place, so dragging a slider leaves one entry, not twenty.
 */
export function createRunHistory({ limit = 12, settleMs = 0, now = () => Date.now() } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > RUN_RECORD_LIMITS.history) throw new RangeError(`limit must be a whole number from 1 to ${RUN_RECORD_LIMITS.history}.`);
  if (!Number.isFinite(settleMs) || settleMs < 0) throw new RangeError('settleMs must be zero or more.');
  let entries = [];
  const view = entry => Object.freeze({ record: entry.record, attachment: entry.attachment, at: entry.at });
  return {
    add(record, attachment) {
      if (typeof record?.hash !== 'string' || !/^[a-f0-9]{16}$/.test(record.hash)) throw new TypeError('Add a record from createRunRecord.');
      const at = now(), found = entries.findIndex(entry => entry.record.hash === record.hash);
      if (found >= 0) {
        const [entry] = entries.splice(found, 1); entry.settled = true; entries.unshift(entry);
        return { entry: view(entry), added: false, evicted: attachment === entry.attachment ? [] : [Object.freeze({ record, attachment, at })] };
      }
      const evicted = [];
      const head = entries[0];
      if (head && !head.settled && settleMs > 0 && at - head.at < settleMs) evicted.push(view(entries.shift()));
      else if (head) head.settled = true;
      const entry = { record, attachment, at, settled: false };
      entries.unshift(entry);
      evicted.push(...entries.splice(limit).map(view));
      return { entry: view(entry), added: true, evicted };
    },
    /** Keep the newest run even if another arrives within `settleMs` (after an export, say). */
    settle() { if (entries[0]) entries[0].settled = true; },
    get(hash) { const entry = entries.find(item => item.record.hash === hash); return entry ? view(entry) : null; },
    list() { return entries.map(view); },
    get size() { return entries.length; },
    clear() { const removed = entries.map(view); entries = []; return removed; },
  };
}
