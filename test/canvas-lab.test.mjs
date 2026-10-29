import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { AGENT_CATALOG } from '../src/index.mjs';
import { CANVAS_LAB_AGENTS, canvasLabRecipeSettings, canvasLabSettings, runCanvasLab } from '../src/canvas-lab.mjs';
import { contrastRatio, toOklch } from '../src/color.mjs';
import { fitTitle } from '../src/typeset.mjs';
import { planGlitch } from '../src/glitch.mjs';

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
  assert.equal(new Set(Object.values(CANVAS_LAB_AGENTS)).size, 8);
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
test('composition dispatch follows public catalog descriptors, with supported operations owned by the engine', () => {
  const operations = new Set(['mockup', 'poster', 'bento', 'glitch', 'letter', 'blend', 'transition', 'print']);
  assert.deepEqual(CANVAS_LAB_AGENTS, Object.fromEntries(AGENT_CATALOG.filter(agent => agent.workspace.kind === 'canvas' && operations.has(agent.workspace.operation)).map(agent => [agent.id, agent.workspace.operation])));
  assert.throws(() => canvasLabRecipeSettings('image-finish'), /composition template/);
  assert.throws(() => canvasLabRecipeSettings('unknown'), /composition template/);
});
test('portable canvas settings preserve legacy aliases and respect explicit canonical values', () => {
  assert.equal(canvasLabRecipeSettings('poster-lab', { format: 'square cover' }).ratio, '1:1');
  assert.equal(canvasLabRecipeSettings('poster-lab', { format: 'square cover', ratio: '16:9' }).ratio, '16:9');
  assert.equal(canvasLabRecipeSettings('poster-lab', { style: 'cinematic' }).treatment, 'cinema');
  assert.equal(canvasLabRecipeSettings('poster-lab', { style: 'cinematic', treatment: 'minimal' }).treatment, 'minimal');
  assert.equal(canvasLabRecipeSettings('poster-lab', { color: '#abc' }).color, '#aabbcc');
  assert.equal(canvasLabRecipeSettings('letter-pose', { text: 'LEGACY LETTERS' }).title, 'LEGACY LETTERS');
  assert.equal(canvasLabRecipeSettings('letter-pose', { text: 'OLD', title: 'NEW' }).title, 'NEW');
  assert.equal(canvasLabRecipeSettings('pixel-layout', { layout: 'four panels' }).layout, 'phone');
  assert.equal(canvasLabRecipeSettings('mockup-maker', { layout: 'gallery', ratio: 'original' }).layout, 'gallery');
  assert.equal(canvasLabRecipeSettings('mockup-maker', { ratio: 'original' }).ratio, '4:5');
  assert.equal(canvasLabRecipeSettings('glitch-cut', { intensity: 'medium' }).amount, 60);
  assert.equal(canvasLabRecipeSettings('glitch-cut', { intensity: 'medium', amount: 10 }).amount, 10);
  assert.equal(canvasLabRecipeSettings('reference-blend', { mix: 23 }).mix, 23);
  assert.equal(canvasLabRecipeSettings('transition-lab', { mix: 75 }).mix, 75);
  assert.throws(() => canvasLabRecipeSettings('poster-lab', { workerUrl: 'https://example.test' }), /no such setting/);
  assert.throws(() => canvasLabRecipeSettings('glitch-cut', { amount: 101 }), /whole number/);
});
test('saved recipe composition settings reach rendered dimensions and actual lettering', async () => canvasHarness(async h => {
  const settings = canvasLabRecipeSettings('poster-lab', { format: 'wide banner', title: 'A saved creative direction', color: '#ace', style: 'cinematic' });
  const output = await runCanvasLab(settings.operation, [], settings);
  assert.deepEqual([output.width, output.height], [1200, 675]);
  assert.ok(h.calls.text.map(call => call.args[0]).join(' ').includes('A saved creative direction'));
  assert.equal(h.calls.network, 0);
}));

