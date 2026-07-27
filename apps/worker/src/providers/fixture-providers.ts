import { createHash } from "node:crypto";
import { computeRunFingerprint, normalizeName, normalizeRealmSlug, normalizeRegion } from "@mplus/domain";
import {
  ExternalApiError,
  type BlizzardProvider,
  type CanonicalCharacter,
  type CharacterIdentityInput,
  type CharacterSnapshotDTO,
  type DataFreshness,
  type MythicRunDTO,
  type ProviderFetchContext,
  type ProviderName,
  type ProviderRequestMetadata,
  type ProviderResult,
  type RaiderIoProvider,
  type RunParticipantDTO,
  type SourceProvenance,
  type WarcraftLogsProvider,
} from "@mplus/contracts";

const CLASS_SPECS: Array<{ classSlug: string; specSlug: string; role: "DPS" | "TANK" | "HEALER" }> = [
  { classSlug: "warrior", specSlug: "protection", role: "TANK" },
  { classSlug: "priest", specSlug: "holy", role: "HEALER" },
  { classSlug: "mage", specSlug: "frost", role: "DPS" },
  { classSlug: "rogue", specSlug: "subtlety", role: "DPS" },
  { classSlug: "druid", specSlug: "restoration", role: "HEALER" },
];

const DUNGEON_SLUGS = ["ara-kara", "city-of-threads", "grim-batol", "mists-of-tirna-scithe"];

/** Deterministic pseudo-random value in [0, 1) derived from a stable seed string. */
function seededFraction(seed: string): number {
  const digest = createHash("sha256").update(seed, "utf8").digest();
  const int = digest.readUInt32BE(0);
  return int / 0xffffffff;
}

function seededInt(seed: string, min: number, max: number): number {
  return min + Math.floor(seededFraction(seed) * (max - min + 1));
}

function seededPick<T>(seed: string, values: readonly T[]): T {
  const index = seededInt(seed, 0, values.length - 1);
  const value = values[index];
  if (value === undefined) {
    throw new Error("seededPick: values array must be non-empty");
  }
  return value;
}

function identityKey(identity: CharacterIdentityInput): string {
  return [
    normalizeRegion(identity.region),
    normalizeRealmSlug(identity.realmSlug),
    normalizeName(identity.name),
  ].join("|");
}

function isNotFoundName(name: string): boolean {
  const lowered = name.toLocaleLowerCase("en-US");
  return lowered.includes("missing") || lowered.includes("notfound");
}

function isDisabledTestName(name: string): boolean {
  return name.toLocaleLowerCase("en-US").includes("disabled-test");
}

function assertFixtureAvailable(provider: ProviderName, identity: CharacterIdentityInput): void {
  if (isNotFoundName(identity.name)) {
    throw new ExternalApiError({
      message: `${provider} fixture: character "${identity.name}" not found`,
      code: "NOT_FOUND",
      provider,
      retryable: false,
      statusCode: 404,
    });
  }
  if (isDisabledTestName(identity.name)) {
    throw new ProviderDisabledError(provider, "fixture identity requested disabled simulation");
  }
}

/** Raised by fixture adapters (or the disabled-provider wrapper) to signal a soft-skip. */
export class ProviderDisabledError extends ExternalApiError {
  constructor(provider: ProviderName, reason = "provider disabled") {
    super({
      message: `${provider} provider disabled: ${reason}`,
      code: "CIRCUIT_OPEN",
      provider,
      retryable: false,
    });
    this.name = "ProviderDisabledError";
  }
}

/** Wraps a provider port so every call soft-skips with a ProviderDisabledError. */
export function createDisabledProvider<T extends { name: ProviderName }>(name: T["name"]): T {
  const target = { name } as Record<string, unknown>;
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(obj, prop) {
      if (prop === "name") return name;
      if (typeof prop !== "string") return undefined;
      return async () => {
        throw new ProviderDisabledError(name);
      };
    },
  };
  return new Proxy(target, handler) as unknown as T;
}

function buildMetadata(provider: ProviderName, endpointKey: string, now: string): ProviderRequestMetadata {
  return {
    provider,
    endpointKey,
    requestFingerprint: createHash("sha256").update(`${provider}|${endpointKey}|${now}`).digest("hex"),
    requestedAt: now,
    completedAt: now,
    statusCode: 200,
    cacheHit: false,
    retryCount: 0,
    costUnits: 1,
    etag: null,
    expiresAt: null,
  };
}

function buildProvenance(provider: ProviderName, now: string, schemaVersion = "fixture-v1"): SourceProvenance {
  return {
    provider,
    externalRequestId: null,
    sourcePayloadId: null,
    sourceUrl: null,
    fetchedAt: now,
    schemaVersion,
  };
}

function buildFreshness(now: string): DataFreshness {
  return { fetchedAt: now, expiresAt: null, stale: false };
}

