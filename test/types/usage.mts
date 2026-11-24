// Consumer sample for `npm run typecheck`. It is compiled, never run: the calls a
// host or an AI coding agent writes first, imported by package name so the
// `exports` map and every `types` condition are exercised. Lines marked
// `@ts-expect-error` are mistakes the declarations must keep rejecting; if one
// starts to compile, the gate fails.
import {
  AGENT_CATALOG, AGENT_WORKSPACE_CONTRACT_VERSION, compileAgentPrompt, createAgentManifest, getAgentInputPolicy,
  getAgentTemplate, getAgentWorkspace, validateAgentManifest, validateRecipeValues,
  type AgentExecutionKind, type AgentManifest, type AgentWorkspace,
} from '@optimai/creative-agents';
import { getAgentFormSchema, listFormFields, plainFormSchema, type FormControl } from '@optimai/creative-agents/form-schema';
import { contrastRatio, mixColors, pickLegibleColor, toOklch } from '@optimai/creative-agents/color';
import { getToolOutputSize, runLocalTool, validateLocalImageFile } from '@optimai/creative-agents/browser-runtime';
import { describeProgress, progressSteps, type ProgressEvent } from '@optimai/creative-agents/progress';
import { createRunRecord, verifyRunRecord, type RunRecord } from '@optimai/creative-agents/run-record';
import { mcpRecipeManifest, mcpToolDefinitions, type McpToolDefinition } from '@optimai/creative-agents/mcp-tools';
import { createFlashLimiter, prefersReducedMotion } from '@optimai/creative-agents/accessibility';
import { createBeatTracker } from '@optimai/creative-agents/beat-tracker';
import type { Scene3DController } from '@optimai/creative-agents/scene-3d-runtime';
import { createOfflineAnalyser } from '@optimai/creative-agents/offline-analyser';
import { exportCanvasVideo, probeVideoExport } from '@optimai/creative-agents/video-export';
import { createTransitionClip } from '@optimai/creative-agents/canvas-lab';
import { createMusicReactiveRenderer } from '@optimai/creative-agents/music-reactive';
import { FRAME_SCULPTURE_TURNTABLE, type FrameSculptureController } from '@optimai/creative-agents/frame-sculpture';
import { paletteFiles, readAse, buildPalette, type Palette } from '@optimai/creative-agents/palette';
import { createAssetIndex, loadAssetIndex, readImageFeatures, type AssetSearchResult } from '@optimai/creative-agents/asset-search';
import { createAssetEmbedder, siglipMatchChance, assetEmbedderPlan, type AssetEmbedderOrt } from '@optimai/creative-agents/asset-embedder';
import { runCanvasLab } from '@optimai/creative-agents/canvas-lab';
import { prepareCreativeAgentTask } from '@optimai/creative-agents/agent-runtime';
import { checkConstrainedSchema, maxJsonLength, writingFormat } from '@optimai/creative-agents/writing-schema';

// Build and validate a recipe.
const recipe: AgentManifest = createAgentManifest('poster-lab', { id: 'sunrise-poster', title: 'Sunrise Poster', brief: 'Warm first light.' });
recipe.recipe.values = { ratio: '9:16', treatment: 'cinema' };
const checked = validateAgentManifest(recipe);
export const prompt: string = checked.success ? compileAgentPrompt(checked.manifest) : checked.errors.join('\n');
export const problems: string[] = validateRecipeValues('poster-lab', recipe.recipe.values);
// @ts-expect-error a failed validation carries no manifest
export const unchecked: AgentManifest = checked.manifest;
// @ts-expect-error recipes cannot grant themselves network access
recipe.capabilities.network = 'all';
// @ts-expect-error recipe values are strings or numbers, never code or objects
recipe.recipe.values.run = () => 1;
// @ts-expect-error the manifest version is fixed at 1.0
recipe.schemaVersion = '2.0';

// Read the catalog.
export const kinds: AgentExecutionKind[] = AGENT_CATALOG.map(agent => agent.executionKind);
export const contract: '1.4' = AGENT_WORKSPACE_CONTRACT_VERSION;
const workspace: AgentWorkspace | undefined = getAgentWorkspace('poster-lab');
export const operation: string | undefined = workspace && workspace.kind !== 'workflow' ? workspace.operation : undefined;
export const maxFiles: number = getAgentInputPolicy('poster-lab')?.maxFiles ?? 0;
// @ts-expect-error catalog entries are read-only
AGENT_CATALOG[0].id = 'changed';
// @ts-expect-error an unknown id returns undefined, so the title needs a guard
export const title: string = getAgentTemplate('nope').title;

// Build a settings form and an MCP tool list from the same schema.
const schema = getAgentFormSchema('poster-lab');
export const controls: FormControl[] = listFormFields(schema).map(field => field.control);
export const strict: Record<string, unknown> = plainFormSchema(schema).properties;
export const tools: McpToolDefinition[] = mcpToolDefinitions({ ids: ['poster-lab'], run: false });
export const exported: AgentManifest = mcpRecipeManifest('poster-lab', { ratio: '1:1' });
// @ts-expect-error tools are read-only by contract
tools[0].annotations.readOnlyHint = false;

// Run engines in a browser.
export async function render(files: File[], signal: AbortSignal): Promise<Blob> {
  const rejected: string | null = validateLocalImageFile(files[0]);
  if (rejected) throw new Error(rejected);
  const size = getToolOutputSize('image-resize', { width: 1200, height: 800 }, { ratio: '1:1' });
  const resized = await runLocalTool('image-resize', files, { width: size.width, height: size.height }, signal);
  const poster = await runCanvasLab('poster', files, { title: 'Rise early' }, { signal, onProgress: (event: ProgressEvent) => void describeProgress(event) });
  // @ts-expect-error the operation is a reviewed name, not free text
  await runLocalTool('run-script', files, {});
  return poster.width > resized.width ? poster.blob : resized.blob;
}
export const steps: string[] = progressSteps('canvas', { stage: 'render' }).map(step => step.label);

