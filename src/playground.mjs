/** Playground helpers: which agents run straight from a form, the values a form holds, how a run is dispatched and shared. DOM-free. */
import { AGENT_CATALOG, getAgentInputPolicy, getAgentTemplate, validateRecipeValues } from './index.mjs';
import { getAgentFormSchema, listFormFields } from './form-schema.mjs';
import { CANVAS_LAB_AGENTS, canvasLabRecipeSettings } from './canvas-lab.mjs';
import { VISION_MODELS, normalizeVisionValues } from './vision-runtime.mjs';

export const PLAYGROUND_RUNNERS = Object.freeze(['canvas-lab', 'local-tool', 'vision']);
/** Share links stay short and are read as untrusted text. */
export const PLAYGROUND_LIMITS = Object.freeze({ stateLength: 4096, seed: 999999 });
const LOCAL_TOOLS = new Set(['image-filter', 'image-resize', 'image-grid', 'type-overlay']);
const HEX = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i;

const template = idOrTemplate => {
  const tool = typeof idOrTemplate === 'string' ? getAgentTemplate(idOrTemplate) : idOrTemplate;
  if (!tool?.id || !getAgentTemplate(tool.id)) throw new Error('Choose a reviewed catalog template.');
  return getAgentTemplate(tool.id);
};
const runnerOf = ({ id, workspace: { kind, operation } = {} }) => kind === 'canvas'
  ? Object.hasOwn(CANVAS_LAB_AGENTS, id) ? 'canvas-lab' : LOCAL_TOOLS.has(operation) ? 'local-tool' : null
  : kind === 'vision' && Object.hasOwn(VISION_MODELS, operation) ? 'vision' : null;

/**
 * Every catalog agent a playground can run from a form alone (canvas and vision), in catalog order:
 * `{ id, title, description, category, kind, operation, runner, inputs: { min, max, accept }, setup }`.
 * `setup` names the pinned model a vision agent downloads first, or is null.
 */
export function listPlaygroundAgents({ runners = PLAYGROUND_RUNNERS } = {}) {
  return AGENT_CATALOG.flatMap(tool => {
    const runner = runnerOf(tool);
    if (!runner || !runners.includes(runner)) return [];
    const policy = getAgentInputPolicy(tool.id), model = runner === 'vision' ? VISION_MODELS[tool.workspace.operation] : null;
    return [Object.freeze({
      id: tool.id, title: tool.title, description: tool.description, category: tool.category,
      kind: tool.workspace.kind, operation: tool.workspace.operation, runner,
      inputs: Object.freeze({ min: policy.minFiles, max: policy.maxFiles, accept: policy.accept }),
      setup: model ? Object.freeze({ model: model.id, name: model.name, bytes: model.bytes }) : null,
    })];
  });
}

/** `{ id: default }` for every setting of a form schema (from `getAgentFormSchema`). */
export function formDefaults(schema) {
  if (!schema?.properties) throw new Error('Pass a schema from getAgentFormSchema.');
  return Object.fromEntries(Object.entries(schema.properties).map(([id, property]) => [id, property.default]));
}

/**
 * Reads a raw control value (an input's string, or a number) into a value the schema accepts:
 * numbers are parsed, rounded and clamped (empty or unreadable falls back to the default), a choice
 * outside the list falls back, text is cut to its length limit and a malformed hex color falls back.
 * Pass `{ partial: true }` while someone is typing to keep an unfinished hex color as it is.
 */
export function readFormValue(field, raw, { partial = false } = {}) {
  const schema = field?.schema;
  if (!schema || typeof field.id !== 'string') throw new Error('Pass a field from listFormFields.');
  if (schema.type === 'integer') {
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
    if (!Number.isFinite(value)) return schema.default;
    return Math.min(schema.maximum ?? Infinity, Math.max(schema.minimum ?? -Infinity, Math.round(value)));
  }
  const text = raw == null ? '' : String(raw);
  if (schema.enum) return schema.enum.includes(text) ? text : schema.default;
  if (schema.pattern) return HEX.test(text.trim()) ? text.trim() : partial && /^#?[0-9a-f]{0,6}$/i.test(text.trim()) ? text.trim() : schema.default;
  return schema.maxLength !== undefined ? text.slice(0, schema.maxLength) : text;
}

