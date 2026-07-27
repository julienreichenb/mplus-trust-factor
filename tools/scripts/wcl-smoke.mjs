#!/usr/bin/env node
/**
 * Optional live smoke script for Warcraft Logs public API.
 * Skips gracefully when WCL credentials are unavailable.
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
  console.error("FAIL: token request", tokenRes.status, await tokenRes.text());
  process.exit(1);
}

const { access_token: accessToken } = await tokenRes.json();

const name = process.env.WCL_SMOKE_CHARACTER_NAME ?? "Gingi";
const realm = process.env.WCL_SMOKE_REALM_SLUG ?? "tarren-mill";
const region = process.env.WCL_SMOKE_REGION ?? "EU";

const query = `query Smoke($name: String!, $serverSlug: String!, $serverRegion: String!) {
  rateLimitData { limitPerHour pointsSpentThisHour pointsRemaining resetInSeconds }
  characterData {
    character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
      id
      canonicalID
      hidden
    }
  }
}`;

const gqlRes = await fetch(graphqlUrl, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    operationName: "Smoke",
    query,
    variables: { name, serverSlug: realm, serverRegion: region },
  }),
});

const body = await gqlRes.json();
if (!gqlRes.ok || body.errors?.length) {
  console.error("FAIL: graphql", JSON.stringify(body, null, 2));
  process.exit(1);
}

console.log("rateLimitData:", body.data?.rateLimitData);
console.log("character:", body.data?.characterData?.character);
console.log("OK");
