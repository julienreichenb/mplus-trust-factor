/**
 * Cohort bootstrap runner — safety, planning, idempotency, and concurrency tests.
 * Uses mocks / disposable DB only. Never calls live providers.
 */
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertCalibrationBootstrapEnv,
  assertLiveProviderCallsAllowedForExecute,
  assertPositiveTestBootstrapTarget,
  assertResumeManifestCompatible,
  isPositiveTestBootstrapTarget,
  parseBoundedPositiveInt,
  parseLimitOption,
  sanitizeEvidenceDbTarget,
  BOOTSTRAP_SCHEMA_VERSION,
} from "./bootstrap-env-guards.js";
import {
  buildBootstrapJobKey,
  buildIdentityKey,
  dedupeCohortIdentities,
  hashFileContents,
  parseCohortBootstrapDoc,
} from "./cohort-bootstrap-identity.js";
import { planBootstrapCohort, planOneIdentity } from "./cohort-bootstrap-plan.js";
import {
  BOOTSTRAP_EVENTS,
  executeBootstrapPlan,
} from "./cohort-bootstrap-execute.js";
import { main as cohortBootstrapMain } from "./cohort-bootstrap-cli.js";
import type { BootstrapIdentity, BootstrapManifest, DbCharacterProbe } from "./cohort-bootstrap-types.js";
import type { PrismaClient } from "@mplus/database";

let prisma: PrismaClient | null = null;
let dbAvailable = false;
try {
  const helpers = await import("../../test-helpers.js");
  const client = await helpers.createTestPrismaClient();
  prisma = client.prisma;
  dbAvailable = client.dbAvailable;
} catch (error) {
  console.warn(
    `cohort-bootstrap integration tests skipped (no isolated test DB): ${
      error instanceof Error ? error.message.split("\n")[0] : error
    }`,
  );
}

async function requirePrisma(): Promise<PrismaClient> {
  if (!prisma) throw new Error("Prisma client unavailable");
  return prisma;
}

function sampleMembers() {
  return [
    {
      id: "user-s-eu-hyjal-zacdruid-tank",
      region: "EU",
      realm: "hyjal",
      character: "Zacdruid",
      expectedTier: "S",
      expectedLabel: "excellent",
      exclusionReason: null,
      blizzardCharacterId: "225202121",
    },
    {
      id: "user-s-eu-burning-legion-myzouth-dps",
      region: "EU",
      realm: "burning-legion",
      character: "Myzouth",
      expectedTier: "S",
      expectedLabel: "excellent",
      exclusionReason: "MYZOUTH_BOOTSTRAP_DEFERRED",
      blizzardCharacterId: "187576113",
    },
    {
      id: "user-c-eu-outland-petbear-tank",
      region: "EU",
      realm: "outland",
      character: "Petbear",
      expectedTier: "C",
      expectedLabel: "average",
      exclusionReason: "ROLE_CONTEXT_CONFLICT",
    },
    {
      id: "user-d-eu-outland-petbear-dps",
      region: "EU",
      realm: "Outland",
      character: "PETBEAR",
      expectedTier: "D",
      expectedLabel: "weak",
      exclusionReason: "ROLE_CONTEXT_CONFLICT",
    },
    {
      id: "user-a-eu-kazzak-missing-dps",
      region: "EU",
      realm: "kazzak",
      character: "Missingone",
      expectedTier: "A",
      expectedLabel: "good",
      exclusionReason: null,
    },
  ];
}