test('all eight compositions export actual canvas work with bounded dimensions and release every bitmap', async () => canvasHarness(async h => {
  for (const operation of Object.values(CANVAS_LAB_AGENTS)) {
    const files = operation === 'bento' ? Array.from({ length: 8 }, () => image()) : ['blend', 'transition'].includes(operation) ? [image(), image()] : ['poster', 'letter'].includes(operation) ? [] : [image()];
    // A print is made of pixels: without pixel reads it refuses rather than passing the plain image off as a print.
    if (operation === 'print') { await assert.rejects(runCanvasLab(operation, files, { ratio: '9:16' }), /cannot read canvas pixels/); continue; }
    const result = await runCanvasLab(operation, files, { title: 'Local creative work', ratio: '9:16' });
    assert.deepEqual([result.width, result.height], [1200, 2133]);
    assert.equal(result.blob.type, 'image/png');
    assert.equal(result.filename, `optimai-${operation}.png`);
    assert.ok(result.blob.size > 0);
  }
  assert.equal(h.calls.bitmaps.length, 30);
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

test('compositions crop each image toward its subject, and crop: center opts out', async () => {
  const previous = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = class {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() { return { drawImage() {}, getImageData(x, y, width, height) {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let index = 0; index < width * height; index++) data.set(index % width < width * .14 ? (index % 3 ? [240, 80, 50, 255] : [250, 220, 90, 255]) : [120, 124, 122, 255], index * 4);
      return { data };
    } }; }
  };
  try {
    assert.equal(canvasLabSettings('poster').crop, 'smart');
    assert.throws(() => canvasLabSettings('poster', { crop: 'faces' }), /supported crop/);
    await canvasHarness(async h => {
      await runCanvasLab('poster', [image()], { ratio: '1:1' });
      const focused = h.calls.draw.filter(call => call.canvas === h.calls.canvases.at(-1));
      assert.equal(focused[0].args.length, 9);
      assert.equal(focused[0].args[1], 0, 'A left-hand subject keeps the crop at the left edge.');
      await runCanvasLab('poster', [image()], { ratio: '1:1', crop: 'center' });
      assert.equal(h.calls.draw.filter(call => call.canvas === h.calls.canvases.at(-1))[0].args.length, 5);
      assert.ok(h.calls.bitmaps.every(value => value.closed === 1));
    });
  } finally { if (previous === undefined) delete globalThis.OffscreenCanvas; else globalThis.OffscreenCanvas = previous; }
});
test('poster and letter titles stay readable over bright images, take an image accent on request, and ink: exact opts out', async () => {
  const previous = globalThis.OffscreenCanvas;
  // Thumbnails of the composition read as a bright sky; thumbnails of the source photo read as a blue scene.
  globalThis.OffscreenCanvas = class {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() { let source; return { drawImage(value) { source = value; }, getImageData(x, y, width, height) {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let index = 0; index < width * height; index++) data.set(source?.close ? (index % 4 ? [36, 82, 196, 255] : [240, 236, 228, 255]) : (index % 3 ? [236, 240, 244, 255] : [214, 222, 230, 255]), index * 4);
      return { data };
    } }; }
  };
  try {
    assert.equal(canvasLabSettings('poster').ink, 'readable');
    assert.equal(canvasLabRecipeSettings('poster-lab').ink, 'readable', 'Saved recipes get readable ink without a new recipe field.');
    assert.throws(() => canvasLabSettings('poster', { ink: 'random' }), /supported ink/);
    await canvasHarness(async () => {
      const readable = await runCanvasLab('letter', [image()], { color: '#c6f87d', scrim: 'off' });
      assert.notEqual(readable.ink, '#c6f87d');
      assert.ok(['#ecf0f4', '#d6dee6'].every(sky => contrastRatio(readable.ink, sky) >= 3), 'At least 3:1 over every sky colour.');
      assert.ok(Math.abs(toOklch(readable.ink)[2] - toOklch('#c6f87d')[2]) < 4, 'The chosen hue is kept.');
      const accent = await runCanvasLab('poster', [image()], { color: '#c6f87d', ink: 'image' });
      assert.ok(Math.abs(toOklch(accent.ink)[2] - toOklch('#2452c4')[2]) < 4, 'Image ink takes the photo’s blue.');
      assert.equal((await runCanvasLab('poster', [image()], { color: '#c6f87d', ink: 'exact' })).ink, '#c6f87d');
      const blank = await runCanvasLab('poster', [], { color: '#c6f87d', ink: 'image' });
      assert.ok(Math.abs(toOklch(blank.ink)[2] - toOklch('#c6f87d')[2]) < 4, 'Without an image, image ink tunes the chosen color.');
    });
  } finally { if (previous === undefined) delete globalThis.OffscreenCanvas; else globalThis.OffscreenCanvas = previous; }
  await canvasHarness(async () => {
    assert.equal((await runCanvasLab('poster', [], { color: '#abcdef' })).ink, '#abcdef', 'Without pixel reads the chosen color is drawn unchanged.');
  });
});
test('poster and letter titles break into balanced lines with optical tracking and leading', async () => {
  const spacing = [];
  await canvasHarness(async h => {
    const title = 'The quiet studio on every device';
    const poster = await runCanvasLab('poster', [], { title, ink: 'exact' });
    const layout = fitTitle(title, { measure: (text, size) => text.length * size * .6, width: 984, height: 975, maxSize: 150, minSize: 16, maxLines: 6 });
    assert.deepEqual(poster.lines, ['The quiet', 'studio', 'on every', 'device'], 'No lone short word left at the end of a line.');
    assert.deepEqual(poster.lines, layout.lines);
    const drawn = h.calls.text.filter(call => poster.lines.includes(call.args[0]));
    assert.deepEqual(drawn.map(call => call.args[0]), poster.lines);
    drawn.slice(1).forEach((call, index) => assert.ok(Math.abs(call.args[2] - drawn[index].args[2] - layout.lineHeight) < 1e-9, 'Optical leading between lines.'));
    assert.ok(drawn.every(call => call.args[3] === 1200 * .86), 'Lines are bounded to the frame.');
    assert.deepEqual(spacing.slice(0, 2), [`${layout.tracking}px`, '0px'], 'Tracking for the title only, reset for the credit line.');
    const letter = await runCanvasLab('letter', [], { title: 'MAKE SOMETHING\nREMARKABLE.', ink: 'exact' });
    assert.deepEqual(letter.lines, ['MAKE', 'SOMETHING', 'REMARKABLE.'], 'Hard breaks are kept.');
    const long = await runCanvasLab('poster', [], { title: Array(30).fill('word').join(' '), ink: 'exact' });
    assert.ok(long.lines.length <= 6 && long.lines.join(' ').split(' ').length === 30, 'Long titles shrink instead of losing words.');
  }, { context: (canvas, context) => Object.defineProperty(context, 'letterSpacing', { configurable: true, get: () => spacing.at(-1) ?? '0px', set: value => { if (value !== '0px' || spacing.length) spacing.push(value); } }) });
});
test('poster and letter titles move to the calmest part of the image, keep white ink behind a scrim, and fixed positions keep the classic layout', async () => {
  const previous = globalThis.OffscreenCanvas;
  // Focus thumbnails (≤96 px) show a busy subject in the lower half; colour thumbnails (≤64 px) read as a bright sky.
  globalThis.OffscreenCanvas = class {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() { const thumb = this; return { drawImage() {}, getImageData(x, y, width, height) {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let index = 0; index < width * height; index++) {
        const row = Math.floor(index / width), focus = Math.max(thumb.width, thumb.height) > 64;
        data.set(focus ? (row > height * .55 ? (index % 3 ? [236, 78, 52, 255] : [252, 214, 96, 255]) : [118, 124, 120, 255]) : (index % 3 ? [236, 240, 244, 255] : [214, 222, 230, 255]), index * 4);
      }
      return { data };
    } }; }
  };
  try {
    assert.equal(canvasLabSettings('poster').position, 'auto');
    assert.equal(canvasLabRecipeSettings('poster-lab').position, 'auto', 'Saved recipes get auto placement without a new recipe field.');
    assert.equal(canvasLabSettings('letter').scrim, 'auto');
    assert.throws(() => canvasLabSettings('poster', { position: 'left' }), /supported position/);
    assert.throws(() => canvasLabSettings('poster', { scrim: 'always' }), /supported scrim/);
    const fills = [];
    await canvasHarness(async h => {
      const title = 'A new beginning';
      const auto = await runCanvasLab('poster', [image()], { title, color: '#ffffff' });
      assert.equal(auto.placement.moved, true);
      assert.notEqual(auto.placement.position, 'bottom');
      const first = h.calls.text.find(call => call.args[0] === auto.lines[0]);
      assert.equal(Math.round(first.args[2]), auto.placement.y, 'The first line is drawn where the block was placed.');
      assert.ok(auto.placement.y < 1500 * .55, 'The title sits above the subject.');
      assert.equal(auto.ink, '#ffffff', 'White stays white…');
      assert.equal(auto.scrim.color, '#000000', '…over a black scrim.');
      assert.ok(auto.scrim.opacity > 0 && auto.scrim.opacity <= .6);
      assert.ok(fills.some(fill => fill.startsWith('rgba(0, 0, 0, ')), 'The scrim is painted.');
      const mark = h.calls.text.length;
      const fixed = await runCanvasLab('poster', [image()], { title, color: '#ffffff', position: 'bottom' });
      const layout = fitTitle(title, { measure: (text, size) => text.length * size * .6, width: 984, height: 975, maxSize: 150, minSize: 16, maxLines: 6 });
      assert.equal(h.calls.text.slice(mark).find(call => call.args[0] === fixed.lines[0]).args[2], 1500 * .88 - layout.height, 'position: bottom is the classic poster layout.');
      assert.deepEqual([fixed.placement.position, fixed.placement.x, fixed.placement.moved], ['bottom', 96, false]);
      const off = await runCanvasLab('letter', [image()], { title, color: '#ffffff', scrim: 'off' });
      assert.equal(off.scrim, null); assert.notEqual(off.ink, '#ffffff', 'With the scrim off the ink moves instead, as before.');
      const exact = await runCanvasLab('poster', [image()], { title, color: '#ffffff', ink: 'exact' });
      assert.deepEqual([exact.ink, exact.scrim], ['#ffffff', null]);
    }, { context: (canvas, context) => ({ ...context, fill() { fills.push(this.fillStyle); }, drawImage: context.drawImage, fillText: context.fillText, measureText: context.measureText }) });
  } finally { if (previous === undefined) delete globalThis.OffscreenCanvas; else globalThis.OffscreenCanvas = previous; }
  await canvasHarness(async () => {
    const blank = await runCanvasLab('letter', [], { color: '#c6f87d' });
    assert.deepEqual([blank.placement.position, blank.placement.moved, blank.scrim], ['center', false, null], 'A blank artboard keeps the classic centred letter.');
  });
});

