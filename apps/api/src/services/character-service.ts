import type { Character } from "@mplus/database";
import type {
  CharacterIdentityInput,
  CharacterProfileResponse,
  ProviderName,
  RefreshStatusResponse,
  ScoreSnapshotDTO,
  SearchCharacterResponse,
} from "@mplus/contracts";
import type { EnqueueResult } from "@mplus/worker";
import type { ApiContainer } from "../container.js";
import { HttpError } from "../errors.js";
import { cooldownSecondsRemaining, determineDetailedRefreshStatus, isFresh } from "../lib/freshness.js";
import {
  mapCharacterProfile,
  mapJobStatus,
  mapRunSummary,
  mapScoreSnapshot,
  type CharacterSourceAttribution,
  type RunSummaryDTO,
} from "../lib/mappers.js";
import { characterCacheKey } from "../lib/response-cache.js";

const ALL_PROVIDERS: ProviderName[] = ["blizzard", "raiderio", "warcraftlogs"];

export interface CharacterHistoryResponse {
  characterId: string;
  snapshots: ScoreSnapshotDTO[];
}

export interface GetProfileResult {
  statusCode: 200 | 202;
  body: CharacterProfileResponse;
}

export class CharacterService {
  constructor(private readonly container: ApiContainer) {}

  private get worker() {
    return this.container.worker;
  }

  private get repositories() {
    return this.container.worker.repositories;
  }

  private get freshnessTtlSeconds(): number {
    // Overall character-profile freshness window; individual providers expose their own TTLs.
    return this.container.env.BLIZZARD_CHARACTER_TTL_SECONDS;
  }

  private async findOrCreateCharacter(identity: CharacterIdentityInput): Promise<Character> {
    const existing = await this.repositories.character.findByIdentity(identity);
    if (existing) return existing;
    return this.repositories.character.upsertCharacter(identity, { displayName: identity.name });
  }

  private async requireCharacter(identity: CharacterIdentityInput): Promise<Character> {
    if (this.container.negativeCache.has(identity)) {
      throw HttpError.notFound("CHARACTER_NOT_FOUND", "Character is confirmed not found upstream");
    }
    const character = await this.repositories.character.findByIdentity(identity);
    if (!character) {
      throw HttpError.notFound("CHARACTER_NOT_FOUND", "Character has not been resolved yet");
    }
    return character;
  }

  private async enqueueRefresh(
    identity: CharacterIdentityInput,
    character: Character,
    forceRefresh = false,
  ): Promise<EnqueueResult> {
    this.container.responseCache.invalidate(characterCacheKey(identity));
    return this.container.producers.enqueueRefreshCharacter({
      characterId: character.id,
      region: identity.region,
      realmSlug: identity.realmSlug,
      name: identity.name,
      priority: "normal",
      forceRefresh,
    });
  }

  private buildSources(character: Character): CharacterSourceAttribution[] {
    const fetchedAt = (character.lastPublicRefreshAt ?? character.lastSeenAt)?.toISOString();
    if (!fetchedAt) return [];
    return ALL_PROVIDERS.filter((provider) => !this.worker.disabledProviders.has(provider)).map((provider) => ({
      provider,
      fetchedAt,
      url: provider === "raiderio" ? (character.raiderioProfileUrl ?? null) : null,
    }));
  }

  /** SWR profile read. 200 fresh/stale (background refresh enqueued when stale), 202 queued, 404 confirmed absent. */
  async getProfile(identity: CharacterIdentityInput): Promise<GetProfileResult> {
    if (this.container.negativeCache.has(identity)) {
      throw HttpError.notFound("CHARACTER_NOT_FOUND", "Character is confirmed not found upstream");
    }

    const cacheKey = characterCacheKey(identity);
    const cached = this.container.responseCache.get<GetProfileResult>(cacheKey);
    if (cached) return cached;

    const character = await this.findOrCreateCharacter(identity);
    const snapshot = await this.repositories.score.getLatestSnapshot(character.id);
    const fresh = isFresh(character.lastPublicRefreshAt, this.freshnessTtlSeconds);

    if (!snapshot) {
      await this.enqueueRefresh(identity, character);
      const body = mapCharacterProfile({
        character,
        identity,
        snapshot: null,
        latestRunId: null,
        highestRunId: null,
        sources: [],
        refreshStatus: "QUEUED",
      });
      return { statusCode: 202, body };
    }

    if (!fresh) {
      await this.enqueueRefresh(identity, character);
    }

    const [latestRun, highestRun] = await Promise.all([
      this.repositories.run.findLatestForCharacter(character.id),
      this.repositories.run.findHighestForCharacter(character.id),
    ]);

    const body = mapCharacterProfile({
      character,
      identity,
      snapshot,
      latestRunId: latestRun?.id ?? null,
      highestRunId: highestRun?.id ?? null,
      sources: this.buildSources(character),
      refreshStatus: fresh ? "FRESH" : "STALE",
    });
    const result: GetProfileResult = { statusCode: 200, body };
    if (fresh) {
      this.container.responseCache.set(cacheKey, result);
    }
    return result;
  }

