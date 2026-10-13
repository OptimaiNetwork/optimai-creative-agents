import type { AvatarLook, CameraEffect, FaceFrame, FaceRig } from './camera-runtime.mjs';
export declare function drawCameraSource(ctx: CanvasRenderingContext2D, source: CanvasImageSource, sourceWidth: number, sourceHeight: number, width: number, height: number, mirror: boolean): void;
export declare function drawCameraEffect(ctx: CanvasRenderingContext2D, source: HTMLCanvasElement, effect: CameraEffect, strength: number, mirror: boolean, seconds: number): void;
export declare function drawFaceHalo(ctx: CanvasRenderingContext2D, frame: FaceFrame | null, mirror: boolean, seconds: number, strength: number): void;
/** Hosts inject their pinned Three module; the SDK does not fetch renderer code. */
export declare function createCameraAvatar(canvas: HTMLCanvasElement, look: AvatarLook, options: { THREE: object }): { render(rig: FaceRig): void; dispose(): void };
