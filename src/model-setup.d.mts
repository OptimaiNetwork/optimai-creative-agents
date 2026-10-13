export type ModelSetupPolicy = { mode: 'automatic' | 'manual' | 'unsupported'; reason: string };
export declare function getModelSetupPolicy(model?: { bytes?: number; requiresWebGPU?: boolean }, environment?: { browser?: boolean; webGPU?: boolean; saveData?: boolean; effectiveType?: string; deviceMemory?: number }): ModelSetupPolicy;
