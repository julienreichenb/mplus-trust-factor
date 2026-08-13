/**
 * PINNED 17 / detected 18 coherence across DB-only effective-season peeks
 * used by scoring entry points (evidence join, shadow canary, rerolls, etc.).
 */
import { describe, expect, it, vi } from "vitest";
import { RUNTIME_SETTING_KEYS } from "@mplus/contracts";
import {
  mapEffectiveScoringSeasonIdsByRegion,
  peekEffectiveScoringSeasonRow,
  peekEffectiveScoringSeasonRowGlobal,
  requireEffectiveScoringSeasonRow,
} from "../active-mplus-season/effective-season-peek.js";
import { runEvidenceJoin } from "./evidence-join.js";

function makePinnedPrisma() {
  const seasons = [
    {
      id: "s18",
      slug: "blizzard-season-18",
      name: "Season 18",
      regionId: "region-eu",
      blizzardSeasonId: 18,
      isCurrent: true,
      updatedAt: new Date("2026-08-01"),
    },
    {
      id: "s17",
      slug: "blizzard-season-17",
      name: "Season 17",
      regionId: "region-eu",
      blizzardSeasonId: 17,
      isCurrent: false,
      updatedAt: new Date("2026-01-01"),
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
    },
    {
      id: "s16",
      slug: "blizzard-season-16",
      name: "Season 16",
      regionId: "region-eu",
      blizzardSeasonId: 16,
      isCurrent: false,
      updatedAt: new Date("2025-01-01"),
    },
  ];

  const runtimeSetting = {
    key: RUNTIME_SETTING_KEYS.scoringSeasonSelection,
    value: { mode: "PINNED", blizzardSeasonId: 17 },
    version: 1,
    updatedAt: new Date(),
    updatedByUserId: null,
  };

  const prisma = {
    runtimeSetting: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
        where.key === RUNTIME_SETTING_KEYS.scoringSeasonSelection ? runtimeSetting : null,
      ),
    },
    season: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return (
          seasons.find((s) => {
            if (where.regionId != null && s.regionId !== where.regionId) return false;
            if (where.slug != null && s.slug !== where.slug) return false;
            if (where.blizzardSeasonId != null && s.blizzardSeasonId !== where.blizzardSeasonId) {
              return false;
            }
            if (where.isCurrent != null && s.isCurrent !== where.isCurrent) return false;
            if (where.id != null && s.id !== where.id) return false;
            return true;
          }) ?? null
        );
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        seasons.find((s) => s.id === where.id) ?? null,
      ),
      findMany: vi.fn(async () => seasons),
    },
    scoreModel: {
      findFirst: vi.fn(async () => ({
        id: "model-1",
        key: "v6",
        version: 1,
        status: "ACTIVE",
      })),
    },
    character: {
      findMany: vi.fn(async () => []),
    },
  };

  return { prisma: prisma as never, seasons, runtimeSetting };
}

describe("PINNED 17 with Blizzard detected 18 — entry-point peeks", () => {
  it("peekEffectiveScoringSeasonRow resolves season 17 not 18", async () => {
    const { prisma } = makePinnedPrisma();
    const row = await peekEffectiveScoringSeasonRow(prisma, { regionId: "region-eu" });
    expect(row?.id).toBe("s17");
    expect(row?.blizzardSeasonId).toBe(17);
    expect(row?.selectionMode).toBe("PINNED");
    expect(row?.isCurrent).toBe(false);
    expect(row?.wclZoneId).toBe(39);
  });

  it("global peek and region map agree on season 17", async () => {
    const { prisma } = makePinnedPrisma();
    const global = await peekEffectiveScoringSeasonRowGlobal(prisma);
    const map = await mapEffectiveScoringSeasonIdsByRegion(prisma, ["region-eu"]);
    expect(global?.id).toBe("s17");
    expect(map.get("region-eu")).toBe("s17");
  });

  it("evidence join default (no seasonId) uses effective season 17", async () => {
    const { prisma } = makePinnedPrisma();
    const result = await runEvidenceJoin(prisma, {
      cohortId: "cohort-1",
      cohortRevision: 1,
      cohortName: "test",
      seasonId: null,
      members: [],
      scoreTtlSeconds: 86_400,
      now: new Date("2026-08-13T00:00:00.000Z"),
    });
    expect(result.seasonBinding.season?.id).toBe("s17");
    expect(result.seasonBinding.season?.blizzardSeasonId).toBe(17);
  });

  it("explicit historical seasonId 16 is honored under PINNED 17", async () => {
    const { prisma } = makePinnedPrisma();
    const result = await runEvidenceJoin(prisma, {
      cohortId: "cohort-1",
      cohortRevision: 1,
      cohortName: "test",
      seasonId: "s16",
      members: [],
      scoreTtlSeconds: 86_400,
      now: new Date("2026-08-13T00:00:00.000Z"),
    });
    expect(result.seasonBinding.season?.id).toBe("s16");
    expect(result.seasonBinding.season?.blizzardSeasonId).toBe(16);
  });

  it("requireEffectiveScoringSeasonRow fails closed only when missing, else season 17", async () => {
    const { prisma } = makePinnedPrisma();
    const row = await requireEffectiveScoringSeasonRow(prisma, { regionId: "region-eu" });
    expect(row.id).toBe("s17");
    expect(row.blizzardSeasonId).toBe(17);
  });

  it("same-process AUTO switch is visible on next peek (no memory cache)", async () => {
    const { prisma, runtimeSetting } = makePinnedPrisma();
    const pinned = await peekEffectiveScoringSeasonRow(prisma, { regionId: "region-eu" });
    expect(pinned?.blizzardSeasonId).toBe(17);

    runtimeSetting.value = { mode: "AUTO" };
    const auto = await peekEffectiveScoringSeasonRow(prisma, { regionId: "region-eu" });
    expect(auto?.blizzardSeasonId).toBe(18);
    expect(auto?.selectionMode).toBe("AUTO");
    expect(auto?.isCurrent).toBe(true);
  });
});
