import type { MechanicRuleType } from "@mplus/database";
import type {
  ActivateScoreModelResponse,
  AdminScoreModelDTO,
  DeleteScoreModelResponse,
  Grade,
  JobStatusDTO,
  ScoreModelConfig,
} from "@mplus/contracts";
import {
  runCalibrationHarnessFromBundle,
  toAdminBacktestSummary,
  withTunableWeights,
  resolveTunableWeights,
  type ActiveDraftComparisonResult,
  type AdminBacktestSummaryV1,
  type ConfidenceCoveragePoint,
} from "@mplus/scoring";
import { requireEffectiveScoringSeasonRow, ScoreModelDraftInUseError } from "@mplus/worker";
import type { ApiContainer } from "../container.js";
import { HttpError } from "../errors.js";
import { mapAdminScoreModel, mapJobStatus, mapMechanicRule, type MechanicRuleDTO } from "../lib/mappers.js";
import { writeAuditEvent } from "../iam/audit.js";
import { buildPersistedCalibrationBundle } from "./calibration-export.js";

export interface CreateScoreModelInput {
  key: string;
  name: string;
  description?: string;
  config: ScoreModelConfig;
}

export interface ValidateScoreModelResult {
  valid: boolean;
  errors: string[];
}

/** Machine-readable reason when backtest cannot run active-versus-draft replay. */
export type BacktestDegradedReason =
  | "NO_PUBLIC_SNAPSHOTS"
  | "NO_REPLAYABLE_EVIDENCE"
  | "EVALUATION_NOT_DRAFT"
  | "NO_ACTIVE_MODEL";

export interface BacktestResultDTO extends AdminBacktestSummaryV1 {
  /** Absolute grade counts when available. */
  gradeCounts: Partial<Record<Grade, number>>;
  confidenceVersusCoverage: ConfidenceCoveragePoint[];
  activeDraftComparison: ActiveDraftComparisonResult | null;
  exportNotes: string[];
  source: "persisted-export";
  /**
   * Set only when the response is genuinely snapshot-only because persisted
   * evidence cannot support replay. Never used to hide harness/integration defects.
   */
  degradedReason?: BacktestDegradedReason | null;
  cohortId: string;
}

export interface MechanicRuleInput {
  seasonId: string;
  dungeonId: string;
  npcId?: number | null;
  spellId: number;
  ruleType: MechanicRuleType;
  severity: number;
  applicableRoles: Array<"DPS" | "TANK" | "HEALER">;
  responseSpellIds?: number[];
  notes?: string | null;
  source: string;
  version: string;
  active?: boolean;
}

export interface ActivateScoreModelOptions {
  characterId?: string;
  expectedPreviousActiveId?: string | null;
  confirm?: boolean;
  actorUserId?: string | null;
  actorType?: "user" | "admin_key" | "system";
  ip?: string | null;
  userAgent?: string | null;
}

export interface DeleteScoreModelOptions {
  actorUserId?: string | null;
  actorType?: "user" | "admin_key" | "system";
  ip?: string | null;
  userAgent?: string | null;
}

/** Keep Trust `weights` + `scoring` docs aligned with admin-tunable relative weights. */
function syncTunableWeightsOnConfig(config: ScoreModelConfig): ScoreModelConfig {
  const asRecord = config as ScoreModelConfig & Record<string, unknown>;
  if (asRecord.tunableWeights == null) {
    return config;
  }
  const { weights } = resolveTunableWeights(asRecord);
  return withTunableWeights(asRecord as never, weights) as unknown as ScoreModelConfig;
}

/** Admin-only score model / mechanic rule administration, and character recalculation triggers. */
export class AdminService {
  constructor(private readonly container: ApiContainer) {}

  private get repositories() {
    return this.container.worker.repositories;
  }

  async listScoreModels(): Promise<AdminScoreModelDTO[]> {
    const models = await this.repositories.score.listAllModels();
    return models.map(mapAdminScoreModel);
  }

