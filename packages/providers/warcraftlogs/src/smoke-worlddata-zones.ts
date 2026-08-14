/**
 * ONE bounded live WorldData zones smoke — read-only metadata only.
 * Does not mutate DB. Does not run character event acquisition.
 *
 *   pnpm --filter @mplus/provider-warcraftlogs exec tsx --env-file ../../../.env src/smoke-worlddata-zones.ts
 */
import { LiveWarcraftLogsProvider } from "./live/live-provider.js";
import {
  parseWorldDataZonesPayload,
  selectActiveMythicPlusZone,
} from "./discovery/world-data-zones.js";
import { OPERATIONS } from "./operations/queries.js";

function envFlag(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

async function main(): Promise<void> {
  if (!envFlag(process.env.ALLOW_LIVE_PROVIDER_CALLS)) {
    console.error("LIVE WORLD DATA SMOKE NOT RUN — ALLOW_LIVE_PROVIDER_CALLS=false");
    process.exit(2);
  }
  const clientId = process.env.WCL_CLIENT_ID ?? "";
  const clientSecret = process.env.WCL_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) {
    console.error("LIVE WORLD DATA SMOKE NOT RUN — credentials unavailable");
    process.exit(2);
  }

  const provider = new LiveWarcraftLogsProvider({
    env: {
      WCL_CLIENT_ID: clientId,
      WCL_CLIENT_SECRET: clientSecret,
      WCL_PUBLIC_GRAPHQL_URL:
        process.env.WCL_PUBLIC_GRAPHQL_URL ?? "https://www.warcraftlogs.com/api/v2/client",
      WCL_TOKEN_URL: process.env.WCL_TOKEN_URL ?? "https://www.warcraftlogs.com/oauth/token",
      WCL_RATE_WARN_PERCENT: Number(process.env.WCL_RATE_WARN_PERCENT ?? 70),
      WCL_RATE_DEFER_PERCENT: Number(process.env.WCL_RATE_DEFER_PERCENT ?? 80),
      WCL_RATE_STOP_PERCENT: Number(process.env.WCL_RATE_STOP_PERCENT ?? 90),
      WCL_CHARACTER_TTL_SECONDS: Number(process.env.WCL_CHARACTER_TTL_SECONDS ?? 43_200),
    },
    processEnv: process.env,
  });

  const client = provider.getGraphQlClient();
  const result = await client.request({
    operationName: OPERATIONS.WorldDataZones.operationName,
    query: OPERATIONS.WorldDataZones.query,
    variables: {},
    region: "EU",
  });

  const zones = parseWorldDataZonesPayload(result.response.data);
  const selected = selectActiveMythicPlusZone(zones);

  const sample = zones.slice(0, 3).map((z) => ({
    id: z.id,
    name: z.name,
    frozen: z.frozen,
    expansion: z.expansion,
    encounterCount: z.encounters.length,
    encounterSample: z.encounters.slice(0, 2),
  }));

  console.log(
    JSON.stringify(
      {
        ok: true,
        zoneCount: zones.length,
        sample,
        selectionKind: selected.kind,
        selectedZone:
          selected.kind === "ok"
            ? {
                id: selected.zone.id,
                name: selected.zone.name,
                frozen: selected.zone.frozen,
                expansion: selected.zone.expansion,
                brackets: selected.zone.brackets,
                encounterCount: selected.zone.encounters.length,
                encounterSample: selected.zone.encounters.slice(0, 3),
              }
            : selected,
        costUnits: result.costUnits ?? null,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
