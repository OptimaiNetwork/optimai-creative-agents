import assert from 'node:assert/strict';
import test from 'node:test';
import { PLAYGROUND_LIMITS, PLAYGROUND_RUNNERS, colorInputValue, decodePlaygroundState, encodePlaygroundState, formDefaults, listPlaygroundAgents, playgroundRunPlan, readFormValue, rerollSeed } from '../src/playground.mjs';
import { getAgentFormSchema, listFormFields } from '../src/form-schema.mjs';
import { AGENT_CATALOG, getAgentInputPolicy, validateRecipeValues } from '../src/index.mjs';
import { CANVAS_LAB_AGENTS, canvasLabSettings } from '../src/canvas-lab.mjs';
import { VISION_MODELS } from '../src/vision-runtime.mjs';

const field = (id, agent) => listFormFields(getAgentFormSchema(agent)).find(entry => entry.id === id);

test('the playground lists every canvas and vision agent with its runner, inputs and model setup', () => {
  const agents = listPlaygroundAgents();
  const expected = AGENT_CATALOG.filter(tool => ['canvas', 'vision'].includes(tool.workspace.kind)).map(tool => tool.id);
  assert.deepEqual(agents.map(agent => agent.id), expected);
  assert.deepEqual(PLAYGROUND_RUNNERS, ['canvas-lab', 'local-tool', 'vision']);
  for (const agent of agents) {
    assert.ok(Object.isFrozen(agent) && Object.isFrozen(agent.inputs));
    const policy = getAgentInputPolicy(agent.id);
    assert.deepEqual(agent.inputs, { min: policy.minFiles, max: policy.maxFiles, accept: policy.accept });
    assert.equal(agent.runner, agent.kind === 'vision' ? 'vision' : Object.hasOwn(CANVAS_LAB_AGENTS, agent.id) ? 'canvas-lab' : 'local-tool');
    if (agent.runner === 'vision') assert.deepEqual(agent.setup, { model: VISION_MODELS[agent.operation].id, name: VISION_MODELS[agent.operation].name, bytes: VISION_MODELS[agent.operation].bytes });
    else assert.equal(agent.setup, null);
  }
  assert.deepEqual(listPlaygroundAgents({ runners: ['vision'] }).map(agent => agent.id), ['select-and-replace', 'motion-pose', 'face-performance']);
  assert.ok(agents.find(agent => agent.id === 'poster-lab').inputs.min === 0, 'Poster Lab runs without an image');
});

test('defaults come from the form schema and every default plan runs through the real normalizers', () => {
  for (const agent of listPlaygroundAgents()) {
    const schema = getAgentFormSchema(agent.id), defaults = formDefaults(schema);
    assert.deepEqual(Object.keys(defaults).sort(), Object.keys(schema.properties).sort());
    assert.deepEqual(validateRecipeValues(agent.id, defaults), []);
    const plan = playgroundRunPlan(agent.id, defaults);
    assert.equal(plan.runner, agent.runner);
    assert.equal(plan.operation, agent.operation);
    if (plan.runner === 'canvas-lab') assert.doesNotThrow(() => canvasLabSettings(plan.operation, plan.settings));
    if (plan.runner === 'local-tool') assert.deepEqual(plan.settings, defaults);
    if (plan.runner === 'vision') assert.equal(plan.model, VISION_MODELS[plan.operation]);
  }
  // Legacy aliases still reach the engine: Poster Lab's saved `format` picks the ratio when `ratio` is not given.
  assert.equal(playgroundRunPlan('poster-lab', { format: 'wide banner' }).settings.ratio, '16:9');
  assert.equal(playgroundRunPlan('poster-lab', { format: 'wide banner', ratio: '1:1' }).settings.ratio, '1:1');
  assert.throws(() => playgroundRunPlan('poster-lab', { ratio: '3:2' }), /ratio/);
  assert.throws(() => playgroundRunPlan('story-seed', {}), /own workspace/);
  assert.throws(() => playgroundRunPlan('not-an-agent'), /reviewed catalog/);
  assert.throws(() => formDefaults({}), /getAgentFormSchema/);
});

