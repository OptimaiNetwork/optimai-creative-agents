import type { PreparedCreativeAgentTask } from './agent-runtime.mjs';

export type ConstrainedSchemaKeyword = 'type' | 'properties' | 'required' | 'additionalProperties' | 'items' | 'prefixItems' | 'minItems' | 'maxItems' | 'minLength' | 'maxLength' | 'enum' | 'const';
/** Keywords both llama.cpp (Ollama) and XGrammar (WebLLM) compile into a decoder. */
export declare const CONSTRAINED_SCHEMA_KEYWORDS: readonly ConstrainedSchemaKeyword[];
/** Issues that would let a decoder wander (unbounded text or lists, open objects, optional properties) or fail to compile; `[]` when safe. */
export declare function checkConstrainedSchema(schema: unknown, path?: string): string[];
/** Longest `JSON.stringify` output the schema admits, one character per text character; `Infinity` when unbounded. */
export declare function maxJsonLength(schema: unknown): number;
/** The writing schema reduced to exactly one section, from either the `items` or `prefixItems` form, with optional section property overrides. */
export declare function singleSectionSchema<T extends Record<string, unknown>>(schema: T, properties?: Record<string, Record<string, unknown>>): T;
export type WritingDecoding = 'schema' | 'json';
export type OllamaWritingFormat = { format: Record<string, unknown> | 'json'; decoding: WritingDecoding };
export type WebLLMWritingFormat = { response_format: { type: 'json_object'; schema: string }; decoding: 'schema' };
/** The request field that constrains decoding: Ollama 0.5+ `format` (older: JSON mode), WebLLM `response_format`. `fallback` uses the plain prompt schema. */
export declare function writingFormat(task: PreparedCreativeAgentTask, options: { provider: 'ollama'; version?: string | null; fallback?: boolean }): OllamaWritingFormat;
export declare function writingFormat(task: PreparedCreativeAgentTask, options: { provider: 'webllm'; fallback?: boolean }): WebLLMWritingFormat;
