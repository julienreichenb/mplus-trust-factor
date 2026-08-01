import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateCohortIntake, INTAKE_SCHEMA_VERSION } from "./intake.js";
import {
  validateSeasonMetaPolicy,
  classifyMetaMembership,
  validateAuthoritativeSeasonBinding,
} from "./meta-policy.js";
import {
  resolveIntakeMember,
  resolveRoleFromClassSpec,
  toStrictManifestMember,
  isPetbearIdentity,
  isMyzouthMember,
} from "./resolve-member.js";
import {
  assertProfileOnlyEnrichmentSafety,
  enrichIdentitiesWithBlizzardProfiles,
} from "./blizzard-profile-enrichment.js";

const ROOT = resolve(import.meta.dirname, "../../../../../");
const INTAKE_PATH = resolve(ROOT, "doc/scoring/cohorts/agent11-2026-08-01/intake.v1.json");
const POLICY_PATH = resolve(ROOT, "doc/scoring/meta-policies/midnight-season-1.meta.v1.json");

describe("Agent 11 intake validation", () => {
  it("validates exact expected counts from canonical intake", () => {
    const raw = JSON.parse(readFileSync(INTAKE_PATH, "utf8"));
    const result = validateCohortIntake(raw);
    expect(result.ok, result.errors.join("; ")).toBe(true);
    expect(result.intake?.schemaVersion).toBe(INTAKE_SCHEMA_VERSION);
    expect(result.intake?.summary.memberCount).toBe(41);
    expect(result.intake?.summary.uniqueCharacterIdentityCount).toBe(40);
    expect(result.intake?.summary.tierCounts).toEqual({ S: 8, A: 9, B: 8, C: 8, D: 8 });
  });

  it("does not mutate intake expected labels", () => {
    const raw = JSON.parse(readFileSync(INTAKE_PATH, "utf8"));
    const before = JSON.stringify(raw.members.map((m: { id: string; expectedLabel: string }) => [m.id, m.expectedLabel]));
    const result = validateCohortIntake(raw);
    expect(result.ok).toBe(true);
    const after = JSON.stringify(raw.members.map((m: { id: string; expectedLabel: string }) => [m.id, m.expectedLabel]));
    expect(after).toBe(before);
    expect(result.intake?.members.every((m) => m.classSlug === null && m.specSlug === null)).toBe(true);
  });
});

describe("Agent 11 meta policy", () => {
  it("validates canonical policy including season bindings", () => {
    const raw = JSON.parse(readFileSync(POLICY_PATH, "utf8"));
    const result = validateSeasonMetaPolicy(raw);
    expect(result.ok, result.errors.join("; ")).toBe(true);
    expect(result.policy?.seasonSlug).toBe("midnight-season-1");
    expect(result.policy?.authoritativeSeasonBindings[0]).toEqual({
      provider: "BLIZZARD",
      providerSeasonId: 17,
      catalogSlug: "blizzard-season-17",
    });
  });

  it("classifies exact meta membership and does not coerce unresolved to false", () => {
    const policy = validateSeasonMetaPolicy(JSON.parse(readFileSync(POLICY_PATH, "utf8"))).policy!;
    expect(classifyMetaMembership(policy, "monk", "brewmaster")).toBe(true);
    expect(classifyMetaMembership(policy, "warlock", "demonology")).toBe(false);
    expect(classifyMetaMembership(policy, null, "arms")).toBe("unresolved");
    expect(classifyMetaMembership(policy, "warrior", null)).toBe("unresolved");
  });

  it("fails closed on season mismatch", () => {
    const policy = validateSeasonMetaPolicy(JSON.parse(readFileSync(POLICY_PATH, "utf8"))).policy!;
    const bad = validateAuthoritativeSeasonBinding(policy, {
      id: "x",
      slug: "blizzard-season-13",
      isCurrent: true,
      blizzardSeasonId: 13,
    });
    expect(bad.ok).toBe(false);
    const good = validateAuthoritativeSeasonBinding(policy, {
      id: "y",
      slug: "blizzard-season-17",
      isCurrent: true,
      blizzardSeasonId: 17,
    });
    expect(good.ok).toBe(true);
  });
});

