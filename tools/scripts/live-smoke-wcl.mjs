#!/usr/bin/env node
/**
 * Manual Warcraft Logs public-API live smoke. Requires ALLOW_LIVE_PROVIDER_CALLS=true.
 * Usage:
 *   pnpm live:smoke:wcl -- --region EU --realm tarren-mill --name Example
 */
import { assertLiveCallsAllowed, requireIdentityArgs, printEnvModeSummary, printRedacted } from "./live-smoke-lib.mjs";

assertLiveCallsAllowed();
printEnvModeSummary();

const identity = requireIdentityArgs();
const clientId = process.env.WCL_CLIENT_ID ?? "";
const clientSecret = process.env.WCL_CLIENT_SECRET ?? "";

if (!clientId || !clientSecret) {
  console.error("FAIL: WCL_CLIENT_ID and WCL_CLIENT_SECRET are required for this smoke.");
  process.exit(1);
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
  printRedacted("FAIL: WCL token request", {
    status: tokenRes.status,
    body: await tokenRes.text(),
  });
  process.exit(1);
}

const tokenJson = await tokenRes.json();
const accessToken = tokenJson.access_token;
if (!accessToken || typeof accessToken !== "string") {
  console.error("FAIL: WCL token response missing access_token");
  process.exit(1);
}

const query = `query Smoke($name: String!, $serverSlug: String!, $serverRegion: String!) {
  rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn }
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
    variables: {
      name: identity.name,
      serverSlug: identity.realm,
      serverRegion: identity.region,
    },
  }),
});

const body = await gqlRes.json();
const character = body?.data?.characterData?.character ?? null;

printRedacted("wcl.smoke", {
  identity,
  httpStatus: gqlRes.status,
  graphqlErrors: body?.errors?.map((error) => error.message) ?? [],
  rateLimitData: body?.data?.rateLimitData ?? null,
  character: character
    ? { id: character.id, canonicalID: character.canonicalID, hidden: character.hidden }
    : null,
});

if (!gqlRes.ok || body.errors?.length) {
  process.exit(1);
}

console.log("OK");
