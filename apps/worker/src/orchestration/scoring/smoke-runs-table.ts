/**
 * Provider-free runs table for smoke CLI `--runs`.
 * Aligns to CharacterScore.selectedRuns; overlays EvidenceManifest slot
 * metadata when a matching frozen manifest exists for the same season.
 */
import type { PrismaClient } from "@mplus/database";

export type SmokeRunSlotRow = {
  dungeon: string;
  slot: number;
  key: number | null;
  report: string | null;
  fight: number | null;
  revision: number | null;
  state: string;
  reason: string | null;
};

export type SmokeRunsTable = {
  rows: SmokeRunSlotRow[];
  selectedCount: number;
  expectedCount: number;
  missingCount: number;
  missingRows: SmokeRunSlotRow[];
  manifestId: string | null;
};

type SelectedRunRef = {
  slotId?: string;
  dungeonSlug?: string;
  slotIndex?: number;
  reportCode?: string;
  fightId?: number;
  reportRevision?: number | null;
};

function fightKey(reportCode: string, fightId: number): string {
  return `${reportCode}:${fightId}`;
}

function formatReason(
  selectionReason: string | null | undefined,
  invalidReasons: unknown,
): string | null {
  if (selectionReason && selectionReason.length > 0) {
    if (
      Array.isArray(invalidReasons) &&
      invalidReasons.length > 0 &&
      selectionReason !== "SELECTED"
    ) {
      const extra = invalidReasons
        .filter((r): r is string => typeof r === "string" && r.length > 0)
        .join(",");
      return extra ? `${selectionReason} (${extra})` : selectionReason;
    }
    return selectionReason;
  }
  if (Array.isArray(invalidReasons) && invalidReasons.length > 0) {
    return invalidReasons
      .filter((r): r is string => typeof r === "string" && r.length > 0)
      .join(",") || null;
  }
  return null;
}

function parseSelectedRuns(raw: unknown): SelectedRunRef[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is SelectedRunRef => r != null && typeof r === "object");
}

/** Pure formatter used by CLI and unit tests. */
export function buildSmokeRunsTable(input: {
  expectedSlots: Array<{ dungeonName: string; dungeonSlug: string; slotIndex: number }>;
  selectedRuns: SelectedRunRef[];
  keyByFight: Map<string, number | null>;
  /** Optional EvidenceManifest slots keyed by dungeonSlug:slotIndex. */
  manifestSlotsByKey?: Map<
    string,
    {
      state: string;
      selectionReason: string | null;
      invalidReasons: unknown;
      keyLevel: number | null;
      reportCode: string | null;
      fightId: number | null;
      reportRevision: number | null;
    }
  >;
  manifestId?: string | null;
}): SmokeRunsTable {
  const selectedBySlot = new Map<string, SelectedRunRef>();
  for (const run of input.selectedRuns) {
    const slug = typeof run.dungeonSlug === "string" ? run.dungeonSlug : null;
    const idx = typeof run.slotIndex === "number" ? run.slotIndex : null;
    if (slug == null || idx == null) continue;
    selectedBySlot.set(`${slug}:${idx}`, run);
  }

  const rows: SmokeRunSlotRow[] = [];
  for (const expected of input.expectedSlots) {
    const slotKey = `${expected.dungeonSlug}:${expected.slotIndex}`;
    const selected = selectedBySlot.get(slotKey);
    const fromManifest = input.manifestSlotsByKey?.get(slotKey);

    if (selected) {
      const report =
        typeof selected.reportCode === "string" ? selected.reportCode : fromManifest?.reportCode ?? null;
      const fight =
        typeof selected.fightId === "number" ? selected.fightId : fromManifest?.fightId ?? null;
      const revision =
        typeof selected.reportRevision === "number"
          ? selected.reportRevision
          : fromManifest?.reportRevision ?? null;
      const keyFromFight =
        report != null && fight != null
          ? (input.keyByFight.get(fightKey(report, fight)) ?? null)
          : null;
      rows.push({
        dungeon: expected.dungeonName,
        slot: expected.slotIndex,
        key: keyFromFight ?? fromManifest?.keyLevel ?? null,
        report,
        fight,
        revision,
        state: fromManifest?.state === "SELECTED" ? fromManifest.state : "SELECTED",
        reason:
          formatReason(fromManifest?.selectionReason, fromManifest?.invalidReasons) ??
          "SELECTED",
      });
      continue;
    }

    if (fromManifest && fromManifest.state !== "SELECTED") {
      rows.push({
        dungeon: expected.dungeonName,
        slot: expected.slotIndex,
        key: fromManifest.keyLevel,
        report: fromManifest.reportCode,
        fight: fromManifest.fightId,
        revision: fromManifest.reportRevision,
        state: fromManifest.state,
        reason:
          formatReason(fromManifest.selectionReason, fromManifest.invalidReasons) ??
          fromManifest.state,
      });
      continue;
    }

    rows.push({
      dungeon: expected.dungeonName,
      slot: expected.slotIndex,
      key: null,
      report: null,
      fight: null,
      revision: null,
      state: "MISSING_NO_CANDIDATE",
      reason: "MISSING_NO_CANDIDATE",
    });
  }

  rows.sort(
    (a, b) => a.dungeon.localeCompare(b.dungeon) || a.slot - b.slot,
  );
  const missingRows = rows.filter((r) => r.state !== "SELECTED");
  return {
    rows,
    selectedCount: rows.filter((r) => r.state === "SELECTED").length,
    expectedCount: rows.length,
    missingCount: missingRows.length,
    missingRows,
    manifestId: input.manifestId ?? null,
  };
}

