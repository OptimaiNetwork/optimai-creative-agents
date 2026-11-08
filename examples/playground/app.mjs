// Agent Playground: every form is built from the catalog's form schema; every run goes through a real SDK engine.
import { getAgentFormSchema, listFormFields } from '../../src/form-schema.mjs';
import { colorInputValue, decodePlaygroundState, encodePlaygroundState, formDefaults, listPlaygroundAgents, playgroundRunPlan, readFormValue, rerollSeed } from '../../src/playground.mjs';
import { runCanvasLab } from '../../src/canvas-lab.mjs';
import { runLocalTool, validateLocalImageFile } from '../../src/browser-runtime.mjs';
import { downloadVisionModel, getVisionModelStatus, runBrowserVision } from '../../src/vision-runtime.mjs';
import { describeProgress, normalizeProgress } from '../../src/progress.mjs';
import { compareImages, describeComparison, splitView } from '../../src/compare.mjs';
import { createPreviewPlayer, renderAgentPreview } from '../../src/card-preview.mjs';
import { assessAgentCapabilities, detectCreativeCapabilities } from '../../src/capabilities.mjs';
import { describeAgentOutput } from '../../src/accessibility.mjs';
import { formatBytes } from '../../src/model-setup.mjs';

// The pinned MediaPipe assets the interactive example copies (see its README); vision runs need them.
const VISION_WASM = new URL('../interactive/vendor/mediapipe/1.1.0', import.meta.url).pathname;
const $ = id => document.getElementById(id);
const agents = listPlaygroundAgents();
const report = detectCreativeCapabilities();
const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
const KIND = { 'canvas-lab': 'Canvas · composition', 'local-tool': 'Canvas · image tool', vision: 'Vision · on-device model' };
let agent, fields = [], values = {}, files = [], controller, result, resultUrl, previous, previousUrl, hero;

function say(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }

// The agent list, with each agent's SDK card preview as its thumbnail.
function renderList() {
  const query = $('search').value.trim().toLowerCase();
  $('agents').replaceChildren(...agents.filter(item => `${item.title} ${item.description} ${item.category}`.toLowerCase().includes(query)).map(item => {
    const li = document.createElement('li'), button = document.createElement('button'), canvas = document.createElement('canvas');
    button.type = 'button'; button.dataset.agent = item.id; button.setAttribute('aria-current', String(item.id === agent?.id));
    canvas.width = 96; canvas.height = 54; canvas.setAttribute('aria-hidden', 'true');
    renderAgentPreview(item.id, canvas.getContext('2d'), 0, { width: 96, height: 54 });
    const label = document.createElement('span'), title = document.createElement('strong'), kind = document.createElement('small');
    title.textContent = item.title; kind.textContent = KIND[item.runner]; label.append(title, kind);
    button.append(canvas, label); button.addEventListener('click', () => select(item.id)); li.append(button); return li;
  }));
}

// One control per schema field: the schema says which control, its bounds, step and hint.
function control(field) {
  const { schema } = field, id = `field-${field.id}`, set = value => { values[field.id] = value; syncHash(); };
  const input = document.createElement(field.control === 'select' ? 'select' : field.control === 'textarea' ? 'textarea' : 'input');
  input.id = id; input.name = field.id;
  if (field.control === 'select') input.append(...schema.enum.map(option => new Option(option, option)));
  if (['text', 'textarea', 'color'].includes(field.control) && schema.maxLength) input.maxLength = field.control === 'color' ? 7 : schema.maxLength;
  if (field.control === 'textarea') input.rows = 3;
  if (['slider', 'stepper', 'number', 'seed'].includes(field.control)) Object.assign(input, { type: field.control === 'slider' ? 'range' : 'number', min: schema.minimum, max: schema.maximum, step: field.step ?? 1 });
  input.value = String(values[field.id]);
  const wrap = document.createElement('span'); wrap.className = 'control'; wrap.append(input);
  if (field.control === 'slider') {
    const out = document.createElement('output'); out.htmlFor = id; out.textContent = input.value; wrap.append(out);
    input.addEventListener('input', () => { out.textContent = input.value; set(readFormValue(field, input.value)); });
  } else if (field.control === 'color') {
    const picker = Object.assign(document.createElement('input'), { type: 'color', value: colorInputValue(input.value) });
    picker.setAttribute('aria-label', `${field.title} picker`);
    picker.addEventListener('input', () => { input.value = picker.value; set(picker.value); });
    input.addEventListener('input', () => { set(readFormValue(field, input.value, { partial: true })); picker.value = colorInputValue(input.value, picker.value); });
    input.addEventListener('change', () => { input.value = String(readFormValue(field, input.value)); set(input.value); });
    wrap.prepend(picker);
  } else if (input.type === 'number') {
    // Typing stays free; leaving the field snaps to a value the recipe accepts.
    input.addEventListener('change', () => { const value = readFormValue(field, input.value); input.value = String(value); set(value); });
    if (field.control === 'seed') {
      const reroll = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Reroll' });
      reroll.addEventListener('click', () => { const value = rerollSeed(field, Number(input.value)); input.value = String(value); set(value); });
      wrap.append(reroll);
    }
  } else input.addEventListener(field.control === 'select' ? 'change' : 'input', () => set(readFormValue(field, input.value)));
  const label = document.createElement('label'); label.className = 'field'; label.htmlFor = id;
  const name = document.createElement('span'); name.textContent = field.title; label.append(name, wrap);
  if (field.schema.description) { const hint = document.createElement('small'); hint.className = 'hint'; hint.textContent = field.schema.description; label.append(hint); }
  return label;
}
function renderForm() {
  const groups = getAgentFormSchema(agent.id)['x-ui'].groups;
  $('fields').replaceChildren(...groups.map(group => {
    const set = document.createElement('fieldset'); set.className = 'group';
    if (groups.length > 1) { const legend = document.createElement('legend'); legend.textContent = group.title; set.append(legend); }
    set.append(...fields.filter(field => field.group === group.id).map(control)); return set;
  }));
}

