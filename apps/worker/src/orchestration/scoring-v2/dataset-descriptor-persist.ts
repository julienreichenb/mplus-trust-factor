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
 * - EvidenceDatasetPage rows are scoring-neutral and durable by report identity;
 *   datasetId is optional. Finalization may attach datasetId to existing pages
 *   that match the same report/fight/revision/shared-key; it never fabricates pages.
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
 * Same logical identity + same content → reuse.
 * Same logical identity + incompatible content → fail closed.
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

  const existingByCompat = await input.evidence.findDatasetByCompatibilityKey(
    descriptor.compatibilityKey,
  );
  if (existingByCompat) {
    if (existingByCompat.manifestSlotId !== input.manifestSlotId) {
      return { outcome: "conflict", reason: "dataset_compatibility_key_slot_mismatch" };
    }
    if (existingContentFingerprint(existingByCompat) === expected) {
      return { outcome: "written", created: false };
    }
    return { outcome: "conflict", reason: "dataset_content_conflict" };
  }

  try {
    await input.evidence.createDataset({
      manifestSlotId: input.manifestSlotId,
      datasetKey: descriptor.datasetKey,
      compatibilityKey: descriptor.compatibilityKey,
      artifactId: descriptor.artifactId,
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
    const raced =
      (await input.evidence.findDatasetBySlotAndKey({
        manifestSlotId: input.manifestSlotId,
        datasetKey: descriptor.datasetKey,
      })) ??
      (await input.evidence.findDatasetByCompatibilityKey(descriptor.compatibilityKey));
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
 * datasetId is still null. Provider-free; no page fabrication.
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
