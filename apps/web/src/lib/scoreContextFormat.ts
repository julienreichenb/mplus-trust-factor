export function formatContextFactor(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "×1.00";
  return `×${value.toFixed(2)}`;
}

export function tierFactorValue(
  factors: Record<string | number, number> | null | undefined,
  tier: number,
): number | undefined {
  if (!factors) return undefined;
  const direct = factors[tier];
  if (typeof direct === "number") return direct;
  const named = factors[String(tier)];
  return typeof named === "number" ? named : undefined;
}
