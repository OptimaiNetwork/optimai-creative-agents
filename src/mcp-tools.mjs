// Pure MCP tool contract for the catalog: definitions with input and output schemas, small
// self-contained icons, a stable order, prepared recipes and the recipe file a client can save.
// No Node or browser APIs beyond btoa, so the stdio adapter, starter kits and hosts share it.
import { AGENT_CATALOG, MAX_PROMPT_LENGTH, compileAgentPrompt, createAgentManifest, getAgentTemplate, validateAgentManifest } from './index.mjs';
import { getAgentFormSchema, plainFormSchema } from './form-schema.mjs';

export const MCP_PROTOCOL_VERSION = '2025-11-25';
export const MCP_RESOURCE_SCHEME = 'optimai-agents';
const freeze = (value) => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(freeze); } return value; };
// One original 24px line glyph per workspace kind, drawn over the agent's accent colour.
const GLYPHS = freeze({
  music: 'M9 17V6l9-2v11M9 17a2 2 0 1 1-4 0a2 2 0 0 1 4 0M18 15a2 2 0 1 1-4 0a2 2 0 0 1 4 0',
  frame: 'M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4',
  sketch: 'M5 19l3.5-1L18 8.5 15.5 6 6 15.5zM13.5 8l2.5 2.5',
  workflow: 'M5 5h5v5H5zM14 14h5v5h-5zM10 7.5h4.5V14',
  canvas: 'M5 5h14v14H5zM5 15l4-4 4 4 2-2 4 4',
  vision: 'M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6zM12 10a2 2 0 1 1 0 4a2 2 0 0 1 0-4',
  writing: 'M6 7h12M6 11h12M6 15h8',
  camera: 'M4 8h3l2-2h6l2 2h3v10H4zM12 10a3 3 0 1 1 0 6a3 3 0 0 1 0-6',
  '3d': 'M12 4l7 4v8l-7 4-7-4V8zM5 8l7 4 7-4M12 12v8',
  agent: 'M12 5v14M5 12h14',
});
const HEX = /^#[0-9a-f]{6}$/i;
const toolOf = (toolOrId) => typeof toolOrId === 'string' ? getAgentTemplate(toolOrId) : toolOrId?.id && getAgentTemplate(toolOrId.id);
function known(toolOrId) { const tool = toolOf(toolOrId); if (!tool) throw new Error('Unknown agent. Use an ID from the catalog.'); return tool; }
const base64 = (text) => typeof btoa === 'function' ? btoa(text) : Buffer.from(text, 'latin1').toString('base64');

/** Stable MCP tool name for an agent: `optimai.<id>` by default, or `prefix + id` with `-` swapped for `separator`. */
export function mcpToolName(toolOrId, { prefix = 'optimai.', separator = '-' } = {}) { return `${prefix}${known(toolOrId).id.replaceAll('-', separator)}`; }
/** Self-contained SVG icon (no scripts, links or external references) for an agent. */
export function mcpToolIconSvg(toolOrId) {
  const tool = known(toolOrId);
  const accent = HEX.test(tool.accent) ? tool.accent.toLowerCase() : '#a8a1ff';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><rect width="24" height="24" rx="6" fill="${accent}"/><path d="${GLYPHS[tool.workspace?.kind] ?? GLYPHS.agent}" fill="none" stroke="#17141f" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
/** MCP `Icon` list: one scalable base64 SVG data URI that reads on light and dark clients. */
export function mcpToolIcons(toolOrId) { return [{ src: `data:image/svg+xml;base64,${base64(mcpToolIconSvg(toolOrId))}`, mimeType: 'image/svg+xml', sizes: ['any'] }]; }

function settings(tool) {
  return Object.fromEntries(Object.entries(plainFormSchema(getAgentFormSchema(tool)).properties).map(([id, { title, description, ...property }]) => [id, { ...property, description: description ? `${title}. ${description}` : title }]));
}
function recipeSchema(tool) {
  const values = settings(tool);
  return { type: 'object', additionalProperties: false,
    required: ['templateId', 'runtime', 'workspace', 'studioMode', ...(tool.localOperation ? ['localOperation'] : []), 'values', 'prompt'],
    properties: { templateId: { type: 'string', const: tool.id }, runtime: { type: 'string', const: tool.runtime }, workspace: { type: 'object', const: tool.workspace }, studioMode: { type: 'string', const: tool.studioMode },
      ...(tool.localOperation ? { localOperation: { type: 'string', const: tool.localOperation } } : {}),
      values: { type: 'object', additionalProperties: false, required: Object.keys(values), properties: values },
      prompt: { type: 'string', maxLength: MAX_PROMPT_LENGTH } } };
}
const WRITTEN = freeze({ type: 'object', additionalProperties: false, required: ['title', 'summary', 'sections', 'studioPrompt', 'model', 'provider', 'templateId', 'attempts'], properties: {
  title: { type: 'string' }, summary: { type: 'string' }, studioPrompt: { type: 'string' }, model: { type: 'string' }, provider: { type: 'string', enum: ['ollama', 'webllm'] }, templateId: { type: 'string' }, attempts: { type: 'integer', minimum: 1, maximum: 2 },
  sections: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['heading', 'body'], properties: { heading: { type: 'string' }, body: { type: 'string' } } } } } });
