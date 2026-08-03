/**
 * Persist scoring-neutral WclRunSourceDigest + five-player roster after source acquisition.
 */
import { createHash } from "node:crypto";
import {
  WCL_RUN_SOURCE_DIGEST_SCHEMA_VERSION,
  type WclRunDigestParticipant,
  type WclRunSourceDigestDocument,
} from "@mplus/contracts";
import type { WclSourceRepository } from "@mplus/database";
import {
  WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
  WCL_RUN_EVIDENCE_SCHEMA_VERSION,
  type WclRunEvidenceBundle,
} from "@mplus/provider-warcraftlogs";

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Extract player participants from masterData actors (Provider-neutral). */
export function participantsFromMasterData(
  masterData: unknown,
  regionCode: string,
): WclRunDigestParticipant[] {
  const root = asRecord(masterData);
  const actors = Array.isArray(root?.actors) ? root!.actors : [];
  const out: WclRunDigestParticipant[] = [];
  for (const raw of actors) {
    const actor = asRecord(raw);
    if (!actor) continue;
    const type = typeof actor.type === "string" ? actor.type : "";
    if (type !== "Player") continue;
    const id = typeof actor.id === "number" ? actor.id : null;
    const name = typeof actor.name === "string" ? actor.name.trim() : "";
    if (id == null || !name) continue;
    const server =
      typeof actor.server === "string" && actor.server.trim()
        ? slugify(actor.server)
        : "unknown";
    const classSlug =
      typeof actor.subType === "string"
        ? slugify(actor.subType)
        : typeof actor.className === "string"
          ? slugify(actor.className)
          : null;
    const ownedPetActorIds = Array.isArray(actor.petOwner)
      ? []
      : actors
          .map((p) => asRecord(p))
          .filter(
            (p) =>
              p &&
              (p.type === "Pet" || p.type === "Guardian") &&
              typeof p.petOwner === "number" &&
              p.petOwner === id &&
              typeof p.id === "number",
          )
          .map((p) => (p as { id: number }).id);

    out.push({
      wclActorId: id,
      wclCanonicalId:
        typeof actor.guid === "number"
          ? String(actor.guid)
          : typeof actor.canonicalId === "string"
            ? actor.canonicalId
            : null,
      characterName: name,
      realmSlug: server,
      regionCode: regionCode.toUpperCase(),
      classSlug,
      specSlug: null,
      role: null,
      ownedPetActorIds,
    });
  }
  return out.slice(0, 16);
}

export function buildNeutralDigestFromBundle(input: {
  bundle: WclRunEvidenceBundle;
  region: string;
  dungeonSlug: string | null;
  keyLevel: number | null;
  timed: boolean | null;
  visibilityState?: string;
  startTimeMs?: number | null;
  endTimeMs?: number | null;
}): { digest: WclRunSourceDigestDocument; contentFingerprint: string } {
  const participants = participantsFromMasterData(
    input.bundle.masterData,
    input.region,
  );
  const datasets = Object.entries(input.bundle.eventDatasets).flatMap(([key, ds]) => {
    if (!ds) return [];
    return [
      {
        datasetKey: key,
        schemaVersion: WCL_RUN_EVIDENCE_SCHEMA_VERSION,
        providerContractVersion: WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
        pageCount: ds.pageCount,
        eventCount: ds.eventCount,
        truncated: ds.truncated,
        payloadFingerprint: ds.pages[0]?.payloadFingerprint ?? null,
        pageContentHashes: ds.pages.map((p) => p.payloadFingerprint).filter(Boolean) as string[],
      },
    ];
  });

  const completenessState =
    input.bundle.completeness.missing.length === 0 &&
    input.bundle.completeness.truncated.length === 0
      ? "COMPLETE"
      : input.bundle.completeness.truncated.length > 0
        ? "TRUNCATED"
        : "PARTIAL";

  const digest: WclRunSourceDigestDocument = {
    schemaVersion: WCL_RUN_SOURCE_DIGEST_SCHEMA_VERSION,
    providerContractVersion: WCL_RUN_EVIDENCE_PROVIDER_CONTRACT,
    reportCode: input.bundle.reportCode,
    fightId: input.bundle.fightId,
    reportRevision: input.bundle.reportRevision ?? 0,
    region: input.region.toUpperCase(),
    dungeonSlug: input.dungeonSlug,
    keyLevel: input.keyLevel,
    timed: input.timed,
    startTimeMs: input.startTimeMs ?? null,
    endTimeMs: input.endTimeMs ?? null,
    visibilityState: input.visibilityState ?? "PUBLIC",
    completenessState,
    acquiredAt: new Date().toISOString(),
    participants,
    datasets,
  };

  const contentFingerprint = sha256Hex(
    JSON.stringify({
      reportCode: digest.reportCode,
      fightId: digest.fightId,
      reportRevision: digest.reportRevision,
      datasets: digest.datasets,
      participants: digest.participants.map((p) => ({
        wclActorId: p.wclActorId,
        characterName: p.characterName,
        realmSlug: p.realmSlug,
        regionCode: p.regionCode,
      })),
    }),
  );

  return { digest, contentFingerprint };
}

