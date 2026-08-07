/**
 * Discovery-only canary isolation + safety gates (no live WCL).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  EVIDENCE_SELECTOR_VERSION,
  expectedEvidenceSlotCount,
  type EvidenceCandidateMetadataV2,
} from "@mplus/contracts";
import { finalizeEvidenceManifestV2, buildEvidenceAcquisitionPlanV2 } from "@mplus/scoring";
import {
  evaluateCanaryDiscoveryGates,
  isDiscoveryExecuteArmed,
  assertDiscoveryRateAdmission,
} from "./canary/canary-discovery-gates.js";
import {
  createDiscoveryForbiddenAcquireHook,
  runScoringCanaryDiscovery,
} from "./canary/canary-discover.js";
import { parseCanaryCliArgs } from "./canary/cli.js";
import { CANARY_SENTINEL_CHARACTER_ID } from "./canary/canary-deps.js";
import { MIDNIGHT_SEASON_1_DUNGEON_SLUGS } from "./canary/canary-catalog.js";
import { runScoringCanaryPreflight } from "./run-orchestration/canary-preflight.js";
import { createMemoryOrchestrationPorts } from "./run-orchestration/memory-ports.js";
import type { CanarySeasonResolution } from "./canary/canary-season.js";
import type { CanaryRateSnapshotBootstrapReport } from "./canary/canary-rate-snapshot.js";
import type { WclRateLimitSnapshot } from "@mplus/provider-warcraftlogs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");

function okRateSnapshot(spent = 100): WclRateLimitSnapshot {
  return {
    limitPerHour: 1000,
    pointsSpentThisHour: spent,
    pointsRemaining: 1000 - spent,
    resetAt: null,
    fetchedAt: new Date().toISOString(),
  };
}

function ensureOkBootstrap(
  overrides: Partial<CanaryRateSnapshotBootstrapReport> = {},
): () => Promise<CanaryRateSnapshotBootstrapReport> {
  return async () => ({
    snapshotSource: "PERSISTED",
    snapshotAgeMs: 0,
    providerCalls: 0,
    measuredPoints: 0,
    estimatedPoints: 0,
    succeeded: true,
    failureReason: null,
    snapshot: okRateSnapshot(100),
    persistedPath: null,
    ...overrides,
  });
}

const liveEnv = {
  PROVIDER_MODE: "live" as const,
  WCL_ENABLED: true,
  ALLOW_LIVE_PROVIDER_CALLS: true,
  SCORING_ENABLED: true,
  SCORING_PUBLICATION_ENABLED: false,
  WCL_CLIENT_ID: "id",
  WCL_CLIENT_SECRET: "secret",
};

const seasonResolutionOk: CanarySeasonResolution = {
  configuredZoneId: 47,
  resolutionMode: "AUTO",
  seasonId: "season-row-1",
  seasonSlug: "blizzard-season-17",
  seasonName: "Midnight Season 1",
  blizzardSeasonId: 17,
  expansion: "Midnight",
  productSeasonSlug: "midnight-season-1",
  catalogSource: "season_dungeon_bindings",
  catalogVersion: "test-catalog",
  dungeonCount: 8,
  dungeons: MIDNIGHT_SEASON_1_DUNGEON_SLUGS.map((slug, i) => ({
    slug,
    dungeonId: `d-${i}`,
    journalInstanceId: null,
    wclZoneOrEncounterId: null,
    sortOrder: i,
  })),
  activeDungeonSlugs: [...MIDNIGHT_SEASON_1_DUNGEON_SLUGS],
  dungeonPoolHash: "pool-hash-midnight",
  expectedSlotCount: 16,
  validationStatus: "OK",
  validationReasons: [],
  isCurrent: true,
  startsAt: null,
  endsAt: null,
  authority: null,
  warnings: [],
};

function candidate(
  dungeonSlug: string,
  fightId: number,
  slotHint = 0,
): EvidenceCandidateMetadataV2 {
  return {
    discoveryIdentity: { reportCode: `R${fightId}`, fightId },
    reportRevision: 1,
    dungeonSlug,
    keyLevel: 10 + slotHint,
    timed: true,
    runScore: 200 + slotHint * 10,
    evidenceCompleteness: 1,
    completedAt: "2026-01-01T00:00:00.000Z",
    fightDurationMs: 1_800_000,
    actorId: 1,
    accessState: "PUBLIC",
    identityResolution: "RESOLVED",
    fightAccessible: true,
    hardError: false,
    discoverySource: "test",
  };
}

function fullCandidates(): EvidenceCandidateMetadataV2[] {
  const out: EvidenceCandidateMetadataV2[] = [];
  let fight = 1;
  for (const slug of MIDNIGHT_SEASON_1_DUNGEON_SLUGS) {
    out.push(candidate(slug, fight++, 0));
    out.push(candidate(slug, fight++, 1));
  }
  return out;
}

describe("discovery script + CLI wiring", () => {
  it("root pnpm public scripts replace contextual discovery script", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["scoring:canary"]).toMatch(/scoring:canary/);
    expect(pkg.scripts["scoring:replay"]).toMatch(/scoring:replay/);
    expect(pkg.scripts["scoring:doctor"]).toMatch(/scoring:doctor/);
    expect(pkg.scripts["scoring:canary:discover"]).toBeUndefined();
    expect(pkg.scripts["scoring:canary:rate-snapshot"]).toBeUndefined();
  });

  it("CLI accepts the discover subcommand", () => {
    const args = parseCanaryCliArgs([
      "discover",
      "--region",
      "EU",
      "--realm",
      "archimonde",
      "--character",
      "Wallidrixe",
      "--confirm-discovery",
    ]);
    expect(args.mode).toBe("discover");
    expect(args.confirmDiscovery).toBe(true);
  });
});

describe("discovery safety gates", () => {
  it("refuses without --confirm-discovery", () => {
    const gate = evaluateCanaryDiscoveryGates({
      env: liveEnv,
      discoveryExecuteArmed: true,
      confirmDiscovery: false,
      characterCount: 1,
      repositoryMode: "PRODUCTION",
    });
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.reasons).toContain("MISSING_CONFIRM_DISCOVERY");
  });

  it("refuses without explicit env arm", () => {
    expect(isDiscoveryExecuteArmed({})).toBe(false);
    const gate = evaluateCanaryDiscoveryGates({
      env: liveEnv,
      discoveryExecuteArmed: false,
      confirmDiscovery: true,
      characterCount: 1,
      repositoryMode: "PRODUCTION",
    });
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.reasons).toContain("DISCOVERY_EXECUTE_NOT_ARMED");
  });

  it("refuses when publication is enabled", () => {
    const gate = evaluateCanaryDiscoveryGates({
      env: { ...liveEnv, SCORING_PUBLICATION_ENABLED: true },
      discoveryExecuteArmed: true,
      confirmDiscovery: true,
      characterCount: 1,
      repositoryMode: "PRODUCTION",
    });
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) expect(gate.reasons).toContain("PUBLICATION_ENABLED");
  });

  it("refuses memory and fixture repositories", () => {
    for (const mode of ["MEMORY", "FIXTURE"] as const) {
      const gate = evaluateCanaryDiscoveryGates({
        env: liveEnv,
        discoveryExecuteArmed: true,
        confirmDiscovery: true,
        characterCount: 1,
        repositoryMode: mode,
      });
      expect(gate.allowed).toBe(false);
      if (!gate.allowed) expect(gate.reasons).toContain("REPOSITORY_MODE_FORBIDDEN");
    }
  });

  it("SCORING_CANARY_EXECUTE alone does not arm discovery", () => {
    expect(
      isDiscoveryExecuteArmed({ SCORING_CANARY_EXECUTE: "true" }),
    ).toBe(false);
    expect(
      isDiscoveryExecuteArmed({ SCORING_CANARY_DISCOVERY_EXECUTE: "true" }),
    ).toBe(true);
  });

  it("DEFER and STOP block before provider calls", () => {
    expect(() =>
      assertDiscoveryRateAdmission({
        snapshot: {
          limitPerHour: 1000,
          pointsSpentThisHour: 850,
          pointsRemaining: 150,
          resetAt: null,
          fetchedAt: new Date().toISOString(),
        },
        rateBudgetConfig: { warnPercent: 70, deferPercent: 80, stopPercent: 90 },
      }),
    ).toThrow(/DEFER/);

    expect(() =>
      assertDiscoveryRateAdmission({
        snapshot: {
          limitPerHour: 1000,
          pointsSpentThisHour: 950,
          pointsRemaining: 50,
          resetAt: null,
          fetchedAt: new Date().toISOString(),
        },
        rateBudgetConfig: { warnPercent: 70, deferPercent: 80, stopPercent: 90 },
      }),
    ).toThrow(/STOP/);
  });

  it("capability acquire hook is unreachable", () => {
    expect(() => createDiscoveryForbiddenAcquireHook()).toThrow(
      /DISCOVERY_CAPABILITY_ACQUIRE_UNREACHABLE|unreachable/,
    );
  });
});

describe("runScoringCanaryDiscovery", () => {
  function mockPersistence() {
    const manifests = new Map<
      string,
      { id: string; document: unknown; seasonId: string; characterId: string; contentHash: string }
    >();
    const datasets = new Map<string, { state: string; artifactId: string }>();
    const dungeons = new Map<string, { id: string; slug: string }>();

    const prisma = {
      evidenceManifest: {
        findFirst: vi.fn(async ({ where }: { where: { characterId: string; seasonId: string } }) => {
          for (const row of manifests.values()) {
            if (row.characterId === where.characterId && row.seasonId === where.seasonId) {
              return {
                id: row.id,
                document: row.document,
                seasonId: row.seasonId,
                frozenAt: new Date(),
              };
            }
          }
          return null;
        }),
      },
      dungeon: {
        findMany: vi.fn(async ({ where }: { where: { slug: { in: string[] } } }) =>
          where.slug.in.map((slug) => {
            if (!dungeons.has(slug)) dungeons.set(slug, { id: `dun-${slug}`, slug });
            return dungeons.get(slug)!;
          }),
        ),
        upsert: vi.fn(async ({ where, create }: { where: { slug: string }; create: { slug: string; name: string } }) => {
          const row = { id: `dun-${where.slug}`, slug: create.slug };
          dungeons.set(where.slug, row);
          return row;
        }),
      },
    };

    const artifacts = {
      persist: vi.fn(async () => ({ artifactId: `art-${randomId()}` })),
    };

    const evidence = {
      createFrozenManifest: vi.fn(async (input: {
        characterId: string;
        seasonId: string;
        contentHash: string;
        document: unknown;
        slots: Array<{
          dungeonId: string;
          slotIndex: number;
          reportCode: string | null;
          fightId: number | null;
          reportRevision: number | null;
          state: string;
        }>;
      }) => {
        const existing = [...manifests.values()].find(
          (m) => m.contentHash === input.contentHash,
        );
        if (existing) {
          return {
            manifest: { id: existing.id },
            slots: input.slots.map((s, i) => ({
              id: `slot-${i}`,
              ...s,
            })),
            created: false,
          };
        }
        const id = `man-${randomId()}`;
        manifests.set(id, {
          id,
          document: input.document,
          seasonId: input.seasonId,
          characterId: input.characterId,
          contentHash: input.contentHash,
        });
        return {
          manifest: { id },
          slots: input.slots.map((s, i) => ({
            id: `slot-${i}`,
            ...s,
          })),
          created: true,
        };
      }),
      findDatasetByCompatibilityKey: vi.fn(async (key: string) => datasets.get(key) ?? null),
      createDataset: vi.fn(async (input: { compatibilityKey: string }) => {
        datasets.set(input.compatibilityKey, {
          state: "READY",
          artifactId: `art-${randomId()}`,
        });
        return {};
      }),
    };

    return { prisma, artifacts, evidence, manifests };
  }

  function randomId(): string {
    return Math.random().toString(16).slice(2, 10);
  }

  it("DEFER after bootstrap refuses before discover()", async () => {
    const { prisma, artifacts, evidence } = mockPersistence();
    const discover = vi.fn(async () => ({
      candidates: fullCandidates(),
      rankingEvidence: [],
      reportsListed: 0,
      reportsHydrated: 0,
      fightsExamined: 0,
      graphqlRequestCount: 0,
      capabilityEventPageRequestCount: 0,
      measuredPoints: 0,
      estimatedPoints: 0,
    }));
    await expect(
      runScoringCanaryDiscovery({
        prisma: prisma as never,
        artifacts: artifacts as never,
        evidence: evidence as never,
        characterId: "11111111-1111-4111-8111-111111111111",
        characterResolution: {
          characterResolutionSource: "postgresql.findByIdentity",
          characterId: "11111111-1111-4111-8111-111111111111",
          characterCanonicalIdentity: {
            region: "EU",
            realmSlug: "archimonde",
            name: "Wallidrixe",
          },
          repositoryMode: "PRODUCTION",
        },
        seasonResolution: seasonResolutionOk,
        role: "DPS",
        classSlug: null,
        specSlug: null,
        rateBudgetConfig: { warnPercent: 70, deferPercent: 80, stopPercent: 90 },
        ensureRateLimitSnapshot: ensureOkBootstrap({
          snapshotSource: "LIVE",
          providerCalls: 1,
          measuredPoints: 1,
          estimatedPoints: 1,
          snapshot: {
            limitPerHour: 1000,
            pointsSpentThisHour: 850,
            pointsRemaining: 150,
            resetAt: null,
            fetchedAt: new Date().toISOString(),
          },
        }),
        discover,
      }),
    ).rejects.toMatchObject({ code: "CANARY_DISCOVERY_RATE_ADMISSION_REFUSED" });
    expect(discover).not.toHaveBeenCalled();
  });

  it("uses active-season authority and creates a compatible frozen manifest", async () => {
    const { prisma, artifacts, evidence } = mockPersistence();
    const discover = vi.fn(async () => ({
      candidates: fullCandidates(),
      rankingEvidence: fullCandidates().map((c) => ({
        reportCode: c.discoveryIdentity.reportCode,
        fightId: c.discoveryIdentity.fightId,
        reportRevision: c.reportRevision ?? 1,
        dungeonSlug: c.dungeonSlug,
        keyLevel: c.keyLevel,
        bracketPercent: 90,
        rankPercent: null,
        amountPercent: null,
        amount: 1000,
        partition: 1,
      })),
      reportsListed: 8,
      reportsHydrated: 8,
      fightsExamined: 16,
      graphqlRequestCount: 9,
      capabilityEventPageRequestCount: 0,
      measuredPoints: 12,
      estimatedPoints: 12,
    }));

    const { report, effects } = await runScoringCanaryDiscovery({
      prisma: prisma as never,
      artifacts: artifacts as never,
      evidence: evidence as never,
      characterId: "11111111-1111-4111-8111-111111111111",
      characterResolution: {
        characterResolutionSource: "postgresql.findByIdentity",
        characterId: "11111111-1111-4111-8111-111111111111",
        characterCanonicalIdentity: {
          region: "EU",
          realmSlug: "archimonde",
          name: "Wallidrixe",
        },
        repositoryMode: "PRODUCTION",
      },
      seasonResolution: seasonResolutionOk,
      role: "DPS",
      classSlug: "mage",
      specSlug: "arcane",
      rateBudgetConfig: { warnPercent: 70, deferPercent: 80, stopPercent: 90 },
      ensureRateLimitSnapshot: ensureOkBootstrap(),
      discover,
    });

    expect(discover).toHaveBeenCalledTimes(1);
    expect(report.applicationSeasonId).toBe("season-row-1");
    expect(report.seasonSlug).toBe("blizzard-season-17");
    expect(report.wclZoneId).toBe(47);
    expect(report.dungeonPoolHash).toBe("pool-hash-midnight");
    expect(report.expectedSlotCount).toBe(
      expectedEvidenceSlotCount(MIDNIGHT_SEASON_1_DUNGEON_SLUGS.length),
    );
    expect(report.selectedSlotCount).toBe(16);
    expect(report.manifestStatus).toBe("CREATED");
    expect(report.manifestId).toBeTruthy();
    expect(report.rankingEvidencePersisted).toBeGreaterThan(0);
    expect(report.capabilityPackageAcquisitions).toBe(0);
    expect(report.capabilityPackagesCreated).toBe(0);
    expect(report.participantDigestsCreated).toBe(0);
    expect(report.scoreCalculations).toBe(0);
    expect(report.publicScorePointerMutated).toBe(false);
    expect(report.publicationEnabled).toBe(false);
    expect(report.eventPageRequestCount).toBe(0);
    expect(effects.capabilityPackageAcquisitions).toBe(0);
  });

  it("refuses memory repository mode and sentinel characters", async () => {
    const { prisma, artifacts, evidence } = mockPersistence();
    await expect(
      runScoringCanaryDiscovery({
        prisma: prisma as never,
        artifacts: artifacts as never,
        evidence: evidence as never,
        characterId: CANARY_SENTINEL_CHARACTER_ID,
        characterResolution: {
          characterResolutionSource: "test.injected",
          characterId: CANARY_SENTINEL_CHARACTER_ID,
          characterCanonicalIdentity: {
            region: "EU",
            realmSlug: "archimonde",
            name: "Wallidrixe",
          },
          repositoryMode: "PRODUCTION",
        },
        seasonResolution: seasonResolutionOk,
        role: "DPS",
        classSlug: null,
        specSlug: null,
        rateBudgetConfig: { warnPercent: 70, deferPercent: 80, stopPercent: 90 },
        ensureRateLimitSnapshot: ensureOkBootstrap(),
        discover: async (_ctx) => ({
          candidates: [],
          rankingEvidence: [],
          reportsListed: 0,
          reportsHydrated: 0,
          fightsExamined: 0,
          graphqlRequestCount: 0,
          capabilityEventPageRequestCount: 0,
          measuredPoints: 0,
          estimatedPoints: 0,
        }),
      }),
    ).rejects.toMatchObject({ code: "CANARY_SENTINEL_CHARACTER_FORBIDDEN" });

    await expect(
      runScoringCanaryDiscovery({
        prisma: prisma as never,
        artifacts: artifacts as never,
        evidence: evidence as never,
        characterId: "11111111-1111-4111-8111-111111111111",
        characterResolution: {
          characterResolutionSource: "test.injected",
          characterId: "11111111-1111-4111-8111-111111111111",
          characterCanonicalIdentity: {
            region: "EU",
            realmSlug: "archimonde",
            name: "Wallidrixe",
          },
          repositoryMode: "MEMORY",
        },
        seasonResolution: seasonResolutionOk,
        role: "DPS",
        classSlug: null,
        specSlug: null,
        rateBudgetConfig: { warnPercent: 70, deferPercent: 80, stopPercent: 90 },
        ensureRateLimitSnapshot: ensureOkBootstrap(),
        discover: async (_ctx) => ({
          candidates: fullCandidates(),
          rankingEvidence: [],
          reportsListed: 0,
          reportsHydrated: 0,
          fightsExamined: 0,
          graphqlRequestCount: 0,
          capabilityEventPageRequestCount: 0,
          measuredPoints: 0,
          estimatedPoints: 0,
        }),
      }),
    ).rejects.toMatchObject({ code: "CANARY_REPOSITORY_MODE_FORBIDDEN" });
  });

  it("retry reuses a complete compatible manifest with zero provider calls", async () => {
    const { prisma, artifacts, evidence, manifests } = mockPersistence();
    const discover = vi.fn(async () => ({
      candidates: fullCandidates(),
      rankingEvidence: [],
      reportsListed: 8,
      reportsHydrated: 8,
      fightsExamined: 16,
      graphqlRequestCount: 9,
      capabilityEventPageRequestCount: 0,
      measuredPoints: 12,
      estimatedPoints: 12,
    }));

    const input = {
      prisma: prisma as never,
      artifacts: artifacts as never,
      evidence: evidence as never,
      characterId: "11111111-1111-4111-8111-111111111111",
      characterResolution: {
        characterResolutionSource: "postgresql.findByIdentity" as const,
        characterId: "11111111-1111-4111-8111-111111111111",
        characterCanonicalIdentity: {
          region: "EU",
          realmSlug: "archimonde",
          name: "Wallidrixe",
        },
        repositoryMode: "PRODUCTION" as const,
      },
      seasonResolution: seasonResolutionOk,
      role: "DPS" as const,
      classSlug: "mage",
      specSlug: "arcane",
      rateBudgetConfig: { warnPercent: 70, deferPercent: 80, stopPercent: 90 },
      ensureRateLimitSnapshot: ensureOkBootstrap(),
      discover,
    };

    const first = await runScoringCanaryDiscovery(input);
    expect(first.report.manifestStatus).toBe("CREATED");
    expect(discover).toHaveBeenCalledTimes(1);

    // Seed findFirst from created manifest document.
    const created = [...manifests.values()][0]!;
    prisma.evidenceManifest.findFirst = vi.fn(async () => ({
      id: created.id,
      document: created.document,
      seasonId: created.seasonId,
      frozenAt: new Date(),
    }));

    const second = await runScoringCanaryDiscovery(input);
    expect(second.report.manifestStatus).toBe("REUSED");
    expect(second.report.reusedExistingManifest).toBe(true);
    expect(second.report.graphqlRequestCount).toBe(0);
    expect(discover).toHaveBeenCalledTimes(1);
  });

  it("does not reuse a manifest with a different dungeon-pool hash", async () => {
    const { prisma, artifacts, evidence } = mockPersistence();
    const scope = {
      characterId: "11111111-1111-4111-8111-111111111111",
      seasonId: "season-row-1",
      seasonSlug: "blizzard-season-17",
      specializationId: null,
      classSlug: "mage",
      specSlug: "arcane",
      role: "DPS" as const,
      refreshContractHash: "rh",
      selectorVersion: EVIDENCE_SELECTOR_VERSION,
      evidenceCutoffAt: "2099-01-01T00:00:00.000Z",
      highKeyPolicyId: "canary-discovery-v1",
      activeDungeonSlugs: [...MIDNIGHT_SEASON_1_DUNGEON_SLUGS],
    };
    const { plan } = buildEvidenceAcquisitionPlanV2({
      scope,
      candidates: fullCandidates(),
      plannedAt: new Date().toISOString(),
    });
    const { manifest } = finalizeEvidenceManifestV2({
      plan,
      acquisitionResults: plan.slots.flatMap((slot) =>
        slot.orderedCandidates.slice(0, 1).map((c) => ({
          discoveryIdentity: { ...c.discoveryIdentity },
          acquisitionStatus: "ACQUIRED" as const,
          reportRevision: 1,
          rejectionReason: null,
          rejectionDetail: null,
          datasetHashes: [],
          factSetHash: "x",
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
      ),
      selectedAt: new Date().toISOString(),
    });

    prisma.evidenceManifest.findFirst = vi.fn(async () => ({
      id: "old-man",
      document: { ...manifest, dungeonPoolHash: "other-pool" },
      seasonId: "season-row-1",
      frozenAt: new Date(),
    }));

    const discover = vi.fn(async () => ({
      candidates: fullCandidates(),
      rankingEvidence: [],
      reportsListed: 1,
      reportsHydrated: 1,
      fightsExamined: 2,
      graphqlRequestCount: 2,
      capabilityEventPageRequestCount: 0,
      measuredPoints: 1,
      estimatedPoints: 1,
    }));

    const { report } = await runScoringCanaryDiscovery({
      prisma: prisma as never,
      artifacts: artifacts as never,
      evidence: evidence as never,
      characterId: "11111111-1111-4111-8111-111111111111",
      characterResolution: {
        characterResolutionSource: "postgresql.findByIdentity",
        characterId: "11111111-1111-4111-8111-111111111111",
        characterCanonicalIdentity: {
          region: "EU",
          realmSlug: "archimonde",
          name: "Wallidrixe",
        },
        repositoryMode: "PRODUCTION",
      },
      seasonResolution: seasonResolutionOk,
      role: "DPS",
      classSlug: "mage",
      specSlug: "arcane",
      rateBudgetConfig: { warnPercent: 70, deferPercent: 80, stopPercent: 90 },
      ensureRateLimitSnapshot: ensureOkBootstrap(),
      discover,
    });

    expect(discover).toHaveBeenCalled();
    expect(report.manifestStatus).not.toBe("REUSED");
  });

  it("selects dynamically dungeonCount × 2 for a 9-dungeon season", async () => {
    const { prisma, artifacts, evidence } = mockPersistence();
    const nine = [...MIDNIGHT_SEASON_1_DUNGEON_SLUGS, "extra-dungeon-nine"];
    const cands: EvidenceCandidateMetadataV2[] = [];
    let fight = 1;
    for (const slug of nine) {
      cands.push(candidate(slug, fight++, 0));
      cands.push(candidate(slug, fight++, 1));
    }
    const { report } = await runScoringCanaryDiscovery({
      prisma: prisma as never,
      artifacts: artifacts as never,
      evidence: evidence as never,
      characterId: "11111111-1111-4111-8111-111111111111",
      characterResolution: {
        characterResolutionSource: "postgresql.findByIdentity",
        characterId: "11111111-1111-4111-8111-111111111111",
        characterCanonicalIdentity: {
          region: "EU",
          realmSlug: "archimonde",
          name: "Wallidrixe",
        },
        repositoryMode: "PRODUCTION",
      },
      seasonResolution: {
        ...seasonResolutionOk,
        activeDungeonSlugs: nine,
        dungeonCount: 9,
        expectedSlotCount: 18,
        dungeonPoolHash: "pool-9",
      },
      role: "DPS",
      classSlug: null,
      specSlug: null,
      rateBudgetConfig: { warnPercent: 70, deferPercent: 80, stopPercent: 90 },
      ensureRateLimitSnapshot: ensureOkBootstrap(),
      discover: async (_ctx) => ({
        candidates: cands,
        rankingEvidence: [],
        reportsListed: 9,
        reportsHydrated: 9,
        fightsExamined: 18,
        graphqlRequestCount: 10,
        capabilityEventPageRequestCount: 0,
        measuredPoints: 10,
        estimatedPoints: 10,
      }),
    });
    expect(report.expectedSlotCount).toBe(18);
    expect(report.selectedSlotCount).toBe(18);
  });

  it("surfaces iterative hydration diagnostics and HYDRATION_INCOMPLETE when stubs remain", async () => {
    const { prisma, artifacts, evidence } = mockPersistence();
    const all = fullCandidates();
    const windrunner = all.filter((c) => c.dungeonSlug.toLowerCase() === "windrunner-spire");
    const cands = [
      ...all.filter((c) => c.dungeonSlug.toLowerCase() !== "windrunner-spire"),
      windrunner[0]!,
    ];
    expect(cands.filter((c) => c.dungeonSlug === "windrunner-spire")).toHaveLength(1);

    let admitSeen = false;
    const { report } = await runScoringCanaryDiscovery({
      prisma: prisma as never,
      artifacts: artifacts as never,
      evidence: evidence as never,
      characterId: "11111111-1111-4111-8111-111111111111",
      characterResolution: {
        characterResolutionSource: "postgresql.findByIdentity",
        characterId: "11111111-1111-4111-8111-111111111111",
        characterCanonicalIdentity: {
          region: "EU",
          realmSlug: "archimonde",
          name: "Wallidrixe",
        },
        repositoryMode: "PRODUCTION",
      },
      seasonResolution: seasonResolutionOk,
      role: "DPS",
      classSlug: null,
      specSlug: null,
      rateBudgetConfig: { warnPercent: 70, deferPercent: 80, stopPercent: 90 },
      ensureRateLimitSnapshot: ensureOkBootstrap(),
      diagnosticReportCode: "7qtb9Wp4ZdYwmKPH",
      discover: async (ctx) => {
        const decision = await ctx.evaluateIncrementalAdmission({
          batchSize: 6,
          projectedIncrementalPoints: 18,
          reportsHydratedSoFar: 24,
          reportsRemaining: 20,
        });
        admitSeen = decision.allow === true;
        return {
          candidates: cands,
          rankingEvidence: [],
          reportsListed: 44,
          reportsHydrated: 24,
          fightsExamined: cands.length,
          graphqlRequestCount: 30,
          capabilityEventPageRequestCount: 0,
          measuredPoints: null,
          estimatedPoints: 30,
          unhydratedReportCount: 20,
          omittedReports: [
            {
              reportCode: "7qtb9Wp4ZdYwmKPH",
              reason: "REPORT_LEFT_UNHYDRATED_NO_MORE_BUDGET",
              dungeonSlug: null,
              listedOrderIndex: 24,
            },
          ],
          iterativeHydration: {
            initialHydrationBudget: 24,
            reportsHydratedInitial: 24,
            incrementalBatchCount: 0,
            reportsHydratedIncrementally: 0,
            totalReportsHydrated: 24,
            totalReportsListed: 44,
            reportsRemaining: 20,
            incrementalProviderCalls: 0,
            incrementalEstimatedPoints: 0,
            terminalHydrationReason: "rate_admission_defer",
            listedReportOrder: ["x", "7qtb9Wp4ZdYwmKPH"],
            initialHydrationOrder: ["x"],
          },
        };
      },
    });

    expect(admitSeen).toBe(true);
    expect(report.capabilityPackageAcquisitions).toBe(0);
    expect(report.selectedSlotCount).toBe(15);
    expect(report.analysisStatus).toBe("PARTIAL");
    expect(report.iterativeHydration?.terminalHydrationReason).toBe("rate_admission_defer");
    expect(report.missingSlots.some((m) => m.reason.includes("HYDRATION_INCOMPLETE"))).toBe(
      true,
    );
    expect(report.targetReportTrace?.reportCode).toBe("7qtb9Wp4ZdYwmKPH");
    expect(report.targetReportTrace?.listedOrderIndex).toBe(24);
  });
});

describe("preflight after discovery semantics", () => {
  it("MANIFEST_NOT_FOUND uses NOT_EVALUATED fields and safety checks", async () => {
    const ports = createMemoryOrchestrationPorts({ autoSeedRanking: false });
    const report = await runScoringCanaryPreflight({
      characterId: "11111111-1111-4111-8111-111111111111",
      characterName: "Wallidrixe",
      region: "eu",
      realm: "archimonde",
      zoneId: 47,
      seasonId: "season-row-1",
      scoringModelId: "model",
      scope: {
        characterId: "11111111-1111-4111-8111-111111111111",
        seasonId: "season-row-1",
        seasonSlug: "blizzard-season-17",
        specializationId: null,
        classSlug: null,
        specSlug: null,
        role: "DPS",
        refreshContractHash: "rh",
        selectorVersion: EVIDENCE_SELECTOR_VERSION,
        evidenceCutoffAt: "2099-01-01T00:00:00.000Z",
        highKeyPolicyId: "h",
        activeDungeonSlugs: [...MIDNIGHT_SEASON_1_DUNGEON_SLUGS],
      },
      candidates: [],
      ports,
      existingManifest: null,
      allowSyntheticManifest: false,
      repositoryMode: "PRODUCTION",
      rateBudgetConfig: { warnPercent: 70, deferPercent: 80, stopPercent: 90 },
    });

    expect(report.manifestStatus).toBe("MANIFEST_NOT_FOUND");
    expect(report.fightsRequiringWcl).toBeNull();
    expect(report.rankingFactsMissing).toEqual([]);
    expect(report.slots.every((s) => s.packageCache === "NOT_EVALUATED")).toBe(true);
    expect(report.blockers).toEqual(["MANIFEST_NOT_FOUND"]);
    expect(report.safetyChecks).toEqual({
      providerFree: true,
      publicationDisabled: true,
      publicPointerUntouched: true,
    });
  });

  it("second preflight with frozen manifest reports package misses", async () => {
    const ports = createMemoryOrchestrationPorts({ autoSeedRanking: false });
    const scope = {
      characterId: "11111111-1111-4111-8111-111111111111",
      seasonId: "season-row-1",
      seasonSlug: "blizzard-season-17",
      specializationId: null,
      classSlug: "mage" as string | null,
      specSlug: "arcane" as string | null,
      role: "DPS" as const,
      refreshContractHash: "rh",
      selectorVersion: EVIDENCE_SELECTOR_VERSION,
      evidenceCutoffAt: "2099-01-01T00:00:00.000Z",
      highKeyPolicyId: "h",
      activeDungeonSlugs: [...MIDNIGHT_SEASON_1_DUNGEON_SLUGS],
    };
    const { plan } = buildEvidenceAcquisitionPlanV2({
      scope,
      candidates: fullCandidates(),
      plannedAt: new Date().toISOString(),
    });
    const { manifest } = finalizeEvidenceManifestV2({
      plan,
      acquisitionResults: plan.slots.flatMap((slot) =>
        slot.orderedCandidates.map((c) => ({
          discoveryIdentity: { ...c.discoveryIdentity },
          acquisitionStatus: "ACQUIRED" as const,
          reportRevision: 1,
          rejectionReason: null,
          rejectionDetail: null,
          datasetHashes: [],
          factSetHash: "x",
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
      ),
      selectedAt: new Date().toISOString(),
    });

    expect(manifest.selectedSlotCount).toBe(16);

    const report = await runScoringCanaryPreflight({
      characterId: scope.characterId,
      characterName: "Wallidrixe",
      region: "eu",
      realm: "archimonde",
      zoneId: 47,
      seasonId: scope.seasonId,
      scoringModelId: "model",
      scope,
      candidates: fullCandidates(),
      ports,
      existingManifest: manifest,
      allowSyntheticManifest: false,
      repositoryMode: "PRODUCTION",
      rateBudgetConfig: { warnPercent: 70, deferPercent: 80, stopPercent: 90 },
    });

    expect(report.manifestStatus).toBe("FOUND");
    expect(report.fightsRequiringWcl).not.toBeNull();
    expect(
      report.slots.filter((s) => s.state === "SELECTED" && s.packageCache === "MISS")
        .length,
    ).toBeGreaterThan(0);
    expect(report.fightsRequiringWcl!.length).toBeGreaterThan(0);
    expect(report.safetyChecks.publicationDisabled).toBe(true);
    // With SELECTED slots and package misses, capability cost is projected.
    expect(report.cost.fights.length).toBeGreaterThan(0);
  });
});
