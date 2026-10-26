export const CANVAS_LAB_AGENTS: Readonly<Record<string, string>>;
/** Merge template defaults with explicit recipe values and normalize legacy aliases. */
export function canvasLabRecipeSettings(templateId: string, values?: Record<string, string | number>): ReturnType<typeof canvasLabSettings>;
export function canvasLabSettings(operation: string, values?: Record<string, string | number>): { operation: string; title: string; color: string; layout: string; ratio: string; treatment: string; amount: number; mix: number; crop: 'smart' | 'center'; ink: 'readable' | 'image' | 'exact' };
export function runCanvasLab(operation: string, files?: File[], values?: Record<string, string | number>, signal?: AbortSignal): Promise<{blob: Blob; width: number; height: number; filename: string; /** Title color actually drawn (poster and letter). */ ink?: string; /** Title lines as drawn (poster and letter). */ lines?: string[]}>;