describe("bootstrap env guards", () => {
  const prevBootstrap = process.env.CALIBRATION_BOOTSTRAP_ENV;
  const prevAllow = process.env.ALLOW_LIVE_PROVIDER_CALLS;

  afterEach(() => {
    if (prevBootstrap === undefined) delete process.env.CALIBRATION_BOOTSTRAP_ENV;
    else process.env.CALIBRATION_BOOTSTRAP_ENV = prevBootstrap;
    if (prevAllow === undefined) delete process.env.ALLOW_LIVE_PROVIDER_CALLS;
    else process.env.ALLOW_LIVE_PROVIDER_CALLS = prevAllow;
  });

  it("refuses execute without CALIBRATION_BOOTSTRAP_ENV=test", () => {
    delete process.env.CALIBRATION_BOOTSTRAP_ENV;
    expect(() => assertCalibrationBootstrapEnv()).toThrow(/must be exactly "test"/);
    process.env.CALIBRATION_BOOTSTRAP_ENV = "production";
    expect(() => assertCalibrationBootstrapEnv()).toThrow(/must be exactly "test"/);
    process.env.CALIBRATION_BOOTSTRAP_ENV = "test";
    expect(() => assertCalibrationBootstrapEnv()).not.toThrow();
  });

  it("refuses execute when live provider calls are not allowed", () => {
    process.env.ALLOW_LIVE_PROVIDER_CALLS = "false";
    expect(() => assertLiveProviderCallsAllowedForExecute()).toThrow(/ALLOW_LIVE_PROVIDER_CALLS/);
    process.env.ALLOW_LIVE_PROVIDER_CALLS = "true";
    expect(() => assertLiveProviderCallsAllowedForExecute()).not.toThrow();
  });

  it("rejects production-like database targets", () => {
    expect(() =>
      assertPositiveTestBootstrapTarget(
        "postgresql://u:p@db.prod.example:5432/mplus_trust_prod?schema=public",
      ),
    ).toThrow(/production/);
    expect(() =>
      assertPositiveTestBootstrapTarget("postgresql://u:p@postgres:5432/mplus_trust?schema=public"),
    ).toThrow(/development database|not positively identified/);
  });

  it("accepts positively identified test targets and rejects bypass shapes", () => {
    const target = assertPositiveTestBootstrapTarget(
      "postgresql://u:p@postgres:5432/mplus_trust_test?schema=public",
    );
    expect(target.database).toBe("mplus_trust_test");
    expect(
      isPositiveTestBootstrapTarget(
        sanitizeEvidenceDbTarget(
          "postgresql://u:p@localhost:5433/mplus_itest_abcdefgh?schema=public",
        ),
      ),
    ).toBe(true);

    // URL-encoded database name still decoded and classified.
    expect(() =>
      assertPositiveTestBootstrapTarget(
        "postgresql://u:p@postgres:5432/mplus_trust_prod%3Fattack?schema=public",
      ),
    ).toThrow(/production|not positively identified/);

    // Production hostname with test-like DB name.
    expect(() =>
      assertPositiveTestBootstrapTarget(
        "postgresql://u:p@mplus-prod.example:5432/mplus_trust_test?schema=public",
      ),
    ).toThrow(/production/);

    // Test hostname with production DB name.
    expect(() =>
      assertPositiveTestBootstrapTarget(
        "postgresql://u:p@postgres:5432/MPLUS_TRUST_PROD?schema=public",
      ),
    ).toThrow(/production/);

    // Ambiguous non-test target.
    expect(() =>
      assertPositiveTestBootstrapTarget("postgresql://u:p@db.internal:5432/app?schema=public"),
    ).toThrow(/not positively identified/);

    // Whitespace-only env is refused by assertCalibrationBootstrapEnv (covered above).
  });

  it("fails closed on invalid concurrency/limit and resume metadata mismatch", () => {
    expect(() =>
      parseBoundedPositiveInt("abc", { name: "concurrency", defaultValue: 2, min: 1, max: 8 }),
    ).toThrow(/integer/);
    expect(() =>
      parseBoundedPositiveInt("0", { name: "concurrency", defaultValue: 2, min: 1, max: 8 }),
    ).toThrow(/\[1, 8\]/);
    expect(() =>
      parseBoundedPositiveInt("9", { name: "concurrency", defaultValue: 2, min: 1, max: 8 }),
    ).toThrow(/\[1, 8\]/);
    expect(parseBoundedPositiveInt(undefined, { name: "concurrency", defaultValue: 2, min: 1, max: 8 })).toBe(
      2,
    );

    expect(parseLimitOption(undefined)).toBeNull();
    expect(parseLimitOption("37")).toBe(37);
    expect(() => parseLimitOption("0")).toThrow(/>= 1/);
    expect(() => parseLimitOption("abc")).toThrow(/positive integer/);

    expect(() =>
      assertResumeManifestCompatible(
        {
          schemaVersion: BOOTSTRAP_SCHEMA_VERSION,
          cohortId: "other-cohort",
          sourceFileHash: "abc",
          targetEnvironment: "test",
          identities: [],
        },
        {
          schemaVersion: BOOTSTRAP_SCHEMA_VERSION,
          cohortId: "agent11-user-cohort-2026-08-01",
          sourceFileHash: "abc",
        },
      ),
    ).toThrow(/cohortId mismatch/);

    expect(() =>
      assertResumeManifestCompatible(
        {
          schemaVersion: BOOTSTRAP_SCHEMA_VERSION,
          cohortId: "agent11-user-cohort-2026-08-01",
          sourceFileHash: "deadbeef",
          targetEnvironment: "test",
          identities: [],
        },
        {
          schemaVersion: BOOTSTRAP_SCHEMA_VERSION,
          cohortId: "agent11-user-cohort-2026-08-01",
          sourceFileHash: "abc",
        },
      ),
    ).toThrow(/sourceFileHash mismatch/);

    expect(() =>
      assertResumeManifestCompatible(
        {
          schemaVersion: "wrong",
          cohortId: "agent11-user-cohort-2026-08-01",
          sourceFileHash: "abc",
          targetEnvironment: "test",
          identities: [],
        },
        {
          schemaVersion: BOOTSTRAP_SCHEMA_VERSION,
          cohortId: "agent11-user-cohort-2026-08-01",
          sourceFileHash: "abc",
        },
      ),
    ).toThrow(/schemaVersion mismatch/);
  });
});

