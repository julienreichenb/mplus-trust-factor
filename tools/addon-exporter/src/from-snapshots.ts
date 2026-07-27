import type { Grade, RegionCode } from "@mplus/contracts";
import type { AddonExportInput } from "./types.js";

export interface PersistedSnapshotRow {
  overallScore: number | string;
  grade: string;
  confidence: number | string;
  calculatedAt: Date | string;
  redFlags?: Array<{ key: string }> | null;
  character: {
    normalizedName: string;
    displayName: string;
    region: { code: string };
    realm: { slug: string };
  };
  runCount?: number;
  baselineDungeonComplete?: boolean;
  top25Percent?: boolean;
}

/** Maps persisted score snapshots into addon exporter inputs. */
export function buildAddonExportInputsFromSnapshots(
  snapshots: PersistedSnapshotRow[],
  options: { staleBefore?: Date } = {},
): AddonExportInput[] {
  const staleBefore = options.staleBefore ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  return snapshots.map((snapshot) => {
    const calculatedAt =
      snapshot.calculatedAt instanceof Date
        ? snapshot.calculatedAt.toISOString()
        : String(snapshot.calculatedAt);
    const stale = new Date(calculatedAt) < staleBefore;

    return {
      region: snapshot.character.region.code as RegionCode,
      realmSlug: snapshot.character.realm.slug,
      name: snapshot.character.displayName,
      displayName: snapshot.character.displayName,
      overallScore: Number(snapshot.overallScore),
      grade: snapshot.grade as Grade,
      confidence: Number(snapshot.confidence),
      calculatedAt,
      runCount: snapshot.runCount ?? 0,
      baselineDungeonComplete: snapshot.baselineDungeonComplete ?? false,
      top25Percent: snapshot.top25Percent ?? false,
      stale,
      redFlagKeys: (snapshot.redFlags ?? []).map((flag) => flag.key),
    };
  });
}
