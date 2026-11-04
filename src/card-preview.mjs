/**
 * Live card previews: a small, deterministic, looping 2D animation for every
 * agent, drawn from the catalog alone. Shapes and colours only — no text, no
 * fonts, no images — so a frame is the same on every browser and in a worker.
 * Nothing flashes: every shape keeps its colour, only geometry moves and a few
 * layers fade slowly, and `t = 0` is a composed poster frame that reduced motion holds.
 */
import { getAgentTemplate } from './index.mjs';
import { mixColors } from './color.mjs';
import { mulberry32 } from './glitch.mjs';

export const PREVIEW_SIZE = Object.freeze({ width: 480, height: 270 });
export const PREVIEW_LOOP_MS = 4800;
export const PREVIEW_MOTIFS = Object.freeze(['bars', 'stack', 'sketch', 'mockup', 'grade', 'blend', 'grid', 'halftone', 'title', 'bento', 'poster', 'iris', 'glitch', 'letters', 'cutout', 'pose', 'face', 'viewfinder', 'avatar', 'orbit', 'light', 'lines', 'panels', 'branches', 'parallax', 'track', 'reframe', 'strip']);

const BY_OPERATION = { reactive: 'bars', sculpture: 'stack', draw: 'sketch', mockup: 'mockup', 'image-filter': 'grade', blend: 'blend', 'image-grid': 'grid', print: 'halftone', 'type-overlay': 'title', bento: 'bento', poster: 'poster', transition: 'iris', glitch: 'glitch', letter: 'letters', 'person-cutout': 'cutout', 'pose-reference': 'pose', 'face-reference': 'face', effects: 'viewfinder', avatar: 'avatar', 'storyboard-builder': 'panels', 'prompt-branches': 'branches' };
const BY_ID = { 'scene-lighting': 'light', 'depth-motion': 'parallax', 'world-finder': 'parallax', 'scene-scout': 'parallax', 'motion-tracker': 'track', 'frame-study': 'track', 'frame-fit': 'reframe', 'shot-atlas': 'reframe' };
const DARK = new Set(['music', 'frame', '3d', 'camera']);
const INK = '#243334', PAPER = '#fff7e7', NIGHT = '#101121', TAU = Math.PI * 2;
const W = PREVIEW_SIZE.width, H = PREVIEW_SIZE.height;
const hex = value => /^#[\da-f]{6}$/i.test(value ?? '') ? value.toLowerCase() : '#c7caa9';
const hash = text => { let h = 0x811c9dc5; for (const ch of String(text)) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193); return h >>> 0; };
const wave = (p, k = 1, o = 0) => Math.sin(TAU * (p * k + o));
// 0 at the poster frame, 1 half a loop later, smooth both ways.
const swing = (p, k = 1, o = 0) => .5 - .5 * Math.cos(TAU * (p * k + o));
// 1 at the poster frame: things that draw themselves start finished, undo and redraw.
const built = p => 1 - swing(p);

function motifOf(template) {
  const { kind, operation } = template.workspace || {};
  return BY_ID[template.id] || BY_OPERATION[operation] || (kind === 'writing' ? 'lines' : kind === '3d' ? 'orbit' : 'strip');
}

/**
 * What a card preview draws for an agent: its motif, loop length, seed and an
 * OKLab palette derived from the catalog accent. Takes a catalog ID or a
 * template-like object (`id`, `accent`, `workspace`); unknown IDs get the
 * generic filmstrip.
 */
