import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserWritingRuntime, createBrowserAgentRuntime, BROWSER_AGENT_MODEL, BROWSER_AGENT_APP_CONFIG, BrowserAgentError } from '../src/browser-writing-runtime.mjs';
const getBrowserAgentStatus = () => createBrowserAgentRuntime({ createWorker: () => { throw new Error('No worker may be created during a capability check.'); }, loadEngine: () => { throw new Error('No model library may be imported during a capability check.'); } }).status();

const unavailable = { provider: 'webllm', available: false, model: BROWSER_AGENT_MODEL, reason: 'webgpu-unavailable', message: 'WebGPU unavailable.' };
const available = { provider: 'webllm', available: true, model: BROWSER_AGENT_MODEL };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const headings = {
  'cast-notes': ['Identity', 'Motivation', 'Strengths and limits', 'Character arc', 'Consistency notes'],
  'style-brief': ['Art direction', 'Palette', 'Line and material', 'Lighting', 'Composition', 'Things to avoid'],
  'story-seed': ['Premise', 'Cast', 'Setting', 'Chapter outline', 'Visual and production direction'],
};
function artifact(templateId = 'storyboard-builder', count = 3, artDirection) {
  return { title: 'The courier and the lost star', summary: 'A gentle courier and a lost star discover the safest path home by helping one another.',
    sections: (headings[templateId] || Array.from({ length: count }, (_, i) => `A new turn ${i + 1}`)).map((heading, i) => ({ heading,
      ...(templateId === 'storyboard-builder' ? {
        purpose: `Develop their friendship during beat ${i + 1}.`, action: 'The courier follows a bright clue and helps the star across the rooftop.',
        visual: 'Detailed expressive ink panels keep the two friends clear against the city.', framing: 'Start wide, then cut to their hands joining at the ledge.',
        dialogue: "The courier says, 'We will find the way together.'", sound: 'Soft bells and a warm breeze create a gentle atmosphere.',
      } : templateId === 'prompt-branches' ? {
        sharedPremise: 'A courier helps a lost star find its way home.', prompt: `Show the courier and the star exploring a new setting ${i + 1} while keeping their friendship and shared journey home.`,
        difference: `This direction changes the architecture in setting ${i + 1}, preserving the cast, problem and goal.`,
      } : { body: `Beat ${i + 1}: The courier chooses to help the star. Use expressive manga ink panels, a gentle camera move, warm dialogue and quiet bells to make the action clear.` }),
      ...(artDirection && !headings[templateId] ? { artDirection } : {}),
    })) };
}
function fakeRuntime({ outputs = [artifact()], support = available, createSession, stream, reload } = {}) {
  const calls = [], failure = deferred();
  void failure.promise.catch(() => undefined);
  let index = 0, terminated = 0, interrupted = 0, creations = 0;
  const session = {
    worker: { terminate() { terminated++; } }, failure: failure.promise,
    engine: {
      async reload(model) { calls.push({ kind: 'reload', model }); if (reload) await reload(); },
      async resetChat() { calls.push({ kind: 'reset' }); },
      interruptGenerate() { interrupted++; },
      chat: { completions: { async create(request) {
        calls.push({ kind: 'chat', request });
        if (stream) return stream(request);
        const result = outputs[Math.min(index++, outputs.length - 1)];
        return (async function* () {
          const text = typeof result === 'string' ? result : JSON.stringify(result);
          yield { model: BROWSER_AGENT_MODEL.id, choices: [{ delta: { content: text.slice(0, 100) }, finish_reason: null }] };
          yield { model: BROWSER_AGENT_MODEL.id, choices: [{ delta: { content: text.slice(100) }, finish_reason: 'stop' }] };
        })();
      } } },
    },
  };
  const runtime = createBrowserWritingRuntime({ support: async () => support,
    createSession: async callback => { creations++; callback({ stage: 'download', message: 'Loading public weights.', progress: .5 }); return createSession ? await createSession(session) : session; },
    downloadTimeoutMs: 200, generationTimeoutMs: 200,
  });
  return { runtime, calls, failure, session, get terminated() { return terminated; }, get interrupted() { return interrupted; }, get creations() { return creations; } };
}
const input = extra => ({ templateId: 'storyboard-builder', values: { scenes: 3 }, brief: 'A gentle illustrated adventure.', ...extra });
const code = value => error => error instanceof BrowserAgentError && error.code === value;

test('capability checks and run-before-download cannot trigger model download or server inference', async () => {
  const fake = fakeRuntime({ support: unavailable });
  assert.equal((await fake.runtime.status()).available, false);
  assert.equal((await getBrowserAgentStatus()).ready, false, 'A Node environment is not browser AI.');
  await assert.rejects(fake.runtime.load(), code('unsupported'));
  await assert.rejects(fake.runtime.run(input()), code('not-ready'));
  assert.equal(fake.creations, 0);
  assert.deepEqual(fake.calls, []);
});

