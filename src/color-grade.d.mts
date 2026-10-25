export declare const GRADE_LIMITS: Readonly<{ pixels: 16000000; seed: 4294967295 }>;

/** Grade settings; every field is optional when passed to `resolveGrade`. Hues are degrees. */
export type GradeSettings = {
  /** Linear-light exposure in stops, −2 to 2 (0). */ exposure: number;
  /** S-curve on OKLab L pivoting on mid grey, −1 to 1 (0). */ contrast: number;
  /** Black lift, 0 to 0.3 (0). */ fade: number;
  /** Chroma scale, 0 (monochrome) to 2 (1). */ saturation: number;
  /** Chroma boost that favours muted colors, −1 to 1 (0). */ vibrance: number;
  /** Blue (−1) to yellow (1) along OKLab b, weighted by lightness (0). */ temperature: number;
  /** Green (−1) to magenta (1) along OKLab a, weighted by lightness (0). */ tint: number;
  /** Split-tone hue for shadows, 0–360. */ shadowHue: number;
  /** Split-tone chroma for shadows, 0 to 0.1 (0). */ shadowTint: number;
  /** Split-tone hue for highlights, 0–360. */ highlightHue: number;
  /** Split-tone chroma for highlights, 0 to 0.1 (0). */ highlightTint: number;
  /** Seeded luminance grain, 0 to 1 (0). */ grain: number;
};
export type GradePreset = 'original' | 'noir' | 'warm' | 'cool' | 'punchy';
/** A complete, frozen grade from `resolveGrade`. */
export type ResolvedGrade = Readonly<GradeSettings>;

/** The Image Finish looks at full intensity. */
export declare const GRADE_PRESETS: Readonly<Record<GradePreset, ResolvedGrade>>;
/** A validated grade from a preset or partial settings, scaled from the identity by `amount` (0–1, default 1); hues are kept. */
export declare function resolveGrade(grade?: GradePreset | Partial<GradeSettings>, amount?: number): ResolvedGrade;
/** True when the grade leaves every pixel unchanged. */
export declare function isIdentityGrade(grade: ResolvedGrade): boolean;
/**
 * Grade RGBA pixels in place (alpha kept) and return them. Deterministic for the same pixels, grade and seed;
 * `rows: [start, end)` grades one band with results identical to a single pass.
 */
export declare function gradePixels<T extends Uint8ClampedArray | Uint8Array>(rgba: T, width: number, height: number, grade?: GradePreset | Partial<GradeSettings> | ResolvedGrade, options?: { seed?: number; rows?: [number, number] }): T;
/** One `#rgb`/`#rrggbb` color through a grade (without grain), as `#rrggbb`. */
export declare function gradeColor(color: string, grade?: GradePreset | Partial<GradeSettings> | ResolvedGrade): string;
