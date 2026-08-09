/**
 * WclRunRaw payload envelope parse / compatibility.
 */
import { describe, expect, it } from "vitest";
import {
  buildCapabilityPackageCompatibilityKey,
  CAPABILITY_ACQUISITION_PLAN_VERSION,
  CAPABILITY_EVIDENCE_PACKAGE_SCHEMA_VERSION,
  WCL_GRAPHQL_QUERY_VERSION,
  WCL_RUN_RAW_PAYLOAD_SCHEMA_VERSION,
  buildWclRunRawPayloadV1,
  hashCapabilityEvidencePayload,
  parseWclRunRawPayload,
  type CapabilityEvidencePackageV1,
  type EvidenceCapability,
} from "./index.js";

const CAPABILITIES: EvidenceCapability[] = [
  "PERFORMANCE_OFFENSIVE_ACTIVATIONS",
  "PARTICIPANT_METADATA",
  "ACTOR_OWNERSHIP",
];

function minimalPackage(): CapabilityEvidencePackageV1 {
  const sourceKey = { reportCode: "AbCd", fightId: 1, reportRevision: 1 };
  const actorSetHash = "actors0123456789";
  const abilityFilterHash = "abilities0123456";
  const catalogVersion = "catalog-test-v1";
  const compatibilityKey = buildCapabilityPackageCompatibilityKey({
    ...sourceKey,
    capabilitySet: CAPABILITIES,
    actorSetHash,
    abilityFilterHash,
    catalogVersion,
    mode: "PRODUCTION_CAPABILITY_ACQUISITION",
  });
  const withoutHash = {
    schemaVersion: CAPABILITY_EVIDENCE_PACKAGE_SCHEMA_VERSION,
    mode: "PRODUCTION_CAPABILITY_ACQUISITION" as const,
    sourceKey,
    compatibilityIdentity: {
      ...sourceKey,
      dataset: "PACKAGE",
      capabilitySet: [...CAPABILITIES].sort() as EvidenceCapability[],
      actorSetHash,
      abilityFilterHash,
      catalogVersion,
      packageSchemaVersion: CAPABILITY_EVIDENCE_PACKAGE_SCHEMA_VERSION,
      acquisitionPlanVersion: CAPABILITY_ACQUISITION_PLAN_VERSION,
      graphqlQueryVersion: WCL_GRAPHQL_QUERY_VERSION,
      mode: "PRODUCTION_CAPABILITY_ACQUISITION" as const,
    },
    compatibilityKey,
    acquisitionPlanVersion: CAPABILITY_ACQUISITION_PLAN_VERSION,
    catalogVersion,
    graphqlQueryVersion: WCL_GRAPHQL_QUERY_VERSION,
    friendlyPlayerActorIds: [1],
    ownedPetActorIds: [],
    actorSetHash,
    abilityFilterHash,
    capabilitySet: [...CAPABILITIES].sort() as EvidenceCapability[],
    coverage: CAPABILITIES.map((capability) => ({
      capability,
      requiredDatasets: ["Buffs"],
      filterIdentity: "test",
      pageCount: 1,
      eventCount: 1,
      firstTimestampMs: 0,
      lastTimestampMs: 1,
      nextPageTimestamp: null,
      stopReason: "NEXT_PAGE_NULL" as const,
      complete: true,
      limitations: [] as string[],
      sourceArtifactIds: [] as string[],
    })),
    compactEvents: [],
    participantLoadouts: [],
    unknownAbilitySummaries: [],
    retention: {
      rawPages: "EPHEMERAL_RAW_PAGE" as const,
      packageClass: "CANONICAL_CAPABILITY_EVIDENCE" as const,
      diagnosticClass: "PINNED_DIAGNOSTIC" as const,
    },
    accounting: {
      graphqlRequestCount: 0,
      pagesFetched: 0,
      eventsBeforeRelevanceFilter: 0,
      eventsAfterRelevanceFilter: 0,
      filterBatchCount: 0,
      providerCalls: 0,
    },
    verifiedFilters: [],
    sourceArtifactIds: [],
    complete: true,
    limitations: [] as string[],
  };
  return {
    ...withoutHash,
    contentHash: hashCapabilityEvidencePayload(withoutHash),
  };
}

describe("parseWclRunRawPayload", () => {
  it("parses envelope v1 with embedded roster source", () => {
    const pkg = minimalPackage();
    const envelope = buildWclRunRawPayloadV1({
      capabilityPackage: pkg,
      masterData: { actors: [{ id: 1, name: "A", type: "Player" }] },
      regionCode: "EU",
    });
    expect(envelope.schemaVersion).toBe(WCL_RUN_RAW_PAYLOAD_SCHEMA_VERSION);
    const parsed = parseWclRunRawPayload(envelope);
    expect(parsed.hasEmbeddedRosterSource).toBe(true);
    expect(parsed.package.contentHash).toBe(pkg.contentHash);
    expect(parsed.regionCode).toBe("EU");
  });

  it("distinguishes legacy bare CapabilityEvidencePackageV1 (no roster source)", () => {
    const pkg = minimalPackage();
    const parsed = parseWclRunRawPayload(pkg);
    expect(parsed.hasEmbeddedRosterSource).toBe(false);
    expect(parsed.masterData).toBeNull();
    expect(parsed.package.friendlyPlayerActorIds).toEqual([1]);
  });

  it("rejects unsupported wcl-run-raw-payload versions with structured code", () => {
    expect(() =>
      parseWclRunRawPayload({
        schemaVersion: "wcl-run-raw-payload-v9",
        capabilityPackage: minimalPackage(),
        masterData: { actors: [] },
      }),
    ).toThrow(/unsupported_version/);
    try {
      parseWclRunRawPayload({
        schemaVersion: "wcl-run-raw-payload-v9",
        capabilityPackage: minimalPackage(),
        masterData: { actors: [] },
      });
    } catch (err) {
      expect((err as { code?: string }).code).toBe(
        "RAW_PACKAGE_SCHEMA_INCOMPATIBLE",
      );
    }
  });

  it("rejects unknown schemaVersion values", () => {
    try {
      parseWclRunRawPayload({
        schemaVersion: "totally-unknown-v1",
        foo: 1,
      });
      expect.unreachable();
    } catch (err) {
      expect((err as { code?: string }).code).toBe(
        "RAW_PACKAGE_SCHEMA_INCOMPATIBLE",
      );
    }
  });
});
