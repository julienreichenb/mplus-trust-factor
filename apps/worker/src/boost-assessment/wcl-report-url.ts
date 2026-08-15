/** Clickable WCL Damage Done URL from persisted report identity. No live fetch. */
export function wclDamageDoneReportUrl(
  reportCode: string | null | undefined,
  fightId: number | null | undefined,
): string | null {
  if (typeof reportCode !== "string" || reportCode.trim().length === 0) return null;
  if (typeof fightId !== "number" || !Number.isInteger(fightId) || fightId <= 0) return null;
  return `https://www.warcraftlogs.com/reports/${reportCode}?fight=${fightId}&type=damage-done`;
}
