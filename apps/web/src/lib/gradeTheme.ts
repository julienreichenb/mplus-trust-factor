import type { Grade } from "../api/types";

/** Space-separated RGB channels for use in `rgb(var(--x) / a)`. */
export type RankRgb = `${number} ${number} ${number}`;

export interface GradeTheme {
  /** Soft highlight — replaces gold text accents. */
  soft: string;
  /** Primary brand fill / mid accent. */
  mid: string;
  /** Deeper shade for gradients and borders. */
  deep: string;
  /** Base tier letter color. */
  base: string;
  rgb: RankRgb;
}

const THEMES: Record<Exclude<Grade, "U">, GradeTheme> = {
  S: {
    soft: "#7dd3fc",
    base: "#38bdf8",
    mid: "#0ea5e9",
    deep: "#0284c7",
    rgb: "56 189 248",
  },
  A: {
    soft: "#bef264",
    base: "#a3e635",
    mid: "#84cc16",
    deep: "#65a30d",
    rgb: "163 230 53",
  },
  B: {
    soft: "#5eead4",
    base: "#2dd4bf",
    mid: "#14b8a6",
    deep: "#0f766e",
    rgb: "45 212 191",
  },
  C: {
    soft: "#c4b5fd",
    base: "#a78bfa",
    mid: "#8b5cf6",
    deep: "#7c3aed",
    rgb: "167 139 250",
  },
  D: {
    soft: "#fda4af",
    base: "#fb7185",
    mid: "#f43f5e",
    deep: "#e11d48",
    rgb: "251 113 133",
  },
};

/** Gold accents when grade is missing or unrated (swapped with former S-tier). */
export const DEFAULT_GRADE_THEME: GradeTheme = {
  soft: "#f8e4b0",
  base: "#f4d58d",
  mid: "#e8b84a",
  deep: "#c9922a",
  rgb: "232 184 74",
};

export function resolveGradeTheme(grade: Grade | null | undefined): GradeTheme {
  if (!grade || grade === "U") return DEFAULT_GRADE_THEME;
  return THEMES[grade];
}

/** CSS custom properties that remaps decorative brand accents to the grade palette. */
export function gradeThemeCssVars(grade: Grade | null | undefined): Record<string, string> {
  const t = resolveGradeTheme(grade);
  return {
    "--color-gold-300": t.soft,
    "--color-brand": t.mid,
    "--color-brand-hover": t.soft,
    "--color-focus": t.soft,
    "--accent": t.mid,
    "--accent-2": t.soft,
    "--color-rank-rgb": t.rgb,
    "--shadow-brand-glow": `0 0 24px rgb(${t.rgb} / 22%)`,
  };
}
