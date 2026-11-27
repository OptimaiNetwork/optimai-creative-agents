import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { GPU_PIXEL_LIMITS, GPU_PIXEL_SHADER, createGpuPixelProcessor, gpuPixelDispatch, gpuPixelSettings } from '../src/gpu-pixels.mjs';
import { gradePixels, resolveGrade } from '../src/color-grade.mjs';
import { applyLut, filmLut } from '../src/lut.mjs';

function card(width = 48, height = 32) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, s = 7; i < pixels.length; i += 4) { s = (s * 1103515245 + 12345) >>> 0; pixels.set([(i / 4) % width * 5, Math.floor(i / 4 / width) * 8, s >>> 24, 128 + (i % 97)], i); }
  return pixels;
}
const cpu = (pixels, width, height, { grade, seed = 0, lut, amount = 1, rows } = {}) => {
  if (grade) gradePixels(pixels, width, height, grade, { seed, rows });
  if (lut) applyLut(pixels, width, height, lut, { amount, rows });
  return pixels;
};

/**
 * A fake WebGPU device. Its "shader" stands in for the real one: it inverts RGB of every uploaded pixel and
 * keeps alpha, so the test can see exactly which bytes went up, which came back and where they landed.
 */
function fakeGpu({ failSubmit = false, noAdapter = false } = {}) {
  const log = { buffers: [], writes: [], dispatches: [], submits: 0, destroyed: 0, deviceDestroyed: 0, shaders: [] };
  let lose;
  const buffer = ({ size, usage }) => {
    const data = new Uint8Array(size), b = { size, usage, data, destroy() { log.destroyed++; b.gone = true; }, mapAsync: async () => {}, getMappedRange: (offset, length) => data.slice(offset, offset + length).buffer, unmap() {} };
    log.buffers.push(b);
    return b;
  };
  let pending = [];
  const device = {
    lost: new Promise(resolve => { lose = resolve; }),
    queue: {
      writeBuffer(target, offset, source) {
        const bytes = ArrayBuffer.isView(source) ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength) : new Uint8Array(source);
        target.data.set(bytes, offset);
        log.writes.push({ target, bytes: bytes.length });
      },
      submit() { log.submits++; for (const run of pending) run(); pending = []; },
    },
    createBuffer: buffer,
    createShaderModule: ({ code }) => { log.shaders.push(code); return { code }; },
    createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createBindGroup: ({ entries }) => ({ entries }),
    createCommandEncoder() {
      const steps = [];
      return {
        beginComputePass: () => ({ setPipeline() {}, setBindGroup(_, group) { steps.group = group; }, dispatchWorkgroups(x, y) { log.dispatches.push([x, y]); }, end() {} }),
        copyBufferToBuffer(from, fromOffset, to, toOffset, size) {
          const { entries } = steps.group, settings = new Uint32Array(entries[1].resource.buffer.data.buffer.slice(0, 32));
          log.settings = settings; log.tables = entries[2].resource.buffer;
          steps.push(() => {
            for (let i = 0; i < settings[2] * 4; i++) if ((i & 3) !== 3) from.data[i] = 255 - from.data[i];
            to.data.set(from.data.subarray(fromOffset, fromOffset + size), toOffset);
          });
        },
        finish: () => { pending.push(...steps); return {}; },
      };
    },
    pushErrorScope() {},
    popErrorScope: async () => failSubmit ? { message: 'Fake validation failure.' } : null,
    destroy() { log.deviceDestroyed++; },
  };
  const gpu = { requestAdapter: async () => noAdapter ? null : { requestDevice: async () => device } };
  return { gpu, device, log, lose: info => lose(info) };
}
const inverted = (pixels, from = 0, to = pixels.length) => pixels.map((value, i) => i >= from && i < to && (i & 3) !== 3 ? 255 - value : value);

test('without WebGPU the processor runs the CPU functions and gives their exact bytes', async () => {
  const processor = await createGpuPixelProcessor({ gpu: null });
  assert.equal(processor.backend, 'cpu');
  assert.match(processor.reason, /no WebGPU/);
  const cases = [{ grade: 'noir', seed: 9 }, { lut: filmLut('matte'), amount: 0.6 }, { grade: resolveGrade('warm', 0.5), lut: filmLut('golden'), rows: [5, 20] }, { grade: { grain: 1, exposure: 0.4 }, seed: 4294967295 }];
  for (const options of cases) assert.deepEqual(await processor.run(card(), 48, 32, options), cpu(card(), 48, 32, options));
  assert.deepEqual(await processor.gradePixels(card(), 48, 32, 'cool', { seed: 2 }), gradePixels(card(), 48, 32, 'cool', { seed: 2 }), 'gradePixels keeps the CPU arguments.');
  assert.deepEqual(await processor.applyLut(card(), 48, 32, filmLut('teal-amber'), { amount: 0.3 }), applyLut(card(), 48, 32, filmLut('teal-amber'), { amount: 0.3 }), 'applyLut keeps the CPU arguments.');
  const same = card();
  assert.equal(await processor.run(same, 48, 32, { grade: 'punchy' }), same, 'Pixels change in place and the same array comes back.');
  assert.equal((await createGpuPixelProcessor({ gpu: fakeGpu({ noAdapter: true }).gpu })).reason, 'No graphics adapter was offered.');
  await assert.rejects(createGpuPixelProcessor({ gpu: null, fallback: false }), /no WebGPU/, 'fallback: false refuses to start on the CPU.');
});

