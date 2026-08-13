import { describe, expect, it, vi } from "vitest";
import { RUNTIME_SETTING_KEYS } from "@mplus/contracts";
import { buildScoringOverview } from "./scoring-overview-service.js";

const season17 = {
  id: "s17",
  slug: "blizzard-season-17",
  name: "Season 17",
  isCurrent: false,
  blizzardSeasonId: 17,
  metadata: {
    activeMplusCatalog: {
      schemaVersion: "active-mplus-catalog-v1",
      wclZoneId: 39,
      blizzardSeasonId: 17,
      expansionIdentity: "TWW",
      dungeonPoolHash: "hash17",
      sourceMetadataHash: "src17",
      catalogVersion: "test",
      dungeonSlugs: ["dungeon-a"],
      synchronizedAt: "2026-01-01T00:00:00.000Z",
      validatedAt: "2026-01-01T00:00:00.000Z",
      lastKnownGood: true,
      authorityVersion: "active-mplus-season-authority-v1",
    },
  },
  dungeonCount: 8,
  startsAt: null,
  endsAt: null,
  regionId: "region-eu",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const season18 = {
  ...season17,
  id: "s18",
  slug: "blizzard-season-18",
  name: "Season 18",
  isCurrent: true,
  blizzardSeasonId: 18,
  metadata: {
    activeMplusCatalog: {
      ...season17.metadata.activeMplusCatalog,
      wclZoneId: 47,
      blizzardSeasonId: 18,
    },
  },
};

function env() {
  return {
    SCORING_ENABLED: true,
    SCORING_PUBLICATION_ENABLED: false,
    SCORING_RELATIVE_DAMAGE_MODE: "off",
    SCORING_UTILITY_OPPORTUNITY_MODE: "off",
    SCORING_REFERENCE_COMPARISON_MODE: "off",
    CALIBRATION_ENABLED: false,
    ADMIN_CALIBRATION_ENABLED: false,
    APP_ENV: "test",
  };
}

describe("buildScoringOverview effective vs detected season", () => {
  it("PINNED 17 keeps effective scoring season 17 while detected is 18", async () => {
    const prisma = {
      scoreModel: {
        findFirst: vi.fn(async () => ({
          id: "m1",
          key: "v6",
          version: 1,
          name: "v6",
          status: "ACTIVE",
        })),
      },
      season: {
        findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          if (where.isCurrent === true) return season18;
          if (where.slug === "blizzard-season-17" || where.blizzardSeasonId === 17) {
            return season17;
          }
          return null;
        }),
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
          where.id === "s17" ? season17 : where.id === "s18" ? season18 : null,
        ),
      },
      seasonDungeon: { findMany: vi.fn(async () => []) },
      calibrationCohort: { groupBy: vi.fn(async () => []) },
      scoringEvidenceExport: { findFirst: vi.fn(async () => null) },
      ingestionJob: { groupBy: vi.fn(async () => []) },
      runtimeSetting: {
        findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
          if (where.key === RUNTIME_SETTING_KEYS.scoringSeasonSelection) {
            return {
              key: where.key,
              value: { mode: "PINNED", blizzardSeasonId: 17 },
              version: 1,
              updatedAt: new Date(),
              updatedByUserId: null,
            };
          }
          return null;
        }),
        findMany: vi.fn(async () => [
          {
            key: RUNTIME_SETTING_KEYS.concurrencyCalibration,
            value: 1,
            version: 1,
            updatedAt: new Date(),
            updatedByUserId: null,
          },
          {
            key: RUNTIME_SETTING_KEYS.concurrencyOperation,
            value: 1,
            version: 1,
            updatedAt: new Date(),
            updatedByUserId: null,
          },
        ]),
        upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => create),
      },
    };

    const overview = await buildScoringOverview(prisma as never, env() as never);
    expect(overview.detectedCurrentSeason?.blizzardSeasonId).toBe(18);
    expect(overview.currentSeason?.blizzardSeasonId).toBe(18);
    expect(overview.effectiveScoringSeason?.id).toBe("s17");
    expect(overview.effectiveScoringSeason?.blizzardSeasonId).toBe(17);
    expect(overview.effectiveScoringSeason?.wclZoneId).toBe(39);
    expect(overview.scoringSeasonSelection.mode).toBe("PINNED");
    expect(overview.scoringSeasonSelection.pinnedBlizzardSeasonId).toBe(17);
  });
});