export function createFixtureBlizzardProvider(): BlizzardProvider {
  return new FixtureBlizzardProvider();
}

class FixtureBlizzardProvider implements BlizzardProvider {
  readonly name = "blizzard" as const;

  async getCharacterProfile(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<CanonicalCharacter>> {
    assertFixtureAvailable("blizzard", identity);
    const key = identityKey(identity);
    const { classSlug, specSlug, role } = seededPick(key, CLASS_SPECS);

    const data: CanonicalCharacter = {
      id: createHash("sha256").update(`blizzard-character|${key}`).digest("hex").slice(0, 32),
      region: normalizeRegion(identity.region),
      realmSlug: normalizeRealmSlug(identity.realmSlug),
      normalizedName: normalizeName(identity.name),
      displayName: identity.name,
      classSlug,
      specSlug,
      role,
      blizzardCharacterId: String(seededInt(`${key}|blizzard-id`, 1_000_000, 9_999_999)),
      wclCanonicalId: null,
      raiderioProfileUrl: null,
      lastSeenAt: ctx.now,
      lastPublicRefreshAt: null,
    };

    return {
      data,
      provenance: buildProvenance("blizzard", ctx.now),
      freshness: buildFreshness(ctx.now),
      metadata: buildMetadata("blizzard", "getCharacterProfile", ctx.now),
    };
  }

  async getCharacterEquipment(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<CharacterSnapshotDTO>> {
    assertFixtureAvailable("blizzard", identity);
    const key = identityKey(identity);
    const { specSlug, role } = seededPick(key, CLASS_SPECS);
    const itemLevel = seededInt(`${key}|ilvl`, 610, 645);

    const data: CharacterSnapshotDTO = {
      id: createHash("sha256").update(`blizzard-snapshot|${key}|${ctx.now}`).digest("hex").slice(0, 32),
      characterId: "",
      capturedAt: ctx.now,
      itemLevelEquipped: itemLevel,
      activeSpecSlug: specSlug,
      role,
      mythicRating: null,
      sourcePayloadId: null,
    };

    return {
      data,
      provenance: buildProvenance("blizzard", ctx.now),
      freshness: buildFreshness(ctx.now),
      metadata: buildMetadata("blizzard", "getCharacterEquipment", ctx.now),
    };
  }

  async getMythicKeystoneProfile(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<unknown>> {
    assertFixtureAvailable("blizzard", identity);
    const key = identityKey(identity);
    const data = {
      currentSeasonScore: seededInt(`${key}|mplus-score`, 800, 3200),
      bestRuns: DUNGEON_SLUGS.slice(0, 2).map((dungeonSlug) => ({
        dungeonSlug,
        keyLevel: seededInt(`${key}|${dungeonSlug}|blizzard-keylevel`, 6, 14),
      })),
    };

    return {
      data,
      provenance: buildProvenance("blizzard", ctx.now),
      freshness: buildFreshness(ctx.now),
      metadata: buildMetadata("blizzard", "getMythicKeystoneProfile", ctx.now),
    };
  }
}

export function createFixtureWarcraftLogsProvider(): WarcraftLogsProvider {
  return new FixtureWarcraftLogsProvider();
}

class FixtureWarcraftLogsProvider implements WarcraftLogsProvider {
  readonly name = "warcraftlogs" as const;

  async discoverCharacterRuns(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<MythicRunDTO[]>> {
    assertFixtureAvailable("warcraftlogs", identity);
    const key = identityKey(identity);
    const region = normalizeRegion(identity.region);
    const runCount = seededInt(`${key}|run-count`, 1, 2);

    const runs: MythicRunDTO[] = Array.from({ length: runCount }, (_, index) => {
      const runSeed = `${key}|run-${index}`;
      const dungeonSlug = seededPick(runSeed, DUNGEON_SLUGS);
      const keyLevel = seededInt(`${runSeed}|keylevel`, 7, 16);
      const completedAt = new Date(
        Date.parse(ctx.now) - index * 86_400_000 - seededInt(`${runSeed}|age`, 0, 3_600_000),
      ).toISOString();
      const durationMs = seededInt(`${runSeed}|duration`, 1_500_000, 2_400_000);
      const timerMs = 1_800_000;

      const target: RunParticipantDTO = {
        providerCharacterKey: `wcl:${key}`,
        displayName: identity.name,
        realmSlug: normalizeRealmSlug(identity.realmSlug),
        region,
        classSlug: seededPick(runSeed, CLASS_SPECS).classSlug,
        specSlug: seededPick(runSeed, CLASS_SPECS).specSlug,
        role: seededPick(runSeed, CLASS_SPECS).role,
        itemLevel: seededInt(`${runSeed}|ilvl`, 610, 645),
        mythicRatingAtRun: seededInt(`${runSeed}|rating`, 800, 3200),
        isTargetCharacter: true,
        characterId: null,
      };

      const companions: RunParticipantDTO[] = Array.from({ length: 4 }, (_, slot) => {
        const companionSeed = `${runSeed}|companion-${slot}`;
        return {
          providerCharacterKey: `wcl:fixture-companion:${companionSeed}`,
          displayName: `FixtureAlly${slot + 1}`,
          realmSlug: normalizeRealmSlug(identity.realmSlug),
          region,
          classSlug: seededPick(companionSeed, CLASS_SPECS).classSlug,
          specSlug: seededPick(companionSeed, CLASS_SPECS).specSlug,
          role: seededPick(companionSeed, CLASS_SPECS).role,
          itemLevel: seededInt(`${companionSeed}|ilvl`, 605, 645),
          mythicRatingAtRun: seededInt(`${companionSeed}|rating`, 700, 3200),
          isTargetCharacter: false,
          characterId: null,
        };
      });

      const participants = [target, ...companions];
      const reportCode = createHash("sha256").update(`${runSeed}|report`).digest("hex").slice(0, 16);
      const fightId = seededInt(`${runSeed}|fight`, 1, 12);

      return {
        id: createHash("sha256").update(`wcl-run|${runSeed}`).digest("hex"),
        region,
        seasonSlug: "placeholder-current",
        dungeonSlug,
        keyLevel,
        completedAt,
        durationMs,
        timerMs,
        timed: durationMs <= timerMs,
        scoreValue: null,
        canonicalFingerprint: computeRunFingerprint({
          region,
          seasonKey: "placeholder-current",
          dungeonKey: dungeonSlug,
          completedAtMs: Date.parse(completedAt),
          keyLevel,
          durationMs,
          rosterCanonicalKeys: participants.map((p) => p.providerCharacterKey),
        }),
        affixes: [],
        participants,
        sources: [
          {
            provider: "WARCRAFT_LOGS",
            externalRunId: `${reportCode}-${fightId}`,
            externalUrl: `https://www.warcraftlogs.com/reports/${reportCode}#fight=${fightId}`,
            reportCode,
            fightId,
            revision: 1,
          },
        ],
      };
    });

    return {
      data: runs,
      provenance: buildProvenance("warcraftlogs", ctx.now),
      freshness: buildFreshness(ctx.now),
      metadata: buildMetadata("warcraftlogs", "discoverCharacterRuns", ctx.now),
    };
  }

  async getReportFightDetails(
    reportCode: string,
    fightId: number,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<unknown>> {
    const seed = `${reportCode}|${fightId}`;
    const data = {
      reportCode,
      fightId,
      deaths: seededInt(`${seed}|deaths`, 0, 3),
      avoidableDamageTakenPercentile: seededFraction(`${seed}|avoidable`),
      interruptsSucceeded: seededInt(`${seed}|interrupts-ok`, 0, 8),
      interruptsAssigned: seededInt(`${seed}|interrupts-assigned`, 0, 10),
      dispelsSucceeded: seededInt(`${seed}|dispels`, 0, 6),
      activeTimePercent: 0.85 + seededFraction(`${seed}|active`) * 0.14,
    };

    return {
      data,
      provenance: buildProvenance("warcraftlogs", ctx.now),
      freshness: buildFreshness(ctx.now),
      metadata: buildMetadata("warcraftlogs", "getReportFightDetails", ctx.now),
    };
  }
}

export function createFixtureRaiderIoProvider(): RaiderIoProvider {
  return new FixtureRaiderIoProvider();
}

class FixtureRaiderIoProvider implements RaiderIoProvider {
  readonly name = "raiderio" as const;

  async getCharacterProfile(
    identity: CharacterIdentityInput,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<unknown>> {
    assertFixtureAvailable("raiderio", identity);
    const key = identityKey(identity);
    const data = {
      profileUrl: `https://raider.io/characters/${normalizeRegion(identity.region).toLowerCase()}/${normalizeRealmSlug(
        identity.realmSlug,
      )}/${identity.name}`,
      mythicPlusScore: seededInt(`${key}|raiderio-score`, 800, 3200),
    };

    return {
      data,
      provenance: buildProvenance("raiderio", ctx.now),
      freshness: buildFreshness(ctx.now),
      metadata: buildMetadata("raiderio", "getCharacterProfile", ctx.now),
    };
  }

  async getSeasonCutoffs(
    region: string,
    seasonSlug: string,
    ctx: ProviderFetchContext,
  ): Promise<ProviderResult<unknown>> {
    const data = {
      region: normalizeRegion(region),
      seasonSlug,
      cutoffs: { p999: 3400, p99: 2800, p90: 2200, p75: 1600, p50: 1000 },
    };

    return {
      data,
      provenance: buildProvenance("raiderio", ctx.now),
      freshness: buildFreshness(ctx.now),
      metadata: buildMetadata("raiderio", "getSeasonCutoffs", ctx.now),
    };
  }
}