test('both paths refuse the same calls with the same words, as rejected promises', async () => {
  const processor = await createGpuPixelProcessor({ gpu: null });
  await assert.rejects(processor.run(card(), 0, 32, { grade: 'noir' }), /Grade size must be whole pixels/);
  await assert.rejects(processor.run(new Uint8ClampedArray(8), 48, 32, { lut: filmLut('matte') }), /LUT pixels must be an RGBA/);
  await assert.rejects(processor.run(card(), 48, 32, { grade: 'noir', rows: [4, 40] }), /rows must be a \[start, end\) range/);
  await assert.rejects(processor.run(card(), 48, 32, { grade: 'sepia' }), /supported grade preset/);
  await assert.rejects(processor.run(card(), 48, 32, { grade: 'noir', seed: -1 }), /seed must be a whole number/);
  await assert.rejects(processor.run(card(), 48, 32, { lut: { size: 3 } }), /Use a LUT from/);
  await assert.rejects(processor.run(card(), 48, 32, { lut: filmLut('matte'), amount: 2 }), /amount must be a number from 0 to 1/);
  const aborted = AbortSignal.abort(new Error('Stopped.'));
  await assert.rejects(processor.run(card(), 48, 32, { grade: 'noir', signal: aborted }), /Stopped/);
  processor.destroy();
  await assert.rejects(processor.run(card(), 48, 32, { grade: 'noir' }), /destroyed/);
});

test('the settings block carries the CPU grade numbers, the band and the LUT domain', () => {
  const grade = resolveGrade({ exposure: 1, contrast: 0.5, fade: 0.1, saturation: 1.5, vibrance: -0.5, temperature: 0.5, tint: -0.25, shadowHue: 90, shadowTint: 0.05, highlightHue: 180, highlightTint: 0.1, grain: 0.5 });
  const lut = Object.freeze({ ...filmLut('golden'), domainMin: [0.1, 0, 0], domainMax: [0.9, 1, 2] });
  const { buffer, flags } = gpuPixelSettings({ width: 640, start: 12, count: 6400, grade, seed: 4294967295, lut, amount: 0.25 });
  const words = new Uint32Array(buffer), floats = new Float32Array(buffer);
  assert.equal(buffer.byteLength, 128);
  assert.equal(flags, 7, 'grade, LUT and grain');
  assert.deepEqual([...words.subarray(0, 6)], [640, 12, 6400, 7, 4294967295, 33]);
  const close = (index, value) => assert.ok(Math.abs(floats[index] - value) < 1e-6, `word ${index}: ${floats[index]} ≈ ${value}`);
  [[8, 2], [9, 1], [10, 0.1], [11, 1.5], [12, -0.5], [13, -0.01], [14, 0.02], [15, 0.045], [16, 0], [17, 0.05], [18, -0.1], [19, 0], [20, 0.25], [24, 0.1], [28, 0.9], [30, 2], [31, 1]].forEach(([index, value]) => close(index, value));
  assert.equal(gpuPixelSettings({ width: 4, count: 16, grade: resolveGrade('punchy', 0) }).flags, 0, 'An identity grade does no work.');
  assert.equal(gpuPixelSettings({ width: 4, count: 16, grade: resolveGrade('noir') }).flags, 5, 'Noir carries grain.');
  assert.equal(gpuPixelSettings({ width: 4, count: 16, lut, amount: 0 }).flags, 0, 'Amount 0 skips the LUT.');
});

test('the dispatch grid covers every pixel within the per-dimension limit', () => {
  assert.deepEqual(gpuPixelDispatch(1), [1, 1]);
  assert.deepEqual(gpuPixelDispatch(0), [1, 1]);
  for (const count of [63, 64, 65, 4_194_304, 4_194_305, GPU_PIXEL_LIMITS.pixels]) {
    const [x, y] = gpuPixelDispatch(count);
    assert.ok(x <= GPU_PIXEL_LIMITS.dispatch && y <= GPU_PIXEL_LIMITS.dispatch);
    assert.ok(x * y * GPU_PIXEL_LIMITS.workgroup >= count, `${count} pixels fit`);
    assert.ok((x * (y - 1)) * GPU_PIXEL_LIMITS.workgroup < count, `${count}: no empty row of workgroups`);
  }
});