test('raw control values are read into values the recipe validator accepts', () => {
  const width = field('width', 'mockup-maker'), intensity = field('intensity', 'image-finish');
  assert.equal(readFormValue(width, '800'), 800);
  assert.equal(readFormValue(width, ''), width.schema.default, 'a cleared number falls back instead of becoming 0');
  assert.equal(readFormValue(width, 'abc'), width.schema.default);
  assert.equal(readFormValue(width, '1'), width.schema.minimum);
  assert.equal(readFormValue(width, 1e9), width.schema.maximum);
  assert.equal(readFormValue(intensity, '41.6'), 42);
  const ratio = field('ratio', 'poster-lab');
  assert.equal(readFormValue(ratio, '16:9'), '16:9');
  assert.equal(readFormValue(ratio, '3:2'), ratio.schema.default);
  const color = field('color', 'poster-lab');
  assert.equal(readFormValue(color, ' #ABC '), '#ABC');
  assert.equal(readFormValue(color, 'red'), color.schema.default);
  assert.equal(readFormValue(color, '#12'), color.schema.default);
  assert.equal(readFormValue(color, '#12', { partial: true }), '#12', 'typing a hex keeps the unfinished text');
  assert.equal(readFormValue(color, 'red', { partial: true }), color.schema.default);
  const title = field('title', 'poster-lab');
  assert.equal(readFormValue(title, 'x'.repeat(400)).length, title.schema.maxLength);
  assert.equal(readFormValue(title, null), '');
  for (const agent of listPlaygroundAgents()) {
    for (const entry of listFormFields(getAgentFormSchema(agent.id))) {
      for (const raw of ['', 'nope', '-5', '99999999', '#fff', 'x'.repeat(3000)]) {
        const value = readFormValue(entry, raw);
        if (entry.id === 'title' && value === '') continue; // An empty title is the creator's choice; the engine reports it.
        assert.deepEqual(validateRecipeValues(agent.id, { [entry.id]: value }), [], `${agent.id}.${entry.id} from ${raw.slice(0, 12)}`);
      }
    }
  }
  assert.throws(() => readFormValue({}, '1'), /listFormFields/);
});

test('color pickers and seed rerolls get values their controls accept', () => {
  assert.equal(colorInputValue('#A1B2C3'), '#a1b2c3');
  assert.equal(colorInputValue('#abc'), '#aabbcc');
  assert.equal(colorInputValue('transparent'), '#000000');
  assert.equal(colorInputValue(undefined, '#101312'), '#101312');
  const seed = field('seed', 'glitch-cut');
  assert.equal(rerollSeed(seed, 5, () => 0), seed.schema.minimum);
  assert.equal(rerollSeed(seed, 5, () => 1), seed.schema.maximum);
  assert.notEqual(rerollSeed(seed, seed.schema.minimum, () => 0), seed.schema.minimum, 'a reroll always changes the look');
  assert.equal(rerollSeed(seed, seed.schema.maximum, () => 1), seed.schema.minimum);
  let x = 7;
  for (let i = 0; i < 200; i++) { const next = rerollSeed(seed, x); assert.ok(Number.isInteger(next) && next >= seed.schema.minimum && next <= seed.schema.maximum && next !== x); x = next; }
  assert.equal(rerollSeed({ schema: { minimum: 3, maximum: 3 } }, 3), 3);
});

test('share links keep only changed settings and read back exactly, refusing what they cannot trust', () => {
  const values = { ...formDefaults(getAgentFormSchema('poster-lab')), title: 'Night\nmarket & co', ratio: '1:1' };
  const text = encodePlaygroundState({ agent: 'poster-lab', values });
  assert.equal(new URLSearchParams(text).get('agent'), 'poster-lab');
  assert.deepEqual([...new URLSearchParams(text).keys()], ['agent', 'title', 'ratio']);
  assert.deepEqual(decodePlaygroundState(`#${text}`), { agent: 'poster-lab', values, dropped: [] });
  assert.deepEqual(decodePlaygroundState(`?${text}`).values, values);
  assert.equal(encodePlaygroundState({ agent: 'glitch-cut' }), 'agent=glitch-cut');
  const seeded = decodePlaygroundState(encodePlaygroundState({ agent: 'glitch-cut', values: { seed: 4242 } }));
  assert.equal(seeded.values.seed, 4242);
  const odd = decodePlaygroundState('agent=glitch-cut&seed=4.5&amount=500&bogus=1&effect=colour%20trails&__proto__=x');
  assert.deepEqual(odd.dropped, ['seed', 'amount', 'bogus', '__proto__']);
  assert.deepEqual(odd.values, { ...formDefaults(getAgentFormSchema('glitch-cut')), effect: 'colour trails' });
  assert.equal(Object.getPrototypeOf(odd.values), Object.prototype);
  assert.equal(decodePlaygroundState('agent=story-unknown'), null);
  assert.equal(decodePlaygroundState('title=hi'), null);
  assert.equal(decodePlaygroundState(`agent=poster-lab&title=${'x'.repeat(PLAYGROUND_LIMITS.stateLength)}`), null);
  assert.equal(decodePlaygroundState(42), null);
  assert.throws(() => encodePlaygroundState({ agent: 'select-and-replace', values: { replacement: '€'.repeat(500) } }), /too long/);
  assert.throws(() => encodePlaygroundState({ agent: 'poster-lab', values: { ratio: '3:2' } }), /ratio/);
  assert.throws(() => encodePlaygroundState({ agent: 'nope' }), /reviewed catalog/);
});
