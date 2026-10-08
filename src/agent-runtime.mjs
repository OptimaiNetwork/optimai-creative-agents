import { compileAgentPrompt, getAgentTemplate, MAX_PROMPT_LENGTH } from './index.mjs';

/** Reviewed writing agents execute through installed local Ollama models only. */
export const LOCAL_AGENT_LIMITS = Object.freeze({
    statusTimeoutMs: 4000,
    metadataTimeoutMs: 8000,
    generationTimeoutMs: 90000,
    responseBytes: 262144,
    modelBytes: 8 * 1024 ** 3,
    contextTokens: 8192,
    outputTokens: 4096,
});

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const WRITING_IDS = new Set(['cast-notes', 'style-brief', 'storyboard-builder', 'prompt-branches', 'story-seed']);
const MODEL_NAME = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*){0,2}(?::[a-z0-9][a-z0-9._-]*)?$/i;
const HANDOFF_LABEL = '\n\nCompleted agent writing (creative input to review before production):\n';
const MODEL_FIELDS = {
    'cast-notes': ['Identity', 'Motivation', 'Strengths and limits', 'Character arc', 'Consistency notes'],
    'style-brief': ['Art direction', 'Palette', 'Line and material', 'Lighting', 'Composition', 'Things to avoid'],
    'story-seed': ['Premise', 'Cast', 'Setting', 'Chapter outline', 'Visual and production direction'],
};

export class AgentRuntimeError extends Error {
    constructor(code, message) { super(message); this.name = 'AgentRuntimeError'; this.code = code; }
}

function abortError() { return new DOMException('Agent run cancelled.', 'AbortError'); }
function checkAbort(signal) { if (signal?.aborted) throw abortError(); }
function failure(code, message) { throw new AgentRuntimeError(code, message); }

function localBaseUrl(value = DEFAULT_BASE_URL) {
    if (typeof value !== 'string' || value.length > 200) failure('unsafe-endpoint', 'Use a local Ollama HTTP endpoint on a loopback address.');
    let url;
    try { url = new URL(value); } catch { failure('unsafe-endpoint', 'Use a valid local Ollama HTTP endpoint.'); }
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)
        || (url.port && Number(url.port) < 1) || url.username || url.password !== '' || url.pathname !== '/' || url.search || url.hash) {
        failure('unsafe-endpoint', 'Only loopback Ollama HTTP endpoints are allowed, without credentials, paths, query strings or fragments.');
    }
    return url.origin;
}

function safeModelName(value) {
    return typeof value === 'string' && value.length <= 160 && MODEL_NAME.test(value) && !/cloud/i.test(value);
}

function remoteMetadata(value) {
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, entry]) => (/^(remote|cloud)(?:_|$)/i.test(key) && !!entry)
        || (key === 'details' && remoteMetadata(entry)));
}

async function readJson(response, signal) {
    const advertisedLength = Number(response.headers?.get?.('content-length'));
    if (advertisedLength > LOCAL_AGENT_LIMITS.responseBytes) failure('invalid-response', 'The local model returned too much data. Try a shorter brief.');
    if (!response.body?.getReader) failure('invalid-response', 'The local model returned an unreadable response. Update Ollama and try again.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0, text = '';
    try {
        while (true) {
            checkAbort(signal);
            const chunk = await raced(reader.read(), signal);
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > LOCAL_AGENT_LIMITS.responseBytes) failure('invalid-response', 'The local model returned too much data. Try a shorter brief.');
            text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
    checkAbort(signal);
    try { return JSON.parse(text); } catch { failure('invalid-response', 'Ollama returned invalid JSON. Update your local server and try again.'); }
}

function raced(work, signal) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const abort = () => { if (!settled) { settled = true; signal.removeEventListener('abort', abort); reject(abortError()); } };
        signal.addEventListener('abort', abort, { once: true });
        Promise.resolve(work).then(value => {
            signal.removeEventListener('abort', abort);
            if (!settled) { settled = true; resolve(value); }
        }, error => {
            signal.removeEventListener('abort', abort);
            if (!settled) { settled = true; reject(error); }
        });
        if (signal.aborted) abort();
    });
}

