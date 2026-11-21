import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareCreativeAgentTask } from '../src/agent-runtime.mjs';
import { BrowserAgentError } from '../src/browser-writing-runtime.mjs';
import { BUILTIN_AGENT_MODEL, builtinSupport, createBuiltinAgentRuntime, createBuiltinWritingRuntime } from '../src/builtin-writing-runtime.mjs';
import { writingFormat } from '../src/writing-schema.mjs';

const headings = {
  'cast-notes': ['Identity', 'Motivation', 'Strengths and limits', 'Character arc', 'Consistency notes'],
  'style-brief': ['Art direction', 'Palette', 'Line and material', 'Lighting', 'Composition', 'Things to avoid'],
  'story-seed': ['Premise', 'Cast', 'Setting', 'Chapter outline', 'Visual and production direction'],
};
const scene = i => ({ heading: `A new turn ${i + 1}`, purpose: `Develop their friendship during beat ${i + 1}.`, action: `The courier follows bright clue ${i + 1} and helps the star across the rooftop.`,
  visual: 'Detailed expressive ink panels keep the two friends clear against the city.', framing: 'Start wide, then cut to their hands joining at the ledge.',
  dialogue: "The courier says, 'We will find the way together.'", sound: 'Soft bells and a warm breeze create a gentle atmosphere.' });
function artifact(templateId = 'storyboard-builder', count = 3) {
  return { title: 'The courier and the lost star', summary: 'A gentle courier and a lost star discover the safest path home by helping one another.',
    sections: (headings[templateId] || Array.from({ length: count }, (_, i) => `A new turn ${i + 1}`)).map((heading, i) => templateId === 'storyboard-builder' ? scene(i)
      : { heading, body: `Beat ${i + 1}: The courier chooses to help the star. Use expressive manga ink panels, a gentle camera move, warm dialogue and quiet bells to make the action clear.` }) };
}
const named = (name, message = name) => Object.assign(new Error(message), { name });
/** A stand-in for the browser's `LanguageModel`: records every call, streams each output in two pieces. */
function fakeModel({ states = {}, state = 'available', outputs = [artifact()], create, stream, download = [] } = {}) {
  const calls = { availability: [], create: [], prompt: [], destroyed: 0 };
  let index = 0;
  const api = {
    async availability(options) { calls.availability.push(options); const language = options.expectedOutputs[0].languages[0]; return states[language] ?? state; },
    async create(options) {
      calls.create.push(options);
      if (create) await create(options);
      if (options.monitor) { const target = new EventTarget(); options.monitor(target); for (const loaded of download) target.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded, total: 1 })); }
      return { destroy() { calls.destroyed++; }, promptStreaming(input, promptOptions) {
        calls.prompt.push({ input, options: promptOptions });
        if (stream) return stream(input, promptOptions, calls.prompt.length);
        const result = outputs[Math.min(index++, outputs.length - 1)], text = typeof result === 'string' ? result : JSON.stringify(result);
        return (async function* () { yield text.slice(0, 80); yield text.slice(80); })();
      } };
    },
  };
  return { api, calls, runtime: createBuiltinWritingRuntime({ languageModel: api, downloadTimeoutMs: 200, generationTimeoutMs: 200 }) };
}
const input = extra => ({ templateId: 'storyboard-builder', values: { scenes: 3 }, brief: 'A gentle illustrated adventure.', ...extra });
const code = value => error => error instanceof BrowserAgentError && error.code === value;
const abortError = error => error.name === 'AbortError';

