import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRuntimeError, getLocalModelStatus, runCreativeAgent, prepareCreativeAgentTask, validateCreativeAgentOutput, LOCAL_AGENT_LIMITS } from '../src/agent-runtime.mjs';

const MODEL = 'qwen3.5:0.8b';
const localModel = (name = MODEL, size = 1_300_000_000) => ({ name, size, details: { family: 'qwen', parameter_size: '0.8B' } });
const fields = {
    'cast-notes': ['Identity', 'Motivation', 'Strengths and limits', 'Character arc', 'Consistency notes'],
    'style-brief': ['Art direction', 'Palette', 'Line and material', 'Lighting', 'Composition', 'Things to avoid'],
    'story-seed': ['Premise', 'Cast', 'Setting', 'Chapter outline', 'Visual and production direction'],
};
function artifact(templateId = 'storyboard-builder', count = 3, stylePrefix = '') {
    const headings = fields[templateId] || Array.from({ length: count }, (_, index) => `${templateId === 'storyboard-builder' ? 'Scene' : 'Direction'} ${index + 1} — A new turn`);
    return {
        title: 'The courier and the lost star',
        summary: 'A curious courier learns that the safest path home is sometimes the one shared with a friend.',
        sections: headings.map((heading, index) => ({ heading, ...(templateId === 'storyboard-builder'
            ? { purpose: `Establish the courier and star's friendship in beat ${index + 1}.`, action: ['The courier discovers a fallen star beside the post office.', 'The friends follow a glowing trail toward the clouds.', 'They find a gap where the cloud bridge has broken.', 'The courier folds the spare parcel paper into a kite.', 'Both friends cross the gap together beneath the kite.', 'The star returns to its constellation and waves goodbye.'][index % 6], visual: 'Use clear ink silhouettes and expressive panel composition.', framing: 'Show both friends in a wide rooftop panel before a close-up.', dialogue: "The courier says, 'We can find the way together.'", sound: 'Quiet bells and gentle wind support the warm scene.' }
            : templateId === 'prompt-branches'
                ? { sharedPremise: 'A courier helps a lost star find its way home.', prompt: `Show the courier and the lost star exploring setting ${index + 1}, preserving their friendship and shared journey home.`, difference: `Direction ${index + 1} changes the location's architecture and lighting while keeping the cast and goal.` }
                : { body: `Beat ${index + 1}: The courier notices a new clue and chooses to help the lost star. Use a clear ink silhouette, a gentle camera move, warm dialogue and quiet bells to keep the action readable.` }),
            ...(!fields[templateId] && stylePrefix ? { artDirection: stylePrefix } : {}) })),
    };
}
function provider({ outputs = [artifact()], models = [localModel()], version = '0.40.0', show = { capabilities: ['completion', 'thinking'], model_info: { 'general.parameter_count': 800_000_000 } }, chat, tags } = {}) {
    const calls = [];
    let index = 0;
    const fetchImpl = async (address, options) => {
        calls.push({ address, options, body: options.body && JSON.parse(options.body) });
        assert.equal(options.redirect, 'error');
        const path = new URL(address).pathname;
        if (path === '/api/tags') return tags?.() || Response.json({ models });
        if (path === '/api/version') return Response.json({ version });
        if (path === '/api/show') return Response.json(show);
        assert.equal(path, '/api/chat');
        if (chat) return chat(options);
        const output = outputs[Math.min(index++, outputs.length - 1)];
        return Response.json({ model: MODEL, done: true, message: { role: 'assistant', content: typeof output === 'string' ? output : JSON.stringify(output) } });
    };
    return { calls, fetchImpl };
}
const input = (extra = {}) => ({ templateId: 'storyboard-builder', values: { scenes: 3, form: 'comic chapter' }, brief: 'A tiny courier helps a lost star find its way home.', model: MODEL, ...extra });
const errorCode = code => error => error instanceof AgentRuntimeError && error.code === code;

