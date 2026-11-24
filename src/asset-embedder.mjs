/**
 * Search a creator's own pictures by meaning ("the shot with the red car"), on the device.
 *
 * - `SIGLIP_MODEL` pins SigLIP base, patch 16, 224 px (Google, Apache-2.0) as the ONNX export
 *   `Xenova/siglip-base-patch16-224` at one Hub commit, with the byte size and SHA-256 of every
 *   encoder file and the Git blob id of its tokenizer. The image and text encoders are separate
 *   files, so indexing pictures never downloads the text half.
 * - `createAssetEmbedder({ ort })` runs them on the host's `onnxruntime-web` (the same optional,
 *   pinned peer as depth). Nothing downloads until `prepare` or the first `embedImage`/`embedText`;
 *   files are fetched, checked and stored by `createVerifiedModelCache`, and weights that do not
 *   match never run. Pictures run on WebGPU with q4f16 weights where the browser has it, searches on
 *   WebAssembly with q8 (168 MB in all; 213 MB when everything runs on WebAssembly).
 * - `createSiglipTokenizer` is an original SentencePiece Unigram (Viterbi) tokenizer over the pinned
 *   `tokenizer.json`, with SigLIP's own text canonicalization and fixed 64-token padding;
 *   `siglipImageTensor` squashes a picture to 224 × 224 and scales it to −1…1.
 * - `siglipMatchChance` turns a cosine into SigLIP's own sigmoid match probability, so the
 *   asset index can blend meaning with look and name hints (`search(q, { vector, calibrate })`).
 */
import { createVerifiedModelCache, DEPTH_ORT_RUNTIME, DepthError, depthModelUrl, isModelFileCached, shrinkPixels } from './depth.mjs';
import { normalizeVector } from './asset-search.mjs';

/** The optional peer that runs the encoders: ONNX Runtime Web, pinned (shared with depth). */
export const ASSET_EMBEDDER_RUNTIME = DEPTH_ORT_RUNTIME;
const weight = (file, bytes, sha256) => Object.freeze({ file, bytes, sha256 });
export const SIGLIP_MODEL = Object.freeze({
  id: 'siglip-base-patch16-224', name: 'SigLIP base (patch 16, 224 px)', license: 'Apache-2.0', author: 'Google', source: 'google/siglip-base-patch16-224',
  repo: 'Xenova/siglip-base-patch16-224', revision: '4649052661e53c7000355844105f8a1792088239', host: 'https://huggingface.co',
  /** Name vectors in an asset index with this, so vectors from any other model are never compared with them. */
  index: 'siglip-base-patch16-224@4649052',
  dims: 768, textLength: 64, template: 'a photo of {}',
  preprocess: Object.freeze({ size: 224, mean: Object.freeze([0.5, 0.5, 0.5]), std: Object.freeze([0.5, 0.5, 0.5]) }),
  // From the original weights (google/siglip-base-patch16-224 @7fd15f0): logit_scale = e^4.7649970, logit_bias.
  logit: Object.freeze({ scale: 117.3307659359213, bias: -12.9324369430542 }),
  tokens: Object.freeze({ pad: 1, eos: 1, unk: 2 }),
  config: Object.freeze({ 'tokenizer.json': Object.freeze({ bytes: 2398744, gitSha1: 'b6feda4c1249e1ddccc9405e39ebe1ca4c1e091d' }) }),
  weights: Object.freeze({
    'vision-q8': weight('onnx/vision_model_quantized.onnx', 99499129, 'ef14a954f3d57e1806666432bd9785004c1dc27100aa260eee0cb0f10a5de058'),
    'vision-fp16': weight('onnx/vision_model_fp16.onnx', 186142673, '7287a8e9cbf4f2eedd66e8dc5cf584be03108f4e4a24331879ac6ef7ac7c878f'),
    'vision-q4f16': weight('onnx/vision_model_q4f16.onnx', 54625339, 'c9eb383bddf748212d240d90ca765415137d7994c60dd8be97bdb3adad30c682'),
    'text-q8': weight('onnx/text_model_quantized.onnx', 111475220, 'ad0329b1f35acc66d8953ff2559ce358da8eb0a7011794cf951523d63a4dbce2'),
    'text-fp16': weight('onnx/text_model_fp16.onnx', 220867426, 'ebffbfd71ae11b3f9df5233095815953f44b02ca241c317722edd8c49a9de0f6'),
    'text-q4f16': weight('onnx/text_model_q4f16.onnx', 98710743, '195b9dd5173188e8bd324e90d903d54e85e68a0ff29e1d4e79a7d8a0da053335'),
  }),
});
export const ASSET_EMBEDDER_DTYPES = Object.freeze(['q8', 'q4f16', 'fp16']);
export const ASSET_EMBEDDER_LIMITS = Object.freeze({ pixels: 16_000_000, text: 300, vocab: 64_000, piece: 64 });

