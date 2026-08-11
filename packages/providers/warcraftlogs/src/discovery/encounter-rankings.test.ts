import { describe, expect, it } from "vitest";
import {
  EVIDENCE_SELECTOR_VERSION,
  expectedEvidenceSlotCount,
  type EvidenceCandidateMetadataV2,
  type EvidenceSelectionScope,
} from "@mplus/contracts";
import {
  buildEvidenceAcquisitionPlanV2,
  finalizeEvidenceManifestV2,
} from "@mplus/scoring";
import {
  buildAliasedEncounterRankingsQuery,
  encounterIdsForActiveDungeons,
  encounterObservationsToZoneRankingsPayload,
  encounterRankingsGraphqlAlias,
  mapAliasedEncounterRankings,
  mapEncounterRankings,
  MissingDungeonEncounterMappingError,
  rankingsToEncounterCandidates,
  requireActiveDungeonEncounters,
  summarizeEncounterRanksPayload,
  timedEligibleCoverageByDungeon,
  timedFromMedal,
} from "./encounter-rankings.js";
import { resolveRankingParseFromZoneRankings } from "../evidence/ranking-parse.js";
import { CURRENT_MPLUS_ZONE_ENCOUNTER_IDS, ENCOUNTER_DUNGEON_MAP } from "./run-discovery.js";

const ACTIVE = [
  "algethar-academy",
  "magisters-terrace",
  "maisara-caverns",
  "nexus-point-xenas",
  "pit-of-saron",
  "seat-of-the-triumvirate",
  "skyreach",
  "windrunner-spire",
] as const;

function rankRow(input: {
  code: string;
  fightId: number;
  key: number;
  medal: string;
  score: number;
  rankPercent: number;
  duration?: number;
  startTime?: number;
  leaderboard?: number;
}): Record<string, unknown> {
  return {
    lockedIn: true,
    rankPercent: input.rankPercent,
    report: {
      code: input.code,
      startTime: (input.startTime ?? 1_780_000_000_000) - 300_000,
      fightID: input.fightId,
    },
    duration: input.duration ?? 1_800_000,
    startTime: input.startTime ?? 1_780_000_000_000,
    amount: input.score,
    bracketData: input.key,
    spec: "Demonology",
    medal: input.medal,
    score: input.score,
    leaderboard: input.leaderboard ?? 0,
  };
}

describe("timedFromMedal", () => {
  it("maps bronze/silver/gold to timed true and none to false", () => {
    expect(timedFromMedal("bronze")).toBe(true);
    expect(timedFromMedal("silver")).toBe(true);
    expect(timedFromMedal("gold")).toBe(true);
    expect(timedFromMedal("none")).toBe(false);
    expect(timedFromMedal(null)).toBeNull();
  });
});

describe("mapEncounterRankings", () => {
  it("keeps log-backed rows with report+fight and skips leaderboard-only empties", () => {
    const observations = mapEncounterRankings({
      encounterId: 112526,
      dungeonSlug: "algethar-academy",
      zoneId: 47,
      payload: {
        metric: "playerscore",
        zone: 47,
        ranks: [
          rankRow({
            code: "jCWxQFPV7tHpgXah",
            fightId: 1,
            key: 22,
            medal: "bronze",
            score: 515,
            rankPercent: 96.18,
          }),
          {
            ...rankRow({
              code: "",
              fightId: 0,
              key: 22,
              medal: "bronze",
              score: 515,
              rankPercent: 96.18,
              leaderboard: 1,
            }),
            report: { code: "", startTime: null, fightID: null },
          },
          rankRow({
            code: "DEPLETED1",
            fightId: 2,
            key: 20,
            medal: "none",
            score: 400,
            rankPercent: 40,
          }),
        ],
      },
    });
    expect(observations).toHaveLength(2);
    expect(observations[0]!.reportCode).toBe("jCWxQFPV7tHpgXah");
    expect(observations[0]!.timed).toBe(true);
    expect(observations[0]!.rankPercent).toBeCloseTo(96.18);
    expect(observations[1]!.timed).toBe(false);
  });

  it("maps fight-local rankPercent into ranking-parse contract shape", () => {
    const observations = mapEncounterRankings({
      encounterId: 112526,
      zoneId: 47,
      payload: {
        ranks: [
          rankRow({
            code: "jCWxQFPV7tHpgXah",
            fightId: 1,
            key: 22,
            medal: "bronze",
            score: 515.94584677419,
            rankPercent: 96.18149831204583,
          }),
        ],
      },
    });
    const payload = encounterObservationsToZoneRankingsPayload(observations, 47);
    const resolved = resolveRankingParseFromZoneRankings({
      payload,
      zoneId: 47,
      reportCode: "jCWxQFPV7tHpgXah",
      fightId: 1,
      reportRevision: 1,
      dungeonSlug: "algethar-academy",
      keyLevel: 22,
    });
    expect(resolved.evidence?.rankPercent).toBeCloseTo(96.18149831204583);
    expect(resolved.unavailableReason).toBeNull();
  });
});

