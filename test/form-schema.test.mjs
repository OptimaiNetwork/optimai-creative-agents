import assert from 'node:assert/strict';
import test from 'node:test';
import { AGENT_FORM_SCHEMA_VERSION, FORM_CONTROLS, FORM_GROUPS, FORM_ROLES, getAgentFieldRoles, getAgentFormSchema, listFormFields, plainFormSchema } from '../src/form-schema.mjs';
import { AGENT_CATALOG, AGENT_WORKSPACE_CONTRACT_VERSION, getAgentTemplate, validateRecipeValues } from '../src/index.mjs';
import { CANVAS_LAB_AGENTS, canvasLabRecipeSettings } from '../src/canvas-lab.mjs';
import { scene3DRecipeSettings } from '../src/scene-3d.mjs';
import { cameraRecipeSettings } from '../src/camera-runtime.mjs';

// The subset of JSON Schema 2020-12 the form schemas use, so the schema can be checked against the real validator.
function accepts(schema, values) {
  if (typeof values !== 'object' || values === null || Array.isArray(values)) return false;
  return Object.entries(values).every(([key, value]) => {
    const property = schema.properties[key];
    if (!property) return schema.additionalProperties !== false;
    if (property.type === 'integer' && !Number.isInteger(value)) return false;
    if (property.type === 'string' && typeof value !== 'string') return false;
    if (property.enum && !property.enum.includes(value)) return false;
    if (property.minimum !== undefined && value < property.minimum) return false;
    if (property.maximum !== undefined && value > property.maximum) return false;
    if (property.maxLength !== undefined && value.length > property.maxLength) return false;
    return property.pattern === undefined || new RegExp(property.pattern, 'u').test(value);
  });
}
const probes = field => field.type === 'select' ? [...field.options, 'not-an-option']
  : field.type === 'number' ? [field.min, field.max, field.min - 1, field.max + 1, field.min + 0.5]
    : [field.default, '', 'x'.repeat(2001), ...(['color', 'background'].includes(field.id) ? ['#abc', '#a1b2c3', 'red', '#12345'] : [])];
const options = (field, like = field) => like !== field ? options(like) : field.type === 'select' ? field.options : field.type === 'number' ? [field.min, field.max] : field.id === 'title' || field.id === 'text' ? ['CHANGED TITLE'] : ['color', 'background'].includes(field.id) ? ['#123456'] : ['changed direction'];

test('every reviewed template has a well-formed 2020-12 form schema with hints for every setting', () => {
  assert.equal(AGENT_FORM_SCHEMA_VERSION, '1.0');
  for (const tool of AGENT_CATALOG) {
    const schema = getAgentFormSchema(tool.id);
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.$id, `https://optimai.studio/schemas/agent-form/1.0/${tool.id}`);
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema['x-optimai'], { templateId: tool.id, workspace: { kind: tool.workspace.kind, ...(tool.workspace.operation ? { operation: tool.workspace.operation } : {}) }, contract: AGENT_WORKSPACE_CONTRACT_VERSION });
    assert.deepEqual(Object.keys(schema.properties).sort(), tool.fields.map(field => field.id).sort());
    assert.deepEqual([...schema['x-ui'].order].sort(), tool.fields.map(field => field.id).sort());
    assert.deepEqual(schema['x-ui'].groups.flatMap(group => group.fields), schema['x-ui'].order);
    assert.ok(schema['x-ui'].groups.every(group => group.fields.length && FORM_GROUPS.some(entry => entry.id === group.id)));
    for (const field of tool.fields) {
      const property = schema.properties[field.id], ui = property['x-ui'];
      assert.equal(property.title, field.label);
      assert.equal(property.default, field.default);
      assert.ok(FORM_CONTROLS.includes(ui.control) && FORM_ROLES.includes(ui.role) && ui.role !== 'unused', `${tool.id}.${field.id}`);
      assert.equal(schema['x-ui'].order[ui.order], field.id);
      if (field.type === 'select') assert.deepEqual(property.enum, field.options);
      if (field.type === 'number') assert.deepEqual([property.type, property.minimum, property.maximum, ui.step], ['integer', field.min, field.max, 1]);
    }
  }
});

test('the schema accepts exactly what validateRecipeValues accepts, setting by setting', () => {
  let checked = 0;
  for (const tool of AGENT_CATALOG) {
    const schema = getAgentFormSchema(tool.id);
    assert.equal(accepts(schema, Object.fromEntries(tool.fields.map(field => [field.id, field.default]))), true, `${tool.id} defaults`);
    assert.equal(accepts(schema, { remoteEndpoint: 'x' }), false);
    for (const field of tool.fields) for (const value of probes(field)) {
      assert.equal(accepts(schema, { [field.id]: value }), !validateRecipeValues(tool.id, { [field.id]: value }).length, `${tool.id}.${field.id} = ${JSON.stringify(value).slice(0, 40)}`);
      checked++;
    }
  }
  assert.ok(checked > 400);
});