  async listPublicScoreModels(): Promise<AdminScoreModelDTO[]> {
    const models = await this.repositories.score.listPublicModels();
    return models.map(mapAdminScoreModel);
  }

  async createScoreModel(input: CreateScoreModelInput): Promise<AdminScoreModelDTO> {
    const synced = syncTunableWeightsOnConfig(input.config);
    const errors = this.repositories.score.validateConfig(synced);
    if (errors.length > 0) {
      throw HttpError.badRequest("INVALID_SCORE_MODEL_CONFIG", "Score model config failed validation", { errors });
    }
    const model = await this.repositories.score.createDraftModel({ ...input, config: synced });
    return mapAdminScoreModel(model);
  }

  async cloneScoreModel(id: string): Promise<AdminScoreModelDTO> {
    const source = await this.repositories.score.getModelById(id);
    if (!source) {
      throw HttpError.notFound("SCORE_MODEL_NOT_FOUND", `Score model ${id} was not found`);
    }
    const model = await this.repositories.score.createDraftModel({
      key: source.key,
      name: `${source.name} (draft)`,
      description: source.description ?? "",
      config: source.config as unknown as ScoreModelConfig,
    });
    return mapAdminScoreModel(model);
  }

  async updateScoreModel(id: string, config: ScoreModelConfig): Promise<AdminScoreModelDTO> {
    const synced = syncTunableWeightsOnConfig(config);
    const errors = this.repositories.score.validateConfig(synced);
    if (errors.length > 0) {
      throw HttpError.badRequest("INVALID_SCORE_MODEL_CONFIG", "Score model config failed validation", { errors });
    }
    try {
      const model = await this.repositories.score.updateDraftConfig(id, synced);
      return mapAdminScoreModel(model);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("not found")) {
        throw HttpError.notFound("SCORE_MODEL_NOT_FOUND", message);
      }
      if (message.includes("DRAFT")) {
        throw HttpError.conflict("SCORE_MODEL_NOT_EDITABLE", message);
      }
      throw error;
    }
  }

  async validateScoreModel(id: string): Promise<ValidateScoreModelResult> {
    const model = await this.repositories.score.getModelById(id);
    if (!model) {
      throw HttpError.notFound("SCORE_MODEL_NOT_FOUND", `Score model ${id} was not found`);
    }
    const errors = this.repositories.score.validateConfig(model.config as unknown as ScoreModelConfig);
    return { valid: errors.length === 0, errors };
  }

  /**
   * Real cohort backtest via Agent 10 calibration harness.
   * Uses persisted public snapshots (+ observations when available). Never activates or calls providers.
   * Does not fall back from active-versus-draft to snapshot-only to hide harness defects.
   */
  async backtestScoreModel(
    id: string,
    opts: { characterIds?: string[] | null; limit?: number } = {},
  ): Promise<BacktestResultDTO> {
    const model = await this.repositories.score.getModelById(id);
    if (!model) {
      throw HttpError.notFound("SCORE_MODEL_NOT_FOUND", `Score model ${id} was not found`);
    }

    const configErrors = this.repositories.score.validateConfig(
      model.config as unknown as ScoreModelConfig,
    );
    if (configErrors.length > 0) {
      throw HttpError.badRequest(
        "SCORE_MODEL_INVALID",
        `Invalid score model configuration: ${configErrors.join("; ")}`,
      );
    }

    const activeModel =
      (await this.repositories.score.getActiveModel(model.key)) ??
      (await this.repositories.score.getActiveModel());

    const { bundle, mode, notes, degradedReason } = await buildPersistedCalibrationBundle(
      {
        prisma: this.container.worker.prisma,
        listObservations: (characterId, seasonId) =>
          this.repositories.metric.listForCharacter(characterId, seasonId),
      },
      {
        evaluationModel: model,
        activeModel: activeModel && activeModel.id !== model.id ? activeModel : activeModel,
        characterIds: opts.characterIds,
        limit: opts.limit,
      },
    );

    let report;
    try {
      ({ report } = runCalibrationHarnessFromBundle(bundle, {
        mode,
        evaluationModel: bundle.evaluationModel,
        activeModel: bundle.activeModel ?? null,
        calculatedAt: bundle.generatedAt,
        anonymize: true,
        bootstrapIterations: 50,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw HttpError.badRequest(
        "SCORE_MODEL_BACKTEST_FAILED",
        `Cohort backtest failed: ${message}`,
      );
    }

    const summary = toAdminBacktestSummary(model.id, report);
    return {
      ...summary,
      mode,
      note: [summary.note, ...notes].filter(Boolean).join(" "),
      confidenceVersusCoverage: report.statistics.confidenceVersusCoverage,
      activeDraftComparison: report.activeDraftComparison,
      exportNotes: notes,
      source: "persisted-export",
      degradedReason: mode === "persisted-snapshot-only" ? degradedReason : null,
      cohortId: report.cohortId,
    };
  }

  /**
   * Transactional draft activation: archive previous ACTIVE for the key and audit.
   * Existing character scores are not recalculated here; the new model is adopted on the next legitimate refresh.
   */
  async activateScoreModel(
    id: string,
    opts: ActivateScoreModelOptions = {},
  ): Promise<ActivateScoreModelResponse> {
    if (opts.confirm === false) {
      throw HttpError.badRequest(
        "ACTIVATION_NOT_CONFIRMED",
        "Explicit confirmation is required to activate a score model",
      );
    }

    const draft = await this.repositories.score.getModelById(id);
    if (!draft) {
      throw HttpError.notFound("SCORE_MODEL_NOT_FOUND", `Score model ${id} was not found`);
    }
    if (draft.status !== "DRAFT") {
      throw HttpError.conflict(
        "SCORE_MODEL_NOT_ACTIVATABLE",
        `Only DRAFT models can be activated (got ${draft.status})`,
      );
    }
    const configErrors = this.repositories.score.validateConfig(
      draft.config as unknown as ScoreModelConfig,
    );
    if (configErrors.length > 0) {
      throw HttpError.badRequest(
        "INVALID_SCORE_MODEL_CONFIG",
        "Invalid draft cannot be activated",
        { errors: configErrors },
      );
    }

    let activated;
    let previousActive;
    try {
      const result = await this.repositories.score.activateModel(id, {
        expectedPreviousActiveId: opts.expectedPreviousActiveId,
      });
      activated = result.model;
      previousActive = result.previousActive;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ACTIVE_MODEL_CONFLICT")) {
        throw HttpError.conflict("ACTIVE_MODEL_CONFLICT", message);
      }
      if (message.includes("Only DRAFT")) {
        throw HttpError.conflict("SCORE_MODEL_NOT_ACTIVATABLE", message);
      }
      if (message.includes("Invalid score model config")) {
        throw HttpError.badRequest("INVALID_SCORE_MODEL_CONFIG", message);
      }
      throw error;
    }

    await writeAuditEvent(this.container.worker.prisma, {
      userId: opts.actorUserId ?? null,
      actorType: opts.actorType ?? "system",
      action: "admin.score_models.activate",
      resourceType: "score_model",
      resourceId: activated.id,
      outcome: "SUCCESS",
      ip: opts.ip,
      userAgent: opts.userAgent,
      sessionSecret: this.container.env.SESSION_SECRET,
      metadata: {
        key: activated.key,
        version: activated.version,
        previousActiveId: previousActive?.id ?? null,
        previousActiveVersion: previousActive?.version ?? null,
      },
    });

    return {
      ...mapAdminScoreModel(activated),
      previousActiveId: previousActive?.id ?? null,
      previousActiveVersion: previousActive?.version ?? null,
      bulkOperationId: null,
      bulkEnqueueError: null,
    };
  }

  /**
   * Delete a DRAFT score model. Status is re-checked transactionally at delete time
   * (never trusts a stale client read). Never cascades: a draft referenced by durable
   * history (snapshots, batches, addon exports, ...) is rejected with safe counts.
   */
  async deleteScoreModel(
    id: string,
    opts: DeleteScoreModelOptions = {},
  ): Promise<DeleteScoreModelResponse> {
    let deleted;
    try {
      deleted = await this.repositories.score.deleteDraftModel(id);
    } catch (error) {
      if (error instanceof ScoreModelDraftInUseError) {
        throw HttpError.conflict("SCORE_MODEL_DRAFT_IN_USE", error.message, {
          counts: error.counts,
        });
      }
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("not found")) {
        throw HttpError.notFound("SCORE_MODEL_NOT_FOUND", message);
      }
      if (message.includes("Only DRAFT")) {
        throw HttpError.conflict("SCORE_MODEL_NOT_DELETABLE", message);
      }
      throw error;
    }

    await writeAuditEvent(this.container.worker.prisma, {
      userId: opts.actorUserId ?? null,
      actorType: opts.actorType ?? "system",
      action: "admin.score_models.delete",
      resourceType: "score_model",
      resourceId: deleted.id,
      outcome: "SUCCESS",
      ip: opts.ip,
      userAgent: opts.userAgent,
      sessionSecret: this.container.env.SESSION_SECRET,
      metadata: { key: deleted.key, version: deleted.version },
    });

    return {
      id: deleted.id,
      key: deleted.key,
      version: deleted.version,
      name: deleted.name,
      status: deleted.status,
    };
  }

  async recalculateCharacter(characterId: string): Promise<JobStatusDTO> {
    const character = await this.repositories.character.findById(characterId);
    if (!character) {
      throw HttpError.notFound("CHARACTER_NOT_FOUND", `Character ${characterId} was not found`);
    }
    const model = await this.repositories.score.getActiveModel();
    if (!model) {
      throw HttpError.internal("No active score model found in the database");
    }
    const season = await requireEffectiveScoringSeasonRow(
      this.container.worker.prisma,
      { regionId: character.regionId },
    );
    const enqueueResult = await this.container.producers.enqueueRecalculateScore({
      characterId: character.id,
      seasonId: season.id,
      scoreModelKey: model.key,
      scoreModelVersion: model.version,
    });
    const job = await this.repositories.job.findById(enqueueResult.jobId);
    if (!job) {
      throw HttpError.internal("Recalculate job could not be found after enqueue");
    }
    return mapJobStatus(job);
  }

  async listMechanicRules(filter?: { seasonId?: string; dungeonId?: string; active?: boolean }): Promise<MechanicRuleDTO[]> {
    const rules = await this.repositories.mechanicRule.list(filter);
    return rules.map(mapMechanicRule);
  }

  async getMechanicRule(id: string): Promise<MechanicRuleDTO> {
    const rule = await this.repositories.mechanicRule.findById(id);
    if (!rule) {
      throw HttpError.notFound("MECHANIC_RULE_NOT_FOUND", `Mechanic rule ${id} was not found`);
    }
    return mapMechanicRule(rule);
  }

  async createMechanicRule(input: MechanicRuleInput): Promise<MechanicRuleDTO> {
    const rule = await this.repositories.mechanicRule.create(input);
    return mapMechanicRule(rule);
  }

  async updateMechanicRule(id: string, patch: Partial<MechanicRuleInput>): Promise<MechanicRuleDTO> {
    const existing = await this.repositories.mechanicRule.findById(id);
    if (!existing) {
      throw HttpError.notFound("MECHANIC_RULE_NOT_FOUND", `Mechanic rule ${id} was not found`);
    }
    const rule = await this.repositories.mechanicRule.update(id, patch);
    return mapMechanicRule(rule);
  }

  async deleteMechanicRule(id: string): Promise<MechanicRuleDTO> {
    const existing = await this.repositories.mechanicRule.findById(id);
    if (!existing) {
      throw HttpError.notFound("MECHANIC_RULE_NOT_FOUND", `Mechanic rule ${id} was not found`);
    }
    const rule = await this.repositories.mechanicRule.deactivate(id);
    return mapMechanicRule(rule);
  }
}