describe("encounterRankings discovery → 16/16 selection", () => {
  it("selects two best timed distinct runs per dungeon without counting untimed", () => {
    const encounters = encounterIdsForActiveDungeons(ACTIVE);
    expect(encounters).toHaveLength(8);

    const candidates = ACTIVE.flatMap((slug, dungeonIndex) => {
      const encounterId = encounters.find((e) => e.dungeonSlug === slug)!.encounterId;
      const observations = mapEncounterRankings({
        encounterId,
        dungeonSlug: slug,
        zoneId: 47,
        payload: {
          ranks: [
            rankRow({
              code: `${slug}-high`,
              fightId: 1,
              key: 22,
              medal: "bronze",
              score: 520 - dungeonIndex,
              rankPercent: 95,
              startTime: 1_780_100_000_000,
            }),
            rankRow({
              code: `${slug}-depleted`,
              fightId: 9,
              key: 22,
              medal: "none",
              score: 519,
              rankPercent: 99,
              startTime: 1_780_200_000_000,
            }),
            rankRow({
              code: `${slug}-mid`,
              fightId: 2,
              key: 20,
              medal: "silver",
              score: 480,
              rankPercent: 90,
              startTime: 1_780_000_000_000,
            }),
            rankRow({
              code: `${slug}-low`,
              fightId: 3,
              key: 18,
              medal: "gold",
              score: 450,
              rankPercent: 80,
              startTime: 1_779_000_000_000,
            }),
          ],
        },
      });
      return rankingsToEncounterCandidates(observations);
    });

    const coverage = timedEligibleCoverageByDungeon(candidates, ACTIVE);
    expect(coverage.fullCoverage).toBe(true);
    expect(coverage.underCovered).toEqual([]);
    for (const slug of ACTIVE) {
      // high+mid+low timed; depleted excluded
      expect(coverage.distinctTimedPerDungeon[slug]).toBe(3);
    }

    const meta: EvidenceCandidateMetadataV2[] = candidates.map((c) => ({
      discoveryIdentity: { reportCode: c.reportCode, fightId: c.fightId },
      reportRevision: null,
      dungeonSlug: c.dungeonSlug!,
      keyLevel: c.keyLevel!,
      timed: c.timed,
      runScore: c.score,
      evidenceCompleteness: 1,
      completedAt: c.completedAt,
      fightDurationMs: c.durationMs,
      actorId: 1,
      accessState: "PUBLIC",
      identityResolution: "RESOLVED",
      fightAccessible: true,
      hardError: false,
      discoverySource: c.source,
    }));

    const scope: EvidenceSelectionScope = {
      characterId: "char-wallidrixe",
      seasonId: "season-1",
      seasonSlug: "midnight-season-1",
      specializationId: "spec-demo",
      classSlug: "warlock",
      specSlug: "demonology",
      role: "DPS",
      refreshContractHash: "refresh-hash",
      selectorVersion: EVIDENCE_SELECTOR_VERSION,
      evidenceCutoffAt: "2026-12-01T00:00:00.000Z",
      highKeyPolicyId: "high-key-v1",
      activeDungeonSlugs: [...ACTIVE],
    };

    const { plan } = buildEvidenceAcquisitionPlanV2({
      scope,
      candidates: meta,
      plannedAt: "2026-08-08T00:00:00.000Z",
    });

    const rejectedUntimed = (plan.rejectedCandidates ?? []).filter(
      (r) => r.reason === "UNTIMED_RUN",
    );
    expect(rejectedUntimed.length).toBe(ACTIVE.length);

    const acquisition = plan.slots.flatMap((slot) =>
      slot.orderedCandidates.map((c) => ({
        discoveryIdentity: { ...c.discoveryIdentity },
        acquisitionStatus: "ACQUIRED" as const,
        reportRevision: 1,
        rejectionReason: null,
        rejectionDetail: null,
        datasetHashes: [],
        factSetHash: `f-${c.discoveryIdentity.reportCode}`,
        dimensionValidity: {
          performance: "VALID" as const,
          survival: "VALID" as const,
          utility: "VALID" as const,
          reasons: [],
        },
        keyLevel: c.keyLevel,
        timed: c.timed,
        runScore: c.runScore,
        completedAt: c.completedAt,
        actorId: c.actorId,
        evidenceCompleteness: c.evidenceCompleteness,
      })),
    );
    // Dedupe acquisition rows
    const seen = new Set<string>();
    const acquisitionDeduped = acquisition.filter((a) => {
      const k = `${a.discoveryIdentity.reportCode}:${a.discoveryIdentity.fightId}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const { manifest } = finalizeEvidenceManifestV2({
      plan,
      acquisitionResults: acquisitionDeduped,
      selectedAt: "2026-08-08T00:00:01.000Z",
    });

    const selected = manifest.slots.filter((s) => s.state === "SELECTED");
    expect(selected).toHaveLength(expectedEvidenceSlotCount(ACTIVE.length));
    expect(selected).toHaveLength(16);
    expect(selected.every((s) => s.timed === true)).toBe(true);

    for (const slug of ACTIVE) {
      const dungeonSelected = selected.filter((s) => s.dungeonSlug === slug);
      expect(dungeonSelected).toHaveLength(2);
      const keys = dungeonSelected.map((s) => s.keyLevel).sort((a, b) => (b ?? 0) - (a ?? 0));
      expect(keys).toEqual([22, 20]);
      expect(dungeonSelected.map((s) => s.identity!.reportCode).sort()).toEqual(
        [`${slug}-high`, `${slug}-mid`].sort(),
      );
    }

    // No mass-hydration stubs required when encounter lists are complete.
    expect(candidates.every((c) => c.fightId > 0)).toBe(true);
    expect(candidates.every((c) => c.source === "encounterRankings")).toBe(true);

    const zonePayload = encounterObservationsToZoneRankingsPayload(
      ACTIVE.flatMap((slug, dungeonIndex) => {
        const encounterId = encounters.find((e) => e.dungeonSlug === slug)!.encounterId;
        return mapEncounterRankings({
          encounterId,
          dungeonSlug: slug,
          zoneId: 47,
          payload: {
            ranks: [
              rankRow({
                code: `${slug}-high`,
                fightId: 1,
                key: 22,
                medal: "bronze",
                score: 520 - dungeonIndex,
                rankPercent: 95 - dungeonIndex,
                startTime: 1_780_100_000_000,
              }),
              rankRow({
                code: `${slug}-mid`,
                fightId: 2,
                key: 20,
                medal: "silver",
                score: 480,
                rankPercent: 90 - dungeonIndex,
                startTime: 1_780_000_000_000,
              }),
            ],
          },
        });
      }),
      47,
    );
    for (const s of selected) {
      const resolved = resolveRankingParseFromZoneRankings({
        payload: zonePayload,
        zoneId: 47,
        reportCode: s.identity!.reportCode,
        fightId: s.identity!.fightId,
        reportRevision: 1,
        dungeonSlug: s.dungeonSlug,
        keyLevel: s.keyLevel,
      });
      expect(resolved.unavailableReason).toBeNull();
      expect(resolved.evidence?.rankPercent).toBeGreaterThan(0);
    }
  });

  it("does not starve a dungeon when another has surplus timed ranks", () => {
    const encounters = encounterIdsForActiveDungeons(["skyreach", "windrunner-spire"]);
    const sky = mapEncounterRankings({
      encounterId: encounters[0]!.encounterId,
      dungeonSlug: "skyreach",
      zoneId: 47,
      payload: {
        ranks: Array.from({ length: 6 }, (_, i) =>
          rankRow({
            code: `sky-${i}`,
            fightId: i + 1,
            key: 22 - i,
            medal: "bronze",
            score: 500 - i,
            rankPercent: 90,
          }),
        ),
      },
    });
    const wind = mapEncounterRankings({
      encounterId: encounters[1]!.encounterId,
      dungeonSlug: "windrunner-spire",
      zoneId: 47,
      payload: {
        ranks: [
          rankRow({
            code: "wind-a",
            fightId: 3,
            key: 18,
            medal: "bronze",
            score: 400,
            rankPercent: 70,
          }),
          rankRow({
            code: "wind-b",
            fightId: 5,
            key: 17,
            medal: "silver",
            score: 390,
            rankPercent: 65,
          }),
        ],
      },
    });
    const candidates = rankingsToEncounterCandidates([...sky, ...wind]);
    const coverage = timedEligibleCoverageByDungeon(candidates, [
      "skyreach",
      "windrunner-spire",
    ]);
    expect(coverage.fullCoverage).toBe(true);
    expect(coverage.distinctTimedPerDungeon["skyreach"]).toBeGreaterThanOrEqual(2);
    expect(coverage.distinctTimedPerDungeon["windrunner-spire"]).toBe(2);
  });
});

describe("buildAliasedEncounterRankingsQuery", () => {
  it("emits one operation with aliases for each active encounter", () => {
    const encounters = encounterIdsForActiveDungeons(ACTIVE);
    const built = buildAliasedEncounterRankingsQuery(encounters);
    expect(built.operationName).toBe("CharacterEncounterRankingsAliased");
    expect(built.query).toContain("algethar_academy: encounterRankings(encounterID: 112526");
    expect(built.query).toContain("windrunner_spire: encounterRankings(encounterID: 12805");
    expect(built.query.match(/encounterRankings\(/g)?.length).toBe(8);
  });

  it("alias count follows the authoritative pool size dynamically (not hardcoded 8)", () => {
    const three = requireActiveDungeonEncounters({
      activeDungeonSlugs: ["skyreach", "windrunner-spire", "algethar-academy"],
    });
    const built3 = buildAliasedEncounterRankingsQuery(three);
    expect(built3.query.match(/encounterRankings\(/g)?.length).toBe(3);

    const fiveSlugs = ACTIVE.slice(0, 5);
    const five = requireActiveDungeonEncounters({ activeDungeonSlugs: fiveSlugs });
    const built5 = buildAliasedEncounterRankingsQuery(five);
    expect(built5.query.match(/encounterRankings\(/g)?.length).toBe(5);
    expect(built5.aliasByDungeonSlug.size).toBe(5);
  });
});

describe("requireActiveDungeonEncounters / catalog authority", () => {
  it("resolves every Midnight S1 catalog dungeon to a usable encounter ID", () => {
    const slugs = CURRENT_MPLUS_ZONE_ENCOUNTER_IDS.map((id) => ENCOUNTER_DUNGEON_MAP[id]!);
    const bindings = requireActiveDungeonEncounters({ activeDungeonSlugs: slugs });
    expect(bindings).toHaveLength(CURRENT_MPLUS_ZONE_ENCOUNTER_IDS.length);
    for (const id of CURRENT_MPLUS_ZONE_ENCOUNTER_IDS) {
      expect(bindings.some((b) => b.encounterId === id)).toBe(true);
    }
  });

  it("prefers authoritative SeasonDungeon bindings over the static catalog", () => {
    const bindings = requireActiveDungeonEncounters({
      activeDungeonSlugs: ["custom-dungeon-a", "skyreach"],
      authoritativeEncounters: [
        { dungeonSlug: "custom-dungeon-a", encounterId: 999001 },
        { dungeonSlug: "skyreach", encounterId: 61209 },
      ],
    });
    expect(bindings).toEqual([
      { dungeonSlug: "custom-dungeon-a", encounterId: 999001 },
      { dungeonSlug: "skyreach", encounterId: 61209 },
    ]);
  });

  it("fails explicitly when a dungeon lacks an encounter mapping", () => {
    expect(() =>
      requireActiveDungeonEncounters({
        activeDungeonSlugs: ["skyreach", "not-a-real-dungeon"],
      }),
    ).toThrow(MissingDungeonEncounterMappingError);
    try {
      requireActiveDungeonEncounters({
        activeDungeonSlugs: ["skyreach", "not-a-real-dungeon"],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(MissingDungeonEncounterMappingError);
      expect((error as MissingDungeonEncounterMappingError).missingDungeonSlugs).toContain(
        "not-a-real-dungeon",
      );
    }
  });

  it("fails explicitly when authoritative binding has null encounterId and catalog misses", () => {
    expect(() =>
      requireActiveDungeonEncounters({
        activeDungeonSlugs: ["future-dungeon"],
        authoritativeEncounters: [{ dungeonSlug: "future-dungeon", encounterId: null }],
      }),
    ).toThrow(/MISSING_DUNGEON_ENCOUNTER_MAPPING/);
  });
});

describe("encounterRankingsGraphqlAlias", () => {
  it("is deterministic and safe for arbitrary dungeon slugs", () => {
    expect(encounterRankingsGraphqlAlias("Algethar Academy")).toBe("algethar_academy");
    expect(encounterRankingsGraphqlAlias("seat-of-the-triumvirate")).toBe(
      "seat_of_the_triumvirate",
    );
    expect(encounterRankingsGraphqlAlias("123-leading-digit")).toBe("dungeon_123_leading_digit");
    expect(encounterRankingsGraphqlAlias("skyreach")).toBe(
      encounterRankingsGraphqlAlias("SKYREACH"),
    );
  });
});

describe("aliased payload isolation", () => {
  it("one dungeon with empty ranks does not corrupt other dungeon candidates", () => {
    const encounters = requireActiveDungeonEncounters({
      activeDungeonSlugs: ["skyreach", "windrunner-spire"],
    });
    const characterPayload = {
      [encounterRankingsGraphqlAlias("skyreach")]: { ranks: [] },
      [encounterRankingsGraphqlAlias("windrunner-spire")]: {
        ranks: [
          rankRow({
            code: "wind-ok",
            fightId: 3,
            key: 22,
            medal: "bronze",
            score: 500,
            rankPercent: 90,
          }),
          rankRow({
            code: "wind-ok2",
            fightId: 4,
            key: 20,
            medal: "gold",
            score: 480,
            rankPercent: 85,
          }),
        ],
      },
    };
    const observations = mapAliasedEncounterRankings({
      characterPayload,
      encounters,
      zoneId: 47,
    });
    const candidates = rankingsToEncounterCandidates(
      observations,
      new Map(encounters.map((e) => [e.encounterId, e.dungeonSlug])),
    );
    expect(candidates.every((c) => c.dungeonSlug === "windrunner-spire")).toBe(true);
    expect(candidates).toHaveLength(2);
    expect(summarizeEncounterRanksPayload({
      dungeonSlug: "skyreach",
      encounterId: encounters[0]!.encounterId,
      payload: characterPayload[encounterRankingsGraphqlAlias("skyreach")] as never,
    }).eligibleRows).toBe(0);
  });

  it("leaderboard-only and untimed rows in one dungeon do not affect another", () => {
    const encounters = requireActiveDungeonEncounters({
      activeDungeonSlugs: ["skyreach", "windrunner-spire"],
    });
    const characterPayload = {
      [encounterRankingsGraphqlAlias("skyreach")]: {
        ranks: [
          {
            ...rankRow({
              code: "",
              fightId: 0,
              key: 22,
              medal: "bronze",
              score: 999,
              rankPercent: 99,
              leaderboard: 1,
            }),
            report: { code: "", startTime: null, fightID: null },
          },
          rankRow({
            code: "sky-dep",
            fightId: 1,
            key: 22,
            medal: "none",
            score: 900,
            rankPercent: 98,
          }),
          rankRow({
            code: "sky-t1",
            fightId: 2,
            key: 18,
            medal: "bronze",
            score: 400,
            rankPercent: 70,
          }),
          rankRow({
            code: "sky-t2",
            fightId: 3,
            key: 17,
            medal: "silver",
            score: 390,
            rankPercent: 65,
          }),
        ],
      },
      [encounterRankingsGraphqlAlias("windrunner-spire")]: {
        ranks: [
          rankRow({
            code: "wind-t1",
            fightId: 1,
            key: 22,
            medal: "bronze",
            score: 510,
            rankPercent: 91,
          }),
          rankRow({
            code: "wind-t2",
            fightId: 2,
            key: 21,
            medal: "gold",
            score: 500,
            rankPercent: 88,
          }),
        ],
      },
    };
    const observations = mapAliasedEncounterRankings({
      characterPayload,
      encounters,
      zoneId: 47,
    });
    const slugByEncounter = new Map(encounters.map((e) => [e.encounterId, e.dungeonSlug]));
    const candidates = rankingsToEncounterCandidates(observations, slugByEncounter);
    const meta: EvidenceCandidateMetadataV2[] = candidates.map((c) => ({
      discoveryIdentity: { reportCode: c.reportCode, fightId: c.fightId },
      reportRevision: null,
      dungeonSlug: c.dungeonSlug!,
      keyLevel: c.keyLevel!,
      timed: c.timed,
      runScore: c.score,
      evidenceCompleteness: 1,
      completedAt: c.completedAt,
      fightDurationMs: c.durationMs,
      actorId: 1,
      accessState: "PUBLIC",
      identityResolution: "RESOLVED",
      fightAccessible: true,
      hardError: false,
      discoverySource: c.source,
    }));
    const scope: EvidenceSelectionScope = {
      characterId: "char-1",
      seasonId: "season-1",
      seasonSlug: "midnight-season-1",
      specializationId: "spec",
      classSlug: "warlock",
      specSlug: "demonology",
      role: "DPS",
      refreshContractHash: "h",
      selectorVersion: EVIDENCE_SELECTOR_VERSION,
      evidenceCutoffAt: "2026-12-01T00:00:00.000Z",
      highKeyPolicyId: "high-key-v1",
      activeDungeonSlugs: ["skyreach", "windrunner-spire"],
    };
    const { plan } = buildEvidenceAcquisitionPlanV2({
      scope,
      candidates: meta,
      plannedAt: "2026-08-08T00:00:00.000Z",
    });
    const seen = new Set<string>();
    const acquisition = plan.slots.flatMap((slot) =>
      slot.orderedCandidates.map((c) => {
        const key = `${c.discoveryIdentity.reportCode}:${c.discoveryIdentity.fightId}`;
        if (seen.has(key)) return null;
        seen.add(key);
        return {
          discoveryIdentity: { ...c.discoveryIdentity },
          acquisitionStatus: "ACQUIRED" as const,
          reportRevision: 1,
          rejectionReason: null,
          rejectionDetail: null,
          datasetHashes: [],
          factSetHash: `f-${key}`,
          dimensionValidity: {
            performance: "VALID" as const,
            survival: "VALID" as const,
            utility: "VALID" as const,
            reasons: [],
          },
          keyLevel: c.keyLevel,
          timed: c.timed,
          runScore: c.runScore,
          completedAt: c.completedAt,
          actorId: c.actorId,
          evidenceCompleteness: c.evidenceCompleteness,
        };
      }),
    ).filter((x): x is NonNullable<typeof x> => x != null);

    const { manifest } = finalizeEvidenceManifestV2({
      plan,
      acquisitionResults: acquisition,
      selectedAt: "2026-08-08T00:00:01.000Z",
    });
    const selected = manifest.slots.filter((s) => s.state === "SELECTED");
    expect(selected).toHaveLength(4);
    const ids = selected.map((s) => `${s.identity!.reportCode}:${s.identity!.fightId}`);
    expect(new Set(ids).size).toBe(4);
    expect(selected.filter((s) => s.dungeonSlug === "skyreach").map((s) => s.identity!.reportCode).sort()).toEqual([
      "sky-t1",
      "sky-t2",
    ]);
    expect(
      selected.filter((s) => s.dungeonSlug === "windrunner-spire").map((s) => s.identity!.reportCode).sort(),
    ).toEqual(["wind-t1", "wind-t2"]);
  });

  it("preserves authoritative dungeonSlug for encounters absent from ENCOUNTER_DUNGEON_MAP", () => {
    const observations = mapEncounterRankings({
      encounterId: 999001,
      dungeonSlug: "custom-dungeon-a",
      zoneId: 47,
      payload: {
        ranks: [
          rankRow({
            code: "custom1",
            fightId: 1,
            key: 15,
            medal: "bronze",
            score: 300,
            rankPercent: 50,
          }),
        ],
      },
    });
    const candidates = rankingsToEncounterCandidates(
      observations,
      new Map([[999001, "custom-dungeon-a"]]),
    );
    expect(candidates[0]!.dungeonSlug).toBe("custom-dungeon-a");
    expect(candidates[0]!.incompleteness.dungeonUnknown).toBe(false);
  });
});

