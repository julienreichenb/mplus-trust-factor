/**
 * Production scoring ports backed by WclRunRaw / CharacterRunDigest / RunRankingFact.
 * No ArtifactReference ownership, no package supersession, no compatibility-head lookup.
 */
import type { PrismaClient, Prisma } from "@mplus/database";
import {
  CAPABILITY_ACQUISITION_PLAN_VERSION,
  PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION,
  assertCapabilityEvidencePackageV1,
  assertParticipantScoringDigestV1,
  type CapabilityEvidencePackageV1,
} from "@mplus/contracts";
import {
  WclRunRawRepository,
  CharacterRunDigestRepository,
  RunRankingFactRepository,
  type ArtifactRepository,
  type EvidenceRepository,
} from "@mplus/database";
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

export const SCORING_ACQUISITION_VERSION = CAPABILITY_ACQUISITION_PLAN_VERSION;
export const SCORING_EXTRACTOR_VERSION = PARTICIPANT_DIGEST_EXTRACTOR_COMPAT_VERSION;
export const SCORING_RANKING_VERSION = "ranking-parse-v1";

export interface ProductionRunOrchestrationPortsDeps {
  prisma: PrismaClient;
  /** Kept for ranking datasets that still live in the evidence store. */
  artifacts: ArtifactRepository;
  evidence: EvidenceRepository;
  acquisitionVersion?: string;
  extractorVersion?: string;
  rankingVersion?: string;
  liveAcquireCapabilityPackage?: (input: {
    sourceFight: SourceFightIdentity;
    dungeonSlug: string | null;
    keyLevel: number | null;
    participants: OrchestrationParticipant[];
  }) => Promise<AcquireCapabilityPackageResult>;
  resolveParticipants?: (input: {
    sourceFight: SourceFightIdentity;
  }) => Promise<OrchestrationParticipant[]>;
  resolveFightRoster?: RunOrchestrationPorts["resolveFightRoster"];
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

function packageFromPayload(payload: unknown): CapabilityEvidencePackageV1 {
  return assertCapabilityEvidencePackageV1(payload);
}

function digestFromRow(row: {
  id: string;
  sourceMetadata: unknown;
  offensive: unknown;
  utility: unknown;
  survival: unknown;
}): PersistedDigestRecord | null {
  const meta = row.sourceMetadata;
  if (meta == null || typeof meta !== "object") return null;
  const digestCandidate = (meta as { digest?: unknown }).digest ?? meta;
  try {
    const digest = assertParticipantScoringDigestV1(digestCandidate);
    return {
      digest,
      artifactId: row.id,
      created: false,
    };
  } catch {
    return null;
  }
}

export function createProductionRunOrchestrationPorts(
  deps: ProductionRunOrchestrationPortsDeps,
): RunOrchestrationPorts {
  const acquisitionVersion =
    deps.acquisitionVersion ?? SCORING_ACQUISITION_VERSION;
  const extractorVersion = deps.extractorVersion ?? SCORING_EXTRACTOR_VERSION;
  const rankingVersion = deps.rankingVersion ?? SCORING_RANKING_VERSION;
  const rawRuns = new WclRunRawRepository(deps.prisma);
  const digests = new CharacterRunDigestRepository(deps.prisma);
  const rankings = new RunRankingFactRepository(deps.prisma);
  const lock = deps.withSourceFightLock ?? createInMemorySourceFightLock();

  async function loadRaw(sourceFight: SourceFightIdentity) {
    return rawRuns.find({
      reportCode: sourceFight.reportCode,
      fightId: sourceFight.fightId,
      reportRevision: sourceFight.reportRevision,
      acquisitionVersion,
    });
  }

  return {
    withSourceFightLock: lock,

    async findCompatibleCapabilityPackage({ sourceFight }) {
      const row = await loadRaw(sourceFight);
      if (!row) return null;
      const pkg = packageFromPayload(row.payload);
      if (pkg.complete !== true) return null;
      return {
        package: pkg,
        packageArtifactId: row.id,
        contentHash: pkg.contentHash,
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
          new Error(
            `incomplete_capability_package:${sourceFightKey(input.sourceFight)}`,
          ),
          { code: "INCOMPLETE_CAPABILITY_PACKAGE" },
        );
      }

      const saved = await rawRuns.save({
        reportCode: input.sourceFight.reportCode,
        fightId: input.sourceFight.fightId,
        reportRevision: input.sourceFight.reportRevision,
        acquisitionVersion,
        payload: pkg as unknown as Prisma.InputJsonValue,
        providerCost: {
          providerCalls: acquired.providerCalls,
          contentHash: pkg.contentHash,
        },
      });

      return {
        package: pkg,
        packageArtifactId: saved.id,
        contentHash: pkg.contentHash,
        providerCalls: acquired.providerCalls,
        created: acquired.created,
      };
    },

    async findCompatibleDigest(input) {
      const row = await loadRaw({
        reportCode: input.reportCode,
        fightId: input.fightId,
        reportRevision: input.reportRevision,
      });
      if (!row) return null;

      const candidate = await digests.find({
        rawRunId: row.id,
        participantActorId: input.participantActorId,
        extractorVersion: input.extractorCompatVersion || extractorVersion,
      });
      if (!candidate) return null;

      const parsed = digestFromRow(candidate);
      if (!parsed) return null;
      if (
        parsed.digest.capabilityPackageContentHash !==
        input.capabilityPackageContentHash
      ) {
        return null;
      }
      return parsed;
    },

    async persistDigest(digest) {
      const validated = assertParticipantScoringDigestV1(digest);

      const raw = await loadRaw({
        reportCode: validated.reportCode,
        fightId: validated.fightId,
        reportRevision: validated.reportRevision,
      });
      if (!raw) {
        throw Object.assign(
          new Error(
            `raw_run_missing_for_digest:${validated.reportCode}:${validated.fightId}:${validated.reportRevision}`,
          ),
          { code: "RAW_RUN_MISSING" },
        );
      }

      const existing = await digests.find({
        rawRunId: raw.id,
        participantActorId: validated.participantActorId,
        extractorVersion,
      });
      const saved = await digests.save({
        rawRunId: raw.id,
        participantActorId: validated.participantActorId,
        extractorVersion,
        characterId: validated.characterId,
        characterName: validated.characterName,
        realmSlug: validated.realmSlug,
        regionCode: validated.regionCode,
        classSlug: validated.classSlug,
        specSlug: validated.specSlug,
        role: validated.role,
        offensive: validated.performance as unknown as Prisma.InputJsonValue,
        utility: validated.utility as unknown as Prisma.InputJsonValue,
        survival: validated.survival as unknown as Prisma.InputJsonValue,
        sourceMetadata: {
          digest: validated,
          participantActorId: validated.participantActorId,
          capabilityPackageContentHash: validated.capabilityPackageContentHash,
          catalogVersion: validated.catalogVersion,
        } as unknown as Prisma.InputJsonValue,
      });

      return {
        digest: validated,
        artifactId: saved.id,
        created: !existing,
      };
    },

    async resolveParticipantsForFight({ sourceFight }) {
      if (deps.resolveParticipants) {
        return deps.resolveParticipants({ sourceFight });
      }
      const row = await loadRaw(sourceFight);
      if (!row) return [];
      const pkg = packageFromPayload(row.payload);
      return pkg.friendlyPlayerActorIds.map((id) => ({
        playerActorId: id,
        characterName: `Actor${id}`,
        classSlug: null,
        specSlug: null,
        role: null,
        ownedPetActorIds: [],
        characterId: null,
      }));
    },

    resolveFightRoster: deps.resolveFightRoster,

    async resolveRankingParseForParticipant({
      sourceFight,
      participantActorId,
    }) {
      const raw = await loadRaw(sourceFight);
      if (raw) {
        // Prefer RunRankingFact rows when character-scoped facts exist.
        const facts = await deps.prisma.runRankingFact.findMany({
          where: { rawRunId: raw.id, rankingVersion },
        });
        for (const fact of facts) {
          const evidence = asRankingEvidence(fact.payload);
          if (!evidence) continue;
          const meta = fact.payload as { participantActorId?: number };
          if (
            typeof meta.participantActorId === "number" &&
            meta.participantActorId !== participantActorId
          ) {
            continue;
          }
          if (
            evidence.reportCode !== sourceFight.reportCode ||
            evidence.fightId !== sourceFight.fightId ||
            evidence.reportRevision !== sourceFight.reportRevision
          ) {
            continue;
          }
          return rankingParseFactFromPersistedEvidence({
            evidence,
            artifactId: fact.id,
            contentHash: null,
          });
        }
      }

      // Legacy evidence-dataset fallback (read-only) while rankings migrate.
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

      if (raw) {
        // Opportunistically cache into RunRankingFact when a characterId is known later.
        void rankings;
      }

      return rankingParseFactFromPersistedEvidence({
        evidence,
        artifactId: dataset.artifactId,
        contentHash: dataset.payloadFingerprint ?? null,
      });
    },
  };
}

/** Persist a capability package into WclRunRaw (provider-free write path). */
export async function persistCapabilityPackageToPostgres(input: {
  prisma: PrismaClient;
  package: CapabilityEvidencePackageV1;
  acquisitionVersion?: string;
}): Promise<CompatiblePackageHit> {
  const pkg = assertCapabilityEvidencePackageV1(input.package);
  const acquisitionVersion =
    input.acquisitionVersion ?? SCORING_ACQUISITION_VERSION;
  const rawRuns = new WclRunRawRepository(input.prisma);
  const saved = await rawRuns.save({
    reportCode: pkg.sourceKey.reportCode,
    fightId: pkg.sourceKey.fightId,
    reportRevision: pkg.sourceKey.reportRevision,
    acquisitionVersion,
    payload: pkg as unknown as Prisma.InputJsonValue,
    providerCost: { contentHash: pkg.contentHash },
  });
  return {
    package: pkg,
    packageArtifactId: saved.id,
    contentHash: pkg.contentHash,
    providerCalls: 0,
  };
}
