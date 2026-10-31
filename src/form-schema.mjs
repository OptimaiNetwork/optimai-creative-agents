/** Schema-driven forms: one JSON Schema 2020-12 per template, with UI hints any host, MCP client or doc can render. */
import { AGENT_WORKSPACE_CONTRACT_VERSION, getAgentTemplate, recipeFieldSchema } from './index.mjs';

export const AGENT_FORM_SCHEMA_VERSION = '1.0';
export const FORM_CONTROLS = Object.freeze(['text', 'textarea', 'select', 'color', 'slider', 'stepper', 'number', 'seed']);
/** `engine`: the on-device workspace reads it. `alias`: an older recipe name the engine maps when the canonical setting is missing. `brief`: shapes the prepared brief only. `unused`: neither (only possible for unreviewed templates). */
export const FORM_ROLES = Object.freeze(['engine', 'alias', 'brief', 'unused']);
export const FORM_GROUPS = Object.freeze([['content', 'Content'], ['look', 'Look'], ['color', 'Color'], ['layout', 'Layout'], ['motion', 'Motion']]
  .map(([id, title]) => Object.freeze({ id, title })));
const GROUP_OF = Object.freeze({
  color: 'color', background: 'color', inks: 'color',
  ratio: 'layout', width: 'layout', height: 'layout', fit: 'layout', layout: 'layout', columns: 'layout', gap: 'layout', position: 'layout', format: 'layout', view: 'layout', focalLength: 'layout', fontSize: 'layout', scenes: 'content', branches: 'content',
  camera: 'motion', pace: 'motion', transition: 'motion', mix: 'motion', rhythm: 'motion', length: 'motion', energy: 'motion', structure: 'motion', depth: 'motion',
});
// Which recipe fields each reviewed engine reads, by `kind:operation`. Engines stay the authority and re-check every value.
const LAB = ['ratio'];
const ENGINE_FIELDS = Object.freeze({
  'canvas:image-filter': ['preset', 'intensity'], 'canvas:image-resize': ['ratio', 'width', 'height', 'fit', 'background'],
  'canvas:image-grid': ['columns', 'gap', 'background'], 'canvas:type-overlay': ['title', 'fontSize', 'color', 'position'],
  'canvas:mockup': [...LAB, 'layout'], 'canvas:poster': [...LAB, 'title', 'color', 'treatment'], 'canvas:letter': [...LAB, 'title', 'color', 'treatment'],
  'canvas:bento': LAB, 'canvas:glitch': [...LAB, 'effect', 'amount', 'seed'], 'canvas:blend': [...LAB, 'mix'],
  'canvas:transition': [...LAB, 'transition', 'pace', 'mix'], 'canvas:print': [...LAB, 'look', 'inks', 'color', 'scale', 'amount', 'seed'],
  'vision:person-cutout': ['background', 'threshold', 'softness'],
  '3d:scene': ['demo', 'lighting', 'finish', 'view', 'focalLength', 'exposure', 'color', 'background'],
  'camera:effects': ['effect', 'intensity', 'mirror'], 'camera:avatar': ['look', 'mirror'],
});
// Older recipe names each engine still maps (`canvasLabRecipeSettings`, `scene3DRecipeSettings`).
const LAB_ALIASES = { format: 'ratio', text: 'title', style: 'treatment', intensity: 'amount' };
const ALIASES = Object.freeze(Object.fromEntries([...['mockup', 'poster', 'letter', 'bento', 'glitch', 'blend', 'transition', 'print'].map(op => [`canvas:${op}`, LAB_ALIASES]), ['3d:scene', { material: 'finish' }]]));
const BRIEF_ONLY = new Set(['workflow', 'sketch']);

const template = idOrTemplate => {
  const tool = typeof idOrTemplate === 'string' ? getAgentTemplate(idOrTemplate) : idOrTemplate;
  if (!tool || typeof tool !== 'object' || typeof tool.id !== 'string' || !Array.isArray(tool.fields)) throw new Error('Choose a catalog template or pass a template object with fields.');
  return tool;
};
const control = field => {
  if (field.type === 'select') return 'select';
  if (field.type === 'textarea') return 'textarea';
  if (field.type === 'text') return ['color', 'background'].includes(field.id) ? 'color' : 'text';
  if (field.id === 'seed') return 'seed';
  return field.max - field.min <= 12 ? 'stepper' : field.max - field.min > 1000 ? 'number' : 'slider';
};
function check(field, id) {
  if (!field || typeof field !== 'object' || typeof field.id !== 'string' || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(field.id)) throw new Error(`${id}: every setting needs an alphanumeric id.`);
  if (!['text', 'textarea', 'select', 'number'].includes(field.type)) throw new Error(`${id}: setting ${field.id} has unsupported type ${String(field.type)}.`);
  if (field.type === 'select' && (!Array.isArray(field.options) || !field.options.length || !field.options.every(option => typeof option === 'string'))) throw new Error(`${id}: select ${field.id} needs string options.`);
  if (field.type === 'number' && !(Number.isFinite(field.min) && Number.isFinite(field.max) && field.min <= field.max)) throw new Error(`${id}: number ${field.id} needs finite min <= max.`);
}