test('a capability check asks the browser only and names why writing is unavailable', async () => {
  assert.deepEqual(await builtinSupport({ languageModel: null }).then(({ available, reason, state, provider }) => ({ available, reason, state, provider })),
    { available: false, reason: 'api-unavailable', state: 'unavailable', provider: 'builtin' }, 'Node has no LanguageModel.');
  assert.equal((await createBuiltinAgentRuntime().status()).ready, false);
  const ready = fakeModel();
  const status = await ready.runtime.status({ language: 'ja-JP' });
  assert.deepEqual({ available: status.available, ready: status.ready, loading: status.loading, state: status.state, language: status.language, model: status.model },
    { available: true, ready: true, loading: false, state: 'available', language: 'ja', model: BUILTIN_AGENT_MODEL });
  assert.deepEqual(ready.calls.availability[0], { expectedInputs: [{ type: 'text', languages: ['en', 'ja'] }], expectedOutputs: [{ type: 'text', languages: ['ja'] }] });
  const vietnamese = fakeModel({ states: { vi: 'unavailable' } });
  assert.equal((await vietnamese.runtime.status({ language: 'vi' })).reason, 'language-unsupported');
  assert.equal((await fakeModel({ state: 'unavailable' }).runtime.status()).reason, 'device-unsupported');
  assert.equal((await fakeModel({ state: 'readily' }).runtime.status()).available, false, 'Unknown states from older browsers are not trusted.');
  const downloading = await fakeModel({ state: 'downloading' }).runtime.status();
  assert.deepEqual([downloading.available, downloading.ready, downloading.loading], [true, false, true]);
  assert.equal((await builtinSupport({ languageModel: { create() {}, availability: async () => { throw new Error('blocked by policy'); } } })).available, false);
  const silent = createBuiltinWritingRuntime({ languageModel: { create() { throw new Error('No session during a check.'); }, availability: () => new Promise(() => undefined) }, statusTimeoutMs: 20 });
  assert.deepEqual(await silent.status().then(({ available, reason }) => [available, reason]), [false, 'timeout'], 'A browser that never answers cannot hang a workspace.');
  await assert.rejects(silent.run(input()), code('unsupported'));
  await assert.rejects(silent.load(), code('unsupported'), 'The runtime is not left busy.');
  for (const fake of [ready, vietnamese]) assert.equal(fake.calls.create.length, 0, 'A check never creates a session, so it cannot start a download.');
});

test('load is instant when the browser has its model and reports the browser download otherwise', async () => {
  const ready = fakeModel(), seen = [];
  await ready.runtime.load({ onProgress: value => seen.push(value.stage) });
  assert.deepEqual([seen, ready.calls.create.length], [['ready'], 0]);

  const fresh = fakeModel({ state: 'downloadable', download: [.25, .5, 1] }), progress = [];
  await fresh.runtime.load({ language: 'es', onProgress: value => progress.push([value.stage, value.progress]) });
  assert.deepEqual(progress, [['download', 0], ['download', .25], ['download', .5], ['download', 1], ['ready', 1]]);
  assert.deepEqual(fresh.calls.create[0].expectedOutputs, [{ type: 'text', languages: ['es'] }]);
  assert.ok(fresh.calls.create[0].signal instanceof AbortSignal);
  assert.equal(fresh.calls.destroyed, 1, 'The session that triggered the download is released.');

  await assert.rejects(fakeModel({ state: 'unavailable' }).runtime.load(), code('unsupported'));
  await assert.rejects(fakeModel({ state: 'downloadable', create: async () => { throw named('NotAllowedError'); } }).runtime.load(),
    error => code('download-failed')(error) && /click/.test(error.message));
  await assert.rejects(fakeModel({ state: 'downloadable', create: async () => { throw new Error('disk full'); } }).runtime.load(), code('download-failed'));
  const slow = fakeModel({ state: 'downloadable', create: () => new Promise(() => undefined) });
  await assert.rejects(slow.runtime.load(), code('timeout'));
  const controller = new AbortController(), stopped = fakeModel({ state: 'downloadable', create: () => new Promise(() => undefined) });
  const pending = stopped.runtime.load({ signal: controller.signal });
  await assert.rejects(stopped.runtime.load(), code('busy'));
  controller.abort();
  await assert.rejects(pending, abortError);
  await assert.rejects(stopped.runtime.run(input()), code('not-ready'), 'A stopped load leaves the runtime usable and still not ready.');
});