async function requestJson(baseUrl, path, { fetchImpl, signal, timeoutMs, body } = {}) {
    checkAbort(signal);
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
        const response = await raced(fetchImpl(`${baseUrl}${path}`, {
            method: body === undefined ? 'GET' : 'POST',
            redirect: 'error',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: controller.signal,
        }), controller.signal);
        if (response.redirected) failure('unsafe-endpoint', 'Ollama redirects are not allowed. Use a direct loopback endpoint.');
        if (!response.ok) {
            await response.body?.cancel?.().catch(() => {});
            if (response.status === 404 && path === '/api/show') failure('model-missing', 'That model is no longer installed. Refresh the model list and choose an installed model.');
            failure('unavailable', 'The local Ollama server could not complete this request. Check that it is running and up to date.');
        }
        return await raced(readJson(response, controller.signal), controller.signal);
    } catch (error) {
        if (signal?.aborted) throw abortError();
        if (timedOut) failure('timeout', 'The local model took too long. Try a shorter brief or a smaller installed model.');
        if (error instanceof AgentRuntimeError) throw error;
        failure('unavailable', 'Ollama is unavailable. Start your local Ollama server and try again.');
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
    }
}

function dependencies(options) {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') failure('unavailable', 'This runtime requires Node.js 20 or a fetch-compatible host.');
    // Configuration is host-owned, never a manifest field. Browser imports have
    // no process environment; Node consumers may point to another local port.
    const baseUrl = options.baseUrl === undefined && typeof process !== 'undefined'
        ? process.env?.OPTIMAI_OLLAMA_URL || undefined : options.baseUrl;
    return { baseUrl: localBaseUrl(baseUrl), fetchImpl, signal: options.signal };
}

/** Lists installed, bounded local completion models; never downloads a model. */
export async function getLocalModelStatus(options = {}) {
    const { baseUrl, fetchImpl, signal } = dependencies(options);
    checkAbort(signal);
    try {
        const tags = await requestJson(baseUrl, '/api/tags', { fetchImpl, signal, timeoutMs: LOCAL_AGENT_LIMITS.statusTimeoutMs });
        if (!tags || !Array.isArray(tags.models) || tags.models.length > 256) failure('invalid-response', 'Ollama returned an invalid model list.');
        const models = [], seen = new Set();
        for (const entry of tags.models) {
            const name = entry?.name;
            const family = typeof entry?.details?.family === 'string' ? entry.details.family.slice(0, 80) : '';
            if (!safeModelName(name) || seen.has(name) || remoteMetadata(entry) || /embed|minilm/i.test(`${name} ${family}`)
                || !Number.isSafeInteger(entry.size) || entry.size <= 0 || entry.size > LOCAL_AGENT_LIMITS.modelBytes) continue;
            seen.add(name);
            models.push({ name, size: entry.size, family, parameterSize: typeof entry.details?.parameter_size === 'string' ? entry.details.parameter_size.slice(0, 40) : '' });
        }
        models.sort((a, b) => a.size - b.size || a.name.localeCompare(b.name));
        let version = null;
        try {
            const info = await requestJson(baseUrl, '/api/version', { fetchImpl, signal, timeoutMs: LOCAL_AGENT_LIMITS.statusTimeoutMs });
            if (typeof info?.version === 'string' && /^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/i.test(info.version)) version = info.version;
        } catch { checkAbort(signal); }
        const suggested = ['qwen3.5:2b', 'qwen3.5:0.8b'].map(name => models.find(model => model.name === name)).find(Boolean) || models[0];
        return {
            provider: 'ollama', available: true, baseUrl, models, suggestedModel: suggested?.name ?? null, version,
            ...(models.length ? {} : { reason: 'no-models', message: 'No eligible local models are installed. Choose a local completion model of 8 GiB or smaller; cloud and embedding models are excluded.' }),
        };
    } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw abortError();
        if (error?.code === 'unsafe-endpoint') throw error;
        return { provider: 'ollama', available: false, baseUrl, models: [], suggestedModel: null, version: null, reason: error?.code || 'unavailable', message: error.message };
    }
}

