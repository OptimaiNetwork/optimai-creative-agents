import { runLocalTool, validateLocalImageFile } from '../../src/browser-runtime.mjs';
import { runCanvasLab } from '../../src/canvas-lab.mjs';

const element = id => document.getElementById(id);
const form = element('workspace-form');
const operation = element('operation');
const imageInput = element('image-input');
const preview = element('preview');
const download = element('download');
const useResult = element('use-result');
const status = element('status');
const buttons = {
  poster: ['Create poster', 'Start with typography, or add your own background image.'],
  mockup: ['Create mockup', 'Choose an image to compose inside a device or gallery frame.'],
  resize: ['Resize image', 'Choose an image and set the canvas width and ratio.'],
  filter: ['Finish image', 'Choose an image and preview a color treatment.'],
};
let inputFile;
let output;
let outputUrl;
let controller;

function announce(message, error = false) {
  status.textContent = message;
  status.classList.toggle('error', error);
}

function updateSettings() {
  const mode = operation.value;
  element('poster-settings').hidden = mode !== 'poster';
  element('composition-settings').hidden = mode !== 'mockup';
  element('resize-settings').hidden = mode !== 'resize';
  element('filter-settings').hidden = mode !== 'filter';
  element('ratio-settings').hidden = mode === 'filter';
  element('image-requirement').textContent = mode === 'poster' ? 'optional' : 'required';
  // Hidden settings must not participate in native form validation.
  for (const settings of form.querySelectorAll('.settings')) {
    for (const field of settings.querySelectorAll('input, select, textarea')) field.disabled = settings.hidden;
  }
  const [label, hint] = buttons[mode];
  element('run').textContent = `${label} ↗`;
  element('operation-hint').textContent = hint;
}

function setInput(file) {
  const error = validateLocalImageFile(file);
  if (error) { announce(`${error}${inputFile ? ' Your previous source remains selected.' : ''}`, true); return false; }
  inputFile = file;
  element('input-name').textContent = `${file.name} · ${(file.size / 1024).toFixed(0)} KiB · processed locally`;
  element('clear-input').hidden = false;
  announce('Image selected. Adjust the settings and run your agent.');
  return true;
}

function setBusy(busy) {
  for (const field of form.querySelectorAll('input, select, textarea, button')) field.disabled = busy;
  element('cancel').hidden = !busy;
  element('cancel').disabled = false;
  useResult.disabled = busy;
  element('preview-stage').setAttribute('aria-busy', String(busy));
  if (!busy) updateSettings();
}

operation.addEventListener('change', updateSettings);
imageInput.addEventListener('change', () => {
  const file = imageInput.files?.[0];
  if (file && !setInput(file)) imageInput.value = '';
});
element('clear-input').addEventListener('click', () => {
  inputFile = undefined;
  imageInput.value = '';
  element('clear-input').hidden = true;
  element('input-name').textContent = 'PNG, JPEG or WebP · up to 20 MiB / 4096 px per side';
  announce('Source cleared. Your last result is still available.');
});
element('intensity').addEventListener('input', event => {
  element('intensity-value').textContent = `${event.target.value}%`;
});
element('cancel').addEventListener('click', () => controller?.abort());
useResult.addEventListener('click', () => {
  if (!output) return;
  const file = new File([output.blob], output.filename, { type: 'image/png' });
  if (!setInput(file)) return;
  // Reflect the reused file in the native picker when supported. The named
  // source remains usable in browsers that do not allow assigning FileLists.
  imageInput.value = '';
  try {
    const selection = new DataTransfer();
    selection.items.add(file);
    imageInput.files = selection.files;
  } catch { /* The selected source is held locally in inputFile. */ }
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (controller) return;
  const mode = operation.value;
  if (mode !== 'poster' && !inputFile) {
    announce('Choose a source image, or create a poster and use it as input.', true);
    imageInput.focus();
    return;
  }
  controller = new AbortController();
  setBusy(true);
  announce('Processing in your browser…');
  const started = performance.now();
  try {
    const files = inputFile ? [inputFile] : [];
    const signal = controller.signal;
    const result = mode === 'poster' || mode === 'mockup'
      ? await runCanvasLab(mode, files, {
        title: mode === 'poster' ? element('title').value : undefined, color: element('color').value,
        treatment: element('treatment').value, ratio: element('ratio').value,
        layout: element('layout').value,
      }, signal)
      : await runLocalTool(mode === 'resize' ? 'image-resize' : 'image-filter', files,
        mode === 'resize'
          ? { width: Number(element('width').value), ratio: element('ratio').value, fit: element('fit').value, background: '#101312' }
          : { preset: element('preset').value, intensity: Number(element('intensity').value) }, signal);
    // Keep the previous result until the next export succeeds.
    const nextUrl = URL.createObjectURL(result.blob);
    const previousUrl = outputUrl;
    output = result;
    outputUrl = nextUrl;
    preview.src = nextUrl;
    preview.alt = `${buttons[mode][0]} result, ${result.width} by ${result.height} pixels`;
    preview.hidden = false;
    element('empty-preview').hidden = true;
    download.href = nextUrl;
    download.download = result.filename;
    download.hidden = false;
    useResult.hidden = false;
    element('output-detail').textContent = `${result.width} × ${result.height} · PNG · ${(result.blob.size / 1024).toFixed(0)} KiB`;
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    announce(`Ready to export. Completed locally in ${((performance.now() - started) / 1000).toFixed(2)} seconds.`);
  } catch (error) {
    announce(error?.name === 'AbortError' ? 'Stopped. Your previous result is still available.' : error?.message || 'Could not process this image. Try another source.', error?.name !== 'AbortError');
  } finally {
    controller = undefined;
    setBusy(false);
  }
});

window.addEventListener('pagehide', () => {
  controller?.abort();
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  // Clear URLs from the document so a restored page cannot export a revoked blob.
  outputUrl = undefined;
  output = undefined;
  preview.removeAttribute('src');
  preview.hidden = true;
  element('empty-preview').hidden = false;
  download.removeAttribute('href');
  download.hidden = true;
  useResult.hidden = true;
  element('output-detail').textContent = 'Your exported PNG will appear here.';
});
updateSettings();
