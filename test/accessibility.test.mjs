import assert from 'node:assert/strict';
import test from 'node:test';
import { AGENT_CATALOG } from '../src/index.mjs';
import { ALT_TEXT_LIMIT, colorName, createFlashLimiter, createMotionPreference, describeAgentOutput, FLASH_LIMITS, frameLuminance, getAgentMotion, measureFlashes, MOTION_PREFERENCES, prefersReducedMotion, reducedMotionSettings } from '../src/accessibility.mjs';
import * as beats from '../src/beat-tracker.mjs';
import { defaultAgent3DSettings, validateScene3DSettings } from '../src/scene-3d.mjs';
import { defaultFrameSculptureSettings, validateFrameSculptureSettings } from '../src/frame-sculpture.mjs';

// A switchable reduced-motion query, in the modern or the legacy listener style.
function device(matches = false, { legacy = false } = {}) {
  const listeners = new Set();
  const query = { matches, ...(legacy ? { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) } : { addEventListener: (type, fn) => listeners.add(fn), removeEventListener: (type, fn) => listeners.delete(fn) }) };
  return { scope: { matchMedia: q => { assert.equal(q, '(prefers-reduced-motion: reduce)'); return query; } }, listeners, flip(next) { query.matches = next; listeners.forEach(fn => fn({ matches: next })); } };
}

test('the motion preference follows the device, an in-app override wins, and change fires only on real changes', () => {
  assert.deepEqual(MOTION_PREFERENCES, ['system', 'reduce', 'full']);
  for (const legacy of [false, true]) {
    const d = device(false, { legacy }), motion = createMotionPreference({ scope: d.scope }), events = [];
    motion.addEventListener('change', event => events.push(event.matches));
    motion.addEventListener('change', () => { throw new Error('a broken listener'); });
    assert.equal(motion.matches, false); assert.equal(motion.preference, 'system');
    d.flip(true); assert.equal(motion.matches, true); assert.equal(motion.system, true);
    motion.set('full'); assert.equal(motion.matches, false, 'the override beats the device');
    d.flip(false); d.flip(true); assert.deepEqual(events, [true, false], 'device flips under an override are silent');
    motion.set('reduce'); motion.set('nonsense'); assert.equal(motion.preference, 'system'); assert.equal(motion.matches, true);
    assert.deepEqual(events, [true, false, true]);
    motion.dispose(); assert.equal(d.listeners.size, 0); d.flip(false); assert.deepEqual(events, [true, false, true]);
  }
  assert.equal(createMotionPreference({ scope: {} }).matches, false);
  assert.equal(createMotionPreference({ scope: { matchMedia() { throw new Error('blocked'); } }, preference: 'reduce' }).matches, true);
});

test('every template says whether it moves, and reduced settings stay valid for strict validators', () => {
  for (const tool of AGENT_CATALOG) {
    const motion = getAgentMotion(tool.id);
    assert.ok(Object.isFrozen(motion)); assert.equal(motion.moves, motion.reduced !== 'none'); assert.equal(!!motion.note, motion.moves);
  }
  assert.deepEqual(['music-reactive', 'model-turntable', 'scene-lighting', 'frame-sculpture', 'camera-stage', 'avatar-stage'].map(id => getAgentMotion(id).reduced), ['calm', 'paused', 'paused', 'paused', 'still', 'still']);
  assert.equal(getAgentMotion('image-finish').moves, false); assert.throws(() => getAgentMotion('nope'), /catalog/);
  const scene = { ...defaultAgent3DSettings('model-turntable'), rotating: true }, reduced = reducedMotionSettings('model-turntable', scene);
  assert.equal(reduced.rotating, false); assert.equal(scene.rotating, true, 'the input is not mutated'); assert.deepEqual(validateScene3DSettings(reduced), reduced);
  assert.equal(validateFrameSculptureSettings(reducedMotionSettings('frame-sculpture', { ...defaultFrameSculptureSettings, rotating: true })).rotating, false);
  assert.deepEqual(reducedMotionSettings('music-reactive', { look: 'aurora' }), { look: 'aurora', reducedMotion: true, beatSync: false, pulse: 0 });
  assert.equal(reducedMotionSettings('camera-stage', {}).reducedMotion, true);
  assert.deepEqual(reducedMotionSettings('image-finish', { preset: 'noir' }), { preset: 'noir' });
  assert.throws(() => reducedMotionSettings('image-finish', []), /plain/);
});

