/**
 * Durable CapabilityEvidencePackageV1 index + verified pg:// reload.
 */
import type { PrismaClient } from "@prisma/client";
import {
  assertCapabilityEvidencePackageV1,
  type CapabilityEvidencePackageV1,
} from "@mplus/contracts";
import {
  ArtifactLegacyExternalPayloadMissingError,
  type ArtifactRepository,
} from "./artifact-repository.js";
import { isCasStorageUri } from "../stores/postgres-artifact-store.js";

export interface UpsertCapabilityEvidencePackageInput {
  package: CapabilityEvidencePackageV1;
  packageArtifactId: string;
  contentHash: string;
  /**
   * When set, the named prior compatibility key is excluded from compatible
   * lookup. The prior row is never mutated.
   */
  supersedesCompatibilityKey?: string | null;
}

export type PackageSupersessionFailureCode =
  | "PACKAGE_SUPERSESSION_NO_HEAD"
  | "PACKAGE_SUPERSESSION_MULTIPLE_HEADS"
  | "PACKAGE_SUPERSESSION_CYCLE"
  | "PACKAGE_SELF_SUPERSESSION"
  | "PACKAGE_SUPERSESSION_SOURCE_MISMATCH";

export class PackageSupersessionGraphError extends Error {
  readonly code: PackageSupersessionFailureCode;
  readonly details: Record<string, unknown>;

  constructor(code: PackageSupersessionFailureCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "PackageSupersessionGraphError";
    this.code = code;
    this.details = details;
  }
}

export type CompatiblePackageRowInput = {
  id?: string;
  compatibilityKey: string;
  supersedesCompatibilityKey: string | null;
  updatedAt: Date;
  createdAt?: Date;
  reportCode?: string;
  fightId?: number;
  reportRevision?: number;
};

export interface CanonicalPackageHeadSelection<T extends CompatiblePackageRowInput> {
  head: T;
  supersededKeys: string[];
  /** True when a corrupt self-supersession edge was interpreted as superseding the sole peer. */
  repairedSelfSupersession: boolean;
}

/**
 * Resolve the unique unsuperseded COMPLETE package head for one source fight.
 *
 * Rules:
 * - Exclude any row whose compatibilityKey is targeted by a valid successor edge.
 * - Self-supersession with exactly one peer is interpreted as superseding that peer
 *   (recovers the observed canary corruption shape); otherwise fail closed.
 * - Fail closed on zero heads, multiple heads, cycles, or cross-fight edges.
 */
