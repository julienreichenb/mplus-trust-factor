import { createHash, randomUUID } from "node:crypto";
import type {
  CalibrationCohortDTO,
  CalibrationCohortMemberDTO,
  CalibrationDigestDTO,
  CalibrationExpectedLabel,
  CalibrationMemberSource,
  CalibrationPreflightIssueDTO,
  CalibrationPreflightMemberDTO,
  CalibrationPreflightResultDTO,
  CalibrationReportDTO,
  CalibrationRunDTO,
  CalibrationRunMode,
} from "@mplus/contracts";
import {
  CALIBRATION_INPUT_BUNDLE_MAX_BYTES,
  CALIBRATION_EVIDENCE_SOURCE_CANONICAL,
  CALIBRATION_LABEL_TO_QUALITATIVE,
  CALIBRATION_LABEL_TO_TIER,
  CALIBRATION_TIER_TO_LABEL,
  createCalibrationCohortBodySchema,
  createCalibrationDraftModelBodySchema,
  createCalibrationMemberBodySchema,
  createCalibrationRunBodySchema,
  patchCalibrationCohortBodySchema,
  patchCalibrationMemberBodySchema,
  bulkCalibrationMembersBodySchema,
  calibrationPreflightBodySchema,
  resolveCalibrationMemberBodySchema,
  type CalibrationExpectedRank,
  type CalibrationRunProgressDTO,
} from "@mplus/contracts";
import type { AdminScoreModelDTO, ScoreModelConfig, ScoreSnapshotDTO } from "@mplus/contracts";
import type {
  CalibrationCohort,
  CalibrationCohortMember,
  CalibrationReport,
  CalibrationRun,
  Prisma,
  PrismaClient,
  ScoreModel,
} from "@mplus/database";
import {
  buildCalibrationInputBundle,
  CALIBRATION_INPUT_BUNDLE_SCHEMA_VERSION,
  COHORT_MANIFEST_SCHEMA_VERSION,
  hasReplayableScoringContext,
  type CalibrationBacktestMode,
  type CalibrationInputBundleV1,
  type CalibrationMemberEvidence,
  type CalibrationRole,
  type CohortManifest,
  type QualitativeLabel,
} from "@mplus/scoring";
import type { ScoreSnapshotWithRelations } from "@mplus/worker";
import { getScoringSeasonSelection } from "@mplus/worker";
import type { ApiContainer } from "../container.js";
import { HttpError } from "../errors.js";
import { writeAuditEvent } from "../iam/audit.js";
import { mapScoreSnapshot } from "../lib/mappers.js";
import { characterLacksBootstrapEvidence } from "./character-bootstrap-repair.js";
import { toCalibrationModelRef } from "./calibration-export.js";

type AuditCtx = {
  userId?: string | null;
  actorType: "user" | "admin_key" | "system" | "anonymous";
  ip?: string | null;
  userAgent?: string | null;
};

type CohortWithMembers = CalibrationCohort & { members: CalibrationCohortMember[] };

const MODE_TO_BUNDLE: Record<CalibrationRunMode, CalibrationBacktestMode> = {
  PERSISTED_SNAPSHOT_ONLY: "persisted-snapshot-only",
  DRAFT_MODEL_EVALUATE: "draft-model-evaluate",
  ACTIVE_VERSUS_DRAFT: "active-versus-draft",
};

function modeRequiresReplay(mode: CalibrationRunMode): boolean {
  return mode === "DRAFT_MODEL_EVALUATE" || mode === "ACTIVE_VERSUS_DRAFT";
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function mapAdminModel(model: ScoreModel): AdminScoreModelDTO {
  return {
    id: model.id,
    key: model.key,
    version: model.version,
    name: model.name,
    status: model.status as AdminScoreModelDTO["status"],
    config: model.config,
    createdAt: model.createdAt.toISOString(),
    activatedAt: model.activatedAt?.toISOString() ?? null,
  };
}

function assertEnabled(container: ApiContainer): void {
  if (!container.env.ADMIN_CALIBRATION_ENABLED) {
    throw HttpError.notFound("ADMIN_CALIBRATION_DISABLED", "Admin calibration is not enabled");
  }
}

function isEditableStatus(status: string): boolean {
  return status === "DRAFT" || status === "READY";
}

function assertEditable(cohort: CalibrationCohort): void {
  if (!isEditableStatus(cohort.status)) {
    throw HttpError.conflict(
      "COHORT_NOT_EDITABLE",
      `Cohort is ${cohort.status}; members and metadata may only change while DRAFT or READY`,
    );
  }
}

function mapMember(m: CalibrationCohortMember): CalibrationCohortMemberDTO {
  const expectedLabel = m.expectedLabel as CalibrationExpectedLabel;
  return {
    id: m.id,
    cohortId: m.cohortId,
    characterId: m.characterId,
    region: m.region,
    realmSlug: m.realmSlug,
    characterName: m.characterName,
    expectedLabel,
    expectedRank: CALIBRATION_LABEL_TO_TIER[expectedLabel],
    providedRole: (m.providedRole as CalibrationCohortMemberDTO["providedRole"]) ?? null,
    classSlug: m.classSlug,
    specSlug: m.specSlug,
    evidenceCutoffAt: m.evidenceCutoffAt?.toISOString() ?? null,
    rationale: m.rationale,
    source: m.source as CalibrationMemberSource,
    included: m.included,
    exclusionCode: m.exclusionCode,
    exclusionDetail: m.exclusionDetail,
    preflightSnapshot:
      m.preflightSnapshot && typeof m.preflightSnapshot === "object" && !Array.isArray(m.preflightSnapshot)
        ? (m.preflightSnapshot as Record<string, unknown>)
        : {},
    externalMemberKey: m.externalMemberKey,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

function mapCohort(
  cohort: CalibrationCohort & { _count?: { members: number }; members?: CalibrationCohortMember[] },
  counts?: { memberCount: number; includedMemberCount: number },
): CalibrationCohortDTO {
  const members = cohort.members;
  const memberCount = counts?.memberCount ?? members?.length ?? cohort._count?.members ?? 0;
  const includedMemberCount =
    counts?.includedMemberCount ??
    members?.filter((m) => m.included).length ??
    memberCount;
  return {
    id: cohort.id,
    name: cohort.name,
    description: cohort.description,
    seasonId: cohort.seasonId,
    status: cohort.status as CalibrationCohortDTO["status"],
    revision: cohort.revision,
    externalKey: cohort.externalKey,
    createdByUserId: cohort.createdByUserId,
    createdAt: cohort.createdAt.toISOString(),
    updatedAt: cohort.updatedAt.toISOString(),
    archivedAt: cohort.archivedAt?.toISOString() ?? null,
    memberCount,
    includedMemberCount,
    ...(members ? { members: members.map(mapMember) } : {}),
  };
}

function mapRun(
  run: CalibrationRun & {
    report?: {
      id: string;
      evaluatedCount?: number;
      failedOrExcludedCount?: number;
      summaryJson?: unknown;
    } | null;
    evaluationModel?: { id: string; name: string; version: number; status: string } | null;
    activeModel?: { id: string; name: string; version: number; status: string } | null;
  },
): CalibrationRunDTO {
  const snapshotIds = Array.isArray(run.snapshotIds)
    ? (run.snapshotIds as unknown[]).filter((id): id is string => typeof id === "string")
    : [];
  const scoreModel = run.evaluationModel ?? run.activeModel ?? null;
  const summary = run.report?.summaryJson;
  let summaryExactMatches: number | null = null;
  if (summary && typeof summary === "object" && !Array.isArray(summary)) {
    const s = summary as Record<string, unknown>;
    if (typeof s.exactMatchCount === "number") summaryExactMatches = s.exactMatchCount;
  }
  return {
    id: run.id,
    cohortId: run.cohortId,
    cohortRevision: run.cohortRevision,
    seasonId: run.seasonId,
    mode: run.mode as CalibrationRunMode,
    status: run.status as CalibrationRunDTO["status"],
    activeModelId: run.activeModelId,
    evaluationModelId: run.evaluationModelId,
    scoreModelId: scoreModel?.id ?? run.evaluationModelId ?? run.activeModelId,
    scoreModelName: scoreModel?.name ?? null,
    scoreModelVersion: scoreModel?.version ?? null,
    scoreModelStatus: scoreModel?.status ?? null,
    evidencePolicy: run.evidencePolicy,
    inputBundleSchemaVersion: run.inputBundleSchemaVersion,
    inputBundleContentHash: run.inputBundleContentHash,
    inputBundleByteLength: run.inputBundleByteLength,
    snapshotIds,
    evidenceFingerprint: run.evidenceFingerprint,
    deterministicSeed: run.deterministicSeed,
    algorithmVersions:
      run.algorithmVersions && typeof run.algorithmVersions === "object" && !Array.isArray(run.algorithmVersions)
        ? (run.algorithmVersions as Record<string, unknown>)
        : {},
    cancelRequestedAt: run.cancelRequestedAt?.toISOString() ?? null,
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    createdByUserId: run.createdByUserId,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    bullmqJobId: run.bullmqJobId,
    hasReport: Boolean(run.report),
    progress: parseProgress((run as { progressJson?: unknown }).progressJson),
    summaryExactMatches,
    summaryEvaluated: run.report?.evaluatedCount ?? null,
    summaryFailed: run.report?.failedOrExcludedCount ?? null,
  };
}

function mapReport(report: CalibrationReport): CalibrationReportDTO {
  return {
    id: report.id,
    runId: report.runId,
    schemaVersion: report.schemaVersion,
    digestAlgorithmVersion: report.digestAlgorithmVersion,
    recommendationAlgorithmVersion: report.recommendationAlgorithmVersion,
    summary: report.summaryJson as Record<string, unknown>,
    report: report.reportJson as Record<string, unknown>,
    digest: report.digestJson as unknown as CalibrationDigestDTO,
    limitations: Array.isArray(report.limitationsJson) ? report.limitationsJson : [],
    cohortSize: report.cohortSize,
    evaluatedCount: report.evaluatedCount,
    failedOrExcludedCount: report.failedOrExcludedCount,
    spearman: report.spearman,
    pairwiseConcordance: report.pairwiseConcordance,
    meanScore: report.meanScore,
    meanConfidence: report.meanConfidence,
    outlierCount: report.outlierCount,
    contentHash: report.contentHash,
    generatedAt: report.generatedAt.toISOString(),
    createdAt: report.createdAt.toISOString(),
  };
}

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase("en-US");
}

function labelToQualitative(label: CalibrationExpectedLabel): QualitativeLabel {
  return CALIBRATION_LABEL_TO_QUALITATIVE[label];
}

function resolveExpectedLabel(input: {
  expectedLabel?: CalibrationExpectedLabel;
  expectedRank?: CalibrationExpectedRank;
}): CalibrationExpectedLabel {
  if (input.expectedLabel) return input.expectedLabel;
  if (input.expectedRank) return CALIBRATION_TIER_TO_LABEL[input.expectedRank];
  throw HttpError.badRequest("EXPECTED_RANK_REQUIRED", "expectedRank or expectedLabel is required");
}

function emptyProgress(total = 0): CalibrationRunProgressDTO {
  return {
    total,
    completed: 0,
    failed: 0,
    currentIndex: null,
    currentCharacterName: null,
    currentRealm: null,
    members: [],
    updatedAt: null,
  };
}

function parseProgress(raw: unknown): CalibrationRunProgressDTO | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.total !== "number") return null;
  return {
    total: o.total,
    completed: typeof o.completed === "number" ? o.completed : 0,
    failed: typeof o.failed === "number" ? o.failed : 0,
    currentIndex: typeof o.currentIndex === "number" ? o.currentIndex : null,
    currentCharacterName: typeof o.currentCharacterName === "string" ? o.currentCharacterName : null,
    currentRealm: typeof o.currentRealm === "string" ? o.currentRealm : null,
    members: Array.isArray(o.members) ? (o.members as CalibrationRunProgressDTO["members"]) : [],
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : null,
  };
}

