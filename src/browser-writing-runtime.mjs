/** Reviewed public downloads; no user-supplied repository, model or executable URL. */
export const BROWSER_AGENT_MODEL = Object.freeze({
    id: 'Qwen3.5-0.8B-q4f16_1-MLC',
    title: 'Qwen 3.5 · 0.8B',
    license: 'Apache-2.0',
    downloadBytes: 453205372,
    gpuMemoryMB: 1629.49,
    modelRevision: '0ec138972555613c1d7812a821778ad0398c8790',
    libraryRevision: '025bcaf3780fa8254f5e5efd3bfea0a5397248f4',
    contextTokens: 4096,
});
/** WebLLM 0.2.85's reviewed model + matching v0_2_84 library, pinned to commits. */
export const BROWSER_AGENT_APP_CONFIG = {
    cacheBackend: 'cache',
    model_list: [{
            model_id: BROWSER_AGENT_MODEL.id,
            model: `https://huggingface.co/mlc-ai/${BROWSER_AGENT_MODEL.id}/resolve/${BROWSER_AGENT_MODEL.modelRevision}/`,
            model_lib: `https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/${BROWSER_AGENT_MODEL.libraryRevision}/web-llm-models/v0_2_84/base/Qwen3.5-0.8B-q4f16_1_cs1k-webgpu.wasm`,
            overrides: { context_window_size: BROWSER_AGENT_MODEL.contextTokens, max_history_size: 1 },
            vram_required_MB: BROWSER_AGENT_MODEL.gpuMemoryMB,
            low_resource_required: true,
            required_features: ['shader-f16'],
            integrity: {
                onFailure: 'error',
                config: 'sha256-Hqk8K4s5ajdUUW0MS29LaIHCkwyizGyyzwDlEea+hqk=',
                model_lib: 'sha256-PdjP8Em/RZm/u1BYgK6hG6lfhfOSS34XH5Z9HxNIrik=',
                tokenizer: {
                    'tokenizer.json': 'sha256-X55NSQGpK5l+RjwfRgVQiLbMpcphplItG59kxLuBy0I=',
                    'vocab.json': 'sha256-zpm0yymD0RiAbOCot3ejWwk+IAClA+veJYUyhMnfoAM=',
                    'merges.txt': 'sha256-qdNW173x70lJ4+dI6VuOEK2dTi6Djt3Digp7a5TR240=',
                    'tokenizer_config.json': 'sha256-SeK245X5WfB38emSsziRnA1KlzL8bmE5leBlV/hDUAw=',
                },
            },
        }],
};
import { prepareCreativeAgentTask, validateCreativeAgentOutput } from './agent-runtime.mjs';
export class BrowserAgentError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'BrowserAgentError';
    }
}
const aborted = () => new DOMException('Browser AI operation cancelled.', 'AbortError');
const checkAbort = (signal) => { if (signal?.aborted)
    throw aborted(); };
