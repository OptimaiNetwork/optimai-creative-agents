import assert from 'node:assert/strict';
import test from 'node:test';
import * as runtime from '../src/browser-runtime.mjs';

const image = (name = 'test.png', bytes = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0], type = 'image/png') => new File([new Uint8Array(bytes)], name, { type });

test('file and canvas limits reject unsupported media, empty images and excessive memory allocation', () => {
    assert.equal(runtime.validateLocalImageFile(image()), null);
    assert.match(runtime.validateLocalImageFile({ name: 'script.svg', type: 'image/svg+xml', size: 100 }), /PNG, JPEG or WebP/);
    assert.match(runtime.validateLocalImageFile({ name: 'empty.png', type: 'image/png', size: 0 }), /empty/);
    assert.match(runtime.validateLocalImageFile({ name: 'big.png', type: 'image/png', size: 20 * 1024 * 1024 + 1 }), /20 MB/);
    assert.throws(() => runtime.getToolOutputSize('image-filter', { width: 4097, height: 100 }), /4096/);
    assert.throws(() => runtime.getToolOutputSize('image-filter', { width: 4096, height: 4096 }), /16 million/);
    assert.throws(() => runtime.getToolOutputSize('image-filter', { width: NaN, height: 10 }), /whole numbers/);
    assert.throws(() => runtime.getToolOutputSize('image-grid', Array(2).fill({ width: 4000, height: 3000 })), /Together/);
    assert.throws(() => runtime.getToolOutputSize('image-grid', []), /1 and 8/);
    assert.throws(() => runtime.getToolOutputSize('unknown', { width: 100, height: 100 }), /cannot run locally/);
});

test('resize computes aspect ratios, preserves a one-sided original ratio and rejects invalid dimensions', () => {
    const source = { width: 1200, height: 800 };
    assert.deepEqual(runtime.getToolOutputSize('image-resize', source, { width: 800, ratio: '16:9' }), { width: 800, height: 450 });
    assert.deepEqual(runtime.getToolOutputSize('image-resize', source, { height: 800, ratio: '4:5' }), { width: 640, height: 800 });
    assert.deepEqual(runtime.getToolOutputSize('image-resize', source, { width: 600 }), { width: 600, height: 400 });
    assert.deepEqual(runtime.getToolOutputSize('image-resize', source, { height: 400 }), { width: 600, height: 400 });
    assert.deepEqual(runtime.getToolOutputSize('image-resize', source, { width: '300', height: '300' }), { width: 300, height: 300 });
    assert.throws(() => runtime.getToolOutputSize('image-resize', source, { width: '1e100' }), /Width/);
    assert.throws(() => runtime.getToolOutputSize('image-resize', source, { width: 1.5 }), /whole number/);
    assert.throws(() => runtime.getToolOutputSize('image-resize', source, { width: 4096, ratio: '9:16' }), /4096/);
    assert.throws(() => runtime.getToolOutputSize('image-resize', source, { ratio: 'untrusted' }), /supported ratio/);
});

test('grid produces a bounded whole-pixel canvas for different image counts and orientations', () => {
    assert.deepEqual(runtime.getToolOutputSize('image-grid', Array(3).fill({ width: 500, height: 300 }), { columns: 2, gap: 10 }), { width: 1010, height: 610 });
    for (const dimensions of [{ width: 1000, height: 1500 }, { width: 1500, height: 1000 }, { width: 1400, height: 1400 }]) {
        for (const count of [1, 2, 4, 8]) for (const columns of [1, 2, 4]) {
            const result = runtime.getToolOutputSize('image-grid', Array(count).fill(dimensions), { columns, gap: 80 });
            assert.ok(result.width <= 4096 && result.height <= 4096);
            assert.ok(result.width * result.height <= 16_000_000);
            assert.ok(Number.isInteger(result.width) && Number.isInteger(result.height));
        }
    }
    assert.throws(() => runtime.getToolOutputSize('image-grid', [{ width: 100, height: 100 }], { columns: 5 }), /Columns/);
    assert.throws(() => runtime.getToolOutputSize('image-grid', [{ width: 100, height: 100 }], { gap: -1 }), /Gap/);
});