test('the flash limiter is shared with the beat tracker and stays capped at three a second', () => {
  assert.equal(createFlashLimiter, beats.createFlashLimiter); assert.equal(prefersReducedMotion, beats.prefersReducedMotion);
  assert.equal(createFlashLimiter({ maxFlashesPerSecond: 60 }).minGapMs, 1000 / FLASH_LIMITS.maxFlashesPerSecond);
});

test('frame luminance follows WCAG relative luminance and samples large frames', () => {
  assert.equal(frameLuminance(new Uint8ClampedArray([255, 255, 255, 255])), 1);
  assert.equal(frameLuminance([0, 0, 0, 0]), 0);
  assert.ok(Math.abs(frameLuminance([0, 255, 0, 255]) - .7152) < 1e-9);
  assert.ok(Math.abs(frameLuminance([128, 128, 128, 255]) - .2158605) < 1e-6);
  const big = new Uint8ClampedArray(4096 * 4096 * 4).fill(255); assert.equal(frameLuminance(big), 1);
  assert.throws(() => frameLuminance([1, 2, 3]), /RGBA/);
});

test('flash measurement counts opposing luminance pairs per second, ignores bright-only and small changes', () => {
  const strobe = hz => Array.from({ length: 120 }, (_, i) => Math.floor(i * hz * 2 / 60) % 2 ? .9 : .05);
  const fast = measureFlashes(strobe(5), { fps: 60 });
  assert.equal(fast.safe, false); assert.ok(fast.maxFlashesPerSecond >= 5 && fast.maxFlashesPerSecond <= 6, `5 Hz strobe → ${fast.maxFlashesPerSecond}`);
  assert.equal(fast.worstAtMs, 100, 'the first change comes after six dark frames');
  const slow = measureFlashes(strobe(2), { fps: 60 }); assert.equal(slow.safe, true); assert.ok(slow.maxFlashesPerSecond <= 3);
  assert.equal(measureFlashes(Array.from({ length: 60 }, (_, i) => i % 2 ? .95 : .82), { fps: 60 }).flashes, 0, 'both states brighter than 0.8');
  assert.equal(measureFlashes(Array.from({ length: 60 }, (_, i) => i % 2 ? .35 : .3), { fps: 60 }).flashes, 0, 'changes under 0.1');
  // A slow fade up and down crosses 0.1 twice — one flash, not a strobe.
  const fade = Array.from({ length: 120 }, (_, i) => .1 + .5 * Math.sin(Math.PI * i / 119));
  assert.deepEqual([measureFlashes(fade).flashes, measureFlashes(fade).safe], [1, true]);
  // Timed samples, and the per-second limit can only be tightened.
  const timed = [0, 100, 200, 300, 400, 500, 600, 700].map((time, i) => ({ time, luminance: i % 2 ? .6 : .1 }));
  assert.equal(measureFlashes(timed).maxFlashesPerSecond, 3); assert.equal(measureFlashes(timed).safe, true);
  assert.equal(measureFlashes(timed, { maxFlashesPerSecond: 2 }).safe, false); assert.equal(measureFlashes(timed, { maxFlashesPerSecond: 9 }).safe, true);
  assert.throws(() => measureFlashes([{ time: 10, luminance: .2 }, { time: 5, luminance: .3 }]), /backwards/);
  assert.throws(() => measureFlashes([1.5]), /0 to 1/); assert.throws(() => measureFlashes('x'), /array/); assert.throws(() => measureFlashes([], { fps: 0 }), /fps/);
});