// A 2D context with pixel reads: each canvas holds the level of the shot drawn on it last (40 for the first, 220 for the second;
// each two-image run decodes four bitmaps, and the second and fourth are the shots).
const pixelContext = (canvas, context, calls) => Object.assign(context, {
  drawImage(source, ...args) { calls.draw.push({ canvas, alpha: this.globalAlpha, args: [source, ...args] }); const shot = calls.bitmaps.indexOf(source) % 4; canvas.level = shot === 1 ? 40 : shot === 3 ? 220 : source.level ?? 0; },
  getImageData(x, y, width, height) { return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(canvas.level ?? 0) }; },
  createImageData(width, height) { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; },
  putImageData(image, x, y) { (calls.put ??= []).push({ canvas, image, x, y }); },
});
test('Transition Lab draws real wipes, irises, light keys and pushes with a strip of the whole move', async () => canvasHarness(async h => {
  const pair = () => [image('first.png'), image('second.png')];
  const radial = await runCanvasLab('transition', pair(), canvasLabRecipeSettings('transition-lab', { ratio: '1:1', mix: 50 }));
  assert.deepEqual(radial.transition, { style: 'radial', direction: 'right', pace: 'quick', progress: 0.5 }, 'the template defaults: match cut, quick, the middle frame');
  const frame = h.calls.put.find(call => call.image.width === 1200).image, level = (x, y) => frame.data[(y * 1200 + x) * 4];
  assert.deepEqual([level(600, 600), level(0, 0)], [220, 40], 'the iris shows the second shot at the centre and the first in the corner');
  assert.deepEqual(radial.strip.frames, [0, 25, 50, 75, 100]);
  assert.equal(radial.strip.blob.type, 'image/png');
  const thumbs = h.calls.put.filter(call => call.image.width !== 1200);
  assert.equal(thumbs.length, 5);
  assert.deepEqual([radial.strip.width, radial.strip.height], [12 + 5 * (thumbs[0].image.width + 12), thumbs[0].image.height + 24]);
  assert.deepEqual([thumbs[0].image.data[0], thumbs[4].image.data[0]], [40, 220], 'the strip runs from the first shot to the second');
  assert.ok(thumbs.every((call, index) => call.x === 12 + index * (call.image.width + 12) && call.y === 12));

  h.calls.put = [];
  const wipe = await runCanvasLab('transition', pair(), canvasLabRecipeSettings('transition-lab', { transition: 'light wipe', ratio: '16:9', mix: 30 }));
  assert.deepEqual(wipe.transition, { style: 'wipe', direction: 'right', pace: 'quick', progress: 0.216 }, 'time is eased in and out');
  const wide = h.calls.put.find(call => call.image.width === 1200).image;
  assert.deepEqual([wide.data[0], wide.data[(1199) * 4]], [220, 40], 'a rightward wipe reveals the second shot from the left');
  assert.equal(canvasLabRecipeSettings('transition-lab', { transition: 'camera move' }).transition, 'push');
  assert.equal(canvasLabRecipeSettings('transition-lab', { transition: 'morph' }).transition, 'luma');
  assert.equal(canvasLabRecipeSettings('transition-lab', { pace: 'slow cinematic' }).pace, 'slow cinematic');

  const still = await runCanvasLab('transition', pair(), { transition: 'push', direction: 'up', frames: 0, mix: 100 });
  assert.equal(still.strip, null);
  assert.equal(still.transition.progress, 1);
  assert.ok(h.calls.bitmaps.every(value => value.closed === 1));
  assert.ok(h.calls.canvases.every(value => value.width <= 1 && value.height <= 1), 'thumbnail and strip canvases are released');
  assert.equal(h.calls.network, 0);
}, { context: pixelContext }));