describe("Agent 11 role and exclusions", () => {
  const policy = () => validateSeasonMetaPolicy(JSON.parse(readFileSync(POLICY_PATH, "utf8"))).policy!;

  it("resolves role from class/spec without DPS default", () => {
    expect(resolveRoleFromClassSpec("monk", "brewmaster")).toBe("TANK");
    expect(resolveRoleFromClassSpec("shaman", "restoration")).toBe("HEALER");
    expect(resolveRoleFromClassSpec(null, "arms")).toBe(null);
    expect(resolveRoleFromClassSpec("warrior", null)).toBe(null);
  });

  it("marks Petbear as ROLE_CONTEXT_CONFLICT when contexts are not proven distinct", () => {
    const member = {
      id: "user-c-eu-outland-petbear-tank",
      region: "EU",
      realm: "outland",
      character: "Petbear",
      providedRole: "TANK" as const,
      expectedTier: "C" as const,
      expectedLabel: "weak" as const,
      classSlug: null,
      specSlug: null,
      meta: null,
      rationale: "x",
      suspectedBoost: null,
      source: "user-selected" as const,
      seasonSlug: null,
      snapshotIds: [],
      resolution: { characterId: null, identityStatus: "PENDING", evidenceStatus: "PENDING", notes: [] },
    };
    expect(isPetbearIdentity(member)).toBe(true);
    const { resolved, exclusion } = resolveIntakeMember({
      member,
      policy: policy(),
      persisted: {
        characterId: "char-1",
        blizzardCharacterId: "1",
        role: "TANK",
        classSlug: "druid",
        specSlug: "guardian",
        level: 80,
        faction: "Horde",
        lastPublicRefreshAt: null,
        snapshotIds: ["snap-1"],
        incompleteBootstrap: false,
      },
      blizzard: {
        blizzardCharacterId: "1",
        classSlug: "druid",
        specSlug: "guardian",
        role: "TANK",
        level: 80,
        faction: "Horde",
        displayName: "Petbear",
        realmSlug: "outland",
      },
      nowIso: "2026-08-01T12:00:00.000Z",
      myzouthRecoveryComplete: true,
      petbearRoleContextsProvenDistinct: false,
    });
    expect(exclusion?.reason).toBe("ROLE_CONTEXT_CONFLICT");
    expect(toStrictManifestMember(resolved).ok).toBe(false);
  });

  it("defers Myzouth until recovery is complete", () => {
    const member = {
      id: "user-s-eu-burning-legion-myzouth-dps",
      region: "EU",
      realm: "burning-legion",
      character: "Myzouth",
      providedRole: "DPS" as const,
      expectedTier: "S" as const,
      expectedLabel: "excellent" as const,
      classSlug: null,
      specSlug: null,
      meta: null,
      rationale: "x",
      suspectedBoost: null,
      source: "user-selected" as const,
      seasonSlug: null,
      snapshotIds: [],
      resolution: { characterId: null, identityStatus: "PENDING", evidenceStatus: "PENDING", notes: [] },
    };
    expect(isMyzouthMember(member)).toBe(true);
    const { exclusion } = resolveIntakeMember({
      member,
      policy: policy(),
      persisted: {
        characterId: "4e2e51ee-9e77-44a0-ba82-4d24a68b4486",
        blizzardCharacterId: "99",
        role: "DPS",
        classSlug: "mage",
        specSlug: "fire",
        level: 80,
        faction: null,
        lastPublicRefreshAt: null,
        snapshotIds: [],
        incompleteBootstrap: true,
      },
      blizzard: {
        blizzardCharacterId: "99",
        classSlug: "mage",
        specSlug: "fire",
        role: "DPS",
        level: 80,
        faction: null,
        displayName: "Myzouth",
        realmSlug: "burning-legion",
      },
      nowIso: "2026-08-01T12:00:00.000Z",
      myzouthRecoveryComplete: false,
      petbearRoleContextsProvenDistinct: false,
    });
    expect(exclusion?.reason).toBe("MYZOUTH_BOOTSTRAP_DEFERRED");
    expect(exclusion?.deferred).toBe(true);
  });

  it("excludes Joefreckles/Essetxd-style ROLE_CONTEXT_MISMATCH when active spec disagrees with labelled role", () => {
    const member = {
      id: "user-a-eu-eredar-joefreckles-tank",
      region: "EU",
      realm: "eredar",
      character: "Joefreckles",
      providedRole: "TANK" as const,
      expectedTier: "A" as const,
      expectedLabel: "good" as const,
      classSlug: null,
      specSlug: null,
      meta: null,
      rationale: "x",
      suspectedBoost: null,
      source: "user-selected" as const,
      seasonSlug: null,
      snapshotIds: [],
      resolution: { characterId: null, identityStatus: "PENDING", evidenceStatus: "PENDING", notes: [] },
    };
    const { resolved, exclusion } = resolveIntakeMember({
      member,
      policy: policy(),
      persisted: null,
      blizzard: {
        blizzardCharacterId: "1",
        classSlug: "monk",
        specSlug: "windwalker",
        role: "DPS",
        level: 80,
        faction: null,
        displayName: "Joefreckles",
        realmSlug: "eredar",
      },
      nowIso: "2026-08-01T12:00:00.000Z",
      myzouthRecoveryComplete: true,
      petbearRoleContextsProvenDistinct: false,
      roleContextProvenAtCutoff: false,
    });
    expect(exclusion?.reason).toBe("ROLE_CONTEXT_MISMATCH");
    expect(resolved.resolvedRole).toBe("TANK");
    expect(resolved.roleMismatch).toBe(true);
    expect(toStrictManifestMember(resolved).ok).toBe(false);
  });

  it("preserves expected labels into strict manifest members", () => {
    const member = {
      id: "user-a-eu-archimonde-wallidrixe-dps",
      region: "EU",
      realm: "archimonde",
      character: "Wallidrixe",
      providedRole: "DPS" as const,
      expectedTier: "A" as const,
      expectedLabel: "good" as const,
      classSlug: null,
      specSlug: null,
      meta: null,
      rationale: "user",
      suspectedBoost: null,
      source: "user-selected" as const,
      seasonSlug: null,
      snapshotIds: [],
      resolution: { characterId: null, identityStatus: "PENDING", evidenceStatus: "PENDING", notes: [] },
    };
    const { resolved } = resolveIntakeMember({
      member,
      policy: policy(),
      persisted: {
        characterId: "3691e49d-4b34-4723-a694-15a46d98d37a",
        blizzardCharacterId: "1",
        role: "DPS",
        classSlug: "warlock",
        specSlug: "demonology",
        level: 80,
        faction: "Horde",
        lastPublicRefreshAt: null,
        snapshotIds: ["s1"],
        incompleteBootstrap: false,
      },
      blizzard: {
        blizzardCharacterId: "1",
        classSlug: "warlock",
        specSlug: "demonology",
        role: "DPS",
        level: 80,
        faction: "Horde",
        displayName: "Wallidrixe",
        realmSlug: "archimonde",
      },
      nowIso: "2026-08-01T12:00:00.000Z",
      myzouthRecoveryComplete: true,
      petbearRoleContextsProvenDistinct: true,
    });
    const manifest = toStrictManifestMember(resolved);
    expect(manifest.ok).toBe(true);
    if (manifest.ok) {
      expect(manifest.member.expectedLabel).toBe("good");
      expect(manifest.member.meta).toBe(false);
      expect(manifest.member.suspectedBoost).toBe(false);
    }
    expect(resolved.boostLabelStatus).toBe("NOT_USER_LABELED");
  });
});