export class AssetEmbedderError extends Error {
  constructor(code, message, options) { super(message, options); this.name = 'AssetEmbedderError'; this.code = code; }
}
const aborted = signal => { if (signal?.aborted) throw new DOMException('The search model was cancelled.', 'AbortError'); };
const rethrow = error => error instanceof DepthError ? new AssetEmbedderError(error.code, error.message, { cause: error }) : error;

/** SigLIP's text canonicalization: lowercase, no ASCII punctuation, single spaces, NFKC. */
export const canonicalSiglipText = text => String(text ?? '').normalize('NFKC').toLowerCase().replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, '').replace(/\s+/g, ' ').trim();

/**
 * A SentencePiece Unigram tokenizer over SigLIP's `tokenizer.json` (any Unigram vocabulary works).
 * `encode(text)` → `{ ids, count }`: the lowest-cost split (Viterbi over piece scores; a character the
 * vocabulary lacks becomes its UTF-8 byte pieces, or one `<unk>` per run without them), `</s>` at the end, padded with `</s>` to exactly `length` (64) ids.
 */
export function createSiglipTokenizer(json, { length = SIGLIP_MODEL.textLength } = {}) {
  const data = typeof json === 'string' ? JSON.parse(json) : json, vocab = data?.model?.vocab;
  if (data?.model?.type !== 'Unigram' || !Array.isArray(vocab) || vocab.length < 3 || vocab.length > ASSET_EMBEDDER_LIMITS.vocab) throw new TypeError('Pass a SentencePiece Unigram tokenizer.json.');
  if (!Number.isInteger(length) || length < 2 || length > 512) throw new RangeError('length must be 2 to 512 tokens.');
  const pieces = new Map(), unk = Number.isInteger(data.model.unk_id) ? data.model.unk_id : SIGLIP_MODEL.tokens.unk;
  let longest = 1, lowest = 0;
  vocab.forEach((entry, id) => {
    const [piece, score] = Array.isArray(entry) ? entry : [];
    if (typeof piece !== 'string' || !Number.isFinite(score) || piece.length > ASSET_EMBEDDER_LIMITS.piece) throw new TypeError(`Vocabulary entry ${id} is not [piece, score].`);
    if (!pieces.has(piece)) pieces.set(piece, [id, score]);
    longest = Math.max(longest, [...piece].length); lowest = Math.min(lowest, score);
  });
  const unknown = lowest - 10, eos = SIGLIP_MODEL.tokens.eos, pad = SIGLIP_MODEL.tokens.pad, encoder = new TextEncoder();
  return Object.freeze({
    size: vocab.length, length,
    /** Pieces for already-canonical text (`▁` marks a word start). */
    split(text) {
      const chars = [...`▁${String(text).replaceAll(' ', '▁')}`], n = chars.length;
      const best = new Float64Array(n + 1).fill(-Infinity), from = new Int32Array(n + 1), token = new Int32Array(n + 1);
      best[0] = 0;
      for (let start = 0; start < n; start++) {
        if (best[start] === -Infinity) continue;
        let known = false, piece = '';
        for (let end = start + 1; end <= Math.min(n, start + longest); end++) {
          piece += chars[end - 1];
          const hit = pieces.get(piece);
          if (!hit) continue;
          if (end === start + 1) known = true;
          if (best[start] + hit[1] > best[end]) { best[end] = best[start] + hit[1]; from[end] = start; token[end] = hit[0]; }
        }
        if (!known && best[start] + unknown > best[start + 1]) { best[start + 1] = best[start] + unknown; from[start + 1] = start; token[start + 1] = unk; }
      }
      const steps = [];
      for (let at = n; at > 0; at = from[at]) steps.push([from[at], token[at]]);
      const ids = [];
      for (const [start, id] of steps.reverse()) {
        // Byte fallback, as SentencePiece does: a character the vocabulary lacks becomes its UTF-8 bytes (<0xE7>…) when they exist.
        const bytes = id === unk ? [...encoder.encode(chars[start])].map(byte => pieces.get(`<0x${byte.toString(16).toUpperCase().padStart(2, '0')}>`)?.[0]) : null;
        if (bytes?.every(value => value !== undefined)) ids.push(...bytes);
        else if (!(id === unk && ids[ids.length - 1] === unk)) ids.push(id);
      }
      return ids;
    },
    encode(text) {
      const clean = canonicalSiglipText(String(text ?? '').slice(0, ASSET_EMBEDDER_LIMITS.text)), body = clean ? this.split(clean).slice(0, length - 1) : [];
      const ids = new Array(length).fill(pad);
      body.forEach((id, index) => { ids[index] = id; });
      ids[body.length] = eos;
      return { ids, count: body.length + 1 };
    },
  });
}