export function getAgentPreview(agent) {
  const template = typeof agent === 'string' ? getAgentTemplate(agent) || { id: agent } : agent || {};
  const id = String(template.id || 'agent'), accent = hex(template.accent), dark = DARK.has(template.workspace?.kind);
  const base = dark ? mixColors(accent, NIGHT, .72) : mixColors(accent, PAPER, .42);
  return Object.freeze({
    id, motif: motifOf(template), loopMs: PREVIEW_LOOP_MS, seed: hash(id), dark,
    palette: Object.freeze({
      background: base, end: dark ? mixColors(accent, NIGHT, .86) : mixColors(accent, INK, .1), accent,
      ink: dark ? PAPER : INK, paper: dark ? mixColors(PAPER, NIGHT, .1) : PAPER,
      sky: dark ? mixColors(accent, NIGHT, .5) : mixColors(accent, PAPER, .62), sun: '#f2c879',
      hill: mixColors(accent, INK, dark ? .2 : .32), hill2: mixColors(accent, INK, dark ? .4 : .5),
      soft: dark ? mixColors(accent, NIGHT, .3) : mixColors(accent, PAPER, .2),
    }),
  });
}

function round(ctx, x, y, w, h, r = 6) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}
const box = (ctx, color, x, y, w, h, r) => { ctx.fillStyle = color; round(ctx, x, y, w, h, r); ctx.fill(); };
const dot = (ctx, color, x, y, r) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, TAU); ctx.fill(); };
const line = (ctx, color, width, points) => { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); };

// A small picture: sky, sun and two hills, clipped to its frame. `shift` slides the hills.
function scene(ctx, pal, x, y, w, h, { shift = 0, sky = pal.sky, sun = pal.sun, r = 6 } = {}) {
  ctx.save(); round(ctx, x, y, w, h, r); ctx.clip();
  ctx.fillStyle = sky; ctx.fillRect(x, y, w, h);
  dot(ctx, sun, x + w * .72, y + h * .3, Math.min(w, h) * .13);
  for (const [color, top, k] of [[pal.hill, .55, .6], [pal.hill2, .72, 1]]) {
    const s = shift * k * w;
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x - w, y + h);
    for (let i = -2; i <= 4; i++) ctx.quadraticCurveTo(x + (i + .5) * w / 2 + s, y + h * (top - .16 * (i % 2 ? 1 : -.4)), x + (i + 1) * w / 2 + s, y + h * top);
    ctx.lineTo(x + 2 * w, y + h); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
// Lines of "text" as soft bars; `reveal` 0–1 types them in, left to right.
function copy(ctx, color, x, y, widths, { reveal = 1, gap = 14, height = 6 } = {}) {
  const total = widths.reduce((sum, w) => sum + w, 0); let left = reveal * total;
  widths.forEach((w, i) => { const shown = Math.max(0, Math.min(w, left)); left -= w; if (shown > .5) box(ctx, color, x, y + i * gap, shown, height, height / 2); });
}
const figure = (ctx, color, x, y, s = 1, sway = 0) => {
  dot(ctx, color, x, y - 52 * s, 15 * s);
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x - 30 * s, y + 40 * s); ctx.quadraticCurveTo(x - 28 * s + sway, y - 34 * s, x, y - 34 * s);
  ctx.quadraticCurveTo(x + 28 * s + sway, y - 34 * s, x + 30 * s, y + 40 * s); ctx.closePath(); ctx.fill();
};

