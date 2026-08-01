/**
 * Bounded Blizzard character-profile enrichment for calibration cohorts.
 *
 * SAFETY: This module may only call getCharacterProfile.
 * It must never import refresh producers, WCL, or Raider.IO clients.
 */
import { createBlizzardProvider } from "@mplus/provider-blizzard";
import type { CanonicalCharacter, CharacterIdentityInput } from "@mplus/contracts";
import type { BlizzardProfileEnrichment, CalibrationRole } from "./resolve-member.js";

export interface ProviderCallLedgerEntry {
  provider: "BLIZZARD";
  endpointClass: "character-profile";
  characterIdentity: string;
  requestedAt: string;
  completedAt: string;
  result: "ok" | "not_found" | "error" | "skipped-dedup" | "dry-run";
  retryCount: number;
  dbStateChanged: false;
  errorMessage?: string;
}

export interface BlizzardEnrichmentOptions {
  clientId: string;
  clientSecret: string;
  dryRun?: boolean;
  /** Max attempts per identity (bounded). */
  maxAttempts?: number;
  /** Delay between identities in ms (rate limit). */
  delayMs?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

function asRole(role: CanonicalCharacter["role"]): CalibrationRole | null {
  if (role === "DPS" || role === "TANK" || role === "HEALER") return role;
  return null;
}

function identityKey(identity: CharacterIdentityInput): string {
  return `${String(identity.region).toUpperCase()}|${identity.realmSlug.toLowerCase()}|${identity.name.toLowerCase()}`;
}

/**
 * Static safety gate: refuse if caller tries to enable forbidden modes.
 */
export function assertProfileOnlyEnrichmentSafety(flags: {
  allowLiveProviderCalls: boolean;
  enqueueRefresh?: boolean;
  callWcl?: boolean;
  callRaiderIo?: boolean;
  activateModel?: boolean;
}): void {
  if (!flags.allowLiveProviderCalls) {
    throw new Error("REFUSED: ALLOW_LIVE_PROVIDER_CALLS=true is required for live Blizzard enrichment");
  }
  if (flags.enqueueRefresh) {
    throw new Error("REFUSED: enrichment path must not enqueue refresh-character jobs");
  }
  if (flags.callWcl) {
    throw new Error("REFUSED: WCL calls are not authorized for metadata enrichment");
  }
  if (flags.callRaiderIo) {
    throw new Error("REFUSED: Raider.IO calls are not authorized for metadata enrichment");
  }
  if (flags.activateModel) {
    throw new Error("REFUSED: model activation is forbidden");
  }
}

export async function enrichIdentitiesWithBlizzardProfiles(
  identities: CharacterIdentityInput[],
  options: BlizzardEnrichmentOptions,
): Promise<{
  byIdentityKey: Map<string, BlizzardProfileEnrichment>;
  ledger: ProviderCallLedgerEntry[];
}> {
  assertProfileOnlyEnrichmentSafety({
    allowLiveProviderCalls: true,
    enqueueRefresh: false,
    callWcl: false,
    callRaiderIo: false,
    activateModel: false,
  });

  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 3, 5));
  const delayMs = Math.max(0, options.delayMs ?? 350);
  const dryRun = options.dryRun === true;

  const byIdentityKey = new Map<string, BlizzardProfileEnrichment>();
  const ledger: ProviderCallLedgerEntry[] = [];
  const seen = new Set<string>();

  const provider = dryRun
    ? null
    : createBlizzardProvider("live", {
        clientId: options.clientId,
        clientSecret: options.clientSecret,
      });

  // Fail closed if the live provider unexpectedly exposes refresh helpers we might misuse.
  if (provider) {
    const forbidden = ["enqueueRefresh", "getWarcraftLogs", "getRaiderIo"] as const;
    for (const key of forbidden) {
      if (key in (provider as object)) {
        throw new Error(`REFUSED: Blizzard provider unexpectedly exposes ${key}`);
      }
    }
    if (typeof provider.getCharacterProfile !== "function") {
      throw new Error("REFUSED: Blizzard provider missing getCharacterProfile");
    }
  }

  for (const identity of identities) {
    const key = identityKey(identity);
    const label = `${identity.region}/${identity.realmSlug}/${identity.name}`;
    if (seen.has(key)) {
      ledger.push({
        provider: "BLIZZARD",
        endpointClass: "character-profile",
        characterIdentity: label,
        requestedAt: now().toISOString(),
        completedAt: now().toISOString(),
        result: "skipped-dedup",
        retryCount: 0,
        dbStateChanged: false,
      });
      continue;
    }
    seen.add(key);

    if (dryRun) {
      ledger.push({
        provider: "BLIZZARD",
        endpointClass: "character-profile",
        characterIdentity: label,
        requestedAt: now().toISOString(),
        completedAt: now().toISOString(),
        result: "dry-run",
        retryCount: 0,
        dbStateChanged: false,
      });
      continue;
    }

    let retryCount = 0;
    let lastError: string | undefined;
    const requestedAt = now().toISOString();
    let succeeded = false;

    while (retryCount < maxAttempts && !succeeded) {
      try {
        const ctx = {
          region: identity.region,
          requestId: `calibration-enrich-${key}-${retryCount}`,
          correlationId: `agent11-calibration`,
          forceRefresh: true,
          now: now().toISOString(),
        };
        const result = await provider!.getCharacterProfile(identity, ctx);
        const profile = result.data;
        byIdentityKey.set(key, {
          blizzardCharacterId: profile.blizzardCharacterId,
          classSlug: profile.classSlug,
          specSlug: profile.specSlug,
          role: asRole(profile.role),
          level: profile.level ?? null,
          faction: profile.faction ?? null,
          displayName: profile.displayName,
          realmSlug: profile.realmSlug,
        });
        ledger.push({
          provider: "BLIZZARD",
          endpointClass: "character-profile",
          characterIdentity: label,
          requestedAt,
          completedAt: now().toISOString(),
          result: "ok",
          retryCount,
          dbStateChanged: false,
        });
        succeeded = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        lastError = message;
        const notFound = /NOT_FOUND|404/i.test(message);
        if (notFound) {
          ledger.push({
            provider: "BLIZZARD",
            endpointClass: "character-profile",
            characterIdentity: label,
            requestedAt,
            completedAt: now().toISOString(),
            result: "not_found",
            retryCount,
            dbStateChanged: false,
            errorMessage: message,
          });
          succeeded = true; // stop retrying
        } else {
          retryCount += 1;
          if (retryCount >= maxAttempts) {
            ledger.push({
              provider: "BLIZZARD",
              endpointClass: "character-profile",
              characterIdentity: label,
              requestedAt,
              completedAt: now().toISOString(),
              result: "error",
              retryCount,
              dbStateChanged: false,
              errorMessage: lastError,
            });
          } else {
            await sleep(delayMs * retryCount);
          }
        }
      }
    }

    if (delayMs > 0) await sleep(delayMs);
  }

  return { byIdentityKey, ledger };
}

export function blizzardCacheKey(region: string, realm: string, character: string): string {
  return `${region.toUpperCase()}|${realm.toLowerCase()}|${character.toLowerCase()}`;
}