async function browserHarness(run, overrides = {}) {
    const previous = Object.fromEntries(['document', 'createImageBitmap', 'Image', 'URL'].map(key => [key, global[key]]));
    const calls = { draw: [], filter: [], closed: 0, revoked: [], created: [], text: [] };
    const context = {
        save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect() {},
        drawImage(...args) { calls.draw.push(args); },
        measureText(text) { return { width: Array.from(text).length * Number(this.font?.match(/(\d+)px/)?.[1] || 10) * .6 }; },
        strokeText() {}, fillText(...args) { calls.text.push(args); },
        set filter(value) { calls.filter.push(value); },
    };
    const canvas = { width: 0, height: 0, getContext: () => context, toBlob: callback => callback(new Blob(['generated'], { type: 'image/png' })) };
    global.document = { createElement: name => { assert.equal(name, 'canvas'); return canvas; } };
    global.createImageBitmap = overrides.createImageBitmap || (async () => ({ width: 600, height: 300, close() { calls.closed++; } }));
    global.URL = { createObjectURL(file) { assert.ok(file instanceof File); calls.created.push(file); return 'blob:local-image'; }, revokeObjectURL(url) { calls.revoked.push(url); } };
    if (overrides.Image) global.Image = overrides.Image;
    if (overrides.noBitmap) global.createImageBitmap = undefined;
    if (overrides.toBlob) canvas.toBlob = overrides.toBlob;
    if (overrides.getContext) canvas.getContext = overrides.getContext;
    try { await run({ calls, canvas, context }); }
    finally { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete global[key]; else global[key] = value; }
}

test('a local filter exports PNG, sanitizes the filename and releases decoded pixels', async () => browserHarness(async h => {
    const output = await runtime.runLocalTool('image-filter', [image('../../my image.png')], { preset: 'noir', intensity: 50 });
    assert.equal(output.width, 600);
    assert.equal(output.height, 300);
    assert.equal(output.blob.type, 'image/png');
    assert.equal(output.filename, 'my-image-image-filter.png');
    assert.ok(h.calls.filter.some(value => value.includes('grayscale(0.5)')));
    assert.equal(h.calls.draw.length, 1);
    assert.equal(h.calls.closed, 1);
    assert.equal(h.canvas.width, 0);
    assert.equal(h.canvas.height, 0);
    assert.equal(h.calls.created.length, 0, 'The bitmap path never creates object URLs.');
}));

test('contain and grid draw real image transforms while title text remains plain canvas text', async () => browserHarness(async h => {
    const resize = await runtime.runLocalTool('image-resize', [image()], { width: 300, height: 300, fit: 'contain', background: '#fff' });
    assert.equal(resize.width, 300);
    assert.deepEqual(h.calls.draw[0].slice(1), [0, 75, 300, 150]);
    h.calls.draw.length = 0;
    const grid = await runtime.runLocalTool('image-grid', [image(), image()], { columns: 2, gap: 10 });
    assert.deepEqual({ width: grid.width, height: grid.height }, { width: 1210, height: 300 });
    assert.equal(h.calls.draw.length, 2);
    await runtime.runLocalTool('type-overlay', [image()], { title: '<script>alert(1)</script>', fontSize: 60, color: '#abcdef', position: 'center' });
    assert.ok(h.calls.text.length);
    assert.equal(h.calls.text.map(call => call[0]).join(''), '<script>alert(1)</script>');
    assert.equal(h.calls.closed, 4);
}));

test('validation happens before decoding and files cannot be replaced with arbitrary URLs', async () => browserHarness(async h => {
    await assert.rejects(runtime.runLocalTool('image-filter', ['https://example.com/image.png'], {}), /Remote URLs/);
    await assert.rejects(runtime.runLocalTool('image-filter', [image('fake.png', [1, 2, 3])], {}), /does not match/);
    await assert.rejects(runtime.runLocalTool('image-filter', [image(), image()], {}), /one image/);
    assert.equal(h.calls.closed, 0);
    assert.equal(h.calls.created.length, 0);
}));

test('failure after decoding releases every bitmap and the canvas', async () => browserHarness(async h => {
    await assert.rejects(runtime.runLocalTool('image-grid', [image(), image()], { background: 'url(https://example.com)' }), /hex color/);
    assert.equal(h.calls.closed, 2);
    assert.equal(h.canvas.width, 0);
    await assert.rejects(runtime.runLocalTool('type-overlay', [image()], { title: 'x'.repeat(301) }), /300 characters/);
    assert.equal(h.calls.closed, 3);
    await assert.rejects(runtime.runLocalTool('image-filter', [image()], { preset: 'unknown' }), /supported preset/);
    assert.equal(h.calls.closed, 4);
}));