/** JSON Schema of `structuredContent` for a successful call. Writing agents return a prepared recipe or, with execution run, a written result; `run: false` keeps it to the recipe. */
export function mcpOutputSchema(toolOrId, { run = true } = {}) {
  const tool = known(toolOrId);
  if (tool.executionKind !== 'local-model' || !run) return recipeSchema(tool);
  return { type: 'object', anyOf: [recipeSchema(tool), { ...WRITTEN, properties: { ...WRITTEN.properties, templateId: { type: 'string', const: tool.id } } }] };
}
/** Full MCP `Tool` definition. `name` overrides the default `optimai.<id>`; `icons: false` leaves icons out; `run: false` offers writing agents as recipe-only tools. */
export function mcpToolDefinition(toolOrId, { name, icons = true, run = true } = {}) {
  const tool = known(toolOrId);
  const isWriting = tool.executionKind === 'local-model' && run;
  return {
    name: name ?? mcpToolName(tool), title: tool.title,
    description: `${tool.description} ${isWriting ? 'Set execution to run and select an installed Ollama model for a written result; otherwise prepares a recipe.' : 'Prepares a recipe; does not generate or modify media.'}`,
    ...(icons ? { icons: mcpToolIcons(tool) } : {}),
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      values: { type: 'object', additionalProperties: false, properties: settings(tool) },
      brief: { type: 'string', maxLength: 4000 },
      ...(isWriting ? { execution: { type: 'string', enum: ['prepare', 'run'], default: 'prepare' }, model: { type: 'string', minLength: 1, maxLength: 160, description: 'An already installed Ollama model. Required when execution is run.' } } : {}),
    } },
    outputSchema: mcpOutputSchema(tool, { run }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: !isWriting, openWorldHint: false },
  };
}
const byName = (a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
/** Tool definitions in a stable order (sorted by name, by code point), so listings diff cleanly across releases. */
export function mcpToolDefinitions({ ids, prefix, separator, icons, run } = {}) {
  const tools = ids === undefined ? AGENT_CATALOG : ids.map(known);
  return tools.map((tool) => mcpToolDefinition(tool, { name: mcpToolName(tool, { prefix, separator }), icons, run })).sort(byName);
}
/** Prepared recipe for a call, shaped by `mcpOutputSchema`. Validate `values` first with `validateRecipeValues`. */
export function prepareMcpRecipe(toolOrId, values = {}, brief = '') {
  const tool = known(toolOrId);
  return { templateId: tool.id, runtime: tool.runtime, workspace: tool.workspace, studioMode: tool.studioMode, ...(tool.localOperation ? { localOperation: tool.localOperation } : {}),
    values: Object.fromEntries(tool.fields.map((field) => [field.id, Object.hasOwn(values, field.id) ? values[field.id] : field.default])), prompt: compileAgentPrompt(tool, values, brief) };
}
/** URI of an agent's catalog artwork, readable through the adapter's `resources/read`. */
export function mcpArtworkUri(toolOrId) { return `${MCP_RESOURCE_SCHEME}://artwork/${known(toolOrId).id}.svg`; }
/** Agent ID named by an artwork URI, or undefined for anything else (exact match, no path tricks). */
export function mcpArtworkId(uri) {
  const match = typeof uri === 'string' && /^optimai-agents:\/\/artwork\/([a-z][a-z0-9-]{0,63})\.svg$/.exec(uri);
  return match && getAgentTemplate(match[1]) ? match[1] : undefined;
}
/** MCP `Resource` entries for every agent's artwork, sorted by URI. */
export function mcpArtworkResources() {
  return AGENT_CATALOG.map((tool) => ({ uri: mcpArtworkUri(tool), name: `${tool.id}.svg`, title: `${tool.title} artwork`, mimeType: 'image/svg+xml' })).sort((a, b) => a.uri < b.uri ? -1 : 1);
}
/** Importable recipe file (manifest v1.0) holding the call's resolved settings and brief. */
export function mcpRecipeManifest(toolOrId, values = {}, brief = '') {
  const tool = known(toolOrId);
  const manifest = createAgentManifest(tool.id, { id: `${tool.id}-recipe`, title: tool.title, brief });
  manifest.recipe.values = prepareMcpRecipe(tool, values, brief).values;
  const checked = validateAgentManifest(manifest);
  if (!checked.success) throw new Error(checked.errors.join('\n'));
  return checked.manifest;
}
/** Extra content blocks for a successful call: a link to the agent's artwork and the saveable recipe file. */
export function mcpRecipeExports(toolOrId, values = {}, brief = '') {
  const tool = known(toolOrId);
  return [
    { type: 'resource_link', uri: mcpArtworkUri(tool), name: `${tool.id}.svg`, title: `${tool.title} artwork`, mimeType: 'image/svg+xml' },
    { type: 'resource', resource: { uri: `${MCP_RESOURCE_SCHEME}://recipes/${tool.id}.agent.json`, mimeType: 'application/json', text: `${JSON.stringify(mcpRecipeManifest(tool, values, brief), null, 2)}\n` } },
  ];
}
