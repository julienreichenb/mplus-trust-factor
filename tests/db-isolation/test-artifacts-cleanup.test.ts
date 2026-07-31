/**
 * Regression coverage for general test-artifact cleanup (jobs, characters, models).
 */
import { describe, expect, it } from "vitest";
import {
  TEST_CHARACTER_DISPLAY_NAME_PREFIXES,
  TEST_INGESTION_DEDUPE_KEY_PREFIXES,
  TEST_INGESTION_PAYLOAD_NAME_PREFIXES,
  TEST_SCORE_MODEL_KEY_PREFIXES,
  matchIngestionDedupeKey,
  matchIngestionPayloadName,
  matchScoreModelKey,
  matchTestCharacterIdentity,
  matchTestRealmSlug,
} from "../../tools/scripts/lib/test-artifact-registry.mjs";
import {
  assertCleanupTargetAllowed,
  isTestOwnedIngestionJob,
  parseArgs as parseCleanupArgs,
} from "../../tools/scripts/cleanup-test-artifacts.mjs";
import { assertTestDatabaseAllowed, DEV_DATABASE_NAME, ISOLATED_TEST_DB_MARKER } from "../../tools/scripts/lib/test-db-isolation.mjs";

describe("test artifact registry (authoritative markers)", () => {
  it("includes known refresh-job character and payload markers", () => {
    expect(matchTestCharacterIdentity("AdminRefreshab12", "adminrefreshxyz")).toEqual({
      kind: "displayName",
      prefix: "AdminRefresh",
    });
    expect(matchIngestionPayloadName({ name: "FailChar99aa" })).toBe("FailChar");
    expect(matchIngestionPayloadName({ name: "QueuedChar" })).toBe("QueuedChar");
    expect(matchIngestionPayloadName({ name: "ModelChar" })).toBe("ModelChar");
    expect(matchIngestionPayloadName({ name: "NoModelChar" })).toBe("NoModelChar");
    expect(matchIngestionPayloadName({ name: "NormalRefreshOk-abcd1234" })).toBe("NormalRefreshOk-");
    expect(matchIngestionPayloadName({ name: "E2eApiA-deadbeef" })).toBe("E2eApiA-");
    expect(matchIngestionPayloadName({ name: "LegitimatePlayer" })).toBeNull();
  });

  it("includes known ingestion dedupe prefixes and rejects production-like hashes", () => {
    expect(matchIngestionDedupeKey("refresh:old:uuid")).toBe("refresh:old:");
    expect(matchIngestionDedupeKey("refresh:queued:uuid")).toBe("refresh:queued:");
    expect(matchIngestionDedupeKey("discover:uuid")).toBe("discover:");
    // Production dedupe keys are SHA-256 hex — not allowlisted.
    expect(matchIngestionDedupeKey("a".repeat(64))).toBeNull();
  });

  it("matches test realm slug admin-refresh-realm", () => {
    expect(matchTestRealmSlug("admin-refresh-realm")).toBe("admin-refresh-realm");
    expect(matchTestRealmSlug("tarren-mill")).toBeNull();
  });

  it("does not treat status or the word Test alone as ownership", () => {
    expect(matchTestCharacterIdentity("Admin Test Model", "admin test model")).toBeNull();
    expect(matchScoreModelKey("custom-prod-key")).toBeNull();
    expect(TEST_SCORE_MODEL_KEY_PREFIXES.length).toBeGreaterThan(5);
    expect(TEST_CHARACTER_DISPLAY_NAME_PREFIXES).toContain("AdminRefresh");
    expect(TEST_INGESTION_DEDUPE_KEY_PREFIXES).toContain("refresh:old:");
    expect(TEST_INGESTION_PAYLOAD_NAME_PREFIXES).toContain("FailChar");
  });
});

describe("isTestOwnedIngestionJob classification", () => {
  const testCharacterIds = new Set(["char-test-1"]);

  it("detects orphan jobs with null characterId via dedupe evidence", () => {
    const owned = isTestOwnedIngestionJob(
      {
        id: "j1",
        characterId: null,
        dedupeKey: "discover:abc",
        payload: {},
        status: "QUEUED",
        jobType: "discover-owned-characters",
      },
      testCharacterIds,
    );
    expect(owned).toEqual({ owned: true, evidence: "dedupe:discover:" });
  });

  it("detects jobs by payload name", () => {
    const owned = isTestOwnedIngestionJob(
      {
        id: "j2",
        characterId: "unknown",
        dedupeKey: null,
        payload: { name: "FailChardead" },
        status: "FAILED",
        jobType: "refresh-character",
      },
      testCharacterIds,
    );
    expect(owned).toEqual({ owned: true, evidence: "payload:FailChar" });
  });

  it("detects jobs by test-owned character id", () => {
    const owned = isTestOwnedIngestionJob(
      {
        id: "j3",
        characterId: "char-test-1",
        dedupeKey: null,
        payload: { name: "Someone" },
        status: "COMPLETED",
        jobType: "refresh-character",
      },
      testCharacterIds,
    );
    expect(owned).toEqual({ owned: true, evidence: "character:char-test-1" });
  });

  it("does not own a legitimate job without markers", () => {
    const owned = isTestOwnedIngestionJob(
      {
        id: "j4",
        characterId: "real-char",
        dedupeKey: "a".repeat(64),
        payload: { name: "SomeRealPlayer" },
        status: "COMPLETED",
        jobType: "refresh-character",
      },
      testCharacterIds,
    );
    expect(owned).toEqual({ owned: false, evidence: null });
  });
});

describe("refresh-job tests cannot write to development database", () => {
  it("assertTestDatabaseAllowed refuses mplus_trust even with marker", () => {
    expect(() =>
      assertTestDatabaseAllowed(
        `postgresql://u:p@localhost:5433/${DEV_DATABASE_NAME}?schema=public`,
        { NODE_ENV: "test", APP_ENV: "test", [ISOLATED_TEST_DB_MARKER]: "true" },
      ),
    ).toThrow(/TEST DATABASE SAFETY GUARD/);
  });

  it("createTestPrismaClient path requires isolated disposable DB", () => {
    expect(() =>
      assertTestDatabaseAllowed("", {
        NODE_ENV: "test",
        APP_ENV: "test",
        [ISOLATED_TEST_DB_MARKER]: "true",
      }),
    ).toThrow(/DATABASE_URL/);
  });
});

describe("cleanup CLI safety for artifacts", () => {
  it("defaults to dry-run", () => {
    expect(parseCleanupArgs([])).toEqual({ confirm: false, dryRun: true });
  });

  it("refuses production", () => {
    const gate = assertCleanupTargetAllowed(
      "postgresql://mplus:x@localhost:5433/mplus_trust?schema=public",
      { APP_ENV: "production" },
    );
    expect(gate.ok).toBe(false);
  });

  it("refuses remote without deployed-test assertion", () => {
    const gate = assertCleanupTargetAllowed(
      "postgresql://mplus:x@db.example.com:5432/mplus_trust?schema=public",
      { APP_ENV: "test" },
    );
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.message).toMatch(/MPLUS_CLEANUP_TARGET=deployed-test/);
  });
});
