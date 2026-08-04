import { describe, expect, it, vi } from "vitest";
import {
  participantsFromMasterData,
  buildNeutralDigestFromBundle,
} from "./wcl-run-digest-persist.js";
import {
  loadPersistedFightDetails,
  persistFightDetailsPage,
  FIGHT_DETAILS_DATASET_KEY,
} from "./fight-details-persist.js";
import { extractPerformanceRunParseFactV2 } from "@mplus/provider-warcraftlogs";

describe("participantsFromMasterData", () => {
  const masterData = {
    actors: [
      { id: 1, name: "Wallidrixe", type: "Player", server: "Archimonde", subType: "Warlock", guid: 101 },
      { id: 2, name: "HealerOne", type: "Player", server: "Archimonde", subType: "Priest", guid: 102 },
      { id: 3, name: "TankOne", type: "Player", server: "Archimonde", subType: "Paladin", guid: 103 },
      { id: 4, name: "DpsTwo", type: "Player", server: "Illidan", subType: "Hunter", guid: 104 },
      { id: 5, name: "DpsThree", type: "Player", server: "Archimonde", subType: "Mage", guid: 105 },
      { id: 6, name: "ReportOnly", type: "Player", server: "Archimonde", subType: "Rogue", guid: 106 },
      { id: 50, name: "Imp", type: "Pet", petOwner: 1 },
      { id: 99, name: "Boss", type: "NPC" },
    ],
  };

  it("E: fight roster persistence uses exact friendlyPlayers set", () => {
    const rows = participantsFromMasterData(masterData, "EU", null, [3, 1, 5, 4, 2]);
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.wclActorId).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(rows.find((r) => r.characterName === "ReportOnly")).toBeUndefined();
    expect(rows.find((r) => r.characterName === "Wallidrixe")?.ownedPetActorIds).toEqual([50]);
  });

  it("E: report-wide actors do not leak when fight roster is provided", () => {
    const rows = participantsFromMasterData(masterData, "EU", null, [3, 7, 4, 1, 5]);
    // Actor 7 is not in masterData as Player — only actors present in both sets.
    expect(rows.map((r) => r.wclActorId).sort((a, b) => a - b)).toEqual([1, 3, 4, 5]);
    expect(rows.every((r) => r.characterName !== "ReportOnly")).toBe(true);
  });

  it("builds five players and attaches owned pets (legacy path without fight roster)", () => {
    const rows = participantsFromMasterData(masterData, "EU");
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.characterName !== "Imp" && r.characterName !== "Boss")).toBe(true);
    expect(rows.find((r) => r.characterName === "Wallidrixe")?.ownedPetActorIds).toEqual([50]);
  });

  it("enriches spec/role from CombatantInfo without fabricating from actor ids", () => {
    const rows = participantsFromMasterData(masterData, "EU", [
      { sourceID: 1, spec: "Demonology", role: "dps" },
      { sourceID: 3, spec: "Protection", role: "TANK" },
      { sourceID: 2, spec: "Holy", role: "HEALER" },
      { sourceID: 4, spec: "Marksmanship", role: "dps" },
      { sourceID: 5, spec: "Frost", role: "dps" },
    ], [1, 2, 3, 4, 5]);
    expect(rows).toHaveLength(5);
    expect(rows.find((r) => r.wclActorId === 1)?.specSlug).toBe("demonology");
    expect(rows.find((r) => r.wclActorId === 1)?.role).toBe("DPS");
    expect(rows.find((r) => r.wclActorId === 3)?.role).toBe("TANK");
    expect(rows.find((r) => r.wclActorId === 2)?.specSlug).toBe("holy");
  });

  it("does not collapse roster when CombatantInfo is target-scoped only", () => {
    const rows = participantsFromMasterData(
      masterData,
      "EU",
      [{ sourceID: 1, spec: "Demonology", role: "dps" }],
      [1, 2, 3, 4, 5],
    );
    expect(rows).toHaveLength(5);
    expect(rows.find((r) => r.wclActorId === 1)?.specSlug).toBe("demonology");
    expect(rows.map((r) => r.characterName).sort()).toEqual(
      ["DpsThree", "DpsTwo", "HealerOne", "TankOne", "Wallidrixe"].sort(),
    );
  });

  it("does not cross-realm match by name alone for digest identity", () => {
    const { digest } = buildNeutralDigestFromBundle({
      bundle: {
        schemaVersion: "1.0.0",
        analysisVersion: "wcl-run-evidence-v1",
        providerContractVersion: "wcl-graphql-v2-events",
        reportCode: "AbCd",
        reportRevision: 1,
        fightId: 1,
        playerActorId: 1,
        ownedPetActorIds: [50],
        dungeonSlug: "skyreach",
        startTime: 0,
        endTime: 1,
        masterData,
        eventDatasets: {},
        completeness: { required: [], present: [], missing: [], truncated: [] },
        fetchedAt: new Date().toISOString(),
        payloadFingerprints: {},
        accounting: {
          datasetsRequested: [],
          cacheHits: 0,
          persistedHits: 0,
          providerCalls: 0,
          pages: 0,
          pointsConsumed: null,
          estimatedPointsConsumed: null,
          costSource: "unknown",
          consumers: ["survival"],
          duplicatedLogicalFetches: 0,
        },
      } as never,
      region: "EU",
      dungeonSlug: "skyreach",
      keyLevel: 10,
      timed: true,
    });
    const sameName = digest.participants.filter((p) => p.characterName === "DpsTwo");
    expect(sameName).toHaveLength(1);
    expect(sameName[0]!.realmSlug).toBe("illidan");
  });
});

