export type OneEuroOptions = { minCutoff?: number; beta?: number; dCutoff?: number };
export declare const ONE_EURO_DEFAULTS: Readonly<Required<OneEuroOptions>>;
export declare function oneEuroAlpha(cutoff: number, dt: number): number;
export type OneEuroFilter = { filter(value: number, timestampMs: number): number; reset(): void; readonly value: number | null };
export declare function createOneEuroFilter(options?: OneEuroOptions): OneEuroFilter;
export type OneEuroVectorFilter = { filter(values: ArrayLike<number>, timestampMs: number): number[]; reset(): void; readonly value: number[] | null; readonly size: number; readonly stride: number };
export declare function createOneEuroVectorFilter(size: number, options?: OneEuroOptions & { stride?: number }): OneEuroVectorFilter;
