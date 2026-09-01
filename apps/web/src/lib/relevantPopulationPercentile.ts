/** Convert RuntimeSetting percentile bps ↔ admin "Top X%" display. */

export function percentileBpsToTopPercent(bps: number): number {
  return (10_000 - bps) / 100;
}

export function topPercentToPercentileBps(topPercent: number): number {
  return Math.round(10_000 - topPercent * 100);
}

export function formatTopPercentLabel(bps: number): string {
  const top = percentileBpsToTopPercent(bps);
  const rounded = Number.isInteger(top) ? String(top) : top.toFixed(2).replace(/\.?0+$/, "");
  return `Top ${rounded}%`;
}
