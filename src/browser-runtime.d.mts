export type LocalToolOperation = 'image-filter' | 'image-resize' | 'image-grid' | 'type-overlay';
export type LocalToolValues = Record<string, string | number>;
export type LocalImageSize = { width: number; height: number };
export type LocalToolOutput = LocalImageSize & { blob: Blob; filename: string };

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

/** Run only a reviewed local operation, returning a downloadable PNG without network access. */
export declare function runLocalTool(
    operation: LocalToolOperation,
    files: File[],
    values: LocalToolValues,
    signal?: AbortSignal,
): Promise<LocalToolOutput>;