test('a draft is decoded against the per-position schema in a fresh session with the task as system prompt', async () => {
  const fake = fakeModel({ outputs: [artifact('cast-notes')] }), stages = [];
  const result = await fake.runtime.run({ templateId: 'cast-notes', brief: 'A courier and a lost star.', language: 'fr-CA', onProgress: value => stages.push(value.stage) });
  assert.deepEqual([result.provider, result.model, result.templateId, result.attempts, result.decoding], ['builtin', 'browser-built-in', 'cast-notes', 1, 'schema']);
  assert.deepEqual(result.sections.map(section => section.heading), headings['cast-notes']);
  assert.ok(result.studioPrompt.length > 0);
  const [created] = fake.calls.create, [prompted] = fake.calls.prompt;
  assert.equal(created.initialPrompts.length, 1);
  assert.equal(created.initialPrompts[0].role, 'system');
  assert.match(created.initialPrompts[0].content, /Use these headings in this order: Identity; Motivation/);
  assert.deepEqual(created.expectedOutputs, [{ type: 'text', languages: ['fr'] }]);
  assert.equal(created.monitor, undefined, 'A run never asks for a download.');
  assert.match(prompted.input, /A courier and a lost star\./);
  const task = prepareCreativeAgentTask({ templateId: 'cast-notes', brief: 'A courier and a lost star.' });
  assert.deepEqual(prompted.options.responseConstraint, task.decodingSchema);
  assert.equal(prompted.options.responseConstraint.properties.sections.prefixItems.length, 5);
  assert.equal(prompted.options.omitResponseConstraintInput, true, 'The schema is not repeated inside the small context window.');
  assert.ok(prompted.options.signal instanceof AbortSignal && !('decoding' in prompted.options));
  assert.equal(fake.calls.destroyed, 1);
  assert.deepEqual(stages, ['plan', 'generate', 'generate', 'validate']);
  assert.deepEqual(writingFormat(task, { provider: 'builtin' }), { responseConstraint: task.decodingSchema, omitResponseConstraintInput: true, decoding: 'schema' });
  assert.equal(writingFormat(task, { provider: 'builtin', fallback: true }).responseConstraint, task.schema);
});

test('an invalid first draft is repaired once in a new session, then reported honestly', async () => {
  const fake = fakeModel({ outputs: ['{"title":"Only a title"}', artifact()] }), stages = [];
  const result = await fake.runtime.run(input({ onProgress: value => stages.push(value.stage) }));
  assert.equal(result.attempts, 2);
  assert.equal(fake.calls.create.length, 2);
  assert.equal(fake.calls.destroyed, 2);
  assert.match(fake.calls.prompt[1].input, /Write the corrected artifact from the original brief\. Validation issues:/);
  assert.ok(stages.includes('repair'));
  const stuck = fakeModel({ outputs: ['not json'] });
  await assert.rejects(stuck.runtime.run(input()), error => code('invalid-response')(error) && /after one repair/.test(error.message));
  assert.equal(stuck.calls.prompt.length, 2, 'Exactly one repair.');
  await stuck.runtime.run(input()).catch(() => undefined);
  assert.equal(stuck.calls.destroyed, stuck.calls.create.length, 'Every session is released, also after failures.');
});

test('a browser that refuses the per-position schema gets the plain one once; a failure mid-draft is not retried', async () => {
  const refusing = fakeModel({ stream(inputText, options) {
    if (options.responseConstraint.properties.sections.prefixItems) throw named('NotSupportedError', 'Unsupported schema keyword.');
    const text = JSON.stringify(artifact('style-brief'));
    return (async function* () { yield text; })();
  } });
  const result = await refusing.runtime.run({ templateId: 'style-brief', brief: 'Ink and moonlight.' });
  assert.deepEqual([result.attempts, result.decoding, refusing.calls.prompt.length, refusing.calls.create.length], [1, 'schema', 2, 1]);
  assert.ok(refusing.calls.prompt[1].options.responseConstraint.properties.sections.items, 'The retry uses the plain list schema.');

  const broken = fakeModel({ stream: () => (async function* () { yield '{"title":'; throw new Error('GPU lost'); })() });
  await assert.rejects(broken.runtime.run({ templateId: 'style-brief', brief: 'Ink and moonlight.' }), error => code('generation-failed')(error) && /No server fallback/.test(error.message));
  assert.equal(broken.calls.prompt.length, 1);
  const full = fakeModel({ stream: () => { throw named('QuotaExceededError'); } });
  await assert.rejects(full.runtime.run({ templateId: 'style-brief', brief: 'Ink and moonlight.' }), error => code('invalid-input')(error) && /too long/.test(error.message));
  assert.equal(full.calls.prompt.length, 1, 'A context overflow is not mistaken for a schema refusal.');
});