test('a dissolve, or a canvas without pixel reads, crossfades at the eased time and says what it drew', async () => {
  await canvasHarness(async h => {
    const output = await runCanvasLab('transition', [image(), image()], { transition: 'wipe', mix: 25 });
    assert.deepEqual(output.transition, { style: 'dissolve', requested: 'wipe', direction: 'right', pace: 'gentle', progress: 0.156 });
    assert.equal(output.strip, null);
    const composition = h.calls.draw.filter(value => value.canvas === h.calls.canvases.at(-1));
    assert.deepEqual(composition.map(value => value.alpha), [1, 0.15625]);
  });
  await canvasHarness(async h => {
    const output = await runCanvasLab('transition', [image(), image()], { transition: 'dissolve', mix: 50, frames: 0 });
    assert.deepEqual(output.transition, { style: 'dissolve', direction: 'right', pace: 'gentle', progress: 0.5 });
    assert.equal(h.calls.put, undefined, 'a dissolve needs no pixel reads');
  }, { context: pixelContext });
  const blend = await new Promise(resolve => canvasHarness(async () => resolve(await runCanvasLab('blend', [image(), image()], { mix: 40 }))));
  assert.equal(blend.transition, undefined, 'Reference Blend is unchanged');
  for (const [values, pattern] of [[{ frames: 1 }, /frames/], [{ frames: 13 }, /frames/], [{ frames: 2.5 }, /frames/], [{ transition: '__proto__' }, /transition/], [{ transition: 'teleport' }, /transition/], [{ direction: 'north' }, /direction/], [{ pace: 'rapid' }, /pace/]]) {
    assert.throws(() => canvasLabSettings('transition', values), pattern);
  }
});