test('pure browser writing contracts reuse the same schema, validation and production handoff without network', () => {
    const task = prepareCreativeAgentTask({ templateId: 'storyboard-builder', values: { scenes: 3 }, brief: 'A gentle manga courier adventure.' });
    assert.equal(task.sectionCount, 3);
    assert.deepEqual(task.schema.properties.sections.items.properties.artDirection.enum, ['Manga']);
    assert.equal(validateCreativeAgentOutput(task, 'not json').success, false);
    const result = validateCreativeAgentOutput(task, JSON.stringify(artifact('storyboard-builder', 3, 'Manga')));
    assert.equal(result.success, true);
    assert.match(result.artifact.sections[0].body, /Visual: Manga/);
    assert.match(result.artifact.studioPrompt, /A gentle manga courier adventure/);
    assert.ok(result.artifact.studioPrompt.length <= 12000);
    assert.throws(() => validateCreativeAgentOutput({ ...task }, '{}'), errorCode('invalid-input'));
});

test('finished writing rejects instruction echoes and repeated sentence filler', () => {
    const task = prepareCreativeAgentTask({templateId:'style-brief',brief:'A manga adventure.'});
    const content = artifact('style-brief');
    content.sections[0].body = 'Manga panels must be drawn with expressive ink. Each section must be explicitly named and described in section 1.';
    let checked = validateCreativeAgentOutput(task,JSON.stringify(content));
    assert.equal(checked.success,false);
    assert.ok(checked.errors.some(error=>error.includes('echoes formatting instructions')));
    content.sections[0].body = Array(5).fill('Manga linework uses crisp blacks and expressive eye shapes.').join(' ');
    checked = validateCreativeAgentOutput(task,JSON.stringify(content));
    assert.equal(checked.success,false);
    assert.ok(checked.errors.some(error=>error.includes('repeats sentences')));
    content.sections[0].body = 'Manga panels contrast crisp blacks with broad pale skies. Sharp eye shapes and varied panel gutters clarify the emotional arc.';
    assert.equal(validateCreativeAgentOutput(task,JSON.stringify(content)).success,true);
});

test('a long storyboard cannot pass by changing the camera while repeating one action',()=>{
    const task = prepareCreativeAgentTask({templateId:'storyboard-builder',values:{scenes:6}});
    const story = artifact('storyboard-builder',6);
    story.sections.forEach(section=>section.action='The courier carries the star through the same foggy cloud island.');
    const checked = validateCreativeAgentOutput(task,JSON.stringify(story));
    assert.equal(checked.success,false);
    assert.ok(checked.errors.some(error=>error.includes('repeat the same action')));
});

test('branch prompts cannot hide a duplicate behind a generic adjective and different labels',()=>{
    const task=prepareCreativeAgentTask({templateId:'prompt-branches',values:{branches:3}});
    const directions=artifact('prompt-branches',3);
    directions.sections[0].prompt='A dynamic view of a courier and a star crossing a cloudy bridge to return home.';
    directions.sections[2].prompt='A view of a courier and a star crossing a cloudy bridge to return home.';
    const checked=validateCreativeAgentOutput(task,JSON.stringify(directions));
    assert.equal(checked.success,false);
    assert.ok(checked.errors.some(error=>error.includes('repeat the same prompt')));
});

test('status lists only installed local completion models within the memory budget', async () => {
    const fake = provider({ models: [localModel(), localModel('qwen3.5:2b', 1_900_000_000), localModel(),
        localModel('qwen3.5:cloud'), localModel('nomic-embed-text:latest'), localModel('huge:latest', 9 * 1024 ** 3),
        { ...localModel('remote-alias:latest'), remote_host: 'https://ollama.com' }, localModel('empty:latest', 0), localModel('../../unsafe')] });
    const status = await getLocalModelStatus({ fetchImpl: fake.fetchImpl, baseUrl: 'http://127.0.0.1:11435/' });
    assert.equal(status.available, true);
    assert.equal(status.provider, 'ollama');
    assert.equal(status.baseUrl, 'http://127.0.0.1:11435');
    assert.deepEqual(status.models.map(model => model.name), [MODEL, 'qwen3.5:2b']);
    assert.equal(status.suggestedModel, 'qwen3.5:2b');
    assert.equal(status.version, '0.40.0');
    assert.ok(fake.calls.every(call => call.address.startsWith('http://127.0.0.1:11435/api/')));
});