test('colour names are plain words a screen reader can say', () => {
  assert.deepEqual(['#000000', '#ffffff', '#808080', '#151719', '#102031', '#c8ed91', '#ff0000', '#f4a3c0', '#ff8800', '#7a3cff'].map(colorName),
    ['black', 'white', 'grey', 'dark grey', 'dark blue', 'light green', 'red', 'light pink', 'orange', 'purple']);
  assert.equal(colorName('red'), ''); assert.equal(colorName(12), '');
});

test('every template gets alt text from its settings, bounded, without seeds or control characters', () => {
  for (const tool of AGENT_CATALOG) {
    const alt = describeAgentOutput(tool.id, {}, { width: 1080, height: 1350 });
    assert.ok(alt.startsWith(tool.title), alt); assert.ok(alt.length <= ALT_TEXT_LIMIT && alt.endsWith('.'), alt); assert.doesNotMatch(alt.slice(tool.title.length), /seed|undefined|NaN|\[object/i);
  }
  assert.equal(describeAgentOutput('print-shop', { look: 'halftone dots', color: '#102031', seed: 42 }, { width: 1080, height: 1350 }),
    'Print Shop image, 1080 × 1350: print look halftone dots, riso inks pink + blue, ink color dark blue, artboard ratio 4:5, dot size 3, print strength 100%.');
  assert.match(describeAgentOutput('title-frame', { title: 'ignored' }, { lines: ['Hello\u0007', 'world'] }), /title “Hello world”/);
  assert.equal(describeAgentOutput('model-turntable', { lighting: 'neon', finish: 'metal', color: '#c8ed91', view: 'front', focalLength: 85, exposure: 120 }, { subject: 'Chair' }),
    'Model Turntable render of Chair: neon lighting, metal finish in light green, front view, 85 mm lens, exposure 120%.');
  assert.match(describeAgentOutput('scene-lighting', defaultAgent3DSettings('scene-lighting'), { camera: 'isometric' }), /architecture scene: studio lighting, original materials, isometric view, 50 mm lens, exposure 120%, dark grey background\.$/);
  assert.equal(describeAgentOutput('frame-sculpture', defaultFrameSculptureSettings, { frames: 8, width: 1600, height: 900 }), 'Frame Sculpture snapshot of 8 video frames, 1600 × 900: fan layout, tilted 12°, on a dark blue stage.');
  assert.equal(describeAgentOutput('music-reactive', { look: 'orbital', title: 'Night drive', artist: 'Mai', ratio: '16:9', intensity: .7 }, { media: 'video', width: 1920, height: 1080 }),
    'Sound Canvas music visualizer video for “Night drive” by Mai, 1920 × 1080: orbital look, 16:9, motion intensity 70%, shapes swell on the beat.');
  assert.equal(describeAgentOutput('music-reactive', reducedMotionSettings('music-reactive', { look: 'aurora', intensity: .7 })), 'Sound Canvas cover frame: aurora look, calm still composition for reduced motion.');
  assert.equal(describeAgentOutput('camera-stage', { effect: 'neon', intensity: 70, mirror: 'yes' }, { reducedMotion: true, media: 'video' }), 'Camera Stage recording: camera effect neon, effect intensity 70%, mirrored, held still for reduced motion.');
  assert.equal(describeAgentOutput('style-brief', { subject: 'a fox' }), 'Style Brief: project “a fox”, visual direction cinematic, mood playful.');
  const long = describeAgentOutput('poster-lab', { title: 'x'.repeat(500) }, { lines: Array(20).fill('word '.repeat(20)) });
  assert.ok(long.length <= ALT_TEXT_LIMIT, long);
  assert.throws(() => describeAgentOutput('nope'), /catalog/); assert.throws(() => describeAgentOutput('image-finish', []), /plain/);
});
