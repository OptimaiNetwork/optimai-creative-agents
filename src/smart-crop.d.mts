export declare const SMART_CROP_LIMITS: Readonly<{ analysisEdge: 96; maxMapPixels: 262144; candidates: 97 }>;

/** A small interest map read from a decoded image. */
export type FocusMap = { map: Float32Array; width: number; height: number };
/** A crop as fractions (0–1) of the source image. */
export type FocusCrop = { x: number; y: number; width: number; height: number };

/** Score visual interest (detail plus OKLab distinctiveness) for RGBA pixels; transparent pixels score zero. */
export declare function computeFocusMap(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Float32Array;

/** Find the largest crop of `aspect` (width / height) that holds the most interest near its centre. */
export declare function findFocusCrop(
    map: Float32Array,
    width: number,
    height: number,
    aspect: number,
    options?: { edgeFalloff?: number; centerBias?: number },
): FocusCrop;

/** Source rectangle, in source pixels, for a nine-argument `drawImage` cover fit. Centred without a focus map. */
export declare function focusCoverRect(
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number,
    focus?: FocusMap | null,
): FocusCrop;

/** Read a focus map from at most a 96-pixel thumbnail, or null when pixels cannot be read. */
export declare function analyzeImageFocus(source: CanvasImageSource, sourceWidth: number, sourceHeight: number): FocusMap | null;
