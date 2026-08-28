import type { CatalogRefreshSourceKind, ExternalSourceSnapshotIdentity } from "./types.js";
import { isAcceptableSimcSourceRevision } from "./extract/simc-revision.js";

const FORBIDDEN_SOLE_IDENTITY = new Set([
  "latest",
  "main",
  "master",
  "head",
  "midnight",
  "tip",
  "trunk",
]);

const GIT_SHA = /^[0-9a-f]{40}$/i;

export function isForbiddenMutableIdentity(value: string): boolean {
  return FORBIDDEN_SOLE_IDENTITY.has(value.trim().toLowerCase());
}

export function isSimcCommitSha(value: string): boolean {
  return GIT_SHA.test(value.trim());
}

export function assertSnapshotIdentity(
  identity: ExternalSourceSnapshotIdentity,
): string[] {
  const errors: string[] = [];
  if (!identity.sourceVersion?.trim()) {
    errors.push("sourceVersion is required");
  } else if (isForbiddenMutableIdentity(identity.sourceVersion)) {
    errors.push(`sourceVersion must not be a mutable label (${identity.sourceVersion})`);
  }
  if (!identity.sourceRevision?.trim()) {
    errors.push("sourceRevision is required");
  } else if (isForbiddenMutableIdentity(identity.sourceRevision)) {
    errors.push(`sourceRevision must not be a mutable label (${identity.sourceRevision})`);
  }
  if (
    identity.source === "SIMULATIONCRAFT" &&
    !isAcceptableSimcSourceRevision(identity.sourceRevision)
  ) {
    errors.push(
      "SIMULATIONCRAFT sourceRevision must be a git commit SHA (40 hex) or an honest binary-reported prefix (7-39 hex)",
    );
  }
  if (!identity.retrievedAt?.trim()) {
    errors.push("retrievedAt is required");
  }
  if (identity.datasetKind !== "FIXTURE" && identity.datasetKind !== "PINNED") {
    errors.push("datasetKind must be FIXTURE or PINNED");
  }
  return errors;
}

export function snapshotIdentityKey(identity: ExternalSourceSnapshotIdentity): string {
  return `${identity.source}:${identity.sourceVersion}:${identity.sourceRevision}`;
}

export function sourceKindLabel(kind: CatalogRefreshSourceKind): string {
  return kind;
}