test('Glitch Cut draws a seeded glitch that a saved recipe reproduces exactly', async () => canvasHarness(async h => {
  const settings = canvasLabRecipeSettings('glitch-cut', { effect: 'colour trails', amount: 60, seed: 4242 });
  assert.deepEqual([settings.effect, settings.amount, settings.seed], ['trails', 60, 4242]);
  assert.deepEqual([canvasLabRecipeSettings('glitch-cut').effect, canvasLabRecipeSettings('glitch-cut').seed], ['blocks', 1], 'v1 recipes keep working with the defaults');
  assert.equal(canvasLabRecipeSettings('glitch-cut', { intensity: 'medium' }).amount, 60);
  assert.throws(() => canvasLabRecipeSettings('glitch-cut', { seed: 1_000_000 }), /whole number/);
  assert.throws(() => canvasLabSettings('glitch', { seed: 2.5 }), /seed/);
  assert.throws(() => canvasLabSettings('glitch', { effect: 'melt' }), /supported effect/);
  const first = await runCanvasLab('glitch', [image()], settings);
  assert.deepEqual(first.glitch, { effect: 'trails', seed: 4242, amount: 60, engine: 'pixels' });
  // Each run starts from the same decoded shot (the harness keys shot levels on bitmap order).
  const frame = () => { const data = h.calls.put.find(call => call.image.width === 1200).image.data; h.calls.put = []; assert.ok(h.calls.bitmaps.every(value => value.closed === 1)); h.calls.bitmaps.length = 0; return data; };
  const sum = data => createHash('sha256').update(data).digest('hex');
  const drawn = frame();
  await runCanvasLab('glitch', [image()], settings);
  assert.equal(sum(frame()), sum(drawn), 'the same seed, the same bytes');
  const plan = planGlitch(1200, 1500, settings), level = y => drawn[(y * 1200 + 600) * 4 + 1];
  assert.ok(level(0) < level(plan.scanlines.period - 1), 'scanlines darken alternate rows');
  await runCanvasLab('glitch', [image()], { ...settings, amount: 0 });
  const untouched = frame();
  assert.ok(untouched.every((value, index) => index % 4 === 3 || value === untouched[0]), 'amount 0 leaves the image as it was');
  assert.ok(h.calls.bitmaps.every(value => value.closed === 1));
  assert.equal(h.calls.network, 0);
}, { context: pixelContext }));

