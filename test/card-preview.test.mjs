import assert from 'node:assert/strict';
import test from 'node:test';
import { AGENT_CATALOG } from '../src/index.mjs';
import { createPreviewPlayer, getAgentPreview, PREVIEW_LOOP_MS, PREVIEW_MOTIFS, PREVIEW_SIZE, renderAgentPreview } from '../src/card-preview.mjs';

// A 2D context that records every call; anything outside the small drawing set (text, images, pixels) throws.
const METHODS = ['save', 'restore', 'setTransform', 'transform', 'translate', 'rotate', 'scale', 'fillRect', 'beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'arc', 'closePath', 'fill', 'stroke', 'clip'];
function recorder() {
  const calls = [], state = { fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1 }, colors = new Set(), alphas = new Set();
  const round = value => typeof value === 'number' ? Math.round(value * 100) / 100 : value;
  const target = {
    calls, colors, alphas,
    createLinearGradient: (...args) => { calls.push(['gradient', ...args]); return { addColorStop: (at, color) => { calls.push(['stop', at, color]); colors.add(color); } }; },
  };
  for (const name of METHODS) target[name] = (...args) => calls.push([name, ...args.map(round)]);
  return new Proxy(target, {
    get(object, key) { if (key in object) return object[key]; if (key in state) return state[key]; throw new Error(`Unexpected context member ${String(key)}`); },
    set(object, key, value) {
      if (!(key in state)) throw new Error(`Unexpected context member ${String(key)}`);
      state[key] = value; calls.push([key, typeof value === 'string' ? value : round(value)]);
      if (key === 'fillStyle' || key === 'strokeStyle') { if (typeof value === 'string') colors.add(value); }
      if (key === 'globalAlpha') alphas.add(value);
      return true;
    },
  });
}
const draw = (id, t, options) => { const ctx = recorder(); const info = renderAgentPreview(id, ctx, t, options); return { ctx, info, log: JSON.stringify(ctx.calls) }; };

test('every catalog agent has a frozen preview spec with a known motif and an OKLab palette', () => {
  const used = new Set();
  for (const tool of AGENT_CATALOG) {
    const spec = getAgentPreview(tool.id);
    assert.ok(Object.isFrozen(spec) && Object.isFrozen(spec.palette)); assert.ok(PREVIEW_MOTIFS.includes(spec.motif), tool.id);
    assert.equal(spec.loopMs, PREVIEW_LOOP_MS); assert.equal(spec.palette.accent, tool.accent.toLowerCase());
    for (const color of Object.values(spec.palette)) assert.match(color, /^#[\da-f]{6}$/);
    assert.equal(spec.dark, ['music', 'frame', '3d', 'camera'].includes(tool.workspace.kind), tool.id);
    used.add(spec.motif);
  }
  assert.deepEqual([...used].sort(), [...PREVIEW_MOTIFS].sort(), 'every motif draws at least one agent');
  assert.deepEqual(['glitch-cut', 'transition-lab', 'music-reactive', 'scene-lighting', 'storyboard-builder', 'rough-cut'].map(id => getAgentPreview(id).motif), ['glitch', 'iris', 'bars', 'light', 'panels', 'strip']);
  assert.equal(getAgentPreview('community-thing').motif, 'strip');
  assert.equal(getAgentPreview({ id: 'my-poster', accent: '#3366CC', workspace: { kind: 'canvas', operation: 'poster' } }).motif, 'poster');
  assert.equal(getAgentPreview({ id: 'x', accent: 'red' }).palette.accent, '#c7caa9', 'bad accents fall back');
  assert.notEqual(getAgentPreview('a').seed, getAgentPreview('b').seed);
});

test('a frame is a pure function of agent and time: loops exactly, holds the poster for reduced motion', () => {
  for (const tool of AGENT_CATALOG) {
    const poster = draw(tool.id, 0).log;
    assert.ok(draw(tool.id, 0).log === poster, tool.id);
    assert.ok(draw(tool.id, PREVIEW_LOOP_MS * 3).log === poster, `${tool.id} loops`);
    assert.ok(draw(tool.id, -PREVIEW_LOOP_MS).log === poster, `${tool.id} negative time`);
    assert.ok(draw(tool.id, 2100, { reducedMotion: true }).log === poster, `${tool.id} reduced`);
    assert.ok(draw(tool.id, NaN).log === poster);
    assert.ok(draw(tool.id, PREVIEW_LOOP_MS / 3).log !== poster, `${tool.id} moves`);
    assert.ok(draw(tool.id, 1200).log === draw(tool.id, 1200 + PREVIEW_LOOP_MS).log, tool.id);
  }
  assert.equal(draw('glitch-cut', 1200).info.phase, .25);
  assert.ok(Object.isFrozen(draw('glitch-cut', 0).info));
});

test('every agent draws a distinct poster frame', () => {
  const seen = new Map();
  for (const tool of AGENT_CATALOG) {
    const log = draw(tool.id, 0).log;
    assert.equal(seen.has(log), false, `${tool.id} looks like ${seen.get(log)}`); seen.set(log, tool.id);
  }
});

test('nothing flashes: colours are fixed for the whole loop and motion is smooth at 15 frames a second', () => {
  // Angles, alpha and skew count 40× so a small number cannot hide a big visual jump.
  const numbers = calls => calls.flatMap(call => call.filter(value => typeof value === 'number').map(value => ['rotate', 'globalAlpha', 'transform'].includes(call[0]) ? value * 40 : value));
  for (const tool of AGENT_CATALOG) {
    const first = draw(tool.id, 0).ctx, colors = [...first.colors].sort();
    let previous = first.calls, jumps = 0;
    for (let frame = 1, t = 1000 / 15; t < PREVIEW_LOOP_MS - 1; t = ++frame * 1000 / 15) {
      const { ctx } = draw(tool.id, t);
      assert.deepEqual([...ctx.colors].filter(color => !colors.includes(color)), [], `${tool.id} adds a colour at ${t}`);
      for (const alpha of ctx.alphas) assert.ok(alpha >= 0 && alpha <= 1);
      // Shapes may appear or disappear as lines type in, and the turntable re-sorts by depth; when the drawing
      // has the same shape, the best one-to-one match of its numbers (sorted, optimal in 1D) never jumps.
      const a = numbers(previous).sort((m, n) => m - n), b = numbers(ctx.calls).sort((m, n) => m - n);
      if (a.length === b.length && previous.length === ctx.calls.length) jumps = Math.max(jumps, ...a.map((value, i) => Math.abs(value - b[i])));
      previous = ctx.calls;
    }
    // Typing runs fastest: under an eighth of the card width per frame.
    assert.ok(jumps < 60, `${tool.id} jumps ${jumps.toFixed(1)} units between frames`);
  }
});

test('draws scaled into any size with balanced state and only the small drawing set', () => {
  const { ctx } = draw('poster-lab', 900, { width: 240, height: 135 });
  assert.deepEqual(ctx.calls.find(call => call[0] === 'setTransform'), ['setTransform', .5, 0, 0, .5, 0, 0]);
  assert.equal(ctx.calls.filter(call => call[0] === 'save').length, ctx.calls.filter(call => call[0] === 'restore').length);
  assert.deepEqual(ctx.calls.find(call => call[0] === 'gradient'), ['gradient', 0, 0, PREVIEW_SIZE.width, PREVIEW_SIZE.height]);
  assert.throws(() => renderAgentPreview('poster-lab', {}, 0), /2D canvas context/);
  assert.throws(() => renderAgentPreview('poster-lab', null, 0), /2D canvas context/);
});

function stage({ reduced, ratio = 3 } = {}) {
  let clock = 1000, nextId = 1;
  const frames = new Map(), listeners = new Set();
  const scope = {
    devicePixelRatio: ratio, performance: { now: () => clock },
    requestAnimationFrame: fn => { const id = nextId++; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
  };
  const contexts = [], canvas = { clientWidth: 240, clientHeight: 135, width: 300, height: 150, getContext: kind => { assert.equal(kind, '2d'); const ctx = recorder(); contexts.push(ctx); return ctx; } };
  const motion = reduced === undefined ? undefined : { matches: reduced, addEventListener: (type, fn) => listeners.add(fn), removeEventListener: (type, fn) => listeners.delete(fn) };
  const advance = ms => { clock += ms; const due = [...frames]; frames.clear(); due.forEach(([, fn]) => fn(clock)); };
  return { scope, canvas, contexts, motion, listeners, frames, advance, flip(next) { motion.matches = next; listeners.forEach(fn => fn({ matches: next })); } };
}
const transforms = ctx => ctx.calls.filter(call => call[0] === 'setTransform').length;

test('the player shows the poster, loops while playing at a capped rate, and returns to the poster on pause', () => {
  const s = stage(), player = createPreviewPlayer(s.canvas, 'transition-lab', { scope: s.scope, fps: 20 }), ctx = s.contexts[0];
  assert.deepEqual([s.canvas.width, s.canvas.height], [480, 270], 'backing store follows CSS size at most 2× density');
  assert.equal(transforms(ctx), 1); assert.equal(player.playing, false);
  assert.equal(player.play(), true); assert.equal(player.play(), true); assert.equal(s.frames.size, 1, 'one loop, even when play repeats');
  for (let i = 0; i < 12; i++) s.advance(1000 / 60);
  assert.equal(transforms(ctx), 1 + 4, '20 fps over 200 ms is four frames');
  player.pause(); assert.equal(player.playing, false); assert.equal(s.frames.size, 0);
  const poster = recorder(); renderAgentPreview('transition-lab', poster, 0, { width: 480, height: 270 });
  assert.equal(JSON.stringify(ctx.calls.slice(-poster.calls.length)), JSON.stringify(poster.calls), 'pause draws the poster frame');
  player.render(1200); assert.equal(transforms(ctx), 7);
  player.dispose(); assert.equal(player.play(), false); player.pause(); assert.equal(transforms(ctx), 7);
  assert.throws(() => createPreviewPlayer({ getContext: () => null }, 'transition-lab'), /2D context/);
});

test('reduced motion keeps the poster and stops a running preview the moment it turns on', () => {
  const still = stage({ reduced: true }), held = createPreviewPlayer(still.canvas, 'music-reactive', { scope: still.scope, motion: still.motion });
  assert.equal(held.play(), false); assert.equal(still.frames.size, 0);
  assert.equal(createPreviewPlayer(still.canvas, 'music-reactive', { scope: still.scope, motion: true }).play(), false);
  const s = stage({ reduced: false }), player = createPreviewPlayer(s.canvas, 'music-reactive', { scope: s.scope, motion: s.motion });
  assert.equal(player.play(), true); s.advance(40);
  s.flip(true); assert.equal(player.playing, false); assert.equal(s.frames.size, 0);
  assert.equal(player.play(), false);
  s.flip(false); assert.equal(player.play(), true);
  player.dispose(); assert.equal(s.listeners.size, 0);
  const plain = stage(); plain.scope.requestAnimationFrame = undefined; plain.scope.cancelAnimationFrame = undefined;
  const timers = []; plain.scope.setTimeout = fn => timers.push(fn); plain.scope.clearTimeout = () => {};
  assert.equal(createPreviewPlayer(plain.canvas, 'image-grid', { scope: plain.scope }).play(), true); assert.equal(timers.length, 1, 'falls back to timers without rAF');
});