/** RGBA pixels → SigLIP's float32 NCHW input: squashed to 224 × 224 (box-average, then bilinear), scaled to −1…1. */
export function siglipImageTensor(image, { preprocess = SIGLIP_MODEL.preprocess } = {}) {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.data?.length !== image.width * image.height * 4) throw new TypeError('Pass an image as { width, height, data } with RGBA bytes.');
  if (image.width * image.height > ASSET_EMBEDDER_LIMITS.pixels) throw new AssetEmbedderError('image-too-large', `Search reads pictures up to ${ASSET_EMBEDDER_LIMITS.pixels / 1e6} megapixels; pass a smaller copy.`);
  const { size, mean, std } = preprocess, source = shrinkPixels(image, size * 2), plane = size * size, data = new Float32Array(plane * 3), px = source.data;
  const sx = source.width / size, sy = source.height / size;
  for (let y = 0; y < size; y++) {
    const v = Math.min(source.height - 1, Math.max(0, (y + 0.5) * sy - 0.5)), y0 = Math.floor(v), y1 = Math.min(source.height - 1, y0 + 1), fy = v - y0;
    for (let x = 0; x < size; x++) {
      const u = Math.min(source.width - 1, Math.max(0, (x + 0.5) * sx - 0.5)), x0 = Math.floor(u), x1 = Math.min(source.width - 1, x0 + 1), fx = u - x0;
      const a = (y0 * source.width + x0) * 4, b = (y0 * source.width + x1) * 4, c = (y1 * source.width + x0) * 4, d = (y1 * source.width + x1) * 4;
      for (let ch = 0; ch < 3; ch++) data[ch * plane + y * size + x] = (((px[a + ch] * (1 - fx) + px[b + ch] * fx) * (1 - fy) + (px[c + ch] * (1 - fx) + px[d + ch] * fx) * fy) / 255 - mean[ch]) / std[ch];
    }
  }
  return { data, dims: [1, 3, size, size] };
}

/** SigLIP's own match probability for a cosine: sigmoid(scale × cosine + bias), 0–1. */
export const siglipMatchChance = cosine => 1 / (1 + Math.exp(-(SIGLIP_MODEL.logit.scale * cosine + SIGLIP_MODEL.logit.bias)));

function partPlan(part, { device, dtype } = {}, gpu) {
  const chosen = device ?? (part === 'vision' && gpu ? 'webgpu' : 'wasm');
  if (!['webgpu', 'wasm'].includes(chosen)) throw new RangeError('The search model runs on webgpu or wasm.');
  const precision = dtype ?? (chosen === 'webgpu' ? 'q4f16' : 'q8');
  if (!ASSET_EMBEDDER_DTYPES.includes(precision)) throw new RangeError(`Search weights come as ${ASSET_EMBEDDER_DTYPES.join(', ')}.`);
  // Measured with ONNX Runtime Web 1.31.1: 8-bit weights on WebGPU return the same vector for every input.
  if (chosen === 'webgpu' && precision === 'q8') throw new RangeError('q8 search weights give wrong results on WebGPU; use q4f16 or fp16 there, or q8 on wasm.');
  const spec = SIGLIP_MODEL.weights[`${part}-${precision}`], extra = part === 'text' ? SIGLIP_MODEL.config['tokenizer.json'].bytes : 0;
  return Object.freeze({ device: chosen, dtype: precision, file: spec.file, bytes: spec.bytes + extra });
}

