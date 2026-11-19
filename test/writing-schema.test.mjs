import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareCreativeAgentTask, validateCreativeAgentOutput, runCreativeAgent, AgentRuntimeError } from '../src/agent-runtime.mjs';
import { createBrowserWritingRuntime, BROWSER_AGENT_MODEL } from '../src/browser-writing-runtime.mjs';
import { CONSTRAINED_SCHEMA_KEYWORDS, checkConstrainedSchema, maxJsonLength, singleSectionSchema, writingFormat } from '../src/writing-schema.mjs';

const HEADINGS = {
  'cast-notes': ['Identity', 'Motivation', 'Strengths and limits', 'Character arc', 'Consistency notes'],
  'style-brief': ['Art direction', 'Palette', 'Line and material', 'Lighting', 'Composition', 'Things to avoid'],
  'story-seed': ['Premise', 'Cast', 'Setting', 'Chapter outline', 'Visual and production direction'],
};
const BRIEF = 'A courier helps a lost star home across a sleeping harbour town.';
const LONG_BRIEF = Array.from({ length: 52 }, (_, i) => `Beat ${i + 1}: the courier keeps the lantern lit while the harbour sleeps.`).join(' '); // just under the 4,000-character brief cap
// Every contract at its smallest and largest section count, with and without a required art direction.
const CASES = [
  ...Object.keys(HEADINGS).map(templateId => ({ templateId, values: {} })),
  ...[2, 6, 12].map(scenes => ({ templateId: 'storyboard-builder', values: { scenes } })),
  { templateId: 'storyboard-builder', values: { scenes: 12 }, extra: ' Drawn as manga.' },
  ...[2, 6].map(branches => ({ templateId: 'prompt-branches', values: { branches } })),
  { templateId: 'prompt-branches', values: { branches: 6 }, extra: ' In manga style.' },
];

// A stand-in for a grammar-constrained decoder: it can only emit what the schema admits.
// `fill` picks each string's length between minLength and maxLength; text is distinct prose
// (in manga ink, the art direction story-seed asks for by default — content, which no decoder can enforce).
function decode(schema, fill, words = { n: 0 }) {
  if (schema.enum) return schema.enum[words.n++ % schema.enum.length];
  if ('const' in schema) return schema.const;
  if (schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, decode(value, fill, words)]));
  if (schema.type === 'array') return schema.prefixItems ? schema.prefixItems.map(item => decode(item, fill, words)) : Array.from({ length: schema.maxItems }, () => decode(schema.items, fill, words));
  const length = Math.max(schema.minLength ?? 0, Math.min(schema.maxLength, fill(schema)));
  let text = '';
  while (text.length < length) text += `${text ? ' ' : ''}harbour${words.n++} lantern in manga ink${words.n % 7 ? '' : '.'}`;
  return text.slice(0, length).replace(/\s+$/, 'x');
}
let seed = 7;
const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

test('every writing contract compiles to the portable constrained subset, with no unbounded text or list', () => {
  assert.ok(CONSTRAINED_SCHEMA_KEYWORDS.includes('prefixItems'));
  for (const { templateId, values, extra = '' } of CASES) for (const brief of [BRIEF + extra, LONG_BRIEF + extra]) {
    const task = prepareCreativeAgentTask({ templateId, values, brief });
    assert.deepEqual(checkConstrainedSchema(task.schema), [], templateId);
    assert.deepEqual(checkConstrainedSchema(task.decodingSchema), [], templateId);
    assert.ok(Number.isFinite(maxJsonLength(task.decodingSchema)), templateId);
  }
});

