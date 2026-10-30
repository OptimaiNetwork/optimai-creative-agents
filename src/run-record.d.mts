export declare const RUN_RECORD_VERSION: 1;
export declare const RUN_RECORD_LIMITS: Readonly<{ settings: 32768; output: 4096; depth: 8; inputs: 16; bytes: number; history: 100 }>;
type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };
/** `sha256:<64 hex>` with Web Crypto, otherwise `h64:<16 hex>`. */
export type InputsDigest = `sha256:${string}` | `h64:${string}`;
/** One agent result's provenance. `hash` covers the template, settings, seed, SDK version and inputs digest only. */
export type RunRecord = Readonly<{
  version: 1;
  /** 16 lowercase hex characters, stable across engines and key order. */
  hash: string;
  templateId: string;
  settings: Readonly<Record<string, Json>>;
  seed: number | null;
  sdkVersion: string | null;
  inputsDigest: InputsDigest | null;
  /** Not hashed. */ createdAt?: string;
  /** Not hashed; plain JSON such as `{ width, height, filename }`. */ output?: Readonly<Record<string, Json>>;
}>;
export type RunRecordInput = {
  templateId: string;
  settings?: Record<string, unknown>;
  sdkVersion?: string | null;
  /** Defaults to a whole-number `settings.seed`, else null. */
  seed?: number | null;
  inputsDigest?: InputsDigest | string | null;
  createdAt?: string;
  output?: Record<string, unknown>;
};
/** JSON with sorted keys, finite numbers only and −0 written as 0. */
export function canonicalJson(value: unknown): string;
/** A stable 64-bit hash of a string's UTF-8 bytes (16 hex characters). Not a security hash. */
export function hashText(text: string): string;
/** Digest selected inputs in order; only bytes count, never file names. */
export function digestInputs(inputs: Blob | ArrayBuffer | ArrayBufferView | string | readonly (Blob | ArrayBuffer | ArrayBufferView | string)[], options?: { signal?: AbortSignal; subtle?: SubtleCrypto | null }): Promise<InputsDigest>;
export function createRunRecord(input: RunRecordInput): RunRecord;
/** Read a stored or shared record; throws when it is malformed or its hash does not match. */
export function parseRunRecord(value: unknown): RunRecord;
export function verifyRunRecord(value: unknown): boolean;
/** Settings split into portable v1 recipe `values` and engine-only `extra` settings. */
export function runRecipeValues(templateId: string, settings?: Record<string, unknown>): { values: Record<string, string | number>; extra: Record<string, unknown> };
export type RunHistoryEntry<A = unknown> = Readonly<{ record: RunRecord; attachment: A; at: number }>;
export type RunHistory<A = unknown> = {
  /** Newest first. A repeated hash moves to the front; every `evicted` entry's attachment should be released. */
  add(record: RunRecord, attachment?: A): { entry: RunHistoryEntry<A>; added: boolean; evicted: RunHistoryEntry<A>[] };
  /** Keep the newest run even if another arrives within `settleMs`. */
  settle(): void;
  get(hash: string): RunHistoryEntry<A> | null;
  list(): RunHistoryEntry<A>[];
  readonly size: number;
  clear(): RunHistoryEntry<A>[];
};
/** `limit` 1–100 (default 12). With `settleMs`, a run made within that time of the previous one replaces it. */
export function createRunHistory<A = unknown>(options?: { limit?: number; settleMs?: number; now?: () => number }): RunHistory<A>;