test('decoded size limits release the current bitmap and all previously opened images', async () => {
    let closed = 0;
    await browserHarness(async () => {
        await assert.rejects(runtime.runLocalTool('image-filter', [image()], {}), /4096/);
        assert.equal(closed, 1);
    }, { createImageBitmap: async () => ({ width: 10_000, height: 100, close() { closed++; } }) });
    await browserHarness(async h => {
        await assert.rejects(runtime.runLocalTool('image-grid', [image(), image()], {}), /Together/);
        assert.equal(closed, 3);
        assert.equal(h.calls.draw.length, 0);
    }, { createImageBitmap: async () => ({ width: 4000, height: 3000, close() { closed++; } }) });
});

test('an already cancelled run opens no files or canvas and a missing context releases its bitmap', async () => {
    await browserHarness(async h => {
        const controller = new AbortController(); controller.abort();
        await assert.rejects(runtime.runLocalTool('image-filter', [image()], {}, controller.signal), { name: 'AbortError' });
        assert.equal(h.calls.closed, 0);
        assert.equal(h.calls.created.length, 0);
    });
    await browserHarness(async h => {
        await assert.rejects(runtime.runLocalTool('image-filter', [image()], {}), /cannot create images/);
        assert.equal(h.calls.closed, 1);
        assert.equal(h.canvas.width, 0);
    }, { getContext: () => null });
});

test('abort during bitmap decode resolves promptly and disposes a late decoded bitmap', async () => {
    let resolveBitmap, closed = 0;
    const decoding = new Promise(resolve => { resolveBitmap = resolve; });
    await browserHarness(async h => {
        const controller = new AbortController();
        const running = runtime.runLocalTool('image-filter', [image()], {}, controller.signal);
        await new Promise(resolve => setImmediate(resolve));
        controller.abort();
        await assert.rejects(running, { name: 'AbortError' });
        resolveBitmap({ width: 600, height: 300, close() { closed++; } });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(closed, 1);
        assert.equal(h.calls.draw.length, 0);
    }, { createImageBitmap: () => decoding });
});

test('fallback image decode revokes its local object URL on success and abort', async () => {
    const instances = [];
    class FallbackImage {
        naturalWidth = 200;
        naturalHeight = 100;
        set src(value) { this.value = value; if (value) queueMicrotask(() => this.onload?.()); }
        constructor() { instances.push(this); }
    }
    await browserHarness(async h => {
        await runtime.runLocalTool('image-filter', [image()], {});
        assert.deepEqual(h.calls.revoked, ['blob:local-image']);
        assert.equal(instances[0].value, '');
        assert.equal(instances[0].onload, null);
    }, { noBitmap: true, Image: FallbackImage });

    class PendingImage { set src(value) { this.value = value; } constructor() { instances.push(this); } }
    await browserHarness(async h => {
        const controller = new AbortController();
        const running = runtime.runLocalTool('image-filter', [image()], {}, controller.signal);
        await new Promise(resolve => setImmediate(resolve));
        controller.abort();
        await assert.rejects(running, { name: 'AbortError' });
        assert.deepEqual(h.calls.revoked, ['blob:local-image']);
        assert.equal(instances.at(-1).value, '');
        assert.equal(instances.at(-1).onload, null);
    }, { noBitmap: true, Image: PendingImage });
});

test('export failures and export cancellation do not keep canvas buffers or bitmaps', async () => {
    await browserHarness(async h => {
        await assert.rejects(runtime.runLocalTool('image-filter', [image()], {}), /could not be exported/);
        assert.equal(h.calls.closed, 1);
        assert.equal(h.canvas.width, 0);
    }, { toBlob: callback => callback(null) });
    await browserHarness(async h => {
        const controller = new AbortController();
        const running = runtime.runLocalTool('image-filter', [image()], {}, controller.signal);
        await new Promise(resolve => setImmediate(resolve));
        controller.abort();
        await assert.rejects(running, { name: 'AbortError' });
        assert.equal(h.calls.closed, 1);
        assert.equal(h.canvas.width, 0);
    }, { toBlob() {} });
    await browserHarness(async h => {
        await assert.rejects(runtime.runLocalTool('image-filter', [image()], {}), /exceeds 20 MB/);
        assert.equal(h.calls.closed, 1);
        assert.equal(h.canvas.width, 0);
    }, { toBlob: callback => callback(new Blob([new Uint8Array(20 * 1024 * 1024 + 1)])) });
});