/**
 * Where each half runs and what it downloads. Pictures: WebGPU with q4f16 weights when the browser has it
 * (54.6 MB), otherwise WebAssembly with q8 (99.5 MB). Searches: WebAssembly with q8 (111.5 MB + the 2.4 MB
 * tokenizer), because the q4f16 text encoder finds the right picture less often. Override either half with
 * `{ vision: { device, dtype }, text: { device, dtype } }`.
 */
export function assetEmbedderPlan({ vision, text, gpu = Boolean(globalThis.navigator?.gpu) } = {}) {
  const parts = { vision: partPlan('vision', vision, gpu), text: partPlan('text', text, gpu) };
  return Object.freeze({ ...parts, bytes: parts.vision.bytes + parts.text.bytes });
}

/** Which halves of the planned model are already stored in this browser (checked again when they load). */
export async function isAssetEmbedderCached({ vision, text, gpu, caches = globalThis.caches } = {}) {
  const plan = assetEmbedderPlan({ vision, text, gpu });
  const [image, words, tokenizer] = await Promise.all([isModelFileCached(SIGLIP_MODEL.weights[`vision-${plan.vision.dtype}`], { caches }), isModelFileCached(SIGLIP_MODEL.weights[`text-${plan.text.dtype}`], { caches }), isModelFileCached(SIGLIP_MODEL.config['tokenizer.json'], { caches })]);
  return { vision: image, text: words && tokenizer };
}

const pooled = (results, names) => results.pooler_output ?? results.image_embeds ?? results.text_embeds ?? results[names[names.length - 1]];

/**
 * SigLIP image and text embeddings through the host's `onnxruntime-web` module (`ort`). Lazy: nothing downloads
 * until `prepare('vision' | 'text')` or the first `embedImage` / `embedText`, and each half downloads on its own.
 * Vectors are unit length (768 numbers) and comparable across halves and precisions; add them to
 * `createAssetIndex({ model: embedder.index })` and search with `{ vector: await embedder.embedText(q), calibrate: siglipMatchChance }`.
 * Each half follows `assetEmbedderPlan`; if a half fails to start on WebGPU it moves once to WebAssembly with
 * q8 weights (unless that half asked for `device: 'webgpu'`).
 */
