export const CANVAS_LAB_AGENTS: Readonly<Record<string, string>>;
export function canvasLabSettings(operation: string, values?: Record<string, string | number>): { operation: string; title: string; color: string; layout: string; ratio: string; treatment: string; amount: number; mix: number };
export function runCanvasLab(operation: string, files?: File[], values?: Record<string, string | number>, signal?: AbortSignal): Promise<{blob: Blob; width: number; height: number; filename: string}>;
