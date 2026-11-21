// A third writing backend: the language model built into the browser (the Prompt API's
// `LanguageModel`, in desktop Chrome and Edge). There is no dependency, worker or model URL:
// the browser owns, downloads and updates the model. Same five writing contracts, same
// validator and one repair as the WebLLM and Ollama backends.
import { prepareCreativeAgentTask, validateCreativeAgentOutput } from './agent-runtime.mjs';
import { BrowserAgentError, compactWritingMessages, sceneWritingStep } from './browser-writing-runtime.mjs';
import { writingFormat } from './writing-schema.mjs';

/** The browser picks the actual model (Gemini Nano in Chrome, Phi in Edge); a host cannot choose one. */
export const BUILTIN_AGENT_MODEL = Object.freeze({ id: 'browser-built-in', title: 'Browser built-in AI', api: 'LanguageModel' });
const STATES = new Set(['downloadable', 'downloading', 'available']);
const aborted = () => new DOMException('Built-in AI operation cancelled.', 'AbortError');
const isAbort = error => error?.name === 'AbortError';
const checkAbort = signal => { if (signal?.aborted) throw aborted(); };
const emit = (callback, progress) => { callback?.(progress); };
const languageTag = language => { const tag = String(language || 'en').toLowerCase().split(/[-_]/)[0]; return /^[a-z]{2,3}$/.test(tag) ? tag : 'en'; };
/** The prompts are written in English; the brief and the writing use `language`. */
const sessionOptions = language => ({
    expectedInputs: [{ type: 'text', languages: [...new Set(['en', language])] }],
    expectedOutputs: [{ type: 'text', languages: [language] }],
});
async function* chunks(stream) {
    const source = await stream;
    if (typeof source?.[Symbol.asyncIterator] === 'function') { yield* source; return; }
    const reader = source.getReader();
    try { for (let step = await reader.read(); !step.done; step = await reader.read()) yield step.value; }
    finally { reader.releaseLock?.(); }
}

/** Asks the browser only; never creates a session, so it cannot start a model download. */
export async function builtinSupport(options = {}) {
    const language = languageTag(options.language);
    const base = { provider: 'builtin', available: false, state: 'unavailable', model: BUILTIN_AGENT_MODEL, language };
    const api = options.languageModel ?? globalThis.LanguageModel;
    if (!api || typeof api.availability !== 'function' || typeof api.create !== 'function')
        return { ...base, reason: 'api-unavailable', message: 'This browser has no built-in writing model. Use a recent desktop Chrome or Edge, or choose another writing backend.' };
    // Some browsers leave the question unanswered (seen in headless Chrome); a check must not hang a workspace.
    const ask = async tag => {
        let timer;
        try {
            const state = await Promise.race([api.availability(sessionOptions(tag)), new Promise(resolve => { timer = setTimeout(resolve, options.timeoutMs ?? 4000, 'timeout'); })]);
            return STATES.has(state) || state === 'timeout' ? state : 'unavailable';
        }
        catch { return 'unavailable'; }
        finally { clearTimeout(timer); }
    };
    const state = await ask(language);
    if (state === 'timeout') return { ...base, reason: 'timeout', message: 'The browser did not answer about its built-in model. Try again, or choose another writing backend.' };
    if (state !== 'unavailable') return { ...base, available: true, state };
    if (language !== 'en' && await ask('en') !== 'unavailable')
        return { ...base, reason: 'language-unsupported', message: `The browser’s built-in model cannot write in “${language}” yet. Write in a supported language or choose another writing backend.` };
    return { ...base, reason: 'device-unsupported', message: 'This device cannot run the browser’s built-in model (it needs a desktop with enough free storage and memory). No server or cloud inference will be used.' };
}

