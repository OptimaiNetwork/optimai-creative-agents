/** Browser-local video frame extraction and a 2.5D sculpture. No models, network or reconstruction. */
export const FRAME_SCULPTURE_LIMITS = Object.freeze({ bytes: 64 * 1024 * 1024, duration: 60, frames: 12, edge: 768, sourceEdge: 8192, sourcePixels: 33554432 });
export const defaultFrameSculptureSettings = Object.freeze({ layout: 'fan', spacing: .26, spread: .8, tilt: 12, opacity: 1, rotating: false, background: '#102031' });
const finite = (value, min, max, name) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}.`);
    return value;
};
export function validateFrameSculptureSettings(value) {
    const settings = { ...defaultFrameSculptureSettings, ...value };
    if (!['stack', 'fan', 'ribbon'].includes(settings.layout)) throw new Error('Choose a stack, fan or ribbon layout.');
    finite(settings.spacing, .04, .8, 'Frame spacing'); finite(settings.spread, 0, 2, 'Frame spread');
    finite(settings.tilt, -40, 40, 'Frame tilt'); finite(settings.opacity, .3, 1, 'Frame opacity');
    if (typeof settings.rotating !== 'boolean' || typeof settings.background !== 'string' || !/^#[0-9a-f]{6}$/i.test(settings.background)) throw new Error('Invalid stage settings.');
    return settings;
}
/** Sample inside each equal-duration interval, never exactly at the ended media position. */
export function frameSampleTimes(duration, count = 8) {
    finite(duration, .001, FRAME_SCULPTURE_LIMITS.duration, 'Video duration');
    if (!Number.isInteger(count) || count < 2 || count > FRAME_SCULPTURE_LIMITS.frames) throw new Error('Choose between 2 and 12 frames.');
    return Array.from({ length: count }, (_, index) => duration * (index + .5) / count);
}
export function frameTextureSize(width, height) {
    finite(width, 1, FRAME_SCULPTURE_LIMITS.sourceEdge, 'Media width'); finite(height, 1, FRAME_SCULPTURE_LIMITS.sourceEdge, 'Media height');
    if (width * height > FRAME_SCULPTURE_LIMITS.sourcePixels) throw new Error('Choose media up to 32 megapixels.');
    const scale = Math.min(1, FRAME_SCULPTURE_LIMITS.edge / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export function frameSculpturePose(index, count, value = defaultFrameSculptureSettings) {
    if (!Number.isInteger(count) || count < 1 || count > FRAME_SCULPTURE_LIMITS.frames || !Number.isInteger(index) || index < 0 || index >= count) throw new Error('Invalid frame index.');
    const settings = validateFrameSculptureSettings(value), middle = (count - 1) / 2, offset = index - middle;
    const normalized = count > 1 ? offset / middle : 0;
    return {
        // Spread against the depth axis: spreading toward the default camera
        // hid the earlier frames behind the last opaque plane.
        x: settings.layout === 'stack' || offset === 0 ? 0 : -offset * settings.spread * (settings.layout === 'ribbon' ? .65 : .48),
        y: settings.layout === 'ribbon' ? Math.sin(normalized * Math.PI / 2) * settings.spread * .4 : 0,
        z: offset * settings.spacing,
        rotationY: settings.layout === 'fan' ? normalized * settings.spread * .18 : 0,
        rotationZ: settings.tilt * Math.PI / 180 + (settings.layout === 'ribbon' ? normalized * .08 * settings.spread : 0),
    };
}
/** Default turntable clip: one full orbit in six seconds at 30 fps. */
export const FRAME_SCULPTURE_TURNTABLE = Object.freeze({ seconds: 6, fps: 30, degrees: 360, edge: 1280 });
/** Camera angle (radians) of turntable frame `frame` of `frames`: a full orbit never repeats its first frame, so the clip loops. */
export function turntableAngle(frame, frames, { degrees = FRAME_SCULPTURE_TURNTABLE.degrees } = {}) {
    if (!Number.isInteger(frames) || frames < 1 || !Number.isInteger(frame) || frame < 0 || frame >= frames) throw new Error('Invalid turntable frame.');
    if (typeof degrees !== 'number' || !Number.isFinite(degrees) || degrees === 0 || Math.abs(degrees) > 720) throw new Error('Turntable degrees must be a non-zero number from -720 to 720.');
    return degrees * Math.PI / 180 * frame / frames;
}
/** Even video sides for a stage aspect ratio, the longer side `edge` (2–1920). */
export function turntableSize(aspect, edge = FRAME_SCULPTURE_TURNTABLE.edge) {
    if (!Number.isInteger(edge) || edge < 2 || edge > 1920) throw new Error('Turntable edge must be a whole number from 2 to 1920.');
    const ratio = typeof aspect === 'number' && Number.isFinite(aspect) && aspect > 0 ? Math.min(4, Math.max(.25, aspect)) : 16 / 9;
    const even = value => Math.max(2, Math.round(value / 2) * 2);
    return ratio >= 1 ? { width: even(edge), height: even(edge / ratio) } : { width: even(edge * ratio), height: even(edge) };
}
export function releaseFrameSamples(frames) { frames.forEach(frame => { frame.canvas.width = 0; frame.canvas.height = 0; }); }
/** Validate ownership before textures are allocated or the previous composition is released. */
export function validateFrameSamples(next, owned = []) {
    if (!Array.isArray(next) || next.length < 1 || next.length > FRAME_SCULPTURE_LIMITS.frames) throw new Error('Supply between 1 and 12 captured frames.');
    const current = new Set(owned.map(frame => frame.canvas)), unique = new Set();
    for (const frame of next) {
        if (!frame?.canvas || typeof frame.canvas.getContext !== 'function' || frame.canvas.width < 1 || frame.canvas.height < 1 || Math.max(frame.canvas.width, frame.canvas.height) > FRAME_SCULPTURE_LIMITS.edge || !Number.isFinite(frame.time) || frame.time < 0) throw new Error('Supply valid bounded canvas frames.');
        if (current.has(frame.canvas)) throw new Error('These frames already belong to the stage. Capture new samples before replacing them.');
        if (unique.has(frame.canvas)) throw new Error('Each frame sample must own a distinct canvas.');
        unique.add(frame.canvas);
    }
}
function cancelled(signal) { if (signal?.aborted) throw new DOMException('Frame extraction cancelled.', 'AbortError'); }
function eventAfter(target, event, start, signal, timeout = 20000) {
    cancelled(signal);
    return new Promise((resolve, reject) => {
        const finish = (error) => { clearTimeout(timer); target.removeEventListener(event, done); target.removeEventListener('error', failed); signal?.removeEventListener('abort', aborted); error ? reject(error) : resolve(); };
        const done = () => finish(), failed = () => finish(new Error('This media could not be decoded. Try an MP4 (H.264) or WebM video, or a PNG/JPEG/WebP image.'));
        const aborted = () => finish(new DOMException('Frame extraction cancelled.', 'AbortError'));
        const timer = setTimeout(() => finish(new Error('This media took too long to decode. Try a shorter or smaller file.')), timeout);
        target.addEventListener(event, done, { once: true }); target.addEventListener('error', failed, { once: true }); signal?.addEventListener('abort', aborted, { once: true });
        try { start(); } catch (error) { finish(error); }
    });
}
function captureFrame(source, sourceWidth, sourceHeight, time) {
    const size = frameTextureSize(sourceWidth, sourceHeight), canvas = document.createElement('canvas');
    canvas.width = size.width; canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not prepare frame textures.');
    context.drawImage(source, 0, 0, size.width, size.height);
    return { canvas, time };
}
/** Decode only the selected local file. Blob URLs and decoder resources are always released. */
// The positional (complete, total) arguments stay; the third is the canonical progress event.
const frameEvent = (frame, frames) => Object.freeze({ stage: 'frame', message: 'Sampling frames on this device.', frame, frames, progress: frame / frames });
export async function extractFrameSamples(file, { count = 8, signal, onProgress = () => {} } = {}) {
    cancelled(signal);
    if (!file || typeof file.size !== 'number' || !Number.isFinite(file.size) || file.size <= 0 || file.size > FRAME_SCULPTURE_LIMITS.bytes) throw new Error('Choose a local video or image up to 64 MB.');
    const videoFile = /^video\//i.test(file.type) || /\.(mp4|webm|mov|m4v)$/i.test(file.name ?? '');
    const imageFile = /^(image\/(png|jpeg|webp))$/i.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name ?? '');
    if (!videoFile && !imageFile) throw new Error('Use MP4/WebM video or a PNG/JPEG/WebP image. Animated GIF extraction is not supported.');
    // Validate before touching the browser decoder or creating a blob URL.
    if (videoFile && (!Number.isInteger(count) || count < 2 || count > FRAME_SCULPTURE_LIMITS.frames)) throw new Error('Choose between 2 and 12 frames.');
    const url = URL.createObjectURL(file), source = document.createElement(videoFile ? 'video' : 'img'), frames = [];
    try {
        if (!videoFile) {
            await eventAfter(source, 'load', () => { source.src = url; }, signal);
            cancelled(signal); frames.push(captureFrame(source, source.naturalWidth, source.naturalHeight, 0)); onProgress(1, 1, frameEvent(1, 1));
            return { frames, duration: 0, name: file.name ?? 'Local image', kind: 'image' };
        }
        source.preload = 'auto'; source.muted = true; source.playsInline = true;
        // Wait for a drawable frame as well as metadata; readyState alone does not confirm a seek completed.
        await eventAfter(source, 'loadeddata', () => { source.src = url; source.load(); }, signal);
        frameTextureSize(source.videoWidth, source.videoHeight);
        const duration = source.duration, times = frameSampleTimes(duration, count);
        for (const time of times) {
            cancelled(signal);
            await eventAfter(source, 'seeked', () => { source.currentTime = time; }, signal);
            cancelled(signal);
            if (source.readyState < 2) await eventAfter(source, 'loadeddata', () => {}, signal);
            cancelled(signal); frames.push(captureFrame(source, source.videoWidth, source.videoHeight, time)); onProgress(frames.length, times.length, frameEvent(frames.length, times.length));
        }
        return { frames, duration, name: file.name ?? 'Local video', kind: 'video' };
    } catch (error) { releaseFrameSamples(frames); throw error; }
    finally {
        if (videoFile) { source.pause(); source.removeAttribute('src'); source.load(); } else source.removeAttribute('src');
        URL.revokeObjectURL(url);
    }
}
/** An original illustrated demo, clearly separated from user video frames. */
export function createFrameSculptureDemo() {
    const frames = [];
    try {
        for (let index = 0; index < 8; index++) {
            const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 440;
            const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas preview unavailable.');
            const gradient = context.createLinearGradient(0, 0, 640, 440); gradient.addColorStop(0, '#10223f'); gradient.addColorStop(1, '#314e68'); context.fillStyle = gradient; context.fillRect(0, 0, 640, 440);
            context.strokeStyle = '#aecde418'; context.lineWidth = 1;
            for (let x = 0; x < 640; x += 40) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, 440); context.stroke(); }
            for (let y = 0; y < 440; y += 40) { context.beginPath(); context.moveTo(0, y); context.lineTo(640, y); context.stroke(); }
            const x = 180 + index * 35, y = 220 + Math.sin(index * .8) * 55;
            const orb = context.createRadialGradient(x - 24, y - 30, 5, x, y, 108); orb.addColorStop(0, '#fff5ce'); orb.addColorStop(.45, '#ffc474'); orb.addColorStop(1, '#ed784f'); context.fillStyle = orb; context.beginPath(); context.arc(x, y, 92, 0, Math.PI * 2); context.fill();
            context.strokeStyle = '#e9f8ffc0'; context.lineWidth = 5; context.beginPath(); context.ellipse(x, y, 148, 28, -.45 + index * .04, 0, Math.PI * 2); context.stroke();
            context.fillStyle = '#eaf2ff'; context.font = '600 20px sans-serif'; context.fillText(`MOTION STUDY / ${String(index + 1).padStart(2, '0')}`, 30, 40);
            context.fillStyle = '#bfd0dd'; context.font = '16px sans-serif'; context.fillText('Illustrated demo · replace with your video', 30, 407);
            frames.push({ canvas, time: index });
        }
        return frames;
    } catch (error) { releaseFrameSamples(frames); throw error; }
}
export async function createFrameSculptureStage(container, initial = defaultFrameSculptureSettings, { runtime, onError = () => {}, signal, motion } = {}) {
    cancelled(signal);
    const resolved = runtime ?? await Promise.all([import('three'), import('three/addons/controls/OrbitControls.js')]).then(([THREE, controls]) => ({ THREE, OrbitControls: controls.OrbitControls }));
    cancelled(signal);
    const controller = createFrameSculptureStageWithRuntime(container, initial, onError, resolved, { motion });
    if (signal) {
        const dispose = controller.dispose, abort = () => controller.dispose(); signal.addEventListener('abort', abort, { once: true });
        controller.dispose = () => { signal.removeEventListener('abort', abort); dispose(); };
        if (signal.aborted) { controller.dispose(); cancelled(signal); }
    }
    return controller;
}
/** Host adapter: the host supplies its bundled/reviewed optional Three dependency. */
export function createFrameSculptureStageWithRuntime(container, initial, onError = () => {}, { THREE, OrbitControls } = {}, { motion: motionPreference } = {}) {
    let settings = validateFrameSculptureSettings(initial);
    if (!container?.appendChild || !THREE?.WebGLRenderer || !OrbitControls) throw new Error('Provide a mounted container and a reviewed Three.js runtime.');
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'default' });
    let controls, resizeObserver, intersectionObserver, grid, root, reduced, disposed = false, contextLost = false, exporting = false, animation = 0, lastTime = 0, visible = !document.hidden, intersecting = true, drawingMotion = false;
    const meshes = [], samples = [], resources = new Set(), listeners = [];
    const listen = (target, type, callback) => { target.addEventListener(type, callback); listeners.push(() => target.removeEventListener(type, callback)); };
    function disposeMesh(mesh) { mesh.geometry.dispose(); mesh.material.map?.dispose(); mesh.material.dispose(); }
    function clearFrames() { meshes.splice(0).forEach(mesh => { root.remove(mesh); disposeMesh(mesh); }); releaseFrameSamples(samples.splice(0)); }
    function dispose() {
        if (disposed) return; disposed = true; if (animation) cancelAnimationFrame(animation); animation = 0;
        resizeObserver?.disconnect(); intersectionObserver?.disconnect(); listeners.splice(0).forEach(remove => remove()); controls?.dispose();
        if (root) clearFrames(); resources.forEach(resource => resource.dispose()); resources.clear(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    }
    try {
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.domElement.tabIndex = 0; renderer.domElement.setAttribute('aria-label', 'Interactive frame sculpture. Drag to orbit and pinch to zoom. Camera view buttons are below.');
        Object.assign(renderer.domElement.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none' }); container.appendChild(renderer.domElement);
        const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38, 1, .05, 100);
        scene.background = new THREE.Color(settings.background); root = new THREE.Group(); scene.add(root);
        grid = new THREE.GridHelper(20, 40, '#677485', '#293f53'); grid.position.y = -2.3; scene.add(grid); resources.add(grid.geometry); (Array.isArray(grid.material) ? grid.material : [grid.material]).forEach(material => resources.add(material));
        controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = false; controls.minDistance = 2; controls.maxDistance = 40; controls.autoRotateSpeed = .8;
        reduced = motionPreference ?? window.matchMedia('(prefers-reduced-motion: reduce)');
        const render = () => { if (!disposed && !contextLost && visible && intersecting) renderer.render(scene, camera); };
        function tick(time) {
            animation = 0; if (disposed || contextLost || !visible || !intersecting || !settings.rotating || reduced.matches) return;
            drawingMotion = true; controls.autoRotate = true; controls.update(lastTime ? Math.min((time - lastTime) / 1000, .05) : 0); drawingMotion = false; lastTime = time; render(); animation = requestAnimationFrame(tick);
        }
        function motion() { if (exporting) { if (animation) cancelAnimationFrame(animation); animation = 0; return; } if (animation) cancelAnimationFrame(animation); animation = 0; lastTime = 0; controls.autoRotate = false; render(); if (!disposed && !contextLost && visible && intersecting && settings.rotating && !reduced.matches) animation = requestAnimationFrame(tick); }
        function resize() { if (disposed || exporting) return; const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight), scale = Math.min(1, 1600 / width, 1200 / height); renderer.setSize(Math.round(width * scale), Math.round(height * scale), false); camera.aspect = width / height; camera.updateProjectionMatrix(); render(); }
        function layout() {
            meshes.forEach((mesh, index) => { const pose = frameSculpturePose(index, meshes.length, settings); mesh.position.set(pose.x, pose.y, pose.z); mesh.rotation.set(0, pose.rotationY, pose.rotationZ); mesh.material.opacity = settings.opacity; mesh.material.transparent = settings.opacity < 1; mesh.material.depthWrite = settings.opacity === 1; mesh.material.needsUpdate = true; });
            scene.background.set(settings.background); render();
        }
        function fit(preset = 'perspective') {
            if (disposed) return;
            const box = new THREE.Box3().setFromObject(root), center = new THREE.Vector3(), size = new THREE.Vector3(); box.getCenter(center); box.getSize(size);
            if (!meshes.length) { center.set(0, 0, 0); size.set(4, 3, 3); }
            const radius = Math.max(size.length() / 2, 2), halfAngle = Math.min(camera.fov * Math.PI / 360, Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect)), distance = Math.max(4, radius / Math.sin(halfAngle) * 1.08);
            const direction = preset === 'front' ? new THREE.Vector3(0, .02, 1) : preset === 'side' ? new THREE.Vector3(1, .12, .18) : new THREE.Vector3(.95, .5, 1.15);
            direction.normalize(); camera.position.copy(center).addScaledVector(direction, distance); controls.target.copy(center); controls.maxDistance = Math.max(40, distance * 2); camera.far = Math.max(100, distance * 4); camera.updateProjectionMatrix(); controls.update(); render();
        }
        listen(controls, 'change', () => { if (!drawingMotion) render(); });
        listen(document, 'visibilitychange', () => { visible = !document.hidden; motion(); }); listen(reduced, 'change', motion);
        listen(renderer.domElement, 'webglcontextlost', event => { event.preventDefault(); contextLost = true; if (animation) cancelAnimationFrame(animation); animation = 0; onError('The graphics preview paused. Close and reopen Frame Sculpture to restore it.'); });
        if (typeof ResizeObserver !== 'undefined') { resizeObserver = new ResizeObserver(resize); resizeObserver.observe(container); } else listen(window, 'resize', resize);
        if (typeof IntersectionObserver !== 'undefined') { intersectionObserver = new IntersectionObserver(entries => { intersecting = entries[0]?.isIntersecting ?? true; motion(); }); intersectionObserver.observe(container); }
        resize(); fit(); motion();
        return {
            /** Takes ownership only after validating all supplied frames. */
            frames(next) {
                if (disposed || contextLost) throw new Error('The graphics preview is unavailable. Close and reopen this tool.');
                if (!Array.isArray(next) || next.length < 1 || next.length > FRAME_SCULPTURE_LIMITS.frames) throw new Error('Supply 1 to 12 decoded frames.');
                validateFrameSamples(next, samples);
                const prepared = [];
                try {
                    next.forEach(frame => {
                        const texture = new THREE.CanvasTexture(frame.canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;
                        let geometry, material;
                        try { geometry = new THREE.PlaneGeometry(3.8, 3.8 * frame.canvas.height / frame.canvas.width); material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }); const mesh = new THREE.Mesh(geometry, material); prepared.push(mesh); }
                        catch (error) { texture.dispose(); geometry?.dispose(); material?.dispose(); throw error; }
                    });
                } catch (error) { prepared.forEach(disposeMesh); throw error; }
                clearFrames(); samples.push(...next); meshes.push(...prepared); meshes.forEach(mesh => root.add(mesh)); layout(); fit();
            },
            update(next) { if (disposed) return; settings = validateFrameSculptureSettings(next); layout(); motion(); },
            camera(preset) { if (!['perspective', 'front', 'side'].includes(preset)) throw new Error('Choose a supported camera view.'); fit(preset); },
            fit() { fit(); },
            zoom(direction) { if (disposed) return; if (!['in', 'out'].includes(direction)) throw new Error('Choose zoom in or out.'); const delta = camera.position.clone().sub(controls.target), length = Math.min(controls.maxDistance, Math.max(controls.minDistance, delta.length() * (direction === 'in' ? .82 : 1.22))); camera.position.copy(controls.target).add(delta.setLength(length)); controls.update(); render(); },
            configuration() { return { version: 1, type: 'optimai-frame-sculpture', dimension: '2.5D', settings: { ...settings }, frames: samples.map(frame => ({ time: frame.time, width: frame.canvas.width, height: frame.canvas.height })), camera: { position: camera.position.toArray(), target: controls.target.toArray() } }; },
            /**
             * Orbit the current view around its target for a video export: returns a 2D `canvas` at even video sides
             * (from the stage's aspect, longer side `edge`, or explicit `width`/`height`) and `draw(frame, frames)`.
             * The stage stays still and keeps its camera; `close()` restores it.
             */
            turntable({ width, height, edge = FRAME_SCULPTURE_TURNTABLE.edge, degrees = FRAME_SCULPTURE_TURNTABLE.degrees } = {}) {
                if (disposed || contextLost || !meshes.length) throw new Error('Prepare a frame sculpture before exporting a turntable.');
                if (exporting) throw new Error('A turntable export is already running.');
                turntableAngle(0, 1, { degrees });
                const side = value => Number.isInteger(value) && value >= 2 && value <= 1920 && value % 2 === 0;
                if (width !== undefined || height !== undefined) { if (!side(width) || !side(height)) throw new Error('Turntable sides must be even whole numbers from 2 to 1920.'); }
                else ({ width, height } = turntableSize(container.clientWidth / Math.max(1, container.clientHeight), edge));
                const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
                const context = canvas.getContext('2d'); if (!context) throw new Error('Turntable export is unavailable.');
                const target = controls.target.clone(), start = camera.position.clone(), offset = start.clone().sub(target), up = new THREE.Vector3(0, 1, 0);
                const saved = { ratio: renderer.getPixelRatio(), aspect: camera.aspect, rotating: controls.autoRotate };
                exporting = true; motion(); controls.enabled = false; controls.autoRotate = false;
                renderer.setPixelRatio(1); renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
                let closed = false;
                return Object.freeze({
                    canvas, width, height, degrees,
                    draw(frame, frames) {
                        if (closed || disposed || contextLost) throw new Error('This turntable was closed.');
                        camera.position.copy(target).add(offset.clone().applyAxisAngle(up, turntableAngle(frame, frames, { degrees }))); camera.lookAt(target);
                        renderer.render(scene, camera); context.drawImage(renderer.domElement, 0, 0, width, height);
                    },
                    close() {
                        if (closed) return; closed = true; exporting = false; canvas.width = 0; canvas.height = 0;
                        if (disposed) return;
                        controls.enabled = true; controls.autoRotate = saved.rotating; camera.position.copy(start); camera.lookAt(target);
                        renderer.setPixelRatio(saved.ratio); camera.aspect = saved.aspect; camera.updateProjectionMatrix(); resize(); controls.update(); motion();
                    },
                });
            },
            async png() {
                if (disposed || contextLost || !meshes.length) throw new Error('Prepare a frame sculpture before saving it.');
                // Render synchronously immediately before copying; no persistent drawing buffer is needed.
                renderer.render(scene, camera); const copy = document.createElement('canvas'); copy.width = renderer.domElement.width; copy.height = renderer.domElement.height;
                const context = copy.getContext('2d'); if (!context) throw new Error('Snapshot export is unavailable.'); context.drawImage(renderer.domElement, 0, 0);
                try { return await new Promise((resolve, reject) => copy.toBlob(blob => blob ? resolve(blob) : reject(new Error('The snapshot could not be saved.')), 'image/png')); }
                finally { copy.width = 0; copy.height = 0; }
            }, dispose,
        };
    } catch (error) { dispose(); throw error; }
}
