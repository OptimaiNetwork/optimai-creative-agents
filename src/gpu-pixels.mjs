/**
 * The color grade and 3D LUT on the graphics card. Original and dependency-free:
 * one WebGPU compute pass runs `gradePixels` and then `applyLut` on every pixel
 * of an RGBA buffer, with the same arguments, the same validation and the same
 * order as the CPU path in `color-grade` and `lut`.
 *
 * The shader reads the CPU's own sRGB decode and 65536-step encode tables and
 * hashes grain from the same integers, so a GPU result is the CPU result to
 * within one level per channel (float32 rounding); alpha is never touched.
 * Where WebGPU is missing, refused or lost, the processor runs the CPU functions
 * instead and says why (`backend`, `reason`), so callers never branch.
 */
import { GRADE_LIMITS, gradePixels, isIdentityGrade, resolveGrade } from './color-grade.mjs';
import { applyLut } from './lut.mjs';

export const GPU_PIXEL_LIMITS = Object.freeze({ pixels: 16_000_000, workgroup: 64, dispatch: 65535 });

const LINEAR = Float32Array.from({ length: 256 }, (_, value) => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
// The CPU's encode table packed four levels to a word.
const ENCODE = (() => {
  const bytes = Uint8Array.from({ length: 65536 }, (_, index) => { const v = index / 65535; return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)); });
  return new Uint32Array(bytes.buffer);
})();
const FLAG = Object.freeze({ grade: 1, lut: 2, grain: 4 });