function syncHash() { try { history.replaceState(null, '', `#${encodePlaygroundState({ agent: agent.id, values })}`); } catch { /* A value mid-edit can't be shared yet. */ } }
function select(id, shared) {
  if (controller) return;
  agent = agents.find(item => item.id === id) ?? agents[0];
  fields = listFormFields(getAgentFormSchema(agent.id));
  values = shared?.agent === agent.id ? shared.values : formDefaults(getAgentFormSchema(agent.id));
  $('agent-title').textContent = agent.title; $('agent-description').textContent = agent.description; $('agent-kind').textContent = `${KIND[agent.runner]} · ${agent.category}`;
  const capability = assessAgentCapabilities(agent.id, report);
  $('agent-capability').hidden = !capability?.message; $('agent-capability').textContent = capability?.message ?? '';
  const { min, max, accept } = agent.inputs;
  $('files').accept = accept; $('files').multiple = max > 1; $('files').value = '';
  $('input-rule').textContent = min === 0 ? `(optional, up to ${max})` : min === max ? `(${min} required)` : `(${min}–${max})`;
  setFiles([]);
  hero?.dispose?.(); hero = createPreviewPlayer($('hero'), agent.id, { motion: reducedMotion }); hero.play();
  renderForm(); renderList(); syncHash(); void renderSetup();
  if (shared?.dropped?.length) say(`This link had settings that couldn't be used here: ${shared.dropped.join(', ')}. Defaults are shown instead.`, true);
  else say(min ? 'Choose images, or use the samples, then run the agent.' : 'Run the agent, or add an image first.');
}

// Vision agents download a pinned, verified model first; nothing downloads without a click.
async function renderSetup() {
  $('setup').hidden = !agent.setup;
  if (!agent.setup) return;
  const { ready } = await getVisionModelStatus(agent.operation).catch(() => ({ ready: false }));
  $('setup-detail').textContent = ready ? `${agent.setup.name} is ready on this device.` : `${agent.setup.name} · ${formatBytes(agent.setup.bytes)} from the official model host, checked against its pinned SHA-256.`;
  $('download').hidden = ready;
}
$('download').addEventListener('click', async () => {
  if (controller) return;
  controller = new AbortController(); busy(true);
  try { await downloadVisionModel(agent.operation, { signal: controller.signal, onProgress: progress }); say('Model ready. Run the agent.'); }
  catch (error) { say(error?.name === 'AbortError' ? 'Download stopped.' : error?.message ?? 'The model could not download.', error?.name !== 'AbortError'); }
  finally { controller = undefined; busy(false); void renderSetup(); }
});

function setFiles(next) {
  for (const file of next) { const error = validateLocalImageFile(file); if (error) { say(error, true); return; } }
  if (next.length > agent.inputs.max) { say(`${agent.title} takes up to ${agent.inputs.max} image${agent.inputs.max > 1 ? 's' : ''}.`, true); return; }
  files = next;
  $('input-names').textContent = files.length ? files.map(file => `${file.name} · ${formatBytes(file.size)}`).join(' · ') : 'Selected images stay on this device.';
  $('clear').hidden = !files.length;
}
$('files').addEventListener('change', () => setFiles([...$('files').files]));
$('clear').addEventListener('click', () => { $('files').value = ''; setFiles([]); });
// Samples are made by the SDK itself (Poster Lab), so the playground needs no bundled media.
const SAMPLES = [['SAMPLE\nONE', '#ff9b71', 'cinema'], ['SAMPLE\nTWO', '#1d4ed8', 'minimal'], ['THREE', '#c6f87d', 'editorial'], ['FOUR', '#f0abfc', 'minimal']];
$('sample').addEventListener('click', async () => {
  if (controller) return;
  say('Making sample images on this device…');
  const made = [];
  for (const [title, color, treatment] of SAMPLES.slice(0, Math.max(1, Math.min(agent.inputs.max, agent.inputs.min || 1)))) {
    const { blob } = await runCanvasLab('poster', [], { title, color, ratio: '4:5', treatment });
    made.push(new File([blob], `sample-${made.length + 1}.png`, { type: 'image/png' }));
  }
  setFiles(made); say('Samples ready. Run the agent.');
});

