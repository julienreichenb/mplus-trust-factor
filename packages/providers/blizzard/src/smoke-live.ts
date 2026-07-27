/**
 * Optional live smoke — run only when credentials are present.
 * Usage: pnpm --filter @mplus/provider-blizzard smoke:live
 * Never invoked by unit tests / CI.
 *
 * Allowlist via env:
 *   BLIZZARD_SMOKE_REGION (default EU)
 *   BLIZZARD_SMOKE_REALM (default tarren-mill)
 *   BLIZZARD_SMOKE_CHARACTER (required for a real character probe)
 */
import { createBlizzardProvider, redactSecrets } from "./index.js";
import type { LiveBlizzardProvider } from "./index.js";
import type { BlizzardRegionKey } from "./config.js";
import { normalizeRegion } from "@mplus/domain";

function redactedSummary(value: unknown): string {
  return JSON.stringify(redactSecrets(value), null, 2);
}

async function main(): Promise<void> {
  const clientId = process.env.BLIZZARD_CLIENT_ID ?? "";
  const clientSecret = process.env.BLIZZARD_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) {
    console.log("SKIP live smoke: Blizzard credentials unavailable (fixture mode is default).");
    process.exit(0);
  }

  const regionKey = (process.env.BLIZZARD_DEFAULT_REGION as BlizzardRegionKey | undefined) ?? "eu";
  const region = normalizeRegion(process.env.BLIZZARD_SMOKE_REGION ?? regionKey.toUpperCase());
  const realmSlug = process.env.BLIZZARD_SMOKE_REALM ?? "tarren-mill";
  const name = process.env.BLIZZARD_SMOKE_CHARACTER;
  if (!name) {
    console.error(
      "FAIL: set BLIZZARD_SMOKE_CHARACTER to an allowlisted exact character name before running live smoke.",
    );
    process.exit(1);
  }

  const provider = createBlizzardProvider("live", {
    clientId,
    clientSecret,
    defaultRegion: regionKey,
    defaultLocale: process.env.BLIZZARD_DEFAULT_LOCALE ?? "en_GB",
  }) as LiveBlizzardProvider;

  const ctx = {
    region,
    requestId: "smoke-live",
    correlationId: null,
    forceRefresh: true,
    now: new Date().toISOString(),
  };
  const identity = { region, realmSlug, name };

  const realm = await provider.getRealm(realmSlug, ctx);
  console.log("realm", redactedSummary({ slug: realm.data.slug, id: realm.data.blizzardRealmId }));

  const resolved = await provider.resolveCharacterIdentity(identity, ctx);
  console.log(
    "identity",
    redactedSummary({
      displayName: resolved.result.data.displayName,
      blizzardCharacterId: resolved.result.data.blizzardCharacterId,
      diagnostics: resolved.identityDiagnostics,
    }),
  );

  const [equipment, media, mplusIndex, current] = await Promise.all([
    provider.getEquipmentSnapshot(identity, ctx),
    provider.getCharacterMedia(identity, ctx),
    provider.getMythicKeystoneProfile(identity, ctx),
    provider.resolveCurrentSeasonPeriod(ctx),
  ]);

  if (!String(media.provenance.sourceUrl ?? "").includes("/character-media")) {
    console.error("FAIL: media sourceUrl must use /character-media path");
    process.exit(1);
  }

  const bestRuns = await provider.getCurrentSeasonBestRuns(identity, ctx);

  console.log(
    "summary",
    redactedSummary({
      equippedItemLevel: equipment.data.equippedItemLevel,
      avatarUrl: media.data.avatarUrl ? "[present]" : null,
      mediaPathOk: true,
      mythicRating: mplusIndex.data.currentMythicRating,
      currentSeasonId: current.data.seasonId,
      currentPeriodId: current.data.periodId,
      bestRunCount: bestRuns.data.runs.length,
      note: "best_runs are seasonal highlights, not full history",
    }),
  );
  console.log("OK blizzard live smoke");
}

main().catch((error) => {
  console.error(redactedSummary(error instanceof Error ? { message: error.message, name: error.name } : error));
  process.exit(1);
});
