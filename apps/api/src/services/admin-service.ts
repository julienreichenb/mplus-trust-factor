import type { MechanicRuleType } from "@mplus/database";
import type { AdminScoreModelDTO, Grade, JobStatusDTO, ScoreModelConfig } from "@mplus/contracts";
import { ensureCurrentSeason } from "@mplus/worker";
import type { ApiContainer } from "../container.js";
import { HttpError } from "../errors.js";
import { mapAdminScoreModel, mapJobStatus, mapMechanicRule, type MechanicRuleDTO } from "../lib/mappers.js";

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

export interface BacktestResultDTO {
  scoreModelId: string;
  sampleSize: number;
  gradeDistribution: Record<Grade, number>;
  meanScore: number;
  generatedAt: string;
  note: string;
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
    const errors = this.repositories.score.validateConfig(input.config);
    if (errors.length > 0) {
      throw HttpError.badRequest("INVALID_SCORE_MODEL_CONFIG", "Score model config failed validation", { errors });
    }
    const model = await this.repositories.score.createDraftModel(input);
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
    const errors = this.repositories.score.validateConfig(config);
    if (errors.length > 0) {
      throw HttpError.badRequest("INVALID_SCORE_MODEL_CONFIG", "Score model config failed validation", { errors });
    }
    try {
      const model = await this.repositories.score.updateDraftConfig(id, config);
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

  /** Fixture stub: full cohort backtesting is owned by Agent 4's scoring engine. */
  async backtestScoreModel(id: string): Promise<BacktestResultDTO> {
    const model = await this.repositories.score.getModelById(id);
    if (!model) {
      throw HttpError.notFound("SCORE_MODEL_NOT_FOUND", `Score model ${id} was not found`);
    }
    const sampleSize = await this.container.worker.prisma.scoreSnapshot.count();
    return {
      scoreModelId: model.id,
      sampleSize,
      gradeDistribution: { S: 0.05, A: 0.15, B: 0.35, C: 0.3, D: 0.15, U: 0 },
      meanScore: 62.5,
      generatedAt: new Date().toISOString(),
      note: "Fixture placeholder distribution — full backtest cohort analysis is owned by Agent 4 scoring.",
    };
  }

  async activateScoreModel(id: string, opts: { characterId?: string } = {}): Promise<AdminScoreModelDTO> {
    const activated = await this.repositories.score.activateModel(id);

    if (opts.characterId) {
      const character = await this.repositories.character.findById(opts.characterId);
      if (!character) {
        throw HttpError.notFound("CHARACTER_NOT_FOUND", `Character ${opts.characterId} was not found`);
      }
      const season = await ensureCurrentSeason(this.container.worker.prisma, character.regionId);
      await this.container.producers.enqueueRecalculateScore({
        characterId: character.id,
        seasonId: season.id,
        scoreModelKey: activated.key,
        scoreModelVersion: activated.version,
      });
    }

    return mapAdminScoreModel(activated);
  }

  async recalculateCharacter(characterId: string): Promise<JobStatusDTO> {
    const character = await this.repositories.character.findById(characterId);
    if (!character) {
      throw HttpError.notFound("CHARACTER_NOT_FOUND", `Character ${characterId} was not found`);
    }
    const model = await this.repositories.score.getActiveModel(this.container.env.ACTIVE_SCORE_MODEL_KEY);
    if (!model) {
      throw HttpError.internal(`No active score model found for key "${this.container.env.ACTIVE_SCORE_MODEL_KEY}"`);
    }
    const season = await ensureCurrentSeason(this.container.worker.prisma, character.regionId);
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