function progress(event) {
  const normalized = normalizeProgress(event);
  say(describeProgress(normalized));
  $('progress').hidden = normalized.progress == null;
  if (normalized.progress != null) $('progress').value = normalized.progress;
}
function busy(on) {
  for (const element of $('form').querySelectorAll('input, select, textarea, button')) element.disabled = on;
  $('stop').hidden = !on; $('stop').disabled = false;
  if (!on) $('progress').hidden = true;
}
$('stop').addEventListener('click', () => controller?.abort());
$('reset').addEventListener('click', () => { values = formDefaults(getAgentFormSchema(agent.id)); renderForm(); syncHash(); say('Settings reset to the agent’s defaults.'); });
$('share').addEventListener('click', async () => {
  let url;
  try { url = `${location.href.split('#')[0]}#${encodePlaygroundState({ agent: agent.id, values })}`; } catch (error) { say(error.message, true); return; }
  try { await navigator.clipboard.writeText(url); say('Share link copied. It holds the agent and the settings you changed, never your images.'); }
  catch { say('Copy the address bar to share these settings.'); }
});

async function run(plan, signal) {
  if (plan.runner === 'canvas-lab') return runCanvasLab(plan.operation, files, plan.settings, { signal, onProgress: progress });
  if (plan.runner === 'local-tool') { progress({ stage: 'render' }); return runLocalTool(plan.operation, files, plan.settings, signal); }
  return runBrowserVision(plan.operation, files[0], plan.settings, { signal, onProgress: progress, wasmBaseUrl: VISION_WASM, workerFactory: () => new Worker(new URL('./vision-worker.mjs', import.meta.url), { type: 'module' }) });
}
$('form').addEventListener('submit', async event => {
  event.preventDefault();
  if (controller) return;
  if (files.length < agent.inputs.min) { say(`${agent.title} needs ${agent.inputs.min} image${agent.inputs.min > 1 ? 's' : ''}. Choose your own or use the samples.`, true); return; }
  let plan;
  try { plan = playgroundRunPlan(agent.id, values); } catch (error) { say(error.message, true); return; }
  controller = new AbortController(); busy(true);
  const started = performance.now();
  try {
    const next = await run(plan, controller.signal);
    // The previous result stays until the next one is ready, so it can be compared.
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    previous = result; previousUrl = resultUrl; result = next; resultUrl = URL.createObjectURL(next.blob);
    $('output').src = resultUrl;
    $('output').alt = describeAgentOutput(agent.id, values, { width: next.width, height: next.height, lines: next.lines });
    $('output-detail').textContent = `${agent.title} · ${next.width} × ${next.height} · ${formatBytes(next.blob.size)}`;
    $('figure').hidden = false; $('empty').hidden = true;
    Object.assign($('save'), { href: resultUrl, download: next.filename, hidden: false });
    say(`Done on this device in ${((performance.now() - started) / 1000).toFixed(2)} s.`);
    await offerCompare(controller.signal).catch(() => hideCompare());
  } catch (error) {
    say(error?.name === 'AbortError' ? 'Stopped. Your last result is still here.' : error?.message ?? 'This run failed. Try other images or settings.', error?.name !== 'AbortError');
  } finally { controller = undefined; busy(false); }
});

function hideCompare() { $('compare').hidden = true; $('before').hidden = true; $('divider').hidden = true; }
function showSplit() { const view = splitView(Number($('split').value) / 100); $('before').style.clipPath = view.clipPath; $('divider').style.left = `${view.position * 100}%`; }
async function offerCompare(signal) {
  hideCompare();
  if (!previous || previous.width !== result.width || previous.height !== result.height) return;
  $('compare-detail').textContent = describeComparison(await compareImages(previous.blob, result.blob, { signal }));
  $('before').src = previousUrl; $('before').alt = 'The previous run';
  $('before').hidden = false; $('divider').hidden = false; $('compare').hidden = false; showSplit();
}
$('split').addEventListener('input', showSplit);
$('search').addEventListener('input', renderList);
window.addEventListener('pagehide', () => { controller?.abort(); hero?.dispose?.(); for (const url of [resultUrl, previousUrl]) if (url) URL.revokeObjectURL(url); });

const shared = decodePlaygroundState(location.hash);
select(shared?.agent ?? 'poster-lab', shared);