const MOTIF_DRAW = {
  bars(ctx, p, pal, r) {
    const n = 24, offsets = Array.from({ length: n }, () => r());
    for (let i = 0; i < n; i++) {
      const h = 26 + 64 * (.5 + .25 * wave(p, 2, offsets[i]) + .25 * wave(p, 3, i / n));
      box(ctx, i % 6 === 0 ? pal.sun : pal.accent, 66 + i * 14.5, 186 - h, 8, h, 4);
      box(ctx, pal.soft, 66 + i * 14.5, 196, 8, h * .3, 4);
    }
    dot(ctx, pal.paper, 240, 66, 6 + 3 * swing(p, 2));
  },
  stack(ctx, p, pal) {
    for (let i = 0; i < 5; i++) {
      const lift = 8 * wave(p, 1, i * .14), skew = 22 * wave(p, 1, .25 + i * .06);
      ctx.save(); ctx.translate(150 + i * 34, 80 + i * 14 + lift); ctx.transform(1, 0, skew / 100, 1, 0, 0);
      box(ctx, i === 4 ? pal.accent : pal.soft, 0, 0, 140, 92, 6); scene(ctx, pal, 8, 8, 124, 76, { shift: p * .2 }); ctx.restore();
    }
  },
  sketch(ctx, p, pal) {
    const path = [[96, 196], [150, 118], [196, 162], [248, 82], [310, 170], [358, 124], [396, 196]];
    const drawn = Math.min(1, .25 + 1.1 * built(p)), steps = Math.max(1, Math.round(drawn * (path.length - 1)));
    box(ctx, pal.paper, 70, 44, 340, 182, 8);
    ctx.save(); ctx.globalAlpha = .55 * Math.max(0, drawn - .6) / .4; scene(ctx, pal, 82, 56, 316, 158); ctx.restore();
    line(ctx, pal.ink, 4, path.slice(0, steps + 1));
    dot(ctx, pal.accent, path[steps][0], path[steps][1], 7);
  },
  mockup(ctx, p, pal) {
    box(ctx, pal.ink, 168, 34, 144, 210, 22); scene(ctx, pal, 178, 46, 124, 186, { shift: p * .3, r: 14 });
    const x = 52 + 120 * swing(p); box(ctx, pal.paper, x, 78, 92, 120, 8); scene(ctx, pal, x + 8, 86, 76, 92, { shift: -.2 });
    box(ctx, pal.accent, 330, 92, 92, 92, 46);
  },
  grade(ctx, p, pal) {
    scene(ctx, pal, 60, 34, 360, 202);
    const x = 70 + 340 * swing(p);
    ctx.save(); round(ctx, x, 34, 420 - x, 202, 0); ctx.clip(); scene(ctx, pal, 60, 34, 360, 202, { sky: pal.sun, sun: pal.paper }); ctx.restore();
    box(ctx, pal.paper, x - 2, 26, 4, 218, 2); dot(ctx, pal.paper, x, 135, 11);
  },
  blend(ctx, p, pal) {
    const s = swing(p);
    scene(ctx, pal, 54 + 64 * s, 50, 220, 170, { shift: .1 });
    ctx.save(); ctx.globalAlpha = .82; scene(ctx, pal, 206 - 64 * s, 50, 220, 170, { sky: pal.soft, sun: pal.accent, shift: -.2 }); ctx.restore();
  },
  grid(ctx, p, pal, r) {
    const order = [0, 1, 2, 3, 4, 5];
    for (let i = 5; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const active = Math.floor(p * 6) % 6;
    for (let i = 0; i < 6; i++) {
      const cx = 76 + (i % 3) * 112, cy = 40 + Math.floor(i / 3) * 98, lift = order[i] === active ? 6 * swing(p * 6 % 1) : 0;
      scene(ctx, pal, cx, cy - lift, 104, 90, { shift: order[i] * .15 + .08 * wave(p), sky: order[i] % 2 ? pal.sky : pal.soft });
    }
  },
  halftone(ctx, p, pal) {
    box(ctx, pal.paper, 60, 34, 360, 202, 6);
    const shift = 6 * wave(p);
    for (let y = 0; y < 13; y++) for (let x = 0; x < 23; x++) {
      const v = .5 + .5 * Math.sin(x * .45 + y * .3) * Math.cos(y * .5 - x * .12);
      dot(ctx, pal.accent, 76 + x * 15, 48 + y * 15, 1 + 5 * v);
      dot(ctx, pal.ink, 76 + x * 15 + 2 + shift * .3, 48 + y * 15 + 1, (1 + 5 * v) * .45);
    }
  },
  title(ctx, p, pal) {
    scene(ctx, pal, 40, 30, 400, 210, { shift: p * .2 });
    const rise = 18 * (1 - swing(p, 1, .25));
    copy(ctx, pal.paper, 72, 176 + rise, [230, 150], { gap: 22, height: 14 });
    copy(ctx, pal.ink, 72, 218, [90], { reveal: built(p) });
  },
  bento(ctx, p, pal) {
    const s = swing(p), cells = [[60, 34, 200 + 40 * s, 120], [268 + 40 * s, 34, 152 - 40 * s, 120], [60, 162, 140, 74], [208, 162, 212, 74]];
    cells.forEach(([x, y, w, h], i) => i === 2 ? box(ctx, pal.accent, x, y, w, h, 8) : scene(ctx, pal, x, y, w, h, { shift: i * .2, r: 8 }));
    copy(ctx, pal.ink, 76, 188, [96, 70], { gap: 14 });
  },
  poster(ctx, p, pal) {
    box(ctx, pal.paper, 160, 18, 160, 234, 4); scene(ctx, pal, 170, 28, 140, 160, { shift: p * .2, r: 2 });
    const s = swing(p); copy(ctx, pal.ink, 178 + 6 * s, 198, [124 - 12 * s, 98 + 14 * s, 60], { gap: 14, height: 8 });
  },
  iris(ctx, p, pal) {
    scene(ctx, pal, 40, 30, 400, 210);
    ctx.save(); ctx.beginPath(); ctx.arc(240, 135, 8 + 240 * swing(p), 0, TAU); ctx.clip();
    scene(ctx, pal, 40, 30, 400, 210, { sky: pal.sun, sun: pal.paper, shift: .4 }); ctx.restore();
  },
  glitch(ctx, p, pal, r) {
    scene(ctx, pal, 60, 34, 360, 202);
    const bands = Array.from({ length: 7 }, () => [34 + r() * 190, 6 + r() * 16, r() * 2 - 1]), k = swing(p, 2);
    ctx.save(); round(ctx, 60, 34, 360, 202, 6); ctx.clip();
    for (const [y, h, d] of bands) { ctx.save(); round(ctx, 60, y, 360, h, 0); ctx.clip(); scene(ctx, pal, 60 + d * 30 * k, 34, 360, 202, { sky: pal.soft }); ctx.restore(); }
    ctx.globalAlpha = .4; box(ctx, pal.accent, 60 + 8 * k, 34, 360, 3, 0); box(ctx, pal.accent, 60 - 8 * k, 232, 360, 3, 0); ctx.restore();
  },
  letters(ctx, p, pal) {
    for (let i = 0; i < 5; i++) {
      const hop = 16 * Math.max(0, wave(p, 1, -i * .12)), x = 92 + i * 62;
      box(ctx, pal.hill2, x + 4, 76 - hop + 6, 50, 120, 10); box(ctx, i % 2 ? pal.paper : pal.accent, x, 76 - hop, 50, 120, 10);
    }
    box(ctx, pal.soft, 80, 210, 320, 8, 4);
  },
  cutout(ctx, p, pal) {
    const x = 60 + 360 * swing(p);
    for (let y = 0; y < 7; y++) for (let i = 0; i < 12; i++) if ((i + y) % 2) box(ctx, pal.soft, 60 + i * 30, 34 + y * 29, 30, 29, 0);
    ctx.save(); round(ctx, 60, 34, x - 60, 202, 0); ctx.clip(); scene(ctx, pal, 60, 34, 360, 202); ctx.restore();
    figure(ctx, pal.accent, 240, 160, 1.2); box(ctx, pal.paper, x - 2, 26, 4, 218, 2);
  },
  pose(ctx, p, pal) {
    const a = .5 * wave(p), b = .5 * wave(p, 1, .5), hip = [240, 150], neck = [240 + 6 * a, 96];
    const joints = [[neck, [200 + 20 * a, 120 - 30 * a]], [neck, [282 - 20 * b, 120 - 30 * b]], [hip, [214 - 18 * a, 210]], [hip, [266 + 18 * a, 210]], [hip, neck]];
    for (const [from, to] of joints) { line(ctx, pal.ink, 6, [from, to]); dot(ctx, pal.paper, to[0], to[1], 7); }
    dot(ctx, pal.paper, neck[0], 74, 16); dot(ctx, pal.paper, hip[0], hip[1], 6);
  },
  face(ctx, p, pal) {
    dot(ctx, pal.paper, 240, 132, 76);
    const blink = Math.max(.12, 1 - Math.max(0, wave(p, 1, -.2)) ** 24), smile = 8 + 10 * swing(p);
    for (const x of [212, 268]) { ctx.save(); ctx.translate(x, 116); ctx.scale(1, blink); dot(ctx, pal.ink, 0, 0, 8); ctx.restore(); }
    line(ctx, pal.ink, 5, [[212, 160], [240, 160 + smile], [268, 160]]);
    for (const [x, y] of [[196, 96], [284, 96], [240, 138], [204, 174], [276, 174], [240, 194]]) dot(ctx, pal.accent, x, y, 4);
  },
  viewfinder(ctx, p, pal) {
    scene(ctx, pal, 40, 30, 400, 210, { shift: .1 * wave(p) });
    figure(ctx, pal.hill2, 240 + 30 * wave(p), 200, 1.1, 10 * wave(p, 2));
    for (const [x, y, dx, dy] of [[60, 50, 1, 1], [420, 50, -1, 1], [60, 220, 1, -1], [420, 220, -1, -1]]) line(ctx, pal.paper, 4, [[x, y + 22 * dy], [x, y], [x + 22 * dx, y]]);
    dot(ctx, pal.accent, 76, 66, 5);
  },
  avatar(ctx, p, pal) {
    const tilt = .12 * wave(p), x = 240 + 12 * wave(p, 1, .25);
    ctx.save(); ctx.translate(x, 140); ctx.rotate(tilt); dot(ctx, pal.accent, 0, 0, 62); dot(ctx, pal.paper, -22, -10, 10); dot(ctx, pal.paper, 22, -10, 10);
    dot(ctx, pal.ink, -22 + 4 * wave(p), -10, 5); dot(ctx, pal.ink, 22 + 4 * wave(p), -10, 5); line(ctx, pal.paper, 5, [[-18, 26], [0, 32 + 6 * swing(p, 2)], [18, 26]]); ctx.restore();
    box(ctx, pal.soft, 160, 226, 160, 8, 4);
  },
  orbit(ctx, p, pal) {
    ctx.save(); ctx.translate(240, 210); ctx.scale(1, .18); dot(ctx, pal.soft, 0, 0, 150); ctx.restore();
    const a = TAU * p, back = i => Math.sin(a + i * TAU / 3);
    for (const i of [0, 1, 2].sort((m, n) => back(m) - back(n) || m - n)) {
      const k = a + i * TAU / 3, x = 240 + 110 * Math.cos(k), y = 196 + 22 * Math.sin(k), s = .7 + .3 * (Math.sin(k) + 1) / 2;
      box(ctx, i ? pal.hill : pal.accent, x - 30 * s, y - 80 * s, 60 * s, 80 * s, 12 * s);
    }
  },
  light(ctx, p, pal) {
    const a = TAU * p, lx = 240 + 150 * Math.cos(a), ly = 120 + 40 * Math.sin(a);
    dot(ctx, pal.hill2, 240, 140, 74); dot(ctx, pal.accent, 240 + (lx - 240) * .14, 140 + (ly - 140) * .14, 62);
    dot(ctx, pal.paper, 240 + (lx - 240) * .3, 140 + (ly - 140) * .3, 14); dot(ctx, pal.sun, lx, ly, 10);
  },
  lines(ctx, p, pal, r) {
    const widths = Array.from({ length: 6 }, (_, i) => i === 5 ? 90 : 200 + r() * 100);
    box(ctx, pal.paper, 80, 34, 320, 202, 10); box(ctx, pal.accent, 104, 58, 120, 12, 6);
    copy(ctx, pal.soft, 104, 90, widths, { gap: 20, height: 8 });
    copy(ctx, pal.ink, 104, 90, widths, { gap: 20, height: 8, reveal: .15 + .85 * built(p) });
  },
  panels(ctx, p, pal) {
    for (let i = 0; i < 4; i++) {
      const on = Math.max(0, Math.min(1, built(p) * 5 - i)), x = 52 + i * 96;
      box(ctx, pal.paper, x, 62, 86, 128, 6); ctx.save(); ctx.globalAlpha = on; scene(ctx, pal, x + 6, 68, 74, 64, { shift: i * .25, r: 4 }); ctx.restore();
      copy(ctx, pal.soft, x + 8, 144, [66, 44], { gap: 12 });
    }
  },
  branches(ctx, p, pal, r) {
    const grow = .2 + .8 * built(p), tips = Array.from({ length: 5 }, (_, i) => [392, 48 + i * 44 + r() * 12]);
    box(ctx, pal.accent, 60, 116, 90, 38, 19);
    tips.forEach(([x, y], i) => { const t = Math.max(0, Math.min(1, grow * 1.4 - i * .1)), ex = 150 + (x - 150) * t, ey = 135 + (y - 135) * t; line(ctx, pal.ink, 3, [[150, 135], [150 + (ex - 150) * .5, ey], [ex, ey]]); if (t > .95) box(ctx, pal.paper, x - 4, y - 12, 50, 24, 12); });
  },
  parallax(ctx, p, pal) {
    const k = wave(p);
    ctx.save(); round(ctx, 40, 30, 400, 210, 8); ctx.clip(); ctx.fillStyle = pal.sky; ctx.fillRect(40, 30, 400, 210); dot(ctx, pal.sun, 340 + 6 * k, 86, 26);
    [[pal.soft, 150, 10], [pal.hill, 180, 26], [pal.hill2, 212, 48]].forEach(([color, top, d]) => {
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, 270);
      for (let x = -40; x <= 520; x += 80) ctx.quadraticCurveTo(x + 40 + d * k, top - 30, x + 80 + d * k, top);
      ctx.lineTo(520, 270); ctx.closePath(); ctx.fill();
    });
    ctx.restore();
  },
  track(ctx, p, pal) {
    scene(ctx, pal, 40, 30, 400, 210);
    const at = q => [240 + 140 * Math.sin(TAU * q), 140 + 50 * Math.sin(2 * TAU * q)];
    line(ctx, pal.paper, 2, Array.from({ length: 13 }, (_, i) => at(p - i * .012)));
    const [x, y] = at(p); dot(ctx, pal.accent, x, y, 10);
    ctx.strokeStyle = pal.paper; ctx.lineWidth = 2; round(ctx, x - 26, y - 26, 52, 52, 4); ctx.stroke();
  },
  reframe(ctx, p, pal) {
    scene(ctx, pal, 40, 30, 400, 210, { shift: .1 });
    const s = swing(p), w = 400 - 250 * s, h = 210 - 20 * s, x = 240 - w / 2, y = 135 - h / 2;
    ctx.strokeStyle = pal.paper; ctx.lineWidth = 4; round(ctx, x, y, w, h, 6); ctx.stroke();
    for (const gx of [1, 2]) line(ctx, pal.paper, 1, [[x + w * gx / 3, y], [x + w * gx / 3, y + h]]);
  },
  strip(ctx, p, pal, r) {
    // Two frames pass per loop and the content repeats every two, so the loop has no seam.
    const shifts = [r() - .5, r() - .5];
    box(ctx, pal.ink, 0, 76, 480, 120, 0);
    for (let i = -2; i <= 4; i++) {
      const x = 24 + i * 132 - p * 264, odd = ((i % 2) + 2) % 2;
      scene(ctx, pal, x, 88, 120, 96, { shift: shifts[odd], sky: odd ? pal.sky : pal.soft, r: 4 });
      for (let k = 0; k < 6; k++) { box(ctx, pal.paper, x + k * 22 + 6, 80, 10, 4, 1); box(ctx, pal.paper, x + k * 22 + 6, 188, 10, 4, 1); }
    }
    box(ctx, pal.accent, 236, 64, 8, 144, 4);
  },
};

