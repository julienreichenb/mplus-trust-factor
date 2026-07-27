#!/usr/bin/env node
/**
 * Manual Blizzard live smoke. Requires ALLOW_LIVE_PROVIDER_CALLS=true.
 * Usage:
 *   pnpm live:smoke:blizzard -- --region EU --realm tarren-mill --name Example
 */
import { assertLiveCallsAllowed, requireIdentityArgs, printEnvModeSummary, printRedacted } from "./live-smoke-lib.mjs";

assertLiveCallsAllowed();
printEnvModeSummary();

const identity = requireIdentityArgs();
const clientId = process.env.BLIZZARD_CLIENT_ID ?? "";
const clientSecret = process.env.BLIZZARD_CLIENT_SECRET ?? "";

if (!clientId || !clientSecret) {
  console.error("FAIL: BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET are required for this smoke.");
  process.exit(1);
}

const region = identity.region.toLowerCase();
const locale = process.env.BLIZZARD_DEFAULT_LOCALE ?? "en_GB";
const tokenUrl = "https://oauth.battle.net/token";
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
  printRedacted("FAIL: Blizzard token request", {
    status: tokenRes.status,
    body: await tokenRes.text(),
  });
  process.exit(1);
}

const tokenJson = await tokenRes.json();
const accessToken = tokenJson.access_token;
if (!accessToken || typeof accessToken !== "string") {
  console.error("FAIL: Blizzard token response missing access_token");
  process.exit(1);
}

const profileUrl = new URL(
  `https://${region}.api.blizzard.com/profile/wow/character/${encodeURIComponent(identity.realm)}/${encodeURIComponent(identity.name.toLowerCase())}`,
);
profileUrl.searchParams.set("namespace", `profile-${region}`);
profileUrl.searchParams.set("locale", locale);

const profileRes = await fetch(profileUrl, {
  headers: { Authorization: `Bearer ${accessToken}` },
});

const profileText = await profileRes.text();
let profileBody;
try {
  profileBody = JSON.parse(profileText);
} catch {
  profileBody = { raw: profileText.slice(0, 200) };
}

printRedacted("blizzard.smoke", {
  identity,
  tokenOk: true,
  profileStatus: profileRes.status,
  characterId: profileBody?.id ?? null,
  name: profileBody?.name ?? null,
  realm: profileBody?.realm?.slug ?? null,
});

if (!profileRes.ok && profileRes.status !== 404) {
  process.exit(1);
}

console.log("OK");
