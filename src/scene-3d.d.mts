/** Browser-local GLB validation and portable 3D composition settings. */
export type Agent3DDemo = 'sculpture' | 'product' | 'architecture';
export type Agent3DLighting = 'studio' | 'sunset' | 'neon';
export type Agent3DMaterial = 'original' | 'ceramic' | 'metal' | 'clay';
export type Agent3DCamera = 'isometric' | 'front' | 'side' | 'top';
export type Agent3DSettings = { demo: Agent3DDemo; lighting: Agent3DLighting; material: Agent3DMaterial; color: string; background: string; exposure: number; lightAngle: number; focalLength: number; rotating: boolean; grid: boolean };
export type Scene3DSettings = Agent3DSettings;
export type Scene3DCamera = Agent3DCamera;
export const AGENT_3D_LIMITS: Readonly<{ bytes: number; jsonBytes: number; nodes: number; primitives: number; vertices: number; accessorElements: number; images: number; imageSide: number; imagePixels: number }>;
export const SCENE_3D_LIMITS: typeof AGENT_3D_LIMITS;
export function defaultAgent3DSettings(agentId: string): Agent3DSettings;
export const defaultScene3DSettings: typeof defaultAgent3DSettings;
export function validateScene3DSettings(value: unknown): Scene3DSettings;
export function scene3DRecipeSettings(agentId: string, values?: Record<string, string | number>): { settings: Agent3DSettings; camera: Agent3DCamera };
export function clean3DModelName(name: string): string;
export function scene3DPrompt(settings: Agent3DSettings, modelName: string, direction: string, mode: 'image' | 'video'): string;
export type ValidatedAgentGLB = { bytes: ArrayBuffer; vertices: number; primitives: number; nodes: number; images: number };
export function validateAgentGLB(bytes: ArrayBuffer): ValidatedAgentGLB;