test('fixed headings are one tuple slot each, so a decoder cannot reorder, repeat or skip them', () => {
  for (const [templateId, headings] of Object.entries(HEADINGS)) {
    const task = prepareCreativeAgentTask({ templateId, brief: BRIEF });
    const sections = task.decodingSchema.properties.sections;
    assert.equal('items' in sections, false, 'llama.cpp reads items before prefixItems');
    assert.deepEqual(sections.prefixItems.map(item => item.properties.heading.enum), headings.map(heading => [heading]));
    assert.equal(sections.minItems, headings.length);
    assert.equal(sections.maxItems, headings.length);
    // The prompt keeps the plain list form (and its v1 shape) for JSON mode and for reading.
    assert.deepEqual(task.schema.properties.sections.items.properties.heading.enum, headings);
  }
  const scenes = prepareCreativeAgentTask({ templateId: 'storyboard-builder', values: { scenes: 4 }, brief: BRIEF });
  assert.equal(scenes.decodingSchema, scenes.schema, 'numbered headings are renumbered by the host, so no tuple');
});

test('a constrained draft at every maximum length still fits the artifact budget', () => {
  for (const { templateId, values, extra = '' } of CASES) for (const brief of [BRIEF + extra, LONG_BRIEF + extra]) {
    const task = prepareCreativeAgentTask({ templateId, values, brief });
    assert.equal(task.fitsBudget, true, `${templateId} ${JSON.stringify(values)}`);
    const longest = decode(task.decodingSchema, schema => schema.maxLength);
    const checked = validateCreativeAgentOutput(task, JSON.stringify(longest));
    assert.deepEqual(checked.success ? [] : checked.errors, [], `${templateId} ${JSON.stringify(values)} ${brief.length}`);
    assert.ok(JSON.stringify({ title: checked.artifact.title, summary: checked.artifact.summary, sections: checked.artifact.sections }).length <= task.budget);
  }
  // Before fitting, 12 storyboard scenes admitted ~20,000 characters against a budget near 11,000: one in a few long drafts failed only on length.
  const twelve = prepareCreativeAgentTask({ templateId: 'storyboard-builder', values: { scenes: 12 }, brief: LONG_BRIEF });
  const action = twelve.schema.properties.sections.items.properties.action.maxLength;
  assert.ok(action < 350 && action >= 40, `action maxLength ${action}`);
  const short = prepareCreativeAgentTask({ templateId: 'storyboard-builder', values: { scenes: 2 }, brief: BRIEF });
  assert.equal(short.schema.properties.sections.items.properties.action.maxLength, 350, 'short contracts keep their full lengths');
});

test('random constrained drafts never need a structural repair', () => {
  for (const { templateId, values, extra = '' } of CASES) for (let round = 0; round < 8; round++) {
    const task = prepareCreativeAgentTask({ templateId, values, brief: BRIEF + extra });
    const draft = decode(task.decodingSchema, schema => Math.round(schema.minLength + 40 + random() * (schema.maxLength - schema.minLength)), { n: round * 1000 });
    const checked = validateCreativeAgentOutput(task, JSON.stringify(draft));
    assert.deepEqual(checked.success ? [] : checked.errors, [], `${templateId} round ${round}`);
    if (HEADINGS[templateId]) assert.deepEqual(checked.artifact.sections.map(section => section.heading), HEADINGS[templateId]);
  }
});

test('the checker names what would let a decoder wander or fail to compile', () => {
  const ok = { type: 'object', additionalProperties: false, required: ['a'], properties: { a: { type: 'string', maxLength: 5 } } };
  assert.deepEqual(checkConstrainedSchema(ok), []);
  const issues = schema => checkConstrainedSchema(schema).join(' | ');
  assert.match(issues({ type: 'string' }), /maxLength/);
  assert.match(issues({ type: 'string', minLength: 9, maxLength: 5 }), /minLength is above/);
  assert.match(issues({ type: 'string', maxLength: 5, pattern: '^a' }), /pattern is not in the portable subset/);
  assert.match(issues({ ...ok, additionalProperties: true }), /additionalProperties: false/);
  assert.match(issues({ ...ok, required: [] }), /\$\.a: every property must be required/);
  assert.match(issues({ type: 'array', items: ok }), /maxItems/);
  assert.match(issues({ type: 'array', items: ok, prefixItems: [ok], minItems: 1, maxItems: 1 }), /not both/);
  assert.match(issues({ type: 'array', prefixItems: [ok, ok], minItems: 1, maxItems: 2 }), /minItems = maxItems/);
  assert.match(issues({ type: 'number' }), /type must be/);
  assert.match(issues({ enum: [] }), /non-empty strings/);
  assert.match(issues(null), /must be an object/);
});