test('the model download is one reviewed immutable record with strict integrity checks', () => {
  assert.equal(BROWSER_AGENT_APP_CONFIG.model_list.length, 1);
  const record = BROWSER_AGENT_APP_CONFIG.model_list[0];
  assert.equal(record.model_id, BROWSER_AGENT_MODEL.id);
  assert.match(record.model, /\/resolve\/[a-f0-9]{40}\/$/);
  assert.match(record.model_lib, /githubusercontent\.com\/mlc-ai\/binary-mlc-llm-libs\/[a-f0-9]{40}\//);
  assert.equal(record.integrity.onFailure, 'error');
  for (const hash of [record.integrity.config, record.integrity.model_lib, ...Object.values(record.integrity.tokenizer)]) assert.match(hash, /^sha256-[A-Za-z0-9+/]{43}=$/);
  assert.equal(record.overrides.max_history_size, 1);
  assert.equal(record.overrides.context_window_size, 4096);
});

test('an explicit download reports progress and is reused for finished writing on the same device', async () => {
  const fake = fakeRuntime(), progress = [];
  await fake.runtime.load({ onProgress: event => progress.push(event.stage) });
  assert.equal((await fake.runtime.status()).ready, true);
  await fake.runtime.load();
  assert.equal(fake.creations, 1);
  assert.deepEqual(progress, ['download', 'download', 'ready']);
  const result = await fake.runtime.run(input());
  assert.equal(result.provider, 'webllm');
  assert.equal(result.model, BROWSER_AGENT_MODEL.id);
  assert.equal(result.attempts, 1);
  assert.equal(result.sections.length, 3);
  assert.match(result.sections[0].body, /Purpose:.*\nAction:.*\nVisual:.*\nFraming:.*\nDialogue:.*\nSound:/);
  assert.match(result.studioPrompt, /A gentle illustrated adventure/);
  const request = fake.calls.find(call => call.kind === 'chat').request;
  assert.equal(request.stream, true);
  assert.equal(request.extra_body.enable_thinking, false);
  assert.equal(request.response_format.type, 'json_object');
  assert.equal(JSON.parse(request.response_format.schema).properties.sections.minItems, 3);
});

test('all five browser writers use the real task-specific output validation', async () => {
  for (const templateId of ['cast-notes', 'style-brief', 'story-seed', 'storyboard-builder', 'prompt-branches']) {
    const count = headings[templateId]?.length || 3;
    const fake = fakeRuntime({ outputs: [artifact(templateId, count)] });
    await fake.runtime.load();
    const result = await fake.runtime.run(input({ templateId, values: templateId === 'prompt-branches' ? { branches: 3 } : templateId === 'storyboard-builder' ? { scenes: 3 } : {} }));
    assert.equal(result.sections.length, count, templateId);
    if (headings[templateId]) assert.deepEqual(result.sections.map(section => section.heading), headings[templateId]);
    assert.equal(result.provider, 'webllm');
  }
});

test('WebLLM non-thinking envelopes are normalized without accepting commentary or reasoning', async () => {
  const valid = JSON.stringify(artifact());
  const wrapped = fakeRuntime({outputs: ['<think>\n\n</think>\n\n' + valid]});
  await wrapped.runtime.load();
  const result = await wrapped.runtime.run(input());
  assert.equal(result.attempts, 1);
  assert.equal(result.sections.length, 3);
  assert.equal(result.studioPrompt.includes('<think>'), false);
  for (const content of ['<think>unfinished ' + valid, '<think>Reasoning content</think>' + valid, 'Here is the artifact: ' + valid]) {
    const rejected = fakeRuntime({outputs: [content]});
    await rejected.runtime.load();
    await assert.rejects(rejected.runtime.run(input()), code('invalid-response'));
    assert.equal(rejected.calls.filter(call => call.kind === 'chat').length, 2);
  }
});

test('long storyboards write distinct bounded scenes with local continuity before validating the combined artifact', async()=> {
  const scenes = artifact('storyboard-builder',6,'Manga');
  const fake = fakeRuntime({stream: async request => {
    const number = Number(request.messages.at(-1).content.match(/Scene (\d+) of 6/)[1]);
    assert.equal(JSON.parse(request.response_format.schema).properties.sections.maxItems,1);
    assert.equal(request.max_tokens,1000);
    if(number>1)assert.match(request.messages.at(-1).content,/Previous action/);
    const part = {...scenes,sections:[{...scenes.sections[number-1],action:`In beat ${number}, the courier and star follow their plan across rooftop ${number}, keeping manga ink silhouettes clear.`}]};
    return (async function*(){yield {model:BROWSER_AGENT_MODEL.id,choices:[{delta:{content:'<think>\n\n</think>\n\n'+JSON.stringify(part)},finish_reason:'stop'}]};})();
  }});
  await fake.runtime.load();
  const result = await fake.runtime.run(input({values:{scenes:6},brief:'A manga courier and lost star return home.'}));
  assert.equal(result.sections.length,6);
  assert.equal(result.attempts,1);
  assert.equal(fake.calls.filter(call=>call.kind==='chat').length,6);
  assert.equal(new Set(result.sections.map(section=>section.body)).size,6);
  assert.ok(result.sections.every(section=>section.body.includes('Visual: Manga.')));
});

test('invalid output repairs only once; requested manga direction survives into actual scene writing', async () => {
  const fake = fakeRuntime({ outputs: [artifact(), artifact('storyboard-builder', 3, 'Manga')] }), progress = [];
  await fake.runtime.load();
  const result = await fake.runtime.run(input({ brief: 'A manga courier adventure.', onProgress: event => progress.push(event.stage) }));
  assert.equal(result.attempts, 2);
  assert.ok(result.sections.every(section => section.body.includes('Visual: Manga')));
  assert.equal(progress.filter(stage => stage === 'repair').length, 1);
  const calls = fake.calls.filter(call => call.kind === 'chat');
  assert.equal(calls.length, 2);
  assert.match(calls[1].request.messages.at(-1).content, /Validation issues:/);
  const invalid = fakeRuntime({ outputs: ['not JSON'] });
  await invalid.runtime.load();
  await assert.rejects(invalid.runtime.run(input()), code('invalid-response'));
  assert.equal(invalid.calls.filter(call => call.kind === 'chat').length, 2);
});

test('truncated completion is rejected even when its text parses, and a wrong model cannot be accepted', async () => {
  let attempt = 0;
  const fake = fakeRuntime({ stream: async () => (async function* () {
    yield { model: BROWSER_AGENT_MODEL.id, choices: [{ delta: { content: JSON.stringify(artifact()) }, finish_reason: ++attempt === 1 ? 'length' : 'stop' }] };
  })() });
  await fake.runtime.load();
  assert.equal((await fake.runtime.run(input())).attempts, 2);
  const wrong = fakeRuntime({ stream: async () => (async function* () { yield { model: 'unknown-model', choices: [{ delta: { content: '{}' }, finish_reason: 'stop' }] }; })() });
  await wrong.runtime.load();
  await assert.rejects(wrong.runtime.run(input()), code('invalid-response'));
});

test('aborting generation terminates its worker and suppresses late output', async () => {
  const waiting = deferred(), controller = new AbortController();
  const fake = fakeRuntime({ stream: async () => (async function* () { await waiting.promise; yield { choices: [{ delta: { content: JSON.stringify(artifact()) }, finish_reason: 'stop' }] }; })() });
  await fake.runtime.load();
  const result = fake.runtime.run(input({ signal: controller.signal }));
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(result, error => error.name === 'AbortError');
  assert.equal(fake.terminated, 1);
  assert.equal(fake.interrupted, 1);
  assert.equal((await fake.runtime.status()).ready, false);
  waiting.resolve();
  await new Promise(resolve => setImmediate(resolve));
});

test('cancelling before worker creation finishes cannot attach a stale worker to a newer load', async () => {
  const waiting = deferred();
  let first = true;
  const fake = fakeRuntime({ createSession: async session => { if (first) { first = false; await waiting.promise; } return session; } });
  const old = fake.runtime.load();
  await new Promise(resolve => setImmediate(resolve));
  fake.runtime.cancel();
  await assert.rejects(old, error => error.name === 'AbortError');
  await fake.runtime.load();
  waiting.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fake.terminated, 1, 'The late worker is discarded.');
  assert.equal(fake.calls.filter(call => call.kind === 'reload').length, 1, 'The stale worker must not reload the model.');
  assert.equal((await fake.runtime.status()).ready, true);
});

test('concurrent load/run requests are refused and timeout stops GPU computation', async () => {
  const waiting = deferred(), fake = fakeRuntime({ reload: () => waiting.promise });
  const loading = fake.runtime.load();
  await assert.rejects(fake.runtime.load(), code('busy'));
  await assert.rejects(fake.runtime.run(input()), code('busy'));
  await assert.rejects(loading, code('timeout'));
  assert.equal(fake.terminated, 1);
  assert.equal((await fake.runtime.status()).ready, false);
  waiting.resolve();
});

test('worker failure during generation rejects immediately without backend or cloud fallback', async () => {
  const waiting = deferred(), fake = fakeRuntime({ stream: async () => (async function* () { await waiting.promise; })() });
  await fake.runtime.load();
  const result = fake.runtime.run(input());
  await new Promise(resolve => setImmediate(resolve));
  fake.failure.reject(new BrowserAgentError('generation-failed', 'Worker stopped.'));
  await assert.rejects(result, code('generation-failed'));
  assert.equal((await fake.runtime.status()).ready, false);
  assert.equal(fake.terminated, 1);
  waiting.resolve();
});
