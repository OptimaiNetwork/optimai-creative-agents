export type ProgressStage = 'check' | 'download' | 'verify' | 'warmup' | 'prepare' | 'plan' | 'generate' | 'validate' | 'repair' | 'analyze' | 'render' | 'frame' | 'export' | 'ready';
/** One progress event for every engine. Bytes are `loaded`/`total`; counted work is `frame`/`frames`; `progress` is 0–1. */
export type ProgressEvent = Readonly<{
  stage: ProgressStage | (string & {}); message: string;
  loaded?: number; total?: number; frame?: number; frames?: number; attempt?: 1 | 2; progress?: number;
}>;
/** What engines and older hosts may send: a canonical event, or one with a legacy `phase`. */
export type ProgressInput = { stage?: string; phase?: string; message?: string; loaded?: number; total?: number; frame?: number; frames?: number; attempt?: number; progress?: number };
export type ProgressEngine = 'vision' | 'writing' | 'frame-sculpture' | 'canvas';
export type ProgressStep = { stage: string; label: string; state: 'done' | 'current' | 'pending' };
export declare const PROGRESS_STAGES: readonly ProgressStage[];
export declare const ENGINE_PROGRESS_STAGES: Readonly<Record<ProgressEngine, readonly ProgressStage[]>>;
export declare function progressStage(value: unknown): ProgressStage | (string & {});
export declare function normalizeProgress(event?: ProgressInput, defaults?: ProgressInput): ProgressEvent;
export declare function describeProgress(event?: ProgressInput): string;
export declare function progressSteps(stages: readonly string[] | ProgressEngine, event?: ProgressInput | null): ProgressStep[];
export declare function createProgressReporter(onProgress?: ((event: ProgressEvent) => void) | null, options?: { signal?: AbortSignal; defaults?: ProgressInput }): (stage: string, fields?: ProgressInput) => ProgressEvent | undefined;
