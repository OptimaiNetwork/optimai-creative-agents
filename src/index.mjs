import { catalog } from './catalog.mjs';

export const MANIFEST_VERSION = '1.0';
export const MAX_PROMPT_LENGTH = 12000;
const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const categories = ['image', 'video', 'writing', 'experimental'];
const capabilities = Object.freeze({ network: 'none', execution: 'declarative', dataAccess: 'selected-inputs' });
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export const TOOL_CATALOG = freeze(catalog);
export const AGENT_CATALOG = TOOL_CATALOG;
const byId = new Map(TOOL_CATALOG.map((tool) => [tool.id, tool]));
export function getToolTemplate(id) { return typeof id === 'string' ? byId.get(id) : undefined; }
export const getAgentTemplate = getToolTemplate;
export function getAgentExecutionKind(id) { return getAgentTemplate(id)?.executionKind; }

// This module never executes recipes. A plain-data contract rejects accessors and
// prototype-shaped keys before reading them, including in direct JS callers.
function inspectData(value, path, errors, state = { count: 0 }, depth = 0) {
  state.count += 1;
  if (state.count > 256 || depth > 5) { errors.push(`${path}: data exceeds the recipe size or nesting limit.`); return; }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) errors.push(`${path}: numbers must be finite.`); return; }
  if (typeof value !== 'object' || Array.isArray(value)) { errors.push(`${path}: only plain JSON objects and scalar values are accepted.`); return; }
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) { errors.push(`${path}: objects must not have a custom prototype.`); return; }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || DANGEROUS_KEYS.has(key)) { errors.push(`${path}: unsafe object key is not allowed.`); continue; }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) { errors.push(`${path}.${key}: accessors and hidden properties are not accepted.`); continue; }
    inspectData(descriptor.value, `${path}.${key}`, errors, state, depth + 1);
  }
}
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value, keys, path, errors) {
  if (!plain(value)) { errors.push(`${path}: expected an object.`); return false; }
  for (const key of Object.keys(value)) if (!keys.includes(key)) errors.push(`${path}.${key}: unsupported property. Remove it; executable code and remote sources are not accepted.`);
  for (const key of keys) if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: required property is missing.`);
  return true;
}
function boundedString(value, path, max, errors, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && value.trim().length === 0) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) errors.push(`${path}: use ${allowEmpty ? 'up to' : '1 to'} ${max} characters without control characters.`);
}
export function validateRecipeValues(toolId, values) {
  const errors = [];
  inspectData(values, 'values', errors);
  if (errors.length) return errors.slice(0, 20);
  const tool = getToolTemplate(toolId);
  if (!tool) return ['recipe.templateId: choose a reviewed template from the catalog.'];
  if (!plain(values)) return ['recipe.values: expected an object.'];
  for (const [key, value] of Object.entries(values)) {
    const field = tool.fields.find((entry) => entry.id === key);
    if (!field) { errors.push(`recipe.values.${key}: this template has no such setting.`); continue; }
    if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < field.min || value > field.max || !Number.isInteger(value)) errors.push(`recipe.values.${key}: use a whole number from ${field.min} to ${field.max}.`);
    } else {
      boundedString(value, `recipe.values.${key}`, key === 'title' || key === 'text' ? 300 : 2000, errors, true);
      if (field.type === 'select' && !field.options.includes(value)) errors.push(`recipe.values.${key}: choose ${field.options.join(', ')}.`);
      if (['background', 'color'].includes(key) && (typeof value !== 'string' || !/^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(value))) errors.push(`recipe.values.${key}: use a hex color such as #101312.`);
    }
  }
  return errors.slice(0, 20);
}
export function validateToolManifest(value) {
  const errors = [];
  inspectData(value, 'manifest', errors);
  if (errors.length) return { success: false, errors: errors.slice(0, 20) };
  if (!exactKeys(value, ['schemaVersion', 'id', 'version', 'title', 'description', 'category', 'license', 'capabilities', 'recipe'], 'manifest', errors)) return { success: false, errors };
  if (value.schemaVersion !== MANIFEST_VERSION) errors.push('manifest.schemaVersion: supported version is 1.0.');
  if (typeof value.id !== 'string' || value.id.length > 64 || !ID.test(value.id)) errors.push('manifest.id: use a lowercase slug of at most 64 characters, starting with a letter.');
  if (typeof value.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.version) || value.version.length > 24) errors.push('manifest.version: use a semantic version such as 1.0.0.');
  boundedString(value.title, 'manifest.title', 80, errors);
  boundedString(value.description, 'manifest.description', 600, errors);
  if (!categories.includes(value.category)) errors.push('manifest.category: choose image, video, writing or experimental.');
  if (value.license !== 'MIT') errors.push('manifest.license: this starter currently accepts MIT recipes only. The license does not apply to selected user media.');
  if (exactKeys(value.capabilities, Object.keys(capabilities), 'manifest.capabilities', errors)) {
    for (const [key, required] of Object.entries(capabilities)) if (value.capabilities[key] !== required) errors.push(`manifest.capabilities.${key}: must be ${required}; additional privileges are not supported.`);
  }
  if (exactKeys(value.recipe, ['templateId', 'values', 'brief'], 'manifest.recipe', errors)) {
    const tool = getToolTemplate(value.recipe.templateId);
    if (!tool) errors.push('manifest.recipe.templateId: choose a reviewed template from the catalog.');
    else if (tool.category !== value.category) errors.push(`manifest.category: ${tool.id} requires ${tool.category}.`);
    errors.push(...validateRecipeValues(value.recipe.templateId, value.recipe.values));
    boundedString(value.recipe.brief, 'manifest.recipe.brief', 4000, errors, true);
  }
  if (errors.length) return { success: false, errors: errors.slice(0, 20) };
  // Return owned plain data so callers cannot mutate the source during execution.
  return { success: true, manifest: JSON.parse(JSON.stringify(value)), errors: [] };
}
export function createToolManifest(templateId, details) {
  const tool = getToolTemplate(templateId);
  if (!tool) throw new Error('Unknown template. Choose a reviewed catalog template.');
  if (!plain(details)) throw new Error('Manifest details must be an object.');
  const detailErrors = [];
  inspectData(details, 'details', detailErrors);
  for (const key of Object.keys(details)) if (!['id', 'title', 'description', 'brief'].includes(key)) detailErrors.push(`details.${key}: unsupported property.`);
  if (detailErrors.length) throw new Error(detailErrors.join('\n'));
  const manifest = {
    schemaVersion: MANIFEST_VERSION,
    id: details.id,
    version: '1.0.0',
    title: details.title,
    description: details.description ?? tool.description,
    category: tool.category,
    license: 'MIT',
    capabilities: { ...capabilities },
    recipe: { templateId, values: {}, brief: details.brief ?? '' },
  };
  const result = validateToolManifest(manifest);
  if (!result.success) throw new Error(result.errors.join('\n'));
  return result.manifest;
}
export function compileToolPrompt(toolOrManifest, values = {}, brief = '') {
  let tool;
  let baseValues = {};
  let baseBrief = '';
  if (plain(toolOrManifest) && Object.hasOwn(toolOrManifest, 'schemaVersion')) {
    const result = validateToolManifest(toolOrManifest);
    if (!result.success) throw new Error(result.errors.join('\n'));
    tool = getToolTemplate(result.manifest.recipe.templateId);
    baseValues = result.manifest.recipe.values;
    baseBrief = result.manifest.recipe.brief;
  } else {
    // Always resolve reviewed source by id. User-supplied promptTemplate is ignored.
    tool = getToolTemplate(typeof toolOrManifest === 'string' ? toolOrManifest : plain(toolOrManifest) ? Object.getOwnPropertyDescriptor(toolOrManifest, 'id')?.value : undefined);
  }
  if (!tool) throw new Error('Unknown reviewed tool template.');
  const errors = validateRecipeValues(tool.id, values);
  boundedString(brief, 'brief', 4000, errors, true);
  if (errors.length) throw new Error(errors.join('\n'));
  const merged = Object.fromEntries(tool.fields.map((field) => [field.id, field.default]));
  Object.assign(merged, baseValues, values);
  const direction = tool.promptTemplate.replace(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g, (_, key) => JSON.stringify(merged[key]));
  const input = [baseBrief, brief].filter(Boolean).join('\n');
  const result = `${tool.title}\n\n${direction}\n\nUser brief (creative input):\n${JSON.stringify(input)}\n\nUse only explicitly selected references. This recipe grants no external network, filesystem, camera or account access. Prepare the requested work in ${tool.studioMode} Studio; generation and credit confirmation remain in the host.`;
  if (result.length > MAX_PROMPT_LENGTH) throw new Error(`Compiled prompt exceeds ${MAX_PROMPT_LENGTH} characters. Shorten the brief or settings.`);
  return result;
}

