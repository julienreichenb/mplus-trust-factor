/**
 * Bounded durable dataset descriptors captured during acquisition and
 * persisted to EvidenceDataset after manifest freeze (provider-free).
 *
 * Persistence contract:
 * - Acquisition always captures descriptors when shared event datasets are loaded,
 *   even when manifestSlotIdForPersistence is null (production path).
 * - Descriptors reference already-persisted RawArtifact ids and page fingerprints;
 *   they never synthesize raw pages or fake dataset content.
 * - Finalization binds descriptors to EvidenceManifestSlot by
 *   reportCode + fightId + reportRevision, then creates EvidenceDataset rows.
 * - compatibilityKey is a logical identity shared across refreshes/manifests.
 *   Each frozen slot keeps its own auditable EvidenceDataset row
 *   (unique on manifestSlotId + datasetKey). Same compatibilityKey + same
 *   immutable content → create/reuse a slot-owned binding that references the
 *   same artifact; different content → fail closed.
 * - EvidenceDatasetPage rows are scoring-neutral and durable by report identity
 *   (reportCode+fightId+reportRevision+datasetKey+scope). datasetId is optional.
 *   Finalization may attach datasetId only to pages that are still unlinked; pages
 *   already linked to an older descriptor remain discoverable by report identity.
 *   Never fabricates pages.
 */

import type { EvidenceDatasetKind } from "@mplus/contracts";
import type { EvidenceRepository } from "@mplus/database";
import { toSharedEvidenceDatasetKey } from "./dataset-requirements.js";

export interface AcquiredEvidenceDatasetDescriptor {
  datasetKey: string;
  datasetKind: EvidenceDatasetKind;
  compatibilityKey: string;
  artifactId: string | null;
  schemaVersion: string;
  providerContractVersion: string;
  state: string;
  eventCount: number;
  pageCount: number;
  truncated: boolean;
  payloadFingerprint: string | null;
  fetchedAt: string;
  costSource: string | null;
  /** Binding identity for post-freeze slot match. */
  reportCode: string;
  fightId: number;
  reportRevision: number;
}

export type PersistDatasetDescriptorResult =
  | { outcome: "written"; created: boolean }
  | { outcome: "conflict"; reason: string };

function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error != null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

function descriptorContentFingerprint(d: AcquiredEvidenceDatasetDescriptor): string {
  return [
    d.compatibilityKey,
    d.payloadFingerprint ?? "",
    String(d.eventCount),
    String(d.pageCount),
    d.truncated ? "1" : "0",
    d.artifactId ?? "",
    d.state,
    d.schemaVersion,
    d.providerContractVersion,
  ].join("|");
}

function existingContentFingerprint(row: {
  compatibilityKey: string;
  payloadFingerprint: string | null;
  eventCount: number;
  pageCount: number;
  truncated: boolean;
  artifactId: string | null;
  state: string;
  schemaVersion: string;
  providerContractVersion: string;
}): string {
  return [
    row.compatibilityKey,
    row.payloadFingerprint ?? "",
    String(row.eventCount),
    String(row.pageCount),
    row.truncated ? "1" : "0",
    row.artifactId ?? "",
    row.state,
    row.schemaVersion,
    row.providerContractVersion,
  ].join("|");
}

/**
 * Idempotent EvidenceDataset write for a frozen manifest slot.
 *
 * - Same slot + same content → reuse (redelivery).
 * - Same slot + different content → fail closed.
 * - Same compatibilityKey on another slot + same content → create a new
 *   slot-owned auditable binding that references the same immutable artifact.
 * - Same compatibilityKey + different content → fail closed.
 */