test('host environment configuration is local-only and explicit SDK endpoints take precedence', async () => {
    const previous = process.env.OPTIMAI_OLLAMA_URL;
    try {
        process.env.OPTIMAI_OLLAMA_URL = 'http://127.0.0.1:11435';
        const fake = provider();
        assert.equal((await getLocalModelStatus({ fetchImpl: fake.fetchImpl })).baseUrl, 'http://127.0.0.1:11435');
        assert.equal((await getLocalModelStatus({ fetchImpl: fake.fetchImpl, baseUrl: 'http://127.0.0.1:11434' })).baseUrl, 'http://127.0.0.1:11434');
        process.env.OPTIMAI_OLLAMA_URL = 'https://remote.example';
        await assert.rejects(getLocalModelStatus({ fetchImpl: fake.fetchImpl }), errorCode('unsafe-endpoint'));
        assert.equal((await getLocalModelStatus({ fetchImpl: fake.fetchImpl, baseUrl: 'http://[::1]:11435' })).baseUrl, 'http://[::1]:11435');
    } finally {
        if (previous === undefined) delete process.env.OPTIMAI_OLLAMA_URL;
        else process.env.OPTIMAI_OLLAMA_URL = previous;
    }
});

test('the real pipeline plans, generates and validates a finished artifact with preserved creative input', async () => {
    const writing = artifact('storyboard-builder', 3, 'Manga');
    writing.sections.forEach(section => { section.action += ' Naruto and Sasuke face each other through manga ink panels while retaining the requested rivalry.'; });
    const fake = provider({ outputs: [writing] }), progress = [];
    const result = await runCreativeAgent(input({ brief: 'Naruto vs Sasuke fighting storybook, japanese manga style', fetchImpl: fake.fetchImpl, onProgress: event => progress.push(event.stage) }));
    assert.equal(result.provider, 'ollama');
    assert.equal(result.model, MODEL);
    assert.equal(result.attempts, 1);
    assert.equal(result.sections.length, 3);
    assert.deepEqual(progress, ['plan', 'generate', 'validate']);
    assert.match(result.studioPrompt, /Naruto vs Sasuke/);
    assert.match(result.studioPrompt, /japanese manga style/);
    assert.match(result.studioPrompt, /The courier and the lost star/);
    assert.ok(result.studioPrompt.length <= 12000);
    const generation = fake.calls.find(call => call.address.endsWith('/api/chat')).body;
    assert.equal(generation.stream, false);
    assert.equal(generation.think, false);
    assert.equal(generation.format.properties.sections.minItems, 3);
    assert.equal(generation.format.properties.sections.maxItems, 3);
    assert.equal(generation.options.num_ctx, LOCAL_AGENT_LIMITS.contextTokens);
    assert.ok(generation.options.num_predict <= LOCAL_AGENT_LIMITS.outputTokens);
    assert.ok(generation.messages[0].content.includes('purpose, action, visual, framing, dialogue and sound'));
    assert.deepEqual(generation.format.properties.sections.items.properties.artDirection.enum, ['Manga']);
    assert.equal(generation.format.properties.sections.items.properties.visual.minLength, 8);
    assert.equal(generation.format.properties.sections.items.properties.body, undefined);
    assert.ok(fake.calls.every(call => !/pull|create|delete/.test(call.address)), 'No model installation or modification happens.');
});

test('all five writing agents generate their complete task-specific section counts', async () => {
    for (const templateId of ['cast-notes', 'style-brief', 'storyboard-builder', 'prompt-branches', 'story-seed']) {
        const values = templateId === 'storyboard-builder' ? { scenes: 4 } : templateId === 'prompt-branches' ? { branches: 2 } : {};
        const output = artifact(templateId, values.scenes || values.branches, fields[templateId] ? '' : 'Manga');
        output.sections.forEach(section => { if (section.body) section.body += ' Render the adventure with detailed manga ink and clear expressive panels.'; });
        const fake = provider({ outputs: [output] });
        const result = await runCreativeAgent({ templateId, values, brief: 'A gentle adventure in expressive manga ink.', model: MODEL, fetchImpl: fake.fetchImpl });
        assert.equal(result.templateId, templateId);
        assert.equal(result.sections.length, fields[templateId]?.length || values.scenes || values.branches);
    }
});

