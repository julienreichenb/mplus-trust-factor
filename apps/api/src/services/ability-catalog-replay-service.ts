/**
 * Ability catalog release replay persistence + orchestration (Phase 3B.3).
 * Shadow / read-only. Never activates or mutates production scores.
 */

import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@mplus/database";
import {
  createStaticAbilityCatalogContext,
  CURRENT_CATALOG_VERSION_ID,
} from "@mplus/abilities";
import {
  createReleaseAbilityCatalogContext,
  type ReleaseDiffDocument,
} from "@mplus/abilities/release";
import { writeAuditEvent } from "../iam/audit.js";
import { HttpError } from "../errors.js";
import { persistInternalBytes } from "./ability-catalog-review-service.js";
import {
  AbilityCatalogReleaseService,
  type AbilityCatalogReleaseAuditContext,
} from "./ability-catalog-release-service.js";
import { selectAbilityCatalogReplayCorpus } from "./ability-catalog-replay-corpus.js";
import { runAbilityCatalogReplayComparison } from "./ability-catalog-replay-engine.js";
import {
  ABILITY_CATALOG_REPLAY_ENGINE_VERSION,
  type AbilityCatalogReplayReport,
} from "./ability-catalog-replay-types.js";

export const ARTIFACT_CLASS_REPLAY_REPORT = "ability_catalog_release_replay_report";
export const OWNER_REPLAY = "ability_catalog_release_replay";

const BOOTSTRAP_RELEASE_ID = "d68793e5-7389-4cd6-b4c2-2eec96bea068";

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function idempotencyKey(input: {
  baseKind: "STATIC" | "RELEASE";
  baseReleaseId: string | null;
  candidateReleaseId: string;
  corpusDigest: string;
  engineVersion: string;
}): string {
  const base =
    input.baseKind === "STATIC"
      ? `static:${CURRENT_CATALOG_VERSION_ID}`
      : `release:${input.baseReleaseId}`;
  return [
    base,
    `candidate:${input.candidateReleaseId}`,
    `corpus:${input.corpusDigest}`,
    `engine:${input.engineVersion}`,
  ].join("|");
}

export type RunReplayInput = {
  candidateReleaseId: string;
  baseReleaseId?: string | null;
  baseKind?: "STATIC" | "RELEASE";
  maxPerSpec?: number;
  maxTotal?: number;
  force?: boolean;
  expectZeroImpact?: boolean;
};

export class AbilityCatalogReplayService {
  private readonly releases: AbilityCatalogReleaseService;

  constructor(private readonly prisma: PrismaClient) {
    this.releases = new AbilityCatalogReleaseService(prisma);
  }