export function selectCanonicalCompatiblePackageHead<T extends CompatiblePackageRowInput>(
  rows: readonly T[],
): CanonicalPackageHeadSelection<T> {
  if (rows.length === 0) {
    throw new PackageSupersessionGraphError(
      "PACKAGE_SUPERSESSION_NO_HEAD",
      "no_complete_capability_package_rows",
    );
  }

  const source = {
    reportCode: rows[0]!.reportCode,
    fightId: rows[0]!.fightId,
    reportRevision: rows[0]!.reportRevision,
  };
  for (const row of rows) {
    if (
      (row.reportCode != null && source.reportCode != null && row.reportCode !== source.reportCode) ||
      (row.fightId != null && source.fightId != null && row.fightId !== source.fightId) ||
      (row.reportRevision != null &&
        source.reportRevision != null &&
        row.reportRevision !== source.reportRevision)
    ) {
      throw new PackageSupersessionGraphError(
        "PACKAGE_SUPERSESSION_SOURCE_MISMATCH",
        "capability_package_supersession_source_mismatch",
        {
          expected: source,
          actual: {
            reportCode: row.reportCode,
            fightId: row.fightId,
            reportRevision: row.reportRevision,
            compatibilityKey: row.compatibilityKey,
          },
        },
      );
    }
  }

  const byKey = new Map<string, T>();
  for (const row of rows) {
    byKey.set(row.compatibilityKey, row);
  }

  /** key -> set of keys it supersedes (outgoing edges). */
  const supersedes = new Map<string, Set<string>>();
  let repairedSelfSupersession = false;

  for (const row of rows) {
    const target = row.supersedesCompatibilityKey;
    if (target == null || target.length === 0) continue;

    if (target === row.compatibilityKey) {
      const peers = rows.filter((r) => r.compatibilityKey !== row.compatibilityKey);
      if (peers.length !== 1) {
        throw new PackageSupersessionGraphError(
          "PACKAGE_SELF_SUPERSESSION",
          "capability_package_self_supersession",
          {
            compatibilityKey: row.compatibilityKey,
            peerCount: peers.length,
          },
        );
      }
      const peerKey = peers[0]!.compatibilityKey;
      const set = supersedes.get(row.compatibilityKey) ?? new Set<string>();
      set.add(peerKey);
      supersedes.set(row.compatibilityKey, set);
      repairedSelfSupersession = true;
      continue;
    }

    // Successor must not claim a different source fight via a foreign key that
    // exists in this candidate set with mismatched identity (already checked).
    // Edges that point outside the candidate set still exclude that key if it
    // appears later; for head selection we only exclude keys present in `rows`.
    const set = supersedes.get(row.compatibilityKey) ?? new Set<string>();
    set.add(target);
    supersedes.set(row.compatibilityKey, set);
  }

  // Cycle detection on the supersession digraph (keys in this fight only).
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string, stack: string[]): void => {
    if (visited.has(key)) return;
    if (visiting.has(key)) {
      throw new PackageSupersessionGraphError(
        "PACKAGE_SUPERSESSION_CYCLE",
        "capability_package_supersession_cycle",
        { cycle: [...stack, key] },
      );
    }
    visiting.add(key);
    for (const next of supersedes.get(key) ?? []) {
      if (byKey.has(next)) visit(next, [...stack, key]);
    }
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of byKey.keys()) {
    visit(key, []);
  }

  const supersededKeys = new Set<string>();
  for (const targets of supersedes.values()) {
    for (const target of targets) {
      if (byKey.has(target)) supersededKeys.add(target);
    }
  }

  const heads = rows
    .filter((r) => !supersededKeys.has(r.compatibilityKey))
    .slice()
    .sort((a, b) => {
      const byUpdated = b.updatedAt.getTime() - a.updatedAt.getTime();
      if (byUpdated !== 0) return byUpdated;
      const aCreated = a.createdAt?.getTime() ?? a.updatedAt.getTime();
      const bCreated = b.createdAt?.getTime() ?? b.updatedAt.getTime();
      return bCreated - aCreated;
    });

  if (heads.length === 0) {
    throw new PackageSupersessionGraphError(
      "PACKAGE_SUPERSESSION_NO_HEAD",
      "capability_package_supersession_no_head",
      { rowCount: rows.length, supersededKeys: [...supersededKeys] },
    );
  }
  if (heads.length > 1) {
    throw new PackageSupersessionGraphError(
      "PACKAGE_SUPERSESSION_MULTIPLE_HEADS",
      "capability_package_supersession_multiple_heads",
      {
        heads: heads.map((h) => ({
          id: h.id ?? null,
          compatibilityKey: h.compatibilityKey,
          supersedesCompatibilityKey: h.supersedesCompatibilityKey,
        })),
      },
    );
  }

  return {
    head: heads[0]!,
    supersededKeys: [...supersededKeys],
    repairedSelfSupersession,
  };
}

/**
 * @deprecated Prefer selectCanonicalCompatiblePackageHead. Kept for callers that
 * only need the head row or null when the graph is empty.
 */
export function selectCurrentCompatiblePackageRow<
  T extends CompatiblePackageRowInput,
>(rows: readonly T[]): T | null {
  if (rows.length === 0) return null;
  return selectCanonicalCompatiblePackageHead(rows).head;
}

/**
 * Never persist a self-supersession edge. When the requested prior key equals
 * the package's own key, resolve to the sole other complete package for the
 * same source fight when possible.
 */
export function resolveSupersedesCompatibilityKey(input: {
  packageCompatibilityKey: string;
  requestedSupersedesCompatibilityKey: string | null | undefined;
  peerCompatibilityKeys: readonly string[];
}): string | null {
  const requested = input.requestedSupersedesCompatibilityKey ?? null;
  if (requested == null || requested.length === 0) return null;
  if (requested !== input.packageCompatibilityKey) return requested;

  const peers = input.peerCompatibilityKeys.filter(
    (k) => k !== input.packageCompatibilityKey,
  );
  if (peers.length === 1) return peers[0]!;
  return null;
}

export class CapabilityEvidencePackageRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly artifacts: ArtifactRepository,
  ) {}

  private async loadVerifiedRow(row: {
    id: string;
    artifactId: string;
    contentHash: string;
    complete: boolean;
    artifact: { storageUri: string };
  }): Promise<{
    recordId: string;
    package: CapabilityEvidencePackageV1;
    packageArtifactId: string;
    contentHash: string;
    complete: boolean;
  } | null> {
    if (isCasStorageUri(row.artifact.storageUri)) {
      throw new ArtifactLegacyExternalPayloadMissingError(
        row.artifactId,
        row.artifact.storageUri,
      );
    }

    const bytes = await this.artifacts.readVerified(row.artifactId);
    const pkg = assertCapabilityEvidencePackageV1(
      JSON.parse(bytes.toString("utf8")),
    );
    if (pkg.contentHash !== row.contentHash) {
      throw new Error(
        `capability_package_content_hash_mismatch:index=${row.contentHash} payload=${pkg.contentHash}`,
      );
    }
    return {
      recordId: row.id,
      package: pkg,
      packageArtifactId: row.artifactId,
      contentHash: row.contentHash,
      complete: row.complete && pkg.complete,
    };
  }

  async findByCompatibilityKey(
    compatibilityKey: string,
  ): Promise<{
    recordId: string;
    package: CapabilityEvidencePackageV1;
    packageArtifactId: string;
    contentHash: string;
    complete: boolean;
  } | null> {
    const row = await this.prisma.capabilityEvidencePackageRecord.findUnique({
      where: { compatibilityKey },
      include: { artifact: true },
    });
    if (!row) return null;
    return this.loadVerifiedRow(row);
  }

  /**
   * Compatible package for a source fight: must be marked complete and be the
   * unique unsuperseded head of the supersession graph for that fight.
   * Incomplete packages are never treated as reusable cache hits.
   */
  async findCompleteBySourceFight(input: {
    reportCode: string;
    fightId: number;
    reportRevision: number;
  }): Promise<{
    recordId: string;
    package: CapabilityEvidencePackageV1;
    packageArtifactId: string;
    contentHash: string;
  } | null> {
    const rows = await this.prisma.capabilityEvidencePackageRecord.findMany({
      where: {
        reportCode: input.reportCode,
        fightId: input.fightId,
        reportRevision: input.reportRevision,
        complete: true,
      },
      orderBy: { updatedAt: "desc" },
      include: { artifact: true },
    });
    if (rows.length === 0) return null;
    const { head: selected } = selectCanonicalCompatiblePackageHead(rows);
    const loaded = await this.loadVerifiedRow(selected);
    if (!loaded || !loaded.complete) return null;
    return {
      recordId: loaded.recordId,
      package: loaded.package,
      packageArtifactId: loaded.packageArtifactId,
      contentHash: loaded.contentHash,
    };
  }

  async upsertIndex(
    input: UpsertCapabilityEvidencePackageInput,
  ): Promise<{ id: string; created: boolean }> {
    const pkg = assertCapabilityEvidencePackageV1(input.package);

    const peers = await this.prisma.capabilityEvidencePackageRecord.findMany({
      where: {
        reportCode: pkg.sourceKey.reportCode,
        fightId: pkg.sourceKey.fightId,
        reportRevision: pkg.sourceKey.reportRevision,
        complete: true,
      },
      select: { compatibilityKey: true },
    });
    const supersedesCompatibilityKey =
      input.supersedesCompatibilityKey === undefined
        ? undefined
        : resolveSupersedesCompatibilityKey({
            packageCompatibilityKey: pkg.compatibilityKey,
            requestedSupersedesCompatibilityKey: input.supersedesCompatibilityKey,
            peerCompatibilityKeys: peers.map((p) => p.compatibilityKey),
          });

    const existing = await this.prisma.capabilityEvidencePackageRecord.findUnique({
      where: { compatibilityKey: pkg.compatibilityKey },
      select: { id: true, contentHash: true },
    });
    if (existing) {
      if (
        existing.contentHash !== input.contentHash ||
        input.supersedesCompatibilityKey !== undefined
      ) {
        await this.prisma.capabilityEvidencePackageRecord.update({
          where: { id: existing.id },
          data: {
            contentHash: input.contentHash,
            artifactId: input.packageArtifactId,
            participantActorIds: pkg.friendlyPlayerActorIds,
            complete: pkg.complete,
            actorSetHash: pkg.actorSetHash,
            abilityFilterHash: pkg.abilityFilterHash,
            catalogVersion: pkg.catalogVersion,
            ...(input.supersedesCompatibilityKey !== undefined
              ? { supersedesCompatibilityKey: supersedesCompatibilityKey ?? null }
              : {}),
          },
        });
      }
      return { id: existing.id, created: false };
    }

    const created = await this.prisma.capabilityEvidencePackageRecord.create({
      data: {
        compatibilityKey: pkg.compatibilityKey,
        reportCode: pkg.sourceKey.reportCode,
        fightId: pkg.sourceKey.fightId,
        reportRevision: pkg.sourceKey.reportRevision,
        actorSetHash: pkg.actorSetHash,
        abilityFilterHash: pkg.abilityFilterHash,
        catalogVersion: pkg.catalogVersion,
        acquisitionPlanVersion: pkg.acquisitionPlanVersion,
        graphqlQueryVersion: pkg.graphqlQueryVersion,
        mode: pkg.mode,
        contentHash: input.contentHash,
        artifactId: input.packageArtifactId,
        participantActorIds: pkg.friendlyPlayerActorIds,
        complete: pkg.complete,
        supersedesCompatibilityKey: supersedesCompatibilityKey ?? null,
      },
    });
    return { id: created.id, created: true };
  }
}
