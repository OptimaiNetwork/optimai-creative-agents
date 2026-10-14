import assert from 'node:assert/strict';
import test from 'node:test';
import { FRAME_SCULPTURE_LIMITS, frameSampleTimes, frameTextureSize, frameSculpturePose, validateFrameSculptureSettings, validateFrameSamples, extractFrameSamples } from '../src/frame-sculpture.mjs';

test('frame sampling covers equal intervals without seeking the ended position', () => {
  assert.deepEqual(frameSampleTimes(4, 4), [.5, 1.5, 2.5, 3.5]);
  for (const duration of [.01, 3.42, 60]) {
    const values = frameSampleTimes(duration, 12);
    assert.equal(values.length, 12); assert.ok(values.every((value, index) => value > 0 && value < duration && (!index || value > values[index - 1])));
  }
  for (const duration of [0, NaN, Infinity, -1, 61]) assert.throws(() => frameSampleTimes(duration));
  for (const count of [0, 1, 13, 2.5]) assert.throws(() => frameSampleTimes(3, count));
});
test('texture allocation preserves aspect ratio and caps source and retained pixels', () => {
  assert.deepEqual(frameTextureSize(1920, 1080), { width: 768, height: 432 });
  assert.deepEqual(frameTextureSize(1080, 1920), { width: 432, height: 768 });
  assert.deepEqual(frameTextureSize(100, 100), { width: 100, height: 100 });
  for (const size of [[0, 20], [10000, 200], [8192, 8192], [NaN, 40]]) assert.throws(() => frameTextureSize(...size));
});
test('all layouts produce finite bounded poses and keep one-frame compositions centered', () => {
  const poses = [];
  for (const layout of ['stack', 'fan', 'ribbon']) {
    const all = Array.from({ length: 12 }, (_, index) => frameSculpturePose(index, 12, { layout }));
    assert.ok(all.every(pose => Object.values(pose).every(Number.isFinite)));
    assert.equal(all[0].z, -all.at(-1).z); poses.push(all);
    const single = frameSculpturePose(0, 1, { layout }); assert.equal(single.x, 0); assert.equal(single.y, 0); assert.equal(single.z, 0);
  }
  assert.notDeepEqual(poses[0], poses[1]); assert.notDeepEqual(poses[1], poses[2]);
  for (const settings of [{ spacing: 0 }, { opacity: 0 }, { spread: 3 }, { tilt: 41 }, { layout: 'remote' }, { background: 'url(https://invalid.test)' }]) assert.throws(() => validateFrameSculptureSettings(settings));
});

test('default fan and ribbon expose the sequence across the perspective camera rather than collapsing behind one plane', () => {
  for (const layout of ['fan', 'ribbon']) {
    const poses = Array.from({ length: 8 }, (_, index) => frameSculpturePose(index, 8, { layout }));
    // Horizontal projection for the installed perspective direction (.95, .5, 1.15).
    const projected = poses.map(pose => pose.x * 1.15 - pose.z * .95);
    assert.ok(Math.abs(projected.at(-1) - projected[0]) > 4, 'All sampled planes should occupy a visible horizontal span.');
    assert.ok(projected.every((value, index) => !index || value < projected[index - 1]));
  }
});

function decoderFixture(t, duration = 4) {
  const draws = [], canvases = [], revoked = [], video = new EventTarget(); let time = 0, src = '';
  Object.assign(video, { videoWidth: 1920, videoHeight: 1080, duration, readyState: 2, pause() {}, removeAttribute() { src = ''; }, load() { if (src) queueMicrotask(() => video.dispatchEvent(new Event('loadeddata'))); } });
  Object.defineProperties(video, { src: { set(value) { src = value; }, get() { return src; } }, currentTime: { set(value) { time = value; queueMicrotask(() => video.dispatchEvent(new Event('seeked'))); }, get() { return time; } } });
  const originalDocument = globalThis.document, create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  globalThis.document = { createElement(kind) { if (kind === 'video') return video; assert.equal(kind, 'canvas'); const canvas = { width: 0, height: 0, getContext() { return { drawImage() { draws.push(time); } }; } }; canvases.push(canvas); return canvas; } };
  URL.createObjectURL = () => 'blob:local-fixture'; URL.revokeObjectURL = value => revoked.push(value);
  t.after(() => { globalThis.document = originalDocument; URL.createObjectURL = create; URL.revokeObjectURL = revoke; });
  return { draws, canvases, revoked, video, file: { size: 1000, type: 'video/mp4', name: 'original.mp4' } };
}
test('extraction decodes actual requested timestamps and releases the source URL', async t => {
  const fixture = decoderFixture(t), progress = [];
  const result = await extractFrameSamples(fixture.file, { count: 4, onProgress: (...value) => progress.push(value) });
  assert.deepEqual(fixture.draws, [.5, 1.5, 2.5, 3.5]); assert.deepEqual(result.frames.map(frame => frame.time), fixture.draws);
  assert.deepEqual(progress, [[1, 4], [2, 4], [3, 4], [4, 4]]); assert.deepEqual(fixture.revoked, ['blob:local-fixture']);
  assert.equal(result.name, 'original.mp4'); assert.equal(result.kind, 'video'); assert.equal(result.duration, 4);
});
test('canceling halfway releases retained frame pixels and never returns partial frames', async t => {
  const fixture = decoderFixture(t), abort = new AbortController();
  await assert.rejects(extractFrameSamples(fixture.file, { count: 4, signal: abort.signal, onProgress: () => abort.abort() }), { name: 'AbortError' });
  assert.equal(fixture.draws.length, 1); assert.ok(fixture.canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
  assert.deepEqual(fixture.revoked, ['blob:local-fixture']);
});
test('unsupported and oversized media fail before any decoder allocation', async () => {
  for (const file of [{ size: FRAME_SCULPTURE_LIMITS.bytes + 1, type: 'video/mp4' }, { size: 20, type: 'image/gif', name: 'animated.gif' }, { size: 0, type: 'video/mp4' }]) await assert.rejects(extractFrameSamples(file));
});
test('repeated or overlapping ownership cannot clear existing frame pixels', () => {
  const canvas = { width: 640, height: 360, getContext() {} }, owned = [{ canvas, time: 1 }];
  assert.throws(() => validateFrameSamples(owned, owned), /already belong/);
  assert.throws(() => validateFrameSamples([{ canvas, time: 2 }], owned), /already belong/);
  assert.throws(() => validateFrameSamples([...owned, ...owned]), /distinct canvas/);
  assert.equal(canvas.width, 640); assert.equal(canvas.height, 360);
  assert.doesNotThrow(() => validateFrameSamples([{ canvas: { ...canvas }, time: 2 }], owned));
});
