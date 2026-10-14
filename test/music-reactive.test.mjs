import assert from 'node:assert/strict';
import test from 'node:test';
import { MUSIC_REACTIVE_LIMITS, MUSIC_REACTIVE_LOOKS, extractMusicReactiveFeatures, smoothMusicReactiveFeatures, renderMusicReactiveFrame } from '../src/music-reactive.mjs';

const silent = () => ({ energy: 0, bass: 0, treble: 0, bands: Array(48).fill(0) });
const full = () => ({ energy: 1, bass: 1, treble: 1, bands: Array(48).fill(1) });
const near = (actual, expected, epsilon = 1e-10) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} differs from ${expected}`);

function contextHarness({ throwOnStroke = false } = {}) {
  const trace = [], state = { depth: 0, restored: 0 };
  const append = (method, args) => {
    for (const value of args) if (typeof value === 'number') assert.ok(Number.isFinite(value), `${method} supplied a non-finite coordinate.`);
    trace.push([method, ...args]);
  };
  const ctx = new Proxy({
    save() { state.depth++; append('save', []); },
    restore() { state.depth--; state.restored++; append('restore', []); },
    measureText(text) { append('measureText', [text]); return { width: Array.from(text).length * 16 }; },
    createLinearGradient(...args) { append('linearGradient', args); return { addColorStop(...stop) { append('colorStop', stop); } }; },
    createRadialGradient(...args) { append('radialGradient', args); return { addColorStop(...stop) { append('colorStop', stop); } }; },
  }, {
    set(target, key, value) { append(`set:${String(key)}`, [typeof value === 'object' ? 'gradient' : value]); target[key] = value; return true; },
    get(target, key) {
      if (key in target) return target[key];
      return (...args) => { append(String(key), args); if (key === 'stroke' && throwOnStroke) throw new Error('drawing failed'); };
    },
  });
  return { ctx, trace, state };
}
const frame = (look = 'orbital') => ({ width: 1280, height: 720, time: 14.5, energy: .47, bass: .61, treble: .23, look, intensity: .8, title: 'Where the light goes', artist: 'Your next release' });

test('public looks are distinct, deeply frozen, and package export resolves to the portable runtime', async () => {
  assert.equal(MUSIC_REACTIVE_LOOKS.length, 4);
  assert.equal(new Set(MUSIC_REACTIVE_LOOKS.map(look => look.id)).size, 4);
  assert.ok(Object.isFrozen(MUSIC_REACTIVE_LOOKS) && MUSIC_REACTIVE_LOOKS.every(Object.isFrozen));
  assert.ok(Object.isFrozen(MUSIC_REACTIVE_LIMITS));
  for (const look of MUSIC_REACTIVE_LOOKS) assert.ok(look.title && look.description);
  const exported = await import('@optimai/creative-agents/music-reactive');
  assert.equal(exported.renderMusicReactiveFrame, renderMusicReactiveFrame);
});

test('frequency extraction maps real FFT frequencies, separates low / high tones and excludes DC', () => {
  const bytes = new Uint8Array(512);
  bytes[3] = 255; // 140.625 Hz with 48 kHz / 1024 FFT.
  let features = extractMusicReactiveFeatures(bytes, { sampleRate: 48000, fftSize: 1024 });
  near(features.bass, .2); near(features.treble, 0);
  assert.ok(features.energy > 0 && features.energy < features.bass);
  assert.equal(features.bands.length, 48);
  assert.ok(features.bands.some(value => value > 0));
  bytes.fill(0); bytes[64] = 255; // 3,000 Hz.
  features = extractMusicReactiveFeatures(bytes, { sampleRate: 48000, fftSize: 1024 });
  near(features.bass, 0); assert.ok(features.treble > 0);
  bytes.fill(0); bytes[0] = 255; bytes[400] = 255; // DC and inaudible-to-this-display high range.
  assert.deepEqual(extractMusicReactiveFeatures(bytes, { sampleRate: 48000, fftSize: 1024 }), silent());
});

test('shortened buffers retain actual bin frequencies and sample-rate changes move the signal into the proper band', () => {
  const bytes = new Uint8Array(100); bytes[10] = 255;
  const high = extractMusicReactiveFeatures(bytes, { sampleRate: 48000, fftSize: 1024 });
  const low = extractMusicReactiveFeatures(bytes, { sampleRate: 8000, fftSize: 1024 });
  near(high.bass, 0); assert.ok(low.bass > 0);
  const large = new Uint8Array(65536).fill(255);
  const valid = new Uint8Array(1024).fill(255);
  assert.deepEqual(extractMusicReactiveFeatures(large), extractMusicReactiveFeatures(valid), 'Excess frequency bytes beyond FFT bin count must not be processed.');
});

test('audio features are normalized, silence is exact, inputs are untouched and invalid analysis configuration is rejected', () => {
  assert.deepEqual(extractMusicReactiveFeatures(new Uint8Array()), silent());
  assert.deepEqual(extractMusicReactiveFeatures(new Uint8Array(1024)), silent());
  const data = new Uint8Array(1024).fill(255), copy = data.slice();
  const features = extractMusicReactiveFeatures(data);
  assert.deepEqual(features, full()); assert.deepEqual(data, copy);
  for (const input of [[], new Float32Array(1024), 'remote audio']) assert.throws(() => extractMusicReactiveFeatures(input), /Uint8Array/);
  for (const fftSize of [0, 31, 1000, 65536, Infinity]) assert.throws(() => extractMusicReactiveFeatures(data, { fftSize }), /FFT/);
  for (const sampleRate of [0, 7999, 192001, NaN]) assert.throws(() => extractMusicReactiveFeatures(data, { sampleRate }), /sample rate/);
});

test('temporal smoothing has equal results at 30 / 60 fps and slower release than attack', () => {
  const advance = (target, fps) => {
    let value = silent();
    for (let step = 0; step < fps; step++) value = smoothMusicReactiveFeatures(value, target, 1000 / fps);
    return value;
  };
  const a = advance(full(), 30), b = advance(full(), 60);
  near(a.energy, b.energy); a.bands.forEach((value, index) => near(value, b.bands[index]));
  const attack = smoothMusicReactiveFeatures(silent(), full(), 80);
  const release = smoothMusicReactiveFeatures(full(), silent(), 80);
  near(attack.energy, 1 - Math.exp(-1));
  assert.ok(release.energy > 1 - attack.energy, 'Release should soften abrupt decay.');
});

test('smoothing resets after seeks, rejects invalid scalars by bounding and never mutates caller state', () => {
  const before = full(), next = silent(), snapshot = structuredClone(before);
  assert.deepEqual(smoothMusicReactiveFeatures(null, next, 16), silent());
  assert.deepEqual(smoothMusicReactiveFeatures(before, next, -1), full());
  assert.deepEqual(before, snapshot);
  const invalid = { energy: NaN, bass: 25, treble: -2, bands: [Infinity, -1, 100] };
  const clean = smoothMusicReactiveFeatures(null, invalid, Infinity);
  assert.deepEqual([clean.energy, clean.bass, clean.treble, ...clean.bands.slice(0, 3)], [0, 1, 0, 0, 0, 1]);
  for (const value of Object.values(smoothMusicReactiveFeatures(full(), silent(), 60_000)).flat()) assert.ok(value >= 0 && value <= 1);
});

test('all four looks produce distinct deterministic, finite drawing commands within a fixed mobile-friendly work budget', () => {
  const signatures = new Set();
  for (const look of MUSIC_REACTIVE_LOOKS) {
    const a = contextHarness(), b = contextHarness();
    renderMusicReactiveFrame(a.ctx, frame(look.id)); renderMusicReactiveFrame(b.ctx, frame(look.id));
    assert.deepEqual(a.trace, b.trace, `${look.id} should be deterministic at the same audio time.`);
    assert.equal(a.state.depth, 0); assert.ok(a.trace.length < 4000, `${look.id} should bound per-frame work.`);
    assert.ok(a.trace.some(call => call[0] === 'stroke'));
    assert.ok(a.trace.some(call => call[0] === 'fillText' && call[1] === frame().title));
    signatures.add(JSON.stringify(a.trace));
  }
  assert.equal(signatures.size, 4);
});

test('each look responds to audio signals, time changes motion and reduced motion is an invariant cover frame', () => {
  for (const look of MUSIC_REACTIVE_LOOKS) {
    const a = contextHarness(), b = contextHarness(), later = contextHarness();
    renderMusicReactiveFrame(a.ctx, { ...frame(look.id), ...silent() });
    renderMusicReactiveFrame(b.ctx, { ...frame(look.id), ...full() });
    assert.notDeepEqual(a.trace, b.trace);
    renderMusicReactiveFrame(later.ctx, { ...frame(look.id), time: 150 });
    if (look.id !== 'spectrum') assert.notDeepEqual(later.trace, a.trace);
    const stillA = contextHarness(), stillB = contextHarness();
    renderMusicReactiveFrame(stillA.ctx, { ...frame(look.id), ...silent(), reducedMotion: true });
    renderMusicReactiveFrame(stillB.ctx, { ...frame(look.id), ...full(), time: 999, reducedMotion: true });
    assert.deepEqual(stillA.trace, stillB.trace, 'Reduced motion should suppress both time motion and audio-driven geometry.');
  }
});

test('rendering handles hostile values, long Unicode titles, portrait layouts and restoration on failure', () => {
  const normal = contextHarness(), invalid = contextHarness();
  renderMusicReactiveFrame(normal.ctx, { ...frame(), time: 0, energy: 0, bass: 1, treble: 0 });
  renderMusicReactiveFrame(invalid.ctx, { ...frame('unknown'), time: Infinity, energy: NaN, bass: 99, treble: -1 });
  assert.deepEqual(normal.trace, invalid.trace);
  const portrait = contextHarness();
  renderMusicReactiveFrame(portrait.ctx, { ...frame('aurora'), width: 720, height: 1280, title: '\n🎵東京'.repeat(80), artist: '<script>remote text</script>' });
  assert.ok(portrait.trace.some(call => call[0] === 'fillText' && call[1] === '<script>remote text</script>'));
  assert.ok(portrait.trace.filter(call => call[0] === 'fillText').every(call => !call[1].includes('\n') && Array.from(call[1]).length <= 121));
  for (const dimensions of [[0, 720], [1280, 0], [1.5, 2], [5000, 1], [4096, 4096], [NaN, 2]]) {
    assert.throws(() => renderMusicReactiveFrame(normal.ctx, { ...frame(), width: dimensions[0], height: dimensions[1] }), /dimensions/);
  }
  assert.throws(() => renderMusicReactiveFrame(null, frame()), /Canvas/);
  const failed = contextHarness({ throwOnStroke: true });
  assert.throws(() => renderMusicReactiveFrame(failed.ctx, frame()), /drawing failed/);
  assert.equal(failed.state.depth, 0); assert.equal(failed.state.restored, 2, 'Both the orbit transform and caller state need restoration.');
});