describe("Blizzard profile enrichment safety", () => {
  it("refuses refresh/WCL/Raider.IO/activation flags", () => {
    expect(() =>
      assertProfileOnlyEnrichmentSafety({
        allowLiveProviderCalls: true,
        enqueueRefresh: true,
      }),
    ).toThrow(/refresh-character/);
    expect(() =>
      assertProfileOnlyEnrichmentSafety({
        allowLiveProviderCalls: true,
        callWcl: true,
      }),
    ).toThrow(/WCL/);
  });

  it("deduplicates identities in dry-run ledger", async () => {
    const { ledger } = await enrichIdentitiesWithBlizzardProfiles(
      [
        { region: "EU", realmSlug: "outland", name: "Petbear" },
        { region: "EU", realmSlug: "outland", name: "Petbear" },
      ],
      {
        clientId: "x",
        clientSecret: "y",
        dryRun: true,
        delayMs: 0,
      },
    );
    expect(ledger).toHaveLength(2);
    expect(ledger[0]?.result).toBe("dry-run");
    expect(ledger[1]?.result).toBe("skipped-dedup");
    expect(ledger.every((e) => e.dbStateChanged === false)).toBe(true);
    expect(ledger.every((e) => e.endpointClass === "character-profile")).toBe(true);
  });
});