/**
 * Draw one frame of an agent's card preview on any 2D context (canvas,
 * OffscreenCanvas, a worker). `t` is milliseconds; the loop repeats every
 * `loopMs` and `t = 0` is the poster frame. Draws in a 480×270 space scaled to
 * `width`×`height`. Same inputs, same drawing calls.
 */
export function renderAgentPreview(agent, ctx, t = 0, { width = W, height = H, reducedMotion = false } = {}) {
  if (!ctx || typeof ctx.fillRect !== 'function') throw new TypeError('A 2D canvas context is required.');
  const spec = getAgentPreview(agent), pal = spec.palette;
  const time = reducedMotion || !Number.isFinite(Number(t)) ? 0 : Number(t);
  const phase = ((time % spec.loopMs) + spec.loopMs) % spec.loopMs / spec.loopMs;
  ctx.save();
  ctx.setTransform(width / W, 0, 0, height / H, 0, 0); ctx.globalAlpha = 1;
  const stage = ctx.createLinearGradient(0, 0, W, H); stage.addColorStop(0, pal.background); stage.addColorStop(1, pal.end);
  ctx.fillStyle = stage; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = .12; dot(ctx, PAPER, 453, 15, 164); dot(ctx, PAPER, 38, 272, 96); ctx.globalAlpha = 1;
  MOTIF_DRAW[spec.motif](ctx, phase, pal, mulberry32(spec.seed));
  ctx.restore();
  return Object.freeze({ id: spec.id, motif: spec.motif, phase, loopMs: spec.loopMs });
}

