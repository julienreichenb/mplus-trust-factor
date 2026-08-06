/**
 * Production RunOrchestrationPorts — PostgreSQL artifact store + evidence indexes.
 * Live WCL acquire only when the caller passes an explicit live acquire hook
 * (gated by ALLOW_LIVE_PROVIDER_CALLS upstream). Ranking hydrate is provider-free.
 */
import type { PrismaClient } from "@mplus/database";
import {
  CapabilityEvidencePackageRepository,
  ParticipantScoringDigestRepository,
  type ArtifactRepository,
  type EvidenceRepository,
} from "@mplus/database";
import {
  assertCapabilityEvidencePackageV1,
  assertParticipantScoringDigestV1,
  type CapabilityEvidencePackageV1,
} from "@mplus/contracts";
import type { RankingParseEvidenceV2 } from "@mplus/provider-warcraftlogs";
import {
  createInMemorySourceFightLock,
  sourceFightKey,
  type AcquireCapabilityPackageResult,
  type CompatiblePackageHit,
  type OrchestrationParticipant,
  type PersistedDigestRecord,
  type RunOrchestrationPorts,
  type SourceFightIdentity,
} from "./orchestrator.js";
import {
  rankingParseCompatibilityKey,
  rankingParseFactFromPersistedEvidence,
} from "./ranking-hydrate.js";
import { persistParticipantDigestWithRowOwner } from "./persist-digest-artifact.js";
export interface ProductionRunOrchestrationPortsDeps {
  prisma: PrismaClient;
  artifacts: ArtifactRepository;
  evidence: EvidenceRepository;
  /**
   * Optional live acquire. Must only be provided when ALLOW_LIVE_PROVIDER_CALLS
   * is true. Tests leave this undefined so acquire cannot reach WCL.
   */
  liveAcquireCapabilityPackage?: (input: {
    sourceFight: SourceFightIdentity;
    dungeonSlug: string | null;
    keyLevel: number | null;
    participants: OrchestrationParticipant[];
  }) => Promise<AcquireCapabilityPackageResult>;
  /**
   * Optional participant resolver (e.g. from WclRunParticipant / masterData).
   * Defaults to package.friendlyPlayerActorIds when a package exists.
   */
  resolveParticipants?: (input: {
    sourceFight: SourceFightIdentity;
  }) => Promise<OrchestrationParticipant[]>;
  resolveFightRoster?: RunOrchestrationPorts["resolveFightRoster"];
  /** Optional Redis-backed lock; defaults to in-process singleflight. */
  withSourceFightLock?: RunOrchestrationPorts["withSourceFightLock"];
}