/** The role each setting plays for a template's workspace (see `FORM_ROLES`). */
export function getAgentFieldRoles(idOrTemplate) {
  const tool = template(idOrTemplate);
  const { kind, operation } = tool.workspace ?? {}, key = `${kind}:${operation}`;
  const engine = new Set(ENGINE_FIELDS[key] ?? []), aliases = ALIASES[key] ?? {};
  const reviewed = getAgentTemplate(tool.id), ids = new Set(tool.fields.map(field => field?.id));
  return Object.fromEntries(tool.fields.map(({ id }) => [id,
    kind === 'writing' || engine.has(id) ? 'engine'
      : Object.hasOwn(aliases, id) && ids.has(aliases[id]) ? 'alias'
        : BRIEF_ONLY.has(kind) || reviewed?.fields.some(field => field.id === id) ? 'brief' : 'unused']));
}

/**
 * JSON Schema 2020-12 for a template's recipe `values`, with the same bounds `validateRecipeValues` enforces.
 * Each property carries `title`, `default` and `x-ui` hints ({ control, group, order, role, step?, aliasOf? });
 * the top-level `x-ui.groups` lists non-empty groups in display order. Pass an id or a template object.
 */
export function getAgentFormSchema(idOrTemplate) {
  const tool = template(idOrTemplate);
  tool.fields.forEach(field => check(field, tool.id));
  const roles = getAgentFieldRoles(tool), aliases = ALIASES[`${tool.workspace?.kind}:${tool.workspace?.operation}`] ?? {};
  const labels = Object.fromEntries(tool.fields.map(field => [field.id, field.label ?? field.id]));
  // Within a group, aliases follow the settings they stand in for.
  const grouped = FORM_GROUPS.map(({ id, title }) => ({ id, title, fields: tool.fields
    .filter(field => (GROUP_OF[field.id] ?? (['text', 'textarea'].includes(field.type) ? 'content' : 'look')) === id).map(field => field.id)
    .sort((a, b) => (roles[a] === 'alias') - (roles[b] === 'alias')) }))
    .filter(group => group.fields.length);
  const order = grouped.flatMap(group => group.fields);
  const properties = Object.fromEntries(tool.fields.map(field => {
    const ui = { control: control(field), group: grouped.find(group => group.fields.includes(field.id)).id, order: order.indexOf(field.id), role: roles[field.id] };
    if (field.type === 'number') ui.step = Number.isInteger(field.min) && Number.isInteger(field.max) ? 1 : (field.max - field.min) / 100;
    if (ui.role === 'alias') ui.aliasOf = aliases[field.id];
    const description = ui.role === 'alias' ? `Older recipe name; the workspace uses "${labels[ui.aliasOf]}" when it is set.`
      : ui.role === 'brief' && !BRIEF_ONLY.has(tool.workspace?.kind) ? 'Shapes the prepared brief; the on-device engine does not read it.'
        : ui.role === 'unused' ? 'Not read by this workspace or a reviewed brief.' : undefined;
    return [field.id, { title: labels[field.id], ...recipeFieldSchema(field), default: field.default, ...(description ? { description } : {}), 'x-ui': ui }];
  }));
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `https://optimai.studio/schemas/agent-form/${AGENT_FORM_SCHEMA_VERSION}/${tool.id}`,
    title: tool.title ?? tool.id, ...(typeof tool.description === 'string' ? { description: tool.description } : {}),
    type: 'object', additionalProperties: false, properties,
    'x-ui': { version: AGENT_FORM_SCHEMA_VERSION, groups: grouped, order },
    'x-optimai': { templateId: tool.id, workspace: { kind: tool.workspace?.kind, ...(tool.workspace?.operation ? { operation: tool.workspace.operation } : {}) }, contract: AGENT_WORKSPACE_CONTRACT_VERSION },
  };
}

/** The schema's settings in display order, flattened for a form renderer: `{ id, title, control, group, role, schema }`. */
export function listFormFields(schema) {
  if (!schema?.properties || !Array.isArray(schema['x-ui']?.order)) throw new Error('Pass a schema from getAgentFormSchema.');
  return schema['x-ui'].order.map(id => {
    const { 'x-ui': ui, ...rest } = schema.properties[id];
    return { id, title: rest.title, control: ui.control, group: ui.group, role: ui.role, ...(ui.step !== undefined ? { step: ui.step } : {}), ...(ui.aliasOf ? { aliasOf: ui.aliasOf } : {}), schema: rest };
  });
}

/** The schema without `x-ui`/`x-optimai` hints, for strict validators and tool definitions (such as MCP `inputSchema`). */
export function plainFormSchema(schema) {
  const { 'x-ui': _ui, 'x-optimai': _host, properties, ...rest } = schema;
  return { ...rest, properties: Object.fromEntries(Object.entries(properties).map(([id, { 'x-ui': _field, ...property }]) => [id, property])) };
}