test('malformed model JSON is repaired exactly once, using the validation problems', async () => {
    const fake = provider({ outputs: ['```json\nnot an artifact\n```', artifact()] }), progress = [];
    const result = await runCreativeAgent(input({ fetchImpl: fake.fetchImpl, onProgress: event => progress.push(event.stage) }));
    assert.equal(result.attempts, 2);
    assert.deepEqual(progress, ['plan', 'generate', 'validate', 'repair', 'generate', 'validate']);
    const generations = fake.calls.filter(call => call.address.endsWith('/api/chat'));
    assert.equal(generations.length, 2);
    assert.match(generations[1].body.messages.at(-1).content, /valid JSON without markdown fences/);
    assert.equal(generations[1].body.messages.at(-2).role, 'assistant');
});

test('an invalid inference envelope is repaired or rejected as a provider error', async () => {
    for (const envelope of [null, [], { done: false, message: { content: JSON.stringify(artifact()) } }, { model: 'another:latest', done: true, message: { content: JSON.stringify(artifact()) } }]) {
        let generations = 0;
        const fake = provider({ chat: () => ++generations === 1 ? Response.json(envelope) : Response.json({ model: MODEL, done: true, message: { content: JSON.stringify(artifact()) } }) });
        assert.equal((await runCreativeAgent(input({ fetchImpl: fake.fetchImpl }))).attempts, 2);
        assert.equal(generations, 2);
    }
    const invalid = provider({ chat: () => Response.json(null) });
    await assert.rejects(runCreativeAgent(input({ fetchImpl: invalid.fetchImpl })), errorCode('invalid-response'));
});

test('wrong counts and repeated filler cannot silently pass validation; presentation numbers are deterministic', async () => {
    for (const output of [artifact('storyboard-builder', 2), { ...artifact(), sections: Array.from({ length: 3 }, () => ({ ...artifact().sections[0] })) }]) {
        const fake = provider({ outputs: [output, artifact()] });
        const result = await runCreativeAgent(input({ fetchImpl: fake.fetchImpl }));
        assert.equal(result.attempts, 2);
    }
    const named = provider({ outputs: [{ ...artifact(), sections: artifact().sections.map(section => ({ ...section, heading: 'A descriptive heading' })) }] });
    const normalized = await runCreativeAgent(input({ fetchImpl: named.fetchImpl }));
    assert.equal(normalized.attempts, 1);
    assert.deepEqual(normalized.sections.map(section => section.heading), ['Scene 1 — A descriptive heading', 'Scene 2 — A descriptive heading', 'Scene 3 — A descriptive heading']);
    const fake = provider({ outputs: ['{"title":"Fake","summary":"This pretends to be finished writing.","sections":[]}'] });
    await assert.rejects(runCreativeAgent(input({ fetchImpl: fake.fetchImpl })), errorCode('invalid-response'));
    assert.equal(fake.calls.filter(call => call.address.endsWith('/api/chat')).length, 2);
});

test('a requested manga direction is retained and CJK writing without spaces remains valid', async () => {
    const wrong = artifact('story-seed');
    wrong.sections[4].body = 'Use simplified vector artwork for the characters with large flat shapes and no ink or detailed line treatment.';
    const corrected = artifact('story-seed'); corrected.sections[4].body += ' Use manga ink, screentones and expressive page panels throughout the story.';
    const fake = provider({ outputs: [wrong, corrected] });
    const result = await runCreativeAgent({ templateId: 'story-seed', values: { style: 'manga' }, model: MODEL, fetchImpl: fake.fetchImpl });
    assert.equal(result.attempts, 2);
    const japanese = artifact();
    japanese.sections.forEach((section, index) => { for (const key of ['purpose', 'action', 'visual', 'framing', 'dialogue', 'sound']) section[key] = `第${index + 1}場面では小さな配達人が迷子の星を見つけて家まで案内する。二人は静かな街を歩きながら互いの夢を語る。`; });
    const second = provider({ outputs: [japanese] });
    assert.equal((await runCreativeAgent(input({ fetchImpl: second.fetchImpl }))).attempts, 1);
});

