/**
 * Optional live smoke — run only when credentials are present.
 * Usage: node --import tsx packages/providers/blizzard/src/smoke-live.ts
 * Never invoked by unit tests.
 */
import { createBlizzardProvider } from "./index.js";

async function main(): Promise<void> {
  const clientId = process.env.BLIZZARD_CLIENT_ID ?? "";
  const clientSecret = process.env.BLIZZARD_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) {
    console.log("SKIP live smoke: Blizzard credentials unavailable (fixture mode is default).");
    process.exit(0);
  }

  const provider = createBlizzardProvider("live", {
    clientId,
    clientSecret,
    defaultRegion: (process.env.BLIZZARD_DEFAULT_REGION as "eu") ?? "eu",
    defaultLocale: process.env.BLIZZARD_DEFAULT_LOCALE ?? "en_GB",
  });

  const ctx = {
    region: "EU" as const,
    requestId: "smoke-live",
    correlationId: null,
    forceRefresh: false,
    now: new Date().toISOString(),
  };

  const realmSlug = process.env.BLIZZARD_SMOKE_REALM ?? "tarren-mill";
  const name = process.env.BLIZZARD_SMOKE_CHARACTER ?? "Examplecharacter";

  const realm = await provider.getRealm(realmSlug, ctx);
  console.log("realm", realm.data.slug, realm.data.blizzardRealmId);

  try {
    const profile = await provider.getCharacterProfile({ region: "EU", realmSlug, name }, ctx);
    console.log("profile", profile.data.displayName, profile.data.blizzardCharacterId);
  } catch (error) {
    console.log("character smoke note:", error instanceof Error ? error.message : String(error));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
