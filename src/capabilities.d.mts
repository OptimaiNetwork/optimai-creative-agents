import type { AgentInputNeed, AgentInputPolicy } from './index.mjs';

export type CreativeCapability = AgentInputNeed | 'canvas-filter' | 'webcodecs';
export type CapabilityReport = Readonly<{
  version: string;
  /** False outside a browser (no DOM canvas and no OffscreenCanvas). */
  browser: boolean;
  /** True once `probeCreativeCapabilities` confirmed WebGPU and the camera; false for a sync report or an aborted probe. */
  probed: boolean;
  features: Readonly<Record<CreativeCapability, boolean>>;
  device: Readonly<{ memoryGB?: number; cores?: number; saveData?: boolean; effectiveType?: string; reducedMotion?: boolean; coarsePointer?: boolean }>;
  /** Present when a WebGPU adapter was found; `fallback` marks a software adapter. */
  gpu?: Readonly<{ fallback: boolean }>;
}>;
export type CapabilityStatus = 'ready' | 'limited' | 'slow' | 'unsupported';
export type CapabilityAssessment = Readonly<{
  status: CapabilityStatus;
  /** The first line to show on a card; empty when ready. */
  message: string;
  /** Hard needs this browser lacks. */
  missing: readonly AgentInputNeed[];
  /** Optional features this browser lacks. */
  unavailable: readonly AgentInputNeed[];
  notes: readonly string[];
}>;
/** The globals a probe reads; pass a stand-in to test or to probe a worker scope. */
export type CapabilityEnvironment = Partial<Record<string, unknown>> & { navigator?: Record<string, any>; document?: { createElement?: (tag: string) => any } };
export declare const CAPABILITY_REPORT_VERSION: string;
export declare const CREATIVE_CAPABILITIES: readonly CreativeCapability[];
export declare function capabilityLabel(name: string): string;
export declare function detectCreativeCapabilities(environment?: CapabilityEnvironment): CapabilityReport;
export declare function probeCreativeCapabilities(options?: { environment?: CapabilityEnvironment; signal?: AbortSignal; timeoutMs?: number; gpu?: boolean; devices?: boolean }): Promise<CapabilityReport>;
export declare function assessAgentCapabilities(idOrPolicy: string | AgentInputPolicy, report?: CapabilityReport | null): CapabilityAssessment | undefined;
export declare function modelSetupEnvironment(report?: CapabilityReport | null): { browser: boolean; webGPU?: boolean; saveData?: boolean; effectiveType?: string; deviceMemory?: number };