export function formatSmokeRunsTableText(table: SmokeRunsTable): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("EVIDENCE SLOTS");
  lines.push(
    [
      "Dungeon".padEnd(28),
      "Slot".padStart(4),
      "Key".padStart(4),
      "Report".padEnd(18),
      "Fight".padStart(5),
      "Revision".padStart(8),
      "State".padEnd(24),
      "Reason",
    ].join("  "),
  );
  lines.push("-".repeat(120));
  for (const r of table.rows) {
    lines.push(
      [
        r.dungeon.slice(0, 28).padEnd(28),
        String(r.slot).padStart(4),
        (r.key == null ? "-" : String(r.key)).padStart(4),
        (r.report ?? "-").slice(0, 18).padEnd(18),
        (r.fight == null ? "-" : String(r.fight)).padStart(5),
        (r.revision == null ? "-" : String(r.revision)).padStart(8),
        r.state.slice(0, 24).padEnd(24),
        r.reason ?? "-",
      ].join("  "),
    );
  }
  lines.push("");
  lines.push(`Selected runs: ${table.selectedCount}/${table.expectedCount}`);
  lines.push(`Missing slots: ${table.missingCount}`);

  if (table.missingRows.length > 0) {
    lines.push("");
    lines.push("MISSING / REJECTED");
    lines.push(
      [
        "Dungeon".padEnd(28),
        "Slot".padStart(4),
        "State".padEnd(24),
        "Reason",
      ].join("  "),
    );
    lines.push("-".repeat(80));
    for (const r of table.missingRows) {
      lines.push(
        [
          r.dungeon.slice(0, 28).padEnd(28),
          String(r.slot).padStart(4),
          r.state.slice(0, 24).padEnd(24),
          r.reason ?? "-",
        ].join("  "),
      );
    }
  }
  return lines.join("\n");
}

/**
 * Load runs table for a CharacterScore: season dungeon grid + selectedRuns,
 * overlaying EvidenceManifest slot reasons when fight identities match.
 */
