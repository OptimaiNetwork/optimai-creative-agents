import type { ToolTemplate } from './index.mjs';
import type { AgentFormSchema, FormField } from './form-schema.mjs';

export type PlaygroundRunner = 'canvas-lab' | 'local-tool' | 'vision';
export declare const PLAYGROUND_RUNNERS: readonly PlaygroundRunner[];
export declare const PLAYGROUND_LIMITS: Readonly<{ stateLength: number; seed: number }>;
export type PlaygroundAgent = Readonly<{
  id: string;
  title: string;
  description: string;
  category: string;
  kind: 'canvas' | 'vision';
  operation: string;
  runner: PlaygroundRunner;
  inputs: Readonly<{ min: number; max: number; accept: string }>;
  /** The pinned model a vision agent downloads before its first run; null for canvas agents. */
  setup: Readonly<{ model: string; name: string; bytes: number }> | null;
}>;
export type FormValue = string | number;
/** Every catalog agent a playground can run from a form alone, in catalog order. */
export function listPlaygroundAgents(options?: { runners?: readonly PlaygroundRunner[] }): PlaygroundAgent[];
/** `{ id: default }` for every setting of a form schema. */
export function formDefaults(schema: AgentFormSchema): Record<string, FormValue>;
/**
 * A raw control value read into one the schema accepts: numbers parsed, rounded and clamped (empty falls back to the
 * default), choices and malformed hex colors fall back, text is cut to its limit. `partial` keeps an unfinished hex while typing.
 */
export function readFormValue(field: FormField, raw: unknown, options?: { partial?: boolean }): FormValue;
/** The `#rrggbb` an `<input type="color">` accepts for a recipe hex (`#abc` expands); anything else gives `fallback` (default `#000000`). */
export function colorInputValue(value: unknown, fallback?: string): string;
/** A new seed within the field's bounds that differs from `current`. */
export function rerollSeed(field: Pick<FormField, 'schema'>, current?: number, random?: () => number): number;
export type PlaygroundRunPlan =
  | { runner: 'canvas-lab'; operation: string; settings: Record<string, unknown> }
  | { runner: 'local-tool'; operation: 'image-filter' | 'image-resize' | 'image-grid' | 'type-overlay'; settings: Record<string, FormValue> }
  | { runner: 'vision'; operation: 'person-cutout' | 'pose-reference' | 'face-reference'; settings: Record<string, unknown>; model: Readonly<{ id: string; name: string; bytes: number; sha256: string; url: string; task: string }> };
/** How to run an agent with recipe values. Throws with the validator's messages for values a recipe would refuse. */
export function playgroundRunPlan(idOrTemplate: string | Pick<ToolTemplate, 'id'>, values?: Record<string, FormValue>): PlaygroundRunPlan;
/** A short query string holding the agent and only the settings that differ from its defaults. */
export function encodePlaygroundState(state: { agent: string; values?: Record<string, FormValue> }): string;
/** Reads a share link's query or hash as untrusted text; null for an unknown or missing agent or an oversized link. */
export function decodePlaygroundState(text: string): { agent: string; values: Record<string, FormValue>; dropped: string[] } | null;
