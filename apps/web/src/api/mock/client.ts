import { queryAdminAbilityCatalog } from "@mplus/abilities";
import { normalizeRealmOptions } from "../realm-options";
import {
  createFaqEntryRequestSchema,
  firstZodIssueMessage,
  moveFaqEntryRequestSchema,
  updateFaqEntryRequestSchema,
} from "@mplus/contracts";
import type {
  AdminAbilityCatalogResponse,
  AdminFaqEntryDTO,
  AdminScoreModelDTO,
  CharacterAutocompleteSuggestion,
  CharacterComparisonRequest,
  CharacterComparisonResponse,
  CharacterIdentityInput,
  CharacterResolveRequest,
  CharacterResolveResponse,
  ModelValidationResult,
  MplusApiClient,
  RefreshStatusResponse,
  RegionCode,
} from "../types";
import { validateModelConfig as validatePersistedOrFormConfig } from "../model-config";
import {
  EU_REALMS,
  FIXTURE_CHARACTERS,
  allocateModelVersion,
  createJob,
  findFixture,
  getModelStore,
  identityKey,
  mockSession,
  mockFaqEntries,
  createDynamicQueuedProfile,
  finalizeDynamicProfile,
  setModelStore,
} from "./fixtures";
import { deepClone } from "../../lib/clone";
import { formatRealmDisplayName } from "../realm-options";
import { classIconUrl } from "../../lib/wowClass";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

function mapAbilityCatalogParams(
  params?: Record<string, string | number | undefined>,
): Parameters<typeof queryAdminAbilityCatalog>[0] {
  if (!params) return {};
  const str = (key: string) => {
    const v = params[key];
    return typeof v === "string" && v.length > 0 ? v : undefined;
  };
  const num = (key: string) => {
    const v = params[key];
    if (v === undefined || v === "") return undefined;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    query: str("query"),
    classSlug: str("classSlug"),
    specSlug: str("specSlug"),
    role: str("role") as "DPS" | "TANK" | "HEALER" | undefined,
    category: str("category") as never,
    ownership: str("ownership") as never,
    availability: str("availability") as never,
    version: str("version"),
    validationState: str("validationState") as never,
    page: num("page"),
    limit: num("limit"),
  };
}

