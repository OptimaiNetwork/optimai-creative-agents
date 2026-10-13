import type { Object3D } from 'three';
import type { Agent3DCamera, Agent3DDemo, Agent3DSettings } from './scene-3d.mjs';
export type Scene3DRuntime = {
  THREE: typeof import('three');
  OrbitControls: typeof import('three/addons/controls/OrbitControls.js').OrbitControls;
  GLTFLoader: typeof import('three/addons/loaders/GLTFLoader.js').GLTFLoader;
  RoomEnvironment: typeof import('three/addons/environments/RoomEnvironment.js').RoomEnvironment;
};
export type Agent3DController = {
  update(settings: Agent3DSettings): void;
  demo(demo: Agent3DDemo): void;
  camera(preset: Agent3DCamera): void;
  fit(): void;
  zoom(direction: 'in' | 'out'): void;
  importGLB(bytes: ArrayBuffer, filename: string): Promise<{ name: string; vertices: number }>;
  png(): Promise<Blob>;
  configuration(): Record<string, unknown>;
  dispose(): void;
};
export type Scene3DController = Agent3DController;
export function loadScene3DRuntime(): Promise<Scene3DRuntime>;
export function createScene3DStage(container: HTMLElement, initial: Agent3DSettings, options?: { runtime?: Scene3DRuntime; onError?: (message: string) => void; signal?: AbortSignal }): Promise<Scene3DController>;
/** Synchronous host adapter for already bundled/reviewed Three modules. */
export function createScene3DStageWithRuntime(container: HTMLElement, initial: Agent3DSettings, onError: ((message: string) => void) | undefined, runtime: Scene3DRuntime): Scene3DController;
export function disposeAgent3DObjects(objects: Object3D[]): void;