test('maxJsonLength is the exact longest serialization, or Infinity when unbounded', () => {
  const schema = { type: 'object', additionalProperties: false, required: ['a', 'b'], properties: {
    a: { type: 'string', maxLength: 4 }, b: { type: 'array', maxItems: 2, items: { enum: ['x', 'long'] } } } };
  assert.equal(maxJsonLength(schema), JSON.stringify({ a: 'aaaa', b: ['long', 'long'] }).length);
  assert.equal(maxJsonLength({ type: 'array', prefixItems: [{ const: 'ab' }, { type: 'string', maxLength: 1 }], minItems: 2, maxItems: 2 }), JSON.stringify(['ab', 'c']).length);
  assert.equal(maxJsonLength({ type: 'string' }), Infinity);
  assert.equal(maxJsonLength({ type: 'array', items: { type: 'string', maxLength: 3 } }), Infinity);
  assert.equal(maxJsonLength({ type: 'object', properties: {} }), Infinity);
});

test('single-section schemas write one scene at a time from either list form', () => {
  const cast = prepareCreativeAgentTask({ templateId: 'cast-notes', brief: BRIEF });
  const one = singleSectionSchema(cast.decodingSchema, { note: { type: 'string', maxLength: 20 } });
  assert.deepEqual(checkConstrainedSchema(one), []);
  assert.equal(one.properties.sections.minItems, 1);
  assert.deepEqual(one.properties.sections.items.properties.heading.enum, ['Identity']);
  assert.ok(one.properties.sections.items.required.includes('note'));
  assert.ok(cast.decodingSchema.properties.sections.prefixItems, 'the task schema is not modified');
  const scene = singleSectionSchema(prepareCreativeAgentTask({ templateId: 'storyboard-builder', values: { scenes: 6 }, brief: BRIEF }).schema, { purpose: { type: 'string', enum: ['Open.'] } });
  assert.deepEqual(scene.properties.sections.items.properties.purpose.enum, ['Open.']);
  assert.equal(scene.properties.sections.maxItems, 1);
});

test('writingFormat: Ollama 0.5+ gets the schema, older servers JSON mode, WebLLM a response_format', () => {
  const task = prepareCreativeAgentTask({ templateId: 'style-brief', brief: BRIEF });
  assert.deepEqual(writingFormat(task, { provider: 'ollama', version: '0.12.3' }), { format: task.decodingSchema, decoding: 'schema' });
  assert.deepEqual(writingFormat(task, { provider: 'ollama', version: '0.5.0' }).decoding, 'schema');
  assert.deepEqual(writingFormat(task, { provider: 'ollama', version: '0.4.9' }), { format: 'json', decoding: 'json' });
  assert.deepEqual(writingFormat(task, { provider: 'ollama', version: null }), { format: 'json', decoding: 'json' });
  assert.equal(writingFormat(task, { provider: 'ollama', version: '1.0.0', fallback: true }).format, task.schema);
  const web = writingFormat(task, { provider: 'webllm' });
  assert.equal(web.response_format.type, 'json_object');
  assert.deepEqual(JSON.parse(web.response_format.schema), task.decodingSchema);
  assert.throws(() => writingFormat(task, { provider: 'cloud' }), TypeError);
  assert.throws(() => writingFormat({}, { provider: 'ollama' }), TypeError);
});

const MODEL = 'qwen3.5:0.8b';
function ollama(chat) {
  const calls = [];
  const fetchImpl = async (address, options) => {
    const path = new URL(address).pathname, body = options.body && JSON.parse(options.body);
    if (path === '/api/tags') return Response.json({ models: [{ name: MODEL, size: 1_300_000_000, details: { family: 'qwen', parameter_size: '0.8B' } }] });
    if (path === '/api/version') return Response.json({ version: '0.12.3' });
    if (path === '/api/show') return Response.json({ capabilities: ['completion'], model_info: { 'general.parameter_count': 800_000_000 } });
    calls.push(body);
    return chat(body, calls.length);
  };
  return { calls, fetchImpl };
}
const written = task => JSON.stringify(decode(task.decodingSchema, schema => schema.maxLength >> 1));