/** `languageModel` and `support` are injectable for tests; the task and validation contracts stay fixed. */
export function createBuiltinWritingRuntime(dependencies = {}) {
    const api = () => dependencies.languageModel ?? globalThis.LanguageModel;
    const support = language => dependencies.support ? dependencies.support(languageTag(language)) : builtinSupport({ languageModel: dependencies.languageModel, language, timeoutMs: dependencies.statusTimeoutMs });
    let busy = false, loading = false, active = null;
    /** Runs `job(signal)` until it settles, the caller aborts, `cancel()` is called or the time runs out. */
    async function bounded(job, signal, timeoutMs, timeoutMessage) {
        checkAbort(signal);
        const controller = new AbortController();
        let timedOut = false;
        const onAbort = () => controller.abort();
        signal?.addEventListener('abort', onAbort, { once: true });
        const stopped = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(timedOut ? new BrowserAgentError('timeout', timeoutMessage) : aborted()), { once: true }));
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
        active = controller;
        const work = job(controller.signal);
        // The race may already be decided when a stopped job rejects.
        void work.catch(() => undefined);
        try { return await Promise.race([work, stopped]); }
        finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            if (active === controller) active = null;
        }
    }
    async function status(options = {}) {
        const found = await support(options.language);
        return { ...found, ready: found.state === 'available', loading: loading || found.state === 'downloading' };
    }
    /** Ready at once when the browser already has its model; otherwise the browser downloads it (call from a click). */
    async function load(options = {}) {
        checkAbort(options.signal);
        if (busy) throw new BrowserAgentError('busy', 'Built-in AI is already loading or writing. Finish or cancel the current operation.');
        busy = true;
        try {
            const language = languageTag(options.language), found = await support(language);
            checkAbort(options.signal);
            if (!found.available) throw new BrowserAgentError('unsupported', found.message || 'Built-in AI is unavailable in this browser.');
            if (found.state !== 'available') {
                loading = true;
                emit(options.onProgress, { stage: 'download', message: 'The browser is downloading its built-in model. It is shared with other sites and kept by the browser.', progress: 0 });
                await bounded(async signal => {
                    const session = await api().create({ ...sessionOptions(language), signal, monitor(monitor) {
                        monitor.addEventListener('downloadprogress', event => {
                            const progress = Math.max(0, Math.min(1, event.loaded / (event.total || 1)));
                            if (!signal.aborted && Number.isFinite(progress)) emit(options.onProgress, { stage: 'download', message: 'The browser is downloading its built-in model.', progress });
                        });
                    } });
                    session?.destroy?.();
                }, options.signal, dependencies.downloadTimeoutMs ?? 1_800_000, 'The browser’s model download took too long. It may continue in the background; check again later.');
            }
            emit(options.onProgress, { stage: 'ready', message: 'The browser’s built-in model is ready. Writing runs on this device.', progress: 1 });
        }
        catch (error) {
            if (isAbort(error) || error instanceof BrowserAgentError) throw error;
            const failure = new BrowserAgentError('download-failed', error?.name === 'NotAllowedError'
                ? 'The browser needs a click or key press to start its model download. Press the download button again.'
                : 'The browser could not prepare its built-in model. Check your connection and free storage, then retry.');
            failure.cause = error;
            throw failure;
        }
        finally { busy = false; loading = false; }
    }
    async function run(options) {
        checkAbort(options.signal);
        if (typeof options.brief === 'string' && options.brief.length > 2000) throw new BrowserAgentError('invalid-input', 'Built-in AI supports briefs up to 2,000 characters. Shorten your brief to leave room for finished writing in the model’s context.');
        // Validate the brief before touching the model; only five reviewed writing contracts.
        const task = prepareCreativeAgentTask(options);
        if (busy) throw new BrowserAgentError('busy', 'Built-in AI is already writing. Finish or cancel the current operation.');
        busy = true;
        let errors = [], fallback = false;
        try {
            const language = languageTag(options.language), found = await support(language);
            checkAbort(options.signal);
            if (!found.available) throw new BrowserAgentError('unsupported', found.message || 'Built-in AI is unavailable in this browser.');
            if (found.state !== 'available') throw new BrowserAgentError('not-ready', 'Let the browser download its built-in model first. Your brief will stay on this device.');
            const deadline = Date.now() + (dependencies.generationTimeoutMs ?? (task.sectionCount > 3 && task.templateId === 'storyboard-builder' ? Math.min(600_000, task.sectionCount * 45_000 + 120_000) : 180_000));
            const messages = compactWritingMessages(task, options);
            emit(options.onProgress, { stage: 'plan', message: `Planning ${task.sectionCount} sections for ${task.title}.`, attempt: 1 });
            for (const attempt of [1, 2]) {
                checkAbort(options.signal);
                emit(options.onProgress, { stage: 'generate', message: attempt === 1 ? 'Writing on this device with the browser’s built-in model.' : 'Correcting the draft on this device.', attempt });
                // One fresh session per call: the system prompt is fixed at creation and no earlier draft stays in context.
                const generate = ([system, ...turns], schemas, label = '') => bounded(async signal => {
                    const session = await api().create({ ...sessionOptions(language), initialPrompts: [{ role: 'system', content: system.content }], signal });
                    try {
                        const prompt = turns.map(turn => turn.content).join('\n\n');
                        let started = false;
                        const read = async () => {
                            const { decoding, ...format } = writingFormat({ schema: schemas.fallback, decodingSchema: schemas.schema }, { provider: 'builtin', fallback });
                            let content = '', lastUpdate = 0;
                            for await (const chunk of chunks(session.promptStreaming(prompt, { ...format, signal }))) {
                                const text = typeof chunk === 'string' ? chunk : '';
                                // Early releases streamed the whole text so far; current ones stream only what is new.
                                content = content && text.startsWith(content) ? text : content + text;
                                started ||= content.length > 0;
                                if (content.length > 24000) throw new BrowserAgentError('invalid-response', 'The built-in draft exceeded its output limit. Try fewer sections.');
                                if (Date.now() - lastUpdate > 1000) {
                                    emit(options.onProgress, { stage: 'generate', message: `${label || 'Writing on this device'} · ${content.length.toLocaleString()} characters`, attempt });
                                    lastUpdate = Date.now();
                                }
                            }
                            return content;
                        };
                        try { return await read(); }
                        catch (error) {
                            // A browser that refuses the per-position schema before writing anything gets the plain one once.
                            if (fallback || schemas.schema === schemas.fallback || started || signal.aborted || isAbort(error) || error instanceof BrowserAgentError || error?.name === 'QuotaExceededError') throw error;
                            fallback = true;
                            return await read();
                        }
                    }
                    finally { try { session?.destroy?.(); } catch { /* already gone */ } }
                }, options.signal, Math.max(1, deadline - Date.now()), 'Built-in AI took too long and was stopped. Try a shorter brief or fewer sections.');
                let content, complete = true;
                if (task.templateId === 'storyboard-builder' && task.sectionCount > 3) {
                    // Compact models repeat themselves over long scene lists, so scenes are written one at a time.
                    const sections = []; let title = '', summary = '';
                    for (let scene = 0; scene < task.sectionCount && complete; scene++) {
                        checkAbort(options.signal);
                        const step = sceneWritingStep(task, options, scene, sections, attempt === 2 ? errors : []);
                        try {
                            const parsed = JSON.parse(await generate(step.messages, { schema: step.schema, fallback: step.schema }, step.label));
                            if (!Array.isArray(parsed.sections) || parsed.sections.length !== 1 || !parsed.sections[0] || typeof parsed.title !== 'string' || typeof parsed.summary !== 'string') throw new SyntaxError('Incomplete scene.');
                            if (!scene) { title = parsed.title; summary = parsed.summary; }
                            sections.push(parsed.sections[0]);
                        }
                        catch (error) { if (!(error instanceof SyntaxError)) throw error; complete = false; }
                    }
                    content = JSON.stringify({ title, summary, sections });
                }
                else content = await generate(messages, { schema: task.decodingSchema, fallback: task.schema });
                checkAbort(options.signal);
                emit(options.onProgress, { stage: 'validate', message: 'Checking finished writing, section count, cast and art direction.', attempt });
                const checked = validateCreativeAgentOutput(task, content);
                errors = checked.success ? [] : checked.errors;
                if (!complete) errors.unshift('Finish every scene as complete JSON.');
                if (checked.success && !errors.length)
                    return { ...checked.artifact, model: BUILTIN_AGENT_MODEL.id, provider: 'builtin', templateId: task.templateId, attempts: attempt, decoding: 'schema' };
                if (attempt === 1) {
                    emit(options.onProgress, { stage: 'repair', message: 'The first draft needs a correction. Repairing it once on this device.', attempt: 2 });
                    messages.push({ role: 'user', content: `Write the corrected artifact from the original brief. Validation issues: ${errors.slice(0, 6).join(' ')} Return only complete JSON matching the schema.` });
                }
            }
            throw new BrowserAgentError('invalid-response', `The built-in model could not finish a valid draft after one repair. ${errors.slice(0, 2).join(' ')} Try a simpler brief or fewer sections.`);
        }
        catch (error) {
            if (isAbort(error) || error instanceof BrowserAgentError) throw error;
            const failure = error?.name === 'QuotaExceededError'
                ? new BrowserAgentError('invalid-input', 'This brief is too long for the browser’s built-in model. Shorten it or ask for fewer sections.')
                // The failure is explicit. No cloud or localhost model is contacted.
                : new BrowserAgentError('generation-failed', 'Built-in AI could not finish this draft. Try again or use a shorter brief. No server fallback was used.');
            failure.cause = error;
            throw failure;
        }
        finally { busy = false; }
    }
    /** Stops the current load or draft. The browser keeps its model, so there is nothing to unload. */
    function cancel() { active?.abort(); }
    return { status, load, run, cancel, unload: cancel };
}
/** The runtime bound to this browser's own `LanguageModel`; nothing to bundle and no worker. */
export function createBuiltinAgentRuntime() { return createBuiltinWritingRuntime(); }
