import { describe, expect, it } from "vitest";
import type { SeasonPopulationPolicy } from "@mplus/scoring";
import {
  EXPERIENCE_POPULATION_POLICY_METADATA_KEY,
  hashSeasonPopulationPolicyContent,
  mergeExperiencePopulationPolicyMetadata,
  readExperiencePopulationPolicyMetadata,
  type PersistedExperiencePopulationPolicyMetadata,
} from "./experience-season-population-policy-metadata.js";

function samplePolicy(
  overrides: Partial<SeasonPopulationPolicy> = {},
): SeasonPopulationPolicy {
  return {
    version: "season-population-policy-v1",
    source: "RAIDER_IO_SEASON_CUTOFFS",
    region: "EU",
    seasonSlug: "season-tww-3",
    sourceUpdatedAt: "2026-03-01T00:00:00.000Z",
    quality: "COMPLETE",
    anchors: [
      {
        key: "top_0_1_percent",
        topPercent: 0.1,
        score: 3400,
        quantilePopulationCount: 100,
        totalPopulationCount: 100_000,
      },
      {
        key: "top_1_percent",
        topPercent: 1,
        score: 3000,
        quantilePopulationCount: 1000,
        totalPopulationCount: 100_000,
      },
      {
        key: "top_10_percent",
        topPercent: 10,
        score: 2800,
        quantilePopulationCount: 10_000,
        totalPopulationCount: 100_000,
      },
      {
        key: "top_25_percent",
        topPercent: 25,
        score: 2500,
        quantilePopulationCount: 25_000,
        totalPopulationCount: 100_000,
      },
      {
        key: "top_40_percent",
        topPercent: 40,
        score: 2200,
        quantilePopulationCount: 40_000,
        totalPopulationCount: 100_000,
      },
    ],
    ...overrides,
  };
}

function sampleDocument(
  overrides: Partial<PersistedExperiencePopulationPolicyMetadata> = {},
): PersistedExperiencePopulationPolicyMetadata {
  const policy = overrides.policy ?? samplePolicy();
  const {
    policy: _ignoredPolicy,
    policyContentHash: hashOverride,
    ...rest
  } = overrides;
  return {
    schemaVersion: "experience-population-policy-store-v1",
    raiderIoSeasonSlug: "season-tww-3",
    sourceRequestFingerprint: "fp-cutoffs-1",
    sourcePayloadId: "payload-1",
    sourceFetchedAt: "2026-08-08T00:00:01.000Z",
    synchronizedAt: "2026-08-08T00:00:02.000Z",
    lastKnownGood: true,
    ...rest,
    policy,
    policyContentHash: hashOverride ?? hashSeasonPopulationPolicyContent(policy),
  };
}

describe("readExperiencePopulationPolicyMetadata", () => {
  it("returns typed metadata for a valid stored document", () => {
    const doc = sampleDocument();
    const metadata = { [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: doc };
    const read = readExperiencePopulationPolicyMetadata(metadata);
    expect(read).not.toBeNull();
    expect(read?.policy.quality).toBe("COMPLETE");
    expect(read?.raiderIoSeasonSlug).toBe("season-tww-3");
    expect(read?.lastKnownGood).toBe(true);
    expect(read?.policyContentHash).toBe(hashSeasonPopulationPolicyContent(doc.policy));
  });

  it("returns null for arbitrary legacy metadata without throwing", () => {
    expect(readExperiencePopulationPolicyMetadata(null)).toBeNull();
    expect(readExperiencePopulationPolicyMetadata(undefined)).toBeNull();
    expect(readExperiencePopulationPolicyMetadata({})).toBeNull();
    expect(
      readExperiencePopulationPolicyMetadata({
        activeMplusCatalog: { schemaVersion: "active-mplus-catalog-v1" },
        dungeonSlugs: ["ara-kara"],
      }),
    ).toBeNull();
    expect(
      readExperiencePopulationPolicyMetadata({
        [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: "nope",
      }),
    ).toBeNull();
  });

  it("returns null for wrong schema version", () => {
    const doc = sampleDocument();
    const metadata = {
      [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: {
        ...doc,
        schemaVersion: "experience-population-policy-store-v0",
      },
    };
    expect(readExperiencePopulationPolicyMetadata(metadata)).toBeNull();
  });

  it("returns null for malformed policy", () => {
    const doc = sampleDocument();
    const metadata = {
      [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: {
        ...doc,
        policy: { ...doc.policy, version: "wrong" },
        policyContentHash: "a".repeat(64),
      },
    };
    expect(readExperiencePopulationPolicyMetadata(metadata)).toBeNull();
  });
});

describe("mergeExperiencePopulationPolicyMetadata", () => {
  it("preserves unrelated root keys and overwrites only the dedicated key", () => {
    const existing = {
      activeMplusCatalog: { schemaVersion: "active-mplus-catalog-v1", wclZoneId: 42 },
      dungeonSlugs: ["ara-kara", "priory"],
      wclMplusZoneId: 42,
      authoritySource: "blizzard",
      authorityVerifiedAt: "2026-01-01T00:00:00.000Z",
      someFutureField: { nested: true },
      [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: sampleDocument({
        synchronizedAt: "old",
      }),
    };
    const next = sampleDocument({ synchronizedAt: "2026-08-08T12:00:00.000Z" });
    const merged = mergeExperiencePopulationPolicyMetadata(existing, next);

    expect(merged.activeMplusCatalog).toEqual(existing.activeMplusCatalog);
    expect(merged.dungeonSlugs).toEqual(existing.dungeonSlugs);
    expect(merged.wclMplusZoneId).toBe(42);
    expect(merged.authoritySource).toBe("blizzard");
    expect(merged.authorityVerifiedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(merged.someFutureField).toEqual({ nested: true });
    expect(merged[EXPERIENCE_POPULATION_POLICY_METADATA_KEY]).toEqual(next);
  });
});

describe("hashSeasonPopulationPolicyContent", () => {
  it("is deterministic for identical policy content", () => {
    const a = samplePolicy();
    const b = samplePolicy();
    expect(hashSeasonPopulationPolicyContent(a)).toBe(hashSeasonPopulationPolicyContent(b));
    expect(hashSeasonPopulationPolicyContent(a)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when an anchor score changes", () => {
    const a = samplePolicy();
    const b = samplePolicy({
      anchors: a.anchors.map((anchor) =>
        anchor.key === "top_1_percent" ? { ...anchor, score: 3010 } : anchor,
      ),
    });
    expect(hashSeasonPopulationPolicyContent(a)).not.toBe(hashSeasonPopulationPolicyContent(b));
  });

  it("ignores property insertion order on the hash material object via stable stringify", () => {
    const policy = samplePolicy();
    const h1 = hashSeasonPopulationPolicyContent(policy);
    const shuffledAnchors = [...policy.anchors].reverse();
    // Hash function re-orders anchors; reverse input must not change hash.
    const h2 = hashSeasonPopulationPolicyContent({ ...policy, anchors: shuffledAnchors });
    expect(h1).toBe(h2);
  });

  it("does not depend on sync provenance timestamps", () => {
    const policy = samplePolicy();
    const hash = hashSeasonPopulationPolicyContent(policy);
    const docA = sampleDocument({ policy, synchronizedAt: "a", sourcePayloadId: "1" });
    const docB = sampleDocument({ policy, synchronizedAt: "b", sourcePayloadId: "2" });
    expect(docA.policyContentHash).toBe(hash);
    expect(docB.policyContentHash).toBe(hash);
  });
});
