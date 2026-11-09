// Live camera effects driven by the Camera Stage recipe: schema → recipe values → engine settings → canvas.
import { getAgentFormSchema, listFormFields } from '@optimai/creative-agents/form-schema';
import { cameraRecipeSettings, cameraPermissionMessage, createCameraLease } from '@optimai/creative-agents/camera-runtime';
import { drawCameraEffect, drawCameraSource } from '@optimai/creative-agents/camera-renderer';

const AGENT = 'camera-stage';
const $ = id => document.getElementById(id);
const output = $('output'), ctx = output.getContext('2d'), video = $('video');
const source = Object.assign(document.createElement('canvas'), { width: output.width, height: output.height }), sourceCtx = source.getContext('2d');
const schema = getAgentFormSchema(AGENT), lease = createCameraLease(), reduced = matchMedia('(prefers-reduced-motion: reduce)');
const values = Object.fromEntries(Object.entries(schema.properties).map(([id, property]) => [id, property.default]));
let photo = null;

// Only the settings the camera engine reads. 'halo' needs face tracking (see the SDK's interactive example), so it's left out here.
for (const field of listFormFields(schema).filter(field => field.role === 'engine')) {
  const input = document.createElement(field.control === 'select' ? 'select' : 'input');
  if (field.control === 'select') input.append(...field.schema.enum.filter(option => option !== 'halo').map(option => new Option(option, option)));
  else Object.assign(input, { type: 'range', min: field.schema.minimum, max: field.schema.maximum, step: field.step ?? 1 });
  input.value = String(values[field.id]);
  input.addEventListener('input', () => { values[field.id] = input.type === 'range' ? Number(input.value) : input.value; });
  const label = document.createElement('label');
  label.append(field.title, input); $('controls').append(label);
}

function paint(now) {
  const settings = cameraRecipeSettings(AGENT, values), live = lease.active && video.readyState >= 2;
  if (live) drawCameraSource(sourceCtx, video, video.videoWidth, video.videoHeight, source.width, source.height, false);
  else if (photo) drawCameraSource(sourceCtx, photo, photo.width, photo.height, source.width, source.height, false);
  if (live || photo) drawCameraEffect(ctx, source, settings.effect, settings.strength, live && settings.mirror, reduced.matches ? 0 : now / 1000);
  requestAnimationFrame(paint);
}
requestAnimationFrame(paint);

$('start').addEventListener('click', async () => {
  try {
    const stream = await lease.start(() => navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }));
    if (!stream) return;
    video.srcObject = stream; await video.play(); photo = null;
    $('status').textContent = 'Camera on. Hide this tab or close it to turn the camera off.';
  } catch (error) { $('status').textContent = cameraPermissionMessage(error); }
});
$('photo').addEventListener('change', async () => {
  const file = $('photo').files[0];
  if (!file) return;
  lease.stop(); video.srcObject = null;
  try { photo = await createImageBitmap(file); $('status').textContent = `${file.name} · try the effects`; }
  catch { $('status').textContent = 'That image could not be opened. Try a PNG, JPEG or WebP.'; }
});
$('snapshot').addEventListener('click', () => output.toBlob(blob => {
  if (!blob) return;
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'snapshot.png' });
  link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}, 'image/png'));
document.addEventListener('visibilitychange', () => { if (document.hidden && lease.active) { lease.stop(); video.srcObject = null; $('status').textContent = 'Camera turned off while the tab was hidden. Start it again when you are back.'; } });
window.addEventListener('pagehide', () => lease.close());
