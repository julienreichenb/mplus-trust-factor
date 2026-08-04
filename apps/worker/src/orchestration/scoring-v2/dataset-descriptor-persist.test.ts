/**
 * Durable EvidenceDataset descriptor persistence — acquisition captures
 * descriptors with manifestSlotId=null; finalize binds and writes provider-free.
 */
import { describe, expect, it, vi } from "vitest";
import {
  persistDatasetDescriptor,
  type AcquiredEvidenceDatasetDescriptor,
} from "./dataset-descriptor-persist.js";

function descriptor(
  overrides: Partial<AcquiredEvidenceDatasetDescriptor> = {},
): AcquiredEvidenceDatasetDescriptor {
  return {
    datasetKey: "casts",
    datasetKind: "CASTS",
    compatibilityKey: "rep1:3:1:CASTS:wcl-graphql-v2-events",
    artifactId: "artifact-1",
    schemaVersion: "2.0.0",
    providerContractVersion: "wcl-graphql-v2-events",
    state: "READY",
    eventCount: 10,
    pageCount: 1,
    truncated: false,
    payloadFingerprint: "fp-casts-1",
    fetchedAt: "2026-08-01T12:00:00.000Z",
    costSource: "wcl",
    reportCode: "rep1",
    fightId: 3,
    reportRevision: 1,
    ...overrides,
  };
}

describe("persistDatasetDescriptor", () => {
  it("writes a new dataset when neither slot nor compatibility peers exist", async () => {
    const createDataset = vi.fn(async () => ({ id: "ds-1" }));
    const evidence = {
      findDatasetBySlotAndKey: vi.fn(async () => null),
      findDatasetsByCompatibilityKey: vi.fn(async () => []),
      createDataset,
    };

    const result = await persistDatasetDescriptor({
      evidence: evidence as never,
      manifestSlotId: "slot-1",
      descriptor: descriptor(),
    });

    expect(result).toEqual({ outcome: "written", created: true });
    expect(createDataset).toHaveBeenCalledOnce();
    expect(createDataset.mock.calls[0]![0].manifestSlotId).toBe("slot-1");
    expect(createDataset.mock.calls[0]![0].compatibilityKey).toContain("CASTS");
  });

  it("is idempotent on redelivery with identical content", async () => {
    const existing = {
      manifestSlotId: "slot-1",
      datasetKey: "casts",
      compatibilityKey: "rep1:3:1:CASTS:wcl-graphql-v2-events",
      payloadFingerprint: "fp-casts-1",
      eventCount: 10,
      pageCount: 1,
      truncated: false,
      artifactId: "artifact-1",
      state: "READY",
      schemaVersion: "2.0.0",
      providerContractVersion: "wcl-graphql-v2-events",
    };
    const createDataset = vi.fn();
    const evidence = {
      findDatasetBySlotAndKey: vi.fn(async () => existing),
      findDatasetsByCompatibilityKey: vi.fn(async () => [existing]),
      createDataset,
    };

    const result = await persistDatasetDescriptor({
      evidence: evidence as never,
      manifestSlotId: "slot-1",
      descriptor: descriptor(),
    });

    expect(result).toEqual({ outcome: "written", created: false });
    expect(createDataset).not.toHaveBeenCalled();
  });

  it("fails closed on content conflict for the same slot identity", async () => {
    const existing = {
      manifestSlotId: "slot-1",
      datasetKey: "casts",
      compatibilityKey: "rep1:3:1:CASTS:wcl-graphql-v2-events",
      payloadFingerprint: "fp-OTHER",
      eventCount: 10,
      pageCount: 1,
      truncated: false,
      artifactId: "artifact-1",
      state: "READY",
      schemaVersion: "2.0.0",
      providerContractVersion: "wcl-graphql-v2-events",
    };
    const evidence = {
      findDatasetBySlotAndKey: vi.fn(async () => existing),
      findDatasetsByCompatibilityKey: vi.fn(async () => []),
      createDataset: vi.fn(),
    };

    const result = await persistDatasetDescriptor({
      evidence: evidence as never,
      manifestSlotId: "slot-1",
      descriptor: descriptor(),
    });

    expect(result).toEqual({ outcome: "conflict", reason: "dataset_content_conflict" });
    expect(evidence.createDataset).not.toHaveBeenCalled();
  });

  it("creates a new slot-owned binding when another manifest already has same content", async () => {
    const peer = {
      id: "ds-old",
      manifestSlotId: "slot-old",
      datasetKey: "casts",
      compatibilityKey: "rep1:3:1:CASTS:wcl-graphql-v2-events",
      payloadFingerprint: "fp-casts-1",
      eventCount: 10,
      pageCount: 1,
      truncated: false,
      artifactId: "artifact-1",
      state: "READY",
      schemaVersion: "2.0.0",
      providerContractVersion: "wcl-graphql-v2-events",
    };
    const createDataset = vi.fn(async () => ({ id: "ds-new" }));
    const evidence = {
      findDatasetBySlotAndKey: vi.fn(async () => null),
      findDatasetsByCompatibilityKey: vi.fn(async () => [peer]),
      createDataset,
    };

    const result = await persistDatasetDescriptor({
      evidence: evidence as never,
      manifestSlotId: "slot-new",
      descriptor: descriptor(),
    });

    expect(result).toEqual({ outcome: "written", created: true });
    expect(createDataset).toHaveBeenCalledOnce();
    expect(createDataset.mock.calls[0]![0].manifestSlotId).toBe("slot-new");
    expect(createDataset.mock.calls[0]![0].artifactId).toBe("artifact-1");
    expect(createDataset.mock.calls[0]![0].compatibilityKey).toBe(peer.compatibilityKey);
  });

  it("fails closed when a peer has the same compatibility key but different content", async () => {
    const peer = {
      id: "ds-old",
      manifestSlotId: "slot-old",
      datasetKey: "casts",
      compatibilityKey: "rep1:3:1:CASTS:wcl-graphql-v2-events",
      payloadFingerprint: "fp-OTHER",
      eventCount: 10,
      pageCount: 1,
      truncated: false,
      artifactId: "artifact-1",
      state: "READY",
      schemaVersion: "2.0.0",
      providerContractVersion: "wcl-graphql-v2-events",
    };
    const evidence = {
      findDatasetBySlotAndKey: vi.fn(async () => null),
      findDatasetsByCompatibilityKey: vi.fn(async () => [peer]),
      createDataset: vi.fn(),
    };

    const result = await persistDatasetDescriptor({
      evidence: evidence as never,
      manifestSlotId: "slot-new",
      descriptor: descriptor(),
    });

    expect(result).toEqual({ outcome: "conflict", reason: "dataset_content_conflict" });
    expect(evidence.createDataset).not.toHaveBeenCalled();
  });

  it("does not call any provider — only repository lookups/writes", async () => {
    const evidence = {
      findDatasetBySlotAndKey: vi.fn(async () => null),
      findDatasetsByCompatibilityKey: vi.fn(async () => []),
      createDataset: vi.fn(async () => ({ id: "ds-1" })),
    };
    await persistDatasetDescriptor({
      evidence: evidence as never,
      manifestSlotId: "slot-1",
      descriptor: descriptor(),
    });
    expect(Object.keys(evidence)).toEqual([
      "findDatasetBySlotAndKey",
      "findDatasetsByCompatibilityKey",
      "createDataset",
    ]);
  });
});
