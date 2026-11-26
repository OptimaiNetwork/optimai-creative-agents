/** Gaussian splats on the device: bounded .ply/.splat reading, compact .splat writing and a dependency-free software preview. No requests. */
export const SPLAT_LIMITS = Object.freeze({ bytes: 256 * 1048576, splats: 2000000, headerBytes: 16384, preview: 200000, side: 4096 });
const SH_C0 = 0.28209479177387814, SPLAT_STRIDE = 32;
const PLY_TYPES = { char: ['Int8', 1], int8: ['Int8', 1], uchar: ['Uint8', 1], uint8: ['Uint8', 1], short: ['Int16', 2], int16: ['Int16', 2], ushort: ['Uint16', 2], uint16: ['Uint16', 2], int: ['Int32', 4], int32: ['Int32', 4], uint: ['Uint32', 4], uint32: ['Uint32', 4], float: ['Float32', 4], float32: ['Float32', 4], double: ['Float64', 8], float64: ['Float64', 8] };
const fail = message => { throw new Error(message); };
const bytesOf = value => value instanceof ArrayBuffer ? new Uint8Array(value) : ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : fail('Pass the splat file as an ArrayBuffer or typed array.');
const clamp = (value, min, max) => value < min ? min : value > max ? max : value;
const sigmoid = value => 1 / (1 + Math.exp(-value));
/** Say which splat layout a file uses from its bytes, or null. */
export function detectSplatFormat(value) {
    const bytes = bytesOf(value);
    if (bytes.length >= 4 && bytes[0] === 0x70 && bytes[1] === 0x6c && bytes[2] === 0x79 && (bytes[3] === 0x0a || bytes[3] === 0x0d)) return 'ply';
    return bytes.length >= SPLAT_STRIDE && bytes.length % SPLAT_STRIDE === 0 ? 'splat' : null;
}
function readPlyHeader(bytes) {
    const limit = Math.min(bytes.length, SPLAT_LIMITS.headerBytes);
    let end = -1;
    for (let i = 0; i + 10 <= limit; i++) if (bytes[i] === 0x65 && String.fromCharCode(...bytes.subarray(i, i + 10)) === 'end_header') { end = i + 10; break; }
    if (end < 0) fail('This PLY has no readable header in its first 16 KB.');
    if (bytes[end] === 0x0d) end++;
    if (bytes[end++] !== 0x0a) fail('This PLY header does not end on a new line.');
    const lines = new TextDecoder('ascii').decode(bytes.subarray(0, end)).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const elements = [];
    let format;
    for (const line of lines.slice(1, -1)) {
        const words = line.split(/\s+/);
        if (words[0] === 'format') format = words[1] + ' ' + words[2];
        else if (words[0] === 'element') {
            const count = Number(words[2]);
            if (!/^[A-Za-z_][\w-]*$/.test(words[1] ?? '') || !Number.isSafeInteger(count) || count < 0) fail('This PLY declares an invalid element.');
            elements.push({ name: words[1], count, properties: [] });
        } else if (words[0] === 'property') {
            const element = elements.at(-1) ?? fail('This PLY declares a property before any element.');
            if (words[1] === 'list') fail('Export the splat PLY without list properties.');
            const type = PLY_TYPES[words[1]] ?? fail(`This PLY uses an unsupported ${String(words[1]).slice(0, 12)} property.`);
            if (element.properties.length >= 256) fail('This PLY declares too many properties.');
            element.properties.push({ name: String(words[2]).slice(0, 40), reader: type[0], size: type[1] });
        } else if (!['comment', 'obj_info'].includes(words[0])) fail('This PLY header has an unsupported line.');
    }
    if (format !== 'binary_little_endian 1.0') fail('Export the splat PLY as binary little-endian (the usual 3D Gaussian Splatting output).');
    if (elements[0]?.name !== 'vertex') fail('This PLY must start with its vertex element.');
    return { end, vertex: elements[0] };
}
function allocate(count) {
    return { count, positions: new Float32Array(count * 3), scales: new Float32Array(count * 3), rotations: new Float32Array(count * 4), colors: new Uint8Array(count * 4) };
}
function finish(splats, index, x, y, z, sx, sy, sz, qw, qx, qy, qz) {
    const values = [x, y, z, sx, sy, sz, qw, qx, qy, qz];
    for (const value of values) if (!Number.isFinite(value)) fail(`Splat ${index} has a missing or invalid number.`);
    if (Math.abs(x) > 1e6 || Math.abs(y) > 1e6 || Math.abs(z) > 1e6) fail(`Splat ${index} sits too far from the scene to preview.`);
    const length = Math.hypot(qw, qx, qy, qz);
    if (!(length > 1e-8)) [qw, qx, qy, qz] = [1, 0, 0, 0];
    else [qw, qx, qy, qz] = [qw / length, qx / length, qy / length, qz / length];
    splats.positions.set([x, y, z], index * 3);
    splats.scales.set([clamp(Math.abs(sx), 1e-7, 1e4), clamp(Math.abs(sy), 1e-7, 1e4), clamp(Math.abs(sz), 1e-7, 1e4)], index * 3);
    splats.rotations.set([qw, qx, qy, qz], index * 4);
}
function readPly(bytes) {
    const { end, vertex } = readPlyHeader(bytes);
    if (vertex.count < 1 || vertex.count > SPLAT_LIMITS.splats) fail(`Choose a splat with 1 to ${SPLAT_LIMITS.splats.toLocaleString('en-US')} points.`);
    const stride = vertex.properties.reduce((sum, item) => sum + item.size, 0);
    if (end + stride * vertex.count > bytes.length) fail('This PLY is shorter than its header says.');
    const at = {};
    let offset = 0;
    for (const item of vertex.properties) { if (!(item.name in at)) at[item.name] = { ...item, offset }; offset += item.size; }
    for (const name of ['x', 'y', 'z']) if (!at[name]) fail('This PLY has no x, y and z positions.');
    const gaussian = ['f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'].every(name => at[name]);
    const plain = ['red', 'green', 'blue'].every(name => at[name]);
    if (!gaussian && !plain) fail('This PLY is neither a Gaussian splat (f_dc, opacity, scale, rot) nor a coloured point cloud (red, green, blue).');
    const view = new DataView(bytes.buffer, bytes.byteOffset + end, stride * vertex.count);
    const read = (base, name) => { const item = at[name]; return view[`get${item.reader}`](base + item.offset, true); };
    const splats = allocate(vertex.count), shade = gaussian ? 'gaussian' : 'points';
    let pointSize = 0;
    if (!gaussian) { // Coloured point clouds become small round splats sized from the cloud's own spacing.
        let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < vertex.count; i++) for (let k = 0; k < 3; k++) { const v = read(i * stride, 'xyz'[k]); if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
        pointSize = Math.max(1e-4, Math.cbrt(Math.max(1e-12, (max[0] - min[0]) * (max[1] - min[1] || 1) * (max[2] - min[2] || 1)) / vertex.count) * .5);
    }
    for (let i = 0; i < vertex.count; i++) {
        const base = i * stride, x = read(base, 'x'), y = read(base, 'y'), z = read(base, 'z');
        if (gaussian) {
            finish(splats, i, x, y, z, Math.exp(clamp(read(base, 'scale_0'), -30, 9)), Math.exp(clamp(read(base, 'scale_1'), -30, 9)), Math.exp(clamp(read(base, 'scale_2'), -30, 9)), read(base, 'rot_0'), read(base, 'rot_1'), read(base, 'rot_2'), read(base, 'rot_3'));
            const opacity = read(base, 'opacity');
            if (!Number.isFinite(opacity)) fail(`Splat ${i} has a missing or invalid number.`);
            for (let k = 0; k < 3; k++) { const dc = read(base, `f_dc_${k}`); if (!Number.isFinite(dc)) fail(`Splat ${i} has a missing or invalid number.`); splats.colors[i * 4 + k] = Math.round(clamp(.5 + SH_C0 * dc, 0, 1) * 255); }
            splats.colors[i * 4 + 3] = Math.round(sigmoid(clamp(opacity, -40, 40)) * 255);
        } else {
            finish(splats, i, x, y, z, pointSize, pointSize, pointSize, 1, 0, 0, 0);
            const scale = at.red.reader === 'Uint8' ? 1 : at.red.reader.startsWith('Float') ? 255 : 1 / 257;
            ['red', 'green', 'blue'].forEach((name, k) => { splats.colors[i * 4 + k] = Math.round(clamp(read(base, name) * scale, 0, 255)); });
            splats.colors[i * 4 + 3] = at.alpha ? Math.round(clamp(read(base, 'alpha') * (at.alpha.reader.startsWith('Float') ? 255 : 1), 0, 255)) : 255;
        }
    }
    return { ...splats, format: 'ply', shade, harmonics: Object.keys(at).filter(name => name.startsWith('f_rest_')).length };
}
function readCompact(bytes) {
    const count = bytes.length / SPLAT_STRIDE;
    if (count > SPLAT_LIMITS.splats) fail(`Choose a splat with up to ${SPLAT_LIMITS.splats.toLocaleString('en-US')} points.`);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), splats = allocate(count);
    for (let i = 0; i < count; i++) {
        const base = i * SPLAT_STRIDE, f = k => view.getFloat32(base + k * 4, true), q = k => (bytes[base + 28 + k] - 128) / 128;
        finish(splats, i, f(0), f(1), f(2), f(3), f(4), f(5), q(0), q(1), q(2), q(3));
        splats.colors.set(bytes.subarray(base + 24, base + 28), i * 4);
    }
    return { ...splats, format: 'splat', shade: 'gaussian', harmonics: 0 };
}
/** Read a 3D Gaussian Splatting .ply, a coloured point-cloud .ply or a compact .splat into plain typed arrays, checking every number. */
export function readSplatFile(value, { format } = {}) {
    const bytes = bytesOf(value);
    if (bytes.length < SPLAT_STRIDE || bytes.length > SPLAT_LIMITS.bytes) fail('Choose a splat file up to 256 MB.');
    const kind = format ?? detectSplatFormat(bytes);
    if (kind === 'ply') { if (detectSplatFormat(bytes) !== 'ply') fail('This file does not start like a PLY.'); return readPly(bytes); }
    if (kind === 'splat') { if (bytes.length % SPLAT_STRIDE) fail('A .splat file holds 32 bytes per splat; this one is cut short.'); return readCompact(bytes); }
    return fail('Choose a .ply or .splat Gaussian splat file.');
}
function checkSplats(splats) {
    const count = splats?.count;
    if (!Number.isSafeInteger(count) || count < 0 || count > SPLAT_LIMITS.splats || !(splats.positions instanceof Float32Array) || splats.positions.length !== count * 3 || !(splats.scales instanceof Float32Array) || splats.scales.length !== count * 3 || !(splats.rotations instanceof Float32Array) || splats.rotations.length !== count * 4 || !(splats.colors instanceof Uint8Array) || splats.colors.length !== count * 4) fail('Pass splats from readSplatFile.');
    return count;
}
/** Write splats as the compact 32-byte .splat layout most web viewers read (32 bytes a splat against 248 in a full 3DGS .ply; view-dependent colour is dropped). */
export function writeSplatFile(splats) {
    const count = checkSplats(splats), out = new Uint8Array(count * SPLAT_STRIDE), view = new DataView(out.buffer);
    for (let i = 0; i < count; i++) {
        const base = i * SPLAT_STRIDE;
        for (let k = 0; k < 3; k++) { view.setFloat32(base + k * 4, splats.positions[i * 3 + k], true); view.setFloat32(base + 12 + k * 4, splats.scales[i * 3 + k], true); }
        out.set(splats.colors.subarray(i * 4, i * 4 + 4), base + 24);
        for (let k = 0; k < 4; k++) out[base + 28 + k] = clamp(Math.round(splats.rotations[i * 4 + k] * 128 + 128), 0, 255);
    }
    return out.buffer;
}
function importance(splats, i) { return splats.colors[i * 4 + 3] * Math.cbrt(splats.scales[i * 3] * splats.scales[i * 3 + 1] * splats.scales[i * 3 + 2]); }
/** Keep the splats that matter most (opacity × size) within a budget, in their original order, for previews and phones. */
export function reduceSplats(splats, budget = SPLAT_LIMITS.preview) {
    const count = checkSplats(splats);
    if (!Number.isSafeInteger(budget) || budget < 1) fail('Pass a whole-number splat budget of at least 1.');
    if (count <= budget) return splats;
    const scores = new Float32Array(count);
    for (let i = 0; i < count; i++) scores[i] = importance(splats, i);
    const threshold = Float32Array.from(scores).sort()[count - budget], keep = [];
    for (let i = 0; i < count && keep.length < budget; i++) if (scores[i] > threshold) keep.push(i);
    for (let i = 0; i < count && keep.length < budget; i++) if (scores[i] === threshold) keep.push(i);
    keep.sort((a, b) => a - b);
    const out = allocate(keep.length);
    keep.forEach((from, to) => { out.positions.set(splats.positions.subarray(from * 3, from * 3 + 3), to * 3); out.scales.set(splats.scales.subarray(from * 3, from * 3 + 3), to * 3); out.rotations.set(splats.rotations.subarray(from * 4, from * 4 + 4), to * 4); out.colors.set(splats.colors.subarray(from * 4, from * 4 + 4), to * 4); });
    return { ...splats, ...out, reducedFrom: splats.reducedFrom ?? count };
}
/** Scene centre and size that ignore stray floaters: the 2nd–98th percentile box of visible splats. */
export function splatBounds(splats, { trim = .02 } = {}) {
    const count = checkSplats(splats);
    if (!count) fail('This splat is empty.');
    if (!(trim >= 0 && trim < .5)) fail('Trim must be between 0 and 0.5.');
    const min = [], max = [];
    for (let k = 0; k < 3; k++) {
        const axis = new Float32Array(count);
        for (let i = 0; i < count; i++) axis[i] = splats.positions[i * 3 + k];
        axis.sort();
        min.push(axis[Math.floor(trim * (count - 1))]); max.push(axis[Math.ceil((1 - trim) * (count - 1))]);
    }
    const center = min.map((value, k) => (value + max[k]) / 2);
    return { min, max, center, radius: Math.max(1e-3, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2) };
}
const UPS = { y: [0, 1, 0], '-y': [0, -1, 0], z: [0, 0, 1], '-z': [0, 0, -1] };
/** A turntable camera around a splat's bounds. `up: '-y'` is the usual 3D Gaussian Splatting (COLMAP) convention; yaw 0 then looks along +z like the capture camera. */
export function splatOrbitCamera(bounds, { yaw = 0, pitch = 15, fov = 50, distance = 1.6, up = '-y' } = {}) {
    if (!bounds || !Array.isArray(bounds.center) || !(bounds.radius > 0)) fail('Pass bounds from splatBounds.');
    const axis = UPS[up] ?? fail('Choose up as y, -y, z or -z.');
    for (const [name, value, min, max] of [['yaw', yaw, -3600, 3600], ['pitch', pitch, -89, 89], ['fov', fov, 10, 120], ['distance', distance, .2, 20]]) if (typeof value !== 'number' || !(value >= min && value <= max)) fail(`Camera ${name} must be between ${min} and ${max}.`);
    // Build a frame with `axis` as up and orbit in the plane perpendicular to it.
    const side = Math.abs(axis[0]) > .5 ? [0, 1, 0] : [1, 0, 0], a = [side[1] * axis[2] - side[2] * axis[1], side[2] * axis[0] - side[0] * axis[2], side[0] * axis[1] - side[1] * axis[0]], b = [axis[1] * a[2] - axis[2] * a[1], axis[2] * a[0] - axis[0] * a[2], axis[0] * a[1] - axis[1] * a[0]];
    const y = yaw * Math.PI / 180, p = pitch * Math.PI / 180, reach = bounds.radius * distance / Math.tan(fov * Math.PI / 360);
    const eye = bounds.center.map((c, k) => c + reach * (Math.cos(p) * (Math.cos(y) * a[k] + Math.sin(y) * b[k]) + Math.sin(p) * axis[k]));
    return { eye, target: [...bounds.center], up: axis, fov };
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => { const l = Math.hypot(...a); return l > 1e-12 ? a.map(v => v / l) : fail('The camera looks at its own position.'); };
function hexRgb(value) { if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail('Background must be a six-digit hex colour.'); return [1, 3, 5].map(k => parseInt(value.slice(k, k + 2), 16)); }
/**
 * Draw splats into RGBA pixels with front-to-back elliptical Gaussian splatting (EWA projection, 16-bit depth bucket sort).
 * A CPU preview for thumbnails, cards and Node; a WebGL viewer is faster for live orbiting.
 */
export function renderSplats(splats, target, camera, { background = '#151719', maxRadius, signal } = {}) {
    const count = checkSplats(splats);
    const { width, height, data } = target ?? {};
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > SPLAT_LIMITS.side || height > SPLAT_LIMITS.side || !data || data.length !== width * height * 4) fail('Pass ImageData-like { width, height, data } up to 4096 px a side.');
    if (!camera || !Array.isArray(camera.eye) || !Array.isArray(camera.target) || !Array.isArray(camera.up) || !(camera.fov >= 10 && camera.fov <= 120)) fail('Pass a camera from splatOrbitCamera.');
    const bg = hexRgb(background), forward = unit(sub(camera.target, camera.eye)), right = unit(cross(forward, camera.up)), up = cross(right, forward);
    const focal = height / 2 / Math.tan(camera.fov * Math.PI / 360), cx = width / 2, cy = height / 2, limit = maxRadius ?? Math.max(width, height) / 2;
    // Pass 1: project to camera space and bucket by depth so near splats draw first.
    const depth = new Float32Array(count), visible = new Uint32Array(count);
    let shown = 0, near = Infinity, far = -Infinity;
    for (let i = 0; i < count; i++) {
        if (splats.colors[i * 4 + 3] < 2) continue;
        const d = sub([splats.positions[i * 3], splats.positions[i * 3 + 1], splats.positions[i * 3 + 2]], camera.eye), z = d[0] * forward[0] + d[1] * forward[1] + d[2] * forward[2];
        if (z < .01) continue;
        depth[i] = z; visible[shown++] = i;
        if (z < near) near = z; if (z > far) far = z;
    }
    const buckets = new Uint32Array(65537), order = new Uint32Array(shown), span = far > near ? 65535 / (far - near) : 0;
    for (let n = 0; n < shown; n++) buckets[((depth[visible[n]] - near) * span | 0) + 1]++;
    for (let b = 1; b < buckets.length; b++) buckets[b] += buckets[b - 1];
    for (let n = 0; n < shown; n++) order[buckets[(depth[visible[n]] - near) * span | 0]++] = visible[n];
    // Pass 2: composite each splat's ellipse front to back with per-pixel transmittance.
    const color = new Float32Array(width * height * 3), light = new Float32Array(width * height).fill(1);
    let drawn = 0;
    for (let n = 0; n < shown; n++) {
        if (signal?.aborted && !(n & 4095)) throw new DOMException('Splat rendering was cancelled.', 'AbortError');
        const i = order[n], p = [splats.positions[i * 3], splats.positions[i * 3 + 1], splats.positions[i * 3 + 2]], d = sub(p, camera.eye);
        const x = d[0] * right[0] + d[1] * right[1] + d[2] * right[2], y = d[0] * up[0] + d[1] * up[1] + d[2] * up[2], z = depth[i];
        const sx = cx + focal * x / z, sy = cy - focal * y / z;
        const [qw, qx, qy, qz] = splats.rotations.subarray(i * 4, i * 4 + 4), s = splats.scales.subarray(i * 3, i * 3 + 3);
        const R = [[1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qw * qz), 2 * (qx * qz + qw * qy)], [2 * (qx * qy + qw * qz), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qw * qx)], [2 * (qx * qz - qw * qy), 2 * (qy * qz + qw * qx), 1 - 2 * (qx * qx + qy * qy)]];
        // T = J·W maps world offsets to pixels; Σ' = T (R S)(R S)ᵀ Tᵀ.
        const t0 = right.map((r, k) => focal / z * r - focal * x / (z * z) * forward[k]), t1 = up.map((u, k) => -focal / z * u + focal * y / (z * z) * forward[k]);
        const m0 = [0, 1, 2].map(c => (t0[0] * R[0][c] + t0[1] * R[1][c] + t0[2] * R[2][c]) * s[c]), m1 = [0, 1, 2].map(c => (t1[0] * R[0][c] + t1[1] * R[1][c] + t1[2] * R[2][c]) * s[c]);
        const a = m0[0] * m0[0] + m0[1] * m0[1] + m0[2] * m0[2] + .3, b = m0[0] * m1[0] + m0[1] * m1[1] + m0[2] * m1[2], c = m1[0] * m1[0] + m1[1] * m1[1] + m1[2] * m1[2] + .3;
        const det = a * c - b * b;
        if (!(det > 0)) continue;
        const mid = (a + c) / 2, radius = Math.ceil(3 * Math.sqrt(mid + Math.sqrt(Math.max(.1, mid * mid - det))));
        if (radius > limit || sx + radius < 0 || sy + radius < 0 || sx - radius >= width || sy - radius >= height) continue;
        const ia = c / det, ib = -b / det, ic = a / det, opacity = splats.colors[i * 4 + 3] / 255, r = splats.colors[i * 4], g = splats.colors[i * 4 + 1], bl = splats.colors[i * 4 + 2];
        const x0 = Math.max(0, Math.floor(sx - radius)), x1 = Math.min(width - 1, Math.ceil(sx + radius)), y0 = Math.max(0, Math.floor(sy - radius)), y1 = Math.min(height - 1, Math.ceil(sy + radius));
        let touched = false;
        for (let py = y0; py <= y1; py++) {
            const dy = py + .5 - sy;
            for (let px = x0, pixel = py * width + x0; px <= x1; px++, pixel++) {
                const keep = light[pixel];
                if (keep < 1 / 255) continue;
                const dx = px + .5 - sx, power = -.5 * (ia * dx * dx + 2 * ib * dx * dy + ic * dy * dy);
                if (power > 0 || power < -5.5) continue;
                const alpha = Math.min(.99, opacity * Math.exp(power));
                if (alpha < 1 / 255) continue;
                const weight = alpha * keep;
                color[pixel * 3] += r * weight; color[pixel * 3 + 1] += g * weight; color[pixel * 3 + 2] += bl * weight;
                light[pixel] = keep * (1 - alpha); touched = true;
            }
        }
        if (touched) drawn++;
    }
    for (let pixel = 0; pixel < width * height; pixel++) {
        const keep = light[pixel];
        for (let k = 0; k < 3; k++) data[pixel * 4 + k] = clamp(Math.round(color[pixel * 3 + k] + bg[k] * keep), 0, 255);
        data[pixel * 4 + 3] = 255;
    }
    return { drawn, skipped: count - shown, splats: count };
}
/** Named turntable views for splat previews (degrees), matching the 3D stage's camera buttons. */
export const SPLAT_VIEWS = Object.freeze({ isometric: Object.freeze({ yaw: 35, pitch: 20 }), front: Object.freeze({ yaw: 0, pitch: 0 }), side: Object.freeze({ yaw: 90, pitch: 0 }), top: Object.freeze({ yaw: 0, pitch: 85 }) });
/** Read, budget and frame a splat file once, ready for an interactive still preview. */
export function prepareSplatPreview(value, { budget = SPLAT_LIMITS.preview, trim, format } = {}) {
    const full = readSplatFile(value, { format }), splats = reduceSplats(full, budget);
    return { splats, bounds: splatBounds(splats, { trim }), count: full.count, shown: splats.count, format: full.format, shade: full.shade, harmonics: full.harmonics };
}
/** Draw a prepared splat into a 2D canvas at a turntable view, at the canvas's own size (shrink the canvas for quick drafts while a slider moves). */
export function drawSplatPreview(canvas, preview, { yaw = SPLAT_VIEWS.isometric.yaw, pitch = SPLAT_VIEWS.isometric.pitch, distance = 1.6, fov = 50, up = '-y', background, signal } = {}) {
    const context = canvas?.getContext?.('2d');
    if (!context || typeof context.createImageData !== 'function') fail('Pass a canvas that can draw in 2D.');
    if (!preview?.splats || !preview.bounds) fail('Pass a preview from prepareSplatPreview.');
    const started = Date.now(), image = context.createImageData(canvas.width, canvas.height);
    const stats = renderSplats(preview.splats, image, splatOrbitCamera(preview.bounds, { yaw, pitch, fov, distance, up }), { background, signal });
    context.putImageData(image, 0, 0);
    return { ...stats, ms: Date.now() - started };
}