export async function loadSmokeRunsTable(input: {
  prisma: PrismaClient;
  characterId: string;
  seasonId: string;
  selectedRuns: unknown;
}): Promise<SmokeRunsTable> {
  const seasonDungeons = await input.prisma.seasonDungeon.findMany({
    where: { seasonId: input.seasonId },
    include: { dungeon: true },
    orderBy: { sortOrder: "asc" },
  });

  const expectedSlots = seasonDungeons.flatMap((sd) => [
    {
      dungeonName: sd.dungeon.name,
      dungeonSlug: sd.dungeon.slug,
      slotIndex: 0,
    },
    {
      dungeonName: sd.dungeon.name,
      dungeonSlug: sd.dungeon.slug,
      slotIndex: 1,
    },
  ]);

  const selectedRuns = parseSelectedRuns(input.selectedRuns);
  const selectedFightKeys = new Set(
    selectedRuns
      .filter(
        (r) =>
          typeof r.reportCode === "string" && typeof r.fightId === "number",
      )
      .map((r) => fightKey(r.reportCode!, r.fightId!)),
  );

  const digests = await input.prisma.characterRunDigest.findMany({
    where: { characterId: input.characterId },
    include: {
      rawRun: {
        select: { reportCode: true, fightId: true },
      },
    },
  });
  const keyByFight = new Map<string, number | null>();
  for (const d of digests) {
    const meta = d.sourceMetadata as { digest?: { keyLevel?: number } } | null;
    const dig = meta && typeof meta === "object" && "digest" in meta ? meta.digest : meta;
    const keyLevel =
      dig && typeof dig === "object" && typeof (dig as { keyLevel?: unknown }).keyLevel === "number"
        ? (dig as { keyLevel: number }).keyLevel
        : null;
    keyByFight.set(fightKey(d.rawRun.reportCode, d.rawRun.fightId), keyLevel);
  }

  const manifests = await input.prisma.evidenceManifest.findMany({
    where: {
      characterId: input.characterId,
      seasonId: input.seasonId,
    },
    orderBy: { frozenAt: "desc" },
    include: {
      slots: { include: { dungeon: true } },
    },
    take: 20,
  });

  let best:
    | {
        id: string;
        slotsByKey: Map<
          string,
          {
            state: string;
            selectionReason: string | null;
            invalidReasons: unknown;
            keyLevel: number | null;
            reportCode: string | null;
            fightId: number | null;
            reportRevision: number | null;
          }
        >;
        overlap: number;
      }
    | null = null;

  for (const m of manifests) {
    const slotsByKey = new Map<
      string,
      {
        state: string;
        selectionReason: string | null;
        invalidReasons: unknown;
        keyLevel: number | null;
        reportCode: string | null;
        fightId: number | null;
        reportRevision: number | null;
      }
    >();
    let overlap = 0;
    for (const s of m.slots) {
      slotsByKey.set(`${s.dungeon.slug}:${s.slotIndex}`, {
        state: s.state,
        selectionReason: s.selectionReason,
        invalidReasons: s.invalidReasons,
        keyLevel: s.keyLevel,
        reportCode: s.reportCode,
        fightId: s.fightId,
        reportRevision: s.reportRevision,
      });
      if (
        s.state === "SELECTED" &&
        s.reportCode != null &&
        s.fightId != null &&
        selectedFightKeys.has(fightKey(s.reportCode, s.fightId))
      ) {
        overlap += 1;
      }
    }
    if (!best || overlap > best.overlap) {
      best = { id: m.id, slotsByKey, overlap };
    }
  }

  // Only overlay when the manifest clearly overlaps the score selection.
  const useManifest =
    best != null &&
    selectedFightKeys.size > 0 &&
    best.overlap >= Math.min(selectedFightKeys.size, Math.ceil(selectedFightKeys.size * 0.5));

  return buildSmokeRunsTable({
    expectedSlots,
    selectedRuns,
    keyByFight,
    manifestSlotsByKey: useManifest ? best!.slotsByKey : undefined,
    // Prefer CharacterScore selection over a mismatched canary 16/16 manifest:
    // when overlay is weak, still pass manifest slots only for reason enrichment
    // on matching SELECTED fights — buildSmokeRunsTable already prefers selectedRuns.
    manifestId: useManifest ? best!.id : null,
  });
}