export function createAssetEmbedder({ ort, vision, text, gpu, fetch, caches, subtle, signal, onProgress, template = SIGLIP_MODEL.template } = {}) {
  if (typeof ort?.InferenceSession?.create !== 'function' || typeof ort.Tensor !== 'function') throw new AssetEmbedderError('runtime-missing', `Pass the ${ASSET_EMBEDDER_RUNTIME.package}@${ASSET_EMBEDDER_RUNTIME.version} module as { ort }.`);
  if (typeof template !== 'string' || !template.includes('{}')) throw new TypeError('template must contain {} where the search goes.');
  const asked = { vision, text }, plan = { ...assetEmbedderPlan({ vision, text, gpu }) };
  let closed = false, tokenizer = null;
  const loading = {}, loaded = new Set();
  let queue = Promise.resolve();
  const files = part => createVerifiedModelCache({ model: SIGLIP_MODEL, label: 'search model', fetch, caches, subtle, signal, onProgress: event => onProgress?.({ ...event, part, model: SIGLIP_MODEL.id }) });
  const read = async (path, part) => new Uint8Array(await (await files(part).match(depthModelUrl(path, SIGLIP_MODEL))).arrayBuffer());
  async function open(part) {
    const bytes = await read(plan[part].file, part); aborted(signal);
    // Severity 3 = errors only: ORT otherwise logs routine placement notes through console.error.
    return ort.InferenceSession.create(bytes, { executionProviders: [plan[part].device], graphOptimizationLevel: 'all', logSeverityLevel: 3 });
  }
  async function start(part) {
    if (part === 'text' && !tokenizer) {
      try { tokenizer = createSiglipTokenizer(new TextDecoder().decode(await read('tokenizer.json', part))); }
      catch (error) { throw rethrow(error); }
    }
    try { return await open(part); }
    catch (error) {
      if (error instanceof DepthError || error?.name === 'AbortError') throw rethrow(error);
      if (plan[part].device !== 'webgpu' || asked[part]?.device === 'webgpu') throw new AssetEmbedderError('load-failed', 'The search model could not start on this device.', { cause: error });
      plan[part] = partPlan(part, { device: 'wasm' });
      try { return await open(part); } catch (again) { if (again instanceof DepthError || again?.name === 'AbortError') throw rethrow(again); throw new AssetEmbedderError('load-failed', 'The search model could not start on this device.', { cause: again }); }
    }
  }
  const session = part => {
    if (closed) return Promise.reject(new AssetEmbedderError('closed', 'This search model was closed.'));
    return (loading[part] ??= start(part).then(model => { loaded.add(part); return model; }, error => { delete loading[part]; throw error; }));
  };
  // One run at a time across both halves: ONNX Runtime Web shares one engine between sessions, and its WebGPU backend
  // throws "Session mismatch" when a second session runs while a WebGPU run is still in flight.
  const serial = task => { const next = queue.then(task, task); queue = next.catch(() => {}); return next; };
  async function embed(part, feedsFor, runSignal) {
    aborted(runSignal); const model = await session(part); aborted(runSignal);
    return serial(async () => {
      if (closed) throw new AssetEmbedderError('closed', 'This search model was closed.');
      const results = await model.run(feedsFor(model.inputNames)), output = pooled(results, model.outputNames);
      const values = output?.data ? Float32Array.from(output.data, Number) : null;
      for (const tensor of Object.values(results)) tensor.dispose?.();
      if (!values || values.length !== SIGLIP_MODEL.dims) throw new AssetEmbedderError('bad-output', 'The search model returned no embedding.');
      aborted(runSignal);
      return normalizeVector(values);
    });
  }
  return Object.freeze({
    model: SIGLIP_MODEL.id, index: SIGLIP_MODEL.index, dims: SIGLIP_MODEL.dims,
    /** Where each half runs now (a WebGPU half that failed to start shows its WebAssembly fallback). */
    get plan() { return Object.freeze({ ...plan, bytes: plan.vision.bytes + plan.text.bytes }); },
    /** Whether a half is downloaded, verified and started. */
    ready: part => loaded.has(part) && !closed,
    /** Download, verify and start one half ahead of time. */
    async prepare(part = 'vision') { if (!['vision', 'text'].includes(part)) throw new RangeError('Prepare vision or text.'); await session(part); },
    /** A unit-length embedding of RGBA pixels. */
    embedImage(image, { signal: runSignal } = {}) {
      const input = siglipImageTensor(image);
      return embed('vision', names => Object.fromEntries(names.map(name => {
        if (!/pixel/i.test(name)) throw new AssetEmbedderError('bad-output', `The search model asks for ${name}, which this SDK does not provide.`);
        return [name, new ort.Tensor('float32', input.data, input.dims)];
      })), runSignal);
    },
    /** A unit-length embedding of a search, written into `template` ("a photo of {}"). */
    async embedText(text, { signal: runSignal } = {}) {
      const query = String(text ?? '').trim();
      if (!query) throw new RangeError('Search for at least one word.');
      await session('text');
      const { ids } = tokenizer.encode(template.replace('{}', query)), dims = [1, ids.length];
      return embed('text', names => Object.fromEntries(names.map(name => {
        if (/input_ids/i.test(name)) return [name, new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), dims)];
        // SigLIP was trained without masking its padding, so every position is attended.
        if (/attention_mask/i.test(name)) return [name, new ort.Tensor('int64', new BigInt64Array(ids.length).fill(1n), dims)];
        throw new AssetEmbedderError('bad-output', `The search model asks for ${name}, which this SDK does not provide.`);
      })), runSignal);
    },
    matchChance: siglipMatchChance,
    async dispose() {
      closed = true;
      await Promise.all(Object.values(loading).map(pending => pending.then(model => model.release?.(), () => {})));
    },
  });
}
