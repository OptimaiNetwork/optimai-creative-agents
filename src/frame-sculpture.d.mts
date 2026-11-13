import type { MotionPreferenceLike } from './accessibility.mjs';
import type { ProgressEvent } from './progress.mjs';
export type FrameSculptureSettings = { layout: 'stack' | 'fan' | 'ribbon'; spacing: number; spread: number; tilt: number; opacity: number; rotating: boolean; background: string };
export type FrameSample = { canvas: HTMLCanvasElement; time: number };
export type FrameSamplesResult = { frames: FrameSample[]; duration: number; name: string; kind: 'image' | 'video' };
export type FrameSculptureRuntime = { THREE: typeof import('three'); OrbitControls: typeof import('three/addons/controls/OrbitControls.js').OrbitControls };
export type FrameSculptureController = { frames(samples: FrameSample[]): void; update(settings: FrameSculptureSettings): void; camera(preset: 'perspective' | 'front' | 'side'): void; fit(): void; zoom(direction: 'in' | 'out'): void; png(): Promise<Blob>; /** Orbit the current view for a video export; `close()` restores the stage. */ turntable(options?: FrameSculptureTurntableOptions): FrameSculptureTurntable; configuration(): Record<string, unknown>; dispose(): void };
export type FrameSculptureTurntableOptions = { /** Even sides (2–1920); default from the stage's aspect. */ width?: number; height?: number; /** Longer side when width/height are not given. Default 1280. */ edge?: number; /** Orbit per clip, non-zero, −720 to 720. Default 360. */ degrees?: number };
export type FrameSculptureTurntable = Readonly<{ canvas: HTMLCanvasElement; width: number; height: number; degrees: number; /** Draw frame `frame` of a `frames`-long orbit. */ draw(frame: number, frames: number): void; close(): void }>;
export const FRAME_SCULPTURE_TURNTABLE: Readonly<{ seconds: 6; fps: 30; degrees: 360; edge: 1280 }>;
/** Camera angle in radians for a turntable frame; a full orbit never repeats its first frame. */
export function turntableAngle(frame: number, frames: number, options?: { degrees?: number }): number;
/** Even video sides for an aspect ratio, the longer side `edge`. */
export function turntableSize(aspect: number, edge?: number): { width: number; height: number };
export const FRAME_SCULPTURE_LIMITS: Readonly<{ bytes: number; duration: number; frames: number; edge: number; sourceEdge: number; sourcePixels: number }>;
export const defaultFrameSculptureSettings: Readonly<FrameSculptureSettings>;
export function validateFrameSculptureSettings(value?: Partial<FrameSculptureSettings>): FrameSculptureSettings;
export function frameSampleTimes(duration: number, count?: number): number[];
export function frameTextureSize(width: number, height: number): { width: number; height: number };
export function frameSculpturePose(index: number, count: number, settings?: Partial<FrameSculptureSettings>): { x: number; y: number; z: number; rotationY: number; rotationZ: number };
export function releaseFrameSamples(frames: FrameSample[]): void;
export function validateFrameSamples(next: FrameSample[], owned?: FrameSample[]): void;
export function extractFrameSamples(file: File, options?: { count?: number; signal?: AbortSignal; onProgress?: (complete: number, total: number, event: ProgressEvent) => void }): Promise<FrameSamplesResult>;
export function createFrameSculptureDemo(): FrameSample[];
export function createFrameSculptureStage(container: HTMLElement, settings?: Partial<FrameSculptureSettings>, options?: { runtime?: FrameSculptureRuntime; onError?: (message: string) => void; signal?: AbortSignal; /** Reduced-motion source; defaults to the device query. */ motion?: MotionPreferenceLike }): Promise<FrameSculptureController>;
export function createFrameSculptureStageWithRuntime(container: HTMLElement, settings: Partial<FrameSculptureSettings>, onError: ((message: string) => void) | undefined, runtime: FrameSculptureRuntime, options?: { motion?: MotionPreferenceLike }): FrameSculptureController;