function sortFaq<T extends { position: number; createdAt?: string; id: string }>(a: T, b: T): number {
  if (a.position !== b.position) return a.position - b.position;
  const created = (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
  if (created !== 0) return created;
  return a.id.localeCompare(b.id);
}

export function validateModelConfig(config: unknown): ModelValidationResult {
  return validatePersistedOrFormConfig(config);
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

    async searchRealms(region: RegionCode | null | undefined, query: string, signal, limit = 25) {
      await delay(40);
      assertNotAborted(signal);
      const regionFilter = region ? String(region).toUpperCase() : null;
      if (regionFilter && regionFilter !== "EU") {
        return [];
      }
      const q = query.trim().toLowerCase();
      const folded = q.normalize("NFKD").replace(/\p{M}/gu, "");
      const filtered = EU_REALMS.filter((r) => {
        if (!q) return true;
        return (
          r.slug.includes(q) ||
          r.name.toLowerCase().includes(q) ||
          r.name
            .normalize("NFKD")
            .replace(/\p{M}/gu, "")
            .toLowerCase()
            .includes(folded)
        );
      }).slice(0, limit);
      return normalizeRealmOptions([...filtered]);
    },

    async resolveCharacter(
      request: CharacterResolveRequest,
      signal,
    ): Promise<CharacterResolveResponse> {
      await delay(60);
      assertNotAborted(signal);
      const identity = {
        region: String(request.region).toUpperCase() as RegionCode,
        realmSlug: request.realmSlug.toLowerCase(),
        name: request.name.trim(),
      };
      const profilePath = `/character/${identity.region}/${identity.realmSlug}/${encodeURIComponent(identity.name)}`;
      const lowered = identity.name.toLowerCase();
      if (lowered.includes("missing") || lowered.includes("notfound") || lowered === "nobodyhere") {
        return {
          status: "NOT_FOUND",
          message: `Character not found on this realm — ${identity.region}.`,
        };
      }
      if (lowered.includes("outage") || lowered.includes("unavailable")) {
        return {
          status: "PROVIDER_UNAVAILABLE",
          retryable: true,
          message: "Blizzard is temporarily unavailable. Please retry shortly.",
        };
      }
      const fixture = findFixture(identity);
      if (fixture && !fixture.simulateQueuedRefresh) {
        return { status: "READY", characterId: fixture.profile.characterId, profilePath };
      }
      if (fixture?.simulateQueuedRefresh) {
        const job = createJob("queued", fixture.profile.characterId);
        return {
          status: "QUEUED",
          characterId: fixture.profile.characterId,
          refreshId: job.jobId,
          profilePath,
          retryAfterMs: 500,
        };
      }
      const profile = createDynamicQueuedProfile(identity);
      mockSession.dynamicProfiles.set(identityKey(identity), profile);
      const job = createJob("queued", profile.characterId);
      return {
        status: "QUEUED",
        characterId: profile.characterId,
        refreshId: job.jobId,
        profilePath,
        retryAfterMs: 500,
      };
    },

    async searchCharacters(region: RegionCode, query: string, signal) {
      await delay(40);
      assertNotAborted(signal);
      const q = query.trim().toLowerCase();
      if (q.length < 3 || String(region).toUpperCase() !== "EU") {
        return [];
      }

      const fromFixtures: CharacterAutocompleteSuggestion[] = FIXTURE_CHARACTERS.map((fixture) => ({
        name: fixture.identity.name,
        realmSlug: fixture.identity.realmSlug,
        realmName: formatRealmDisplayName(fixture.identity.realmSlug),
        region: fixture.identity.region as RegionCode,
        classSlug: fixture.profile.classSlug ?? null,
        specSlug: fixture.profile.specSlug ?? null,
        avatarUrl: fixture.profile.media?.avatarUrl ?? null,
        classIconUrl: classIconUrl(fixture.profile.classSlug),
        source: "character" as const,
        kind: "indexed" as const,
      }));

      const dash = q.indexOf("-");
      const space = q.search(/\s+/);
      let namePart = q;
      let realmPart: string | null = null;
      if (dash > 0) {
        namePart = q.slice(0, dash);
        realmPart = q.slice(dash + 1) || null;
      } else if (space > 0) {
        namePart = q.slice(0, space);
        realmPart = q.slice(space).trim() || null;
      }

      return fromFixtures
        .filter((entry) => {
          const haystack = `${entry.name}-${entry.realmSlug}`.toLowerCase();
          const nameMatch = entry.name.toLowerCase().includes(namePart) || haystack.includes(q);
          const realmMatch = !realmPart || entry.realmSlug.includes(realmPart);
          return nameMatch && realmMatch;
        })
        .slice(0, 3);
    },

    async getCharacterProfile(identity, signal) {
      await delay(80);
      assertNotAborted(signal);
      const fixture = findFixture(identity);
      if (fixture) {
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
      }

      // Unknown Character-Realm: simulate live ingest (202 QUEUED → FRESH after polls).
      const key = identityKey(identity);
      let profile = mockSession.dynamicProfiles.get(key);
      if (!profile) {
        profile = createDynamicQueuedProfile(identity);
        mockSession.dynamicProfiles.set(key, profile);
        mockSession.refreshPolls.set(profile.characterId, 0);
      }
      const polls = mockSession.refreshPolls.get(profile.characterId) ?? 0;
      if (polls >= 2) {
        const fresh = finalizeDynamicProfile(profile);
        mockSession.dynamicProfiles.set(key, fresh);
        return deepClone(fresh);
      }
      return deepClone({ ...profile, refreshStatus: "QUEUED" as const });
    },

    async refreshCharacter(identity, signal, _opts) {
      await delay(40);
      assertNotAborted(signal);
      const fixture = findFixture(identity);
      if (fixture) {
        mockSession.refreshPolls.set(fixture.profile.characterId, 0);
        return {
          characterId: fixture.profile.characterId,
          refreshStatus: "QUEUED",
          job: createJob("queued", fixture.profile.characterId),
          cooldownSecondsRemaining: 0,
        } satisfies RefreshStatusResponse;
      }
      const key = identityKey(identity);
      let profile = mockSession.dynamicProfiles.get(key);
      if (!profile) {
        profile = createDynamicQueuedProfile(identity);
        mockSession.dynamicProfiles.set(key, profile);
      }
      mockSession.refreshPolls.set(profile.characterId, 0);
      return {
        characterId: profile.characterId,
        refreshStatus: "QUEUED",
        job: createJob("queued", profile.characterId),
        cooldownSecondsRemaining: 0,
      } satisfies RefreshStatusResponse;
    },

    async getRefreshStatus(identity, signal) {
      await delay(30);
      assertNotAborted(signal);
      const fixture = findFixture(identity);
      const dynamic = mockSession.dynamicProfiles.get(identityKey(identity));
      const characterId = fixture?.profile.characterId ?? dynamic?.characterId ?? "unknown";
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
              dimMedian === null || d.score == null
                ? null
                : Number((d.score - dimMedian).toFixed(1));
            dimDeltasBest[d.dimension] =
              dimBest === null || d.score == null
                ? null
                : Number((d.score - dimBest).toFixed(1));
          }
          return {
            identity: e.identity,
            characterId: e.characterId,
            overallScore: e.overallScore,
            grade: e.grade,
            confidence: e.confidence,
            dimensions: e.dimensions,
            rankingEligibility: {
              eligible: e.overallScore != null && (request.modelVersion ?? 6) >= 6,
              scoreModelVersion: request.modelVersion ?? 6,
              utilityEligible:
                e.dimensions?.some(
                  (d) =>
                    d.dimension === "UTILITY" &&
                    d.score != null &&
                    (d.state === "AVAILABLE" || d.state === "PARTIAL"),
                ) ?? false,
              reasons: [],
            },
            rankingIncluded: e.overallScore != null,
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

    async listFaq(signal) {
      await delay(20);
      assertNotAborted(signal);
      return {
        entries: mockFaqEntries
          .filter((entry) => entry.isPublished)
          .sort(sortFaq)
          .map(({ id, title, description, position, embedType }) => ({
            id,
            title,
            description,
            position,
            embedType,
          })),
      };
    },

    async getPublishedScoringContext(signal) {
      await delay(20);
      assertNotAborted(signal);
      return {
        available: false,
        unavailableReason: "Current Meta context is temporarily unavailable.",
        scoringSeason: null,
        revision: null,
        meta: null,
        key: null,
      };
    },

    async listPublicScoreModels(signal) {
      await delay(20);
      assertNotAborted(signal);
      return deepClone(getModelStore().filter((model) => model.status === "ACTIVE"));
    },

    async listAdminFaq(signal) {
      await delay(20);
      assertNotAborted(signal);
      return { entries: [...mockFaqEntries].sort(sortFaq) };
    },

    async createFaq(input, signal) {
      await delay(20);
      assertNotAborted(signal);
      const parsed = createFaqEntryRequestSchema.safeParse(input);
      if (!parsed.success) {
        throw Object.assign(new Error(firstZodIssueMessage(parsed.error)), { code: "VALIDATION_ERROR" });
      }
      const now = new Date().toISOString();
      const maxPosition = mockFaqEntries.reduce((max, entry) => Math.max(max, entry.position), 0);
      const created: AdminFaqEntryDTO = {
        id: `faq-${mockFaqEntries.length + 1}-${Date.now()}`,
        title: parsed.data.title,
        description: parsed.data.description,
        position: parsed.data.position ?? maxPosition + 1,
        isPublished: parsed.data.isPublished ?? false,
        embedType: parsed.data.embedType ?? null,
        createdAt: now,
        updatedAt: now,
      };
      mockFaqEntries.push(created);
      return deepClone(created);
    },

    async updateFaq(id, input, signal) {
      await delay(20);
      assertNotAborted(signal);
      const parsed = updateFaqEntryRequestSchema.safeParse(input);
      if (!parsed.success) {
        throw Object.assign(new Error(firstZodIssueMessage(parsed.error)), { code: "VALIDATION_ERROR" });
      }
      const index = mockFaqEntries.findIndex((entry) => entry.id === id);
      if (index < 0) {
        throw Object.assign(new Error("FAQ entry was not found"), { code: "FAQ_NOT_FOUND" });
      }
      const current = mockFaqEntries[index]!;
      const updated: AdminFaqEntryDTO = {
        ...current,
        ...parsed.data,
        updatedAt: new Date().toISOString(),
      };
      mockFaqEntries[index] = updated;
      return deepClone(updated);
    },

    async moveFaq(id, input, signal) {
      await delay(20);
      assertNotAborted(signal);
      const parsed = moveFaqEntryRequestSchema.safeParse(input);
      if (!parsed.success) {
        throw Object.assign(new Error(firstZodIssueMessage(parsed.error)), { code: "VALIDATION_ERROR" });
      }
      const ordered = [...mockFaqEntries].sort(sortFaq);
      const index = ordered.findIndex((entry) => entry.id === id);
      if (index < 0) {
        throw Object.assign(new Error("FAQ entry was not found"), { code: "FAQ_NOT_FOUND" });
      }
      const swapWith = parsed.data.direction === "up" ? index - 1 : index + 1;
      if (swapWith >= 0 && swapWith < ordered.length) {
        const current = ordered[index]!;
        ordered[index] = ordered[swapWith]!;
        ordered[swapWith] = current;
        ordered.forEach((entry, position) => {
          entry.position = position + 1;
          entry.updatedAt = new Date().toISOString();
        });
        mockFaqEntries.splice(0, mockFaqEntries.length, ...ordered);
      }
      return deepClone(mockFaqEntries.find((entry) => entry.id === id)!);
    },

    async deleteFaq(id, signal) {
      await delay(20);
      assertNotAborted(signal);
      const index = mockFaqEntries.findIndex((entry) => entry.id === id);
      if (index < 0) {
        throw Object.assign(new Error("FAQ entry was not found"), { code: "FAQ_NOT_FOUND" });
      }
      mockFaqEntries.splice(index, 1);
      return { id };
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
        gradeDistribution: { S: 1, A: 4, B: 9, C: 7, D: 3, U: 0 },
        notes: "Fixture backtest on sanitized cohort — not production data.",
      };
    },

    async activateModel(modelId, opts) {
      await delay(50);
      assertNotAborted(opts?.signal);
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
      const previous = models.find((m) => m.status === "ACTIVE" && m.key === target.key) ?? null;
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
      const activated = deepClone(next.find((m) => m.id === modelId)!);
      return {
        ...activated,
        previousActiveId: previous?.id ?? null,
        previousActiveVersion: previous?.version ?? null,
        bulkOperationId: `mock-bulk-${modelId}`,
        bulkEnqueueError: null,
      };
    },

    async deleteModel(modelId, signal) {
      await delay(40);
      assertNotAborted(signal);
      const models = getModelStore();
      const target = models.find((m) => m.id === modelId);
      if (!target) throw Object.assign(new Error("Model not found"), { status: 404, code: "SCORE_MODEL_NOT_FOUND" });
      if (target.status !== "DRAFT") {
        throw Object.assign(
          new Error(`Only DRAFT models can be deleted (got ${target.status})`),
          { status: 409, code: "SCORE_MODEL_NOT_DELETABLE" },
        );
      }
      setModelStore(models.filter((m) => m.id !== modelId));
      return {
        id: target.id,
        key: target.key,
        version: target.version,
        name: target.name,
        status: target.status,
      };
    },

    async getAdminAbilityCatalog(params, signal) {
      await delay(40);
      assertNotAborted(signal);
      return queryAdminAbilityCatalog(mapAbilityCatalogParams(params)) as AdminAbilityCatalogResponse;
    },

    async syncRealmCatalog(input, signal) {
      await delay(40);
      assertNotAborted(signal);
      const regions = input?.regions?.length ? input.regions : (["EU"] as const);
      return {
        ok: true as const,
        results: regions.map((region) => ({
          region,
          indexEntries: 10,
          rejectedAtIndex: 0,
          detailCandidates: 10,
          detailsFetched: input?.forceDetails ? 10 : 0,
          eligible: 10,
          rejectedTournament: 0,
          rejectedInternal: 0,
          detailFailures: 0,
          retainedLastKnownGood: 0,
          newlyDeactivated: 0,
          activeCatalogCount: 10,
          rejectedSamples: [] as string[],
          upserted: 10,
          minimallyUpserted: 0,
          enriched: input?.forceDetails ? 10 : 0,
          enrichmentFailures: 0,
          skippedDetails: input?.forceDetails ? 0 : 10,
          errors: [] as string[],
        })),
      };
    },

    async listCalibrationCohorts(signal) {
      await delay(20);
      assertNotAborted(signal);
      return [];
    },
    async createCalibrationCohort(input, signal) {
      await delay(20);
      assertNotAborted(signal);
      return {
        id: "mock-cohort",
        name: input.name,
        description: input.description ?? "",
        seasonId: "mock-season",
        status: "DRAFT" as const,
        revision: 1,
        externalKey: null,
        createdByUserId: "mock-user",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        archivedAt: null,
        memberCount: 0,
        includedMemberCount: 0,
        members: [],
      };
    },
    async getCalibrationCohort(cohortId, signal) {
      await delay(20);
      assertNotAborted(signal);
      return {
        id: cohortId,
        name: "Mock cohort",
        description: "",
        seasonId: "mock-season",
        status: "DRAFT" as const,
        revision: 1,
        externalKey: null,
        createdByUserId: "mock-user",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        archivedAt: null,
        memberCount: 0,
        includedMemberCount: 0,
        members: [],
      };
    },
    async patchCalibrationCohort(cohortId, input, signal) {
      await delay(20);
      assertNotAborted(signal);
      const base = await this.getCalibrationCohort(cohortId, signal);
      return { ...base, name: input.name ?? base.name, description: input.description ?? base.description };
    },
    async deleteCalibrationCohort(cohortId, signal) {
      await delay(20);
      assertNotAborted(signal);
      return { id: cohortId };
    },
    async resolveCalibrationMember(cohortId, input, signal) {
      await delay(20);
      assertNotAborted(signal);
      return {
        id: "mock-member",
        cohortId,
        characterId: "mock-character",
        region: input.region,
        realmSlug: input.realmSlug,
        characterName: input.characterName,
        expectedLabel: "AVERAGE" as const,
        expectedRank: input.expectedRank,
        providedRole: "DPS" as const,
        classSlug: "mage",
        specSlug: "frost",
        evidenceCutoffAt: null,
        rationale: input.rationale ?? "Labeled by administrator",
        source: "USER_SELECTED" as const,
        included: true,
        exclusionCode: null,
        exclusionDetail: null,
        preflightSnapshot: {},
        externalMemberKey: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        resolveStatus: "READY",
      };
    },
    async patchCalibrationMember(cohortId, memberId, input, signal) {
      await delay(20);
      assertNotAborted(signal);
      return {
        id: memberId,
        cohortId,
        characterId: "mock-character",
        region: "EU",
        realmSlug: "archimonde",
        characterName: "Mock",
        expectedLabel: "AVERAGE" as const,
        expectedRank: input.expectedRank ?? "B",
        providedRole: "DPS" as const,
        classSlug: "mage",
        specSlug: "frost",
        evidenceCutoffAt: null,
        rationale: input.rationale ?? "Labeled by administrator",
        source: "USER_SELECTED" as const,
        included: true,
        exclusionCode: null,
        exclusionDetail: null,
        preflightSnapshot: {},
        externalMemberKey: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
    async deleteCalibrationMember(_cohortId, memberId, signal) {
      await delay(20);
      assertNotAborted(signal);
      return { id: memberId };
    },
    async createCalibrationRun(cohortId, input, signal) {
      await delay(20);
      assertNotAborted(signal);
      return {
        id: "mock-run",
        cohortId,
        cohortRevision: 1,
        seasonId: "mock-season",
        mode: "PERSISTED_SNAPSHOT_ONLY" as const,
        status: "QUEUED" as const,
        activeModelId: input.scoreModelId,
        evaluationModelId: input.scoreModelId,
        scoreModelId: input.scoreModelId,
        scoreModelName: "Mock",
        scoreModelVersion: 1,
        scoreModelStatus: "ACTIVE",
        evidencePolicy: "EXCLUDE_INVALID",
        inputBundleSchemaVersion: "1.0.0",
        inputBundleContentHash: "abc",
        inputBundleByteLength: 1,
        snapshotIds: [],
        evidenceFingerprint: null,
        deterministicSeed: 0,
        algorithmVersions: {},
        cancelRequestedAt: null,
        errorCode: null,
        errorMessage: null,
        createdByUserId: "mock-user",
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        bullmqJobId: null,
        hasReport: false,
        progress: null,
        summaryExactMatches: null,
        summaryEvaluated: null,
        summaryFailed: null,
      };
    },
    async listCalibrationRuns(_cohortId, signal) {
      await delay(20);
      assertNotAborted(signal);
      return [];
    },
    async getCalibrationRun(runId, signal) {
      await delay(20);
      assertNotAborted(signal);
      return {
        id: runId,
        cohortId: "mock-cohort",
        cohortRevision: 1,
        seasonId: "mock-season",
        mode: "PERSISTED_SNAPSHOT_ONLY" as const,
        status: "SUCCEEDED" as const,
        activeModelId: null,
        evaluationModelId: null,
        scoreModelId: null,
        scoreModelName: null,
        scoreModelVersion: null,
        scoreModelStatus: null,
        evidencePolicy: "EXCLUDE_INVALID",
        inputBundleSchemaVersion: "1.0.0",
        inputBundleContentHash: "abc",
        inputBundleByteLength: 1,
        snapshotIds: [],
        evidenceFingerprint: null,
        deterministicSeed: 0,
        algorithmVersions: {},
        cancelRequestedAt: null,
        errorCode: null,
        errorMessage: null,
        createdByUserId: "mock-user",
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: new Date().toISOString(),
        bullmqJobId: null,
        hasReport: true,
        progress: null,
        summaryExactMatches: 0,
        summaryEvaluated: 0,
        summaryFailed: 0,
      };
    },
    async getCalibrationReport(runId, signal) {
      await delay(20);
      assertNotAborted(signal);
      return {
        id: "mock-report",
        runId,
        schemaVersion: "1.1.0",
        digestAlgorithmVersion: "1.0.0",
        recommendationAlgorithmVersion: null,
        summary: {},
        report: { characters: [] },
        digest: {
          headline: "Mock",
          overallAssessment: "INSUFFICIENT_EVIDENCE" as const,
          strengths: [],
          issues: [],
          limitations: [],
          nextActions: [],
          confidence: "LOW" as const,
          algorithmVersion: "1.0.0" as const,
        },
        limitations: [],
        cohortSize: 0,
        evaluatedCount: 0,
        failedOrExcludedCount: 0,
        spearman: null,
        pairwiseConcordance: null,
        meanScore: null,
        meanConfidence: null,
        outlierCount: 0,
        contentHash: "abc",
        generatedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
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