function roleOrDefault(role: string | null | undefined): CalibrationRole {
  if (role === "TANK" || role === "HEALER" || role === "DPS") return role;
  return "DPS";
}

function freezeBundleJson(bundle: CalibrationInputBundleV1): {
  json: string;
  hash: string;
  byteLength: number;
} {
  const json = JSON.stringify(bundle);
  const byteLength = Buffer.byteLength(json, "utf8");
  if (byteLength > CALIBRATION_INPUT_BUNDLE_MAX_BYTES) {
    throw HttpError.badRequest(
      "CALIBRATION_BUNDLE_TOO_LARGE",
      `Frozen input bundle is ${byteLength} bytes; max allowed is ${CALIBRATION_INPUT_BUNDLE_MAX_BYTES}`,
      { byteLength, maxBytes: CALIBRATION_INPUT_BUNDLE_MAX_BYTES },
    );
  }
  const hash = createHash("sha256").update(json, "utf8").digest("hex");
  return { json, hash, byteLength };
}

function readCoverageNumber(
  explanation: unknown,
  key: "freshness" | "selectedRunCoverage",
): number | null {
  if (!explanation || typeof explanation !== "object") return null;
  const coverage = (explanation as { coverage?: unknown }).coverage;
  if (!coverage || typeof coverage !== "object") return null;
  const value = (coverage as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export class AdminCalibrationService {
  constructor(private readonly container: ApiContainer) {}

  private prisma(): PrismaClient {
    return this.container.worker.prisma;
  }

  private async audit(action: string, resourceId: string | undefined, ctx: AuditCtx, metadata?: Record<string, unknown>) {
    await writeAuditEvent(this.prisma(), {
      userId: ctx.userId ?? null,
      actorType: ctx.actorType,
      action,
      resourceType: "calibration",
      resourceId,
      sessionSecret: this.container.env.SESSION_SECRET,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata,
    });
  }

  private async requireCohort(cohortId: string, includeMembers = false): Promise<CohortWithMembers | CalibrationCohort> {
    const cohort = await this.prisma().calibrationCohort.findUnique({
      where: { id: cohortId },
      include: includeMembers ? { members: { orderBy: { createdAt: "asc" } } } : undefined,
    });
    if (!cohort) {
      throw HttpError.notFound("CALIBRATION_COHORT_NOT_FOUND", `Cohort ${cohortId} was not found`);
    }
    return cohort;
  }

  async listCohorts(): Promise<{ cohorts: CalibrationCohortDTO[] }> {
    assertEnabled(this.container);
    const rows = await this.prisma().calibrationCohort.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        members: { select: { included: true } },
        _count: { select: { members: true } },
      },
      take: 200,
    });
    return {
      cohorts: rows.map((row) =>
        mapCohort(
          {
            ...row,
            members: undefined,
          },
          {
            memberCount: row._count.members,
            includedMemberCount: row.members.filter((m) => m.included).length,
          },
        ),
      ),
    };
  }

  async createCohort(body: unknown, createdByUserId: string, ctx: AuditCtx): Promise<CalibrationCohortDTO> {
    assertEnabled(this.container);
    const input = createCalibrationCohortBodySchema.parse(body);
    let seasonId = input.seasonId;
    if (!seasonId) {
      const selection = await getScoringSeasonSelection(this.prisma());
      let latest =
        selection.selection.mode === "PINNED"
          ? await this.prisma().season.findFirst({
              where: { blizzardSeasonId: selection.selection.blizzardSeasonId },
              orderBy: [{ isCurrent: "desc" }, { endsAt: "desc" }, { createdAt: "desc" }],
            })
          : null;
      if (!latest) {
        latest =
          (await this.prisma().season.findFirst({
            where: { isCurrent: true },
            orderBy: [{ endsAt: "desc" }, { createdAt: "desc" }],
          })) ??
          (await this.prisma().season.findFirst({
            orderBy: [{ endsAt: "desc" }, { createdAt: "desc" }],
          }));
      }
      if (!latest) {
        throw HttpError.badRequest("SEASON_NOT_FOUND", "No season is available to bind the cohort");
      }
      seasonId = latest.id;
    } else {
      const season = await this.prisma().season.findUnique({ where: { id: seasonId } });
      if (!season) {
        throw HttpError.badRequest("SEASON_NOT_FOUND", `Season ${seasonId} was not found`);
      }
    }
    if (input.externalKey) {
      const existing = await this.prisma().calibrationCohort.findUnique({
        where: { externalKey: input.externalKey },
      });
      if (existing) {
        throw HttpError.conflict(
          "COHORT_EXTERNAL_KEY_EXISTS",
          `A cohort with externalKey ${input.externalKey} already exists`,
        );
      }
    }
    const created = await this.prisma().calibrationCohort.create({
      data: {
        id: randomUUID(),
        name: input.name,
        description: input.description,
        seasonId,
        status: input.status ?? "DRAFT",
        revision: 1,
        externalKey: input.externalKey ?? null,
        createdByUserId,
      },
    });
    await this.audit("admin.calibration.cohort.create", created.id, ctx, {
      name: created.name,
      seasonId: created.seasonId,
    });
    return mapCohort(created, { memberCount: 0, includedMemberCount: 0 });
  }

  async getCohort(cohortId: string): Promise<CalibrationCohortDTO> {
    assertEnabled(this.container);
    const cohort = (await this.requireCohort(cohortId, true)) as CohortWithMembers;
    return mapCohort(cohort, {
      memberCount: cohort.members.length,
      includedMemberCount: cohort.members.filter((m) => m.included).length,
    });
  }

  async patchCohort(cohortId: string, body: unknown, ctx: AuditCtx): Promise<CalibrationCohortDTO> {
    assertEnabled(this.container);
    const input = patchCalibrationCohortBodySchema.parse(body);
    const cohort = await this.requireCohort(cohortId);
    assertEditable(cohort);
    if (input.seasonId) {
      const season = await this.prisma().season.findUnique({ where: { id: input.seasonId } });
      if (!season) {
        throw HttpError.badRequest("SEASON_NOT_FOUND", `Season ${input.seasonId} was not found`);
      }
    }
    const updated = await this.prisma().$transaction(async (tx) => {
      return tx.calibrationCohort.update({
        where: { id: cohortId },
        data: {
          ...(input.name != null ? { name: input.name } : {}),
          ...(input.description != null ? { description: input.description } : {}),
          ...(input.seasonId != null ? { seasonId: input.seasonId } : {}),
          ...(input.status != null ? { status: input.status } : {}),
          revision: { increment: 1 },
        },
        include: { members: true },
      });
    });
    await this.audit("admin.calibration.cohort.patch", cohortId, ctx, { revision: updated.revision });
    return mapCohort(updated, {
      memberCount: updated.members.length,
      includedMemberCount: updated.members.filter((m) => m.included).length,
    });
  }

  async archiveCohort(cohortId: string, ctx: AuditCtx): Promise<CalibrationCohortDTO> {
    assertEnabled(this.container);
    const cohort = await this.requireCohort(cohortId, true);
    if (cohort.status === "ARCHIVED") {
      return mapCohort(cohort as CohortWithMembers);
    }
    const updated = await this.prisma().calibrationCohort.update({
      where: { id: cohortId },
      data: { status: "ARCHIVED", archivedAt: new Date(), revision: { increment: 1 } },
      include: { members: true },
    });
    await this.audit("admin.calibration.cohort.archive", cohortId, ctx, { revision: updated.revision });
    return mapCohort(updated, {
      memberCount: updated.members.length,
      includedMemberCount: updated.members.filter((m) => m.included).length,
    });
  }

  async deleteUnusedCohort(cohortId: string, ctx: AuditCtx): Promise<{ id: string }> {
    assertEnabled(this.container);
    const cohort = await this.requireCohort(cohortId);
    const runCount = await this.prisma().calibrationRun.count({ where: { cohortId } });
    if (runCount > 0) {
      throw HttpError.conflict(
        "COHORT_HAS_RUNS",
        "Only cohorts with no calibration runs can be deleted. Archive instead if history must be retained.",
      );
    }
    await this.prisma().calibrationCohort.delete({ where: { id: cohortId } });
    await this.audit("admin.calibration.cohort.delete", cohortId, ctx, { name: cohort.name });
    return { id: cohortId };
  }

  async addMember(cohortId: string, body: unknown, ctx: AuditCtx): Promise<CalibrationCohortMemberDTO> {
    assertEnabled(this.container);
    const input = createCalibrationMemberBodySchema.parse(body);
    const cohort = await this.requireCohort(cohortId);
    assertEditable(cohort);
    const expectedLabel = resolveExpectedLabel(input);
    const rationale = input.rationale?.trim() ? input.rationale : "Labeled by administrator";
    await this.assertNoDuplicateMember(cohortId, {
      characterId: input.characterId ?? null,
      region: input.region,
      realmSlug: input.realmSlug,
      characterName: input.characterName,
    });
    const member = await this.prisma().$transaction(async (tx) => {
      await tx.calibrationCohort.update({
        where: { id: cohortId },
        data: { revision: { increment: 1 } },
      });
      return tx.calibrationCohortMember.create({
        data: {
          id: randomUUID(),
          cohortId,
          characterId: input.characterId ?? null,
          region: input.region,
          realmSlug: input.realmSlug,
          characterName: input.characterName,
          expectedLabel,
          providedRole: input.providedRole ?? null,
          classSlug: input.classSlug ?? null,
          specSlug: input.specSlug ?? null,
          evidenceCutoffAt: input.evidenceCutoffAt ? new Date(input.evidenceCutoffAt) : null,
          rationale,
          source: input.source ?? "USER_SELECTED",
          included: input.included ?? true,
          exclusionCode: input.exclusionCode ?? null,
          exclusionDetail: input.exclusionDetail ?? null,
          externalMemberKey: input.externalMemberKey ?? null,
        },
      });
    });
    await this.audit("admin.calibration.member.create", member.id, ctx, { cohortId });
    return mapMember(member);
  }

  /**
   * Resolve character identity (local reuse or Blizzard bootstrap) and add to cohort.
   * Never enqueues refresh / WCL — skipRefreshEnqueue on canonical CharacterService.resolveCharacter.
   */
  async resolveAndAddMember(
    cohortId: string,
    body: unknown,
    ctx: AuditCtx,
  ): Promise<CalibrationCohortMemberDTO & { resolveStatus: string }> {
    assertEnabled(this.container);
    const input = resolveCalibrationMemberBodySchema.parse(body);
    const cohort = await this.requireCohort(cohortId);
    assertEditable(cohort);
    const expectedLabel = resolveExpectedLabel(input);
    const { CharacterService } = await import("./character-service.js");
    const characterService = new CharacterService(this.container);
    const identity = {
      region: input.region,
      realmSlug: input.realmSlug,
      name: input.characterName,
    };
    const resolved = await characterService.resolveCharacter(identity, {
      workloadClass: "CALIBRATION",
      skipRefreshEnqueue: true,
      correlationId: `calibration-member-${cohortId}`,
    });
    if (
      resolved.body.status === "NOT_FOUND" ||
      resolved.body.status === "FAILED" ||
      resolved.body.status === "PROVIDER_UNAVAILABLE"
    ) {
      throw HttpError.badRequest(
        "CHARACTER_RESOLVE_FAILED",
        resolved.body.message ?? "Character could not be resolved",
        { status: resolved.body.status },
      );
    }
    const characterId =
      "characterId" in resolved.body && typeof resolved.body.characterId === "string"
        ? resolved.body.characterId
        : null;
    if (!characterId) {
      throw HttpError.badRequest("CHARACTER_RESOLVE_FAILED", "Character resolve did not return an id");
    }
    const character = await this.prisma().character.findUnique({
      where: { id: characterId },
      include: { region: true, realm: true, gameClass: true, activeSpec: true },
    });
    if (!character) {
      throw HttpError.badRequest("CHARACTER_RESOLVE_FAILED", "Resolved character was not persisted");
    }
    await this.assertNoDuplicateMember(cohortId, {
      characterId,
      region: character.region.code,
      realmSlug: character.realm.slug,
      characterName: character.displayName,
    });
    const member = await this.prisma().$transaction(async (tx) => {
      await tx.calibrationCohort.update({
        where: { id: cohortId },
        data: { revision: { increment: 1 } },
      });
      return tx.calibrationCohortMember.create({
        data: {
          id: randomUUID(),
          cohortId,
          characterId,
          region: character.region.code,
          realmSlug: character.realm.slug,
          characterName: character.displayName,
          expectedLabel,
          providedRole:
            character.role === "DPS" || character.role === "TANK" || character.role === "HEALER"
              ? character.role
              : null,
          classSlug: character.gameClass?.slug ?? null,
          specSlug: character.activeSpec?.slug ?? null,
          rationale: input.rationale?.trim() ? input.rationale : "Labeled by administrator",
          source: "USER_SELECTED",
          included: true,
          preflightSnapshot: {
            resolveStatus: resolved.body.status,
            level: character.level,
            blizzardOnly: true,
            wclCalls: 0,
          },
        },
      });
    });
    await this.audit("admin.calibration.member.resolve_add", member.id, ctx, {
      cohortId,
      characterId,
      resolveStatus: resolved.body.status,
    });
    return { ...mapMember(member), resolveStatus: resolved.body.status };
  }

  private async assertNoDuplicateMember(
    cohortId: string,
    identity: {
      characterId: string | null;
      region: string;
      realmSlug: string;
      characterName: string;
    },
  ): Promise<void> {
    if (identity.characterId) {
      const byId = await this.prisma().calibrationCohortMember.findFirst({
        where: { cohortId, characterId: identity.characterId },
      });
      if (byId) {
        throw HttpError.conflict(
          "DUPLICATE_COHORT_MEMBER",
          "This character is already in the cohort",
        );
      }
    }
    const byName = await this.prisma().calibrationCohortMember.findFirst({
      where: {
        cohortId,
        region: identity.region.toUpperCase(),
        realmSlug: identity.realmSlug.toLowerCase(),
        characterName: { equals: identity.characterName, mode: "insensitive" },
      },
    });
    if (byName) {
      throw HttpError.conflict(
        "DUPLICATE_COHORT_MEMBER",
        "This character is already in the cohort",
      );
    }
  }

  async bulkMembers(
    cohortId: string,
    body: unknown,
    ctx: AuditCtx,
  ): Promise<{ members: CalibrationCohortMemberDTO[]; failed: Array<{ index: number; message: string }> }> {
    assertEnabled(this.container);
    const input = bulkCalibrationMembersBodySchema.parse(body);
    const cohort = await this.requireCohort(cohortId);
    assertEditable(cohort);
    const failed: Array<{ index: number; message: string }> = [];
    const created: CalibrationCohortMember[] = [];

    await this.prisma().$transaction(async (tx) => {
      if (input.replaceAll) {
        await tx.calibrationCohortMember.deleteMany({ where: { cohortId } });
      }
      for (let i = 0; i < input.members.length; i++) {
        const raw = input.members[i]!;
        try {
          const row = createCalibrationMemberBodySchema.parse(raw);
          const expectedLabel = resolveExpectedLabel(row);
          const rationale = row.rationale?.trim() ? row.rationale : "Labeled by administrator";
          if (row.externalMemberKey) {
            const existing = await tx.calibrationCohortMember.findFirst({
              where: { cohortId, externalMemberKey: row.externalMemberKey },
            });
            if (existing && !input.replaceAll) {
              const updated = await tx.calibrationCohortMember.update({
                where: { id: existing.id },
                data: {
                  characterId: row.characterId ?? null,
                  region: row.region,
                  realmSlug: row.realmSlug,
                  characterName: row.characterName,
                  expectedLabel,
                  providedRole: row.providedRole ?? null,
                  classSlug: row.classSlug ?? null,
                  specSlug: row.specSlug ?? null,
                  evidenceCutoffAt: row.evidenceCutoffAt ? new Date(row.evidenceCutoffAt) : null,
                  rationale,
                  source: row.source ?? existing.source,
                  included: row.included ?? existing.included,
                  exclusionCode: row.exclusionCode ?? null,
                  exclusionDetail: row.exclusionDetail ?? null,
                },
              });
              created.push(updated);
              continue;
            }
          }
          const member = await tx.calibrationCohortMember.create({
            data: {
              id: randomUUID(),
              cohortId,
              characterId: row.characterId ?? null,
              region: row.region,
              realmSlug: row.realmSlug,
              characterName: row.characterName,
              expectedLabel,
              providedRole: row.providedRole ?? null,
              classSlug: row.classSlug ?? null,
              specSlug: row.specSlug ?? null,
              evidenceCutoffAt: row.evidenceCutoffAt ? new Date(row.evidenceCutoffAt) : null,
              rationale,
              source: row.source ?? "USER_SELECTED",
              included: row.included ?? true,
              exclusionCode: row.exclusionCode ?? null,
              exclusionDetail: row.exclusionDetail ?? null,
              externalMemberKey: row.externalMemberKey ?? null,
            },
          });
          created.push(member);
        } catch (error) {
          failed.push({
            index: i,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (failed.length > 0 && created.length === 0) {
        throw HttpError.badRequest("BULK_MEMBER_IMPORT_FAILED", "All bulk member rows failed", {
          failed,
        });
      }
      await tx.calibrationCohort.update({
        where: { id: cohortId },
        data: { revision: { increment: 1 } },
      });
    });

    await this.audit("admin.calibration.member.bulk", cohortId, ctx, {
      created: created.length,
      failed: failed.length,
      replaceAll: input.replaceAll,
    });
    return { members: created.map(mapMember), failed };
  }

  async patchMember(
    cohortId: string,
    memberId: string,
    body: unknown,
    ctx: AuditCtx,
  ): Promise<CalibrationCohortMemberDTO> {
    assertEnabled(this.container);
    const input = patchCalibrationMemberBodySchema.parse(body);
    const cohort = await this.requireCohort(cohortId);
    assertEditable(cohort);
    const existing = await this.prisma().calibrationCohortMember.findFirst({
      where: { id: memberId, cohortId },
    });
    if (!existing) {
      throw HttpError.notFound("CALIBRATION_MEMBER_NOT_FOUND", `Member ${memberId} was not found`);
    }
    const updated = await this.prisma().$transaction(async (tx) => {
      await tx.calibrationCohort.update({
        where: { id: cohortId },
        data: { revision: { increment: 1 } },
      });
      const expectedLabel =
        input.expectedLabel || input.expectedRank
          ? resolveExpectedLabel({
              expectedLabel: input.expectedLabel,
              expectedRank: input.expectedRank,
            })
          : undefined;
      return tx.calibrationCohortMember.update({
        where: { id: memberId },
        data: {
          ...(input.characterId !== undefined ? { characterId: input.characterId } : {}),
          ...(input.region != null ? { region: input.region } : {}),
          ...(input.realmSlug != null ? { realmSlug: input.realmSlug } : {}),
          ...(input.characterName != null ? { characterName: input.characterName } : {}),
          ...(expectedLabel != null ? { expectedLabel } : {}),
          ...(input.providedRole !== undefined ? { providedRole: input.providedRole } : {}),
          ...(input.classSlug !== undefined ? { classSlug: input.classSlug } : {}),
          ...(input.specSlug !== undefined ? { specSlug: input.specSlug } : {}),
          ...(input.evidenceCutoffAt !== undefined
            ? { evidenceCutoffAt: input.evidenceCutoffAt ? new Date(input.evidenceCutoffAt) : null }
            : {}),
          ...(input.rationale != null ? { rationale: input.rationale } : {}),
          ...(input.source != null ? { source: input.source } : {}),
          ...(input.included != null ? { included: input.included } : {}),
          ...(input.exclusionCode !== undefined ? { exclusionCode: input.exclusionCode } : {}),
          ...(input.exclusionDetail !== undefined ? { exclusionDetail: input.exclusionDetail } : {}),
          ...(input.externalMemberKey !== undefined
            ? { externalMemberKey: input.externalMemberKey }
            : {}),
        },
      });
    });
    await this.audit("admin.calibration.member.patch", memberId, ctx, { cohortId });
    return mapMember(updated);
  }

  async deleteMember(cohortId: string, memberId: string, ctx: AuditCtx): Promise<{ id: string }> {
    assertEnabled(this.container);
    const cohort = await this.requireCohort(cohortId);
    assertEditable(cohort);
    const existing = await this.prisma().calibrationCohortMember.findFirst({
      where: { id: memberId, cohortId },
    });
    if (!existing) {
      throw HttpError.notFound("CALIBRATION_MEMBER_NOT_FOUND", `Member ${memberId} was not found`);
    }
    await this.prisma().$transaction(async (tx) => {
      await tx.calibrationCohortMember.delete({ where: { id: memberId } });
      await tx.calibrationCohort.update({
        where: { id: cohortId },
        data: { revision: { increment: 1 } },
      });
    });
    await this.audit("admin.calibration.member.delete", memberId, ctx, { cohortId });
    return { id: memberId };
  }

  private async resolveCharacterForMember(member: CalibrationCohortMember) {
    if (member.characterId) {
      return this.prisma().character.findUnique({
        where: { id: member.characterId },
        include: {
          region: true,
          realm: true,
          gameClass: true,
          activeSpec: true,
        },
      });
    }
    const region = await this.prisma().region.findFirst({
      where: { code: member.region.toUpperCase() },
    });
    if (!region) return null;
    const realm = await this.prisma().realm.findFirst({
      where: { regionId: region.id, slug: member.realmSlug.toLowerCase() },
    });
    if (!realm) return null;
    return this.prisma().character.findFirst({
      where: {
        regionId: region.id,
        realmId: realm.id,
        normalizedName: normalizeName(member.characterName),
      },
      include: {
        region: true,
        realm: true,
        gameClass: true,
        activeSpec: true,
      },
    });
  }

  private async selectSnapshot(characterId: string, seasonId: string, scoreModelId: string | null) {
    return this.prisma().scoreSnapshot.findFirst({
      where: {
        characterId,
        seasonId,
        isPublic: true,
        publicationStatus: { in: ["PUBLIC", "PUBLISHED"] },
        scopeType: "CHARACTER",
        ...(scoreModelId ? { scoreModelId } : {}),
      },
      include: {
        dimensionScores: true,
        scoreModel: true,
        season: true,
        character: {
          include: {
            region: true,
            realm: true,
            gameClass: true,
            activeSpec: true,
          },
        },
      },
      orderBy: { calculatedAt: "desc" },
    });
  }

  async preflight(cohortId: string, body: unknown): Promise<CalibrationPreflightResultDTO> {
    assertEnabled(this.container);
    const input = calibrationPreflightBodySchema.parse(body);
    const needsReplay = modeRequiresReplay(input.mode);
    const cohort = (await this.requireCohort(cohortId, true)) as CohortWithMembers;
    const seasonId = input.seasonId ?? cohort.seasonId;
    const season = await this.prisma().season.findUnique({ where: { id: seasonId } });
    if (!season) {
      throw HttpError.badRequest("SEASON_NOT_FOUND", `Season ${seasonId} was not found`);
    }

    const { activeModel, evaluationModel } = await this.resolveModelsForMode({
      mode: input.mode,
      activeModelId: input.activeModelId,
      evaluationModelId: input.evaluationModelId,
      requireEvaluation: needsReplay,
    });

    const members: CalibrationPreflightMemberDTO[] = [];
    const issues: CalibrationPreflightIssueDTO[] = [];

    for (const member of cohort.members) {
      const memberIssues: CalibrationPreflightIssueDTO[] = [];
      const character = await this.resolveCharacterForMember(member);
      const characterId = character?.id ?? member.characterId;
      const bootstrapComplete = character ? !characterLacksBootstrapEvidence(character) : false;
      const observedRole =
        character?.role === "TANK" || character?.role === "HEALER" || character?.role === "DPS"
          ? character.role
          : null;
      const observedClassSlug = character?.gameClass?.slug ?? null;
      const observedSpecSlug = character?.activeSpec?.slug ?? null;

      if (!character) {
        memberIssues.push({
          code: "CHARACTER_NOT_FOUND",
          severity: "BLOCKING",
          memberId: member.id,
          message: "No persisted Character matches this identity",
          nextActionHint: "Resolve the character via canonical admin/character resolve (outside calibration)",
        });
      } else if (!bootstrapComplete) {
        memberIssues.push({
          code: "BOOTSTRAP_INCOMPLETE",
          severity: "BLOCKING",
          memberId: member.id,
          message: "Character bootstrap evidence is incomplete",
          nextActionHint: "Use bootstrap repair / exact resolve outside calibration",
        });
      }

      if (
        member.providedRole &&
        observedRole &&
        member.providedRole !== observedRole &&
        member.included
      ) {
        memberIssues.push({
          code: "ROLE_CONTEXT_MISMATCH",
          severity: "WARNING",
          memberId: member.id,
          message: `providedRole ${member.providedRole} does not match observed role ${observedRole}`,
          nextActionHint: "Exclude the member or repair role context outside calibration",
        });
      }

      let selectedSnapshotId: string | null = null;
      let seasonCompatible = false;
      let modelCompatible = false;
      let replayable = false;
      let missingEvidence = true;
      const staleEvidence = false;

      if (characterId) {
        const snap = await this.selectSnapshot(characterId, seasonId, activeModel?.id ?? null);
        if (!snap) {
          memberIssues.push({
            code: "SNAPSHOT_MISSING",
            severity: member.included ? "BLOCKING" : "INFO",
            memberId: member.id,
            message: "No public CHARACTER score snapshot for the selected season/model",
            nextActionHint: "Refresh evidence is a separate admin workflow outside calibration",
          });
        } else {
          selectedSnapshotId = snap.id;
          missingEvidence = false;
          seasonCompatible = snap.seasonId === seasonId;
          modelCompatible = activeModel ? snap.scoreModelId === activeModel.id : true;
          if (!seasonCompatible) {
            memberIssues.push({
              code: "SEASON_MISMATCH",
              severity: "BLOCKING",
              memberId: member.id,
              message: "Selected snapshot season does not match preflight season",
              nextActionHint: null,
            });
          }
          if (activeModel && !modelCompatible) {
            memberIssues.push({
              code: "SNAPSHOT_MODEL_MISMATCH",
              severity: "WARNING",
              memberId: member.id,
              message: "Snapshot was produced by a different score model than the selected active model",
              nextActionHint: null,
            });
          }
          const freshness = readCoverageNumber(snap.explanation, "freshness");
          const selectedRunCoverage = readCoverageNumber(snap.explanation, "selectedRunCoverage");
          const scoringContext =
            freshness != null && selectedRunCoverage != null
              ? {
                  role: roleOrDefault(observedRole),
                  classSlug: observedClassSlug,
                  specSlug: observedSpecSlug,
                  freshness,
                  selectedRunCoverage,
                }
              : null;
          const observations = characterId
            ? await this.container.worker.repositories.metric.listForCharacter(characterId, seasonId)
            : [];
          replayable = hasReplayableScoringContext(scoringContext) && observations.length > 0;
          if (needsReplay && member.included && !replayable) {
            memberIssues.push({
              code: "REPLAY_EVIDENCE_MISSING",
              severity: "BLOCKING",
              memberId: member.id,
              message:
                "Draft/active-versus-draft modes require observations and scoringContext (role, freshness, selectedRunCoverage)",
              nextActionHint: "Refresh evidence is a separate admin workflow outside calibration",
            });
          }
        }
      }

      if (!member.included) {
        memberIssues.push({
          code: member.exclusionCode ?? "EXCLUDED",
          severity: "INFO",
          memberId: member.id,
          message: member.exclusionDetail ?? "Member is excluded from evaluation",
          nextActionHint: null,
        });
      }

      issues.push(...memberIssues);
      members.push({
        memberId: member.id,
        externalMemberKey: member.externalMemberKey,
        characterId: characterId ?? null,
        region: member.region,
        realmSlug: member.realmSlug,
        characterName: member.characterName,
        expectedLabel: member.expectedLabel as CalibrationExpectedLabel,
        providedRole: (member.providedRole as CalibrationPreflightMemberDTO["providedRole"]) ?? null,
        observedRole,
        observedClassSlug,
        observedSpecSlug,
        bootstrapComplete,
        selectedSnapshotId,
        seasonCompatible,
        modelCompatible,
        replayable,
        missingEvidence,
        staleEvidence,
        included: member.included,
        exclusionCode: member.exclusionCode,
        exclusionDetail: member.exclusionDetail,
        issues: memberIssues,
      });

      await this.prisma().calibrationCohortMember.update({
        where: { id: member.id },
        data: {
          characterId: characterId ?? member.characterId,
          preflightSnapshot: {
            characterId: characterId ?? null,
            bootstrapComplete,
            observedRole,
            observedClassSlug,
            observedSpecSlug,
            selectedSnapshotId,
            seasonCompatible,
            modelCompatible,
            replayable,
            missingEvidence,
            generatedAt: new Date().toISOString(),
          },
        },
      });
    }

    return {
      cohortId: cohort.id,
      cohortRevision: cohort.revision,
      seasonId,
      mode: input.mode,
      activeModelId: activeModel?.id ?? null,
      evaluationModelId: evaluationModel?.id ?? input.evaluationModelId ?? null,
      generatedAt: new Date().toISOString(),
      blockingCount: issues.filter((i) => i.severity === "BLOCKING").length,
      warningCount: issues.filter((i) => i.severity === "WARNING").length,
      members,
      issues,
    };
  }

  async createRun(
    cohortId: string,
    body: unknown,
    createdByUserId: string,
    ctx: AuditCtx,
  ): Promise<CalibrationRunDTO> {
    assertEnabled(this.container);
    // V1 remains the default createRun path while CALIBRATION_ENABLED is false.
    // Bundle V2 validate/preflight/replay lives in @mplus/scoring (no silent V1→V2 conversion).
    if (this.container.env.CALIBRATION_ENABLED) {
      // Gated: V2 run creation is not switched on yet — keep freezing V1 snapshot bundles.
      // Callers may still validate/replay V2 fixtures via scoring-package helpers.
    }
    const input = createCalibrationRunBodySchema.parse(body);

    let mode: CalibrationRunMode = input.mode ?? "PERSISTED_SNAPSHOT_ONLY";
    let activeModelId = input.activeModelId;
    let evaluationModelId = input.evaluationModelId;

    if (input.scoreModelId) {
      const selected = await this.prisma().scoreModel.findUnique({
        where: { id: input.scoreModelId },
      });
      if (!selected) {
        throw HttpError.badRequest(
          "SCORE_MODEL_NOT_FOUND",
          `Score model ${input.scoreModelId} was not found`,
        );
      }
      if (selected.status === "ARCHIVED") {
        throw HttpError.badRequest(
          "SCORE_MODEL_ARCHIVED",
          "Archived models cannot launch a calibration run",
        );
      }
      if (selected.status === "ACTIVE") {
        mode = "PERSISTED_SNAPSHOT_ONLY";
        activeModelId = selected.id;
        evaluationModelId = selected.id;
      } else if (selected.status === "DRAFT") {
        mode = "DRAFT_MODEL_EVALUATE";
        evaluationModelId = selected.id;
        activeModelId = input.activeModelId ?? null;
      } else {
        throw HttpError.badRequest(
          "SCORE_MODEL_NOT_RUNNABLE",
          `Score model status ${selected.status} cannot launch a calibration run`,
        );
      }
    }

    const needsReplay = modeRequiresReplay(mode);
    const bundleMode = MODE_TO_BUNDLE[mode];

    const cohort = (await this.requireCohort(cohortId, true)) as CohortWithMembers;
    if (cohort.status === "ARCHIVED") {
      throw HttpError.conflict("COHORT_ARCHIVED", "Cannot start a run on an archived cohort");
    }
    if (input.expectedCohortRevision != null && input.expectedCohortRevision !== cohort.revision) {
      throw HttpError.conflict(
        "COHORT_REVISION_MISMATCH",
        `Expected revision ${input.expectedCohortRevision} but cohort is at ${cohort.revision}`,
      );
    }

    const season = await this.prisma().season.findUnique({ where: { id: cohort.seasonId } });
    if (!season) {
      throw HttpError.badRequest("SEASON_NOT_FOUND", `Season ${cohort.seasonId} was not found`);
    }

    const { activeModel, evaluationModel } = await this.resolveModelsForMode({
      mode,
      activeModelId,
      evaluationModelId,
      requireEvaluation: needsReplay,
    });
    if (!activeModel) {
      throw HttpError.badRequest(
        "ACTIVE_MODEL_REQUIRED",
        "An ACTIVE reference score model is required for calibration runs",
      );
    }
    const evalModel = evaluationModel ?? activeModel;
    if (needsReplay && !evaluationModel) {
      throw HttpError.badRequest(
        "EVALUATION_MODEL_REQUIRED",
        `${mode} requires a DRAFT evaluationModelId`,
      );
    }

    const includeUnevaluated =
      input.includeUnevaluatedMembers ?? Boolean(input.scoreModelId);
    /** Product UI path: acquire via canonical WCL scoring; snapshots optional. */
    const productAcquire = Boolean(input.scoreModelId);
    const generatedAt = new Date().toISOString();
    const included = cohort.members.filter((m) => m.included);
    const evidenceByMemberId: Record<string, CalibrationMemberEvidence> = {};
    const manifestMembers: CohortManifest["members"] = [];
    const snapshotIds: string[] = [];
    const evidenceCutoffs: string[] = [];

    for (const member of included) {
      const character = await this.resolveCharacterForMember(member);
      const memberKey = member.externalMemberKey ?? member.id;
      const expectedLabel = labelToQualitative(member.expectedLabel as CalibrationExpectedLabel);

      if (productAcquire) {
        if (!character) {
          if (!includeUnevaluated) {
            throw HttpError.badRequest(
              "CHARACTER_NOT_FOUND",
              `Included member ${member.id} has no resolved Character — resolve via Blizzard first`,
            );
          }
          evidenceByMemberId[memberKey] = {
            memberId: memberKey,
            characterId: null,
            snapshotId: null,
            snapshot: null,
            observations: null,
            scoringContext: null,
            calculatedAt: null,
            inputFingerprint: null,
            seasonSlug: season.slug,
          };
          manifestMembers.push({
            id: memberKey,
            region: member.region,
            realm: member.realmSlug,
            character: member.characterName,
            role: member.providedRole ? roleOrDefault(member.providedRole) : "DPS",
            classSlug: member.classSlug ?? "unknown",
            specSlug: member.specSlug ?? "unknown",
            expectedLabel,
            meta: false,
            rationale: member.rationale,
            suspectedBoost: false,
            source: member.source === "STRATIFIED_AUTO" ? "stratified-auto" : "user-selected",
            snapshotIds: [],
            seasonSlug: season.slug,
          });
          continue;
        }

        evidenceCutoffs.push(
          member.evidenceCutoffAt?.toISOString() ?? generatedAt,
        );
        evidenceByMemberId[memberKey] = {
          memberId: memberKey,
          characterId: character.id,
          snapshotId: null,
          snapshot: null,
          observations: null,
          scoringContext: null,
          calculatedAt: null,
          inputFingerprint: null,
          seasonSlug: season.slug,
        };
        manifestMembers.push({
          id: memberKey,
          region: member.region,
          realm: member.realmSlug,
          character: member.characterName,
          role: member.providedRole
            ? roleOrDefault(member.providedRole)
            : roleOrDefault(character.role),
          classSlug: member.classSlug ?? character.gameClass?.slug ?? "unknown",
          specSlug: member.specSlug ?? character.activeSpec?.slug ?? "unknown",
          expectedLabel,
          meta: false,
          rationale: member.rationale,
          suspectedBoost: false,
          source: member.source === "STRATIFIED_AUTO" ? "stratified-auto" : "user-selected",
          snapshotIds: [],
          seasonSlug: season.slug,
        });
        continue;
      }

      if (!character) {
        if (!includeUnevaluated && input.evidencePolicy === "STRICT") {
          throw HttpError.badRequest(
            "CHARACTER_NOT_FOUND",
            `Included member ${member.id} has no resolved Character — run preflight and fix first`,
          );
        }
        if (includeUnevaluated) {
          evidenceByMemberId[memberKey] = {
            memberId: memberKey,
            characterId: null,
            snapshotId: null,
            snapshot: null,
            observations: null,
            scoringContext: null,
            calculatedAt: null,
            inputFingerprint: null,
            seasonSlug: season.slug,
          };
          manifestMembers.push({
            id: memberKey,
            region: member.region,
            realm: member.realmSlug,
            character: member.characterName,
            role: member.providedRole ? roleOrDefault(member.providedRole) : "DPS",
            classSlug: member.classSlug ?? "unknown",
            specSlug: member.specSlug ?? "unknown",
            expectedLabel,
            meta: false,
            rationale: member.rationale,
            suspectedBoost: false,
            source: member.source === "STRATIFIED_AUTO" ? "stratified-auto" : "user-selected",
            snapshotIds: [],
            seasonSlug: season.slug,
          });
        }
        continue;
      }

      const snap = await this.selectSnapshot(character.id, cohort.seasonId, activeModel.id);
      if (!snap) {
        if (input.evidencePolicy === "STRICT" && !includeUnevaluated) {
          throw HttpError.badRequest(
            "SNAPSHOT_MISSING",
            `Included member ${member.id} has no public snapshot for the cohort season/model`,
          );
        }
        if (includeUnevaluated) {
          evidenceByMemberId[memberKey] = {
            memberId: memberKey,
            characterId: character.id,
            snapshotId: null,
            snapshot: null,
            observations: null,
            scoringContext: null,
            calculatedAt: null,
            inputFingerprint: null,
            seasonSlug: season.slug,
          };
          manifestMembers.push({
            id: memberKey,
            region: member.region,
            realm: member.realmSlug,
            character: member.characterName,
            role: member.providedRole ? roleOrDefault(member.providedRole) : roleOrDefault(character.role),
            classSlug: member.classSlug ?? character.gameClass?.slug ?? "unknown",
            specSlug: member.specSlug ?? character.activeSpec?.slug ?? "unknown",
            expectedLabel,
            meta: false,
            rationale: member.rationale,
            suspectedBoost: false,
            source: member.source === "STRATIFIED_AUTO" ? "stratified-auto" : "user-selected",
            snapshotIds: [],
            seasonSlug: season.slug,
          });
        }
        continue;
      }
      const dto = mapScoreSnapshot(snap as ScoreSnapshotWithRelations);
      const observations = await this.container.worker.repositories.metric.listForCharacter(
        character.id,
        cohort.seasonId,
      );
      const freshness = readCoverageNumber(snap.explanation, "freshness");
      const selectedRunCoverage = readCoverageNumber(snap.explanation, "selectedRunCoverage");
      const role = roleOrDefault(character.role);
      const scoringContext =
        freshness != null && selectedRunCoverage != null
          ? {
              role,
              classSlug: character.gameClass?.slug ?? null,
              specSlug: character.activeSpec?.slug ?? null,
              freshness,
              selectedRunCoverage,
            }
          : null;

      const replayable =
        hasReplayableScoringContext(scoringContext) && observations.length > 0;
      if (needsReplay && !replayable) {
        if (input.evidencePolicy === "STRICT" && !includeUnevaluated) {
          throw HttpError.badRequest(
            "REPLAY_EVIDENCE_MISSING",
            `Included member ${member.id} lacks replayable observations/scoringContext for ${mode}`,
          );
        }
        if (includeUnevaluated) {
          evidenceByMemberId[memberKey] = {
            memberId: memberKey,
            characterId: character.id,
            snapshotId: snap.id,
            snapshot: dto as ScoreSnapshotDTO,
            observations: observations.length > 0 ? observations : null,
            scoringContext,
            calculatedAt: snap.calculatedAt.toISOString(),
            inputFingerprint: snap.inputFingerprint,
            seasonSlug: snap.season.slug,
          };
          manifestMembers.push({
            id: memberKey,
            region: member.region,
            realm: member.realmSlug,
            character: member.characterName,
            role: member.providedRole ? roleOrDefault(member.providedRole) : role,
            classSlug: member.classSlug ?? character.gameClass?.slug ?? "unknown",
            specSlug: member.specSlug ?? character.activeSpec?.slug ?? "unknown",
            expectedLabel,
            meta: false,
            rationale: member.rationale,
            suspectedBoost: false,
            source: member.source === "STRATIFIED_AUTO" ? "stratified-auto" : "user-selected",
            snapshotIds: [snap.id],
            seasonSlug: season.slug,
          });
          snapshotIds.push(snap.id);
        }
        continue;
      }

      snapshotIds.push(snap.id);
      evidenceCutoffs.push(
        member.evidenceCutoffAt?.toISOString() ?? snap.calculatedAt.toISOString(),
      );

      // Identical frozen evidence is shared by active and draft evaluations.
      evidenceByMemberId[memberKey] = {
        memberId: memberKey,
        characterId: character.id,
        snapshotId: snap.id,
        snapshot: dto as ScoreSnapshotDTO,
        observations: observations.length > 0 ? observations : null,
        scoringContext,
        calculatedAt: snap.calculatedAt.toISOString(),
        inputFingerprint: snap.inputFingerprint,
        seasonSlug: snap.season.slug,
      };

      // Expert label is authoritative — never derived from score/grade.
      manifestMembers.push({
        id: memberKey,
        region: member.region,
        realm: member.realmSlug,
        character: member.characterName,
        role: member.providedRole ? roleOrDefault(member.providedRole) : role,
        classSlug: member.classSlug ?? character.gameClass?.slug ?? "unknown",
        specSlug: member.specSlug ?? character.activeSpec?.slug ?? "unknown",
        expectedLabel,
        meta: false,
        rationale: member.rationale,
        suspectedBoost: false,
        source: member.source === "STRATIFIED_AUTO" ? "stratified-auto" : "user-selected",
        snapshotIds: [snap.id],
        seasonSlug: season.slug,
      });
    }

    if (manifestMembers.length === 0) {
      throw HttpError.badRequest(
        "EMPTY_CALIBRATION_COHORT",
        productAcquire
          ? "No included members to calibrate"
          : needsReplay
            ? "No included members with replayable evidence"
            : "No included members with usable snapshots",
      );
    }

    const activeRef = toCalibrationModelRef(activeModel, true);
    const evaluationRef = toCalibrationModelRef(evalModel, evalModel.status === "ACTIVE");
    const manifest: CohortManifest = {
      schemaVersion: COHORT_MANIFEST_SCHEMA_VERSION,
      cohortId: cohort.id,
      description: cohort.description || cohort.name,
      createdAt: generatedAt,
      members: manifestMembers,
      notes: `Frozen at cohort revision ${cohort.revision}; mode=${mode}`,
    };

    const bundle = buildCalibrationInputBundle({
      manifest,
      evidenceByMemberId,
      activeModel: activeRef,
      evaluationModel: evaluationRef,
      generatedAt,
      source: "persisted-export",
      mode: bundleMode,
    });

    const { hash, byteLength } = freezeBundleJson(bundle);
    const evidenceFingerprint = createHash("sha256")
      .update(
        [
          ...snapshotIds.slice().sort(),
          ...Object.keys(evidenceByMemberId).sort().map((id) => {
            const ev = evidenceByMemberId[id]!;
            return `${id}:${ev.snapshotId ?? ""}:${ev.inputFingerprint ?? ""}:${ev.observations?.length ?? 0}`;
          }),
        ].join("|"),
        "utf8",
      )
      .digest("hex");

    const initialProgress = emptyProgress(manifestMembers.length);
    initialProgress.members = manifestMembers.map((m) => ({
      memberId: m.id,
      characterName: m.character,
      realm: m.realm,
      region: m.region,
      status: "pending" as const,
      expectedRank: CALIBRATION_LABEL_TO_TIER[
        (
          {
            excellent: "EXCELLENT",
            good: "GOOD",
            average: "AVERAGE",
            weak: "WEAK",
            overrated: "OVERRATED",
          } as const
        )[m.expectedLabel]
      ],
      actualGrade: null,
      overallScore: null,
      error: null,
    }));
    initialProgress.updatedAt = new Date().toISOString();

    const runId = randomUUID();
    const run = await this.prisma().calibrationRun.create({
      data: {
        id: runId,
        cohortId: cohort.id,
        cohortRevision: cohort.revision,
        seasonId: cohort.seasonId,
        mode,
        status: "QUEUED",
        activeModelId: activeModel.id,
        evaluationModelId: evalModel.id,
        activeModelConfig: activeRef.config as unknown as Prisma.InputJsonValue,
        evaluationModelConfig: evaluationRef.config as unknown as Prisma.InputJsonValue,
        evidencePolicy: input.evidencePolicy,
        inputBundleSchemaVersion: CALIBRATION_INPUT_BUNDLE_SCHEMA_VERSION,
        inputBundleContentHash: hash,
        inputBundle: bundle as unknown as Prisma.InputJsonValue,
        inputBundleByteLength: byteLength,
        snapshotIds,
        evidenceFingerprint,
        deterministicSeed: input.deterministicSeed,
        algorithmVersions: {
          harness: productAcquire
            ? "acquireAndEvaluateCalibrationMember"
            : "runCalibrationHarnessFromBundle",
          digest: "1.0.0",
          mode: bundleMode,
          evidenceSource: productAcquire ? CALIBRATION_EVIDENCE_SOURCE_CANONICAL : "FROZEN_SNAPSHOT_BUNDLE",
          activeModelConfigHash: hashJson(activeRef.config),
          evaluationModelConfigHash: hashJson(evaluationRef.config),
          seasonSlug: season.slug,
          evidenceCutoffs,
          scoreModelId: evalModel.id,
        },
        progressJson: initialProgress as unknown as Prisma.InputJsonValue,
        createdByUserId,
      },
    });

    const enqueue = await this.container.producers.enqueueCalibrationRun({
      calibrationRunId: run.id,
      correlationId: null,
    });

    const updated = await this.prisma().calibrationRun.update({
      where: { id: run.id },
      data: { bullmqJobId: enqueue.jobId },
      include: {
        report: { select: { id: true } },
        evaluationModel: { select: { id: true, name: true, version: true, status: true } },
        activeModel: { select: { id: true, name: true, version: true, status: true } },
      },
    });

    await this.audit("admin.calibration.run.create", run.id, ctx, {
      cohortId,
      cohortRevision: cohort.revision,
      mode,
      contentHash: hash,
      byteLength,
      activeModelId: activeModel.id,
      evaluationModelId: evalModel.id,
      evidenceFingerprint,
    });

    return mapRun(updated);
  }

  async listRuns(cohortId?: string): Promise<{ runs: CalibrationRunDTO[] }> {
    assertEnabled(this.container);
    const runs = await this.prisma().calibrationRun.findMany({
      where: cohortId ? { cohortId } : undefined,
      orderBy: { createdAt: "desc" },
      include: {
        report: { select: { id: true, evaluatedCount: true, failedOrExcludedCount: true, summaryJson: true } },
        evaluationModel: { select: { id: true, name: true, version: true, status: true } },
        activeModel: { select: { id: true, name: true, version: true, status: true } },
      },
      take: 100,
    });
    return { runs: runs.map(mapRun) };
  }

  async getRun(runId: string): Promise<CalibrationRunDTO> {
    assertEnabled(this.container);
    const run = await this.prisma().calibrationRun.findUnique({
      where: { id: runId },
      include: {
        report: { select: { id: true, evaluatedCount: true, failedOrExcludedCount: true, summaryJson: true } },
        evaluationModel: { select: { id: true, name: true, version: true, status: true } },
        activeModel: { select: { id: true, name: true, version: true, status: true } },
      },
    });
    if (!run) {
      throw HttpError.notFound("CALIBRATION_RUN_NOT_FOUND", `Run ${runId} was not found`);
    }
    return mapRun(run);
  }

  async cancelRun(runId: string, ctx: AuditCtx): Promise<CalibrationRunDTO> {
    assertEnabled(this.container);
    const run = await this.prisma().calibrationRun.findUnique({
      where: { id: runId },
      include: { report: { select: { id: true } } },
    });
    if (!run) {
      throw HttpError.notFound("CALIBRATION_RUN_NOT_FOUND", `Run ${runId} was not found`);
    }
    if (run.status === "SUCCEEDED" || run.status === "CANCELLED" || run.status === "FAILED") {
      return mapRun(run);
    }

    if (run.status === "QUEUED") {
      const queue = this.container.producers.getCalibrationRunQueue?.() ?? null;
      if (queue && run.bullmqJobId) {
        try {
          const job = await queue.getJob(run.bullmqJobId);
          if (job) await job.remove();
        } catch {
          // Best-effort removal; DB status is authoritative.
        }
      }
      const updated = await this.prisma().calibrationRun.update({
        where: { id: runId },
        data: {
          status: "CANCELLED",
          cancelRequestedAt: new Date(),
          completedAt: new Date(),
          errorCode: "CANCELLED",
          errorMessage: "Cancelled while queued",
        },
        include: { report: { select: { id: true } } },
      });
      await this.audit("admin.calibration.run.cancel", runId, ctx, { fromStatus: "QUEUED" });
      return mapRun(updated);
    }

    const updated = await this.prisma().calibrationRun.update({
      where: { id: runId },
      data: { cancelRequestedAt: new Date() },
      include: { report: { select: { id: true } } },
    });
    await this.audit("admin.calibration.run.cancel", runId, ctx, { fromStatus: "RUNNING" });
    return mapRun(updated);
  }

  async getReport(runId: string): Promise<CalibrationReportDTO> {
    assertEnabled(this.container);
    const report = await this.prisma().calibrationReport.findUnique({ where: { runId } });
    if (!report) {
      throw HttpError.notFound("CALIBRATION_REPORT_NOT_FOUND", `No report for run ${runId}`);
    }
    return mapReport(report);
  }

  /** ACTIVE + DRAFT models for calibration selectors — never activates. */
  async listScoreModels(): Promise<{ models: AdminScoreModelDTO[] }> {
    assertEnabled(this.container);
    const models = await this.prisma().scoreModel.findMany({
      where: { status: { in: ["ACTIVE", "DRAFT"] } },
      orderBy: [{ status: "asc" }, { key: "asc" }, { version: "desc" }],
      take: 200,
    });
    return { models: models.map(mapAdminModel) };
  }

  /**
   * Create a new DRAFT ScoreModel from a source model + optional config.
   * Never mutates the source; never activates.
   */
  async createDraftScoreModel(
    body: unknown,
    createdByUserId: string,
    ctx: AuditCtx,
  ): Promise<AdminScoreModelDTO> {
    assertEnabled(this.container);
    const input = createCalibrationDraftModelBodySchema.parse(body);
    const source = await this.prisma().scoreModel.findUnique({ where: { id: input.sourceModelId } });
    if (!source) {
      throw HttpError.notFound("SCORE_MODEL_NOT_FOUND", `Source model ${input.sourceModelId} was not found`);
    }
    const sourceConfigSnapshot = JSON.stringify(source.config);
    const config = (input.config ?? source.config) as unknown as ScoreModelConfig;
    const created = await this.container.worker.repositories.score.createDraftModel({
      key: source.key,
      name: input.name ?? `${source.name} (calibration draft)`,
      description: input.description ?? source.description ?? "",
      config,
      createdByUserId,
    });

    // Prove source immutability after create.
    const sourceAfter = await this.prisma().scoreModel.findUniqueOrThrow({
      where: { id: source.id },
    });
    if (JSON.stringify(sourceAfter.config) !== sourceConfigSnapshot) {
      throw HttpError.internal("Source score model was mutated during draft creation — aborting");
    }
    if (sourceAfter.status !== source.status) {
      throw HttpError.internal("Source score model status changed during draft creation — aborting");
    }
    if (created.status !== "DRAFT") {
      throw HttpError.internal("Calibration draft create must yield status=DRAFT");
    }

    await this.audit("admin.calibration.score_model.create_draft", created.id, ctx, {
      sourceModelId: source.id,
      sourceKey: source.key,
      sourceVersion: source.version,
      draftVersion: created.version,
      configProvided: Boolean(input.config),
    });
    return mapAdminModel(created);
  }

  private async resolveModelsForMode(input: {
    mode: CalibrationRunMode;
    activeModelId?: string | null;
    evaluationModelId?: string | null;
    requireEvaluation: boolean;
  }): Promise<{ activeModel: ScoreModel | null; evaluationModel: ScoreModel | null }> {
    let activeModel: ScoreModel | null = null;
    if (input.activeModelId) {
      activeModel = await this.prisma().scoreModel.findUnique({ where: { id: input.activeModelId } });
      if (!activeModel) {
        throw HttpError.badRequest(
          "SCORE_MODEL_NOT_FOUND",
          `Active/reference model ${input.activeModelId} not found`,
        );
      }
    } else {
      activeModel = await this.prisma().scoreModel.findFirst({
        where: { status: "ACTIVE" },
        orderBy: { activatedAt: "desc" },
      });
    }

    if (input.mode === "ACTIVE_VERSUS_DRAFT" && activeModel && activeModel.status !== "ACTIVE") {
      throw HttpError.badRequest(
        "ACTIVE_MODEL_REQUIRED",
        `ACTIVE_VERSUS_DRAFT requires an ACTIVE reference model (got ${activeModel.status})`,
      );
    }

    let evaluationModel: ScoreModel | null = null;
    if (input.evaluationModelId) {
      evaluationModel = await this.prisma().scoreModel.findUnique({
        where: { id: input.evaluationModelId },
      });
      if (!evaluationModel) {
        throw HttpError.badRequest(
          "SCORE_MODEL_NOT_FOUND",
          `Evaluation model ${input.evaluationModelId} not found`,
        );
      }
    }

    if (input.requireEvaluation) {
      if (!evaluationModel) {
        throw HttpError.badRequest(
          "EVALUATION_MODEL_REQUIRED",
          `${input.mode} requires evaluationModelId pointing to a DRAFT model`,
        );
      }
      if (evaluationModel.status !== "DRAFT") {
        throw HttpError.badRequest(
          "EVALUATION_MODEL_NOT_DRAFT",
          `Evaluation model must be DRAFT (got ${evaluationModel.status})`,
        );
      }
      if (activeModel && evaluationModel.id === activeModel.id) {
        throw HttpError.badRequest(
          "EVALUATION_MODEL_SAME_AS_ACTIVE",
          "Evaluation draft must be distinct from the ACTIVE reference model",
        );
      }
    }

    return { activeModel, evaluationModel };
  }
}
