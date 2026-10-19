import { createOneEuroVectorFilter } from './landmark-filter.mjs';
export const CAMERA_LIMITS = Object.freeze({ width: 1280, height: 720, fps: 30, trackingIntervalMs: 100, trackingTimeoutMs: 8000, modelInitTimeoutMs: 45000, recordingSeconds: 30, recordingBytes: 32 * 1024 * 1024, imageBytes: 20 * 1024 * 1024, imageDimension: 4096, imagePixels: 16_000_000, videoBytes: 50 * 1024 * 1024, videoSeconds: 60 });
export const NEUTRAL_FACE = Object.freeze({ yaw: 0, pitch: 0, roll: 0, jaw: 0, smile: 0, blinkLeft: 0, blinkRight: 0, brow: 0 });
/** Reviewed scalar recipe controls; recipe data never supplies code or URLs. */
export function cameraRecipeSettings(agentId, values = {}) {
    const effects = { studio: 'clean', neon: 'neon', prism: 'prism', duotone: 'duotone', film: 'film', halo: 'halo' };
    const safe = values && typeof values === 'object' && !Array.isArray(values) && [Object.prototype, null].includes(Object.getPrototypeOf(values)) ? values : {};
    const scalar = key => { const descriptor = Object.getOwnPropertyDescriptor(safe, key); return descriptor && 'value' in descriptor ? descriptor.value : undefined; };
    const effect = scalar('effect'), look = scalar('look'), intensity = scalar('intensity'), mirror = scalar('mirror');
    return { effect: typeof effect === 'string' && Object.hasOwn(effects, effect) ? effects[effect] : 'neon', look: ['orbit', 'luna', 'pixel'].includes(look) ? look : 'orbit', strength: typeof intensity === 'number' && Number.isFinite(intensity) ? bounded(intensity, 0, 100) / 100 : .8, mirror: mirror !== 'no', avatar: agentId === 'avatar-stage' };
}
export function bounded(value, min = 0, max = 1) { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min; }
/** MediaPipe matrices are column-major; mirroring happens after inference. */
export function faceRigFromFrame(frame, mirror = false) {
    if (!frame?.found)
        return { ...NEUTRAL_FACE };
    const b = frame.blendshapes, m = frame.matrix;
    const valid = m.length === 16 && m.every(Number.isFinite);
    const sign = mirror ? -1 : 1;
    return {
        yaw: valid ? bounded(Math.atan2(m[8], m[10]) * sign, -0.9, 0.9) : 0,
        pitch: valid ? bounded(Math.atan2(-m[9], Math.hypot(m[8], m[10])), -0.65, 0.65) : 0,
        roll: valid ? bounded(Math.atan2(m[1], m[5]) * sign, -0.6, 0.6) : 0,
        jaw: bounded(b.jawOpen), smile: bounded((bounded(b.mouthSmileLeft) + bounded(b.mouthSmileRight)) / 2),
        blinkLeft: bounded(mirror ? b.eyeBlinkRight : b.eyeBlinkLeft), blinkRight: bounded(mirror ? b.eyeBlinkLeft : b.eyeBlinkRight),
        brow: bounded(b.browInnerUp),
    };
}
export function smoothFaceRig(current, target, elapsedMs) {
    const alpha = 1 - Math.exp(-bounded(elapsedMs, 0, 100) / 80);
    return Object.fromEntries(Object.keys(NEUTRAL_FACE).map(key => { const k = key; return [k, current[k] + (target[k] - current[k]) * alpha]; }));
}
/** Default One-Euro tuning: head pose in radians, expressions in 0–1 coefficients. */
export const FACE_RIG_FILTER = Object.freeze({ pose: Object.freeze({ minCutoff: .6, beta: 3, dCutoff: 1 }), expression: Object.freeze({ minCutoff: 1.5, beta: 6, dCutoff: 1 }) });
const POSE_KEYS = ['yaw', 'pitch', 'roll'], EXPRESSION_KEYS = ['jaw', 'smile', 'blinkLeft', 'blinkRight', 'brow'];
/**
 * Speed-adaptive rig smoothing: still at rest, no lag on fast turns or blinks.
 * Head rotation adapts to its combined angular speed; each expression adapts on its own.
 */
export function createFaceRigSmoother(options = {}) {
    const o = options && typeof options === 'object' ? options : {};
    const pose = createOneEuroVectorFilter(3, { ...FACE_RIG_FILTER.pose, ...(o.pose ?? {}), stride: 3 });
    const expression = createOneEuroVectorFilter(5, { ...FACE_RIG_FILTER.expression, ...(o.expression ?? {}), stride: 1 });
    return {
        next(target, timestamp) {
            const t = target && typeof target === 'object' ? target : NEUTRAL_FACE;
            const value = key => typeof t[key] === 'number' && Number.isFinite(t[key]) ? t[key] : NEUTRAL_FACE[key];
            const p = pose.filter(POSE_KEYS.map(value), timestamp), e = expression.filter(EXPRESSION_KEYS.map(value), timestamp);
            return { yaw: p[0], pitch: p[1], roll: p[2], jaw: e[0], smile: e[1], blinkLeft: e[2], blinkRight: e[3], brow: e[4] };
        },
        reset() { pose.reset(); expression.reset(); },
    };
}
export function faceRigAt(frame, now, mirror = false) {
    return faceRigFromFrame(frame && now - frame.timestamp <= 500 && now >= frame.timestamp ? frame : null, mirror);
}
export function demoFaceRig(seconds) {
    return { yaw: Math.sin(seconds * .6) * .25, pitch: Math.sin(seconds * .43) * .08, roll: Math.sin(seconds * .32) * .05, jaw: Math.max(0, Math.sin(seconds * 2.2)) * .35, smile: .4 + Math.sin(seconds * .7) * .2, blinkLeft: Math.pow(Math.max(0, Math.cos(seconds * 1.5)), 30), blinkRight: Math.pow(Math.max(0, Math.cos(seconds * 1.5)), 30), brow: .15 };
}
/** A late permission dialog completion cannot revive a closed/hidden camera. */
export function createCameraLease() {
    let epoch = 0, closed = false, active = null;
    const stopStream = (stream) => { for (const track of stream?.getTracks() ?? [])
        track.stop(); };
    return {
        stop() { epoch += 1; stopStream(active); active = null; },
        close() { closed = true; this.stop(); },
        async start(getMedia) {
            if (closed)
                return null;
            this.stop();
            const token = epoch;
            const stream = await getMedia();
            if (closed || token !== epoch) {
                stopStream(stream);
                return null;
            }
            active = stream;
            return stream;
        },
        get active() { return active; },
    };
}
export function cameraPermissionMessage(reason) {
    const name = reason instanceof Error || (typeof reason === 'object' && reason) ? reason.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError')
        return 'Camera access was not granted. You can still try the demo or open a local portrait.';
    if (name === 'NotFoundError')
        return 'No camera was found. Open a local portrait or try the demo instead.';
    if (name === 'NotReadableError')
        return 'The camera is busy in another app. Close it there, or open a local portrait.';
    return 'The camera could not start. Try a current browser over HTTPS, or open a local portrait.';
}
/** Fit without stretching; anchors use this same crop transform. */
export function coverCrop(width, height, targetWidth, targetHeight) {
    const scale = Math.max(targetWidth / width, targetHeight / height);
    const drawnWidth = width * scale, drawnHeight = height * scale;
    return { scale, x: (targetWidth - drawnWidth) / 2, y: (targetHeight - drawnHeight) / 2, width: drawnWidth, height: drawnHeight };
}
