export type ToolCategory = 'image' | 'video' | 'writing' | 'experimental';
export type StudioMode = 'image' | 'video' | 'story' | 'character' | 'editor';
export type LocalOperation = 'image-filter' | 'image-resize' | 'image-grid' | 'type-overlay' | 'prompt-builder';
export type RecipeValues = Record<string, string | number>;
export type AgentCategory = ToolCategory;
export type AgentExecutionKind = 'browser' | 'browser-interactive' | 'local-model' | 'studio-guided';
export type CanvasLabOperation = 'mockup' | 'poster' | 'bento' | 'glitch' | 'letter' | 'blend' | 'transition' | 'print';
export type AgentWorkspace = (
  | { readonly kind: 'canvas'; readonly operation: Exclude<LocalOperation, 'prompt-builder'> | CanvasLabOperation }
  | { readonly kind: 'vision'; readonly operation: 'person-cutout' | 'pose-reference' | 'face-reference' }
  | { readonly kind: 'writing'; readonly operation: 'cast-notes' | 'style-brief' | 'storyboard-builder' | 'prompt-branches' | 'story-seed' }
  | { readonly kind: 'sketch'; readonly operation: 'draw' }
  | { readonly kind: '3d'; readonly operation: 'scene' }
  | { readonly kind: 'camera'; readonly operation: 'effects' | 'avatar' }
  | { readonly kind: 'music'; readonly operation: 'reactive' }
  | { readonly kind: 'frame'; readonly operation: 'sculpture' }
  | { readonly kind: 'workflow' }
) & { readonly headline?: string };
export interface ToolField {
  readonly id: string;
  readonly label: string;
  readonly type: 'text' | 'textarea' | 'select' | 'number';
  readonly default: string | number;
  readonly options?: readonly string[];
  readonly min?: number;
  readonly max?: number;
}
export interface ToolTemplate {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly sourceTemplate: string;
  readonly category: ToolCategory;
  readonly icon: string;
  readonly accent: string;
  readonly runtime: 'local' | 'studio';
  readonly localOperation?: LocalOperation;
  readonly studioMode: StudioMode;
  readonly promptTemplate: string;
  readonly fields: readonly ToolField[];
  readonly tags: readonly string[];
  readonly executionKind: AgentExecutionKind;
  readonly workspace: AgentWorkspace;
}
export interface ToolManifest {
  schemaVersion: '1.0';
  id: string;
  version: string;
  title: string;
  description: string;
  category: ToolCategory;
  license: 'MIT';
  capabilities: { network: 'none'; execution: 'declarative'; dataAccess: 'selected-inputs' };
  recipe: { templateId: string; values: RecipeValues; brief: string };
}
export type ManifestValidation = { success: true; manifest: ToolManifest; errors: string[] } | { success: false; manifest?: undefined; errors: string[] };
export type AgentField = ToolField;
export type AgentTemplate = ToolTemplate;
export type AgentManifest = ToolManifest;
export type AgentManifestValidation = ManifestValidation;
export declare const MANIFEST_VERSION: '1.0';
export declare const AGENT_WORKSPACE_CONTRACT_VERSION: '1.3';
export declare const MAX_PROMPT_LENGTH: number;
export declare const TOOL_CATALOG: readonly ToolTemplate[];
export declare const AGENT_CATALOG: readonly AgentTemplate[];
export declare const TOOL_MANIFEST_SCHEMA: Readonly<Record<string, unknown>>;
export declare const AGENT_MANIFEST_SCHEMA: Readonly<Record<string, unknown>>;
export declare const getAgentTemplate: typeof getToolTemplate;
export declare const getAgentExecutionKind: (id: string) => AgentExecutionKind | undefined;
export declare function getAgentWorkspace(id: string): AgentWorkspace | undefined;
export declare function validateAgentWorkspace(workspace: unknown): string[];
export type AgentInputNeed = 'canvas' | 'webgl' | 'webgpu' | 'web-audio' | 'worker' | 'wasm' | 'camera' | 'pointer' | 'media-recorder';
export interface AgentInputPolicy {
  readonly minFiles: number;
  readonly maxFiles: number;
  /** Value for an `<input type="file" accept>` attribute; empty when the agent takes no files. */
  readonly accept: string;
  /** Per-file byte cap; 0 when the agent takes no files. */
  readonly maxBytes: number;
  /** Browser features the agent cannot run without. */
  readonly needs: readonly AgentInputNeed[];
  /** Browser features that add tracking, export or faster models when present. */
  readonly optional: readonly AgentInputNeed[];
  /** True when the whole result is produced on the device, without a host production step. */
  readonly onDevice: boolean;
}
export declare const AGENT_INPUT_NEEDS: readonly AgentInputNeed[];
export declare function getAgentInputPolicy(id: string): AgentInputPolicy | undefined;
export declare function getToolTemplate(id: string): ToolTemplate | undefined;
export declare function validateRecipeValues(toolId: string, values: unknown): string[];
/** The JSON Schema a recipe value of this field must satisfy (the same bounds `validateRecipeValues` enforces). */
export declare function recipeFieldSchema(field: ToolField): Readonly<Record<string, unknown>>;
export declare function validateToolManifest(value: unknown): ManifestValidation;
export declare function createToolManifest(templateId: string, details: { id: string; title: string; description?: string; brief?: string }): ToolManifest;
export declare function compileToolPrompt(toolOrManifest: ToolTemplate | ToolManifest | string, values?: RecipeValues, brief?: string): string;
export declare const validateAgentManifest: typeof validateToolManifest;
export declare const createAgentManifest: typeof createToolManifest;
export declare const compileAgentPrompt: typeof compileToolPrompt;
export declare function verifyRegistry(): { success: boolean; errors: string[]; count: number };
