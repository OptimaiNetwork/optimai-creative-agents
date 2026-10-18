export declare const VERIFY_LIMITS: Readonly<{ maxPixels: 262144; maxBoxes: 64; maxEvents: 4096; maxPalette: 32 }>;

/** An sRGB color as `[r, g, b]`, each 0–255. */
export type RGB = [number, number, number] | number[];
/** A region as fractions (0–1) of the frame. */
export type Box = { x: number; y: number; width: number; height: number };
/** A focus map from smart-crop's `computeFocusMap` or `analyzeImageFocus`. */
export type FocusMap = { map: Float32Array; width: number; height: number };

/**
 * One deterministic check. Higher scores are better; `pass` means `score >= threshold`.
 * `confidence` (0.5–1) is a margin from the threshold, not a calibrated probability.
 */
export type CheckResult = {
    check: 'text-contrast' | 'text-size' | 'text-overlap' | 'safe-zone' | 'aspect' | 'duration' | 'count' | 'palette' | 'cut-alignment';
    pass: boolean;
    score: number;
    threshold: number;
    confidence: number;
    costMs: number;
};

/** WCAG 2.x relative luminance, 0–1. */
export declare function relativeLuminance(color: RGB): number;
/** WCAG contrast ratio, 1–21. */
export declare function contrastRatio(a: RGB, b: RGB): number;
/** OKLab `[L, a, b]` of an sRGB color. */
export declare function srgbToOklab(color: RGB): [number, number, number];
/** Euclidean OKLab distance (about 0.02 is just noticeable). */
export declare function deltaEOK(a: RGB, b: RGB): number;

/** Low-percentile WCAG contrast of known-color text over the pixels inside `box`. */
export declare function checkTextContrast(
    pixels: Uint8ClampedArray | Uint8Array,
    width: number,
    height: number,
    box: Box,
    textColor: RGB,
    options?: { minRatio?: number; percentile?: number },
): CheckResult;
/** Rendered text height in pixels against a minimum. */
export declare function checkTextSize(heightPx: number, options?: { minPx?: number }): CheckResult;
/** Share of visual interest left uncovered by text boxes (1 minus the covered share). */
export declare function checkTextOverlap(focus: FocusMap, boxes: Box[], options?: { maxShare?: number }): CheckResult;
/** Smallest signed margin of any box to the safe zone's edges. */
export declare function checkSafeZone(boxes: Box[], options?: { zone?: Box }): CheckResult;
/** 1 minus the relative aspect error of a delivered size. */
export declare function checkAspect(width: number, height: number, aspect: number, options?: { tolerance?: number }): CheckResult;
/** Signed margin of a duration to `[min, max]`, in seconds. */
export declare function checkDuration(seconds: number, options?: { min?: number; max?: number }): CheckResult;
/** Signed margin of a detector count to `[min, max]`. */
export declare function checkCount(count: number, options?: { min?: number; max?: number }): CheckResult;
/** Share of opaque pixels within `maxDeltaE` (OKLab) of a palette color. */
export declare function checkPalette(
    pixels: Uint8ClampedArray | Uint8Array,
    width: number,
    height: number,
    palette: RGB[],
    options?: { maxDeltaE?: number; minCoverage?: number },
): CheckResult;
/** Share of cuts within `tolerance` seconds of a beat. */
export declare function checkCutAlignment(cuts: number[], beats: number[], options?: { tolerance?: number; minHitRate?: number }): CheckResult;
/** Passes only if every check passes. */
export declare function summarizeChecks(results: CheckResult[]): { pass: boolean; failed: CheckResult['check'][]; minConfidence: number; costMs: number };