test('Ollama: the decoder schema is sent; a server that refuses to compile it gets the plain schema once', async () => {
  const task = prepareCreativeAgentTask({ templateId: 'story-seed', brief: BRIEF });
  const ok = ollama(() => Response.json({ model: MODEL, done: true, message: { content: written(task) } }));
  const result = await runCreativeAgent({ templateId: 'story-seed', brief: BRIEF, model: MODEL, fetchImpl: ok.fetchImpl });
  assert.equal(result.attempts, 1);
  assert.equal(result.decoding, 'schema');
  assert.deepEqual(ok.calls[0].format.properties.sections.prefixItems.map(item => item.properties.heading.enum[0]), HEADINGS['story-seed']);

  const refusing = ollama(body => body.format.properties.sections.prefixItems
    ? Response.json({ error: 'invalid JSON schema in format' }, { status: 500 })
    : Response.json({ model: MODEL, done: true, message: { content: written(task) } }));
  const fallback = await runCreativeAgent({ templateId: 'story-seed', brief: BRIEF, model: MODEL, fetchImpl: refusing.fetchImpl });
  assert.equal(fallback.attempts, 1);
  assert.equal(fallback.decoding, 'schema');
  assert.equal(refusing.calls.length, 2);
  assert.deepEqual(refusing.calls[1].format.properties.sections.items.properties.heading.enum, HEADINGS['story-seed']);

  // Any other server failure is not retried with another schema.
  const broken = ollama(() => Response.json({ error: 'model runner has unexpectedly stopped' }, { status: 500 }));
  await assert.rejects(runCreativeAgent({ templateId: 'story-seed', brief: BRIEF, model: MODEL, fetchImpl: broken.fetchImpl }), error => error instanceof AgentRuntimeError && error.code === 'unavailable');
  assert.equal(broken.calls.length, 1);
});

function webllm(create) {
  const requests = [];
  const session = { worker: { terminate() {} }, failure: new Promise(() => {}), engine: {
    async reload() {}, async resetChat() {}, interruptGenerate() {},
    chat: { completions: { async create(request) {
      requests.push(request);
      const text = await create(request, requests.length);
      return (async function* () { yield { model: BROWSER_AGENT_MODEL.id, choices: [{ delta: { content: text }, finish_reason: 'stop' }] }; })();
    } } } } };
  const runtime = createBrowserWritingRuntime({ support: async () => ({ provider: 'webllm', available: true, model: BROWSER_AGENT_MODEL }), createSession: async () => session, generationTimeoutMs: 2000 });
  return { runtime, requests };
}

test('WebLLM: the decoder schema is sent; a grammar the engine cannot compile falls back once without losing the session', async () => {
  const task = prepareCreativeAgentTask({ templateId: 'cast-notes', brief: BRIEF });
  const plain = webllm(() => written(task));
  await plain.runtime.load();
  const result = await plain.runtime.run({ templateId: 'cast-notes', brief: BRIEF });
  assert.equal(result.decoding, 'schema');
  assert.ok(JSON.parse(plain.requests[0].response_format.schema).properties.sections.prefixItems);

  const refusing = webllm(request => { if (JSON.parse(request.response_format.schema).properties.sections.prefixItems) throw new Error('Unsupported JSON schema'); return written(task); });
  await refusing.runtime.load();
  const fallback = await refusing.runtime.run({ templateId: 'cast-notes', brief: BRIEF });
  assert.equal(fallback.attempts, 1);
  assert.equal(refusing.requests.length, 2);
  assert.ok(JSON.parse(refusing.requests[1].response_format.schema).properties.sections.items);
  assert.equal((await refusing.runtime.status()).ready, true, 'the model stays loaded');
});