/** The `#rrggbb` an `<input type="color">` accepts for a recipe hex (`#abc` expands); anything else gives `fallback`. */
export function colorInputValue(value, fallback = '#000000') {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^#[0-9a-f]{6}$/.test(text) ? text : /^#[0-9a-f]{3}$/.test(text) ? text.replace(/^#(.)(.)(.)$/, '#$1$1$2$2$3$3') : fallback;
}

/** A new seed within the field's bounds that differs from `current` (pass your own `random` for tests). */
export function rerollSeed(field, current, random = Math.random) {
  const min = field?.schema?.minimum ?? 0, max = field?.schema?.maximum ?? PLAYGROUND_LIMITS.seed;
  if (max <= min) return min;
  const next = min + Math.floor(Math.min(0.999999999, Math.max(0, random())) * (max - min + 1));
  return next === current ? (next >= max ? min : next + 1) : next;
}

/**
 * How a playground runs an agent with recipe values: `{ runner, operation, settings, model? }`. Canvas-lab
 * agents get engine settings (v1 aliases mapped), local tools the defaults plus values, vision the engine options
 * and its pinned model. Throws with the validator's messages for values a recipe would refuse.
 */
export function playgroundRunPlan(idOrTemplate, values = {}) {
  const tool = template(idOrTemplate), runner = runnerOf(tool), { operation } = tool.workspace;
  if (!runner) throw new Error(`${tool.title} runs in its own workspace, not from a form.`);
  const errors = validateRecipeValues(tool.id, values);
  if (errors.length) throw new Error(errors.join('\n'));
  if (runner === 'canvas-lab') return { runner, operation, settings: canvasLabRecipeSettings(tool.id, values) };
  if (runner === 'local-tool') return { runner, operation, settings: { ...formDefaults(getAgentFormSchema(tool)), ...values } };
  return { runner, operation, settings: normalizeVisionValues(operation, values), model: VISION_MODELS[operation] };
}

/** A short query string (`agent=poster-lab&title=…`) holding only the settings that differ from the defaults. */
export function encodePlaygroundState({ agent, values = {} } = {}) {
  const tool = template(agent), defaults = formDefaults(getAgentFormSchema(tool)), params = new URLSearchParams({ agent: tool.id });
  const errors = validateRecipeValues(tool.id, values);
  if (errors.length) throw new Error(errors.join('\n'));
  for (const field of tool.fields) if (Object.hasOwn(values, field.id) && values[field.id] !== defaults[field.id]) params.set(field.id, String(values[field.id]));
  const text = params.toString();
  if (text.length > PLAYGROUND_LIMITS.stateLength) throw new Error('These settings are too long to share in a link.');
  return text;
}

/**
 * Reads a share link's query or hash (`#agent=…`) as untrusted text: `{ agent, values, dropped }`, where `values` holds
 * every setting (defaults filled in) and `dropped` names parameters that were unknown or not valid as given.
 * Returns null for an unknown agent, a missing one or an oversized link.
 */
export function decodePlaygroundState(text) {
  if (typeof text !== 'string' || text.length > PLAYGROUND_LIMITS.stateLength) return null;
  const params = new URLSearchParams(text.replace(/^[#?]/, '')), id = params.get('agent');
  const tool = id && getAgentTemplate(id);
  if (!tool) return null;
  const fields = listFormFields(getAgentFormSchema(tool)), values = formDefaults(getAgentFormSchema(tool)), dropped = [];
  for (const [key, raw] of params) {
    if (key === 'agent') continue;
    const field = fields.find(entry => entry.id === key);
    const value = field && readFormValue(field, raw);
    // Accept a value only when it reads back exactly; a clamped number or a fallback is reported, not silently changed.
    if (!field || String(value) !== raw || validateRecipeValues(tool.id, { [key]: value }).length) { dropped.push(key); continue; }
    values[key] = value;
  }
  return { agent: tool.id, values, dropped };
}