/**
 * Hover-to-play for a card canvas. Shows the poster frame until `play()`,
 * loops at `fps` (default 30) while playing, and returns to the poster on
 * `pause()`. With reduced motion (a boolean or any `MediaQueryList`-like
 * `motion`) `play()` only draws the poster, and a change to reduced motion
 * mid-play stops at once. The canvas backing store follows its CSS size up to
 * `maxPixelRatio`.
 */
export function createPreviewPlayer(canvas, agent, { motion, fps = 30, maxPixelRatio = 2, scope = globalThis } = {}) {
  const ctx = canvas?.getContext?.('2d');
  if (!ctx) throw new TypeError('A canvas with a 2D context is required.');
  const now = () => scope.performance?.now?.() ?? Date.now();
  const request = scope.requestAnimationFrame?.bind(scope) ?? (fn => scope.setTimeout(() => fn(now()), 1000 / 60));
  const cancel = scope.cancelAnimationFrame?.bind(scope) ?? (id => scope.clearTimeout(id));
  const step = 1000 / Math.min(60, Math.max(1, Number(fps) || 30));
  let frame = 0, started = 0, last = -Infinity, disposed = false, playing = false;
  const reduced = () => motion === true || !!(motion && typeof motion === 'object' && motion.matches);
  const size = () => {
    const ratio = Math.min(maxPixelRatio, Math.max(1, scope.devicePixelRatio || 1));
    const w = Math.max(1, Math.round((canvas.clientWidth || canvas.width || W) * ratio)), h = Math.max(1, Math.round((canvas.clientHeight || canvas.height || H) * ratio));
    if (canvas.width !== w) canvas.width = w; if (canvas.height !== h) canvas.height = h;
    return { width: w, height: h };
  };
  const draw = t => renderAgentPreview(agent, ctx, t, { ...size(), reducedMotion: reduced() });
  const tick = at => {
    if (!playing) return;
    if (at - last >= step - 1) { last = at; draw(at - started); }
    frame = request(tick);
  };
  const stop = () => { if (frame) cancel(frame); frame = 0; playing = false; };
  const onMotion = () => { if (reduced() && playing) { stop(); draw(0); } };
  motion?.addEventListener?.('change', onMotion);
  draw(0);
  return {
    get playing() { return playing; },
    play() {
      if (disposed || playing) return playing;
      if (reduced()) { draw(0); return false; }
      playing = true; started = now(); last = -Infinity; frame = request(tick); return true;
    },
    pause() { if (disposed) return; stop(); draw(0); },
    render: t => draw(t),
    dispose() { if (disposed) return; stop(); disposed = true; motion?.removeEventListener?.('change', onMotion); },
  };
}