  /** Lightweight identity lookup for search/autocomplete flows; same SWR semantics as `getProfile`. */
  async searchCharacter(identity: CharacterIdentityInput): Promise<SearchCharacterResponse> {
    if (this.container.negativeCache.has(identity)) {
      return { characterId: null, identity, refreshStatus: "NOT_FOUND", job: null, score: null };
    }

    const character = await this.findOrCreateCharacter(identity);
    const snapshot = await this.repositories.score.getLatestSnapshot(character.id);
    const fresh = isFresh(character.lastPublicRefreshAt, this.freshnessTtlSeconds);

    let refreshStatus: SearchCharacterResponse["refreshStatus"] = "FRESH";
    let jobId: string | null = null;
    if (!snapshot) {
      const enqueueResult = await this.enqueueRefresh(identity, character);
      jobId = enqueueResult.jobId;
      refreshStatus = "QUEUED";
    } else if (!fresh) {
      const enqueueResult = await this.enqueueRefresh(identity, character);
      jobId = enqueueResult.jobId;
      refreshStatus = "STALE";
    }

    const jobRow = jobId ? await this.repositories.job.findById(jobId) : null;
    return {
      characterId: character.id,
      identity,
      refreshStatus,
      job: jobRow ? mapJobStatus(jobRow) : null,
      score: snapshot ? mapScoreSnapshot(snapshot) : null,
    };
  }

  /** GET refresh-status: pure read, never enqueues, 404 for identities never resolved or negatively cached. */
  async getRefreshStatus(identity: CharacterIdentityInput): Promise<RefreshStatusResponse> {
    const character = await this.requireCharacter(identity);
    const [activeJob, snapshot] = await Promise.all([
      this.repositories.job.findActiveForCharacter(character.id),
      this.repositories.score.getLatestSnapshot(character.id),
    ]);
    const latestJob = activeJob ?? (await this.repositories.job.findLatestForCharacter(character.id));
    const fresh = isFresh(character.lastPublicRefreshAt, this.freshnessTtlSeconds);

    const refreshStatus = determineDetailedRefreshStatus({
      hasScore: Boolean(snapshot),
      fresh,
      activeJobStatus: activeJob ? (activeJob.status as "QUEUED" | "ACTIVE") : null,
      lastJobFailed: latestJob?.status === "FAILED",
    });

    return {
      characterId: character.id,
      refreshStatus,
      job: latestJob ? mapJobStatus(latestJob) : null,
      cooldownSecondsRemaining: cooldownSecondsRemaining(
        character.lastPublicRefreshAt,
        this.container.env.MANUAL_REFRESH_COOLDOWN_SECONDS,
      ),
    };
  }

  /**
   * POST refresh: dedupes onto any active job, otherwise enforces the manual cooldown (bypassed by
   * admin callers), then enqueues. Never throws for a busy/cooling-down character — the cooldown
   * state is communicated via `cooldownSecondsRemaining` in the 200 response.
   */
  async requestRefresh(identity: CharacterIdentityInput, opts: { isAdmin: boolean }): Promise<RefreshStatusResponse> {
    if (this.container.negativeCache.has(identity) && !opts.isAdmin) {
      throw HttpError.notFound("CHARACTER_NOT_FOUND", "Character is confirmed not found upstream");
    }
    if (opts.isAdmin) {
      this.container.negativeCache.clear(identity);
    }

    const character = await this.findOrCreateCharacter(identity);
    const activeJob = await this.repositories.job.findActiveForCharacter(character.id);
    if (activeJob) {
      return {
        characterId: character.id,
        refreshStatus: activeJob.status === "ACTIVE" ? "IN_PROGRESS" : "QUEUED",
        job: mapJobStatus(activeJob),
        cooldownSecondsRemaining: 0,
      };
    }

    const remaining = cooldownSecondsRemaining(
      character.lastPublicRefreshAt,
      this.container.env.MANUAL_REFRESH_COOLDOWN_SECONDS,
    );
    if (remaining > 0 && !opts.isAdmin) {
      const lastJob = await this.repositories.job.findLatestForCharacter(character.id);
      const snapshot = await this.repositories.score.getLatestSnapshot(character.id);
      return {
        characterId: character.id,
        refreshStatus: snapshot ? "STALE" : "QUEUED",
        job: lastJob ? mapJobStatus(lastJob) : null,
        cooldownSecondsRemaining: remaining,
      };
    }

    const enqueueResult = await this.enqueueRefresh(identity, character, opts.isAdmin);
    const job = await this.repositories.job.findById(enqueueResult.jobId);
    return {
      characterId: character.id,
      refreshStatus: job?.status === "COMPLETED" ? "FRESH" : "QUEUED",
      job: job ? mapJobStatus(job) : null,
      cooldownSecondsRemaining: 0,
    };
  }

  async getHistory(identity: CharacterIdentityInput, limit = 20): Promise<CharacterHistoryResponse> {
    const character = await this.requireCharacter(identity);
    const snapshots = await this.repositories.score.listHistory(character.id, limit);
    return { characterId: character.id, snapshots: snapshots.map(mapScoreSnapshot) };
  }

  async getRun(identity: CharacterIdentityInput, kind: "latest" | "highest"): Promise<RunSummaryDTO | null> {
    const character = await this.requireCharacter(identity);
    const run =
      kind === "highest"
        ? await this.repositories.run.findHighestForCharacter(character.id)
        : await this.repositories.run.findLatestForCharacter(character.id);
    return run ? mapRunSummary(run) : null;
  }

  async getLatestScore(identity: CharacterIdentityInput): Promise<ScoreSnapshotDTO> {
    const character = await this.requireCharacter(identity);
    const snapshot = await this.repositories.score.getLatestSnapshot(character.id);
    if (!snapshot) {
      throw HttpError.notFound("SCORE_NOT_FOUND", "No score has been calculated for this character yet");
    }
    return mapScoreSnapshot(snapshot);
  }
}
