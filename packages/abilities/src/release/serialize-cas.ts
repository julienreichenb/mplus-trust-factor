import type { AbilityCatalogReleaseArtifact, AbilityCatalogReleaseContent } from "./types.js";
import { createHash } from "node:crypto";
import {
  buildReleaseContent,
  buildReleaseKey,
  contentDigestOf,
  topologyDigestOf,
} from "./normalize.js";
import { stableStringify } from "./canonicalize.js";

/**
 * CAS / durability decision (Phase 3B.2):
 *
 * Persist ONLY the semantic AbilityCatalogReleaseContent bytes
 * (`stableStringify(content)` UTF-8). `generatedAt` lives in DB metadata only.
 *
 * Therefore:
 * - contentDigest === SHA-256(CAS bytes)
 * - semantically identical compiles reuse the same CAS identity
 * - volatile timestamps cannot fork CAS blobs
 */
export function semanticContentFromArtifact(
  artifact: AbilityCatalogReleaseArtifact,
): AbilityCatalogReleaseContent {
  return buildReleaseContent({
    gameVersion: artifact.gameVersion,
    wowBuild: artifact.wowBuild,
    seasonSlug: artifact.seasonSlug,
    previousReleaseId: artifact.previousReleaseId,
    topology: artifact.topology,
    rules: artifact.rules,
    manifest: artifact.manifest,
  });
}

/** Exact bytes stored in RawArtifactPayload for a release. */
export function serializeSemanticReleaseContentBytes(
  artifact: AbilityCatalogReleaseArtifact,
): Buffer {
  const content = semanticContentFromArtifact(artifact);
  const digest = contentDigestOf(content);
  if (digest !== artifact.contentDigest) {
    throw new Error(
      `Artifact contentDigest ${artifact.contentDigest} does not match semantic content ${digest}`,
    );
  }
  return Buffer.from(stableStringify(content), "utf8");
}

export function casHashOfSemanticBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Reconstruct a full artifact envelope from persisted semantic CAS bytes. */
export function artifactFromSemanticContentBytes(
  bytes: Buffer,
  generatedAt: string,
): AbilityCatalogReleaseArtifact {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (err) {
    throw new Error(
      `Release CAS payload is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Release CAS payload must be a JSON object");
  }
  const raw = parsed as Partial<AbilityCatalogReleaseContent>;
  if (!raw.schemaVersion || !raw.gameVersion || !raw.wowBuild || !raw.seasonSlug) {
    throw new Error("Release CAS payload missing required content fields");
  }
  if (!Array.isArray(raw.rules) || !raw.topology || !raw.manifest) {
    throw new Error("Release CAS payload missing rules/topology/manifest");
  }

  const content = buildReleaseContent({
    gameVersion: raw.gameVersion,
    wowBuild: raw.wowBuild,
    seasonSlug: raw.seasonSlug,
    previousReleaseId: raw.previousReleaseId ?? null,
    topology: raw.topology,
    rules: raw.rules,
    manifest: raw.manifest,
  });
  const contentDigest = contentDigestOf(content);
  const topologyDigest = topologyDigestOf(content.topology);
  const releaseKey = buildReleaseKey(content.wowBuild, contentDigest);

  return {
    schemaVersion: content.schemaVersion,
    releaseKey,
    contentDigest,
    topologyDigest,
    gameVersion: content.gameVersion,
    wowBuild: content.wowBuild,
    seasonSlug: content.seasonSlug,
    previousReleaseId: content.previousReleaseId,
    generatedAt,
    topology: content.topology,
    rules: content.rules,
    manifest: content.manifest,
  };
}
