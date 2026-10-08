import type { AppConfig, MLCEngineInterface, MLCEngineConfig } from '@mlc-ai/web-llm';
import type { CreativeAgentResult, WritingAgentId } from './agent-runtime.mjs';

export declare const BROWSER_AGENT_MODEL: Readonly<{
  id: 'Qwen3.5-0.8B-q4f16_1-MLC'; title: 'Qwen 3.5 · 0.8B'; license: 'Apache-2.0';
  downloadBytes: 453205372; gpuMemoryMB: 1629.49;
  modelRevision: '0ec138972555613c1d7812a821778ad0398c8790';
  libraryRevision: '025bcaf3780fa8254f5e5efd3bfea0a5397248f4'; contextTokens: 4096;
}>;
export declare const BROWSER_AGENT_APP_CONFIG: AppConfig;
export type BrowserAgentProgress = {
  stage: 'download' | 'ready' | 'plan' | 'generate' | 'validate' | 'repair';
  message: string; progress?: number; attempt?: 1 | 2;
};
export type BrowserAgentStatus = {
  provider: 'webllm'; available: boolean; ready: boolean; loading: boolean;
  model: typeof BROWSER_AGENT_MODEL;
  reason?: 'insecure-context' | 'webgpu-unavailable' | 'gpu-limits' | 'worker-unavailable'; message?: string;
};
export type BrowserAgentOptions = { signal?: AbortSignal; onProgress?: (progress: BrowserAgentProgress) => void };
export declare class BrowserAgentError extends Error {
  readonly code: 'unsupported' | 'not-ready' | 'busy' | 'download-failed' | 'generation-failed' | 'invalid-response' | 'timeout' | 'invalid-input';
  constructor(code: BrowserAgentError['code'], message: string);
}
export type BrowserWritingRuntime = {
  status(): Promise<BrowserAgentStatus>;
  load(options?: BrowserAgentOptions): Promise<void>;
  run(options: BrowserAgentOptions & { templateId: WritingAgentId; values?: Record<string, string | number>; brief?: string }): Promise<CreativeAgentResult>;
  cancel(): void; unload(): void;
};
export type BrowserWritingEngineSession = { engine: MLCEngineInterface; worker: Worker; failure: Promise<never> };
/** Tests/embedding may inject local engine lifecycle, but task/model contracts remain fixed. */
export declare function createBrowserWritingRuntime(dependencies: {
  support(): Promise<Omit<BrowserAgentStatus, 'ready' | 'loading'>>;
  createSession(onProgress: (progress: BrowserAgentProgress) => void): Promise<BrowserWritingEngineSession>;
  downloadTimeoutMs?: number; generationTimeoutMs?: number;
}): BrowserWritingRuntime;
/** No model is downloaded during capability checks. */
export declare function browserSupport(): Promise<Omit<BrowserAgentStatus, 'ready' | 'loading'>>;
/** Factories refer only to locally bundled engine and worker code in the embedding app. */
export declare function createBrowserAgentRuntime(options: {
  createWorker: () => Worker;
  loadEngine: () => Promise<{ WebWorkerMLCEngine: new (worker: Worker, config: MLCEngineConfig) => MLCEngineInterface }>;
}): BrowserWritingRuntime;