describe("identity dedupe", () => {
  it("collapses casing / Petbear dual roles into one identity", () => {
    const identities = dedupeCohortIdentities(sampleMembers());
    expect(identities).toHaveLength(4);
    const petbear = identities.find((i) => i.normalizedName === "petbear");
    expect(petbear?.memberIds).toHaveLength(2);
    expect(petbear?.fullyExcluded).toBe(true);
    expect(buildIdentityKey("eu", "Hyjal", "ZacDruid")).toBe("EU/hyjal/zacdruid");
  });

  it("preserves Agent 11 41-member / 40-identity relationship from resolved cohort", () => {
    const path = join(
      process.cwd(),
      "doc/scoring/cohorts/agent11-2026-08-01/resolved.v1.json",
    );
    const doc = parseCohortBootstrapDoc(JSON.parse(readFileSync(path, "utf8")));
    expect(doc.members).toHaveLength(41);
    const identities = dedupeCohortIdentities(doc.members);
    expect(identities).toHaveLength(40);
  });

  it("plans 36 MISSING enqueue candidates on an empty DB (4 excluded identities)", () => {
    const path = join(
      process.cwd(),
      "doc/scoring/cohorts/agent11-2026-08-01/resolved.v1.json",
    );
    const doc = parseCohortBootstrapDoc(JSON.parse(readFileSync(path, "utf8")));
    const identities = dedupeCohortIdentities(doc.members);
    const dbByIdentityKey = new Map(identities.map((i) => [i.identityKey, null]));
    const { counts, entries } = planBootstrapCohort({
      cohortId: doc.cohortId,
      identities,
      dbByIdentityKey,
      includeMemberIds: new Set(),
      retryFailures: false,
    });
    expect(counts.EXCLUDED).toBe(4);
    expect(counts.MISSING).toBe(36);
    expect(entries.filter((e) => e.plannedOperation === "ENQUEUE_RESOLVE_REFRESH")).toHaveLength(36);
    expect(
      entries.find((e) => e.identityKey.includes("myzouth"))?.initialState,
    ).toBe("EXCLUDED");
  });
});