function taskContract(templateId, values, template, brief) {
    const settings = Object.fromEntries(template.fields.map(field => [field.id, values[field.id] ?? field.default]));
    const headings = MODEL_FIELDS[templateId];
    const count = headings?.length ?? (templateId === 'storyboard-builder' ? settings.scenes : settings.branches);
    const kind = templateId === 'storyboard-builder' ? 'Scene' : 'Direction';
    const styles = [];
    if (settings.style === 'manga' || settings.form === 'manga' || /\bmanga\b|漫画|漫畫|マンガ/i.test(brief)) styles.push({ label: 'manga', pattern: /\bmanga\b|漫画|漫畫|マンガ|만화/i });
    const explicitStyles = {
        photographic: /photograph|photorealis|photo-real|写真|사진/i,
        illustrated: /illustrat|drawing|drawn|linework|ink|paint|manga|イラスト|插画|삽화/i,
        cinematic: /cinema|camera|lens|shot|filmic|映画|시네마/i,
        editorial: /editorial|magazine|publication|typograph|雑誌|편집/i,
    };
    if (Object.hasOwn(values, 'style') && explicitStyles[settings.style]) styles.push({ label: settings.style, pattern: explicitStyles[settings.style] });
    const anchors = [...brief.matchAll(/([\p{L}\p{N}_-]{2,40})\s+(?:vs\.?|versus)\s+([\p{L}\p{N}_-]{2,40})/giu)].flatMap(match => [match[1], match[2]]);
    // A common paired-cast brief has an explicit shared premise, e.g. "A
    // courier and a lost star find their way home". Retain these actor nouns in
    // every complete branch prompt, rather than letting a setting change erase
    // the cast. Complex prose is left to the model; this does not guess entities
    // from arbitrary text or rewrite its creative output.
    const pair = templateId === 'prompt-branches' && brief.match(/^(?:a|an|the)\s+((?:[\p{L}_-]+\s+){0,4}[\p{L}_-]+)\s+and\s+(?:(?:a|an|the)\s+)?((?:[\p{L}_-]+\s+){0,4}[\p{L}_-]+)\s+(?:find|follow|travel|help|search|explore|deliver|discover|build|save|work|return|head|go|learn|meet)\b/iu);
    const pairedActors = pair && !/\b(?:with|who|that)\b/i.test(`${pair[1]} ${pair[2]}`) ? [pair[1], pair[2]].map(phrase => phrase.split(/\s+/).at(-1)) : [];
    const branchAnchors = [...new Set([...anchors, ...pairedActors])];
    const genericBranchActors = new Set(pairedActors.filter(actor => /^[\p{Ll}_-]+$/u.test(actor) && !anchors.some(name => name.toLowerCase() === actor.toLowerCase())));
    const sharedPremise = pair ? brief.match(/^[^.!?\r\n]{10,300}(?:[.!?](?=\s|$)|$)/)?.[0].trim() || null : null;
    const styleSection = templateId === 'story-seed' ? 4 : ['style-brief', 'cast-notes'].includes(templateId) ? 0 : null;
    const stylePrefix = styles.map(style => style.label[0].toUpperCase() + style.label.slice(1)).join(' and ');
    const bodyFields = templateId === 'storyboard-builder'
        ? [{ id: 'purpose', label: 'Purpose', max: 200 }, { id: 'action', label: 'Action', max: 350 }, { id: 'visual', label: 'Visual', max: 250 }, { id: 'framing', label: 'Framing', max: 200 }, { id: 'dialogue', label: 'Dialogue', max: 250 }, { id: 'sound', label: 'Sound', max: 150 }]
        : templateId === 'prompt-branches'
            ? [{ id: 'sharedPremise', label: 'Shared premise', max: 350 }, { id: 'prompt', label: 'Prompt', max: 700 }, { id: 'difference', label: 'Difference', max: 350 }] : null;
    const bodyLabels = bodyFields?.map(field => field.label) ?? null;
    const direction = headings
        ? `Use these section headings exactly and in order: ${headings.join('; ')}.`
        : templateId === 'storyboard-builder'
            ? `Write exactly ${count} complete scenes in order. Heading format: Scene 1 — descriptive name. Each section must have separate string properties purpose, action, visual, framing, dialogue and sound; no body property. Write concrete scene-specific directions in each property. Keep the same cast and problem across scenes; the final scene resolves the original goal. Preserve the brief's emotional tone and age range; gentle humor calls for warm, lighthearted action, not tragic danger or a frightening ending.`
            : `Write exactly ${count} distinct creative directions. Heading format: Direction 1 — descriptive name. Each section must have separate string properties sharedPremise, prompt and difference; no body property. Every sharedPremise and prompt must preserve the user's central cast, problem and goal. Vary only the selected axis (${settings.axis}); do not replace the characters or their relationship with unrelated subjects. Each prompt is complete and usable without the other directions; difference explains the selected-axis change.`;
    const preservation = `${styles.length ? `Required art direction: ${styles.map(style => style.label).join(' and ')}. Explicitly name and describe this treatment ${styleSection === null ? 'in the writing' : `in section ${styleSection + 1} (${headings[styleSection]})`}; do not substitute a different medium.` : ''} ${anchors.length ? `Keep these central named subjects in the actual writing: ${[...new Set(anchors)].join(', ')}.` : ''}`;
    const label = bodyFields && stylePrefix ? ` Every section must have artDirection set to "${stylePrefix}". Its ${templateId === 'storyboard-builder' ? 'visual' : 'prompt'} property must describe concrete ${stylePrefix} treatment choices, not just a genre label.` : '';
    const cast = templateId === 'prompt-branches' && branchAnchors.length ? ` Each prompt property must explicitly include these central actors: ${branchAnchors.join(', ')}. Do not replace them with unrelated subjects.${sharedPremise ? ` Keep sharedPremise exactly ${JSON.stringify(sharedPremise)} in every section. The prompt's action and character relationship must remain consistent with this shared goal.` : ''}` : '';
    return { count, headings, direction: `${direction} ${preservation}${label}${cast}`, settings, styles, styleSection, anchors, branchAnchors, genericBranchActors, sharedPremise, kind, bodyLabels, bodyFields, stylePrefix };
}

