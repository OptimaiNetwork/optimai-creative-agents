export declare const BENCHMARK_LIMITS: Readonly<{ minSide: number; maxSide: number; minMs: number; maxMs: number; maxRuns: number }>;
export declare const BENCHMARK_DEFAULTS: Readonly<{ width: number; height: number; warmup: number; minRuns: number; maxRuns: number; budgetMs: number }>;
export type BenchmarkOperation = Readonly<{ id: string; title: string; group: 'pixels' | 'text' | 'canvas'; perPixel: boolean; run: (input: unknown) => unknown }>;
/** Every operation, in report order. */
export declare const BENCHMARK_OPERATIONS: readonly BenchmarkOperation[];
export type BenchmarkStats = Readonly<{ runs: number; min: number; median: number; p95: number; max: number; mean: number }>;
export type BenchmarkResult = Readonly<{ id: string; title: string; group: string; megapixelsPerSecond?: number; error?: string; skipped?: string } & Partial<BenchmarkStats>>;
export type BenchmarkReport = Readonly<{ settings: Readonly<{ width: number; height: number; warmup: number; minRuns: number; maxRuns: number; budgetMs: number }>; results: readonly BenchmarkResult[] }>;
export type BenchmarkCanvas = { getContext(type: '2d'): any };
/** A deterministic RGBA test picture; `shift` moves the rings to make a second, different picture. */
export function createBenchmarkImage(width: number, height: number, shift?: number): Uint8ClampedArray;
/** Median, p95, min, max and mean of millisecond samples; throws when none are finite. */
export function summarizeSamples(samples: readonly number[]): BenchmarkStats;
/**
 * Time every operation (or `only` a list of ids) with the host's clock. `createCanvas` enables the canvas group.
 * A failing operation is reported with its `error` and never stops the rest; `signal` stops between operations.
 */
export function runBenchmarks(options: { now: () => number; createCanvas?: (width: number, height: number) => BenchmarkCanvas; only?: readonly string[]; signal?: AbortSignal; onProgress?: (event: { index: number; total: number; id: string }) => void; width?: number; height?: number; warmup?: number; minRuns?: number; maxRuns?: number; budgetMs?: number }): Promise<BenchmarkReport>;
export type BenchmarkDevice = Readonly<{ browser: string | null; platform: string | null; cores: number | null; memoryGb: number | null; pixelRatio: number | null }>;
/** The few device facts a report shows, from a `navigator`-like object. */
export function describeBenchmarkDevice(nav?: Record<string, any>, extras?: { pixelRatio?: number }): BenchmarkDevice;
/** The results as a Markdown table with the device and image size above it. */
export function formatBenchmarkTable(report: BenchmarkReport, device?: Partial<BenchmarkDevice>): string;