describe("planner states", () => {
  const cohortId = "agent11-user-cohort-2026-08-01";

  function identity(partial: Partial<BootstrapIdentity> & Pick<BootstrapIdentity, "identityKey" | "memberIds">): BootstrapIdentity {
    return {
      region: "EU",
      realmSlug: "hyjal",
      name: "Zacdruid",
      normalizedName: "zacdruid",
      blizzardCharacterId: null,
      expectedLabels: ["excellent"],
      expectedTiers: ["S"],
      exclusionReasons: [null],
      fullyExcluded: false,
      isMyzouth: false,
      ...partial,
    };
  }

  it("marks missing characters for enqueue and ready characters as skip", () => {
    const missing = planOneIdentity(
      identity({ identityKey: "EU/kazzak/missingone", name: "Missingone", normalizedName: "missingone", realmSlug: "kazzak", memberIds: ["m1"] }),
      null,
      { cohortId, includeMemberIds: new Set(), retryFailures: false },
    );
    expect(missing.initialState).toBe("MISSING");
    expect(missing.plannedOperation).toBe("ENQUEUE_RESOLVE_REFRESH");

    const readyProbe: DbCharacterProbe = {
      characterId: "11111111-1111-1111-1111-111111111111",
      incompleteBootstrap: false,
      hasPublicSnapshot: true,
      activeJobId: null,
      activeJobStatus: null,
      latestJobId: null,
      latestJobStatus: null,
      latestJobErrorCode: null,
    };
    const ready = planOneIdentity(
      identity({ identityKey: "EU/hyjal/zacdruid", memberIds: ["m2"] }),
      readyProbe,
      { cohortId, includeMemberIds: new Set(), retryFailures: false },
    );
    expect(ready.initialState).toBe("ALREADY_READY");
    expect(ready.plannedOperation).toBe("SKIP");
  });

  it("keeps Myzouth deferred unless include-member override", () => {
    const myz = identity({
      identityKey: "EU/burning-legion/myzouth",
      name: "Myzouth",
      normalizedName: "myzouth",
      realmSlug: "burning-legion",
      memberIds: ["user-s-eu-burning-legion-myzouth-dps"],
      fullyExcluded: true,
      exclusionReasons: ["MYZOUTH_BOOTSTRAP_DEFERRED"],
      isMyzouth: true,
    });
    const deferred = planOneIdentity(myz, null, {
      cohortId,
      includeMemberIds: new Set(),
      retryFailures: false,
    });
    expect(deferred.initialState).toBe("EXCLUDED");

    const lifted = planOneIdentity(myz, null, {
      cohortId,
      includeMemberIds: new Set(["user-s-eu-burning-legion-myzouth-dps"]),
      retryFailures: false,
    });
    expect(lifted.initialState).toBe("MISSING");
  });

  it("keeps excluded members excluded", () => {
    const pet = identity({
      identityKey: "EU/outland/petbear",
      name: "Petbear",
      normalizedName: "petbear",
      realmSlug: "outland",
      memberIds: ["user-c-eu-outland-petbear-tank", "user-d-eu-outland-petbear-dps"],
      fullyExcluded: true,
      exclusionReasons: ["ROLE_CONTEXT_CONFLICT", "ROLE_CONTEXT_CONFLICT"],
    });
    const planned = planOneIdentity(pet, null, {
      cohortId,
      includeMemberIds: new Set(),
      retryFailures: false,
    });
    expect(planned.initialState).toBe("EXCLUDED");
  });

  it("skips already queued jobs from live DB; resume ALREADY_ENQUEUED rechecks live state", () => {
    const queuedProbe: DbCharacterProbe = {
      characterId: "22222222-2222-2222-2222-222222222222",
      incompleteBootstrap: true,
      hasPublicSnapshot: false,
      activeJobId: "job-active-1",
      activeJobStatus: "QUEUED",
      latestJobId: "job-active-1",
      latestJobStatus: "QUEUED",
      latestJobErrorCode: null,
    };
    const queued = planOneIdentity(
      identity({ identityKey: "EU/hyjal/zacdruid", memberIds: ["m1"] }),
      queuedProbe,
      { cohortId, includeMemberIds: new Set(), retryFailures: false },
    );
    expect(queued.initialState).toBe("ALREADY_ENQUEUED");
    expect(queued.plannedOperation).toBe("RESUME_WAIT");

    const readyProbe: DbCharacterProbe = {
      characterId: "22222222-2222-2222-2222-222222222222",
      incompleteBootstrap: false,
      hasPublicSnapshot: true,
      activeJobId: null,
      activeJobStatus: null,
      latestJobId: "job-active-1",
      latestJobStatus: "COMPLETED",
      latestJobErrorCode: null,
    };
    const afterSettle = planOneIdentity(
      identity({ identityKey: "EU/hyjal/zacdruid", memberIds: ["m1"] }),
      readyProbe,
      {
        cohortId,
        includeMemberIds: new Set(),
        retryFailures: false,
        resume: {
          identityKey: "EU/hyjal/zacdruid",
          memberIds: ["m1"],
          region: "EU",
          realmSlug: "hyjal",
          name: "Zacdruid",
          initialState: "MISSING",
          plannedOperation: "ENQUEUE_RESOLVE_REFRESH",
          bootstrapJobKey: buildBootstrapJobKey(cohortId, "EU/hyjal/zacdruid"),
          jobIds: ["job-active-1"],
          attemptCount: 1,
          resultState: "ALREADY_ENQUEUED",
          errorCode: "NONE",
          characterId: "22222222-2222-2222-2222-222222222222",
          reason: "was queued",
        },
      },
    );
    expect(afterSettle.initialState).toBe("ALREADY_READY");
    expect(afterSettle.plannedOperation).toBe("SKIP");

    const resume: BootstrapManifest = {
      schemaVersion: "agent11-cohort-bootstrap-manifest-v1",
      cohortId,
      sourceFileHash: "abc",
      targetEnvironment: "test",
      sanitizedDatabaseTarget: { hostname: "postgres", port: "5432", database: "mplus_trust_test" },
      generatedAt: "2026-08-01T00:00:00.000Z",
      runnerVersion: "agent11-cohort-bootstrap-v1",
      mode: "execute",
      identities: [
        {
          identityKey: "EU/hyjal/zacdruid",
          memberIds: ["m1"],
          region: "EU",
          realmSlug: "hyjal",
          name: "Zacdruid",
          initialState: "MISSING",
          plannedOperation: "ENQUEUE_RESOLVE_REFRESH",
          bootstrapJobKey: buildBootstrapJobKey(cohortId, "EU/hyjal/zacdruid"),
          jobIds: ["job-1"],
          attemptCount: 1,
          resultState: "TERMINAL_SUCCESS",
          errorCode: "NONE",
          characterId: "22222222-2222-2222-2222-222222222222",
          reason: "done",
        },
      ],
    };
    const { entries } = planBootstrapCohort({
      cohortId,
      identities: [identity({ identityKey: "EU/hyjal/zacdruid", memberIds: ["m1"] })],
      dbByIdentityKey: new Map([["EU/hyjal/zacdruid", null]]),
      includeMemberIds: new Set(),
      resumeManifest: resume,
      retryFailures: false,
    });
    expect(entries[0]!.initialState).toBe("TERMINAL_SUCCESS");
    expect(entries[0]!.plannedOperation).toBe("SKIP");
  });

  it("requires --retry-failures to re-enqueue retryable failures", () => {
    const id = identity({ identityKey: "EU/hyjal/zacdruid", memberIds: ["m1"] });
    const resume: BootstrapManifest["identities"][number] = {
      identityKey: id.identityKey,
      memberIds: id.memberIds,
      region: "EU",
      realmSlug: "hyjal",
      name: "Zacdruid",
      initialState: "MISSING",
      plannedOperation: "ENQUEUE_RESOLVE_REFRESH",
      bootstrapJobKey: buildBootstrapJobKey(cohortId, id.identityKey),
      jobIds: [],
      attemptCount: 1,
      resultState: "RETRYABLE_FAILURE",
      errorCode: "PROVIDER_UNAVAILABLE",
      characterId: null,
      reason: "transient",
    };
    const blocked = planOneIdentity(id, null, {
      cohortId,
      includeMemberIds: new Set(),
      resume,
      retryFailures: false,
    });
    expect(blocked.plannedOperation).toBe("SKIP");
    const allowed = planOneIdentity(id, null, {
      cohortId,
      includeMemberIds: new Set(),
      resume,
      retryFailures: true,
    });
    expect(allowed.plannedOperation).toBe("ENQUEUE_RESOLVE_REFRESH");
  });
});