test('positive art-direction and named-subject requirements reject a drifted artifact, then accept a corrected draft', async () => {
    const drifted = artifact('story-seed');
    drifted.sections[4].body = 'Blend realistic photography with digital art to create a polished look for a vivid new illustrated adventure.';
    const corrected = artifact('story-seed');
    corrected.sections[4].body = 'Use Japanese manga ink linework and screentones for Naruto and Sasuke, with expressive panel framing that makes their rivalry clear.';
    const fake = provider({ outputs: [drifted, corrected] });
    const result = await runCreativeAgent({ templateId: 'story-seed', values: { form: 'manga', style: 'manga' }, brief: 'Naruto vs Sasuke fighting storybook', model: MODEL, fetchImpl: fake.fetchImpl });
    assert.equal(result.attempts, 2);
    assert.match(result.sections[4].body, /manga/);
    assert.match(result.sections[4].body, /Naruto and Sasuke/);
    const repair = fake.calls.filter(call => call.address.endsWith('/api/chat'))[1].body.messages.at(-1).content;
    assert.match(repair, /requested manga/);
    assert.match(repair, /central subject Naruto/);
});

test('every branch prompt keeps the paired cast while exploring a different setting', async () => {
    const drifted = artifact('prompt-branches', 2);
    drifted.sections.forEach(section => { section.sharedPremise = 'A courier and a lost star find their way home.'; });
    drifted.sections[0].prompt = 'An isolated Alpine cabin at twilight, where a lone wolf gazes at the starry sky.';
    const corrected = artifact('prompt-branches', 2);
    corrected.sections.forEach(section => { section.sharedPremise = 'A courier and a lost star find their way home.'; });
    const fake = provider({ outputs: [drifted, corrected] });
    const result = await runCreativeAgent({ templateId: 'prompt-branches', values: { branches: 2, axis: 'setting' }, brief: 'A courier and a lost star find their way home. Give two visually distinct settings while preserving their friendship.', model: MODEL, fetchImpl: fake.fetchImpl });
    assert.equal(result.attempts, 2);
    assert.ok(result.sections.every(section => /Prompt: .*courier.*lost star/.test(section.body)));
    const repair = fake.calls.filter(call => call.address.endsWith('/api/chat'))[1].body.messages.at(-1).content;
    assert.match(repair, /Direction 1 Prompt must retain the central actor courier/);
    assert.match(repair, /central actor star/);
});

test('setting branches keep the reviewed shared goal instead of inventing a new problem', async () => {
    const wrong = artifact('prompt-branches', 2);
    wrong.sections.forEach(section => { section.sharedPremise = 'The courier and star are separated by an infinite void and must escape different dimensions.'; });
    const corrected = artifact('prompt-branches', 2);
    corrected.sections.forEach(section => { section.sharedPremise = 'A courier and a lost star find their way home.'; });
    const fake = provider({ outputs: [wrong, corrected] });
    const result = await runCreativeAgent({ templateId: 'prompt-branches', values: { branches: 2, axis: 'setting' }, brief: 'A courier and a lost star find their way home. Give two visually distinct settings while preserving their friendship.', model: MODEL, fetchImpl: fake.fetchImpl });
    assert.equal(result.attempts, 2);
    assert.ok(result.sections.every(section => section.body.startsWith('Shared premise: A courier and a lost star find their way home.')));
    assert.deepEqual(fake.calls.find(call => call.address.endsWith('/api/chat')).body.format.properties.sections.items.properties.sharedPremise.enum, ['A courier and a lost star find their way home.']);
});

