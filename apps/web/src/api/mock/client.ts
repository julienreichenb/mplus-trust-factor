import type {
  AdminScoreModelDTO,
  CharacterComparisonRequest,
  CharacterComparisonResponse,
  CharacterIdentityInput,
  EditableModelConfig,
  ModelValidationResult,
  MplusApiClient,
  RefreshStatusResponse,
  RegionCode,
} from "../types";
import {
  EU_REALMS,
  allocateModelVersion,
  createJob,
  findFixture,
  getModelStore,
  identityKey,
  mockSession,
  setModelStore,
} from "./fixtures";
import { deepClone } from "../../lib/clone";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

export function validateModelConfig(config: unknown): ModelValidationResult {
  const errors: string[] = [];
  const cfg = config as EditableModelConfig | null;
  if (!cfg || typeof cfg !== "object" || !cfg.weights) {
    return { valid: false, errors: ["Config is missing weights"], weightSum: 0 };
  }

  const { performance, survival, utility, experienceConsistency, mythicRaid } = cfg.weights;
  const weightSum =
    Number(performance) +
    Number(survival) +
    Number(utility) +
    Number(experienceConsistency) +
    Number(mythicRaid);

  if (Math.abs(weightSum - 1) > 0.001) {
    errors.push(`Dimension weights must sum to 1 (got ${weightSum.toFixed(4)})`);
  }

  const t = cfg.gradeThresholds;
  if (!t) {
    errors.push("Grade thresholds are required");
  } else if (!(t.S >= t.A && t.A >= t.B && t.B >= t.C)) {
    errors.push("Grade thresholds must be ordered S ≥ A ≥ B ≥ C");
  }

  if (cfg.nestedMetricWeights) {
    for (const [dim, weights] of Object.entries(cfg.nestedMetricWeights)) {
      const sum = Object.values(weights).reduce((a, b) => a + Number(b), 0);
      if (Object.keys(weights).length > 0 && Math.abs(sum - 1) > 0.001) {
        errors.push(`Nested weights for ${dim} must sum to 1 (got ${sum.toFixed(4)})`);
      }
    }
  }

  if (cfg.boostThresholds) {
    if (cfg.boostThresholds.suspicionSoft > cfg.boostThresholds.suspicionHard) {
      errors.push("Boost soft threshold must be ≤ hard threshold");
    }
  }

  return { valid: errors.length === 0, errors, weightSum };
}