function bodyPattern(contract) {
    return `^${contract.bodyLabels.map(label => `${label}: ${['Visual', 'Prompt'].includes(label) && contract.stylePrefix ? `${contract.stylePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\. ` : ''}[^\\r\\n]{8,}`).join('\\n')}$`;
}

function outputSchema(contract) {
    const properties = {
        heading: { type: 'string', minLength: 3, maxLength: 120, ...(contract.headings ? { enum: contract.headings } : {}) },
        ...(contract.bodyFields ? Object.fromEntries(contract.bodyFields.map(field => [field.id, { type: 'string', minLength: 8, maxLength: field.max,
            ...(field.id === 'sharedPremise' && contract.sharedPremise ? { enum: [contract.sharedPremise] } : {}) }]))
            : { body: { type: 'string', minLength: 40, maxLength: 1800 } }),
        ...(contract.bodyFields && contract.stylePrefix ? { artDirection: { type: 'string', enum: [contract.stylePrefix] } } : {}),
    };
    return {
        type: 'object', additionalProperties: false, required: ['title', 'summary', 'sections'],
        properties: {
            title: { type: 'string', minLength: 3, maxLength: 120 },
            summary: { type: 'string', minLength: 20, maxLength: 600 - (contract.bodyFields && contract.stylePrefix ? contract.stylePrefix.length + 2 : 0) },
            sections: {
                type: 'array', minItems: contract.count, maxItems: contract.count,
                items: { type: 'object', additionalProperties: false, required: Object.keys(properties), properties },
            },
        },
    };
}