test('engine, alias and brief roles match what the real engines read', () => {
  const engines = {
    // A composition carries every lab setting; compare only the ones this template's engine draws.
    ...Object.fromEntries(Object.keys(CANVAS_LAB_AGENTS).map(id => [id, values => {
      const settings = canvasLabRecipeSettings(id, values), roles = getAgentFieldRoles(id);
      return Object.fromEntries(Object.keys(roles).filter(key => roles[key] === 'engine').map(key => [key, settings[key]]));
    }])),
    'model-turntable': values => scene3DRecipeSettings('model-turntable', values), 'scene-lighting': values => scene3DRecipeSettings('scene-lighting', values),
    'camera-stage': values => cameraRecipeSettings('camera-stage', values), 'avatar-stage': values => cameraRecipeSettings('avatar-stage', values),
  };
  const counts = { engine: 0, alias: 0, brief: 0 };
  for (const [id, run] of Object.entries(engines)) {
    const tool = getAgentTemplate(id), roles = getAgentFieldRoles(id), schema = getAgentFormSchema(id);
    const base = JSON.stringify(run({}));
    for (const field of tool.fields) {
      const role = roles[field.id], canonical = tool.fields.find(entry => entry.id === schema.properties[field.id]['x-ui'].aliasOf);
      // A free-text alias (3D `material`) is mapped only when it names one of the canonical choices.
      const like = field.type === 'text' && canonical?.type === 'select' ? canonical : field;
      const changes = options(field, like).map(value => JSON.stringify(run({ [field.id]: value })) !== base);
      counts[role]++;
      if (role === 'brief') assert.ok(changes.every(changed => !changed), `${id}.${field.id} is read by the engine`);
      else assert.ok(changes.some(Boolean), `${id}.${field.id} never changes the engine`);
      if (role === 'alias') {
        const canonical = schema.properties[field.id]['x-ui'].aliasOf, pinned = { [canonical]: tool.fields.find(entry => entry.id === canonical).default };
        for (const value of options(field, like)) assert.equal(JSON.stringify(run({ ...pinned, [field.id]: value })), JSON.stringify(run(pinned)), `${id}.${field.id} overrides ${canonical}`);
      }
    }
  }
  assert.ok(counts.engine >= 30 && counts.alias === 6 && counts.brief >= 8, JSON.stringify(counts));
});

test('controls, groups and notes follow the setting', () => {
  const hints = id => Object.fromEntries(listFormFields(getAgentFormSchema(id)).map(field => [field.id, [field.control, field.group, field.role]]));
  assert.deepEqual(hints('print-shop'), { look: ['select', 'look', 'engine'], amount: ['slider', 'look', 'engine'], seed: ['seed', 'look', 'engine'], color: ['color', 'color', 'engine'], inks: ['select', 'color', 'engine'], ratio: ['select', 'layout', 'engine'], scale: ['stepper', 'look', 'engine'] });
  assert.deepEqual(hints('mockup-maker').width, ['number', 'layout', 'brief']);
  assert.deepEqual(hints('image-grid').columns, ['stepper', 'layout', 'engine']);
  const poster = getAgentFormSchema('poster-lab');
  assert.deepEqual(poster['x-ui'].groups.map(group => [group.id, group.fields]), [['content', ['title']], ['look', ['treatment', 'style']], ['color', ['color']], ['layout', ['ratio', 'format']]]);
  assert.equal(poster.properties.format['x-ui'].aliasOf, 'ratio');
  assert.match(poster.properties.format.description, /uses "Artboard ratio" when it is set/);
  assert.match(getAgentFormSchema('reference-blend').properties.priority.description, /does not read it/);
  assert.equal(getAgentFormSchema('world-finder').properties.time.description, undefined);
  assert.equal(getAgentFormSchema('poster-lab').properties.color.pattern, '^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$');
});

test('schemas are fresh plain JSON and the plain form drops every hint', () => {
  const schema = getAgentFormSchema('glitch-cut');
  schema.properties.seed.maximum = 1;
  assert.equal(getAgentFormSchema('glitch-cut').properties.seed.maximum, 999999);
  assert.deepEqual(JSON.parse(JSON.stringify(getAgentFormSchema('glitch-cut'))), getAgentFormSchema('glitch-cut'));
  const plain = JSON.stringify(plainFormSchema(getAgentFormSchema('glitch-cut')));
  assert.ok(!plain.includes('"x-'));
  assert.deepEqual(listFormFields(getAgentFormSchema('glitch-cut')).map(field => field.id), ['effect', 'amount', 'seed', 'intensity', 'ratio']);
  assert.throws(() => listFormFields({}), /getAgentFormSchema/);
});

test('unreviewed templates get honest roles and malformed settings are refused', () => {
  const finish = getAgentTemplate('image-finish');
  const community = { ...finish, id: 'community-color-finish', fields: [...finish.fields, { id: 'remoteEndpoint', label: 'Endpoint', type: 'text', default: 'https://example.com' }] };
  assert.deepEqual(getAgentFieldRoles(community), { preset: 'engine', intensity: 'engine', remoteEndpoint: 'unused' });
  assert.match(getAgentFormSchema(community).properties.remoteEndpoint.description, /Not read/);
  const workflow = { ...getAgentTemplate('world-finder'), id: 'community-world', fields: [{ id: 'weather', label: 'Weather', type: 'text', default: 'rain' }] };
  assert.equal(getAgentFieldRoles(workflow).weather, 'brief');
  assert.throws(() => getAgentFormSchema('no-such-agent'), /catalog template/);
  assert.throws(() => getAgentFormSchema({ ...finish, fields: [{ id: 'preset', type: 'iframe', default: 'warm' }] }), /unsupported type iframe/);
  assert.throws(() => getAgentFormSchema({ ...finish, fields: [{ id: 'view', type: 'select', default: 'iso' }] }), /needs string options/);
  assert.throws(() => getAgentFormSchema({ ...finish, fields: [{ id: 'mix', type: 'number', default: 1, min: NaN, max: 2 }] }), /finite min/);
  assert.throws(() => getAgentFormSchema({ ...finish, fields: [{ id: '__proto__', type: 'text', default: '' }] }), /alphanumeric/);
});
