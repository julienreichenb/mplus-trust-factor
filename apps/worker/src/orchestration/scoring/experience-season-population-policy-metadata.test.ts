import { describe, expect, it } from "vitest";
import type { SeasonPopulationPolicy } from "@mplus/scoring";
import { SEASON_POPULATION_POLICY_VERSION } from "@mplus/scoring";
import {
  EXPERIENCE_POPULATION_POLICY_METADATA_KEY,
  EXPERIENCE_POPULATION_POLICY_STORE_SCHEMA_VERSION,
  EXPERIENCE_POPULATION_POLICY_STORE_SCHEMA_VERSION_V1,
  hashSeasonPopulationPolicyContent,
  hashSeasonPopulationPolicyContentV1,
  mergeExperiencePopulationPolicyMetadata,
  readExperiencePopulationPolicyMetadata,
  type PersistedExperiencePopulationPolicyMetadata,
} from "./experience-season-population-policy-metadata.js";

function samplePolicy(
  overrides: Partial<SeasonPopulationPolicy> = {},
): SeasonPopulationPolicy {
  return {
    version: SEASON_POPULATION_POLICY_VERSION,
    source: "RAIDER_IO_SEASON_CUTOFFS",
    region: "EU",
    seasonSlug: "season-tww-3",
    sourceUpdatedAt: "2026-03-01T00:00:00.000Z",
    quality: "COMPLETE",
    anchors: [
      {
        key: "top_0_1_percent",
        topPercent: 0.1,
        nativeQuantile: "p999",
        score: 3400,
        quantilePopulationCount: 100,
        totalPopulationCount: 100_000,
      },
      {
        key: "top_1_percent",
        topPercent: 1,
        nativeQuantile: "p990",
        score: 3000,
        quantilePopulationCount: 1000,
        totalPopulationCount: 100_000,
      },
      {
        key: "top_10_percent",
        topPercent: 10,
        nativeQuantile: "p900",
        score: 2800,
        quantilePopulationCount: 10_000,
        totalPopulationCount: 100_000,
      },
      {
        key: "top_25_percent",
        topPercent: 25,
        nativeQuantile: "p750",
        score: 2500,
        quantilePopulationCount: 25_000,
        totalPopulationCount: 100_000,
      },
      {
        key: "top_40_percent",
        topPercent: 40,
        nativeQuantile: "p600",
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
    schemaVersion: EXPERIENCE_POPULATION_POLICY_STORE_SCHEMA_VERSION,
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
    expect(read?.policy.version).toBe(SEASON_POPULATION_POLICY_VERSION);
    expect(read?.schemaVersion).toBe(EXPERIENCE_POPULATION_POLICY_STORE_SCHEMA_VERSION);
    expect(read?.raiderIoSeasonSlug).toBe("season-tww-3");
    expect(read?.lastKnownGood).toBe(true);
    expect(read?.policyContentHash).toBe(hashSeasonPopulationPolicyContent(doc.policy));
  });

  it("upgrades store-v1 + policy-v1 without provider calls", () => {
    const v1Policy = {
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
    };
    const metadata = {
      [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: {
        schemaVersion: EXPERIENCE_POPULATION_POLICY_STORE_SCHEMA_VERSION_V1,
        policy: v1Policy,
        raiderIoSeasonSlug: "season-tww-3",
        policyContentHash: hashSeasonPopulationPolicyContentV1(v1Policy),
        sourceRequestFingerprint: "fp-cutoffs-1",
        sourcePayloadId: "payload-1",
        sourceFetchedAt: "2026-08-08T00:00:01.000Z",
        synchronizedAt: "2026-08-08T00:00:02.000Z",
        lastKnownGood: true,
      },
    };
    const read = readExperiencePopulationPolicyMetadata(metadata);
    expect(read).not.toBeNull();
    expect(read?.policy.version).toBe(SEASON_POPULATION_POLICY_VERSION);
    expect(read?.policy.anchors.map((a) => a.nativeQuantile)).toEqual([
      "p999",
      "p990",
      "p900",
      "p750",
      "p600",
    ]);
    expect(read?.schemaVersion).toBe(EXPERIENCE_POPULATION_POLICY_STORE_SCHEMA_VERSION);
  });

  it("returns null for arbitrary legacy metadata without throwing", () => {
    expect(readExperiencePopulationPolicyMetadata(null)).toBeNull();
    expect(readExperiencePopulationPolicyMetadata(undefined)).toBeNull();
    expect(readExperiencePopulationPolicyMetadata({})).toBeNull();
    expect(
      readExperiencePopulationPolicyMetadata({
        [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: { schemaVersion: "experience-population-policy-store-v0" },
      }),
    ).toBeNull();
  });

  it("rejects hash mismatch", () => {
    const doc = sampleDocument({ policyContentHash: "a".repeat(64) });
    expect(
      readExperiencePopulationPolicyMetadata({
        [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: doc,
      }),
    ).toBeNull();
  });

  it("rejects INSUFFICIENT quality LKG documents", () => {
    const policy = samplePolicy({
      quality: "INSUFFICIENT",
      anchors: [
        {
          key: "top_40_percent",
          topPercent: 40,
          nativeQuantile: "p600",
          score: 2200,
          quantilePopulationCount: null,
          totalPopulationCount: null,
        },
      ],
    });
    const doc = sampleDocument({ policy });
    expect(
      readExperiencePopulationPolicyMetadata({
        [EXPERIENCE_POPULATION_POLICY_METADATA_KEY]: doc,
      }),
    ).toBeNull();
  });
});

describe("mergeExperiencePopulationPolicyMetadata", () => {
  it("preserves unrelated root keys", () => {
    const merged = mergeExperiencePopulationPolicyMetadata(
      { other: 1, nested: { a: true } },
      sampleDocument(),
    );
    expect(merged.other).toBe(1);
    expect(merged.nested).toEqual({ a: true });
    expect(merged[EXPERIENCE_POPULATION_POLICY_METADATA_KEY]).toBeTruthy();
  });
});