function textValue(value, min, max) {
    return typeof value === 'string' && value.trim().length >= min && value.length <= max
        && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}

function objectKeys(value, keys) {
    return value && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function normalizeSections(value, contract) {
    if (contract.headings || !Array.isArray(value?.sections)) return value;
    // Scene/direction ordering is already represented by the array. Numbering is
    // presentation, so the host supplies it instead of failing finished writing
    // merely because a small model forgot an ordinal in its heading.
    value.sections = value.sections.map((section, index) => {
        if (typeof section?.heading !== 'string') return;
        const label = section.heading.trim().replace(/^(?:Scene|Direction)\s+\d+\s*(?:[—:.-]\s*)?/i, '').trim().slice(0, 95);
        const heading = `${contract.kind} ${index + 1}${label ? ` — ${label}` : ''}`;
        const body = contract.bodyFields.map(field => `${field.label}: ${['visual', 'prompt'].includes(field.id) && contract.stylePrefix ? `${section.artDirection}. ` : ''}${section[field.id].trim().replace(/\s*\n\s*/g, ' ')}`).join('\n');
        return { heading, body };
    });
    if (contract.stylePrefix && typeof value.summary === 'string') value.summary = `${contract.stylePrefix}. ${value.summary}`;
    return value;
}

function validateModelFields(value, contract) {
    if (!contract.bodyFields) return [];
    const errors = [], keys = ['heading', ...contract.bodyFields.map(field => field.id), ...(contract.stylePrefix ? ['artDirection'] : [])];
    if (!objectKeys(value, ['title', 'summary', 'sections']) || !Array.isArray(value.sections) || value.sections.length !== contract.count) return [`Return title, summary and exactly ${contract.count} sections with these properties: ${keys.join(', ')}.`];
    value.sections.forEach((section, index) => {
        if (!objectKeys(section, keys)) { errors.push(`Section ${index + 1} must have only these properties: ${keys.join(', ')}. Do not merge properties into a body string.`); return; }
        if (!textValue(section.heading, 3, 120)) errors.push(`Section ${index + 1} needs a short descriptive heading.`);
        for (const field of contract.bodyFields) if (!textValue(section[field.id], 8, field.max)
            || /^(todo|tbd|placeholder|lorem ipsum|coming soon|insert (text|content)|i cannot|as an ai)\b/i.test(section[field.id].trim())) errors.push(`Section ${index + 1} ${field.id} must contain finished writing of 8–${field.max} characters.`);
        if (contract.stylePrefix && section.artDirection !== contract.stylePrefix) errors.push(`Section ${index + 1} artDirection must be ${contract.stylePrefix}, with concrete corresponding visual direction.`);
        if (contract.sharedPremise && section.sharedPremise !== contract.sharedPremise) errors.push(`Section ${index + 1} sharedPremise must stay exactly ${JSON.stringify(contract.sharedPremise)}. Vary the selected axis without replacing the original goal.`);
    });
    return errors.slice(0, 6);
}

function validateOutput(value, contract, budget) {
    const errors = [];
    if (!objectKeys(value, ['title', 'summary', 'sections'])) return ['Return only title, summary and sections.'];
    if (!textValue(value.title, 3, 120)) errors.push('Title must be 3–120 characters.');
    if (!textValue(value.summary, 20, 600)) errors.push('Summary must be 20–600 characters.');
    if (!Array.isArray(value.sections) || value.sections.length !== contract.count) errors.push(`Return exactly ${contract.count} sections.`);
    else {
        const bodies = new Set(), actions = new Set(), prompts = new Set();
        value.sections.forEach((section, index) => {
            if (!objectKeys(section, ['heading', 'body']) || !textValue(section.heading, 3, 120) || !textValue(section.body, 40, 1800)) {
                errors.push(`Section ${index + 1} needs a heading and a complete body of 40–1800 characters.`);
                return;
            }
            if (contract.headings && section.heading.trim().toLowerCase() !== contract.headings[index].toLowerCase()) errors.push(`Section ${index + 1} heading must be ${contract.headings[index]}.`);
            if (contract.bodyLabels && !new RegExp(bodyPattern(contract)).test(section.body)) errors.push(`Section ${index + 1} needs complete labeled lines in this order: ${contract.bodyLabels.join(', ')}.${contract.stylePrefix ? ` Its ${contract.kind === 'Scene' ? 'Visual' : 'Prompt'} line must begin ${contract.stylePrefix}.` : ''}`);
            if (contract.kind === 'Direction' && !contract.headings) {
                const promptLine = section.body.split('\n').find(line => line.startsWith('Prompt: ')) || '';
                const normalizedPrompt = promptLine.toLocaleLowerCase().replace(/^prompt: /,'').replace(/[^\p{L}\p{N}]+/gu,' ').split(/\s+/).filter(word=>!['a','an','the','dynamic','beautiful','stunning','detailed'].includes(word)).join(' ').trim();
                if (prompts.has(normalizedPrompt)) errors.push('Directions repeat the same prompt with minor qualifiers. Provide distinct approaches along the selected axis.');
                prompts.add(normalizedPrompt);
                for (const actor of contract.branchAnchors) {
                    // Recognized common nouns can be inflected normally. Named
                    // versus subjects and proper names still require exact
                    // whole words; "star" never matches "start" or "starry".
                    const plural = contract.genericBranchActors.has(actor) ? '(?:s|es)?' : '';
                    if (!new RegExp(`(?:^|[^\\p{L}\\p{N}_])${actor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${plural}(?:$|[^\\p{L}\\p{N}_])`, 'iu').test(promptLine)) errors.push(`Direction ${index + 1} Prompt must retain the central actor ${actor}.`);
                }
            }
            if (contract.kind === 'Scene' && !contract.headings) actions.add((section.body.split('\n').find(line=>line.startsWith('Action: ')) || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim());
            const normalized = section.body.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
            if ((normalized.split(/\s+/).length < 8 && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(normalized))
                || /^(todo|tbd|placeholder|lorem ipsum|coming soon|insert (text|content)|i cannot|as an ai)\b/i.test(normalized)) errors.push(`Section ${index + 1} needs finished writing, without placeholders.`);
            const sentences = section.body.split(/(?<=[.!?])\s+/).map(sentence => sentence.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()).filter(sentence => sentence.length >= 35);
            if (sentences.length >= 3 && new Set(sentences).size < sentences.length * .65) errors.push(`Section ${index + 1} repeats sentences instead of developing useful content.`);
            if (/\b(?:section|property|field)\b[^.!?\n]{0,100}\b(?:must be|must have|must contain|must explicitly|matching the schema)\b/i.test(section.body)) errors.push(`Section ${index + 1} echoes formatting instructions. Write finished creative content instead.`);
            if (bodies.has(normalized)) errors.push('Sections must contain distinct writing, not repeated filler.');
            bodies.add(normalized);
        });
        if (contract.kind === 'Scene' && !contract.headings && contract.count >= 4 && actions.size < Math.ceil(contract.count / 2)) errors.push('Scenes repeat the same action. Develop the shared goal with distinct actions and a resolution.');
    }
    if (contract.bodyLabels && contract.stylePrefix && (typeof value.summary !== 'string' || !value.summary.startsWith(`${contract.stylePrefix}. `))) errors.push(`Begin the summary with ${contract.stylePrefix}. and describe the story or directions.`);
    const styleText = contract.styleSection === null ? JSON.stringify(value) : value.sections?.[contract.styleSection]?.body || '';
    for (const style of contract.styles) if (!style.pattern.test(styleText)) errors.push(`Explicitly preserve the requested ${style.label} art direction ${contract.styleSection === null ? 'in the writing' : `in ${contract.headings[contract.styleSection]}`}.`);
    const writing = JSON.stringify(value).toLocaleLowerCase();
    for (const anchor of new Set(contract.anchors)) if (!writing.includes(anchor.toLocaleLowerCase())) errors.push(`Preserve the user's central subject ${anchor} in the actual writing.`);
    if (contract.styles.some(style => style.label === 'manga') && /(?:simplified|flat|cute) vector (?:art|style|illustration)/i.test(styleText)) errors.push('Preserve the requested manga art direction instead of replacing it with vector art.');
    if (JSON.stringify(value).length > budget) errors.push(`Keep the complete JSON artifact within ${budget} characters by shortening bodies.`);
    return errors.slice(0, 6);
}

function progress(callback, stage, message, attempt) {
    callback?.({ stage, message, attempt });
}

function supportsSchema(version) {
    const [major, minor] = (version || '0.0.0').split('.').map(Number);
    return major > 0 || minor >= 5;
}

const preparedTasks = new WeakMap();

/** Pure reviewed writing contract; usable by a browser model without Ollama. */
export function prepareCreativeAgentTask(options) {
    if (!options || typeof options !== 'object' || !WRITING_IDS.has(options.templateId)) failure('invalid-input', 'Choose one of the five reviewed writing agents.');
    const { templateId } = options;
    const template = getAgentTemplate(templateId);
    const values = options.values === undefined ? {} : options.values, brief = options.brief === undefined ? '' : options.brief;
    let compiled;
    try { compiled = compileAgentPrompt(templateId, values, brief); }
    catch (error) { failure('invalid-input', error.message); }
    const contract = taskContract(templateId, values, template, brief);
    const budget = Math.min(18000, MAX_PROMPT_LENGTH - compiled.length - HANDOFF_LABEL.length);
    if (budget < 1200) failure('invalid-input', 'Shorten your brief and settings to leave room for the generated writing.');
    const schema = outputSchema(contract);
    const instructions = `You are a creative writing agent. Perform the requested writing now; do not merely repeat instructions or describe how to request it. Preserve the user's characters, subject, requested language, audience and art direction. No tools, browsing, shell commands or publishing. Return ONLY a JSON object matching the schema below, with finished useful writing. ${contract.direction} Keep bodies concise, concrete and distinct; total JSON must fit ${budget} characters. Do not add markdown fences or thinking.\nSchema: ${JSON.stringify(schema)}`;
    const task = Object.freeze({ templateId, title: template.title, sectionCount: contract.count, budget, schema, instructions,
        messages: [{ role: 'system', content: instructions }, { role: 'user', content: compiled }],
        maxOutputTokens: Math.min(LOCAL_AGENT_LIMITS.outputTokens, Math.max(1200, contract.count * 240 + 900), Math.ceil(budget / 3)) });
    preparedTasks.set(task, { contract, compiled });
    return task;
}

/** Parses actual model writing and returns useful validation issues for one repair. */
export function validateCreativeAgentOutput(task, content) {
    const prepared = preparedTasks.get(task);
    if (!prepared) failure('invalid-input', 'Use the task object returned by prepareCreativeAgentTask.');
    if (typeof content !== 'string' || content.length > 24000) return { success: false, errors: ['Return a complete bounded JSON artifact.'] };
    let output, errors = [];
    try {
        const parsed = JSON.parse(content);
        errors.push(...validateModelFields(parsed, prepared.contract));
        if (!errors.length) output = normalizeSections(parsed, prepared.contract);
    } catch { errors.push('Return valid JSON without markdown fences or commentary.'); }
    if (output) errors.push(...validateOutput(output, prepared.contract, task.budget));
    else if (!errors.length) errors.push('Return a JSON object with finished writing.');
    if (errors.length) return { success: false, errors: errors.slice(0, 6) };
    const artifact = { title: output.title.trim(), summary: output.summary.trim(), sections: output.sections.map(section => ({ heading: section.heading.trim(), body: section.body.trim() })) };
    return { success: true, artifact: { ...artifact, studioPrompt: prepared.compiled + HANDOFF_LABEL + JSON.stringify(artifact) } };
}

/** Executes finished writing, validates it, and repairs once; never fabricates a fallback. */
export async function runCreativeAgent(options) {
    if (!options || typeof options !== 'object') failure('invalid-input', 'Choose a writing agent and provide a creative brief.');
    const { templateId, model, signal, onProgress } = options;
    if (!WRITING_IDS.has(templateId)) failure('invalid-input', 'This runner supports the five reviewed writing agents only.');
    if (!safeModelName(model)) failure('invalid-model', 'Choose an installed local model. Cloud models and remote model names are not allowed.');
    const task = prepareCreativeAgentTask(options);
    const { baseUrl, fetchImpl } = dependencies(options);
    checkAbort(signal);
    progress(onProgress, 'plan', `Planning ${task.sectionCount} finished sections for ${task.title}.`, 1);
    const status = await getLocalModelStatus({ baseUrl, fetchImpl, signal });
    if (!status.available) failure(status.reason || 'unavailable', status.message || 'Start your local Ollama server and try again.');
    if (!status.models.some(entry => entry.name === model)) failure('model-missing', 'That model is not installed or is not eligible for local execution. Refresh the model list and choose an installed local completion model.');
    const metadata = await requestJson(baseUrl, '/api/show', { fetchImpl, signal, timeoutMs: LOCAL_AGENT_LIMITS.metadataTimeoutMs, body: { model, name: model } });
    if (remoteMetadata(metadata)) failure('invalid-model', 'This model uses a remote or cloud provider. Choose a local model with installed weights.');
    if (Array.isArray(metadata?.capabilities) && !metadata.capabilities.includes('completion')) failure('invalid-model', 'This model cannot write stories or briefs. Choose a local completion model.');
    if (!metadata || typeof metadata !== 'object' || !metadata.model_info || typeof metadata.model_info !== 'object' || Array.isArray(metadata.model_info) || !Object.keys(metadata.model_info).length) {
        failure('invalid-model', 'Local model weights could not be verified. Choose an installed local completion model and update Ollama if needed.');
    }
    const messages = [...task.messages];
    let lastErrors = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
        checkAbort(signal);
        progress(onProgress, 'generate', attempt === 1 ? `Writing with ${model} on this computer.` : 'Writing a corrected version on this computer.', attempt);
        const response = await requestJson(baseUrl, '/api/chat', {
            fetchImpl, signal, timeoutMs: LOCAL_AGENT_LIMITS.generationTimeoutMs,
            body: { model, stream: false, think: false, keep_alive: '2m', format: supportsSchema(status.version) ? task.schema : 'json', messages,
                options: { num_ctx: LOCAL_AGENT_LIMITS.contextTokens, num_predict: task.maxOutputTokens, temperature: .65 } },
        });
        checkAbort(signal);
        progress(onProgress, 'validate', 'Checking structure, section count and usable writing.', attempt);
        const content = response?.message?.content;
        let validated;
        lastErrors = [];
        if ((response?.model !== undefined && response.model !== model) || typeof content !== 'string' || content.length > 24000 || response?.done !== true) lastErrors.push('Return a complete, bounded JSON artifact from the selected local model.');
        else {
            validated = validateCreativeAgentOutput(task, content);
            if (!validated.success) lastErrors.push(...validated.errors);
        }
        if (!lastErrors.length) {
            return { ...validated.artifact, model, provider: 'ollama', templateId, attempts: attempt };
        }
        if (attempt === 1) {
            progress(onProgress, 'repair', 'The first draft needs a correction. Repairing it once.', 2);
            messages.push({ role: 'assistant', content: typeof content === 'string' ? content.slice(0, 12000) : '{}' },
                { role: 'user', content: `Repair the writing. Validation issues: ${lastErrors.join(' ')} Follow the original brief and schema. Return only the corrected JSON object.` });
        }
    }
    failure('invalid-response', `The local model could not produce a valid artifact after one repair. ${lastErrors.join(' ')} Try a shorter brief or another installed model.`);
}
