import test from 'node:test';
import assert from 'node:assert/strict';
import * as splat from '../src/splat.mjs';
const { detectSplatFormat, readSplatFile, writeSplatFile, reduceSplats, splatBounds, splatOrbitCamera, renderSplats, SPLAT_LIMITS } = splat;
const GAUSSIAN = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'f_rest_0', 'f_rest_1', 'f_rest_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
/** A binary little-endian PLY like the 3D Gaussian Splatting trainer writes (float properties). */
function ply(rows, names = GAUSSIAN, { format = 'binary_little_endian 1.0', bytes = {} } = {}) {
  const header = `ply\nformat ${format}\nelement vertex ${rows.length}\n${names.map(name => `property ${bytes[name] ? 'uchar' : 'float'} ${name}`).join('\n')}\nend_header\n`;
  const head = new TextEncoder().encode(header), stride = names.reduce((sum, name) => sum + (bytes[name] ? 1 : 4), 0), out = new Uint8Array(head.length + rows.length * stride), view = new DataView(out.buffer);
  out.set(head);
  rows.forEach((row, i) => { let at = head.length + i * stride; for (const name of names) { if (bytes[name]) out[at++] = row[name] ?? 0; else { view.setFloat32(at, row[name] ?? 0, true); at += 4; } } });
  return out.buffer;
}
const logit = p => Math.log(p / (1 - p)), dc = c => (c - .5) / 0.28209479177387814;
function gaussian({ at = [0, 0, 0], color = [1, 0, 0], opacity = .9, scale = .1, rot = [1, 0, 0, 0] } = {}) {
  return { x: at[0], y: at[1], z: at[2], f_dc_0: dc(color[0]), f_dc_1: dc(color[1]), f_dc_2: dc(color[2]), opacity: logit(opacity), scale_0: Math.log(scale), scale_1: Math.log(scale), scale_2: Math.log(scale), rot_0: rot[0], rot_1: rot[1], rot_2: rot[2], rot_3: rot[3] };
}
function pixel(image, x, y) { const i = (y * image.width + x) * 4; return [...image.data.subarray(i, i + 3)]; }
function image(width = 64, height = 48) { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; }

