import type { ToolTemplate } from './index.mjs';

export declare const AGENT_FORM_SCHEMA_VERSION: '1.0';
export type FormControl = 'text' | 'textarea' | 'select' | 'color' | 'slider' | 'stepper' | 'number' | 'seed';
/** `engine`: the on-device workspace reads it. `alias`: an older recipe name the engine maps when the canonical setting is missing. `brief`: shapes the prepared brief only. `unused`: neither (only possible for unreviewed templates). */
export type FormRole = 'engine' | 'alias' | 'brief' | 'unused';
export type FormGroupId = 'content' | 'look' | 'color' | 'layout' | 'motion';
export declare const FORM_CONTROLS: readonly FormControl[];
export declare const FORM_ROLES: readonly FormRole[];
export declare const FORM_GROUPS: readonly Readonly<{ id: FormGroupId; title: string }>[];
export type FormFieldHints = {
  control: FormControl;
  group: FormGroupId;
  /** Position in `x-ui.order`. */
  order: number;
  role: FormRole;
  /** Number controls only. */
  step?: number;
  /** Alias role only: the canonical setting it stands in for. */
  aliasOf?: string;
};
export type FormPropertySchema = {
  title: string;
  default: string | number;
  type: 'string' | 'integer';
  enum?: readonly string[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  pattern?: string;
  description?: string;
  'x-ui': FormFieldHints;
};
export type AgentFormSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema';
  $id: string;
  title: string;
  description?: string;
  type: 'object';
  additionalProperties: false;
  properties: Record<string, FormPropertySchema>;
  'x-ui': { version: '1.0'; groups: { id: FormGroupId; title: string; fields: string[] }[]; order: string[] };
  'x-optimai': { templateId: string; workspace: { kind: string; operation?: string }; contract: string };
};
export type FormField = {
  id: string;
  title: string;
  control: FormControl;
  group: FormGroupId;
  role: FormRole;
  step?: number;
  aliasOf?: string;
  /** The property schema without `x-ui`. */
  schema: Omit<FormPropertySchema, 'x-ui'>;
};
/** The role each setting plays for a template's workspace. Accepts an id or a template object. */
export function getAgentFieldRoles(idOrTemplate: string | Pick<ToolTemplate, 'id' | 'fields' | 'workspace'>): Record<string, FormRole>;
/**
 * JSON Schema 2020-12 for a template's recipe `values`, with the bounds `validateRecipeValues` enforces and
 * `x-ui` hints per setting. Returns a fresh object; throws for an unknown id or an unsupported setting.
 */
export function getAgentFormSchema(idOrTemplate: string | Pick<ToolTemplate, 'id' | 'fields' | 'workspace'> & Partial<Pick<ToolTemplate, 'title' | 'description'>>): AgentFormSchema;
/** The schema's settings in display order, flattened for a form renderer. */
export function listFormFields(schema: AgentFormSchema): FormField[];
/** The schema without `x-ui`/`x-optimai` hints, for strict validators and tool definitions such as MCP `inputSchema`. */
export function plainFormSchema(schema: AgentFormSchema): Omit<AgentFormSchema, 'x-ui' | 'x-optimai' | 'properties'> & { properties: Record<string, Omit<FormPropertySchema, 'x-ui'>> };