test('long storyboards are written one scene per session with continuity, then validated together', async () => {
  const fake = fakeModel({ stream(inputText, options, call) {
    const text = JSON.stringify({ title: 'The courier and the lost star', summary: 'A gentle courier and a lost star discover the safest path home by helping one another.', sections: [scene(call - 1)] });
    return (async function* () { yield text.slice(0, 50); yield text.slice(50); })();
  } });
  const result = await fake.runtime.run(input({ values: { scenes: 6 } }));
  assert.equal(result.sections.length, 6);
  assert.deepEqual([fake.calls.create.length, fake.calls.destroyed, result.attempts], [6, 6, 1]);
  for (const [index, call] of fake.calls.prompt.entries()) {
    const sections = call.options.responseConstraint.properties.sections;
    assert.deepEqual([sections.minItems, sections.maxItems], [1, 1]);
    assert.equal(sections.items.properties.purpose.enum.length, 1);
    assert.match(call.input, new RegExp(`Now write only Scene ${index + 1} of 6`));
  }
  assert.match(fake.calls.prompt[0].input, /This is the opening/);
  assert.match(fake.calls.prompt[2].input, /Previous action 2: The courier follows bright clue 2/);
});

test('whole-text streams and reader-only streams produce the same draft', async () => {
  const text = JSON.stringify(artifact());
  const cumulative = fakeModel({ stream: () => (async function* () { yield text.slice(0, 40); yield text.slice(0, 300); yield text; })() });
  assert.equal((await cumulative.runtime.run(input())).sections.length, 3);
  const readerOnly = fakeModel({ stream: () => { const parts = [text.slice(0, 120), text.slice(120)]; return { getReader: () => ({ read: async () => parts.length ? { done: false, value: parts.shift() } : { done: true }, releaseLock() {} }) }; } });
  assert.equal((await readerOnly.runtime.run(input())).title, 'The courier and the lost star');
  const promised = fakeModel({ stream: async () => new ReadableStream({ start(controller) { controller.enqueue(text); controller.close(); } }) });
  assert.equal((await promised.runtime.run(input())).attempts, 1);
});

test('stop, timeout, busy and oversized briefs fail clearly and release the session', async () => {
  const hang = () => (async function* () { yield '{"title":"The'; await new Promise(() => undefined); })();
  const stopped = fakeModel({ stream: hang });
  const pending = stopped.runtime.run(input());
  await new Promise(resolve => setTimeout(resolve, 10));
  await assert.rejects(stopped.runtime.run(input()), code('busy'));
  stopped.runtime.cancel();
  await assert.rejects(pending, abortError);
  assert.ok(stopped.calls.prompt[0].options.signal.aborted, 'The browser is told to stop generating.');
  assert.equal((await fakeModel().runtime.run(input())).attempts, 1);
  stopped.runtime.unload();
  const again = stopped.runtime.run(input()), controller = new AbortController();
  await new Promise(resolve => setTimeout(resolve, 10));
  stopped.runtime.cancel();
  await assert.rejects(again, abortError, 'The runtime is reusable after a stop.');
  controller.abort();
  await assert.rejects(fakeModel().runtime.run(input({ signal: controller.signal })), abortError);

  await assert.rejects(fakeModel({ stream: hang }).runtime.run(input()), code('timeout'));
  await assert.rejects(fakeModel().runtime.run(input({ brief: 'x'.repeat(2001) })), code('invalid-input'));
  await assert.rejects(fakeModel({ state: 'downloadable' }).runtime.run(input()), code('not-ready'));
  await assert.rejects(fakeModel({ state: 'unavailable' }).runtime.run(input()), code('unsupported'));
  await assert.rejects(fakeModel({ stream: () => (async function* () { yield 'x'.repeat(24001); })() }).runtime.run(input()), code('invalid-response'));
  const untouched = fakeModel();
  await assert.rejects(untouched.runtime.run({ templateId: 'photo-finish', brief: 'Not a writing agent.' }));
  assert.equal(untouched.calls.create.length, 0, 'Only the five writing contracts reach the model.');
});
