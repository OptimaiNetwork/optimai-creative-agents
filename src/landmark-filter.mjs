/**
 * One-Euro filter (Casiez, Roussel and Vogel, CHI 2012): a low-pass whose cutoff
 * rises with speed, so values hold still at rest and follow fast moves without lag.
 * Timestamps are milliseconds (performance.now()); cutoffs are in Hz.
 */
export const ONE_EURO_DEFAULTS = Object.freeze({ minCutoff: 1, beta: 0, dCutoff: 1 });
const positive = (value, fallback) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(value, 1000) : fallback;
function settings(options = {}) {
    const o = options && typeof options === 'object' ? options : {};
    const beta = typeof o.beta === 'number' && Number.isFinite(o.beta) && o.beta >= 0 ? Math.min(o.beta, 1000) : ONE_EURO_DEFAULTS.beta;
    return { minCutoff: positive(o.minCutoff, ONE_EURO_DEFAULTS.minCutoff), beta, dCutoff: positive(o.dCutoff, ONE_EURO_DEFAULTS.dCutoff) };
}
/** Smoothing factor of a first-order low-pass at `cutoff` Hz over `dt` seconds. */
export function oneEuroAlpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }

/**
 * Vector One-Euro filter. Components are grouped in points of `stride` values
 * (2 for x,y landmarks, 3 for x,y,z); each point adapts its cutoff to its own
 * Euclidean speed, so diagonal moves are treated like straight ones.
 */
export function createOneEuroVectorFilter(size, options = {}) {
    const n = Number.isInteger(size) && size > 0 && size <= 65536 ? size : 0;
    if (!n) throw new RangeError('Vector filter size must be an integer from 1 to 65536.');
    const stride = Number.isInteger(options?.stride) && options.stride > 0 && n % options.stride === 0 ? options.stride : 1;
    const { minCutoff, beta, dCutoff } = settings(options);
    const value = new Float64Array(n), speed = new Float64Array(n);
    let last = NaN, primed = false;
    return {
        filter(input, timestamp) {
            if (!input || input.length !== n) throw new RangeError(`Expected ${n} values.`);
            if (!primed) {
                if (!Number.isFinite(timestamp)) return Array.from(value);
                for (let i = 0; i < n; i += 1) value[i] = Number.isFinite(input[i]) ? input[i] : 0;
                speed.fill(0); last = timestamp; primed = true;
                return Array.from(value);
            }
            // Repeated, reordered or missing timestamps cannot produce a rate; hold the output.
            if (!(timestamp > last)) return Array.from(value);
            const dt = (timestamp - last) / 1000, ad = oneEuroAlpha(dCutoff, dt);
            last = timestamp;
            for (let p = 0; p < n; p += stride) {
                let moving = 0;
                for (let i = p; i < p + stride; i += 1) {
                    const x = Number.isFinite(input[i]) ? input[i] : value[i];
                    speed[i] += ad * ((x - value[i]) / dt - speed[i]);
                    moving += speed[i] * speed[i];
                }
                const a = oneEuroAlpha(minCutoff + beta * Math.sqrt(moving), dt);
                for (let i = p; i < p + stride; i += 1) { const x = Number.isFinite(input[i]) ? input[i] : value[i]; value[i] += a * (x - value[i]); }
            }
            return Array.from(value);
        },
        reset() { primed = false; last = NaN; value.fill(0); speed.fill(0); },
        get value() { return primed ? Array.from(value) : null; },
        get size() { return n; },
        get stride() { return stride; },
    };
}

/** Scalar One-Euro filter: `filter(value, timestampMs)` returns the smoothed value. */
export function createOneEuroFilter(options = {}) {
    const vector = createOneEuroVectorFilter(1, options), one = [0];
    return {
        filter(x, timestamp) { one[0] = x; return vector.filter(one, timestamp)[0]; },
        reset() { vector.reset(); },
        get value() { return vector.value?.[0] ?? null; },
    };
}
