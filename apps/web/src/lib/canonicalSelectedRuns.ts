import type {
  CanonicalDungeonEvidencePublicDTO,
  CanonicalEvidenceReportPublicDTO,
} from "@mplus/contracts";

export function dungeonEvidenceKey(slug: string): string {
  let key = slug
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "");
  if (key.startsWith("the") && key.length > 6) key = key.slice(3);
  return key;
}

export function canonicalReportsForDungeon(
  evidence: CanonicalDungeonEvidencePublicDTO[] | undefined,
  dungeonSlug: string,
): CanonicalEvidenceReportPublicDTO[] {
  const wanted = dungeonEvidenceKey(dungeonSlug);
  for (const row of evidence ?? []) {
    if (dungeonEvidenceKey(row.dungeonSlug) === wanted) {
      return row.reports.filter(
        (report) => report.identity === "PRIMARY" || report.identity === "SECONDARY",
      );
    }
  }
  return [];
}

export function formatCanonicalRunDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const formatted = new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return formatted === "Invalid Date" ? null : formatted;
}

/** Role-independent label. Never falls back to generic "Log". */
export function canonicalRunSlotHeadline(report: CanonicalEvidenceReportPublicDTO): string {
  const key = report.keyLevel != null ? `+${report.keyLevel}` : null;
  const date = formatCanonicalRunDate(report.completedAt);
  if (key && date) return `${key} · ${date}`;
  if (key) return key;
  if (date) return date;
  return report.identity === "SECONDARY" ? "Secondary" : "Primary";
}