function asRankingEvidence(payload: unknown): RankingParseEvidenceV2 | null {
  if (payload == null || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  if (typeof row.reportCode !== "string" || typeof row.fightId !== "number") {
    return null;
  }
  return {
    reportCode: row.reportCode,
    fightId: row.fightId,
    reportRevision:
      typeof row.reportRevision === "number" ? row.reportRevision : 0,
    dungeonSlug: typeof row.dungeonSlug === "string" ? row.dungeonSlug : "unknown",
    keyLevel: typeof row.keyLevel === "number" ? row.keyLevel : 0,
    bracketPercent:
      typeof row.bracketPercent === "number" ? row.bracketPercent : null,
    rankPercent: typeof row.rankPercent === "number" ? row.rankPercent : null,
    amountPercent:
      typeof row.amountPercent === "number" ? row.amountPercent : null,
    amount: typeof row.amount === "number" ? row.amount : null,
    partition: typeof row.partition === "number" ? row.partition : null,
  };
}

export function createProductionRunOrchestrationPorts(
  deps: ProductionRunOrchestrationPortsDeps,
): RunOrchestrationPorts {
  const packages = new CapabilityEvidencePackageRepository(
    deps.prisma,
    deps.artifacts,
  );
  const digests = new ParticipantScoringDigestRepository(
    deps.prisma,
    deps.artifacts,
  );
  const lock =
    deps.withSourceFightLock ?? createInMemorySourceFightLock();

  return {
    withSourceFightLock: lock,

    async findCompatibleCapabilityPackage({ sourceFight }) {
      const hit = await packages.findCompleteBySourceFight(sourceFight);
      if (!hit) return null;
      if (hit.package.complete !== true) return null;
      return {
        package: hit.package,
        packageArtifactId: hit.packageArtifactId,
        contentHash: hit.contentHash,
        providerCalls: 0,
      } satisfies CompatiblePackageHit;
    },

    async acquireAndPersistCapabilityPackage(input) {
      if (!deps.liveAcquireCapabilityPackage) {
        throw Object.assign(
          new Error(
            "live_capability_acquire_forbidden: no live acquire hook wired",
          ),
          { code: "LIVE_ACQUIRE_FORBIDDEN" },
        );
      }
      const acquired = await deps.liveAcquireCapabilityPackage(input);
      const pkg = assertCapabilityEvidencePackageV1(acquired.package);
      if (pkg.complete !== true) {
        throw Object.assign(
          new Error(`incomplete_capability_package:${sourceFightKey(input.sourceFight)}`),
          { code: "INCOMPLETE_CAPABILITY_PACKAGE" },
        );
      }

      // Index may already exist from the live hook; upsert is idempotent.
      await packages.upsertIndex({
        package: pkg,
        packageArtifactId: acquired.packageArtifactId,
        contentHash: acquired.contentHash,
      });

      return {
        package: pkg,
        packageArtifactId: acquired.packageArtifactId,
        contentHash: acquired.contentHash,
        providerCalls: acquired.providerCalls,
        created: acquired.created,
      };
    },

    async findCompatibleDigest(input) {
      const found = await digests.findCompatible(input);
      if (!found) return null;
      return {
        digest: found.digest,
        artifactId: found.artifactId,
        created: false,
      } satisfies PersistedDigestRecord;
    },

    async persistDigest(digest) {
      const validated = assertParticipantScoringDigestV1(digest);
      const persisted = await persistParticipantDigestWithRowOwner({
        artifacts: deps.artifacts,
        digests,
        digest: validated,
      });
      return {
        digest: validated,
        artifactId: persisted.artifactId,
        created: persisted.created,
      };
    },

    async resolveParticipantsForFight({ sourceFight }) {
      if (deps.resolveParticipants) {
        return deps.resolveParticipants({ sourceFight });
      }
      const hit = await packages.findCompleteBySourceFight(sourceFight);
      if (!hit) {
        return [];
      }
      return hit.package.friendlyPlayerActorIds.map((id, index) => ({
        playerActorId: id,
        characterName: `Actor${id}`,
        classSlug: null,
        specSlug: null,
        role: null,
        ownedPetActorIds: [],
        characterId: null,
        // Prefer first actor as a placeholder; callers should inject resolveParticipants.
        ...(index === 0 ? {} : {}),
      }));
    },

    resolveFightRoster: deps.resolveFightRoster,

    async resolveRankingParseForParticipant({ sourceFight }) {
      const compatibilityKey = rankingParseCompatibilityKey(sourceFight);
      const dataset =
        await deps.evidence.findDatasetByCompatibilityKey(compatibilityKey);
      if (!dataset || dataset.state !== "READY" || !dataset.artifactId) {
        return null;
      }
      const bytes = await deps.artifacts.readVerified(dataset.artifactId);
      const evidence = asRankingEvidence(JSON.parse(bytes.toString("utf8")));
      if (!evidence) return null;
      if (
        evidence.reportCode !== sourceFight.reportCode ||
        evidence.fightId !== sourceFight.fightId ||
        evidence.reportRevision !== sourceFight.reportRevision
      ) {
        return null;
      }
      return rankingParseFactFromPersistedEvidence({
        evidence,
        artifactId: dataset.artifactId,
        contentHash: dataset.payloadFingerprint ?? null,
      });
    },
  };
}

/** Persist a capability package to pg:// + index (provider-free write path). */
export async function persistCapabilityPackageToPostgres(input: {
  artifacts: ArtifactRepository;
  packages: CapabilityEvidencePackageRepository;
  package: CapabilityEvidencePackageV1;
}): Promise<CompatiblePackageHit> {
  const pkg = assertCapabilityEvidencePackageV1(input.package);
  const bytes = Buffer.from(JSON.stringify(pkg), "utf8");
  // Persist without owner first — ownerId must be CapabilityEvidencePackageRecord.id.
  const write = await input.artifacts.persist({
    provider: "WARCRAFT_LOGS",
    bytes,
    compression: "GZIP",
    artifactClass: "canonical_capability_evidence_v1",
  });
  const indexed = await input.packages.upsertIndex({
    package: pkg,
    packageArtifactId: write.artifactId,
    contentHash: pkg.contentHash,
  });
  await input.artifacts.ensureOwnerReference({
    artifactId: write.artifactId,
    ownerType: "CapabilityEvidencePackage",
    ownerId: indexed.id,
    artifactClass: "canonical_capability_evidence_v1",
  });
  return {
    package: pkg,
    packageArtifactId: write.artifactId,
    contentHash: pkg.contentHash,
    providerCalls: 0,
  };
}