test('without pixel reads Glitch Cut still shifts the seeded bands', async () => canvasHarness(async h => {
  const output = await runCanvasLab('glitch', [image()], { effect: 'blocks', amount: 50, seed: 77 });
  assert.deepEqual(output.glitch, { effect: 'blocks', seed: 77, amount: 50, engine: 'bands' });
  const plan = planGlitch(1200, 1500, { effect: 'blocks', amount: 50, seed: 77 }), main = h.calls.canvases.find(canvas => canvas.width <= 1 && h.calls.draw.some(call => call.canvas === canvas && call.args.length === 9));
  const bands = h.calls.draw.filter(call => call.canvas === main && call.args.length === 9);
  assert.deepEqual(bands.map(call => [call.args[2], call.args[4], call.args[5], call.args[6]]), plan.bands.map(band => [band.y, band.height, band.shift, band.y]));
}));

test('Print Shop prints a saved recipe on paper and reproduces its grain from the seed', async () => canvasHarness(async h => {
  const settings = canvasLabRecipeSettings('print-shop', { look: 'halftone dots', scale: 5, seed: 31 });
  assert.deepEqual([settings.operation, settings.look, settings.scale, settings.seed, settings.amount, settings.color, settings.inks], ['print', 'halftone', 5, 31, 100, '#1f2433', 'pink + blue']);
  const defaults = canvasLabRecipeSettings('print-shop');
  assert.deepEqual([defaults.look, defaults.scale, defaults.amount, defaults.seed, defaults.ratio], ['riso', 3, 100, 1, '4:5'], 'the template defaults');
  assert.equal(canvasLabSettings('print').color, '#1f2433', 'a print inks in navy, not the poster lime');
  assert.equal(canvasLabSettings('poster').color, '#c6f87d');
  for (const [values, pattern] of [[{ look: 'screenprint' }, /look/], [{ look: 'constructor' }, /look/], [{ inks: 'gold' }, /inks/], [{ scale: 13 }, /scale/], [{ scale: 1.5 }, /scale/]]) assert.throws(() => canvasLabSettings('print', values), pattern);
  assert.throws(() => canvasLabRecipeSettings('print-shop', { inks: 'green + gold' }), /choose/i);

  // Each run starts from the same decoded shot (the harness keys shot levels on bitmap order).
  const frame = () => { const data = h.calls.put.find(call => call.image.width === 1200).image.data; h.calls.put = []; assert.ok(h.calls.bitmaps.every(value => value.closed === 1)); h.calls.bitmaps.length = 0; return data; };
  const output = await runCanvasLab('print', [image()], { ...defaults, inks: 'orange + teal', seed: 9 });
  assert.deepEqual(output.print, { look: 'riso', scale: 3, amount: 100, seed: 9, inks: ['#ff6c2f', '#00838a'], paper: '#f4efe6' });
  assert.equal(output.filename, 'optimai-print.png');
  const sum = data => createHash('sha256').update(data).digest('hex'), riso = sum(frame());
  await runCanvasLab('print', [image()], { ...defaults, inks: 'orange + teal', seed: 9 });
  assert.equal(sum(frame()), riso, 'the same recipe, the same bytes');
  const mono = await runCanvasLab('print', [image()], { ...settings, color: '#102030' });
  assert.deepEqual(mono.print, { look: 'halftone', scale: 5, amount: 100, seed: 31, ink: '#102030', paper: '#f4efe6' });
  assert.ok(frame().some((value, index) => index % 4 === 0 && value === 0xf4), 'paper shows between the dots');
  await runCanvasLab('print', [image()], { ...settings, amount: 0 });
  const untouched = frame();
  assert.ok(untouched.every((value, index) => index % 4 === 3 || value === untouched[0]), 'amount 0 leaves the image as it was');
  assert.ok(h.calls.canvases.every(value => value.width <= 1 && value.height <= 1));
  assert.equal(h.calls.network, 0);
}, { context: pixelContext }));