test('branch actor checks accept normal generic noun plurals but preserve whole-word and named-subject boundaries', async () => {
    const generic = artifact('prompt-branches', 2);
    generic.sections.forEach((section, index) => {
        section.sharedPremise = 'A courier and a lost star find their way home.';
        section.prompt = `Couriers and lost stars share the journey home through setting ${index + 1}, using friendship to navigate its landmarks.`;
    });
    const plural = provider({ outputs: [generic] });
    assert.equal((await runCreativeAgent({ templateId: 'prompt-branches', values: { branches: 2, axis: 'setting' }, brief: 'A courier and a lost star find their way home.', model: MODEL, fetchImpl: plural.fetchImpl })).attempts, 1);
    const wrong = structuredClone(generic);
    wrong.sections[0].prompt = 'Couriers start their route beneath the starry sky and explore the architecture before going home.';
    const boundary = provider({ outputs: [wrong, generic] });
    assert.equal((await runCreativeAgent({ templateId: 'prompt-branches', values: { branches: 2 }, brief: 'A courier and a lost star find their way home.', model: MODEL, fetchImpl: boundary.fetchImpl })).attempts, 2);
    const named = artifact('prompt-branches', 2);
    named.sections.forEach((section, index) => { section.prompt = `Narutos and Sasukes spar beside landmark ${index + 1}, retaining the rivalry and a dramatic meeting at sunset.`; });
    const corrected = structuredClone(named);
    corrected.sections.forEach(section => { section.prompt = section.prompt.replace('Narutos and Sasukes', 'Naruto and Sasuke'); });
    const exact = provider({ outputs: [named, corrected] });
    assert.equal((await runCreativeAgent({ templateId: 'prompt-branches', values: { branches: 2 }, brief: 'Naruto vs Sasuke at sunset.', model: MODEL, fetchImpl: exact.fetchImpl })).attempts, 2);
});

test('storyboard repairs missing production fields and a scene that substitutes the requested medium', async () => {
    for (const drift of ['fields', 'medium']) {
        const drifted = artifact('storyboard-builder', 3, 'Manga');
        if (drift === 'fields') delete drifted.sections[1].sound;
        else drifted.sections[1].artDirection = 'Photographic';
        const fake = provider({ outputs: [drifted, artifact('storyboard-builder', 3, 'Manga')] });
        const result = await runCreativeAgent(input({ brief: 'A courier follows a lost star home, rendered in manga ink with gentle humor.', fetchImpl: fake.fetchImpl }));
        assert.equal(result.attempts, 2);
        assert.ok(result.sections.every(section => /Visual: Manga\. /.test(section.body)));
        assert.match(fake.calls.filter(call => call.address.endsWith('/api/chat'))[1].body.messages.at(-1).content, /Section 2 (must have only these properties|artDirection must be Manga)/);
    }
});

test('older Ollama versions use JSON mode while retaining the explicit output schema prompt', async () => {
    const fake = provider({ version: '0.3.9' });
    await runCreativeAgent(input({ fetchImpl: fake.fetchImpl }));
    const request = fake.calls.find(call => call.address.endsWith('/api/chat')).body;
    assert.equal(request.format, 'json');
    assert.match(request.messages[0].content, /"required":\["title","summary","sections"\]/);
});

test('unsafe endpoints, cloud tags, unsupported agents and invalid input are rejected before inference', async () => {
    let called = 0;
    const fetchImpl = () => { called++; throw new Error('Must not run'); };
    for (const baseUrl of ['https://127.0.0.1:11434', 'http://localhost:11434', 'http://example.com', 'http://127.0.0.1.evil.test', 'http://user:pass@127.0.0.1:11434', 'http://127.0.0.1:11434/api', 'http://127.0.0.1:11434/?a=1', 'http://127.0.0.1:11434/#x', 'http://127.0.0.1:65536', 'http://127.0.0.1:0']) {
        await assert.rejects(getLocalModelStatus({ baseUrl, fetchImpl }), errorCode('unsafe-endpoint'));
    }
    for (const model of ['qwen3.5:cloud', 'gpt-oss:120b-cloud', '../../escape', 'https://example.com/model']) await assert.rejects(runCreativeAgent(input({ model, fetchImpl })), errorCode('invalid-model'));
    await assert.rejects(runCreativeAgent(input({ templateId: 'sketch-to-scene', fetchImpl })), errorCode('invalid-input'));
    await assert.rejects(runCreativeAgent(input({ values: { scenes: 1000 }, fetchImpl })), errorCode('invalid-input'));
    await assert.rejects(runCreativeAgent(input({ values: null, fetchImpl })), errorCode('invalid-input'));
    assert.equal(called, 0);
});

