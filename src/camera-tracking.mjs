import { CAMERA_LIMITS } from './camera-runtime.mjs';
/** One frame in flight, including bitmap creation. Sync ML runs only in worker. */
export async function createFaceTracker(modelBuffer, options) {
    if (options.signal?.aborted)
        throw new DOMException('Tracking was cancelled.', 'AbortError');
    const origin = globalThis.location?.origin;
    if (!origin) throw new Error('Camera tracking runs in a secure browser worker.');
    if (typeof options.wasmBaseUrl !== 'string' || !options.wasmBaseUrl.trim()) throw new Error('Provide the host’s pinned same-origin tracking WASM path.');
    const wasm = new URL(options.wasmBaseUrl, origin);
    if (wasm.origin !== origin || !['http:', 'https:'].includes(wasm.protocol) || wasm.username || wasm.password || wasm.search || wasm.hash) throw new Error('The tracking WASM runtime must be hosted on this application’s origin.');
    const worker = options.workerFactory();
    let closed = false, pending = false, lastTimestamp = -Infinity, frameTimer = null;
    const cancelFrameTimer = () => { if (frameTimer)
        clearTimeout(frameTimer); frameTimer = null; };
    const dispose = () => { if (closed)
        return; closed = true; cancelFrameTimer(); worker.onmessage = null; worker.onerror = null; worker.terminate(); options.signal?.removeEventListener('abort', dispose); };
    try {
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => finish(new Error('Face tracking took too long to load. Filters and the demo are still available.')), CAMERA_LIMITS.modelInitTimeoutMs);
            let settled = false;
            const cancel = () => finish(new DOMException('Tracking was cancelled.', 'AbortError'));
            const finish = (reason) => { if (settled)
                return; settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); if (reason)
                reject(reason);
            else
                resolve(); };
            options.signal?.addEventListener('abort', cancel, { once: true });
            worker.onmessage = ({ data }) => { if (data?.type === 'ready')
                finish();
            else if (data?.type === 'error')
                finish(new Error(data.message)); };
            worker.onerror = () => finish(new Error('The local face tracking worker could not start.'));
            worker.postMessage({ type: 'init', modelBuffer, wasmBaseUrl: wasm.href.replace(/\/$/, '') }, [modelBuffer]);
        });
        if (options.signal?.aborted)
            throw new DOMException('Tracking was cancelled.', 'AbortError');
        options.signal?.addEventListener('abort', dispose, { once: true });
        const fail = (message) => { dispose(); options.onError(message); };
        worker.onmessage = ({ data }) => {
            if (closed)
                return;
            if (data?.type === 'error') {
                fail(data.message || 'Face tracking stopped. Please load tracking again.');
                return;
            }
            if (data?.type !== 'face')
                return;
            pending = false;
            cancelFrameTimer();
            const frame = data.frame;
            if (!frame || !Number.isFinite(frame.timestamp) || !Array.isArray(frame.matrix) || frame.matrix.length > 16 || !frame.matrix.every(Number.isFinite) || !Array.isArray(frame.anchors) || frame.anchors.length > 4 || !frame.anchors.every(point => Number.isFinite(point?.x) && Number.isFinite(point?.y)) || !frame.blendshapes || typeof frame.blendshapes !== 'object' || Object.keys(frame.blendshapes).length > 64 || !Object.values(frame.blendshapes).every(Number.isFinite)) {
                fail('The face tracker returned an invalid frame.');
                return;
            }
            options.onFace(frame);
        };
        worker.onerror = () => fail('Face tracking stopped unexpectedly. Filters and the demo are still available.');
        return {
            dispose,
            submit(canvas, timestamp) {
                if (closed || pending || !Number.isFinite(timestamp) || timestamp - lastTimestamp < CAMERA_LIMITS.trackingIntervalMs)
                    return false;
                pending = true;
                lastTimestamp = timestamp;
                frameTimer = setTimeout(() => fail('Face tracking became unresponsive. Load tracking again to restart it.'), CAMERA_LIMITS.trackingTimeoutMs);
                void (options.createBitmap ?? createImageBitmap)(canvas).then(bitmap => {
                    if (closed) {
                        bitmap.close();
                        return;
                    }
                    try {
                        worker.postMessage({ type: 'frame', bitmap, timestamp }, [bitmap]);
                    }
                    catch {
                        bitmap.close();
                        fail('This browser could not transfer the camera frame to its local tracker.');
                    }
                }).catch(() => { if (!closed)
                    fail('The camera frame could not be opened locally.'); });
                return true;
            },
        };
    }
    catch (reason) {
        dispose();
        throw reason;
    }
}
