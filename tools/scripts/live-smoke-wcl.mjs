#!/usr/bin/env node
/**
 * Manual Warcraft Logs public-API live smoke. Requires ALLOW_LIVE_PROVIDER_CALLS=true.
 *
 * Usage:
 *   pnpm wcl:smoke -- --region EU --realm archimonde --name Wallidrixe
 *   pnpm wcl:smoke -- --region EU --realm archimonde --name Wallidrixe --deep
 *   pnpm live:smoke:wcl -- --region EU --realm archimonde --name Wallidrixe
 *
 * Shallow mode probes OAuth + character resolve.
 * --deep runs the bounded provider diagnostic (discovery, rankings, matching, analysis, persistence).
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  assertLiveCallsAllowed,
  requireIdentityArgs,
  printEnvModeSummary,
  printRedacted,
  parseIdentityArgs,
} from "./live-smoke-lib.mjs";

assertLiveCallsAllowed();

const argv = process.argv.slice(2);
const deep = argv.includes("--deep");
const filteredArgv = argv.filter((a) => a !== "--deep");

if (deep) {
  try {
    parseIdentityArgs(filteredArgv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(
      "Deep mode usage: pnpm wcl:smoke -- --region EU --realm <slug> --name <name> --deep",
    );
    process.exit(2);
  }

  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const databaseDist = resolve(root, "packages/database/dist/index.js");
  const databaseSrc = resolve(root, "packages/database/src/index.ts");

  // Prisma client must exist before @mplus/database can build or be imported.
  spawnSync("pnpm", ["--filter", "@mplus/database", "exec", "prisma", "generate"], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    shell: true,
  });

  if (!existsSync(databaseDist) && existsSync(databaseSrc)) {
    const build = spawnSync("pnpm", ["--filter", "@mplus/database", "build"], {
      cwd: root,
      env: process.env,
      stdio: "inherit",
      shell: true,
    });
    if ((build.status ?? 1) !== 0) {
      console.warn(
        "WARN: @mplus/database build failed; smoke will try source entry via tsx.",
      );
    }
  }

  // Scoring/contracts must be built so @mplus/scoring exports include WCL identity fields.
  spawnSync(
    "pnpm",
    ["--filter", "@mplus/contracts", "--filter", "@mplus/scoring", "run", "build"],
    {
      cwd: root,
      env: process.env,
      stdio: "inherit",
      shell: true,
    },
  );

  const smokeTs = resolve(root, "packages/providers/warcraftlogs/src/smoke-live.ts");
  const require = createRequire(import.meta.url);
  let tsxCli = null;
  try {
    tsxCli = require.resolve("tsx/cli");
  } catch {
    const candidates = [
      resolve(root, "node_modules/tsx/dist/cli.mjs"),
      resolve(root, "node_modules/.pnpm/tsx@4.23.1/node_modules/tsx/dist/cli.mjs"),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        tsxCli = candidate;
        break;
      }
    }
  }
  if (!tsxCli) {
    console.error("ERROR: tsx CLI not found. Run pnpm install from the repo root.");
    process.exit(1);
  }

  const result = spawnSync(process.execPath, [tsxCli, smokeTs, ...filteredArgv, "--deep"], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

printEnvModeSummary();

const identity = requireIdentityArgs(filteredArgv);
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