const fieldSchema = (field) => field.type === 'number'
  ? { type: 'integer', minimum: field.min, maximum: field.max }
  : { type: 'string', maxLength: ['title', 'text'].includes(field.id) ? 300 : 2000, ...(field.type === 'select' ? { enum: field.options } : {}), ...(['color', 'background'].includes(field.id) ? { pattern: '^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$' } : {}) };
export const TOOL_MANIFEST_SCHEMA = freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://optimai.studio/schemas/tool-manifest/1.0',
  title: 'OptimAI declarative tool recipe v1.0',
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'id', 'version', 'title', 'description', 'category', 'license', 'capabilities', 'recipe'],
  properties: {
    schemaVersion: { const: MANIFEST_VERSION }, id: { type: 'string', maxLength: 64, pattern: ID.source },
    version: { type: 'string', maxLength: 24, pattern: '^\\d+\\.\\d+\\.\\d+$' },
    title: { type: 'string', minLength: 1, maxLength: 80 }, description: { type: 'string', minLength: 1, maxLength: 600 },
    category: { enum: categories }, license: { const: 'MIT' },
    capabilities: { type: 'object', additionalProperties: false, required: Object.keys(capabilities), properties: Object.fromEntries(Object.entries(capabilities).map(([key, value]) => [key, { const: value }])) },
    recipe: {
      oneOf: TOOL_CATALOG.map((tool) => ({ type: 'object', additionalProperties: false, required: ['templateId', 'values', 'brief'], properties: {
        templateId: { const: tool.id }, brief: { type: 'string', maxLength: 4000 },
        values: { type: 'object', additionalProperties: false, properties: Object.fromEntries(tool.fields.map((field) => [field.id, fieldSchema(field)])) },
      } })),
    },
  },
  allOf: TOOL_CATALOG.map((tool) => ({ if: { properties: { recipe: { properties: { templateId: { const: tool.id } }, required: ['templateId'] } }, required: ['recipe'] }, then: { properties: { category: { const: tool.category } } } })),
});
// Same v1 data contract; the legacy schema and Tool aliases remain available so
// saved recipes can reopen without an unsafe data migration.
export const AGENT_MANIFEST_SCHEMA = freeze({ ...TOOL_MANIFEST_SCHEMA, $id: 'https://optimai.studio/schemas/agent-manifest/1.0', title: 'OptimAI declarative agent recipe v1.0' });
export const validateAgentManifest = validateToolManifest;
export const createAgentManifest = createToolManifest;
export const compileAgentPrompt = compileToolPrompt;
export function verifyRegistry() {
  const errors = [];
  const ids = new Set();
  const operations = new Set(['image-filter', 'image-resize', 'image-grid', 'type-overlay', 'prompt-builder']);
  for (const tool of TOOL_CATALOG) {
    if (!ID.test(tool.id) || ids.has(tool.id)) errors.push(`${tool.id}: invalid or duplicate id.`);
    ids.add(tool.id);
    if (!categories.includes(tool.category) || !/^#[0-9a-fA-F]{6}$/.test(tool.accent)) errors.push(`${tool.id}: invalid category or accent.`);
    if (!['local', 'studio'].includes(tool.runtime) || !['image', 'video', 'story', 'character', 'editor'].includes(tool.studioMode)) errors.push(`${tool.id}: unsupported runtime or studio mode.`);
    if (tool.runtime === 'local' && !operations.has(tool.localOperation)) errors.push(`${tool.id}: missing reviewed local operation.`);
    if (!['browser', 'local-model', 'studio-guided'].includes(tool.executionKind)
      || (tool.executionKind === 'local-model' && (tool.category !== 'writing' || tool.localOperation !== 'prompt-builder'))
      || (tool.executionKind === 'browser' && (tool.runtime !== 'local' || tool.localOperation === 'prompt-builder'))
      || (tool.executionKind === 'studio-guided' && tool.runtime !== 'studio')) errors.push(`${tool.id}: execution kind does not match its reviewed capability.`);
    const fieldIds = new Set(tool.fields.map((field) => field.id));
    if (fieldIds.size !== tool.fields.length) errors.push(`${tool.id}: duplicate setting id.`);
    for (const key of tool.promptTemplate.matchAll(/\{\{(.*?)\}\}/g)) if (!fieldIds.has(key[1])) errors.push(`${tool.id}: undefined placeholder ${key[1]}.`);
    try { compileToolPrompt(tool, Object.fromEntries(tool.fields.map((field) => [field.id, field.default]))); } catch (error) { errors.push(`${tool.id}: ${error.message}`); }
  }
  return { success: errors.length === 0, errors, count: TOOL_CATALOG.length };
}