test('on WebGPU only the band goes up, comes back in place and alpha is kept; buffers are reused', async () => {
  const { gpu, log } = fakeGpu();
  const processor = await createGpuPixelProcessor({ gpu });
  assert.equal(processor.backend, 'webgpu');
  assert.equal(processor.reason, '');
  assert.match(log.shaders[0], /fn main/);
  const pixels = card();
  await processor.run(pixels, 48, 32, { grade: 'noir', seed: 3, rows: [4, 10] });
  assert.deepEqual(pixels, inverted(card(), 4 * 48 * 4, 10 * 48 * 4), 'Rows 4–9 changed; alpha and every other row did not.');
  assert.deepEqual([...log.settings.subarray(0, 5)], [48, 4, 6 * 48, 5, 3]);
  assert.deepEqual(log.dispatches.at(-1), gpuPixelDispatch(6 * 48));
  const before = log.buffers.length;
  const lut = filmLut('matte');
  await processor.run(card(), 48, 32, { lut });
  const lutBuffer = log.tables;
  assert.equal(lutBuffer.size, (256 + lut.table.length) * 4, 'The decode table and the LUT share one buffer.');
  assert.deepEqual(new Float32Array(lutBuffer.data.buffer).subarray(256, 259), lut.table.subarray(0, 3));
  await processor.run(card(), 48, 32, { lut, grade: 'warm' });
  assert.equal(log.tables, lutBuffer, 'A LUT is uploaded once and kept.');
  assert.equal(log.buffers.length, before + 3, 'Pixel and readback buffers are reused; only the LUT and per-run settings are new.');
  const idle = log.submits;
  await processor.run(card(), 48, 32, { grade: 'original', lut, amount: 0 });
  await processor.run(card(), 48, 32, { grade: 'noir', rows: [3, 3] });
  assert.equal(log.submits, idle, 'Nothing to do sends nothing to the graphics card.');
  processor.destroy();
  assert.equal(log.deviceDestroyed, 1, 'A device it opened itself is closed.');
});

test('runs queue in call order, and a shared device is left open', async () => {
  const { device, log } = fakeGpu();
  const processor = await createGpuPixelProcessor({ device });
  const order = [], a = card(), b = card(16, 8);
  await Promise.all([processor.run(a, 48, 32, { grade: 'noir' }).then(() => order.push('a')), processor.run(b, 16, 8, { grade: 'noir' }).then(() => order.push('b'))]);
  assert.deepEqual(order, ['a', 'b']);
  assert.deepEqual(a, inverted(card()));
  assert.deepEqual(b, inverted(card(16, 8)));
  processor.destroy(); processor.destroy();
  assert.equal(log.deviceDestroyed, 0);
});

test('a refused pass or a lost device switches to the CPU with a reason, unless fallback is off', async () => {
  const failing = fakeGpu({ failSubmit: true });
  const processor = await createGpuPixelProcessor({ gpu: failing.gpu });
  assert.equal(processor.backend, 'webgpu');
  assert.deepEqual(await processor.run(card(), 48, 32, { grade: 'cool', lut: filmLut('golden') }), cpu(card(), 48, 32, { grade: 'cool', lut: filmLut('golden') }), 'The CPU redoes the run on untouched pixels.');
  assert.equal(processor.backend, 'cpu');
  assert.equal(processor.reason, 'Fake validation failure.');
  const strict = await createGpuPixelProcessor({ gpu: fakeGpu({ failSubmit: true }).gpu, fallback: false });
  await assert.rejects(strict.run(card(), 48, 32, { grade: 'noir' }), /Fake validation failure/);
  const losing = fakeGpu();
  const lost = await createGpuPixelProcessor({ gpu: losing.gpu });
  losing.lose({ message: 'driver reset' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(lost.backend, 'cpu');
  assert.match(lost.reason, /lost: driver reset/);
  assert.deepEqual(await lost.run(card(), 48, 32, { grade: 'noir' }), cpu(card(), 48, 32, { grade: 'noir' }));
});

test('the shader uses the same color math as the CPU grade (drift guard)', () => {
  const source = readFileSync(new URL('../src/color-grade.mjs', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('function gradeFunction'), source.indexOf('const checkSeed'));
  const constants = [...new Set(body.match(/\d+\.\d{6,}/g))];
  assert.ok(constants.length >= 27, 'The OKLab matrices are found.');
  for (const constant of constants) assert.ok(GPU_PIXEL_SHADER.includes(constant), `shader has ${constant}`);
  for (const hex of ['0x27d4eb2d', '0x165667b1', '0x85ebca6b', '0xc2b2ae35', '0x9e3779b9']) assert.ok(source.includes(hex) && GPU_PIXEL_SHADER.includes(hex), `grain hash ${hex}`);
  for (const binding of [0, 1, 2, 3]) assert.match(GPU_PIXEL_SHADER, new RegExp(`@binding\\(${binding}\\)`));
  assert.match(GPU_PIXEL_SHADER, /@workgroup_size\(64\)/);
});
