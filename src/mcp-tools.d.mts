import type { AgentTemplate } from './index.d.mts';
type AgentRef = string | Pick<AgentTemplate, 'id'>;
export declare const MCP_PROTOCOL_VERSION: '2025-11-25';
export declare const MCP_RESOURCE_SCHEME: 'optimai-agents';
export type McpIcon = { src: string; mimeType: 'image/svg+xml'; sizes: ['any'] };
export type McpJsonSchema = { type: 'object'; [keyword: string]: unknown };
export type McpToolDefinition = {
  name: string; title: string; description: string; icons?: McpIcon[];
  inputSchema: McpJsonSchema; outputSchema: McpJsonSchema;
  annotations: { readOnlyHint: true; destructiveHint: false; idempotentHint: boolean; openWorldHint: false };
};
export type McpPreparedRecipe = {
  templateId: string; runtime: string; workspace: AgentTemplate['workspace']; studioMode: string; localOperation?: string;
  values: Record<string, string | number>; prompt: string;
};
export type McpResource = { uri: string; name: string; title: string; mimeType: 'image/svg+xml' };
export type McpRecipeExport =
  | { type: 'resource_link'; uri: string; name: string; title: string; mimeType: 'image/svg+xml' }
  | { type: 'resource'; resource: { uri: string; mimeType: 'application/json'; text: string } };
/** `optimai.<id>` by default; `prefix` and `separator` (replacing `-`) customise it. Throws for unknown agents. */
export declare function mcpToolName(agent: AgentRef, options?: { prefix?: string; separator?: string }): string;
export declare function mcpToolIconSvg(agent: AgentRef): string;
export declare function mcpToolIcons(agent: AgentRef): McpIcon[];
export declare function mcpOutputSchema(agent: AgentRef, options?: { run?: boolean }): McpJsonSchema;
export declare function mcpToolDefinition(agent: AgentRef, options?: { name?: string; icons?: boolean; run?: boolean }): McpToolDefinition;
/** Sorted by name (code point order). `ids` limits the list. */
export declare function mcpToolDefinitions(options?: { ids?: readonly string[]; prefix?: string; separator?: string; icons?: boolean; run?: boolean }): McpToolDefinition[];
export declare function prepareMcpRecipe(agent: AgentRef, values?: Record<string, string | number>, brief?: string): McpPreparedRecipe;
export declare function mcpArtworkUri(agent: AgentRef): string;
export declare function mcpArtworkId(uri: unknown): string | undefined;
export declare function mcpArtworkResources(): McpResource[];
export declare function mcpRecipeManifest(agent: AgentRef, values?: Record<string, string | number>, brief?: string): import('./index.d.mts').AgentManifest;
export declare function mcpRecipeExports(agent: AgentRef, values?: Record<string, string | number>, brief?: string): McpRecipeExport[];
