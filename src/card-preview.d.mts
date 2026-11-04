import type { MotionPreferenceLike } from './accessibility.mjs';

export declare const PREVIEW_SIZE: Readonly<{ width: 480; height: 270 }>;
/** One loop, in milliseconds; `t = 0` and every multiple of it is the poster frame. */
export declare const PREVIEW_LOOP_MS: 4800;
export type PreviewMotif = 'bars' | 'stack' | 'sketch' | 'mockup' | 'grade' | 'blend' | 'grid' | 'halftone' | 'title' | 'bento' | 'poster' | 'iris' | 'glitch' | 'letters' | 'cutout' | 'pose' | 'face' | 'viewfinder' | 'avatar' | 'orbit' | 'light' | 'lines' | 'panels' | 'branches' | 'parallax' | 'track' | 'reframe' | 'strip';
export declare const PREVIEW_MOTIFS: readonly PreviewMotif[];

export type PreviewPalette = Readonly<{ background: string; end: string; accent: string; ink: string; paper: string; sky: string; sun: string; hill: string; hill2: string; soft: string }>;
export type AgentPreview = Readonly<{ id: string; motif: PreviewMotif; loopMs: number; seed: number; dark: boolean; palette: PreviewPalette }>;
/** A catalog ID, or anything shaped like a template (a community manifest works). */
export type PreviewAgent = string | { id: string; accent?: string; workspace?: { kind?: string; operation?: string } };
/** What an agent's card preview draws. Unknown IDs get the generic filmstrip. */
export function getAgentPreview(agent: PreviewAgent): AgentPreview;

/** The subset of `CanvasRenderingContext2D` the previews use: shapes and gradients only, no text or images. */
export type PreviewContext = Pick<CanvasRenderingContext2D, 'save' | 'restore' | 'setTransform' | 'transform' | 'translate' | 'rotate' | 'scale' | 'fillRect' | 'beginPath' | 'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'arc' | 'closePath' | 'fill' | 'stroke' | 'clip' | 'createLinearGradient' | 'fillStyle' | 'strokeStyle' | 'lineWidth' | 'globalAlpha'>;
export type PreviewFrame = Readonly<{ id: string; motif: PreviewMotif; phase: number; loopMs: number }>;
/** Draw one deterministic frame at `t` ms into a `width`×`height` area (480×270 by default). `reducedMotion` holds the poster frame. */
export function renderAgentPreview(agent: PreviewAgent, ctx: PreviewContext, t?: number, options?: { width?: number; height?: number; reducedMotion?: boolean }): PreviewFrame;

export type PreviewPlayer = {
  readonly playing: boolean;
  /** Start looping; returns false (and shows the poster) under reduced motion. */
  play(): boolean;
  /** Stop and show the poster frame. */
  pause(): void;
  /** Draw a specific time now. */
  render(t: number): PreviewFrame;
  dispose(): void;
};
/** Hover-to-play for a card canvas, sized to its CSS box at up to `maxPixelRatio` (2) and capped at `fps` (30). */
export function createPreviewPlayer(canvas: { getContext(kind: '2d'): PreviewContext | null; width: number; height: number; clientWidth?: number; clientHeight?: number }, agent: PreviewAgent, options?: { motion?: boolean | MotionPreferenceLike | MediaQueryList; fps?: number; maxPixelRatio?: number; scope?: unknown }): PreviewPlayer;