export async function persistDatasetDescriptor(input: {
  evidence: EvidenceRepository;
  manifestSlotId: string;
  descriptor: AcquiredEvidenceDatasetDescriptor;
}): Promise<PersistDatasetDescriptorResult> {
  const { descriptor } = input;
  const expected = descriptorContentFingerprint(descriptor);

  const existingBySlot = await input.evidence.findDatasetBySlotAndKey({
    manifestSlotId: input.manifestSlotId,
    datasetKey: descriptor.datasetKey,
  });
  if (existingBySlot) {
    if (existingContentFingerprint(existingBySlot) === expected) {
      return { outcome: "written", created: false };
    }
    return { outcome: "conflict", reason: "dataset_content_conflict" };
  }

  const peers = await input.evidence.findDatasetsByCompatibilityKey(
    descriptor.compatibilityKey,
  );
  for (const peer of peers) {
    if (existingContentFingerprint(peer) !== expected) {
      return { outcome: "conflict", reason: "dataset_content_conflict" };
    }
  }

  // Prefer the peer's artifact when present so we do not invent a second byte store.
  const artifactId =
    descriptor.artifactId ??
    peers.find((p) => p.artifactId != null)?.artifactId ??
    null;

  try {
    await input.evidence.createDataset({
      manifestSlotId: input.manifestSlotId,
      datasetKey: descriptor.datasetKey,
      compatibilityKey: descriptor.compatibilityKey,
      artifactId,
      schemaVersion: descriptor.schemaVersion,
      providerContractVersion: descriptor.providerContractVersion,
      state: descriptor.state,
      eventCount: descriptor.eventCount,
      pageCount: descriptor.pageCount,
      truncated: descriptor.truncated,
      payloadFingerprint: descriptor.payloadFingerprint,
      fetchedAt: new Date(descriptor.fetchedAt),
      costSource: descriptor.costSource,
    });
    return { outcome: "written", created: true };
  } catch (error) {
    if (!isPrismaUniqueViolation(error)) throw error;
    // Race on (manifestSlotId, datasetKey) — re-read and compare.
    const raced = await input.evidence.findDatasetBySlotAndKey({
      manifestSlotId: input.manifestSlotId,
      datasetKey: descriptor.datasetKey,
    });
    if (!raced) throw error;
    if (existingContentFingerprint(raced) !== expected) {
      return { outcome: "conflict", reason: "dataset_content_conflict_race" };
    }
    return { outcome: "written", created: false };
  }
}

/** Shared-evidence page key for optional datasetId attachment (never fabricates pages). */
export function sharedPageDatasetKeyForKind(kind: EvidenceDatasetKind): string | null {
  return toSharedEvidenceDatasetKey(kind);
}

/**
 * Attach existing durable pages to a newly created EvidenceDataset when
 * datasetId is still null. Pages already linked to an older descriptor stay
 * linked; they remain discoverable by report/fight/revision/datasetKey.
 * Provider-free; no page fabrication.
 */
export async function linkExistingPagesToDataset(input: {
  wclSource: {
    findEvidenceDatasetPages: (args: {
      reportCode: string;
      fightId: number;
      reportRevision: number;
      datasetKey: string;
    }) => Promise<Array<{ id: string; datasetId: string | null }>>;
    attachDatasetIdToPages?: (args: {
      pageIds: string[];
      datasetId: string;
    }) => Promise<number>;
  };
  datasetId: string;
  descriptor: AcquiredEvidenceDatasetDescriptor;
}): Promise<number> {
  const pageKey = sharedPageDatasetKeyForKind(input.descriptor.datasetKind);
  if (!pageKey || !input.wclSource.attachDatasetIdToPages) return 0;

  const pages = await input.wclSource.findEvidenceDatasetPages({
    reportCode: input.descriptor.reportCode,
    fightId: input.descriptor.fightId,
    reportRevision: input.descriptor.reportRevision,
    datasetKey: pageKey,
  });
  const unlinked = pages.filter((p) => p.datasetId == null).map((p) => p.id);
  if (unlinked.length === 0) return 0;
  return input.wclSource.attachDatasetIdToPages({
    pageIds: unlinked,
    datasetId: input.datasetId,
  });
}
