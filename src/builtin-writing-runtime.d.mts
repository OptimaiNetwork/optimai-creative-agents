import type { CreativeAgentResult, WritingAgentId } from './agent-runtime.mjs';
import type { BrowserAgentProgress } from './browser-writing-runtime.mjs';

/** The browser chooses the actual model; a host or recipe cannot. */
export declare const BUILTIN_AGENT_MODEL: Readonly<{ id: 'browser-built-in'; title: 'Browser built-in AI'; api: 'LanguageModel' }>;
/** The part of the Prompt API's `LanguageModel` this runtime calls. */
export type BuiltinLanguageModel = {
  availability(options?: Record<string, unknown>): Promise<string>;
  create(options?: Record<string, unknown>): Promise<{
    promptStreaming(input: string, options?: Record<string, unknown>): ReadableStream<string> | AsyncIterable<string>;
    destroy?(): void;
  }>;
};
export type BuiltinAgentSupport = {
  provider: 'builtin'; available: boolean; model: typeof BUILTIN_AGENT_MODEL;
  /** What the browser reports: `available` writes at once, `downloadable`/`downloading` need `load()` first. */
  state: 'unavailable' | 'downloadable' | 'downloading' | 'available';
  /** Base language tag the check was made for (`en` by default). */ language: string;
  reason?: 'api-unavailable' | 'device-unsupported' | 'language-unsupported' | 'timeout'; message?: string;
};
export type BuiltinAgentStatus = BuiltinAgentSupport & { ready: boolean; loading: boolean };
export type BuiltinAgentOptions = {
  signal?: AbortSignal; onProgress?: (progress: BrowserAgentProgress) => void;
  /** Language of the brief and the writing, as a BCP 47 tag; only its base (`ja` of `ja-JP`) is used. Default `en`. */
  language?: string;
};
export type BuiltinWritingRuntime = {
  /** Asks the browser only; never starts a download. */
  status(options?: { language?: string }): Promise<BuiltinAgentStatus>;
  /** Resolves at once when the browser has its model; otherwise the browser downloads it. Call from a click. */
  load(options?: BuiltinAgentOptions): Promise<void>;
  /** Rejects with the same `BrowserAgentError` codes as the WebLLM runtime. */
  run(options: BuiltinAgentOptions & { templateId: WritingAgentId; values?: Record<string, string | number>; brief?: string }): Promise<CreativeAgentResult>;
  cancel(): void; unload(): void;
};
/** Capability check: no session is created, so no model download can start. */
export declare function builtinSupport(options?: { languageModel?: BuiltinLanguageModel; language?: string; /** How long to wait for the browser's answer; 4000 ms by default. */ timeoutMs?: number }): Promise<BuiltinAgentSupport>;
/** Tests and embedders may inject the language model or the support check; task and validation contracts stay fixed. */
export declare function createBuiltinWritingRuntime(dependencies?: {
  languageModel?: BuiltinLanguageModel; support?(language: string): Promise<BuiltinAgentSupport>;
  statusTimeoutMs?: number; downloadTimeoutMs?: number; generationTimeoutMs?: number;
}): BuiltinWritingRuntime;
/** Bound to this browser's own `LanguageModel`: nothing to install, bundle or host. */
export declare function createBuiltinAgentRuntime(): BuiltinWritingRuntime;
