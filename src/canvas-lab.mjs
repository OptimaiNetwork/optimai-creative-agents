import { getToolOutputSize, LOCAL_IMAGE_LIMITS, runLocalTool } from './browser-runtime.mjs';
import { AGENT_CATALOG, getAgentTemplate, validateRecipeValues } from './index.mjs';
import { analyzeImageColors, pickAccentColor } from './color.mjs';
import { analyzeImageFocus, focusCoverRect } from './smart-crop.mjs';
import { chooseTitleInk, placeTextBlock, TEXT_POSITIONS } from './text-placement.mjs';
import { canvasMeasure, fitTitle } from './typeset.mjs';
import { GLITCH_EFFECTS, GLITCH_LIMITS, GLITCH_TREATMENTS, glitchPixels, planGlitch } from './glitch.mjs';
import { PRINT_LOOKS, PRINT_STYLES, printPixels, resolvePrint, RISO_INKS } from './print.mjs';
import { composeTransition, resolveTransition, TRANSITION_DIRECTIONS, TRANSITION_LIMITS, TRANSITION_PACES, TRANSITION_STYLES, TRANSITION_TECHNIQUES, transitionProgress, transitionTimes } from './transition.mjs';

const LAB_OPERATIONS = new Set(['mockup', 'poster', 'bento', 'glitch', 'letter', 'blend', 'transition', 'print']);
export const CANVAS_LAB_AGENTS = Object.freeze(Object.fromEntries(AGENT_CATALOG.flatMap(agent =>
  agent.workspace.kind === 'canvas' && LAB_OPERATIONS.has(agent.workspace.operation) ? [[agent.id, agent.workspace.operation]] : [],
)));
export function canvasLabSettings(operation, values = {}) {
  if (!LAB_OPERATIONS.has(operation)) throw new Error('Choose a supported canvas operation.');
  const option = (name, fallback, allowed) => { const value = values[name] ?? fallback; if (!allowed.includes(value)) throw new Error(`Choose a supported ${name}.`); return value; };
  const number = (name, fallback, min, max) => { const value = Number(values[name] ?? fallback); if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}.`); return value; };
  const text = String(values.title ?? 'MAKE SOMETHING\nREMARKABLE.').trim();
  if (!text || text.length > 180) throw new Error('Use a title between 1 and 180 characters.');
  const color = values.color ?? (operation === 'print' ? '#1f2433' : '#c6f87d'); if (!/^#[a-f0-9]{6}$/i.test(color)) throw new Error('Choose a six-digit hex color.');
  return { operation, title: text, color,
    layout: option('layout', 'phone', ['phone', 'desktop', 'gallery']),
    ratio: option('ratio', '4:5', ['1:1', '4:5', '16:9', '9:16']),
    treatment: option('treatment', 'editorial', ['editorial', 'cinema', 'minimal']),
    amount: number('amount', operation === 'print' ? 100 : 35, 0, 100), mix: number('mix', 50, 0, 100),
    crop: option('crop', 'smart', ['smart', 'center']),
    ink: option('ink', 'readable', ['readable', 'image', 'exact']),
    position: option('position', 'auto', TEXT_POSITIONS),
    scrim: option('scrim', 'auto', ['auto', 'off']),
    // Recipe technique names ('light wipe') are accepted as aliases of the styles they draw.
    transition: Object.hasOwn(TRANSITION_TECHNIQUES, values.transition ?? '') ? TRANSITION_TECHNIQUES[values.transition] : option('transition', 'radial', TRANSITION_STYLES),
    direction: option('direction', 'right', TRANSITION_DIRECTIONS),
    pace: option('pace', 'gentle', Object.keys(TRANSITION_PACES)),
    // Recipe treatment names ('colour trails') are accepted as aliases of the effects they draw.
    effect: Object.hasOwn(GLITCH_TREATMENTS, values.effect ?? '') ? GLITCH_TREATMENTS[values.effect] : option('effect', 'blocks', GLITCH_EFFECTS),
    seed: (() => { const value = number('seed', 1, 0, GLITCH_LIMITS.seed); if (!Number.isInteger(value)) throw new Error(`seed must be a whole number from 0 to ${GLITCH_LIMITS.seed}.`); return value; })(),
    // Recipe style names ('riso duotone') are accepted as aliases of the looks they draw.
    look: Object.hasOwn(PRINT_STYLES, values.look ?? '') ? PRINT_STYLES[values.look] : option('look', 'riso', PRINT_LOOKS),
    inks: option('inks', 'pink + blue', Object.keys(RISO_INKS)),
    scale: (() => { const value = number('scale', 3, 1, 12); if (!Number.isInteger(value)) throw new Error('scale must be a whole number from 1 to 12.'); return value; })(),
    frames: (() => { const value = number('frames', 5, 0, TRANSITION_LIMITS.frames); if (!Number.isInteger(value) || value === 1) throw new Error(`frames must be 0 or a whole number from 2 to ${TRANSITION_LIMITS.frames}.`); return value; })(),
  };
}
/** Map portable recipe settings to the actual canvas engine, including v1 aliases. */
export function canvasLabRecipeSettings(templateId, values = {}) {
  const template = getAgentTemplate(templateId);
  const operation = CANVAS_LAB_AGENTS[templateId];
  if (!template || !operation) throw new Error('Choose a reviewed canvas composition template.');
  const errors = validateRecipeValues(templateId, values);
  if (errors.length) throw new Error(errors.join('\n'));
  const defaults = Object.fromEntries(template.fields.map(field => [field.id, field.default]));
  const settings = { ...defaults, ...values };
  const has = key => Object.hasOwn(values, key);
  const formats = { 'portrait poster': '4:5', 'square cover': '1:1', 'wide banner': '16:9' };
  const ratio = has('ratio') ? values.ratio : has('format') ? formats[values.format] : settings.ratio ?? formats[settings.format] ?? '4:5';
  const title = has('title') ? values.title : has('text') ? values.text : settings.title ?? settings.text ?? 'MAKE SOMETHING\nREMARKABLE.';
  const treatment = has('treatment') ? values.treatment : has('style') ? values.style === 'cinematic' ? 'cinema' : 'editorial' : settings.treatment ?? 'editorial';
  const amount = has('amount') ? values.amount : has('intensity') ? values.intensity === 'medium' ? 60 : 35 : settings.amount ?? 35;
  const color = (settings.color ?? '#c6f87d').replace(/^#([a-f0-9])([a-f0-9])([a-f0-9])$/i, '#$1$1$2$2$3$3');
  return canvasLabSettings(operation, {
    title, color, ratio: ratio === 'original' ? '4:5' : ratio,
    layout: operation === 'mockup' ? settings.layout ?? 'phone' : 'phone',
    treatment, amount, mix: settings.mix ?? 50,
    ...(operation === 'transition' ? { transition: settings.transition, pace: settings.pace } : {}),
    ...(operation === 'glitch' ? { effect: settings.effect, seed: settings.seed } : {}),
    ...(operation === 'print' ? { look: settings.look, inks: settings.inks, scale: settings.scale, seed: settings.seed } : {}),
  });
}
const abort = signal => { if (signal?.aborted) throw new DOMException('Cancelled.', 'AbortError'); };
function abortable(work, signal, discard) {
  if (!signal) return work;
  return new Promise((resolve, reject) => {
    let settled = false;
    const cancel = () => {
      if (settled) return;
      settled = true; signal.removeEventListener('abort', cancel);
      reject(new DOMException('Cancelled.', 'AbortError'));
    };
    signal.addEventListener('abort', cancel, { once: true });
    work.then(value => {
      signal.removeEventListener('abort', cancel);
      if (settled) { discard?.(value); return; }
      settled = true; resolve(value);
    }, error => {
      signal.removeEventListener('abort', cancel);
      if (!settled) { settled = true; reject(error); }
    });
    if (signal.aborted) cancel();
  });
}
function fit(ctx, image, x, y, width, height, contain = false, focus = null) {
  if (!contain && focus) {
    const area = focusCoverRect(image.width, image.height, width, height, focus);
    ctx.drawImage(image, area.x, area.y, area.width, area.height, x, y, width, height); return;
  }
  const scale = contain ? Math.min(width / image.width, height / image.height) : Math.max(width / image.width, height / image.height);
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip();
  ctx.drawImage(image, x + (width - image.width * scale) / 2, y + (height - image.height * scale) / 2, image.width * scale, image.height * scale); ctx.restore();
}
function round(ctx, x, y, width, height, radius, fill) { ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(x, y, width, height, radius); ctx.fill(); }
// Balanced lines (at most six) at the largest size that fits, with optical tracking and leading.
function lettering(ctx, settings, width, height) {
  const font = size => `900 ${size}px system-ui, sans-serif`;
  const layout = fitTitle(settings.title, { measure: canvasMeasure(ctx, font), width: width * .82, height: height * .65, maxSize: Math.round(width / (settings.title.length > 50 ? 12 : 8)), minSize: 16, maxLines: 6 });
  ctx.font = font(layout.fontSize); if ('letterSpacing' in ctx) ctx.letterSpacing = `${layout.tracking}px`;
  return { ...layout, lines: layout.lines.slice(0, 6), height: Math.min(6, layout.lines.length) * layout.lineHeight };
}
// Large bold titles: WCAG AA for large text (3:1) over every colour that covers at least 5% of the title area,
// keeping the chosen ink behind a scrim rather than greying it out.
function inkColor(canvas, area, settings, image) {
  if (settings.ink === 'exact') return { ink: settings.color, scrim: null };
  const surfaces = analyzeImageColors(canvas, canvas.width, canvas.height, { region: area, count: 4 })?.filter(surface => surface.weight >= .05);
  if (!surfaces?.length) return { ink: settings.color, scrim: null };
  const accent = settings.ink === 'image' && image ? pickAccentColor(analyzeImageColors(image, image.width, image.height) ?? []) : null;
  const { ink, scrim } = chooseTitleInk(surfaces, { prefer: [accent, settings.color], minContrast: 3, scrim: settings.scrim === 'auto' });
  return { ink, scrim };
}
const readable = ctx => typeof ctx.getImageData === 'function' && typeof ctx.putImageData === 'function' && typeof ctx.createImageData === 'function';
// Draw both shots at one size and read their pixels, or null where pixels cannot be read.
function shotPixels(ctx, images, focus, width, height) {
  if (!readable(ctx)) return null;
  try { return images.map((image, index) => { fit(ctx, image, 0, 0, width, height, false, focus[index]); return ctx.getImageData(0, 0, width, height); }); }
  catch { return null; } // A tainted canvas falls back to a dissolve.
}
function paintTransition(ctx, shots, width, height, progress, plan, x = 0, y = 0) {
  const image = ctx.createImageData(width, height);
  composeTransition(shots[0].data, shots[1].data, width, height, progress, plan, image.data);
  ctx.putImageData(image, x, y);
}
/** Original browser-only canvas utilities. No network, image generation or video codec. */
export async function runCanvasLab(operation, files = [], values = {}, signal) {
  const settings = canvasLabSettings(operation, values); abort(signal);
  const maximum = operation === 'bento' ? 8 : ['blend', 'transition'].includes(operation) ? 2 : 1;
  if (!Array.isArray(files) || files.length > maximum) throw new Error(`Choose up to ${maximum} images.`);
  if (!files.length && !['poster', 'letter'].includes(operation)) throw new Error('Add an image to start.');
  if (['blend', 'transition'].includes(operation) && files.length !== 2) throw new Error('Choose two images for this composition.');
  const images = []; let canvas, source, thumb, film, ink, lines, placement, scrim, transition, strip, glitch, print; let pixels = 0;
  try {
    // Reuse the signature, dimensions, decode and memory validation of the public processor.
    for (const file of files) {
      const resized = await runLocalTool('image-resize', [file], { width: 1024, ratio: 'original' }, signal); abort(signal);
      if (typeof createImageBitmap !== 'function') throw new Error('This browser cannot decode canvas compositions. Use a browser with ImageBitmap support.');
      const image = await abortable(createImageBitmap(resized.blob), signal, late => late.close());
      try {
        abort(signal);
        getToolOutputSize('image-filter', { width: image.width, height: image.height });
        pixels += image.width * image.height;
        if (pixels > LOCAL_IMAGE_LIMITS.pixels) throw new Error('Together, these images contain more than 16 million pixels. Use smaller images for this composition.');
        images.push(image);
      } catch (error) { image.close(); throw error; }
    }
    // Keep each subject in frame; environments without pixel reads stay centred.
    const focus = images.map(image => settings.crop === 'smart' ? analyzeImageFocus(image, image.width, image.height) : null);
    abort(signal);
    const [rw, rh] = settings.ratio.split(':').map(Number); const width = 1200, height = Math.round(width * rh / rw);
    canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('This browser cannot create a canvas.');
    const background = ctx.createLinearGradient(0, 0, width, height); background.addColorStop(0, '#29372b'); background.addColorStop(1, '#0b100e'); ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
    if (operation === 'mockup') {
      const phone = settings.layout === 'phone'; const x = phone ? width * .32 : width * .12, y = height * .12, w = phone ? width * .36 : width * .76, h = height * .72;
      ctx.shadowColor = '#0009'; ctx.shadowBlur = 45; ctx.shadowOffsetY = 30; round(ctx, x, y, w, h, phone ? 50 : 18, '#080a09'); ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      ctx.save(); ctx.beginPath(); ctx.roundRect(x + 12, y + 12, w - 24, h - 24, phone ? 40 : 10); ctx.clip(); fit(ctx, images[0], x + 12, y + 12, w - 24, h - 24, false, focus[0]); ctx.restore();
      if (phone) round(ctx, x + w * .3, y + 20, w * .4, 25, 16, '#080a09');
      else if (settings.layout === 'desktop') { round(ctx, width * .43, y + h, width * .14, height * .055, 4, '#39423c'); round(ctx, width * .31, y + h + height * .05, width * .38, 12, 5, '#58655b'); }
      ctx.fillStyle = '#b4c4b7'; ctx.font = '500 18px system-ui'; ctx.textAlign = 'center'; ctx.fillText('YOUR DESIGN, IN CONTEXT.', width / 2, height * .93);
    } else if (operation === 'bento') {
      const gap = 22, pad = 38; const heroW = files.length > 1 ? (width - pad * 2 - gap) * .62 : width - pad * 2;
      fit(ctx, images[0], pad, pad, heroW, height - pad * 2, false, focus[0]);
      images.slice(1).forEach((image, index) => { const cellH = (height - pad * 2 - gap * (images.length - 2)) / (images.length - 1); fit(ctx, image, pad + heroW + gap, pad + index * (cellH + gap), width - pad * 2 - heroW - gap, cellH, false, focus[index + 1]); });
    } else if (operation === 'transition') {
      const plan = resolveTransition({ style: settings.transition, direction: settings.direction, pace: settings.pace });
      const progress = transitionProgress(settings.mix / 100, plan.ease), shots = plan.style === 'dissolve' ? null : shotPixels(ctx, images, focus, width, height);
      // A dissolve, or a canvas that cannot read pixels, crossfades at the eased progress.
      if (shots) paintTransition(ctx, shots, width, height, progress, plan);
      else { fit(ctx, images[0], 0, 0, width, height, false, focus[0]); ctx.globalAlpha = progress; fit(ctx, images[1], 0, 0, width, height, false, focus[1]); ctx.globalAlpha = 1; }
      transition = { style: shots ? plan.style : 'dissolve', ...(shots || plan.style === 'dissolve' ? {} : { requested: plan.style }), direction: plan.direction, pace: settings.pace, progress: Math.round(progress * 1000) / 1000 };
      if (shots && settings.frames) {
        // The whole move as a strip of small frames, evenly spaced in time.
        const times = transitionTimes(settings.frames), gap = 12, tw = Math.floor(Math.min(320, (2400 - gap * (times.length + 1)) / times.length)), th = Math.round(tw * height / width);
        thumb = document.createElement('canvas'); thumb.width = tw; thumb.height = th;
        const thumbContext = thumb.getContext('2d'), small = thumbContext && shotPixels(thumbContext, images, focus, tw, th);
        film = document.createElement('canvas'); film.width = gap + times.length * (tw + gap); film.height = th + gap * 2;
        const filmContext = film.getContext('2d');
        if (small && filmContext && readable(filmContext)) {
          filmContext.fillStyle = '#0b100e'; filmContext.fillRect(0, 0, film.width, film.height);
          times.forEach((time, index) => { abort(signal); paintTransition(filmContext, small, tw, th, transitionProgress(time, plan.ease), plan, gap + index * (tw + gap), gap); });
          const blob = await abortable(new Promise((resolve, reject) => film.toBlob(value => value ? resolve(value) : reject(new Error('Could not export the transition strip.')), 'image/png')), signal);
          strip = { blob, width: film.width, height: film.height, frames: times.map(time => Math.round(time * 100)) };
        }
      }
    } else if (operation === 'blend') {
      fit(ctx, images[0], 0, 0, width, height, false, focus[0]); ctx.globalAlpha = settings.mix / 100; fit(ctx, images[1], 0, 0, width, height, false, focus[1]); ctx.globalAlpha = 1;
    } else if (operation === 'glitch') {
      fit(ctx, images[0], 0, 0, width, height, false, focus[0]);
      const plan = planGlitch(width, height, settings); let frame = null;
      if (readable(ctx)) try { frame = ctx.getImageData(0, 0, width, height); } catch { frame = null; } // A tainted canvas draws the seeded bands only.
      if (frame) { glitchPixels(frame.data, width, height, plan, frame.data); ctx.putImageData(frame, 0, 0); }
      else {
        source = document.createElement('canvas'); source.width = width; source.height = height;
        const sourceContext = source.getContext('2d'); if (!sourceContext) throw new Error('This browser cannot create a glitch canvas.');
        sourceContext.drawImage(canvas, 0, 0);
        for (const band of plan.bands) ctx.drawImage(source, 0, band.y, width, band.height, band.shift, band.y, width, band.height);
        ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = .13 * settings.amount / 100; ctx.fillStyle = '#df56dc'; ctx.fillRect(0, 0, width, height); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      }
      glitch = { effect: plan.effect, seed: plan.seed, amount: plan.amount, engine: frame ? 'pixels' : 'bands' };
    } else if (operation === 'print') {
      fit(ctx, images[0], 0, 0, width, height, false, focus[0]);
      const plan = resolvePrint({ look: settings.look, scale: settings.scale, amount: settings.amount, seed: settings.seed, ink: settings.color, inks: settings.inks });
      let frame = null;
      if (readable(ctx)) try { frame = ctx.getImageData(0, 0, width, height); } catch { frame = null; }
      // A print is made of pixels; drawing an unprinted image here would pass it off as a print.
      if (!frame) throw new Error('This browser cannot read canvas pixels, so the print look cannot be drawn.');
      printPixels(frame.data, width, height, plan, frame.data); ctx.putImageData(frame, 0, 0);
      print = { look: plan.look, scale: plan.scale, amount: plan.amount, seed: plan.seed, ...(plan.look === 'riso' ? { inks: [...plan.inks] } : { ink: plan.ink }), paper: plan.paper };
    } else {
      if (images[0]) fit(ctx, images[0], 0, 0, width, height, false, focus[0]);
      const type = lettering(ctx, settings, width, height); lines = type.lines; ctx.textBaseline = 'top';
      const cinema = settings.treatment === 'cinema', span = Math.min(width * .84, type.width);
      // The title goes to the calmest part of the composed image, below the credit line; a blank artboard keeps the classic layout.
      const calm = settings.position === 'auto' && images[0] ? analyzeImageFocus(canvas, width, height) : null;
      const bounds = { x: width * .08, y: height * .1, width: width * .84, height: height * (operation === 'poster' ? .78 : .8) };
      const place = placeTextBlock(calm, { canvas: { width, height }, block: { width: span, height: type.height }, bounds, position: settings.position,
        home: { x: cinema ? .5 : 0, y: operation === 'poster' ? 1 : .5 }, columns: !cinema && span < bounds.width * .8 ? 3 : 1 });
      placement = { position: place.position, x: Math.round(place.x), y: Math.round(place.y), moved: place.moved };
      // The poster shade darkens toward the top when the title moved there, otherwise toward the bottom as before.
      if (operation === 'poster') { const top = place.moved && place.position === 'top'; const shade = ctx.createLinearGradient(0, top ? height * .75 : height * .25, 0, top ? 0 : height); shade.addColorStop(0, '#0000'); shade.addColorStop(1, '#000e'); ctx.fillStyle = shade; ctx.fillRect(0, 0, width, height); }
      ({ ink, scrim } = inkColor(canvas, { x: place.x, y: place.y, width: span, height: type.height }, settings, images[0]));
      if (scrim) {
        const pad = type.lineHeight * .35, [r, g, b] = [1, 3, 5].map(index => parseInt(scrim.color.slice(index, index + 2), 16));
        // Only the blurred shadow of a panel drawn off the canvas lands on it, so the scrim has no hard edge.
        ctx.save(); ctx.fillStyle = ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${scrim.opacity})`; ctx.shadowBlur = pad * 2; ctx.shadowOffsetX = width * 2;
        ctx.beginPath(); ctx.roundRect(place.x - pad - width * 2, place.y - pad * .6, span + pad * 2, type.height + pad * 1.2, pad); ctx.fill(); ctx.restore();
      }
      ctx.fillStyle = ink; ctx.textAlign = cinema ? 'center' : 'left';
      lines.forEach((line, index) => ctx.fillText(line, cinema ? place.x + span / 2 : place.x, place.y + index * type.lineHeight, width * .86));
      if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'; ctx.font = '500 20px system-ui'; ctx.fillStyle = '#e1e9da'; ctx.textAlign = 'left'; ctx.fillText('AN OPTIMAI ORIGINAL', width * .08, height * .045);
      ctx.strokeStyle = '#fff7'; ctx.lineWidth = 2; ctx.strokeRect(width * .04, height * .025, width * .92, height * .95);
    }
    abort(signal);
    const blob = await abortable(new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not export this canvas.')), 'image/png')), signal);
    abort(signal);
    if (blob.size > 20 * 1024 * 1024) throw new Error('The exported image is too large. Use a smaller composition.');
    return { blob, width, height, filename: `optimai-${operation}.png`, ...(ink ? { ink, lines, placement, scrim } : {}), ...(transition ? { transition, strip: strip ?? null } : {}), ...(glitch ? { glitch } : {}), ...(print ? { print } : {}) };
  } finally { images.forEach(image => image.close()); for (const value of [source, thumb, film, canvas]) if (value) value.width = value.height = 1; }
}