test('missing or remote models never generate or fabricate a fallback', async () => {
    const missing = provider();
    await assert.rejects(runCreativeAgent(input({ model: 'absent:latest', fetchImpl: missing.fetchImpl })), errorCode('model-missing'));
    assert.equal(missing.calls.filter(call => call.address.endsWith('/api/chat')).length, 0);
    const remote = provider({ show: { remote_host: 'https://ollama.com', model_info: { 'general.parameter_count': 1 } } });
    await assert.rejects(runCreativeAgent(input({ fetchImpl: remote.fetchImpl })), errorCode('invalid-model'));
    assert.equal(remote.calls.filter(call => call.address.endsWith('/api/chat')).length, 0);
    const embedding = provider({ show: { capabilities: ['embedding'], model_info: { 'general.parameter_count': 1 } } });
    await assert.rejects(runCreativeAgent(input({ fetchImpl: embedding.fetchImpl })), errorCode('invalid-model'));
    const empty = provider({ show: { model_info: {} } });
    await assert.rejects(runCreativeAgent(input({ fetchImpl: empty.fetchImpl })), errorCode('invalid-model'));
});

test('offline, invalid model lists, oversized responses and redirects report actionable status', async () => {
    const offline = await getLocalModelStatus({ fetchImpl: async () => { throw new TypeError('ECONNREFUSED'); } });
    assert.equal(offline.available, false);
    assert.equal(offline.reason, 'unavailable');
    assert.match(offline.message, /Start your local Ollama server/);
    const bad = provider({ tags: () => Response.json({ models: 'not a list' }) });
    assert.equal((await getLocalModelStatus({ fetchImpl: bad.fetchImpl })).reason, 'invalid-response');
    const huge = provider({ tags: () => new Response('x'.repeat(LOCAL_AGENT_LIMITS.responseBytes + 1)) });
    assert.equal((await getLocalModelStatus({ fetchImpl: huge.fetchImpl })).reason, 'invalid-response');
    const redirect = new Response('{}'); Object.defineProperty(redirect, 'redirected', { value: true });
    await assert.rejects(getLocalModelStatus({ fetchImpl: async () => redirect }), errorCode('unsafe-endpoint'));
    const none = provider({ models: [] });
    const noModels = await getLocalModelStatus({ fetchImpl: none.fetchImpl });
    assert.equal(noModels.available, true);
    assert.equal(noModels.reason, 'no-models');
    assert.equal(noModels.suggestedModel, null);
});

test('cancellation interrupts pending inference promptly with no repair request', async () => {
    const controller = new AbortController();
    let generationStarted;
    const started = new Promise(resolve => { generationStarted = resolve; });
    const fake = provider({ chat: options => { assert.ok(options.signal); generationStarted(); return new Promise(() => {}); } });
    const running = runCreativeAgent(input({ fetchImpl: fake.fetchImpl, signal: controller.signal }));
    await started;
    controller.abort();
    await assert.rejects(running, { name: 'AbortError' });
    assert.equal(fake.calls.filter(call => call.address.endsWith('/api/chat')).length, 1);
    const already = new AbortController(); already.abort();
    await assert.rejects(getLocalModelStatus({ signal: already.signal, fetchImpl: fake.fetchImpl }), { name: 'AbortError' });
});

test('timeouts are bounded even if a provider never resolves its fetch promise', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const pending = getLocalModelStatus({ fetchImpl: () => new Promise(() => {}) });
    t.mock.timers.tick(LOCAL_AGENT_LIMITS.statusTimeoutMs);
    const result = await pending;
    assert.equal(result.available, false);
    assert.equal(result.reason, 'timeout');
    t.mock.timers.reset();
});

test('abort during streamed body reading cancels and releases the response reader', async () => {
    const controller = new AbortController();
    let cancelled = false;
    const stream = new ReadableStream({ start(consumer) { consumer.enqueue(new TextEncoder().encode('{')); }, cancel() { cancelled = true; } });
    const running = getLocalModelStatus({ signal: controller.signal, fetchImpl: async () => new Response(stream) });
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();
    await assert.rejects(running, { name: 'AbortError' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(cancelled, true);
    assert.equal(stream.locked, false);
});