/** WGSL for the pass: bindings 0 pixels (rgba8 as u32), 1 settings, 2 decode table then LUT, 3 encode table. */
export const GPU_PIXEL_SHADER = /* wgsl */ `
struct Settings {
  width: u32, start: u32, count: u32, flags: u32,
  seed: u32, size: u32, pad0: u32, pad1: u32,
  gain: f32, contrast: f32, fade: f32, saturation: f32,
  vibrance: f32, wa: f32, wb: f32, grain: f32,
  sa: f32, sb: f32, ha: f32, hb: f32,
  amount: f32, pad2: f32, pad3: f32, pad4: f32,
  dmin: vec4<f32>, dmax: vec4<f32>,
};
@group(0) @binding(0) var<storage, read_write> pixels: array<u32>;
@group(0) @binding(1) var<uniform> s: Settings;
@group(0) @binding(2) var<storage, read> tables: array<f32>;
@group(0) @binding(3) var<storage, read> encodeTable: array<u32>;

fn hash(x: u32, y: u32, seed: u32) -> f32 {
  var h = (x * 0x27d4eb2du) ^ (y * 0x165667b1u) ^ seed;
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = (h ^ (h >> 13u)) * 0xc2b2ae35u;
  return f32(h ^ (h >> 16u)) / 4294967296.0;
}
fn cbrt(v: f32) -> f32 { return select(0.0, pow(v, 1.0 / 3.0), v > 0.0); }
fn encode(v: f32) -> u32 {
  let i = select(select(u32(floor(v * 65535.0 + 0.5)), 65535u, v >= 1.0), 0u, v <= 0.0);
  return (encodeTable[i >> 2u] >> ((i & 3u) * 8u)) & 255u;
}
fn tone(L: f32) -> f32 {
  let t = select(0.5 + (L - 0.6) / 0.4 * 0.5, L / 0.6 * 0.5, L < 0.6);
  let k = t * t * (3.0 - 2.0 * t);
  return select(0.6 + (k - 0.5) * 2.0 * 0.4, k * 2.0 * 0.6, k < 0.5);
}
fn grade(c: vec3<u32>, x: u32, y: u32) -> vec3<u32> {
  let r = tables[c.r] * s.gain; let g = tables[c.g] * s.gain; let b0 = tables[c.b] * s.gain;
  let l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b0);
  let m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b0);
  let q = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b0);
  var L = clamp(0.2104542553 * l + 0.793617785 * m - 0.0040720468 * q, 0.0, 1.0);
  var a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * q;
  var b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * q;
  L = L + s.contrast * (tone(L) - L);
  L = s.fade + L * (1.0 - s.fade);
  let chroma = sqrt(a * a + b * b);
  let scale = s.saturation * (1.0 + s.vibrance * (1.0 - min(chroma / 0.2, 1.0)));
  a = a * scale + s.wa * L; b = b * scale + s.wb * L;
  let shadow = (1.0 - L) * (1.0 - L); let highlight = L * L;
  a = a + s.sa * shadow + s.ha * highlight; b = b + s.sb * shadow + s.hb * highlight;
  if ((s.flags & 4u) != 0u) { L = L + (hash(x, y, s.seed) + hash(x, y, s.seed ^ 0x9e3779b9u) - 1.0) * s.grain * (0.35 + 2.6 * L * (1.0 - L)); }
  let p = L + 0.3963377774 * a + 0.2158037573 * b; let n = L - 0.1055613458 * a - 0.0638541728 * b; let u = L - 0.0894841775 * a - 1.291485548 * b;
  let pl = p * p * p; let nl = n * n * n; let ul = u * u * u;
  return vec3<u32>(encode(4.0767416621 * pl - 3.3077115913 * nl + 0.2309699292 * ul), encode(-1.2684380046 * pl + 2.6097574011 * nl - 0.3413193965 * ul), encode(-0.0041960863 * pl - 0.7034186147 * nl + 1.707614701 * ul));
}
fn lut(c: vec3<u32>) -> vec3<u32> {
  let size = s.size; let top = f32(size - 1u);
  let pos = clamp((vec3<f32>(c) / 255.0 - s.dmin.xyz) / (s.dmax.xyz - s.dmin.xyz) * top, vec3<f32>(0.0), vec3<f32>(top));
  let i = min(vec3<u32>(floor(pos)), vec3<u32>(size - 2u));
  let f = pos - vec3<f32>(i);
  let base = 256u + ((i.z * size + i.y) * size + i.x) * 3u; let dg = size * 3u; let db = size * size * 3u;
  var out = vec3<u32>(0u);
  for (var k = 0u; k < 3u; k = k + 1u) {
    let o = base + k;
    let c00 = tables[o] + (tables[o + 3u] - tables[o]) * f.x; let c10 = tables[o + dg] + (tables[o + dg + 3u] - tables[o + dg]) * f.x;
    let c01 = tables[o + db] + (tables[o + db + 3u] - tables[o + db]) * f.x; let c11 = tables[o + db + dg] + (tables[o + db + dg + 3u] - tables[o + db + dg]) * f.x;
    let near = c00 + (c10 - c00) * f.y;
    let v = clamp(near + ((c01 + (c11 - c01) * f.y) - near) * f.z, 0.0, 1.0);
    out[k] = u32(floor(f32(c[k]) + (v * 255.0 - f32(c[k])) * s.amount + 0.5));
  }
  return out;
}
@compute @workgroup_size(${GPU_PIXEL_LIMITS.workgroup})
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) li: u32, @builtin(num_workgroups) groups: vec3<u32>) {
  let index = (wg.y * groups.x + wg.x) * ${GPU_PIXEL_LIMITS.workgroup}u + li;
  if (index >= s.count) { return; }
  let word = pixels[index];
  var c = vec3<u32>(word & 255u, (word >> 8u) & 255u, (word >> 16u) & 255u);
  let pixel = s.start * s.width + index;
  if ((s.flags & 1u) != 0u) { c = grade(c, pixel % s.width, pixel / s.width); }
  if ((s.flags & 2u) != 0u) { c = lut(c); }
  pixels[index] = (word & 0xff000000u) | c.r | (c.g << 8u) | (c.b << 16u);
}
`;

// Same checks and words as the CPU functions, so both paths refuse the same calls.
function checkPixels(rgba, width, height, rows, label) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > GPU_PIXEL_LIMITS.pixels) throw new RangeError(`${label} size must be whole pixels within 16 million.`);
  if (!(rgba instanceof Uint8ClampedArray || rgba instanceof Uint8Array) || rgba.length < width * height * 4) throw new TypeError(`${label} pixels must be an RGBA Uint8ClampedArray of width × height × 4.`);
  const [start, end] = rows ?? [0, height];
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > height || start > end) throw new RangeError(`${label} rows must be a [start, end) range inside the image.`);
  return [start, end];
}
const resolve = grade => typeof grade === 'string' || !Object.isFrozen(grade) ? resolveGrade(grade) : grade;
const isLut = lut => lut && Number.isInteger(lut.size) && lut.size >= 2 && lut.size <= 65 && lut.table instanceof Float32Array && lut.table.length === lut.size ** 3 * 3 && lut.domainMin?.length === 3 && lut.domainMax?.length === 3;

/**
 * The settings block the shader reads (32 words): the grade's working numbers,
 * computed exactly as the CPU grade computes them, plus the band and the LUT.
 */
