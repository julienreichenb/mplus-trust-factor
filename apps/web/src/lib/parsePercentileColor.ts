/**
 * Warcraft Logs / Raider.IO-style parse percentile color spectrum.
 * Applied to percentile values only — not grades, class colors, or row chrome.
 */

export type ParsePercentileTier =
  | "neutral"
  | "grey"
  | "green"
  | "blue"
  | "purple"
  | "orange"
  | "pink"
  | "gold";

export interface ParsePercentileColor {
  tier: ParsePercentileTier;
  /** CSS custom property for the tier color (or text color for neutral). */
  cssVar: string;
  /** Token class suffix used with `.parse-pct--*` styles. */
  className: `parse-pct--${ParsePercentileTier}`;
}

const TIER_CSS_VAR: Record<ParsePercentileTier, string> = {
  neutral: "var(--color-text-muted)",
  grey: "var(--color-parse-grey)",
  green: "var(--color-parse-green)",
  blue: "var(--color-parse-blue)",
  purple: "var(--color-parse-purple)",
  orange: "var(--color-parse-orange)",
  pink: "var(--color-parse-pink)",
  gold: "var(--color-parse-gold)",
};

function toColor(tier: ParsePercentileTier): ParsePercentileColor {
  return {
    tier,
    cssVar: TIER_CSS_VAR[tier],
    className: `parse-pct--${tier}`,
  };
}

/**
 * Resolve the WCL/RIO parse color for a percentile value.
 *
 * Thresholds (inclusive lower bounds after clamping to 0–100):
 * - null / undefined / NaN / non-finite → neutral
 * - 0–24 → grey
 * - 25–49 → green
 * - 50–74 → blue
 * - 75–94 → purple
 * - 95–98 → orange
 * - 99 → pink
 * - 100 → tan/gold
 *
 * Decimals use the same cutoffs (e.g. 24.9 → grey, 25.0 → green).
 * Values outside 0–100 are clamped before tier selection.
 */
export function resolveParsePercentileColor(
  value: number | null | undefined,
): ParsePercentileColor {
  if (value == null || typeof value !== "number" || !Number.isFinite(value)) {
    return toColor("neutral");
  }

  const clamped = Math.min(100, Math.max(0, value));

  if (clamped >= 100) return toColor("gold");
  if (clamped >= 99) return toColor("pink");
  if (clamped >= 95) return toColor("orange");
  if (clamped >= 75) return toColor("purple");
  if (clamped >= 50) return toColor("blue");
  if (clamped >= 25) return toColor("green");
  return toColor("grey");
}
