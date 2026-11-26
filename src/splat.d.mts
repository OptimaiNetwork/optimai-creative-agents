/** Gaussian splats on the device: bounded .ply/.splat reading, compact .splat writing and a dependency-free software preview. */
export const SPLAT_LIMITS: Readonly<{ bytes: number; splats: number; headerBytes: number; preview: number; side: number }>;
export type SplatFormat = 'ply' | 'splat';
export type Splats = {
    count: number;
    /** x, y, z per splat. */
    positions: Float32Array;
    /** Linear scale on each local axis. */
    scales: Float32Array;
    /** Unit quaternion w, x, y, z per splat. */
    rotations: Float32Array;
    /** sRGB red, green, blue and opacity per splat, 0–255. */
    colors: Uint8Array;
    format: SplatFormat;
    /** 'points' when a coloured point cloud was read as small round splats. */
    shade: 'gaussian' | 'points';
    /** View-dependent colour coefficients the file carried (not drawn by the preview, not kept by .splat). */
    harmonics: number;
    /** Splat count before reduceSplats, when it reduced. */
    reducedFrom?: number;
};
export type SplatBounds = { min: number[]; max: number[]; center: number[]; radius: number };
export type SplatCamera = { eye: number[]; target: number[]; up: number[]; fov: number };
export type SplatUp = 'y' | '-y' | 'z' | '-z';
export function detectSplatFormat(bytes: ArrayBuffer | ArrayBufferView): SplatFormat | null;
export function readSplatFile(bytes: ArrayBuffer | ArrayBufferView, options?: { format?: SplatFormat }): Splats;
export function writeSplatFile(splats: Splats): ArrayBuffer;
export function reduceSplats(splats: Splats, budget?: number): Splats;
export function splatBounds(splats: Splats, options?: { trim?: number }): SplatBounds;
export function splatOrbitCamera(bounds: SplatBounds, options?: { yaw?: number; pitch?: number; fov?: number; distance?: number; up?: SplatUp }): SplatCamera;
export function renderSplats(splats: Splats, target: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }, camera: SplatCamera, options?: { background?: string; maxRadius?: number; signal?: AbortSignal }): { drawn: number; skipped: number; splats: number };
export type SplatView = { yaw: number; pitch: number };
export const SPLAT_VIEWS: Readonly<{ isometric: Readonly<SplatView>; front: Readonly<SplatView>; side: Readonly<SplatView>; top: Readonly<SplatView> }>;
export type SplatPreview = { splats: Splats; bounds: SplatBounds; count: number; shown: number; format: SplatFormat; shade: Splats['shade']; harmonics: number };
export type SplatCanvas = { width: number; height: number; getContext(kind: '2d'): { createImageData(width: number, height: number): ImageData; putImageData(image: ImageData, x: number, y: number): void } | null };
export function prepareSplatPreview(bytes: ArrayBuffer | ArrayBufferView, options?: { budget?: number; trim?: number; format?: SplatFormat }): SplatPreview;
export function drawSplatPreview(canvas: SplatCanvas, preview: SplatPreview, options?: { yaw?: number; pitch?: number; distance?: number; fov?: number; up?: SplatUp; background?: string; signal?: AbortSignal }): { drawn: number; skipped: number; splats: number; ms: number };
