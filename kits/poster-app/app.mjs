// A poster maker in one file: the form comes from the agent's schema, the render from the SDK's canvas engine.
import { getAgentFormSchema, listFormFields } from '@optimai/creative-agents/form-schema';
import { formDefaults, playgroundRunPlan, readFormValue, colorInputValue } from '@optimai/creative-agents/playground';
import { runCanvasLab } from '@optimai/creative-agents/canvas-lab';
import { describeProgress } from '@optimai/creative-agents/progress';
import { describeAgentOutput } from '@optimai/creative-agents/accessibility';

const AGENT = 'poster-lab'; // Try 'letter-studio' or 'glitch-cut': the form rebuilds itself from the schema.
const $ = id => document.getElementById(id);
const schema = getAgentFormSchema(AGENT);
const values = formDefaults(schema);
let controller, url;

// Engine settings only: alias and brief-only fields don't change the picture.
for (const field of listFormFields(schema).filter(field => field.role === 'engine')) {
  const label = Object.assign(document.createElement('label'), { className: 'field' });
  const input = document.createElement(field.control === 'select' ? 'select' : 'input');
  if (field.control === 'select') input.append(...field.schema.enum.map(option => new Option(option, option)));
  if (field.control === 'color') input.type = 'color';
  if (field.control === 'slider') Object.assign(input, { type: 'range', min: field.schema.minimum, max: field.schema.maximum, step: field.step ?? 1 });
  input.value = field.control === 'color' ? colorInputValue(values[field.id]) : String(values[field.id]);
  input.addEventListener('input', () => { values[field.id] = readFormValue(field, input.value); });
  label.append(Object.assign(document.createElement('span'), { textContent: field.title }), input);
  $('fields').append(label);
}

$('form').addEventListener('submit', async event => {
  event.preventDefault();
  if (controller) return;
  const { operation, settings } = playgroundRunPlan(AGENT, values);
  controller = new AbortController(); $('stop').hidden = false;
  try {
    const result = await runCanvasLab(operation, [...$('photo').files], settings, { signal: controller.signal, onProgress: event => { $('status').textContent = describeProgress(event); } });
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(result.blob);
    Object.assign($('output'), { src: url, hidden: false, alt: describeAgentOutput(AGENT, values, { width: result.width, height: result.height, lines: result.lines }) });
    Object.assign($('save'), { href: url, download: result.filename, hidden: false });
    $('status').textContent = `Done · ${result.width} × ${result.height}`;
  } catch (error) {
    $('status').textContent = error?.name === 'AbortError' ? 'Stopped.' : error?.message ?? 'The poster could not be made.';
  } finally { controller = undefined; $('stop').hidden = true; }
});
$('stop').addEventListener('click', () => controller?.abort());