export function createMockApiClient(): MplusApiClient {
  return {
    async getMeta(signal) {
      await delay(20);
      assertNotAborted(signal);
      return {
        name: "M+ Trust Factor",
        version: "0.1.0",
        environment: "fixture",
        providerMode: "fixture",
        activeScoreModel: { key: "default", version: 1 },
      };
    },

    async searchRealms(region: RegionCode, query: string, signal) {
      await delay(40);
      assertNotAborted(signal);
      if (String(region).toUpperCase() !== "EU") {
        return [];
      }
      const q = query.trim().toLowerCase();
      if (!q) return [...EU_REALMS].slice(0, 8);
      return EU_REALMS.filter(
        (r) => r.slug.includes(q) || r.name.toLowerCase().includes(q),
      ).slice(0, 20);
    },

    async getCharacterProfile(identity, signal) {
      await delay(80);
      assertNotAborted(signal);
      const fixture = findFixture(identity);
      if (!fixture) {
        const err = new Error("Character not found") as Error & { code?: string; status?: number };
        err.code = "CHARACTER_NOT_FOUND";
        err.status = 404;
        throw err;
      }

      const profile = deepClone(fixture.profile);
      if (fixture.simulateQueuedRefresh) {
        const polls = mockSession.refreshPolls.get(fixture.profile.characterId) ?? 0;
        if (polls < 2) {
          profile.refreshStatus = "QUEUED";
        } else {
          profile.refreshStatus = "FRESH";
        }
      }
      return profile;
    },

    async refreshCharacter(identity, signal) {
      await delay(40);
      assertNotAborted(signal);
      const fixture = findFixture(identity);
      if (!fixture) {
        const err = new Error("Character not found") as Error & { code?: string; status?: number };
        err.code = "CHARACTER_NOT_FOUND";
        err.status = 404;
        throw err;
      }
      mockSession.refreshPolls.set(fixture.profile.characterId, 0);
      return {
        characterId: fixture.profile.characterId,
        refreshStatus: "QUEUED",
        job: createJob("queued", fixture.profile.characterId),
        cooldownSecondsRemaining: 0,
      } satisfies RefreshStatusResponse;
    },

    async getRefreshStatus(identity, signal) {
      await delay(30);
      assertNotAborted(signal);
      const fixture = findFixture(identity);
      const characterId = fixture?.profile.characterId ?? "unknown";
      const polls = (mockSession.refreshPolls.get(characterId) ?? 0) + 1;
      mockSession.refreshPolls.set(characterId, polls);
      if (polls < 2) {
        return {
          characterId,
          refreshStatus: "IN_PROGRESS",
          job: createJob("active", characterId),
          cooldownSecondsRemaining: 0,
        };
      }
      return {
        characterId,
        refreshStatus: "FRESH",
        job: createJob("completed", characterId),
        cooldownSecondsRemaining: 900,
      };
    },

    async compareCharacters(request: CharacterComparisonRequest, signal) {
      await delay(100);
      assertNotAborted(signal);
      if (request.characters.length < 2 || request.characters.length > 10) {
        const err = new Error("Comparison requires 2–10 characters") as Error & { code?: string };
        err.code = "VALIDATION_ERROR";
        throw err;
      }

      const entries = request.characters.map((identity) => {
        const fixture = findFixture(identity);
        const score = fixture?.profile.score ?? null;
        return {
          identity,
          characterId: fixture?.profile.characterId ?? null,
          overallScore: score?.overallScore ?? null,
          grade: score?.grade ?? null,
          confidence: score?.confidence ?? null,
          dimensions: score?.dimensions ?? null,
          authenticityScore: score?.authenticityScore ?? null,
          redFlags: score?.redFlags ?? [],
          modelKey: score?.modelKey ?? null,
          modelVersion: score?.modelVersion ?? null,
          seasonSlug: score?.seasonSlug ?? null,
        };
      });

      const scores = entries
        .map((e) => e.overallScore)
        .filter((s): s is number => s !== null);
      const median =
        scores.length === 0
          ? null
          : [...scores].sort((a, b) => a - b)[Math.floor((scores.length - 1) / 2)] ?? null;
      const best = scores.length === 0 ? null : Math.max(...scores);

      const modelKeys = new Set(entries.map((e) => e.modelKey).filter(Boolean));
      const seasons = new Set(entries.map((e) => e.seasonSlug).filter(Boolean));
      const compatible = modelKeys.size <= 1 && seasons.size <= 1;

      const response: CharacterComparisonResponse & {
        compatible: boolean;
        incompatibilityReason: string | null;
        entries: Array<
          CharacterComparisonResponse["entries"][number] & {
            authenticityScore: number | null;
            redFlags: typeof entries[number]["redFlags"];
          }
        >;
      } = {
        modelKey: request.modelKey ?? "default",
        modelVersion: request.modelVersion ?? 1,
        seasonSlug: request.seasonSlug ?? "season-tww-3",
        calculatedAt: "2026-07-20T12:00:00.000Z",
        compatible,
        incompatibilityReason: compatible
          ? null
          : "Candidates span different model versions or seasons — comparison may be misleading.",
        entries: entries.map((e) => {
          const dimDeltasMedian: Record<string, number | null> = {};
          const dimDeltasBest: Record<string, number | null> = {};
          for (const d of e.dimensions ?? []) {
            const peers = entries
              .map((x) => x.dimensions?.find((dd) => dd.dimension === d.dimension)?.score)
              .filter((s): s is number => s !== undefined && s !== null);
            const dimMedian =
              peers.length === 0
                ? null
                : [...peers].sort((a, b) => a - b)[Math.floor((peers.length - 1) / 2)] ?? null;
            const dimBest = peers.length === 0 ? null : Math.max(...peers);
            dimDeltasMedian[d.dimension] =
              dimMedian === null ? null : Number((d.score - dimMedian).toFixed(1));
            dimDeltasBest[d.dimension] =
              dimBest === null ? null : Number((d.score - dimBest).toFixed(1));
          }
          return {
            identity: e.identity,
            characterId: e.characterId,
            overallScore: e.overallScore,
            grade: e.grade,
            confidence: e.confidence,
            dimensions: e.dimensions,
            authenticityScore: e.authenticityScore,
            redFlags: e.redFlags,
            deltasFromMedian: {
              overall:
                e.overallScore === null || median === null
                  ? null
                  : Number((e.overallScore - median).toFixed(1)),
              ...dimDeltasMedian,
            },
            deltasFromBest: {
              overall:
                e.overallScore === null || best === null
                  ? null
                  : Number((e.overallScore - best).toFixed(1)),
              ...dimDeltasBest,
            },
          };
        }),
      };

      return response;
    },

    async listModels(signal) {
      await delay(30);
      assertNotAborted(signal);
      return deepClone(getModelStore());
    },

    async cloneModel(modelId, signal) {
      await delay(40);
      assertNotAborted(signal);
      const source = getModelStore().find((m) => m.id === modelId);
      if (!source) throw Object.assign(new Error("Model not found"), { status: 404 });
      const version = allocateModelVersion();
      const draft: AdminScoreModelDTO = {
        id: `model-draft-${version}`,
        key: source.key,
        version,
        name: `${source.name} (draft v${version})`,
        status: "DRAFT",
        config: deepClone(source.config),
        createdAt: new Date().toISOString(),
        activatedAt: null,
      };
      setModelStore([...getModelStore(), draft]);
      return deepClone(draft);
    },

    async updateModel(modelId, config, signal) {
      await delay(40);
      assertNotAborted(signal);
      const models = getModelStore();
      const idx = models.findIndex((m) => m.id === modelId);
      if (idx < 0) throw Object.assign(new Error("Model not found"), { status: 404 });
      const current = models[idx]!;
      if (current.status !== "DRAFT") {
        throw Object.assign(new Error("Only draft models can be edited"), { status: 400 });
      }
      const updated = { ...current, config };
      const next = [...models];
      next[idx] = updated;
      setModelStore(next);
      return deepClone(updated);
    },

    async validateModel(_modelId, config, signal) {
      await delay(20);
      assertNotAborted(signal);
      return validateModelConfig(config);
    },

    async backtestModel(modelId, signal) {
      await delay(60);
      assertNotAborted(signal);
      const model = getModelStore().find((m) => m.id === modelId);
      if (!model) throw Object.assign(new Error("Model not found"), { status: 404 });
      return {
        cohortSize: 24,
        meanOverall: 61.4,
        gradeDistribution: { S: 1, A: 4, B: 9, C: 7, D: 3 },
        notes: "Fixture backtest on sanitized cohort — not production data.",
      };
    },

    async activateModel(modelId, signal) {
      await delay(50);
      assertNotAborted(signal);
      const models = getModelStore();
      const target = models.find((m) => m.id === modelId);
      if (!target) throw Object.assign(new Error("Model not found"), { status: 404 });
      if (target.status !== "DRAFT") {
        throw Object.assign(new Error("Only draft models can be activated"), { status: 400 });
      }
      const validation = validateModelConfig(target.config);
      if (!validation.valid) {
        throw Object.assign(new Error(`Invalid model: ${validation.errors.join("; ")}`), {
          status: 400,
          code: "INVALID_MODEL",
        });
      }
      const next = models.map((m) => {
        if (m.id === modelId) {
          return {
            ...m,
            status: "ACTIVE" as const,
            activatedAt: new Date().toISOString(),
          };
        }
        if (m.status === "ACTIVE" && m.key === target.key) {
          return { ...m, status: "ARCHIVED" as const };
        }
        return m;
      });
      setModelStore(next);
      return deepClone(next.find((m) => m.id === modelId)!);
    },
  };
}

export function normalizeIdentity(identity: CharacterIdentityInput): CharacterIdentityInput {
  return {
    region: identity.region.toUpperCase(),
    realmSlug: identity.realmSlug.trim().toLowerCase(),
    name: identity.name.trim(),
  };
}

export { identityKey };