  async listReplaysForCandidate(candidateReleaseId: string) {
    const rows = await this.prisma.abilityCatalogReleaseReplay.findMany({
      where: { candidateReleaseId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return { replays: rows.map(toReplayDto) };
  }

  async getReplay(id: string) {
    const row = await this.prisma.abilityCatalogReleaseReplay.findUnique({ where: { id } });
    if (!row) {
      throw HttpError.notFound("REPLAY_NOT_FOUND", "Ability catalog release replay not found");
    }
    return toReplayDto(row);
  }

  async getReplayReportSummary(id: string) {
    const row = await this.prisma.abilityCatalogReleaseReplay.findUnique({ where: { id } });
    if (!row) {
      throw HttpError.notFound("REPLAY_NOT_FOUND", "Ability catalog release replay not found");
    }
    return {
      replay: toReplayDto(row),
      summary: row.summary,
      publicationNote:
        "Replay evidence is not publication approval. No ACTIVE catalog change occurred.",
    };
  }

  async latestReplayGate(candidateReleaseId: string) {
    const row = await this.prisma.abilityCatalogReleaseReplay.findFirst({
      where: { candidateReleaseId },
      orderBy: { createdAt: "desc" },
    });
    if (!row) {
      return {
        candidateReleaseId,
        latestReplay: null,
        gate: {
          replayPerformed: false,
          pass: false,
          note: "No replay evidence yet. Not a publish authorization.",
        },
      };
    }
    const summary = row.summary as unknown as AbilityCatalogReplayReport["summary"];
    return {
      candidateReleaseId,
      latestReplay: toReplayDto(row),
      gate: {
        replayPerformed: true,
        pass: row.status === "PASSED",
        baseKind: row.baseKind,
        baseReleaseId: row.baseReleaseId,
        corpusCoverage: summary
          ? {
              selected: summary.artifactsSelected,
              changedAnalyses: summary.changedAnalyses,
              unresolvedFailures: summary.unresolvedFailures,
            }
          : null,
        note: "Replay PASS is diagnostic evidence only — not publication approval.",
      },
    };
  }

  async runReplay(
    input: RunReplayInput,
    audit: AbilityCatalogReleaseAuditContext,
  ): Promise<{
    replay: ReturnType<typeof toReplayDto>;
    report: AbilityCatalogReplayReport;
    reused: boolean;
  }> {
    const baseKind = input.baseKind ?? "RELEASE";
    const baseReleaseId =
      baseKind === "STATIC" ? null : (input.baseReleaseId ?? input.candidateReleaseId);
    const expectZeroImpact =
      input.expectZeroImpact ??
      (baseKind === "STATIC" || baseReleaseId === input.candidateReleaseId);

    await writeAuditEvent(this.prisma, {
      userId: audit.userId,
      actorType: audit.actorType,
      action: "admin.ability_catalog.release.replay.requested",
      resourceType: "ability_catalog_release",
      resourceId: input.candidateReleaseId,
      sessionSecret: audit.sessionSecret,
      ip: audit.ip,
      userAgent: audit.userAgent,
      metadata: {
        baseKind,
        baseReleaseId,
        candidateReleaseId: input.candidateReleaseId,
        force: input.force === true,
      },
    });

    const loadStarted = Date.now();
    let baseCatalog = createStaticAbilityCatalogContext();
    let baseMeta: AbilityCatalogReplayReport["base"] = {
      kind: "STATIC",
      releaseId: null,
      releaseKey: null,
      contentDigest: null,
      catalogVersion: CURRENT_CATALOG_VERSION_ID,
    };
    let releaseDiff: ReleaseDiffDocument | null = null;

    try {
      const candidateLoaded = await this.releases.loadReleaseArtifact(input.candidateReleaseId);
      const candidateCatalog = createReleaseAbilityCatalogContext({
        artifact: candidateLoaded.artifact,
        releaseId: candidateLoaded.release.id,
      });
      const candidateMeta = {
        releaseId: candidateLoaded.release.id,
        releaseKey: candidateLoaded.release.releaseKey,
        contentDigest: candidateLoaded.release.contentDigest,
      };
      releaseDiff = candidateLoaded.release.diff as ReleaseDiffDocument;

      if (baseKind === "RELEASE") {
        if (!baseReleaseId) {
          throw HttpError.badRequest("BASE_RELEASE_REQUIRED", "baseReleaseId is required");
        }
        const baseLoaded = await this.releases.loadReleaseArtifact(baseReleaseId);
        baseCatalog = createReleaseAbilityCatalogContext({
          artifact: baseLoaded.artifact,
          releaseId: baseLoaded.release.id,
        });
        baseMeta = {
          kind: "RELEASE",
          releaseId: baseLoaded.release.id,
          releaseKey: baseLoaded.release.releaseKey,
          contentDigest: baseLoaded.release.contentDigest,
        };
      }

      const corpus = await selectAbilityCatalogReplayCorpus({
        prisma: this.prisma,
        maxPerSpec: input.maxPerSpec,
        maxTotal: input.maxTotal,
        catalogForCoverage: baseCatalog,
      });

      const key = idempotencyKey({
        baseKind,
        baseReleaseId,
        candidateReleaseId: input.candidateReleaseId,
        corpusDigest: corpus.corpusDigest,
        engineVersion: ABILITY_CATALOG_REPLAY_ENGINE_VERSION,
      });

      if (!input.force) {
        const existing = await this.prisma.abilityCatalogReleaseReplay.findUnique({
          where: { idempotencyKey: key },
        });
        if (existing && existing.status === "PASSED") {
          const report = await this.loadReportArtifact(existing.reportArtifactId);
          return { replay: toReplayDto(existing), report, reused: true };
        }
      }

      const loadMs = Date.now() - loadStarted;
      const report = runAbilityCatalogReplayComparison({
        baseCatalog,
        candidateCatalog,
        corpus,
        baseMeta,
        candidateMeta,
        releaseDiff: baseKind === "RELEASE" && baseReleaseId !== input.candidateReleaseId
          ? releaseDiff
          : releaseDiff?.kind === "BOOTSTRAP"
            ? releaseDiff
            : releaseDiff,
        expectZeroImpact,
        timing: { loadMs },
      });

      const reportBytes = Buffer.from(JSON.stringify(report), "utf8");
      const reportDigest = sha256Hex(reportBytes);
      const startedAt = new Date(Date.now() - report.timing.totalMs);
      const completedAt = new Date();
      const replayId = randomUUID();

      const row = await this.prisma.$transaction(async (tx) => {
        if (input.force) {
          await tx.abilityCatalogReleaseReplay.deleteMany({ where: { idempotencyKey: key } });
        }
        const cas = await persistInternalBytes(tx, {
          bytes: reportBytes,
          artifactClass: ARTIFACT_CLASS_REPLAY_REPORT,
          ownerType: OWNER_REPLAY,
          ownerId: replayId,
        });
        return tx.abilityCatalogReleaseReplay.create({
          data: {
            id: replayId,
            idempotencyKey: key,
            baseKind,
            baseReleaseId,
            candidateReleaseId: input.candidateReleaseId,
            corpusDigest: report.corpusDigest,
            replayInputDigest: report.replayInputDigest,
            replayEngineVersion: ABILITY_CATALOG_REPLAY_ENGINE_VERSION,
            status: report.status === "PASSED" ? "PASSED" : "FAILED",
            reportArtifactId: cas.artifactId,
            reportDigest,
            summary: report.summary as unknown as Prisma.InputJsonValue,
            timing: report.timing as unknown as Prisma.InputJsonValue,
            errorSummary:
              report.failures.length > 0
                ? report.failures.map((f) => `${f.code}:${f.detail}`).join("; ").slice(0, 4000)
                : null,
            createdByUserId: audit.userId,
            startedAt,
            completedAt,
          },
        });
      });

      await writeAuditEvent(this.prisma, {
        userId: audit.userId,
        actorType: audit.actorType,
        action:
          report.status === "PASSED"
            ? "admin.ability_catalog.release.replay.completed"
            : "admin.ability_catalog.release.replay.failed",
        resourceType: "ability_catalog_release_replay",
        resourceId: row.id,
        sessionSecret: audit.sessionSecret,
        ip: audit.ip,
        userAgent: audit.userAgent,
        outcome: report.status === "PASSED" ? "SUCCESS" : "FAILURE",
        metadata: {
          baseReleaseId,
          candidateReleaseId: input.candidateReleaseId,
          corpusDigest: report.corpusDigest,
          replayId: row.id,
          status: report.status,
          changedAnalyses: report.summary.changedAnalyses,
        },
      });

      return { replay: toReplayDto(row), report, reused: false };
    } catch (err) {
      await writeAuditEvent(this.prisma, {
        userId: audit.userId,
        actorType: audit.actorType,
        action: "admin.ability_catalog.release.replay.failed",
        resourceType: "ability_catalog_release",
        resourceId: input.candidateReleaseId,
        sessionSecret: audit.sessionSecret,
        ip: audit.ip,
        userAgent: audit.userAgent,
        outcome: "FAILURE",
        metadata: {
          baseReleaseId,
          candidateReleaseId: input.candidateReleaseId,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      throw err;
    }
  }

  /** Acceptance helpers for CLI. */
  async runSelfBootstrap(opts: {
    maxPerSpec?: number;
    maxTotal?: number;
    force?: boolean;
    bootstrapReleaseId?: string;
  }, audit: AbilityCatalogReleaseAuditContext) {
    const id = opts.bootstrapReleaseId ?? BOOTSTRAP_RELEASE_ID;
    return this.runReplay(
      {
        candidateReleaseId: id,
        baseReleaseId: id,
        baseKind: "RELEASE",
        maxPerSpec: opts.maxPerSpec,
        maxTotal: opts.maxTotal,
        force: opts.force,
        expectZeroImpact: true,
      },
      audit,
    );
  }

  async runStaticVsBootstrap(opts: {
    maxPerSpec?: number;
    maxTotal?: number;
    force?: boolean;
    bootstrapReleaseId?: string;
  }, audit: AbilityCatalogReleaseAuditContext) {
    const id = opts.bootstrapReleaseId ?? BOOTSTRAP_RELEASE_ID;
    return this.runReplay(
      {
        candidateReleaseId: id,
        baseKind: "STATIC",
        maxPerSpec: opts.maxPerSpec,
        maxTotal: opts.maxTotal,
        force: opts.force,
        expectZeroImpact: true,
      },
      audit,
    );
  }

  private async loadReportArtifact(artifactId: string | null): Promise<AbilityCatalogReplayReport> {
    if (!artifactId) {
      throw HttpError.conflict("REPLAY_REPORT_MISSING", "Replay report artifact missing");
    }
    const art = await this.prisma.rawArtifact.findUnique({ where: { id: artifactId } });
    if (!art) {
      throw HttpError.conflict("REPLAY_REPORT_MISSING", "Replay report artifact missing");
    }
    const payload = await this.prisma.rawArtifactPayload.findUnique({
      where: { contentHash: art.contentHash },
    });
    if (!payload) {
      throw HttpError.conflict("REPLAY_REPORT_CAS_MISSING", "Replay report CAS missing");
    }
    return JSON.parse(Buffer.from(payload.payload).toString("utf8")) as AbilityCatalogReplayReport;
  }
}

function toReplayDto(row: {
  id: string;
  idempotencyKey: string;
  baseKind: string;
  baseReleaseId: string | null;
  candidateReleaseId: string;
  corpusDigest: string;
  replayInputDigest: string;
  replayEngineVersion: string;
  status: string;
  reportArtifactId: string | null;
  reportDigest: string | null;
  summary: unknown;
  timing: unknown;
  errorSummary: string | null;
  createdByUserId: string | null;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    baseKind: row.baseKind,
    baseReleaseId: row.baseReleaseId,
    candidateReleaseId: row.candidateReleaseId,
    corpusDigest: row.corpusDigest,
    replayInputDigest: row.replayInputDigest,
    replayEngineVersion: row.replayEngineVersion,
    status: row.status,
    reportArtifactId: row.reportArtifactId,
    reportDigest: row.reportDigest,
    summary: row.summary,
    timing: row.timing,
    errorSummary: row.errorSummary,
    createdByUserId: row.createdByUserId,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    publicationNote:
      "THIS DOES NOT PUBLISH OR ACTIVATE THE CATALOG. Replay is diagnostic evidence only.",
  };
}
