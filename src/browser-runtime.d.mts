import type { TextScrim, TitlePlacement } from './text-placement.mjs';
export type LocalToolOperation = 'image-filter' | 'image-resize' | 'image-grid' | 'type-overlay';
export type LocalToolValues = Record<string, string | number>;
export type LocalImageSize = { width: number; height: number };
export type LocalToolOutput = LocalImageSize & { blob: Blob; filename: string; /** Title color actually drawn by type-overlay. */ ink?: string; /** Lines of the title as drawn by type-overlay. */ lines?: string[]; /** Where type-overlay drew the title block. */ placement?: TitlePlacement; /** Scrim type-overlay drew behind the title, or null. */ scrim?: TextScrim | null; /** How image-filter graded: `pixel` (OKLab engine) or the `css` filter fallback. */ colorEngine?: 'pixel' | 'css'; /** Title of the film look or `.cube` LUT image-filter applied. */ lut?: string };

export declare const LOCAL_IMAGE_LIMITS: Readonly<{
    files: 8;
    bytes: number;
    dimension: 4096;
    pixels: 16000000;
}>;

/** A displayable validation message, or null when the declared format and size are accepted. */
export declare function validateLocalImageFile(file: Pick<File, 'name' | 'size' | 'type'>): string | null;

/** Compute the exact output dimensions without reading images or using browser APIs. */
export declare function getToolOutputSize(
    operation: LocalToolOperation,
    dimensions: LocalImageSize | readonly LocalImageSize[],
    values?: LocalToolValues,
): LocalImageSize;

/**
 * Run only a reviewed local operation, returning a downloadable PNG without network access.
 * Cover fits (resize and grid) use focus-aware cropping by default; pass `crop: 'center'` to opt out.
 * image-filter grades per pixel in OKLab (`colorEngine: 'pixel'`, optional `seed` for grain); `colorEngine: 'css'` keeps the legacy filter.
 * After the grade it applies `film` (none, golden, teal-amber or matte) or `lut` (`.cube` text, which wins), both scaled by `intensity`.
 */
export declare function runLocalTool(
    operation: LocalToolOperation,
    files: File[],
    values: LocalToolValues,
    signal?: AbortSignal,
): Promise<LocalToolOutput>;
