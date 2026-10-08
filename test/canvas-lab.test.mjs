import assert from 'node:assert/strict';
import test from 'node:test';
import { CANVAS_LAB_AGENTS, canvasLabSettings, runCanvasLab } from '../src/canvas-lab.mjs';

const image = (name = 'local.png', bytes = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]) => new File([new Uint8Array(bytes)], name, { type: 'image/png' });
const tick = () => new Promise(resolve => setImmediate(resolve));

async function canvasHarness(run, options = {}) {
  const previous = Object.fromEntries(['document', 'createImageBitmap', 'fetch'].map(key => [key, globalThis[key]]));
  const calls = { canvases: [], bitmaps: [], draw: [], text: [], network: 0 };
  const dimensions = new WeakMap();
  const bitmap = (width = 600, height = 300) => {
    const value = { width, height, closed: 0, close() { this.closed++; } };
    calls.bitmaps.push(value); return value;
  };
  globalThis.createImageBitmap = async file => {
    if (!(file instanceof File) && options.decode) return options.decode(file, bitmap);
    const size = dimensions.get(file) ?? { width: 600, height: 300 };
    return bitmap(size.width, size.height);
  };
  globalThis.fetch = () => { calls.network++; throw new Error('Canvas processing must not make network requests.'); };
  globalThis.document = { createElement(name) {
    assert.equal(name, 'canvas', 'No HTML or script nodes may be created.');
    const canvas = { width: 0, height: 0 };
    const context = {
      globalAlpha: 1, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, roundRect() {}, fill() {}, fillRect() {}, strokeRect() {},
      createLinearGradient() { return { addColorStop() {} }; },
      drawImage(...args) {
        calls.draw.push({ canvas, alpha: this.globalAlpha, args });
        if (options.draw) options.draw(canvas, args, calls);
      },
      measureText(text) { return { width: text.length * Number(this.font?.match(/(\d+)px/)?.[1] || 10) * .6 }; },
      fillText(...args) { calls.text.push({ canvas, args }); },
    };
    canvas.getContext = () => options.context ? options.context(canvas, context, calls) : context;
    canvas.toBlob = callback => {
      if (options.export && canvas.width === 1200) return options.export(callback, canvas);
      const result = new Blob(['generated PNG fixture'], { type: 'image/png' });
      dimensions.set(result, { width: canvas.width, height: canvas.height }); callback(result);
    };
    calls.canvases.push(canvas); return canvas;
  } };
  try { await run({ calls, bitmap }); }
  finally { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
}

test('canvas settings accept only bounded operations, colors, titles, mixes and dimensions', () => {
  assert.equal(Object.isFrozen(CANVAS_LAB_AGENTS), true);
  assert.equal(new Set(Object.values(CANVAS_LAB_AGENTS)).size, 7);
  for (const operation of Object.values(CANVAS_LAB_AGENTS)) assert.equal(canvasLabSettings(operation).operation, operation);
  for (const [operation, values, pattern] of [
    ['remote-script', {}, /supported canvas operation/], ['poster', { title: ' ' }, /title/],
    ['poster', { title: 'x'.repeat(181) }, /180/], ['poster', { color: 'url(https://example.test)' }, /hex color/],
    ['mockup', { layout: 'remote' }, /layout/], ['poster', { ratio: '100:1' }, /ratio/],
    ['poster', { treatment: 'untrusted' }, /treatment/], ['blend', { mix: Infinity }, /mix/],
    ['glitch', { amount: -1 }, /amount/], ['blend', { mix: 101 }, /mix/],
  ]) assert.throws(() => canvasLabSettings(operation, values), pattern);
  assert.equal(canvasLabSettings('blend', { mix: '25' }).mix, 25);
});

test('all seven compositions export actual canvas work with bounded dimensions and release every bitmap', async () => canvasHarness(async h => {
  for (const operation of Object.values(CANVAS_LAB_AGENTS)) {
    const files = operation === 'bento' ? Array.from({ length: 8 }, () => image()) : ['blend', 'transition'].includes(operation) ? [image(), image()] : ['poster', 'letter'].includes(operation) ? [] : [image()];
    const result = await runCanvasLab(operation, files, { title: 'Local creative work', ratio: '9:16' });
    assert.deepEqual([result.width, result.height], [1200, 2133]);
    assert.equal(result.blob.type, 'image/png');
    assert.equal(result.filename, `optimai-${operation}.png`);
    assert.ok(result.blob.size > 0);
  }
  assert.equal(h.calls.bitmaps.length, 28);
  assert.ok(h.calls.bitmaps.every(value => value.closed === 1));
  assert.ok(h.calls.canvases.every(value => value.width <= 1 && value.height <= 1));
  assert.equal(h.calls.network, 0);
  assert.ok(h.calls.draw.length > 35, 'Compositions draw selected images and glitch bands.');
  assert.ok(h.calls.text.map(value => value.args[0]).join(' ').includes('Local creative work'));
}));

test('reference blend respects selected image order and requested mix instead of a fixed placeholder', async () => canvasHarness(async h => {
  await runCanvasLab('blend', [image('first.png'), image('second.png')], { mix: 30 });
  const composition = h.calls.draw.filter(value => value.canvas === h.calls.canvases.at(-1));
  assert.equal(composition.length, 2);
  assert.deepEqual(composition.map(value => value.alpha), [1, .3]);
  assert.equal(composition[0].args[0], h.calls.bitmaps[1]);
  assert.equal(composition[1].args[0], h.calls.bitmaps[3]);
  assert.deepEqual(composition[0].args.slice(1), [-900, 0, 3000, 1500]);
}));

test('canvas input limits reject remote URLs, disguised files and excessive image counts', async () => canvasHarness(async h => {
  await assert.rejects(runCanvasLab('mockup', ['https://example.test/image.png']), /Remote URLs/);
  await assert.rejects(runCanvasLab('mockup', [image('fake.png', [1, 2, 3])]), /does not match/);
  await assert.rejects(runCanvasLab('bento', Array.from({ length: 9 }, () => image())), /up to 8/);
  await assert.rejects(runCanvasLab('blend', [image()]), /two images/);
  await assert.rejects(runCanvasLab('mockup', []), /Add an image/);
  assert.equal(h.calls.bitmaps.length, 0);
  assert.equal(h.calls.canvases.length, 0);
}));

test('untrusted title markup remains plain pixels and every ratio has a bounded export', async () => canvasHarness(async h => {
  for (const [ratio, height] of [['1:1', 1200], ['4:5', 1500], ['16:9', 675], ['9:16', 2133]]) {
    const result = await runCanvasLab('letter', [], { ratio, title: '<script>alert(1)</script>' });
    assert.equal(result.height, height);
  }
  assert.ok(h.calls.text.some(value => value.args[0] === '<script>alert(1)</script>'));
  assert.equal(h.calls.network, 0);
}));

test('normalized image dimensions and their combined retained pixel budget are enforced', async () => {
  await canvasHarness(async h => {
    await assert.rejects(runCanvasLab('bento', Array.from({ length: 5 }, () => image())), /Together.*16 million pixels/);
    assert.equal(h.calls.bitmaps.length, 10);
    assert.ok(h.calls.bitmaps.every(value => value.closed === 1));
  }, { decode: (file, bitmap) => bitmap(4000, 1000) });
  await canvasHarness(async h => {
    await assert.rejects(runCanvasLab('mockup', [image()]), /4096/);
    assert.ok(h.calls.bitmaps.every(value => value.closed === 1));
  }, { decode: (file, bitmap) => bitmap(5000, 10) });
});

test('abort during normalized image decode returns promptly and disposes a late bitmap', { timeout: 1500 }, async () => {
  let complete;
  await canvasHarness(async h => {
    const controller = new AbortController();
    const running = runCanvasLab('mockup', [image()], {}, controller.signal);
    await tick(); controller.abort();
    await assert.rejects(running, { name: 'AbortError' });
    complete(h.bitmap()); await tick();
    assert.ok(h.calls.bitmaps.every(value => value.closed === 1));
    assert.equal(h.calls.canvases.length, 1, 'No composition is allocated after cancellation.');
  }, { decode: () => new Promise(resolve => { complete = resolve; }) });
});

test('abort during PNG export releases the composition even if a browser never calls back', { timeout: 1500 }, async () => canvasHarness(async h => {
  const controller = new AbortController();
  const running = runCanvasLab('mockup', [image()], {}, controller.signal);
  await tick(); controller.abort();
  await assert.rejects(running, { name: 'AbortError' });
  assert.ok(h.calls.bitmaps.every(value => value.closed === 1));
  assert.ok(h.calls.canvases.every(value => value.width <= 1 && value.height <= 1));
}, { export() {} }));

test('glitch drawing failure and missing contexts release temporary canvas buffers', async () => {
  await canvasHarness(async h => {
    await assert.rejects(runCanvasLab('glitch', [image()]), /drawing failed/);
    assert.equal(h.calls.canvases.length, 3);
    assert.ok(h.calls.canvases.every(value => value.width <= 1 && value.height <= 1));
    assert.ok(h.calls.bitmaps.every(value => value.closed === 1));
  }, { draw: (canvas, args, calls) => { if (calls.canvases.indexOf(canvas) === 2) throw new Error('drawing failed'); } });
  await canvasHarness(async h => {
    await assert.rejects(runCanvasLab('glitch', [image()]), /glitch canvas/);
    assert.ok(h.calls.canvases.every(value => value.width <= 1 && value.height <= 1));
  }, { context: (canvas, context, calls) => calls.canvases.indexOf(canvas) === 2 ? null : context });
});

test('empty or oversized exports fail safely and an already aborted run opens nothing', async () => {
  for (const output of [null, new Blob([new Uint8Array(20 * 1024 * 1024 + 1)])]) {
    await canvasHarness(async h => {
      await assert.rejects(runCanvasLab('mockup', [image()]), /export.*canvas|exported image is too large/i);
      assert.ok(h.calls.bitmaps.every(value => value.closed === 1));
      assert.ok(h.calls.canvases.every(value => value.width <= 1 && value.height <= 1));
    }, { export: callback => callback(output) });
  }
  await canvasHarness(async h => {
    const controller = new AbortController(); controller.abort();
    await assert.rejects(runCanvasLab('mockup', [image()], {}, controller.signal), { name: 'AbortError' });
    assert.equal(h.calls.canvases.length, 0); assert.equal(h.calls.bitmaps.length, 0);
  });
});