export function gpuPixelSettings({ width, start = 0, count, grade = null, seed = 0, lut = null, amount = 1 }) {
  const buffer = new ArrayBuffer(128), words = new Uint32Array(buffer), floats = new Float32Array(buffer);
  let flags = 0;
  if (grade && !isIdentityGrade(grade)) {
    flags |= FLAG.grade | (grade.grain ? FLAG.grain : 0);
    const turn = Math.PI / 180;
    floats.set([2 ** grade.exposure, grade.contrast * 2, grade.fade, grade.saturation, grade.vibrance, grade.tint * 0.04, grade.temperature * 0.04, grade.grain * 0.09,
      grade.shadowTint * Math.cos(grade.shadowHue * turn), grade.shadowTint * Math.sin(grade.shadowHue * turn), grade.highlightTint * Math.cos(grade.highlightHue * turn), grade.highlightTint * Math.sin(grade.highlightHue * turn)], 8);
  }
  if (lut && amount) { flags |= FLAG.lut; floats[20] = amount; floats.set([...lut.domainMin, 0, ...lut.domainMax, 1], 24); }
  words.set([width, start, count, flags, (seed | 0) >>> 0, lut ? lut.size : 2], 0);
  return { buffer, flags };
}

/** The workgroup grid for `count` pixels, kept within the per-dimension dispatch limit. */
export function gpuPixelDispatch(count) {
  const groups = Math.max(1, Math.ceil(count / GPU_PIXEL_LIMITS.workgroup)), x = Math.min(groups, GPU_PIXEL_LIMITS.dispatch);
  return [x, Math.ceil(groups / x)];
}

const STORAGE = 0x80, COPY_DST = 0x8, COPY_SRC = 0x4, MAP_READ = 0x1, UNIFORM = 0x40;
const flagsOf = name => globalThis.GPUBufferUsage?.[name];
const usage = (...names) => names.reduce((sum, [name, fallback]) => sum | (flagsOf(name) ?? fallback), 0);
const MAP = () => globalThis.GPUMapMode?.READ ?? MAP_READ;

/**
 * A processor that grades and applies LUTs on WebGPU, or on the CPU when it cannot.
 * `gpu` defaults to `navigator.gpu`; pass a `device` to share one. `fallback: false`
 * makes GPU failures throw instead of quietly switching to the CPU.
 */