const emit = (callback, progress) => { callback?.(progress); };
/** Capability checks do not import the model engine or download any model assets. */
export async function browserSupport() {
    const base = { provider: 'webllm', available: false, model: BROWSER_AGENT_MODEL };
    if (typeof window === 'undefined' || !window.isSecureContext)
        return { ...base, reason: 'insecure-context', message: 'Browser AI needs HTTPS or localhost. Open a secure Studio page.' };
    if (typeof Worker === 'undefined')
        return { ...base, reason: 'worker-unavailable', message: 'This browser cannot run the AI worker. Use a browser with Web Workers and WebGPU.' };
    const gpu = navigator.gpu;
    if (!gpu)
        return { ...base, reason: 'webgpu-unavailable', message: 'WebGPU is unavailable in this browser. Use a recent Chrome, Edge or Safari with GPU acceleration enabled.' };
    let adapter;
    try {
        adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    }
    catch {
        adapter = null;
    }
    if (!adapter)
        return { ...base, reason: 'webgpu-unavailable', message: 'A compatible GPU could not be found. Browser AI stays on your device and has no server fallback.' };
    // These are the minimum limits actually requested by WebLLM 0.2.85's TVM runtime.
    const limits = { maxBufferSize: 268435456, maxStorageBufferBindingSize: 134217728, maxComputeWorkgroupStorageSize: 32768, maxStorageBuffersPerShaderStage: 10 };
    if (!adapter.features.has('shader-f16') || Object.entries(limits).some(([key, value]) => !Number.isFinite(adapter.limits[key]) || adapter.limits[key] < value)) {
        return { ...base, reason: 'gpu-limits', message: 'This GPU does not meet the browser model’s float16 and buffer requirements. No server or cloud inference will be used.' };
    }
    return { ...base, available: true };
}
async function createBrowserSession(onProgress, createWorker, loadEngine) {
    const webllm = await loadEngine();
    const worker = createWorker();
    let rejectFailure;
    const failure = new Promise((_, reject) => { rejectFailure = reject; });
    // A pending worker failure must not become an unhandled rejection between jobs.
    void failure.catch(() => undefined);
    worker.addEventListener('error', () => rejectFailure(new BrowserAgentError('generation-failed', 'The browser AI worker stopped. Reload the model and try a shorter brief.')));
    worker.addEventListener('messageerror', () => rejectFailure(new BrowserAgentError('generation-failed', 'The browser AI worker could not read its response. Reload the model and try again.')));
    const engine = new webllm.WebWorkerMLCEngine(worker, {
        appConfig: BROWSER_AGENT_APP_CONFIG,
        logLevel: 'WARN',
        initProgressCallback: ({ progress, text }) => onProgress({ stage: 'download', message: text, progress: Math.max(0, Math.min(1, progress)) }),
    });
    return { engine, worker, failure };
}
/** Internal controller is injectable for tests; callers cannot select remote models or hosts. */
export function createBrowserWritingRuntime(dependencies) {
    let session = null;
    let ready = false;
    let busy = false;
    let loading = false;
    let epoch = 0;
    let cancelActive = null;
    function stopSession() {
        epoch++;
        const previous = session;
        session = null;
        ready = false;
        if (previous) {
            try {
                previous.engine.interruptGenerate();
            }
            finally {
                previous.worker.terminate();
            }
        }
    }
    async function bounded(job, options, timeoutMs) {
        checkAbort(options.signal);
        let timer;
        let onAbort;
        const interrupted = new Promise((_, reject) => {
            onAbort = () => { stopSession(); reject(aborted()); };
            cancelActive = onAbort;
            options.signal?.addEventListener('abort', onAbort, { once: true });
            timer = setTimeout(() => { stopSession(); reject(new BrowserAgentError('timeout', 'Browser AI took too long. The worker was stopped; try a shorter brief or reload the model.')); }, timeoutMs);
        });
        const activeFailure = session?.failure;
        try {
            return await Promise.race([job(), interrupted, ...(activeFailure ? [activeFailure] : [])]);
        }
        finally {
            if (timer)
                clearTimeout(timer);
            if (onAbort)
                options.signal?.removeEventListener('abort', onAbort);
            if (cancelActive === onAbort)
                cancelActive = null;
        }
    }
    async function status() { return { ...await dependencies.support(), ready, loading }; }
    async function load(options = {}) {
        checkAbort(options.signal);
        if (busy)
            throw new BrowserAgentError('busy', 'Browser AI is already loading or writing. Finish or cancel the current operation.');
        busy = true;
        const loadEpoch = epoch;
        try {
            const support = await dependencies.support();
            checkAbort(options.signal);
            if (epoch !== loadEpoch) throw aborted();
            if (!support.available)
                throw new BrowserAgentError('unsupported', support.message || 'Browser AI is unavailable on this device.');
            if (ready && session) {
                emit(options.onProgress, { stage: 'ready', message: 'The browser model is ready on this device.', progress: 1 });
                return;
            }
            loading = true;
            emit(options.onProgress, { stage: 'download', message: 'Preparing the reviewed browser model. The first load downloads public model files to this browser.', progress: 0 });
            await bounded(async () => {
                const created = await dependencies.createSession(progress => { if (!options.signal?.aborted && loading)
                    emit(options.onProgress, progress); });
                if (options.signal?.aborted || epoch !== loadEpoch || !loading) {
                    created.worker.terminate();
                    throw aborted();
                }
                session = created;
                await Promise.race([created.engine.reload(BROWSER_AGENT_MODEL.id), created.failure]);
                checkAbort(options.signal);
                if (session !== created)
                    throw aborted();
                ready = true;
            }, options, dependencies.downloadTimeoutMs ?? 600_000);
            emit(options.onProgress, { stage: 'ready', message: 'The browser model is ready. Writing runs on this device.', progress: 1 });
        }
        catch (error) {
            stopSession();
            if (error instanceof DOMException && error.name === 'AbortError' || error instanceof BrowserAgentError)
                throw error;
            const failure = new BrowserAgentError('download-failed', 'The browser model could not load. Check your connection, available browser storage and WebGPU support, then retry.');
            failure.cause = error;
            throw failure;
        }
        finally {
            busy = false;
            loading = false;
        }
    }
    async function run(options) {
        checkAbort(options.signal);
        if (typeof options.brief === 'string' && options.brief.length > 2000) throw new BrowserAgentError('invalid-input', 'Browser AI supports briefs up to 2,000 characters. Shorten your brief to leave room for finished writing in the model’s context.');
        // Validate the brief before touching the engine; only five reviewed writing contracts.
        const task = prepareCreativeAgentTask(options);
        if (busy)
            throw new BrowserAgentError('busy', 'Browser AI is already writing. Finish or cancel the current operation.');
        const current = session;
        if (!ready || !current)
            throw new BrowserAgentError('not-ready', 'Download the browser model first. Your brief will stay on this device.');
        busy = true;
        const sectionProperties = task.schema.properties.sections.items.properties;
        const headings = sectionProperties.heading.enum;
        const contentFields = Object.keys(sectionProperties).filter(key => key !== 'heading');
        // Small models follow a short task prompt more reliably than duplicated
        // schema prose. The full reviewed schema still constrains decoding and
        // the shared validator checks the actual artifact afterwards.
        const messages = [{role: 'system', content: `Write finished creative content for ${task.title}. Return a JSON object with title, summary and exactly ${task.sectionCount} sections. ${headings ? `Use these headings in this order: ${headings.join('; ')}.` : 'Give each section a short scene or direction heading.'} Each section has these content fields: ${contentFields.join(', ')}. Write one concrete sentence per production field or two short sentences per body. Describe actual characters, actions, colors, light and material; do not write instructions about sections or schemas. Preserve the user’s cast, goal, language and art medium. Never repeat a sentence. Keep the entire artifact concise and within 2,048 tokens.`}, {...task.messages[1]}];
        if (task.templateId === 'prompt-branches') {
            const axis = options.values?.axis || 'visual style';
            const variations = {
                setting: ['a coastal town', 'a forest canopy', 'cloud islands', 'a desert oasis', 'a snowy village', 'a riverside market'],
                tone: ['warm humor', 'quiet wonder', 'hopeful adventure', 'gentle mystery', 'festive energy', 'reflective calm'],
                'camera framing': ['a wide environmental view', 'an intimate close-up', 'an overhead composition', 'a low-angle hero view', 'an over-the-shoulder view', 'a medium two-shot'],
                'visual style': ['delicate linework', 'bold graphic contrast', 'soft painterly textures', 'cinematic lighting', 'editorial shapes', 'handcrafted materials'],
            }[axis];
            messages[0].content += `\nMake the ${task.sectionCount} directions clearly different along ${axis}. Use these approaches in order: ${variations.slice(0,task.sectionCount).join('; ')}. Keep the same cast, central action, goal and requested art medium in every prompt.`;
        }
        let errors = [];
        const deadline = Date.now() + (dependencies.generationTimeoutMs ?? (task.sectionCount > 3 && task.templateId === 'storyboard-builder' ? Math.min(600_000, task.sectionCount * 45_000 + 120_000) : 180_000));
        try {
            emit(options.onProgress, { stage: 'plan', message: `Planning ${task.sectionCount} sections for ${task.title}.`, attempt: 1 });
            for (const attempt of [1, 2]) {
                checkAbort(options.signal);
                emit(options.onProgress, { stage: 'generate', message: attempt === 1 ? 'Writing on this device with the browser model.' : 'Correcting the draft on this device.', attempt });
                const generate = (messagesForCall, schemaForCall, outputTokens, sceneLabel = '') => bounded(async () => {
                    await Promise.race([current.engine.resetChat(), current.failure]);
                    const stream = await Promise.race([current.engine.chat.completions.create({
                            messages: messagesForCall, model: BROWSER_AGENT_MODEL.id, stream: true,
                            response_format: { type: 'json_object', schema: JSON.stringify(schemaForCall) },
                            max_tokens: outputTokens, temperature: .65, top_p: .8,
                            extra_body: { enable_thinking: false },
                        }), current.failure]);
                    let content = '', finished = false, lastUpdate = 0;
                    for await (const chunk of stream) {
                        checkAbort(options.signal);
                        if (session !== current)
                            throw aborted();
                        if (chunk.model && chunk.model !== BROWSER_AGENT_MODEL.id)
                            throw new BrowserAgentError('invalid-response', 'The browser worker returned a response for a different model.');
                        const choice = chunk.choices?.[0];
                        content += choice?.delta?.content || '';
                        if (content.length > 24000)
                            throw new BrowserAgentError('invalid-response', 'The browser draft exceeded its output limit. Try fewer sections.');
                        if (choice?.finish_reason === 'stop')
                            finished = true;
                        if (Date.now() - lastUpdate > 1000) {
                            emit(options.onProgress, { stage: 'generate', message: `${sceneLabel || 'Writing on this device'} · ${content.length.toLocaleString()} characters`, attempt });
                            lastUpdate = Date.now();
                        }
                    }
                    if (!finished)
                        return { content, complete: false };
                    return { content, complete: true };
                }, options, Math.max(1, deadline - Date.now()));
                let completion;
                if (task.templateId === 'storyboard-builder' && task.sectionCount > 3) {
                    // A compact model repeats long schema-constrained scene arrays.
                    // Write bounded scenes sequentially, with preceding actions as
                    // continuity context. These are model outputs, never filler.
                    const singleSchema = structuredClone(task.schema);
                    singleSchema.properties.sections.minItems = singleSchema.properties.sections.maxItems = 1;
                    const sections = []; let title = '', summary = '', complete = true;
                    const beats = ['Introduce the cast, world and shared goal.', 'Discover a clue toward the shared goal.', 'Encounter a concrete obstacle.', 'Make a choice and agree a plan.', 'Act on the plan together.', 'Resolve the original goal and end with the requested feeling.'];
                    for (let scene = 0; scene < task.sectionCount; scene++) {
                        checkAbort(options.signal);
                        const label = `Scene ${scene + 1} of ${task.sectionCount}`;
                        const beat = beats[Math.round(scene * (beats.length - 1) / (task.sectionCount - 1))];
                        const continuity = sections.slice(-2).map((section, index) => `Previous action ${index + 1}: ${String(section.action).slice(0, 220)}`).join('\n');
                        const sceneSchema = structuredClone(singleSchema);
                        sceneSchema.properties.sections.items.properties.purpose = {type:'string',enum:[beat]};
                        const sceneMessages = [{role: 'system', content: `You are writing one scene for a complete ${task.sectionCount}-scene story. Return the JSON artifact, with exactly one section. Keep the same characters, language, art medium and shared goal as the brief. Each production field is one concrete sentence of at most 20 words. Make the action develop the story rather than repeating the previous action. Title and summary describe the whole story.`}, {role:'user',content:`Original creative brief: ${options.brief || task.messages[1].content}\nStory form: ${options.values?.form || 'short film'}\nContinuity notes:\n${continuity || 'This is the opening; introduce the cast and shared goal.'}\nNow write only ${label}. Scene purpose: ${beat}\n${attempt === 2 ? 'Corrections: ' + errors.slice(0, 3).join(' ') : ''}`}];
                        const part = await generate(sceneMessages, sceneSchema, 1000, label);
                        try {
                            const parsed = JSON.parse(part.content.replace(/^\s*<think>\s*<\/think>\s*/, ''));
                            if (!part.complete || !Array.isArray(parsed.sections) || parsed.sections.length !== 1 || !parsed.sections[0] || typeof parsed.title !== 'string' || typeof parsed.summary !== 'string') throw new Error('Incomplete scene.');
                            if (!scene) {title = parsed.title;summary = parsed.summary;}
                            sections.push(parsed.sections[0]);
                        } catch {complete = false;break;}
                    }
                    completion = {content: JSON.stringify({title,summary,sections}),complete};
                } else completion = await generate(messages, task.schema, Math.min(2048, task.maxOutputTokens));
                checkAbort(options.signal);
                if (session !== current)
                    throw aborted();
                emit(options.onProgress, { stage: 'validate', message: 'Checking finished writing, section count, cast and art direction.', attempt });
                // Qwen's non-thinking chat template emits an empty reasoning envelope.
                // Accept only that exact empty prefix; all artifact JSON still uses the shared validator.
                const artifactText = completion.content.replace(/^\s*<think>\s*<\/think>\s*/, '');
                const checked = validateCreativeAgentOutput(task, artifactText);
                errors = checked.success ? [] : checked.errors;
                if (!completion.complete)
                    errors.unshift('Finish the complete JSON artifact within the output limit.');
                if (checked.success && !errors.length)
                    return { ...checked.artifact, model: BROWSER_AGENT_MODEL.id, provider: 'webllm', templateId: task.templateId, attempts: attempt };
                if (attempt === 1) {
                    emit(options.onProgress, { stage: 'repair', message: 'The first draft needs a correction. Repairing it once on this device.', attempt: 2 });
                    // Fresh context avoids carrying a long failed draft beyond the model's window.
                    messages.push({ role: 'user', content: `Write the corrected artifact from the original brief. Validation issues: ${errors.slice(0, 6).join(' ')} Return only complete JSON matching the schema.` });
                }
            }
            throw new BrowserAgentError('invalid-response', `The browser model could not finish a valid draft after one repair. ${errors.slice(0, 2).join(' ')} Try a simpler brief or fewer sections.`);
        }
        catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError')
                throw error;
            if (error instanceof BrowserAgentError) {
                if (error.code === 'generation-failed')
                    stopSession();
                throw error;
            }
            // A worker/GPU failure is explicit. No cloud or localhost model is contacted.
            stopSession();
            const failure = new BrowserAgentError('generation-failed', 'Browser AI could not finish this draft. Reload the model and try a shorter brief. No server fallback was used.');
            failure.cause = error;
            throw failure;
        }
        finally {
            busy = false;
        }
    }
    function cancel() { cancelActive?.(); stopSession(); }
    function unload() { cancelActive?.(); stopSession(); }
    return { status, load, run, cancel, unload };
}
/** A local bundler worker factory is supplied by the embedding app; no arbitrary model URL is accepted. */
export function createBrowserAgentRuntime(options) {
    if (!options || typeof options.createWorker !== 'function' || typeof options.loadEngine !== 'function')
        throw new TypeError('Provide a local browser writing worker factory and bundled WebLLM loader.');
    return createBrowserWritingRuntime({ support: browserSupport, createSession: onProgress => createBrowserSession(onProgress, options.createWorker, options.loadEngine) });
}
