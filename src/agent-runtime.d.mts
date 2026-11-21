export type WritingAgentId = 'cast-notes' | 'style-brief' | 'storyboard-builder' | 'prompt-branches' | 'story-seed';
export type AgentErrorCode = 'unavailable' | 'model-missing' | 'invalid-response' | 'timeout' | 'unsafe-endpoint' | 'invalid-model' | 'invalid-input';
export declare class AgentRuntimeError extends Error { readonly code: AgentErrorCode; constructor(code: AgentErrorCode, message: string); }
export declare const LOCAL_AGENT_LIMITS: Readonly<{
    statusTimeoutMs: 4000; metadataTimeoutMs: 8000; generationTimeoutMs: 90000; responseBytes: 262144;
    modelBytes: number; contextTokens: 8192; outputTokens: 4096;
}>;
export type AgentProgress = { stage: 'plan' | 'generate' | 'validate' | 'repair'; message: string; attempt: 1 | 2 };
export type LocalModel = { name: string; size: number; family: string; parameterSize: string };
export type LocalModelStatus = {
    provider: 'ollama'; available: boolean; baseUrl: string; models: LocalModel[];
    suggestedModel: string | null; version: string | null;
    reason?: 'unavailable' | 'no-models' | 'invalid-response' | 'timeout'; message?: string;
};
/** baseUrl overrides Node host configuration OPTIMAI_OLLAMA_URL; only literal loopback HTTP is accepted. */
export type LocalAgentOptions = { signal?: AbortSignal; fetchImpl?: typeof fetch; baseUrl?: string };
export type CreativeAgentResult = {
    title: string; summary: string; sections: { heading: string; body: string }[]; studioPrompt: string;
    model: string; provider: 'ollama' | 'webllm' | 'builtin'; templateId: WritingAgentId; attempts: 1 | 2;
    /** `schema`: decoding followed the writing schema; `json`: JSON mode on an Ollama older than 0.5. */
    decoding?: 'schema' | 'json';
};
export type PreparedCreativeAgentTask = Readonly<{
    templateId: WritingAgentId; title: string; sectionCount: number; budget: number;
    /** Prompt-facing schema (the plain list form, text maxima fitted to the budget). */
    schema: Record<string, unknown>;
    /** Decoder-facing schema: fixed headings as one `prefixItems` slot each; the same object as `schema` otherwise. */
    decodingSchema: Record<string, unknown>;
    /** True when the longest output the schema admits fits `budget` (5% kept for JSON escapes). */
    fitsBudget: boolean;
    instructions: string; maxOutputTokens: number;
    messages: { role: 'system' | 'user'; content: string }[];
}>;
export type CreativeAgentArtifact = Pick<CreativeAgentResult, 'title' | 'summary' | 'sections' | 'studioPrompt'>;
/** Pure task contract; retain this task object when validating model output. */
export declare function prepareCreativeAgentTask(options: { templateId: WritingAgentId; values?: Record<string, string | number>; brief?: string }): PreparedCreativeAgentTask;
export declare function validateCreativeAgentOutput(task: PreparedCreativeAgentTask, content: string): { success: true; artifact: CreativeAgentArtifact } | { success: false; errors: string[] };
export declare function getLocalModelStatus(options?: LocalAgentOptions): Promise<LocalModelStatus>;
export declare function runCreativeAgent(options: LocalAgentOptions & {
    templateId: WritingAgentId; values?: Record<string, string | number>; brief?: string;
    model: string; onProgress?: (progress: AgentProgress) => void;
}): Promise<CreativeAgentResult>;