describe("ranking absent reason", () => {
  it("surfaces conclusive RANKING_PARSE blocker instead of silent ranking_parse_absent", () => {
    const outcome = extractPerformanceRunParseFactV2({
      slot: {
        slotId: "d:0",
        dungeonSlug: "d",
        slotIndex: 0,
        keyLevel: 10,
        identity: { reportCode: "AbCdEfGh", fightId: 1, reportRevision: 1 },
      },
      evidence: null,
      absentReason: "RANKING_PARSE_PUBLIC_API_UNAVAILABLE",
    });
    expect(outcome.reason).toBe("RANKING_PARSE_PUBLIC_API_UNAVAILABLE");
    expect(outcome.status).toBe("UNAVAILABLE");
  });
});

describe("fight-details persist helper", () => {
  it("loads persisted fight details and rejects revision mismatch", async () => {
    const artifactId = "art-1";
    const envelope = {
      schemaVersion: "wcl-fight-details-page-v1",
      providerContractVersion: "wcl-graphql-v2-events",
      reportCode: "AbCd",
      fightId: 3,
      reportRevision: 4,
      data: { reportRevision: 4, fight: { playerActorId: 9 } },
      fetchedAt: "2026-08-01T00:00:00.000Z",
    };
    const wclSource = {
      findEvidenceDatasetPages: vi.fn(async () => [
        { artifactId, reportRevision: 4, datasetKey: FIGHT_DETAILS_DATASET_KEY },
      ]),
      createEvidenceDatasetPage: vi.fn(async () => ({})),
      findLatestDigestRevision: vi.fn(async () => 4),
      findLatestDatasetPageRevision: vi.fn(async () => 4),
    };
    const artifacts = {
      readVerified: vi.fn(async () => Buffer.from(JSON.stringify(envelope), "utf8")),
      persist: vi.fn(async () => ({ artifactId, contentHash: "h", bytes: 10 })),
    };

    const hit = await loadPersistedFightDetails({
      wclSource: wclSource as never,
      artifacts: artifacts as never,
      reportCode: "AbCd",
      fightId: 3,
      reportRevision: 4,
    });
    expect(hit?.reportRevision).toBe(4);

    const miss = await loadPersistedFightDetails({
      wclSource: wclSource as never,
      artifacts: artifacts as never,
      reportCode: "AbCd",
      fightId: 3,
      reportRevision: 5,
    });
    // Envelope revision must match requested revision.
    expect(miss).toBeNull();

    await persistFightDetailsPage({
      wclSource: wclSource as never,
      artifacts: artifacts as never,
      reportCode: "AbCd",
      fightId: 3,
      reportRevision: 4,
      data: envelope.data,
    });
    expect(wclSource.createEvidenceDatasetPage).toHaveBeenCalledOnce();
    expect(artifacts.persist).toHaveBeenCalledOnce();
  });
});
