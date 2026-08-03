import { describe, expect, it } from "vitest";
import {
  assertNeutralWclRunDigest,
  buildEvidenceDatasetPageIdentityKey,
  WCL_RUN_SOURCE_DIGEST_SCHEMA_VERSION,
} from "./wcl-run-source-digest.js";

const baseDigest = {
  schemaVersion: WCL_RUN_SOURCE_DIGEST_SCHEMA_VERSION,
  providerContractVersion: "wcl-graphql-v2-events",
  reportCode: "AbCdEf12",
  fightId: 3,
  reportRevision: 1,
  region: "EU",
  dungeonSlug: "skyreach",
  keyLevel: 15,
  timed: true,
  visibilityState: "PUBLIC",
  completenessState: "COMPLETE",
  acquiredAt: "2026-08-03T12:00:00.000Z",
  participants: [
    {
      wclActorId: 1,
      wclCanonicalId: null,
      characterName: "Wallidrixe",
      realmSlug: "archimonde",
      regionCode: "EU",
      classSlug: "warlock",
      specSlug: "demonology",
      role: "DPS",
      ownedPetActorIds: [20],
    },
  ],
  datasets: [
    {
      datasetKey: "Casts",
      schemaVersion: "1.0.0",
      providerContractVersion: "wcl-graphql-v2-events",
      pageCount: 1,
      eventCount: 10,
      truncated: false,
      payloadFingerprint: "abc",
      pageContentHashes: ["def"],
    },
  ],
};

describe("wcl-run-source-digest", () => {
  it("accepts a scoring-neutral digest", () => {
    expect(assertNeutralWclRunDigest(baseDigest).reportCode).toBe("AbCdEf12");
  });

  it("rejects digests that embed score fields", () => {
    expect(() =>
      assertNeutralWclRunDigest({
        ...baseDigest,
        score: 99,
      }),
    ).toThrow();
  });

  it("builds stable dataset page identity keys", () => {
    expect(
      buildEvidenceDatasetPageIdentityKey({
        reportCode: "AbCdEf12",
        fightId: 3,
        reportRevision: 1,
        datasetKey: "Casts",
        pageIndex: 0,
        providerContractVersion: "wcl-graphql-v2-events",
        schemaVersion: "1.0.0",
      }),
    ).toBe("AbCdEf12|3|1|Casts|0|wcl-graphql-v2-events|1.0.0");
  });
});