describe("Evidence env guards", () => {
  it("requires CALIBRATION_EVIDENCE_ENV=test", async () => {
    const { assertCalibrationEvidenceEnv, assertNotProductionEvidenceTarget, sanitizeEvidenceDbTarget } =
      await import("./evidence-env-guards.js");
    const prev = process.env.CALIBRATION_EVIDENCE_ENV;
    try {
      delete process.env.CALIBRATION_EVIDENCE_ENV;
      expect(() => assertCalibrationEvidenceEnv()).toThrow(/must be exactly "test"/);
      process.env.CALIBRATION_EVIDENCE_ENV = "prod";
      expect(() => assertCalibrationEvidenceEnv()).toThrow(/must be exactly "test"/);
      process.env.CALIBRATION_EVIDENCE_ENV = "test";
      expect(() => assertCalibrationEvidenceEnv()).not.toThrow();
    } finally {
      if (prev === undefined) delete process.env.CALIBRATION_EVIDENCE_ENV;
      else process.env.CALIBRATION_EVIDENCE_ENV = prev;
    }

    const target = sanitizeEvidenceDbTarget(
      "postgresql://user:secret@postgres:5432/mplus_trust_test?schema=public",
    );
    expect(target).toEqual({ hostname: "postgres", port: "5432", database: "mplus_trust_test" });
    expect(() =>
      assertNotProductionEvidenceTarget(
        "postgresql://u:p@postgres:5432/mplus_trust_prod?schema=public",
      ),
    ).toThrow(/production/);
  });
});

describe("Read-only SQLSTATE probe", () => {
  it("extracts 25006 from Prisma meta and rejects permission-denied-only errors", async () => {
    const {
      extractPostgresSqlStatePreferPg,
      READ_ONLY_PROBE_UPDATE_SQL,
      probeReadOnlySqlTransaction,
    } = await import("./read-only-session.js");

    expect(READ_ONLY_PROBE_UPDATE_SQL).toContain('"regions"');
    expect(READ_ONLY_PROBE_UPDATE_SQL).toMatch(/WHERE FALSE/i);

    expect(
      extractPostgresSqlStatePreferPg({
        code: "P2010",
        meta: { code: "25006", message: "cannot execute UPDATE in a read-only transaction" },
      }),
    ).toBe("25006");

    expect(
      extractPostgresSqlStatePreferPg({
        code: "42501",
        message: "permission denied for table regions",
      }),
    ).toBe("42501");

    const tx = {
      $executeRaw: async () => undefined,
      $queryRaw: async () => [{ transaction_read_only: "on" }],
      $executeRawUnsafe: async () => {
        throw Object.assign(new Error("cannot execute UPDATE in a read-only transaction"), {
          meta: { code: "25006" },
        });
      },
    };
    const prisma = {
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    };

    await expect(probeReadOnlySqlTransaction(prisma as never)).resolves.toEqual({
      transactionReadOnly: "on",
      sqlState: "25006",
    });

    const deniedTx = {
      ...tx,
      $executeRawUnsafe: async () => {
        throw Object.assign(new Error("permission denied for table regions"), {
          code: "42501",
        });
      },
    };
    const deniedPrisma = {
      $transaction: async (fn: (client: typeof deniedTx) => Promise<unknown>) => fn(deniedTx),
    };
    await expect(probeReadOnlySqlTransaction(deniedPrisma as never)).rejects.toThrow(/25006/);
  });

  it("fails closed when SHOW transaction_read_only is not on", async () => {
    const { probeReadOnlySqlTransaction } = await import("./read-only-session.js");
    const tx = {
      $executeRaw: async () => undefined,
      $queryRaw: async () => [{ transaction_read_only: "off" }],
      $executeRawUnsafe: async () => undefined,
    };
    const prisma = {
      $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    };
    await expect(probeReadOnlySqlTransaction(prisma as never)).rejects.toThrow(
      /transaction_read_only must be "on"/,
    );
  });
});
