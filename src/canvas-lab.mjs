import { getToolOutputSize, LOCAL_IMAGE_LIMITS, runLocalTool } from './browser-runtime.mjs';

export const CANVAS_LAB_AGENTS = Object.freeze({
  'mockup-maker': 'mockup', 'poster-lab': 'poster', 'pixel-layout': 'bento',
  'glitch-cut': 'glitch', 'letter-pose': 'letter', 'reference-blend': 'blend',
  'transition-lab': 'transition',
});
export function canvasLabSettings(operation, values = {}) {
  if (!Object.values(CANVAS_LAB_AGENTS).includes(operation)) throw new Error('Choose a supported canvas operation.');
  const option = (name, fallback, allowed) => { const value = values[name] ?? fallback; if (!allowed.includes(value)) throw new Error(`Choose a supported ${name}.`); return value; };
  const number = (name, fallback, min, max) => { const value = Number(values[name] ?? fallback); if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}.`); return value; };
  const text = String(values.title ?? 'MAKE SOMETHING\nREMARKABLE.').trim();
  if (!text || text.length > 180) throw new Error('Use a title between 1 and 180 characters.');
  const color = values.color ?? '#c6f87d'; if (!/^#[a-f0-9]{6}$/i.test(color)) throw new Error('Choose a six-digit hex color.');
  return { operation, title: text, color,
    layout: option('layout', 'phone', ['phone', 'desktop', 'gallery']),
    ratio: option('ratio', '4:5', ['1:1', '4:5', '16:9', '9:16']),
    treatment: option('treatment', 'editorial', ['editorial', 'cinema', 'minimal']),
    amount: number('amount', 35, 0, 100), mix: number('mix', 50, 0, 100),
  };
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
function fit(ctx, image, x, y, width, height, contain = false) {
  const scale = contain ? Math.min(width / image.width, height / image.height) : Math.max(width / image.width, height / image.height);
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip();
  ctx.drawImage(image, x + (width - image.width * scale) / 2, y + (height - image.height * scale) / 2, image.width * scale, image.height * scale); ctx.restore();
}
function round(ctx, x, y, width, height, radius, fill) { ctx.fillStyle = fill; ctx.beginPath(); ctx.roundRect(x, y, width, height, radius); ctx.fill(); }
function titleLines(ctx, text, width) {
  const lines = []; for (const paragraph of text.split('\n')) { let line = ''; for (const word of paragraph.split(/\s+/)) { const next = line ? `${line} ${word}` : word; if (line && ctx.measureText(next).width > width) { lines.push(line); line = word; } else line = next; } if (line) lines.push(line); } return lines.slice(0, 6);
}
function lettering(ctx, settings, width, height) {
  const maxSize = Math.round(width / (settings.title.length > 50 ? 12 : 8));
  ctx.font = `900 ${maxSize}px system-ui, sans-serif`; let lines = titleLines(ctx, settings.title, width * .82); let fontSize = maxSize;
  while ((lines.length * fontSize * 1.1 > height * .65 || lines.some(line => ctx.measureText(line).width > width * .86)) && fontSize > 16) { fontSize -= 2; ctx.font = `900 ${fontSize}px system-ui, sans-serif`; lines = titleLines(ctx, settings.title, width * .82); }
  return { lines, fontSize };
}
/** Original browser-only canvas utilities. No network, image generation or video codec. */
export async function runCanvasLab(operation, files = [], values = {}, signal) {
  const settings = canvasLabSettings(operation, values); abort(signal);
  const maximum = operation === 'bento' ? 8 : ['blend', 'transition'].includes(operation) ? 2 : 1;
  if (!Array.isArray(files) || files.length > maximum) throw new Error(`Choose up to ${maximum} images.`);
  if (!files.length && !['poster', 'letter'].includes(operation)) throw new Error('Add an image to start.');
  if (['blend', 'transition'].includes(operation) && files.length !== 2) throw new Error('Choose two images for this composition.');
  const images = []; let canvas, source; let pixels = 0;
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
    const [rw, rh] = settings.ratio.split(':').map(Number); const width = 1200, height = Math.round(width * rh / rw);
    canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('This browser cannot create a canvas.');
    const background = ctx.createLinearGradient(0, 0, width, height); background.addColorStop(0, '#29372b'); background.addColorStop(1, '#0b100e'); ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
    if (operation === 'mockup') {
      const phone = settings.layout === 'phone'; const x = phone ? width * .32 : width * .12, y = height * .12, w = phone ? width * .36 : width * .76, h = height * .72;
      ctx.shadowColor = '#0009'; ctx.shadowBlur = 45; ctx.shadowOffsetY = 30; round(ctx, x, y, w, h, phone ? 50 : 18, '#080a09'); ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      ctx.save(); ctx.beginPath(); ctx.roundRect(x + 12, y + 12, w - 24, h - 24, phone ? 40 : 10); ctx.clip(); fit(ctx, images[0], x + 12, y + 12, w - 24, h - 24); ctx.restore();
      if (phone) round(ctx, x + w * .3, y + 20, w * .4, 25, 16, '#080a09');
      else if (settings.layout === 'desktop') { round(ctx, width * .43, y + h, width * .14, height * .055, 4, '#39423c'); round(ctx, width * .31, y + h + height * .05, width * .38, 12, 5, '#58655b'); }
      ctx.fillStyle = '#b4c4b7'; ctx.font = '500 18px system-ui'; ctx.textAlign = 'center'; ctx.fillText('YOUR DESIGN, IN CONTEXT.', width / 2, height * .93);
    } else if (operation === 'bento') {
      const gap = 22, pad = 38; const heroW = files.length > 1 ? (width - pad * 2 - gap) * .62 : width - pad * 2;
      fit(ctx, images[0], pad, pad, heroW, height - pad * 2);
      images.slice(1).forEach((image, index) => { const cellH = (height - pad * 2 - gap * (images.length - 2)) / (images.length - 1); fit(ctx, image, pad + heroW + gap, pad + index * (cellH + gap), width - pad * 2 - heroW - gap, cellH); });
    } else if (['blend', 'transition'].includes(operation)) {
      fit(ctx, images[0], 0, 0, width, height); ctx.globalAlpha = settings.mix / 100; fit(ctx, images[1], 0, 0, width, height); ctx.globalAlpha = 1;
    } else if (operation === 'glitch') {
      fit(ctx, images[0], 0, 0, width, height); const amount = settings.amount / 100;
      source = document.createElement('canvas'); source.width = width; source.height = height;
      const sourceContext = source.getContext('2d'); if (!sourceContext) throw new Error('This browser cannot create a glitch canvas.');
      sourceContext.drawImage(canvas, 0, 0);
      for (let index = 0; index < 24; index++) { const y = Math.floor(height * index / 24), h = Math.max(1, Math.floor(height / 70)); const shift = Math.round(Math.sin(index * 13.7) * width * .06 * amount); ctx.drawImage(source, 0, y, width, h, shift, y, width, h); }
      ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = .13 * amount; ctx.fillStyle = '#df56dc'; ctx.fillRect(0, 0, width, height); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; source.width = source.height = 1;
    } else {
      if (images[0]) fit(ctx, images[0], 0, 0, width, height);
      if (operation === 'poster') { const shade = ctx.createLinearGradient(0, height * .25, 0, height); shade.addColorStop(0, '#0000'); shade.addColorStop(1, '#000e'); ctx.fillStyle = shade; ctx.fillRect(0, 0, width, height); }
      const { lines, fontSize } = lettering(ctx, settings, width, height); ctx.fillStyle = settings.color; ctx.textBaseline = 'top'; const start = operation === 'poster' ? height - lines.length * fontSize * 1.1 - height * .12 : (height - lines.length * fontSize * 1.1) / 2;
      if (settings.treatment === 'cinema') { ctx.textAlign = 'center'; } else ctx.textAlign = 'left';
      lines.forEach((line, index) => ctx.fillText(line, settings.treatment === 'cinema' ? width / 2 : width * .08, start + index * fontSize * 1.1));
      ctx.font = '500 20px system-ui'; ctx.fillStyle = '#e1e9da'; ctx.textAlign = 'left'; ctx.fillText('AN OPTIMAI ORIGINAL', width * .08, height * .045);
      ctx.strokeStyle = '#fff7'; ctx.lineWidth = 2; ctx.strokeRect(width * .04, height * .025, width * .92, height * .95);
    }
    abort(signal);
    const blob = await abortable(new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not export this canvas.')), 'image/png')), signal);
    abort(signal);
    if (blob.size > 20 * 1024 * 1024) throw new Error('The exported image is too large. Use a smaller composition.');
    return { blob, width, height, filename: `optimai-${operation}.png` };
  } finally { images.forEach(image => image.close()); if (source) source.width = source.height = 1; if (canvas) canvas.width = canvas.height = 1; }
}
