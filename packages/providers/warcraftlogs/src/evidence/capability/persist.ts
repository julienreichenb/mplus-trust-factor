/**
 * Persist / reload capability evidence packages with zero-provider reuse.
 */
import type { CapabilityEvidencePackageV1, EvidenceCapability } from "@mplus/contracts";
import {
  assertCapabilityEvidencePackageV1,
  buildCapabilityPackageCompatibilityKey,
  isCapabilityCoverageComplete,
} from "@mplus/contracts";

export interface CapabilityEvidenceArtifactStore {
  persist(input: {
    provider: "WARCRAFT_LOGS";
    bytes: Uint8Array | Buffer;
    compression?: "NONE" | "GZIP" | "ZSTD";
    artifactClass: string;
  }): Promise<{ artifactId: string; write: { contentHash: string; storageUri: string } }>;
  readVerified(artifactId: string): Promise<Buffer>;
}

export interface PersistedCapabilityEvidenceSet {
  compatibilityKey: string;
  package: CapabilityEvidencePackageV1;
  packageArtifactId: string;
  /** Participant actor IDs that reference this shared package. */
  participantActorIds: number[];
  providerCallsDuringPersist: number;
}

const PACKAGE_INDEX = new Map<string, PersistedCapabilityEvidenceSet>();

export function clearCapabilityEvidenceMemoryIndex(): void {
  PACKAGE_INDEX.clear();
}

export function findPersistedCapabilityEvidence(
  compatibilityKey: string,
): PersistedCapabilityEvidenceSet | null {
  return PACKAGE_INDEX.get(compatibilityKey) ?? null;
}

export async function persistCapabilityEvidencePackage(input: {
  artifacts: CapabilityEvidenceArtifactStore;
  package: CapabilityEvidencePackageV1;
}): Promise<PersistedCapabilityEvidenceSet> {
  const pkg = assertCapabilityEvidencePackageV1(input.package);
  const bytes = Buffer.from(JSON.stringify(pkg), "utf8");
  const write = await input.artifacts.persist({
    provider: "WARCRAFT_LOGS",
    bytes,
    compression: "GZIP",
    artifactClass: "canonical_capability_evidence_v1",
  });

  const persisted: PersistedCapabilityEvidenceSet = {
    compatibilityKey: pkg.compatibilityKey,
    package: {
      ...pkg,
      sourceArtifactIds: [...new Set([...pkg.sourceArtifactIds, write.artifactId])],
    },
    packageArtifactId: write.artifactId,
    participantActorIds: [...pkg.friendlyPlayerActorIds],
    providerCallsDuringPersist: 0,
  };
  PACKAGE_INDEX.set(pkg.compatibilityKey, persisted);
  return persisted;
}

export async function reloadCapabilityEvidenceFromArtifacts(input: {
  artifacts: CapabilityEvidenceArtifactStore;
  persisted: PersistedCapabilityEvidenceSet;
}): Promise<{
  package: CapabilityEvidencePackageV1;
  providerCallsDuringReload: number;
}> {
  const bytes = await input.artifacts.readVerified(input.persisted.packageArtifactId);
  const pkg = assertCapabilityEvidencePackageV1(JSON.parse(bytes.toString("utf8")));
  return {
    package: pkg,
    providerCallsDuringReload: 0,
  };
}

/**
 * Later participant (or same run) lookup: providerCalls = 0 when identity matches
 * and persisted evidence is readable and complete for the requested capability.
 */
export function lookupCapabilityEvidenceForParticipant(input: {
  reportCode: string;
  fightId: number;
  reportRevision: number;
  playerActorId: number;
  capabilitySet: readonly EvidenceCapability[];
  actorSetHash: string;
  abilityFilterHash: string;
  catalogVersion: string;
  mode?: CapabilityEvidencePackageV1["mode"];
  requiredCapability?: EvidenceCapability;
}): {
  package: CapabilityEvidencePackageV1;
  providerCalls: number;
} | null {
  const compatibilityKey = buildCapabilityPackageCompatibilityKey({
    reportCode: input.reportCode,
    fightId: input.fightId,
    reportRevision: input.reportRevision,
    capabilitySet: input.capabilitySet,
    actorSetHash: input.actorSetHash,
    abilityFilterHash: input.abilityFilterHash,
    catalogVersion: input.catalogVersion,
    mode: input.mode ?? "PRODUCTION_CAPABILITY_ACQUISITION",
  });
  const persisted = findPersistedCapabilityEvidence(compatibilityKey);
  if (!persisted) return null;
  if (!persisted.participantActorIds.includes(input.playerActorId)) return null;

  if (input.requiredCapability) {
    const coverage = persisted.package.coverage.find(
      (c) => c.capability === input.requiredCapability,
    );
    if (!coverage || !isCapabilityCoverageComplete(coverage)) return null;
  }

  return {
    package: persisted.package,
    providerCalls: 0,
  };
}