describe("execute concurrency and enqueue", () => {
  it("bounds concurrency and does not duplicate queued jobs via resolve reuse", async () => {
    const events: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const resolveCharacter = vi.fn(async (identity: { name: string }) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      return {
        statusCode: 202,
        body: {
          status: "QUEUED" as const,
          characterId: "33333333-3333-3333-3333-333333333333",
          refreshId: `job-${identity.name}`,
          profilePath: "/character/eu/x/y",
          retryAfterMs: 2000,
        },
      };
    });

    const plan = ["a", "b", "c", "d", "e"].map((n) => ({
      identityKey: `EU/hyjal/${n}`,
      memberIds: [`m-${n}`],
      region: "EU",
      realmSlug: "hyjal",
      name: n,
      blizzardCharacterId: null,
      initialState: "MISSING" as const,
      plannedOperation: "ENQUEUE_RESOLVE_REFRESH" as const,
      reason: "missing",
      characterId: null,
      bootstrapJobKey: buildBootstrapJobKey("c", `EU/hyjal/${n}`),
      errorCode: "NONE" as const,
    }));

    const result = await executeBootstrapPlan(
      plan,
      {
        resolveCharacter,
        emit: (event) => events.push(event),
        safety: {
          characterPublishedScoreMutations: 0,
          modelActivations: 0,
          publicationJobsCreated: 0,
          featureFlagsMutated: 0,
          providerCalls: 0,
        },
      },
      { concurrency: 2, correlationPrefix: "test" },
    );

    expect(resolveCharacter).toHaveBeenCalledTimes(5);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(result.enqueuedJobIds).toHaveLength(5);
    expect(events).toContain(BOOTSTRAP_EVENTS.jobEnqueued);

    // Idempotent second pass: already enqueued identities skipped by planner before execute.
    const secondPlan = plan.map((p) => ({
      ...p,
      initialState: "ALREADY_ENQUEUED" as const,
      plannedOperation: "RESUME_WAIT" as const,
    }));
    const second = await executeBootstrapPlan(
      secondPlan,
      {
        resolveCharacter,
        emit: () => undefined,
        safety: {
          characterPublishedScoreMutations: 0,
          modelActivations: 0,
          publicationJobsCreated: 0,
          featureFlagsMutated: 0,
          providerCalls: 0,
        },
      },
      { concurrency: 2, correlationPrefix: "test" },
    );
    expect(resolveCharacter).toHaveBeenCalledTimes(5); // unchanged
    expect(second.enqueuedJobIds).toHaveLength(0);
  });

  it("records safety ledger with zero publication / model / flag mutations", async () => {
    const safety = {
      characterPublishedScoreMutations: 0,
      modelActivations: 0,
      publicationJobsCreated: 0,
      featureFlagsMutated: 0,
      providerCalls: 0,
    };
    await executeBootstrapPlan(
      [
        {
          identityKey: "EU/hyjal/ready",
          memberIds: ["m1"],
          region: "EU",
          realmSlug: "hyjal",
          name: "Ready",
          blizzardCharacterId: null,
          initialState: "ALREADY_READY",
          plannedOperation: "SKIP",
          reason: "ready",
          characterId: "44444444-4444-4444-4444-444444444444",
          bootstrapJobKey: "k",
          errorCode: "NONE",
        },
      ],
      {
        resolveCharacter: async () => {
          throw new Error("must not resolve skipped identities");
        },
        emit: () => undefined,
        safety,
      },
      { concurrency: 2, correlationPrefix: "test" },
    );
    expect(safety).toEqual({
      characterPublishedScoreMutations: 0,
      modelActivations: 0,
      publicationJobsCreated: 0,
      featureFlagsMutated: 0,
      providerCalls: 0,
    });
  });
});

