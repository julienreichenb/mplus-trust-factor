#!/usr/bin/env node
/**
 * Optional live smoke for Warcraft Logs public API (bounded).
 * Skips gracefully when WCL credentials are unavailable.
 * Never logs tokens or client secrets.
 */
const clientId = process.env.WCL_CLIENT_ID ?? "";
const clientSecret = process.env.WCL_CLIENT_SECRET ?? "";
const providerMode = process.env.PROVIDER_MODE ?? "fixture";

if (providerMode !== "live" || !clientId || !clientSecret) {
  console.log("SKIP: WCL live smoke — set PROVIDER_MODE=live and WCL credentials");
  process.exit(0);
}

const tokenUrl = process.env.WCL_TOKEN_URL ?? "https://www.warcraftlogs.com/oauth/token";
const graphqlUrl = process.env.WCL_PUBLIC_GRAPHQL_URL ?? "https://www.warcraftlogs.com/api/v2/client";

const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
const tokenRes = await fetch(tokenUrl, {
  method: "POST",
  headers: {
    Authorization: `Basic ${credentials}`,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: "grant_type=client_credentials",
});

if (!tokenRes.ok) {
  console.error("FAIL: token request", tokenRes.status);
  process.exit(1);
}

const tokenJson = await tokenRes.json();
const accessToken = tokenJson?.access_token;
if (typeof accessToken !== "string" || !accessToken) {
  console.error("FAIL: token response missing access_token");
  process.exit(1);
}

const name = process.env.WCL_SMOKE_CHARACTER_NAME ?? "Gingi";
const realm = process.env.WCL_SMOKE_REALM_SLUG ?? "tarren-mill";
const region = (process.env.WCL_SMOKE_REGION ?? "EU").toUpperCase();
const zoneIdRaw = process.env.WCL_MPLUS_ZONE_ID ?? "";
const zoneId = Number(zoneIdRaw);
const hasZone = Number.isInteger(zoneId) && zoneId > 0;

async function gql(operationName, query, variables) {
  const res = await fetch(graphqlUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ operationName, query, variables }),
  });
  const body = await res.json();
  if (!res.ok || body.errors?.length) {
    const messages = (body.errors ?? []).map((e) => e.message).join("; ") || `HTTP ${res.status}`;
    throw new Error(`${operationName}: ${messages}`);
  }
  return body.data;
}

try {
  const rate = await gql(
    "RateLimitData",
    `query RateLimitData {
      rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn }
    }`,
    {},
  );

  const resolved = await gql(
    "ResolveCharacter",
    `query ResolveCharacter($name: String!, $serverSlug: String!, $serverRegion: String!) {
      characterData {
        character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
          id
          canonicalID
          hidden
          server { slug region { name } }
        }
      }
    }`,
    { name, serverSlug: realm, serverRegion: region },
  );

  const character = resolved?.characterData?.character ?? null;
  if (!character) {
    console.error("FAIL: character not found on WCL", { region, realm, name });
    process.exit(1);
  }

  let rankingCount = 0;
  let rankingsSkipped = false;
  if (hasZone && !character.hidden) {
    const rankings = await gql(
      "CharacterZoneRankings",
      `query CharacterZoneRankings($name: String!, $serverSlug: String!, $serverRegion: String!, $zoneID: Int!) {
        characterData {
          character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
            zoneRankings(zoneID: $zoneID, metric: playerscore, byBracket: true, compare: Parses) {
              totalParses
              rankings { report { code } fightID bracket }
            }
          }
        }
      }`,
      { name, serverSlug: realm, serverRegion: region, zoneID: zoneId },
    );
    rankingCount = rankings?.characterData?.character?.zoneRankings?.rankings?.length ?? 0;
  } else {
    rankingsSkipped = true;
  }

  const recent = await gql(
    "CharacterRecentReports",
    `query CharacterRecentReports($name: String!, $serverSlug: String!, $serverRegion: String!, $limit: Int!, $page: Int!) {
      characterData {
        character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
          recentReports(limit: $limit, page: $page) {
            data { code visibility }
            total
            has_more_pages
          }
        }
      }
    }`,
    { name, serverSlug: realm, serverRegion: region, limit: 20, page: 1 },
  );

  const recentRows = recent?.characterData?.character?.recentReports?.data ?? [];
  const publicRecent = recentRows.filter((r) => (r.visibility ?? "public") === "public").length;
  const privateSkipped = recentRows.filter((r) => {
    const v = (r.visibility ?? "").toLowerCase();
    return v === "private" || v === "unlisted";
  }).length;

  let visibility = "PUBLIC";
  if (character.hidden) visibility = "HIDDEN";
  else if (rankingCount === 0 && publicRecent === 0) {
    visibility = privateSkipped > 0 ? "PRIVATE_SKIPPED" : "NO_PUBLIC_LOGS";
  }

  const spent = rate?.rateLimitData?.pointsSpentThisHour ?? 0;
  const limit = rate?.rateLimitData?.limitPerHour ?? 0;
  const utilization = limit > 0 ? ((spent / limit) * 100).toFixed(1) : "n/a";

  console.log(
    JSON.stringify(
      {
        ok: true,
        identity: { region, realm, name },
        visibility,
        hidden: character.hidden,
        wclCharacterId: character.id,
        canonicalId: character.canonicalID,
        bounds: {
          zoneId: hasZone ? zoneId : null,
          rankingsSkipped,
          rankingRows: rankingCount,
          recentPageLimit: 20,
          recentPublic: publicRecent,
          privateOrUnlistedSkipped: privateSkipped,
          recentHasMorePages: Boolean(recent?.characterData?.character?.recentReports?.has_more_pages),
        },
        rateLimit: {
          limitPerHour: limit,
          pointsSpentThisHour: spent,
          pointsResetIn: rate?.rateLimitData?.pointsResetIn ?? null,
          utilizationPercent: utilization,
        },
      },
      null,
      2,
    ),
  );
  console.log("OK");
} catch (error) {
  console.error("FAIL:", error instanceof Error ? error.message : error);
  process.exit(1);
}