export async function persistWclRunDigestAndRoster(input: {
  wclSource: WclSourceRepository;
  bundle: WclRunEvidenceBundle;
  region: string;
  dungeonSlug: string | null;
  keyLevel: number | null;
  timed: boolean | null;
  /** When set, map matching participant by name+realm+region → Character.id. */
  resolveTarget?: {
    characterId: string;
    characterName: string;
    realmSlug: string;
    regionCode: string;
  } | null;
  startTimeMs?: number | null;
  endTimeMs?: number | null;
}): Promise<{ digestId: string; created: boolean; participantCount: number }> {
  if (input.bundle.reportRevision == null) {
    throw new Error("wcl_run_digest_requires_report_revision");
  }

  const { digest, contentFingerprint } = buildNeutralDigestFromBundle({
    bundle: input.bundle,
    region: input.region,
    dungeonSlug: input.dungeonSlug,
    keyLevel: input.keyLevel,
    timed: input.timed,
    startTimeMs: input.startTimeMs,
    endTimeMs: input.endTimeMs,
  });

  const digestBytes = Buffer.byteLength(JSON.stringify(digest), "utf8");
  const { row, created } = await input.wclSource.upsertWclRunSourceDigest({
    reportCode: digest.reportCode,
    fightId: digest.fightId,
    reportRevision: digest.reportRevision,
    schemaVersion: digest.schemaVersion,
    providerContractVersion: digest.providerContractVersion,
    contentFingerprint,
    digest,
    digestBytes,
    completenessState: digest.completenessState,
    visibilityState: digest.visibilityState,
    region: digest.region,
    dungeonSlug: digest.dungeonSlug,
    keyLevel: digest.keyLevel,
    timed: digest.timed,
    acquiredAt: new Date(digest.acquiredAt),
  });

  const target = input.resolveTarget;
  let participantCount = 0;
  for (const p of digest.participants) {
    const matched =
      target != null &&
      p.characterName.toLowerCase() === target.characterName.toLowerCase() &&
      p.realmSlug.toLowerCase() === target.realmSlug.toLowerCase() &&
      p.regionCode.toUpperCase() === target.regionCode.toUpperCase();
    await input.wclSource.upsertWclRunParticipant({
      digestId: row.id,
      wclActorId: p.wclActorId,
      wclCanonicalId: p.wclCanonicalId,
      characterName: p.characterName,
      realmSlug: p.realmSlug,
      regionCode: p.regionCode,
      classSlug: p.classSlug,
      specSlug: p.specSlug,
      role: p.role,
      ownedPetActorIds: p.ownedPetActorIds,
      characterId: matched ? target!.characterId : null,
      mappingState: matched ? "RESOLVED" : "UNRESOLVED",
      mappingConfidence: matched ? 0.8 : null,
    });
    participantCount += 1;
  }

  return { digestId: row.id, created, participantCount };
}
