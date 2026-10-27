import { gradePixels, isIdentityGrade, resolveGrade } from './color-grade.mjs';
import { applyLut, filmLut, parseCubeLut } from './lut.mjs';
import { analyzeImageColors, pickAccentColor, toOklab } from './color.mjs';
import { analyzeImageFocus, focusCoverRect } from './smart-crop.mjs';
import { chooseTitleInk, placeTextBlock, TEXT_POSITIONS } from './text-placement.mjs';
import { canvasMeasure, fitTitle } from './typeset.mjs';
export const LOCAL_IMAGE_LIMITS = Object.freeze({
    files: 8,
    bytes: 20 * 1024 * 1024,
    dimension: 4096,
    pixels: 16_000_000,
});
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const OPERATIONS = new Set(['image-filter', 'image-resize', 'image-grid', 'type-overlay']);
/** Returns a displayable validation message, or null for an accepted file. */
export function validateLocalImageFile(file) {
    if (!file || !IMAGE_TYPES.has(file.type))
        return 'Choose a PNG, JPEG or WebP image.';
    if (!Number.isFinite(file.size) || file.size <= 0)
        return 'This image is empty. Choose another file.';
    if (file.size > LOCAL_IMAGE_LIMITS.bytes)
        return 'Each image must be 20 MB or smaller.';
    return null;
}
function checkOperation(operation) {
    if (!OPERATIONS.has(operation))
        throw new Error('This tool cannot run locally.');
}
function checkSize(size) {
    if (!Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width < 1 || size.height < 1) {
        throw new Error('Image dimensions must be positive whole numbers.');
    }
    if (size.width > LOCAL_IMAGE_LIMITS.dimension || size.height > LOCAL_IMAGE_LIMITS.dimension) {
        throw new Error('Images must be no larger than 4096 pixels on either side. Choose a smaller image.');
    }
    if (size.width * size.height > LOCAL_IMAGE_LIMITS.pixels) {
        throw new Error('Images must contain no more than 16 million pixels. Choose smaller dimensions.');
    }
    return size;
}
function numberValue(values, name, fallback, min, max, integer = true) {
    const raw = values[name];
    const value = raw === undefined || raw === '' ? fallback : Number(raw);
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
        throw new Error(`${name === 'fontSize' ? 'Font size' : name[0].toUpperCase() + name.slice(1)} must be ${integer ? 'a whole number ' : ''}between ${min} and ${max}.`);
    }
    return value;
}
function optionValue(values, name, fallback, allowed) {
    const value = values[name] === undefined || values[name] === '' ? fallback : String(values[name]);
    if (!allowed.includes(value))
        throw new Error(`Choose a supported ${name}.`);
    return value;
}
function colorValue(values, name, fallback) {
    const value = values[name] === undefined || values[name] === '' ? fallback : String(values[name]);
    if (!/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value))
        throw new Error(`Use a hex color for ${name}, such as #101312.`);
    return value;
}
function sourceSizes(dimensions) {
    const sources = Array.isArray(dimensions) ? dimensions : [dimensions];
    if (!sources.length || sources.length > LOCAL_IMAGE_LIMITS.files)
        throw new Error('Choose between 1 and 8 images.');
    sources.forEach(checkSize);
    if (sources.reduce((sum, source) => sum + source.width * source.height, 0) > LOCAL_IMAGE_LIMITS.pixels) {
        throw new Error('Together, these images contain more than 16 million pixels. Use smaller images for this layout.');
    }
    return sources;
}
function gridLayout(sources, values) {
    const columns = Math.min(sources.length, numberValue(values, 'columns', 2, 1, 4));
    const rows = Math.ceil(sources.length / columns);
    const gap = numberValue(values, 'gap', 16, 0, 80);
    const aspect = sources[0].height / sources[0].width;
    const widthLimit = Math.floor(Math.min(1200, sources[0].width, (LOCAL_IMAGE_LIMITS.dimension - gap * (columns - 1)) / columns, ((LOCAL_IMAGE_LIMITS.dimension - gap * (rows - 1)) / rows) / aspect));
    const atWidth = (cellWidth) => {
        const cellHeight = Math.max(1, Math.floor(cellWidth * aspect));
        return {
            width: cellWidth * columns + gap * (columns - 1),
            height: cellHeight * rows + gap * (rows - 1),
            cellWidth, cellHeight, columns, rows, gap,
        };
    };
    // Search the largest whole-pixel cells that fit the canvas memory budget.
    let low = 1, high = Math.max(1, widthLimit);
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        const candidate = atWidth(middle);
        if (candidate.width * candidate.height <= LOCAL_IMAGE_LIMITS.pixels)
            low = middle;
        else
            high = middle - 1;
    }
    return atWidth(low);
}
/** Computes exactly the canvas dimensions that runLocalTool will create. */
export function getToolOutputSize(operation, dimensions, values = {}) {
    checkOperation(operation);
    const sources = sourceSizes(dimensions);
    if (operation !== 'image-grid' && sources.length !== 1)
        throw new Error('This tool uses one image at a time.');
    if (operation === 'image-grid') {
        const { width, height } = gridLayout(sources, values);
        return checkSize({ width, height });
    }
    if (operation !== 'image-resize')
        return { ...sources[0] };
    const source = sources[0];
    const hasWidth = values.width !== undefined && values.width !== '';
    const hasHeight = values.height !== undefined && values.height !== '';
    const width = numberValue(values, 'width', source.width, 1, LOCAL_IMAGE_LIMITS.dimension);
    const height = numberValue(values, 'height', source.height, 1, LOCAL_IMAGE_LIMITS.dimension);
    const ratio = optionValue(values, 'ratio', 'original', ['original', '1:1', '16:9', '9:16', '4:5']);
    if (ratio !== 'original') {
        const [rw, rh] = ratio.split(':').map(Number);
        const result = hasWidth || !hasHeight
            ? { width, height: Math.max(1, Math.round(width * rh / rw)) }
            : { width: Math.max(1, Math.round(height * rw / rh)), height };
        return checkSize(result);
    }
    if (hasWidth && !hasHeight)
        return checkSize({ width, height: Math.max(1, Math.round(width * source.height / source.width)) });
    if (!hasWidth && hasHeight)
        return checkSize({ width: Math.max(1, Math.round(height * source.width / source.height)), height });
    return checkSize({ width, height });
}
function throwIfAborted(signal) {
    if (signal?.aborted)
        throw new DOMException('Tool cancelled.', 'AbortError');
}
function abortable(work, signal, discard) {
    if (!signal)
        return work;
    return new Promise((resolve, reject) => {
        let settled = false;
        const abort = () => {
            if (settled)
                return;
            settled = true;
            signal.removeEventListener('abort', abort);
            reject(new DOMException('Tool cancelled.', 'AbortError'));
        };
        signal.addEventListener('abort', abort, { once: true });
        work.then(value => {
            signal.removeEventListener('abort', abort);
            if (settled) {
                discard?.(value);
                return;
            }
            settled = true;
            resolve(value);
        }, error => {
            signal.removeEventListener('abort', abort);
            if (settled)
                return;
            settled = true;
            reject(error);
        });
        if (signal.aborted)
            abort();
    });
}
async function checkSignature(file, signal) {
    const bytes = new Uint8Array(await abortable(file.slice(0, 12).arrayBuffer(), signal));
    const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const webp = bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70
        && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80;
    if (!(file.type === 'image/png' ? png : file.type === 'image/jpeg' ? jpeg : webp)) {
        throw new Error('This file does not match its image format. Choose a valid PNG, JPEG or WebP image.');
    }
}
async function loadLocalImage(file, signal) {
    throwIfAborted(signal);
    if (typeof createImageBitmap === 'function') {
        try {
            const bitmap = await abortable(createImageBitmap(file), signal, late => late.close());
            try {
                throwIfAborted(signal);
                const size = checkSize({ width: bitmap.width, height: bitmap.height });
                return { ...size, source: bitmap, release: () => bitmap.close() };
            }
            catch (error) {
                bitmap.close();
                throw error;
            }
        }
        catch (error) {
            if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError'))
                throw error;
            // Some browsers decode a supported image only through HTMLImageElement.
            if (error instanceof Error && /dimensions|pixels|4096/.test(error.message))
                throw error;
        }
    }
    return new Promise((resolve, reject) => {
        const image = new Image();
        const url = URL.createObjectURL(file);
        const cleanup = () => {
            image.onload = null;
            image.onerror = null;
            signal?.removeEventListener('abort', abort);
            URL.revokeObjectURL(url);
        };
        const abort = () => {
            cleanup();
            image.src = '';
            reject(new DOMException('Tool cancelled.', 'AbortError'));
        };
        image.onload = () => {
            cleanup();
            try {
                throwIfAborted(signal);
                const size = checkSize({ width: image.naturalWidth, height: image.naturalHeight });
                resolve({ ...size, source: image, release: () => { image.src = ''; } });
            }
            catch (error) {
                image.src = '';
                reject(error);
            }
        };
        image.onerror = () => {
            cleanup();
            image.src = '';
            reject(new Error('This image could not be opened. Try another PNG, JPEG or WebP file.'));
        };
        image.decoding = 'async';
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted)
            abort();
        else
            image.src = url;
    });
}
function drawFit(context, image, x, y, width, height, fit, crop = 'smart') {
    // Matching aspects leave nothing to crop, so they skip the pixel read.
    if (fit !== 'contain' && crop === 'smart' && Math.abs(image.width * height - width * image.height) > 1e-6 * image.height * height) {
        // Read interest once per decoded image; null keeps the centred crop.
        if (image.focus === undefined)
            image.focus = analyzeImageFocus(image.source, image.width, image.height);
        if (image.focus) {
            const area = focusCoverRect(image.width, image.height, width, height, image.focus);
            context.drawImage(image.source, area.x, area.y, area.width, area.height, x, y, width, height);
            return;
        }
    }
    const scale = fit === 'contain' ? Math.min(width / image.width, height / image.height) : Math.max(width / image.width, height / image.height);
    const drawnWidth = image.width * scale, drawnHeight = image.height * scale;
    context.save();
    context.beginPath();
    context.rect(x, y, width, height);
    context.clip();
    context.drawImage(image.source, x + (width - drawnWidth) / 2, y + (height - drawnHeight) / 2, drawnWidth, drawnHeight);
    context.restore();
}
function filterValue(preset, amount) {
    const value = amount / 100;
    switch (preset) {
        case 'noir': return `grayscale(${value}) contrast(${1 + .18 * value})`;
        case 'warm': return `sepia(${.32 * value}) saturate(${1 + .24 * value})`;
        case 'cool': return `hue-rotate(${12 * value}deg) saturate(${1 - .18 * value}) brightness(${1 + .025 * value})`;
        case 'punchy': return `saturate(${1 + .55 * value}) contrast(${1 + .12 * value})`;
        default: return 'none';
    }
}
/**
 * Draw and grade the image per pixel in bands of rows, then apply the optional
 * LUT to the same band, yielding between bands so large images stay cancellable.
 * Returns false, with nothing drawn, when the context cannot read pixels; the
 * caller then uses the CSS filter fallback.
 */
