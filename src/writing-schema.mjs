// Constrained writing output: the portable JSON Schema subset that local grammar engines
// (llama.cpp behind Ollama, XGrammar behind WebLLM) compile into a decoder, a bound on the
// longest JSON a schema admits, and the per-runtime request field that carries it.

/** Keywords both engines compile; anything else is ignored or rejected by one of them. */
export const CONSTRAINED_SCHEMA_KEYWORDS = Object.freeze(['type', 'properties', 'required', 'additionalProperties', 'items', 'prefixItems', 'minItems', 'maxItems', 'minLength', 'maxLength', 'enum', 'const']);
const KEYWORDS = new Set(CONSTRAINED_SCHEMA_KEYWORDS);
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);

/** Issues that would let a decoder wander (unbounded text or lists, open objects) or that an engine cannot compile; `[]` when safe. */
export function checkConstrainedSchema(schema, path = '$') {
    if (!isObject(schema)) return [`${path}: a schema must be an object`];
    const issues = [];
    for (const key of Object.keys(schema)) if (!KEYWORDS.has(key)) issues.push(`${path}: ${key} is not in the portable subset`);
    const choices = schema.enum ?? ('const' in schema ? [schema.const] : null);
    if (choices) {
        if (!Array.isArray(choices) || !choices.length || choices.some(value => typeof value !== 'string')) issues.push(`${path}: enum and const must be non-empty strings`);
        return issues;
    }
    if (schema.type === 'string') {
        if (!Number.isInteger(schema.maxLength)) issues.push(`${path}: text needs a maxLength`);
        else if ((schema.minLength ?? 0) > schema.maxLength) issues.push(`${path}: minLength is above maxLength`);
    } else if (schema.type === 'array') {
        if ('items' in schema && 'prefixItems' in schema) issues.push(`${path}: use prefixItems or items, not both (llama.cpp reads items first)`);
        const tuple = schema.prefixItems;
        if (tuple !== undefined && (!Array.isArray(tuple) || schema.minItems !== tuple.length || schema.maxItems !== tuple.length)) issues.push(`${path}: prefixItems needs minItems = maxItems = its length`);
        if (tuple === undefined && !Number.isInteger(schema.maxItems)) issues.push(`${path}: lists need a maxItems`);
        for (const [index, item] of (Array.isArray(tuple) ? tuple : [schema.items]).entries()) issues.push(...checkConstrainedSchema(item, `${path}[${Array.isArray(tuple) ? index : '*'}]`));
    } else if (schema.type === 'object') {
        const keys = Object.keys(schema.properties ?? {});
        if (schema.additionalProperties !== false) issues.push(`${path}: objects need additionalProperties: false`);
        if (!keys.length) issues.push(`${path}: objects need properties`);
        const required = new Set(schema.required ?? []);
        for (const key of keys) {
            if (!required.has(key)) issues.push(`${path}.${key}: every property must be required`);
            issues.push(...checkConstrainedSchema(schema.properties[key], `${path}.${key}`));
        }
    } else issues.push(`${path}: type must be string, array or object`);
    return issues;
}

/** Longest `JSON.stringify` output a schema admits, counting one character per text character (escapes such as `\"` add one each); `Infinity` when unbounded. */
export function maxJsonLength(schema) {
    if (!isObject(schema)) return Infinity;
    const choices = schema.enum ?? ('const' in schema ? [schema.const] : null);
    if (choices) return Math.max(...choices.map(value => JSON.stringify(value).length));
    if (schema.type === 'string') return Number.isInteger(schema.maxLength) ? schema.maxLength + 2 : Infinity;
    if (schema.type === 'array') {
        const items = Array.isArray(schema.prefixItems) ? schema.prefixItems.slice(0, schema.maxItems ?? Infinity).map(maxJsonLength)
            : Array.from({ length: Number.isInteger(schema.maxItems) ? schema.maxItems : 0 }, () => maxJsonLength(schema.items));
        if (!Array.isArray(schema.prefixItems) && !Number.isInteger(schema.maxItems)) return Infinity;
        return 2 + items.reduce((sum, length) => sum + length, 0) + Math.max(0, items.length - 1);
    }
    if (schema.type === 'object' && schema.additionalProperties === false) {
        const entries = Object.entries(schema.properties ?? {});
        return 2 + entries.reduce((sum, [key, value]) => sum + JSON.stringify(key).length + 1 + maxJsonLength(value), 0) + Math.max(0, entries.length - 1);
    }
    return Infinity;
}

/** The writing schema reduced to one section (one scene written at a time), with optional section property overrides. */
export function singleSectionSchema(schema, properties = {}) {
    const copy = structuredClone(schema), sections = copy.properties.sections;
    const item = sections.prefixItems?.[0] ?? sections.items;
    delete sections.prefixItems;
    sections.items = { ...item, properties: { ...item.properties, ...properties }, required: [...new Set([...item.required, ...Object.keys(properties)])] };
    sections.minItems = sections.maxItems = 1;
    return copy;
}

const versionAtLeast = (version, [major, minor]) => {
    const [a = 0, b = 0] = String(version || '0.0.0').split('.').map(Number);
    return a > major || (a === major && b >= minor);
};

/**
 * The request field that constrains decoding for a prepared writing task. `ollama` 0.5+ takes the schema as `format`
 * (older servers get JSON mode and the schema stays in the prompt); `webllm` takes `response_format`. `fallback: true`
 * uses the plain prompt schema, for a runtime that refused to compile the per-position one.
 */
export function writingFormat(task, { provider, version, fallback = false } = {}) {
    if (!isObject(task?.schema)) throw new TypeError('Pass a task from prepareCreativeAgentTask.');
    const schema = fallback || !isObject(task.decodingSchema) ? task.schema : task.decodingSchema;
    if (provider === 'ollama') return versionAtLeast(version, [0, 5]) ? { format: schema, decoding: 'schema' } : { format: 'json', decoding: 'json' };
    if (provider === 'webllm') return { response_format: { type: 'json_object', schema: JSON.stringify(schema) }, decoding: 'schema' };
    throw new TypeError('provider must be ollama or webllm.');
}
