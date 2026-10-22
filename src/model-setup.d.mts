export type ModelSetupPolicy = { mode: 'automatic' | 'manual' | 'unsupported'; reason: string };
export declare function getModelSetupPolicy(model?: { bytes?: number; requiresWebGPU?: boolean }, environment?: { browser?: boolean; webGPU?: boolean; saveData?: boolean; effectiveType?: string; deviceMemory?: number }): ModelSetupPolicy;
export declare function formatBytes(bytes: number): string;
export declare function describeModelProgress(progress?: { loaded?: number; total?: number; progress?: number }): string;
export type ModelSetupDescription = { download: string; runtime: string; memory: string; label: string };
export declare function describeModelSetup(model?: { bytes?: number; downloadBytes?: number; gpuBytes?: number; gpuMemoryMB?: number; runtimeBytes?: number }): ModelSetupDescription;
export type ModelSetupStateName = 'idle' | 'checking' | 'downloading' | 'verifying' | 'ready' | 'failed' | 'unsupported';
export type ModelSetupState = Readonly<{
  state: ModelSetupStateName; loaded: number; total?: number; progress?: number; progressLabel: string;
  message: string; detail: string; reason: string; automatic: boolean; cached: boolean; error: { code: string; message: string } | null;
}>;
export type ModelSetupProgressEvent = { stage?: string; phase?: string; loaded?: number; total?: number; progress?: number; message?: string };
export type ModelSetupCheck = { ready?: boolean; available?: boolean; loading?: boolean; cached?: boolean; message?: string };
export type ModelSetupController = {
  getState(): ModelSetupState;
  subscribe(listener: (state: ModelSetupState) => void): () => void;
  check(options?: { autoStart?: boolean }): Promise<ModelSetupState>;
  start(options?: { automatic?: boolean }): Promise<ModelSetupState>;
  abort(): ModelSetupState;
  reset(options?: { state?: 'idle' | 'unsupported'; message?: string; reason?: string }): ModelSetupState;
  dispose(): void;
};
export declare function createModelSetupController(options: {
  load: (options: { signal: AbortSignal; onProgress: (event: ModelSetupProgressEvent) => void }) => Promise<unknown>;
  check?: (options: { signal: AbortSignal }) => Promise<ModelSetupCheck> | ModelSetupCheck;
  cancel?: () => void; bytes?: number; name?: string; policy?: ModelSetupPolicy | (() => ModelSetupPolicy); pollMs?: number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}): ModelSetupController;