// Color, provenance and motion helpers.
export const ink: string = pickLegibleColor(['#101418', mixColors('#101418', '#ffffff', 0.2)], { prefer: '#c6f87d' }).color;
export const readable: boolean = contrastRatio(ink, '#101418') >= 4.5;
export const [lightness, chroma, hue]: [number, number, number] = toOklch('#c6f87d');
const record: RunRecord = createRunRecord({ templateId: 'poster-lab', settings: { ratio: '9:16' }, sdkVersion: '0.5.0' });
export const intact: boolean = verifyRunRecord(record);
// @ts-expect-error a run record is immutable once hashed
record.hash = 'tampered';
export const calm: boolean = prefersReducedMotion();
export const limiter: ReturnType<typeof createFlashLimiter> = createFlashLimiter();
export const tracker: ReturnType<typeof createBeatTracker> = createBeatTracker();
export type Stage = Scene3DController;
// Frame-by-frame export: the offline analyser feeds a renderer, the probe picks the path.
const song = createOfflineAnalyser({ sampleRate: 48000, channels: [new Float32Array(48000)] }, { smoothingTimeConstant: 0 });
export const bytes: Uint8Array = song.getByteFrequencyData(new Uint8Array(song.frequencyBinCount), 0.5);
// @ts-expect-error frequency bytes need a Uint8Array, not a number array
song.getByteFrequencyData([0, 0], 0);
export async function exportTransition(files: File[]): Promise<'webcodecs' | 'recorder'> {
  const clip = await createTransitionClip(files, { transition: 'light wipe' }, { width: 1280 });
  const probe = await probeVideoExport({ width: clip.width, height: clip.height, fps: 30, audio: false });
  const video = await exportCanvasVideo({ probe, canvas: clip.canvas, frames: 72, render: frame => clip.draw(frame, 72) });
  clip.close();
  return video.engine;
}
export function songVideo(song: AudioBuffer, ctx: CanvasRenderingContext2D): number {
  const renderer = createMusicReactiveRenderer(song, { fps: 30, look: 'aurora', beatSync: true });
  renderer.draw(ctx, 0);
  // @ts-expect-error frames are drawn onto a 2D context, not a canvas element
  renderer.draw(ctx.canvas, 1);
  return renderer.frames;
}
export function orbit(stage: FrameSculptureController): HTMLCanvasElement {
  const spin = stage.turntable({ edge: 1280, degrees: -360 });
  spin.draw(0, FRAME_SCULPTURE_TURNTABLE.seconds * FRAME_SCULPTURE_TURNTABLE.fps);
  spin.close();
  return spin.canvas;
}
export async function swatches(photo: File, bytes: Uint8Array): Promise<Blob[]> {
  const { palette } = await runCanvasLab('palette', [photo], { count: 6, sort: 'by hue' });
  const imported: Palette = buildPalette(readAse(bytes).colors.map(color => color.hex), { sort: 'lightness' });
  // @ts-expect-error a palette exports css, json, ase or gpl only
  paletteFiles(imported, { formats: ['svg'] });
  return paletteFiles(palette ?? imported).map(file => new Blob([file.data], { type: file.type }));
}
export function ollamaRequest(brief: string): { format: Record<string, unknown> | 'json'; fits: boolean } {
  const task = prepareCreativeAgentTask({ templateId: 'storyboard-builder', values: { scenes: 6 }, brief });
  const { format } = writingFormat(task, { provider: 'ollama', version: '0.12.3' });
  const web: string = writingFormat(task, { provider: 'webllm' }).response_format.schema;
  const constraint: Record<string, unknown> = writingFormat(task, { provider: 'builtin' }).responseConstraint;
  void constraint;
  // @ts-expect-error writing formats exist for ollama, webllm and builtin only
  writingFormat(task, { provider: 'cloud' });
  return { format, fits: task.fitsBudget && !checkConstrainedSchema(task.decodingSchema).length && maxJsonLength(JSON.parse(web)) < Infinity };
}

export function findShot(bitmap: ImageBitmap, saved: string): readonly AssetSearchResult[] {
  const { index } = loadAssetIndex(saved, { model: 'demo-clip@1' });
  index.add({ id: 'new', name: 'red-car.jpg', features: readImageFeatures(bitmap, bitmap.width, bitmap.height), vector: new Float32Array(512) });
  // @ts-expect-error asset ids are strings
  createAssetIndex().add({ id: 7 });
  const { results, unmatched } = index.search('the red car', { vector: [0.1, 0.2], limit: 5 });
  return unmatched.length ? results.filter(result => result.matches.includes('red')) : results;
}

export async function searchByMeaning(ort: AssetEmbedderOrt, pixels: ImageData, words: string): Promise<readonly AssetSearchResult[]> {
  const embedder = createAssetEmbedder({ ort, onProgress: event => void event.part });
  const index = createAssetIndex({ model: embedder.index });
  index.add({ id: 'a', vector: await embedder.embedImage(pixels) });
  // @ts-expect-error q8 is a precision, not a device
  assetEmbedderPlan({ vision: { device: 'q8' } });
  const { bytes } = assetEmbedderPlan({ gpu: true });
  void bytes;
  return index.search(words, { vector: await embedder.embedText(words), calibrate: siglipMatchChance }).results;
}