describe("CLI dry-run / execute guards", () => {
  const tmpDirs: string[] = [];
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "CALIBRATION_BOOTSTRAP_ENV",
      "ALLOW_LIVE_PROVIDER_CALLS",
      "CALIBRATION_BOOTSTRAP_DATABASE_URL",
      "DATABASE_URL",
      "SCORING_V2_ENABLED",
      "CALIBRATION_V2_ENABLED",
    ]) {
      prev[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    for (const d of tmpDirs.splice(0)) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  it("refuses execute without test env and live provider allowance", async () => {
    process.env.CALIBRATION_BOOTSTRAP_ENV = "prod";
    process.env.ALLOW_LIVE_PROVIDER_CALLS = "true";
    const code = await cohortBootstrapMain([
      "--cohort-file",
      join(process.cwd(), "doc/scoring/cohorts/agent11-2026-08-01/resolved.v1.json"),
      "--environment",
      "test",
      "--execute",
    ]);
    expect(code).toBe(2);

    process.env.CALIBRATION_BOOTSTRAP_ENV = "test";
    process.env.ALLOW_LIVE_PROVIDER_CALLS = "false";
    const code2 = await cohortBootstrapMain([
      "--cohort-file",
      join(process.cwd(), "doc/scoring/cohorts/agent11-2026-08-01/resolved.v1.json"),
      "--environment",
      "test",
      "--execute",
    ]);
    expect(code2).toBe(2);
  });

  it("refuses dry-run + execute together", async () => {
    process.env.CALIBRATION_BOOTSTRAP_ENV = "test";
    const code = await cohortBootstrapMain([
      "--environment",
      "test",
      "--dry-run",
      "--execute",
    ]);
    expect(code).toBe(2);
  });

  it.runIf(dbAvailable)(
    "dry-run performs zero writes / zero provider calls and writes artifacts",
    async () => {
      const { buildTestEnv } = await import("../../test-helpers.js");
      const db = await requirePrisma();
      buildTestEnv();
      process.env.CALIBRATION_BOOTSTRAP_ENV = "test";
      process.env.ALLOW_LIVE_PROVIDER_CALLS = "false";
      process.env.CALIBRATION_BOOTSTRAP_DATABASE_URL = process.env.DATABASE_URL;

      const out = mkdtempSync(join(tmpdir(), "cohort-bootstrap-"));
      tmpDirs.push(out);
      const cohortPath = join(out, "resolved.v1.json");
      writeFileSync(
        cohortPath,
        JSON.stringify(
          {
            schemaVersion: "agent11-resolved-v1",
            cohortId: "agent11-user-cohort-2026-08-01",
            members: sampleMembers(),
          },
          null,
          2,
        ),
        "utf8",
      );

      const resolveCharacter = vi.fn(async () => {
        throw new Error("dry-run must not resolve");
      });

      const beforePublished = await db.characterPublishedScore.count();
      const beforeJobs = await db.ingestionJob.count();
      const beforeModels = await db.scoreModel.count({ where: { status: "ACTIVE" } });

      const code = await cohortBootstrapMain(
        [
          "--cohort-file",
          cohortPath,
          "--environment",
          "test",
          "--dry-run",
          "--output-dir",
          out,
        ],
        {
          deps: {
            prismaUrl: process.env.DATABASE_URL,
            resolveCharacter,
            nowIso: "2026-08-03T00:00:00.000Z",
          },
        },
      );
      expect(code).toBe(0);
      expect(resolveCharacter).not.toHaveBeenCalled();

      const afterPublished = await db.characterPublishedScore.count();
      const afterJobs = await db.ingestionJob.count();
      const afterModels = await db.scoreModel.count({ where: { status: "ACTIVE" } });
      expect(afterPublished).toBe(beforePublished);
      expect(afterJobs).toBe(beforeJobs);
      expect(afterModels).toBe(beforeModels);

      const plan = JSON.parse(readFileSync(join(out, "cohort-bootstrap.plan.json"), "utf8"));
      const summary = JSON.parse(readFileSync(join(out, "cohort-bootstrap.summary.json"), "utf8"));
      expect(plan.mode).toBe("dry-run");
      expect(summary.enqueuedJobIds).toEqual([]);
      expect(plan.identities.some((i: { initialState: string }) => i.initialState === "EXCLUDED")).toBe(
        true,
      );
      const myz = plan.identities.find((i: { identityKey: string }) =>
        i.identityKey.includes("myzouth"),
      );
      expect(myz.initialState).toBe("EXCLUDED");
      expect(process.env.SCORING_V2_ENABLED ?? "false").not.toBe("true");
      expect(process.env.CALIBRATION_V2_ENABLED ?? "false").not.toBe("true");
    },
  );

  it.runIf(dbAvailable)(
    "dry-run of canonical Agent 11 resolved cohort plans MISSING enqueue without writes",
    async () => {
      const { buildTestEnv } = await import("../../test-helpers.js");
      const db = await requirePrisma();
      buildTestEnv();
      process.env.CALIBRATION_BOOTSTRAP_ENV = "test";
      process.env.ALLOW_LIVE_PROVIDER_CALLS = "false";
      process.env.CALIBRATION_BOOTSTRAP_DATABASE_URL = process.env.DATABASE_URL;

      const out = mkdtempSync(join(tmpdir(), "cohort-bootstrap-a11-"));
      tmpDirs.push(out);
      const beforeJobs = await db.ingestionJob.count();
      const beforePublished = await db.characterPublishedScore.count();

      const code = await cohortBootstrapMain(
        [
          "--cohort-file",
          join(process.cwd(), "doc/scoring/cohorts/agent11-2026-08-01/resolved.v1.json"),
          "--environment",
          "test",
          "--dry-run",
          "--output-dir",
          out,
        ],
        {
          deps: {
            prismaUrl: process.env.DATABASE_URL,
            resolveCharacter: async () => {
              throw new Error("dry-run must not resolve");
            },
            nowIso: "2026-08-03T00:00:00.000Z",
          },
        },
      );
      expect(code).toBe(0);
      expect(await db.ingestionJob.count()).toBe(beforeJobs);
      expect(await db.characterPublishedScore.count()).toBe(beforePublished);

      const summary = JSON.parse(readFileSync(join(out, "cohort-bootstrap.summary.json"), "utf8"));
      expect(summary.memberCount).toBe(41);
      expect(summary.uniqueIdentityCount).toBe(40);
      expect(summary.counts.EXCLUDED).toBeGreaterThanOrEqual(4);
      expect(summary.counts.MISSING).toBeGreaterThanOrEqual(35);
      expect(summary.counts.plannedEnqueue).toBe(summary.counts.MISSING);
      expect(summary.enqueuedJobIds).toEqual([]);

      const plan = JSON.parse(readFileSync(join(out, "cohort-bootstrap.plan.json"), "utf8"));
      const myz = plan.identities.find((i: { identityKey: string }) =>
        String(i.identityKey).includes("myzouth"),
      );
      expect(myz?.initialState).toBe("EXCLUDED");
    },
  );

  it.runIf(dbAvailable)(
    "execute enqueues via injected resolve without publication / model activation",
    async () => {
      const { buildTestEnv } = await import("../../test-helpers.js");
      const db = await requirePrisma();
      buildTestEnv();
      process.env.CALIBRATION_BOOTSTRAP_ENV = "test";
      process.env.ALLOW_LIVE_PROVIDER_CALLS = "true";
      process.env.CALIBRATION_BOOTSTRAP_DATABASE_URL = process.env.DATABASE_URL;

      const out = mkdtempSync(join(tmpdir(), "cohort-bootstrap-exec-"));
      tmpDirs.push(out);
      const cohortPath = join(out, "resolved.v1.json");
      writeFileSync(
        cohortPath,
        JSON.stringify(
          {
            schemaVersion: "agent11-resolved-v1",
            cohortId: "agent11-user-cohort-2026-08-01",
            members: [
              {
                id: "user-a-eu-kazzak-missing-dps",
                region: "EU",
                realm: "kazzak",
                character: "Missingone",
                expectedTier: "A",
                expectedLabel: "good",
                exclusionReason: null,
              },
            ],
          },
          null,
          2,
        ),
        "utf8",
      );

      const beforePublished = await db.characterPublishedScore.count();
      const resolveCharacter = vi.fn(async () => ({
        statusCode: 202,
        body: {
          status: "QUEUED" as const,
          characterId: "55555555-5555-5555-5555-555555555555",
          refreshId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          profilePath: "/character/eu/kazzak/missingone",
          retryAfterMs: 2000,
        },
      }));

      const code = await cohortBootstrapMain(
        [
          "--cohort-file",
          cohortPath,
          "--environment",
          "test",
          "--execute",
          "--limit",
          "37",
          "--concurrency",
          "2",
          "--output-dir",
          out,
        ],
        {
          deps: {
            prismaUrl: process.env.DATABASE_URL,
            resolveCharacter,
            nowIso: "2026-08-03T00:00:00.000Z",
          },
        },
      );
      expect(code).toBe(0);
      expect(resolveCharacter).toHaveBeenCalledTimes(1);
      const manifest = JSON.parse(readFileSync(join(out, "cohort-bootstrap.manifest.json"), "utf8"));
      expect(manifest.identities[0].jobIds).toEqual(["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]);
      expect(await db.characterPublishedScore.count()).toBe(beforePublished);

      // Resume with TERMINAL_SUCCESS is skipped without re-resolve.
      // (ALREADY_ENQUEUED resumes re-check live DB — covered in planner unit tests.)
      manifest.identities[0].resultState = "TERMINAL_SUCCESS";
      const resumePath = join(out, "cohort-bootstrap.manifest.json");
      writeFileSync(resumePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      resolveCharacter.mockClear();
      const code2 = await cohortBootstrapMain(
        [
          "--cohort-file",
          cohortPath,
          "--environment",
          "test",
          "--execute",
          "--resume-manifest",
          resumePath,
          "--output-dir",
          join(out, "resume"),
        ],
        {
          deps: {
            prismaUrl: process.env.DATABASE_URL,
            resolveCharacter,
            nowIso: "2026-08-03T00:01:00.000Z",
          },
        },
      );
      expect(code2).toBe(0);
      expect(resolveCharacter).not.toHaveBeenCalled();

      // Wrong cohort resume fails closed.
      manifest.cohortId = "other-cohort";
      writeFileSync(resumePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      const code3 = await cohortBootstrapMain(
        [
          "--cohort-file",
          cohortPath,
          "--environment",
          "test",
          "--execute",
          "--resume-manifest",
          resumePath,
          "--output-dir",
          join(out, "resume-bad"),
        ],
        {
          deps: {
            prismaUrl: process.env.DATABASE_URL,
            resolveCharacter,
            nowIso: "2026-08-03T00:02:00.000Z",
          },
        },
      );
      expect(code3).toBe(2);
    },
  );
});

describe("hash stability", () => {
  it("source hash is deterministic for identical content", () => {
    const a = hashFileContents('{"ok":true}');
    const b = hashFileContents('{"ok":true}');
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });
});