test('reads a 3D Gaussian Splatting PLY: colour from the DC term, opacity through a sigmoid, scales from logs, unit rotations', () => {
  const file = ply([gaussian({ at: [1, 2, 3], color: [1, .5, 0], opacity: .75, scale: .2, rot: [2, 0, 0, 0] }), gaussian({ rot: [0, 0, 0, 0] })]);
  assert.equal(detectSplatFormat(file), 'ply');
  const s = readSplatFile(file);
  assert.equal(s.count, 2); assert.equal(s.format, 'ply'); assert.equal(s.shade, 'gaussian'); assert.equal(s.harmonics, 3);
  assert.deepEqual([...s.positions.subarray(0, 3)], [1, 2, 3]);
  assert.deepEqual([...s.colors.subarray(0, 4)], [255, 128, 0, 191]);
  for (const v of s.scales.subarray(0, 3)) assert.ok(Math.abs(v - .2) < 1e-6);
  assert.deepEqual([...s.rotations.subarray(0, 4)], [1, 0, 0, 0], 'a scaled quaternion is normalised');
  assert.deepEqual([...s.rotations.subarray(4, 8)], [1, 0, 0, 0], 'a zero quaternion becomes identity');
});
test('a coloured point cloud PLY becomes small round splats sized from the cloud spacing', () => {
  const rows = [], names = ['x', 'y', 'z', 'red', 'green', 'blue'];
  for (let i = 0; i < 27; i++) rows.push({ x: i % 3, y: (i / 3 | 0) % 3, z: i / 9 | 0, red: 10, green: 200, blue: 30 });
  const s = readSplatFile(ply(rows, names, { bytes: { red: 1, green: 1, blue: 1 } }));
  assert.equal(s.shade, 'points'); assert.equal(s.count, 27);
  assert.deepEqual([...s.colors.subarray(0, 4)], [10, 200, 30, 255]);
  assert.ok(s.scales[0] > .2 && s.scales[0] < 1, `point size ${s.scales[0]}`);
});
test('the compact .splat layout round-trips and is 32 bytes a splat', () => {
  const source = readSplatFile(ply([gaussian({ at: [-1, .5, 2], color: [0, 0, 1], rot: [.7071, .7071, 0, 0] }), gaussian({ at: [3, 3, 3] })]));
  const bytes = writeSplatFile(source);
  assert.equal(bytes.byteLength, 64); assert.equal(detectSplatFormat(bytes), 'splat');
  const back = readSplatFile(bytes);
  assert.equal(back.format, 'splat'); assert.deepEqual(back.positions, source.positions); assert.deepEqual(back.colors, source.colors);
  back.scales.forEach((v, i) => assert.ok(Math.abs(v - source.scales[i]) < 1e-6));
  back.rotations.forEach((v, i) => assert.ok(Math.abs(v - source.rotations[i]) < .02, 'rotations survive 8-bit quantisation'));
  assert.equal(readSplatFile(new Uint8Array(bytes)).count, 2, 'typed array views are accepted');
});
test('refuses files it cannot read safely, with words a creator can act on', () => {
  assert.throws(() => readSplatFile(ply([gaussian()], GAUSSIAN, { format: 'ascii 1.0' })), /binary little-endian/);
  assert.throws(() => readSplatFile(new TextEncoder().encode('ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty list uchar int vertex_indices\nend_header\n' + ' '.repeat(40))), /list properties/);
  assert.throws(() => readSplatFile(ply([{ x: 1, y: 2, z: 3, nx: 0 }], ['x', 'y', 'z', 'nx'])), /neither a Gaussian splat/);
  assert.throws(() => readSplatFile(ply([gaussian({ at: [NaN, 0, 0] })])), /invalid number/);
  assert.throws(() => readSplatFile(ply([gaussian({ at: [2e6, 0, 0] })])), /too far/);
  assert.throws(() => readSplatFile(ply([gaussian(), gaussian()]).slice(0, -8)), /shorter than its header/);
  assert.throws(() => readSplatFile(new Uint8Array(40), { format: 'splat' }), /cut short/);
  assert.throws(() => readSplatFile(new Uint8Array(33)), /\.ply or \.splat/);
  assert.throws(() => readSplatFile(new TextEncoder().encode('ply\n' + 'comment x\n'.repeat(2000))), /no readable header/);
  assert.throws(() => readSplatFile('nope'), /ArrayBuffer/);
  assert.equal(SPLAT_LIMITS.splats, 2000000);
});
test('reduceSplats keeps the most visible splats in their original order', () => {
  const rows = [gaussian({ opacity: .1 }), gaussian({ opacity: .9, scale: .5 }), gaussian({ opacity: .5 }), gaussian({ opacity: .9, scale: .4 })];
  const s = readSplatFile(ply(rows)), kept = reduceSplats(s, 2);
  assert.equal(kept.count, 2); assert.equal(kept.reducedFrom, 4);
  assert.ok(Math.abs(kept.scales[0] - .5) < 1e-6 && Math.abs(kept.scales[3] - .4) < 1e-6);
  assert.equal(reduceSplats(s, 10), s, 'nothing to drop returns the same splats');
  assert.throws(() => reduceSplats(s, 0), /budget/);
  assert.throws(() => reduceSplats({ count: 1 }), /readSplatFile/);
});
test('bounds ignore a few stray floaters, and the orbit camera frames them', () => {
  const rows = [];
  for (let i = 0; i < 100; i++) rows.push(gaussian({ at: [(i % 10) / 9 - .5, ((i / 10) | 0) / 9 - .5, 0] }));
  rows.push(gaussian({ at: [500, 0, 0] }));
  const b = splatBounds(readSplatFile(ply(rows)));
  assert.ok(b.max[0] <= .5 + 1e-6, 'the floater is trimmed'); assert.ok(Math.abs(b.center[1]) < 1e-6);
  const cam = splatOrbitCamera(b, { yaw: 0, pitch: 0, up: 'y' });
  assert.deepEqual(cam.up, [0, 1, 0]);
  assert.ok(Math.abs(Math.hypot(...cam.eye.map((v, k) => v - b.center[k])) - b.radius * 1.6 / Math.tan(25 * Math.PI / 180)) < 1e-9);
  assert.throws(() => splatOrbitCamera(b, { pitch: 90 }), /pitch/);
  assert.throws(() => splatOrbitCamera(b, { up: 'x' }), /up/);
});
test('renders front to back: the nearer splat covers the farther one, from either side', () => {
  const s = readSplatFile(ply([gaussian({ at: [0, 0, -.5], color: [1, 0, 0], opacity: .99, scale: .25 }), gaussian({ at: [0, 0, .5], color: [0, 0, 1], opacity: .99, scale: .25 })]));
  const bounds = { center: [0, 0, 0], radius: 1 };
  const front = image(), back = image();
  const stats = renderSplats(s, front, splatOrbitCamera(bounds, { yaw: 0, pitch: 0, up: 'y' }), { background: '#000000' });
  renderSplats(s, back, splatOrbitCamera(bounds, { yaw: 180, pitch: 0, up: 'y' }), { background: '#000000' });
  assert.deepEqual(stats, { drawn: 2, skipped: 0, splats: 2 });
  const [r1, , b1] = pixel(front, 32, 24), [r2, , b2] = pixel(back, 32, 24);
  assert.ok(b1 > 200 && r1 < 30, `camera on +z sees blue first: ${pixel(front, 32, 24)}`);
  assert.ok(r2 > 200 && b2 < 30, `camera on -z sees red first: ${pixel(back, 32, 24)}`);
  assert.deepEqual(pixel(front, 0, 0), [0, 0, 0], 'empty pixels show the background');
  assert.equal(front.data[3], 255);
});
test('a stretched, rotated splat draws as a rotated ellipse; splats behind the camera are skipped', () => {
  const flat = gaussian({ at: [0, 0, 0], color: [1, 1, 1], opacity: .99, scale: .05 });
  flat.scale_0 = Math.log(.6);
  const turned = { ...flat, rot_0: Math.cos(Math.PI / 4), rot_3: Math.sin(Math.PI / 4) }; // 90° about z: long axis becomes vertical
  const cam = splatOrbitCamera({ center: [0, 0, 0], radius: 1 }, { pitch: 0, up: 'y' });
  const wide = image(), tall = image();
  renderSplats(readSplatFile(ply([flat])), wide, cam, { background: '#000000' });
  renderSplats(readSplatFile(ply([turned, gaussian({ at: [0, 0, 50] })])), tall, cam, { background: '#000000' });
  assert.ok(pixel(wide, 40, 24)[0] > 100 && pixel(wide, 32, 32)[0] < 20, 'unrotated: wide, not tall');
  assert.ok(pixel(tall, 32, 32)[0] > 100 && pixel(tall, 40, 24)[0] < 20, 'rotated: tall, not wide');
  assert.equal(renderSplats(readSplatFile(ply([turned, gaussian({ at: [0, 0, 50] })])), image(), cam).skipped, 1);
});
test('rendering checks its target, camera and colour, and stops when asked', () => {
  const s = readSplatFile(ply([gaussian()])), cam = splatOrbitCamera({ center: [0, 0, 0], radius: 1 });
  assert.throws(() => renderSplats(s, { width: 2, height: 2, data: new Uint8Array(3) }, cam), /ImageData-like/);
  assert.throws(() => renderSplats(s, image(), { eye: [0, 0, 0] }), /camera/);
  assert.throws(() => renderSplats(s, image(), cam, { background: 'red' }), /hex/);
  const controller = new AbortController(); controller.abort();
  assert.throws(() => renderSplats(s, image(), cam, { signal: controller.signal }), { name: 'AbortError' });
});
test('prepareSplatPreview reads, budgets and frames once; drawSplatPreview paints a 2D canvas at a named view', () => {
  const rows = [gaussian({ at: [0, 0, .5], color: [0, 0, 1], opacity: .95, scale: .12 }), gaussian({ at: [0, 0, -.5], color: [1, 0, 0], opacity: .95, scale: .12 }), gaussian({ at: [0, 0, 0], opacity: .05, scale: .01 })];
  const preview = splat.prepareSplatPreview(ply(rows), { budget: 2 });
  assert.equal(preview.count, 3); assert.equal(preview.shown, 2); assert.equal(preview.splats.reducedFrom, 3); assert.equal(preview.format, 'ply'); assert.equal(preview.shade, 'gaussian');
  assert.ok(preview.bounds.radius > 0);
  let painted = null;
  const canvas = { width: 64, height: 48, getContext: kind => kind === '2d' ? { createImageData: (width, height) => image(width, height), putImageData: (pixels, x, y) => { painted = { pixels, x, y }; } } : null };
  const front = splat.drawSplatPreview(canvas, preview, { ...splat.SPLAT_VIEWS.front, up: 'y', background: '#000000' });
  assert.equal(front.drawn, 2); assert.equal(typeof front.ms, 'number'); assert.equal(painted.x, 0);
  assert.ok(pixel(painted.pixels, 32, 24)[2] > 200, 'the front view sees the blue splat first');
  splat.drawSplatPreview(canvas, preview, { yaw: 180, pitch: 0, up: 'y', background: '#000000' });
  assert.ok(pixel(painted.pixels, 32, 24)[0] > 200, 'turning the yaw slider half way shows the red side');
  assert.deepEqual(Object.keys(splat.SPLAT_VIEWS), ['isometric', 'front', 'side', 'top']);
  assert.ok(Object.isFrozen(splat.SPLAT_VIEWS.top));
  assert.throws(() => splat.drawSplatPreview({ width: 1, height: 1, getContext: () => null }, preview), /2D/);
  assert.throws(() => splat.drawSplatPreview(canvas, {}), /prepareSplatPreview/);
  assert.throws(() => splat.drawSplatPreview(canvas, preview, { pitch: 120 }), /pitch/);
});