export async function createGpuPixelProcessor({ gpu = globalThis.navigator?.gpu, device: given, powerPreference = 'high-performance', fallback = true, signal } = {}) {
  let device = given ?? null, backend = 'cpu', reason = '', pipeline = null, decode = null, encode = null, pixels = null, readback = null, capacity = 0, queue = Promise.resolve(), destroyed = false;
  const luts = new WeakMap();
  const cpu = why => { if (backend === 'webgpu' || !reason) reason = why; backend = 'cpu'; };
  try {
    if (!device) {
      if (!gpu?.requestAdapter) throw new Error('This browser has no WebGPU.');
      const adapter = await gpu.requestAdapter({ powerPreference });
      if (!adapter) throw new Error('No graphics adapter was offered.');
      device = await adapter.requestDevice();
    }
    signal?.throwIfAborted?.();
    pipeline = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: GPU_PIXEL_SHADER }), entryPoint: 'main' } });
    encode = device.createBuffer({ size: ENCODE.byteLength, usage: usage(['STORAGE', STORAGE], ['COPY_DST', COPY_DST]) });
    device.queue.writeBuffer(encode, 0, ENCODE);
    decode = tableBuffer(null);
    backend = 'webgpu';
    device.lost?.then?.(info => { if (!destroyed) cpu(`The graphics device was lost${info?.message ? `: ${info.message}` : ''}.`); });
  }
  catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    if (!fallback) throw error;
    cpu(error?.message || 'WebGPU could not start.');
  }

  // Decode table (256 floats), followed by the LUT table when there is one; one buffer per LUT, kept while the LUT lives.
  function tableBuffer(lut) {
    if (lut && luts.has(lut)) return luts.get(lut);
    const data = new Float32Array(256 + (lut ? lut.table.length : 0));
    data.set(LINEAR); if (lut) data.set(lut.table, 256);
    const buffer = device.createBuffer({ size: Math.max(16, data.byteLength), usage: usage(['STORAGE', STORAGE], ['COPY_DST', COPY_DST]) });
    device.queue.writeBuffer(buffer, 0, data);
    if (lut) luts.set(lut, buffer);
    return buffer;
  }
  function grow(bytes) {
    if (bytes <= capacity) return;
    pixels?.destroy?.(); readback?.destroy?.();
    capacity = Math.ceil(bytes / 1_048_576) * 1_048_576;
    pixels = device.createBuffer({ size: capacity, usage: usage(['STORAGE', STORAGE], ['COPY_DST', COPY_DST], ['COPY_SRC', COPY_SRC]) });
    readback = device.createBuffer({ size: capacity, usage: usage(['MAP_READ', MAP_READ], ['COPY_DST', COPY_DST]) });
  }
  async function onGpu(rgba, width, start, end, grade, seed, lut, amount) {
    const count = (end - start) * width, bytes = count * 4, offset = start * width * 4;
    grow(bytes);
    const { buffer: settings } = gpuPixelSettings({ width, start, count, grade, seed, lut, amount });
    const uniform = device.createBuffer({ size: 128, usage: usage(['UNIFORM', UNIFORM], ['COPY_DST', COPY_DST]) });
    try {
      device.queue.writeBuffer(uniform, 0, settings);
      device.queue.writeBuffer(pixels, 0, rgba.subarray(offset, offset + bytes));
      device.pushErrorScope?.('validation');
      const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: pixels, size: bytes } }, { binding: 1, resource: { buffer: uniform } }, { binding: 2, resource: { buffer: lut && amount ? tableBuffer(lut) : decode } }, { binding: 3, resource: { buffer: encode } }] });
      const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
      pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(...gpuPixelDispatch(count)); pass.end();
      encoder.copyBufferToBuffer(pixels, 0, readback, 0, bytes);
      device.queue.submit([encoder.finish()]);
      const failure = await device.popErrorScope?.();
      if (failure) throw new Error(failure.message || 'The graphics card refused the pass.');
      await readback.mapAsync(MAP(), 0, bytes);
      try { rgba.set(new Uint8Array(readback.getMappedRange(0, bytes)), offset); }
      finally { readback.unmap(); }
    }
    finally { uniform.destroy?.(); }
  }

  /** Grade, then LUT, in one pass: the order the image runtime uses. Bad arguments reject, like a failed run. */
  function run(...args) {
    try { return begin(...args); }
    catch (error) { return Promise.reject(error); }
  }
  function begin(rgba, width, height, { grade = null, seed = 0, lut = null, amount = 1, rows, signal: callSignal } = {}) {
    if (destroyed) return Promise.reject(new Error('This pixel processor was destroyed.'));
    const [start, end] = checkPixels(rgba, width, height, rows, grade !== null ? 'Grade' : 'LUT');
    const resolved = grade === null ? null : resolve(grade);
    if (resolved && (!Number.isInteger(seed) || seed < 0 || seed > GRADE_LIMITS.seed)) throw new RangeError('Grade seed must be a whole number from 0 to 4294967295.');
    if (lut !== null && !isLut(lut)) throw new TypeError('Use a LUT from parseCubeLut, createLut or filmLut.');
    if (lut !== null && (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 1)) throw new RangeError('LUT amount must be a number from 0 to 1.');
    const onCpu = () => {
      if (resolved) gradePixels(rgba, width, height, resolved, { seed, rows: [start, end] });
      if (lut) applyLut(rgba, width, height, lut, { amount, rows: [start, end] });
      return rgba;
    };
    const job = queue.then(async () => {
      callSignal?.throwIfAborted?.();
      const idle = (!resolved || isIdentityGrade(resolved)) && !(lut && amount);
      if (idle || start === end) return rgba;
      if (backend !== 'webgpu') return onCpu();
      try { await onGpu(rgba, width, start, end, resolved, seed, lut, amount); }
      catch (error) {
        if (!fallback) throw error;
        cpu(error?.message || 'The graphics card failed.');
        return onCpu();
      }
      callSignal?.throwIfAborted?.();
      return rgba;
    });
    queue = job.catch(() => {});
    return job;
  }

  return Object.freeze({
    get backend() { return backend; },
    get reason() { return reason; },
    run,
    gradePixels: (rgba, width, height, grade = 'original', { seed = 0, rows, signal: s } = {}) => run(rgba, width, height, { grade, seed, rows, signal: s }),
    applyLut: (rgba, width, height, lut, { amount = 1, rows, signal: s } = {}) => run(rgba, width, height, { lut, amount, rows, signal: s }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const buffer of [pixels, readback, decode, encode]) buffer?.destroy?.();
      if (!given) device?.destroy?.();
    },
  });
}