async function gradeCanvas(context, image, size, grade, seed, signal, lut, amount) {
    if (typeof context.getImageData !== 'function' || typeof context.putImageData !== 'function')
        return false;
    context.drawImage(image.source, 0, 0, size.width, size.height);
    if (isIdentityGrade(grade) && !(lut && amount))
        return true;
    let pixels;
    try {
        pixels = context.getImageData(0, 0, size.width, size.height);
    }
    catch {
        context.clearRect?.(0, 0, size.width, size.height);
        return false;
    }
    const band = Math.max(1, Math.floor(262_144 / size.width));
    for (let row = 0; row < size.height; row += band) {
        const rows = [row, Math.min(size.height, row + band)];
        gradePixels(pixels.data, size.width, size.height, grade, { seed, rows });
        if (lut)
            applyLut(pixels.data, size.width, size.height, lut, { amount, rows });
        if (row + band < size.height)
            await new Promise(resolve => setTimeout(resolve, 0));
        throwIfAborted(signal);
    }
    context.putImageData(pixels, 0, 0);
    return true;
}
function drawTitle(context, size, values, canvas, image) {
    const text = String(values.title ?? values.text ?? values.label ?? 'Your next big idea').trim();
    if (!text || text.length > 300)
        throw new Error('Add a title between 1 and 300 characters.');
    const requestedSize = numberValue(values, 'fontSize', 64, 12, 240);
    const color = colorValue(values, 'color', '#ffffff');
    const position = optionValue(values, 'position', 'bottom', TEXT_POSITIONS);
    const ink = optionValue(values, 'ink', 'readable', ['readable', 'image', 'exact']);
    const scrimMode = optionValue(values, 'scrim', 'auto', ['auto', 'off']);
    const padding = Math.max(1, Math.round(Math.min(size.width, size.height) * .055));
    const maxWidth = Math.max(1, size.width - padding * 2);
    const maxHeight = Math.max(1, size.height - padding * 2);
    // Balanced lines at the largest size up to the requested one that fits, with optical tracking and leading.
    const font = fontSize => `700 ${fontSize}px system-ui, -apple-system, sans-serif`;
    const { lines, fontSize, lineHeight, tracking, width: span, height: blockHeight } = fitTitle(text, { measure: canvasMeasure(context, font), width: maxWidth, height: maxHeight, maxSize: Math.min(requestedSize, maxHeight) });
    context.font = font(fontSize);
    if ('letterSpacing' in context)
        context.letterSpacing = `${tracking}px`;
    // `auto` moves the block to the calmest band of the drawn image, starting from the bottom.
    const blockWidth = Math.min(maxWidth, span);
    const place = position === 'auto' ? placeTextBlock(analyzeImageFocus(canvas, size.width, size.height), { canvas: size, block: { width: blockWidth, height: blockHeight }, bounds: { x: padding, y: padding, width: maxWidth, height: maxHeight }, home: { x: .5, y: 1 } }) : null;
    const startY = place ? place.y : position === 'top' ? padding : position === 'center' ? (size.height - blockHeight) / 2 : size.height - padding - blockHeight;
    context.textBaseline = 'top';
    context.textAlign = 'center';
    context.lineJoin = 'round';
    context.lineWidth = Math.max(1, fontSize * .055);
    let fill = color, halo = 'rgba(0, 0, 0, .7)', scrim = null;
    if (ink !== 'exact') {
        // Sample what the title covers; at least 3:1 (WCAG AA for large text) over each colour covering 5% of it,
        // keeping the chosen colour behind a scrim rather than greying it out.
        const surfaces = analyzeImageColors(canvas, size.width, size.height, { region: { x: (size.width - blockWidth) / 2, y: startY, width: blockWidth, height: blockHeight }, count: 4 })?.filter(surface => surface.weight >= .05);
        const accent = ink === 'image' ? pickAccentColor(analyzeImageColors(image.source, image.width, image.height) ?? []) : null;
        if (surfaces?.length) {
            const chosen = chooseTitleInk(surfaces, { prefer: [accent, color], minContrast: 3, scrim: scrimMode === 'auto' });
            fill = chosen.ink; scrim = chosen.scrim;
            // The outline is a halo on the far side of what the title sits on: light behind a darker title.
            if (toOklab(fill)[0] < toOklab(chosen.surfaces[0])[0]) halo = 'rgba(255, 255, 255, .7)';
        }
    }
    if (scrim) {
        const pad = lineHeight * .35, [r, g, b] = [1, 3, 5].map(index => parseInt(scrim.color.slice(index, index + 2), 16));
        context.save?.();
        context.fillStyle = context.shadowColor = `rgba(${r}, ${g}, ${b}, ${scrim.opacity})`;
        // Only the blurred shadow of a panel drawn off the canvas lands on it, so the scrim has no hard edge.
        context.shadowBlur = pad * 2;
        context.shadowOffsetX = size.width * 2;
        context.beginPath?.();
        context.roundRect?.((size.width - blockWidth) / 2 - pad - size.width * 2, startY - pad * .6, blockWidth + pad * 2, blockHeight + pad * 1.2, pad);
        context.fill?.();
        context.restore?.();
        context.shadowBlur = 0;
        context.shadowOffsetX = 0;
    }
    context.strokeStyle = halo;
    context.fillStyle = fill;
    lines.forEach((line, index) => {
        const y = startY + index * lineHeight;
        context.strokeText(line, size.width / 2, y, maxWidth);
        context.fillText(line, size.width / 2, y, maxWidth);
    });
    if ('letterSpacing' in context)
        context.letterSpacing = '0px';
    return { ink: fill, lines, placement: { position: place?.position ?? position, x: Math.round((size.width - blockWidth) / 2), y: Math.round(startY), moved: place?.moved ?? false }, scrim };
}
// The last parsed .cube text, so a live preview does not re-parse the same file on every edit.
let cubeCache = { text: null, lut: null };
/** The engine-only look for image-filter: a creator's `.cube` (text or parsed) wins over a built-in `film`. */
function lookValue(values) {
    const lut = values?.lut;
    if (lut != null && lut !== '') {
        if (typeof lut !== 'string')
            return lut;
        if (cubeCache.text !== lut)
            cubeCache = { text: lut, lut: parseCubeLut(lut) };
        return cubeCache.lut;
    }
    const film = optionValue(values, 'film', 'none', ['none', 'golden', 'teal-amber', 'matte']);
    return film === 'none' ? null : filmLut(film);
}
/** Run a reviewed, first-party local operation. This never executes plugin code. */
export async function runLocalTool(operation, files, values, signal) {
    checkOperation(operation);
    throwIfAborted(signal);
    if (!Array.isArray(files) || !files.length || files.length > LOCAL_IMAGE_LIMITS.files)
        throw new Error('Choose between 1 and 8 images.');
    if (operation !== 'image-grid' && files.length !== 1)
        throw new Error('This tool uses one image at a time.');
    for (const file of files) {
        if (typeof File === 'undefined' || !(file instanceof File))
            throw new Error('Choose images from your device. Remote URLs are not supported.');
        const message = validateLocalImageFile(file);
        if (message)
            throw new Error(message);
        await checkSignature(file, signal);
    }
    const images = [];
    let canvas, ink, lines, placement, scrim, colorEngine, lut;
    try {
        for (const file of files) {
            const image = await loadLocalImage(file, signal);
            images.push(image);
            sourceSizes(images);
        }
        const size = getToolOutputSize(operation, images, values);
        throwIfAborted(signal);
        canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        const context = canvas.getContext('2d');
        if (!context)
            throw new Error('This browser cannot create images. Try another browser.');
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        if (operation === 'image-filter') {
            const preset = optionValue(values, 'preset', 'warm', ['original', 'noir', 'warm', 'cool', 'punchy']);
            const intensity = numberValue(values, 'intensity', 100, 0, 100, false);
            const engine = optionValue(values, 'colorEngine', 'pixel', ['pixel', 'css']);
            const seed = numberValue(values, 'seed', 0, 0, 0xffffffff);
            const look = lookValue(values);
            colorEngine = engine === 'pixel' && await gradeCanvas(context, images[0], size, resolveGrade(preset, intensity / 100), seed, signal, look, intensity / 100) ? 'pixel' : 'css';
            if (look && colorEngine === 'css')
                throw new Error('Film looks and .cube files need the pixel color engine, and this browser cannot read image pixels.');
            if (look && intensity)
                lut = look.title || 'Custom LUT';
            if (colorEngine === 'css') {
                context.filter = filterValue(preset, intensity);
                context.drawImage(images[0].source, 0, 0, size.width, size.height);
                context.filter = 'none';
            }
        }
        else if (operation === 'image-resize') {
            context.fillStyle = colorValue(values, 'background', '#101312');
            context.fillRect(0, 0, size.width, size.height);
            drawFit(context, images[0], 0, 0, size.width, size.height, optionValue(values, 'fit', 'cover', ['cover', 'contain']), optionValue(values, 'crop', 'smart', ['smart', 'center']));
        }
        else if (operation === 'image-grid') {
            const layout = gridLayout(images, values);
            const crop = optionValue(values, 'crop', 'smart', ['smart', 'center']);
            context.fillStyle = colorValue(values, 'background', '#101312');
            context.fillRect(0, 0, size.width, size.height);
            images.forEach((image, index) => drawFit(context, image, (index % layout.columns) * (layout.cellWidth + layout.gap), Math.floor(index / layout.columns) * (layout.cellHeight + layout.gap), layout.cellWidth, layout.cellHeight, 'cover', crop));
        }
        else {
            context.drawImage(images[0].source, 0, 0, size.width, size.height);
            ({ ink, lines, placement, scrim } = drawTitle(context, size, values, canvas, images[0]));
        }
        throwIfAborted(signal);
        const blob = await abortable(new Promise((resolve, reject) => {
            canvas.toBlob(value => value ? resolve(value) : reject(new Error('The image could not be exported. Try smaller dimensions.')), 'image/png');
        }), signal);
        throwIfAborted(signal);
        if (blob.size > LOCAL_IMAGE_LIMITS.bytes)
            throw new Error('The result exceeds 20 MB. Choose smaller dimensions.');
        const base = files[0].name.replace(/\.[^.]*$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'optimai';
        return { ...size, blob, filename: `${base}-${operation}.png`, ...(ink ? { ink, lines, placement, scrim } : {}), ...(colorEngine ? { colorEngine } : {}), ...(lut ? { lut } : {}) };
    }
    finally {
        images.forEach(image => image.release());
        // Release the backing pixel buffer, including when encoding is cancelled.
        if (canvas) {
            canvas.width = 0;
            canvas.height = 0;
        }
    }
}
