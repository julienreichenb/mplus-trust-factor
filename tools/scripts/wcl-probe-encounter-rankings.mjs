/**
 * One-off live probe: Character.encounterRankings for discovery cost audit.
 * Usage: node tools/scripts/with-env.mjs node tools/scripts/wcl-probe-encounter-rankings.mjs
 * Requires ALLOW_LIVE_PROVIDER_CALLS=true.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

function envFlag(v, d = false) {
  if (v === undefined || v === "") return d;
  return ["1", "true", "yes", "on"].includes(String(v).trim().toLowerCase());
}

async function getToken() {
  const id = process.env.WCL_CLIENT_ID ?? "";
  const secret = process.env.WCL_CLIENT_SECRET ?? "";
  const tokenUrl = process.env.WCL_TOKEN_URL ?? "https://www.warcraftlogs.com/oauth/token";
  if (!id || !secret) throw new Error("WCL_CLIENT_ID / WCL_CLIENT_SECRET required");
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.access_token;
}

function opNameFromQuery(query) {
  const m = query.match(/\b(?:query|mutation)\s+([A-Za-z_][A-Za-z0-9_]*)/);
  return m?.[1] ?? null;
}

async function gql(token, query, variables = {}) {
  const operationName = opNameFromQuery(query);
  if (!operationName) throw new Error("query must declare an operation name");
  const url = process.env.WCL_PUBLIC_GRAPHQL_URL ?? "https://www.warcraftlogs.com/api/v2/client";
  const before = await rate(token);
  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ operationName, query, variables }),
  });
  const body = await res.json();
  const after = await rate(token);
  const costFromExt = body.extensions?.rateLimit?.cost ?? null;
  const spentDelta =
    after && before ? after.pointsSpentThisHour - before.pointsSpentThisHour : null;
  return {
    ok: res.ok,
    status: res.status,
    operationName,
    durationMs: Date.now() - started,
    costFromExt,
    spentDelta,
    pointsSpentThisHour: after?.pointsSpentThisHour ?? null,
    limitPerHour: after?.limitPerHour ?? null,
    errors: body.errors ?? null,
    data: body.data ?? null,
    extensions: body.extensions ?? null,
  };
}

async function rate(token) {
  const url = process.env.WCL_PUBLIC_GRAPHQL_URL ?? "https://www.warcraftlogs.com/api/v2/client";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      operationName: "RateLimitData",
      query: `query RateLimitData {
        rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn }
      }`,
    }),
  });
  const body = await res.json();
  return body.data?.rateLimitData ?? null;
}

const ENCOUNTERS = {
  "algethar-academy": 112526,
  "magisters-terrace": 12811,
  "maisara-caverns": 12874,
  "nexus-point-xenas": 12915,
  "pit-of-saron": 10658,
  "seat-of-the-triumvirate": 361753,
  skyreach: 61209,
  "windrunner-spire": 12805,
};

async function main() {
  if (!envFlag(process.env.ALLOW_LIVE_PROVIDER_CALLS)) {
    console.error("FAIL: ALLOW_LIVE_PROVIDER_CALLS must be true");
    process.exit(1);
  }
  const token = await getToken();
  const outDir = resolve("tmp/wcl-encounter-rankings-probe");
  mkdirSync(outDir, { recursive: true });

  const results = { steps: [], summary: {} };

  // 1) Introspect Character fields containing Rankings
  const introspect = await gql(
    token,
    `query IntrospectCharacterRankings {
      __type(name: "Character") {
        fields {
          name
          description
          args { name type { kind name ofType { kind name ofType { kind name } } } }
          type { kind name ofType { kind name } }
        }
      }
    }`,
  );
  const fields = introspect.data?.__type?.fields ?? [];
  const rankingFields = fields
    .filter((f) => /rank/i.test(f.name))
    .map((f) => ({
      name: f.name,
      description: f.description,
      args: (f.args ?? []).map((a) => a.name),
      type: f.type,
    }));
  results.steps.push({
    name: "introspect",
    costFromExt: introspect.costFromExt,
    spentDelta: introspect.spentDelta,
    rankingFields,
  });
  writeFileSync(resolve(outDir, "01-introspect.json"), JSON.stringify(introspect, null, 2));

  const hasEncounterRankings = rankingFields.some((f) => f.name === "encounterRankings");
  console.log("ranking fields:", rankingFields.map((f) => f.name).join(", "));
  console.log("has encounterRankings:", hasEncounterRankings);

  // 2) Try encounterRankings as JSON (like zoneRankings) — several argument shapes
  const singleQueries = [
    {
      name: "encounterRankings_json_playerscore",
      query: `query EncounterRankingsPlayerscore($name: String!, $serverSlug: String!, $serverRegion: String!, $encounterID: Int!) {
        characterData {
          character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
            id
            name
            encounterRankings(encounterID: $encounterID, metric: playerscore, byBracket: true, compare: Parses)
          }
        }
      }`,
      variables: {
        name: "Wallidrixe",
        serverSlug: "archimonde",
        serverRegion: "EU",
        encounterID: 112526,
      },
    },
    {
      name: "encounterRankings_json_default",
      query: `query EncounterRankingsDefault($name: String!, $serverSlug: String!, $serverRegion: String!, $encounterID: Int!) {
        characterData {
          character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
            id
            encounterRankings(encounterID: $encounterID)
          }
        }
      }`,
      variables: {
        name: "Wallidrixe",
        serverSlug: "archimonde",
        serverRegion: "EU",
        encounterID: 112526,
      },
    },
    {
      name: "encounterRankings_dps_parses",
      query: `query EncounterRankingsDpsParses($name: String!, $serverSlug: String!, $serverRegion: String!, $encounterID: Int!) {
        characterData {
          character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
            id
            encounterRankings(encounterID: $encounterID, metric: dps, byBracket: true, compare: Parses)
          }
        }
      }`,
      variables: {
        name: "Wallidrixe",
        serverSlug: "archimonde",
        serverRegion: "EU",
        encounterID: 112526,
      },
    },
  ];

  for (const q of singleQueries) {
    const r = await gql(token, q.query, q.variables);
    const char = r.data?.characterData?.character ?? null;
    const payloadKey = Object.keys(char ?? {}).find((k) => k !== "id" && k !== "name");
    let payload = payloadKey ? char[payloadKey] : null;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        /* keep string */
      }
    }
    const sampleRows = Array.isArray(payload?.rankings)
      ? payload.rankings.slice(0, 3)
      : Array.isArray(payload)
        ? payload.slice(0, 3)
        : payload;
    results.steps.push({
      name: q.name,
      ok: r.ok,
      errors: r.errors,
      costFromExt: r.costFromExt,
      spentDelta: r.spentDelta,
      durationMs: r.durationMs,
      payloadType: typeof payload,
      rankingCount: Array.isArray(payload?.rankings)
        ? payload.rankings.length
        : Array.isArray(payload)
          ? payload.length
          : null,
      sampleRows,
      topKeys:
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? Object.keys(payload)
          : null,
      firstRowKeys:
        Array.isArray(payload?.rankings) && payload.rankings[0]
          ? Object.keys(payload.rankings[0])
          : Array.isArray(payload) && payload[0]
            ? Object.keys(payload[0])
            : null,
    });
    writeFileSync(resolve(outDir, `02-${q.name}.json`), JSON.stringify(r, null, 2));
    console.log(
      q.name,
      "cost=",
      r.costFromExt,
      "spentDelta=",
      r.spentDelta,
      "errors=",
      r.errors?.[0]?.message ?? null,
      "rows=",
      results.steps.at(-1).rankingCount,
    );
  }

  // 3) Aliased 8-dungeon encounterRankings if any single query worked
  const erOk = results.steps.find(
    (s) => s.name.startsWith("encounterRankings") && !s.errors && (s.rankingCount ?? 0) > 0,
  );
  // Prefer metric that returned rows; fall back to playerscore+Parses.
  const preferredMetric =
    results.steps.find((s) => s.name === "encounterRankings_dps_parses" && (s.rankingCount ?? 0) > 0)
      ? "dps"
      : "playerscore";

  if (erOk || results.steps.some((s) => s.name.startsWith("encounterRankings") && !s.errors)) {
    const aliasParts = Object.entries(ENCOUNTERS)
      .map(([slug, id]) => {
        const alias = slug.replace(/[^a-z0-9]/gi, "_");
        return `${alias}: encounterRankings(encounterID: ${id}, metric: ${preferredMetric}, byBracket: true, compare: Parses)`;
      })
      .join("\n      ");
    const aliased = await gql(
      token,
      `query AliasedEightDungeonRankings($name: String!, $serverSlug: String!, $serverRegion: String!) {
        characterData {
          character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
            id
            ${aliasParts}
          }
        }
      }`,
      { name: "Wallidrixe", serverSlug: "archimonde", serverRegion: "EU" },
    );
    const char = aliased.data?.characterData?.character ?? {};
    const perDungeon = {};
    for (const [slug] of Object.entries(ENCOUNTERS)) {
      const alias = slug.replace(/[^a-z0-9]/gi, "_");
      let payload = char[alias];
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload);
        } catch {
          /* */
        }
      }
      const rows = Array.isArray(payload?.rankings) ? payload.rankings : [];
      perDungeon[slug] = {
        rowCount: rows.length,
        sample: rows[0] ?? null,
        firstRowKeys: rows[0] ? Object.keys(rows[0]) : [],
      };
    }
    results.steps.push({
      name: "aliased_8",
      field: "encounterRankings",
      preferredMetric,
      ok: aliased.ok,
      errors: aliased.errors,
      costFromExt: aliased.costFromExt,
      spentDelta: aliased.spentDelta,
      durationMs: aliased.durationMs,
      perDungeon,
    });
    writeFileSync(resolve(outDir, "03-aliased-8.json"), JSON.stringify(aliased, null, 2));
    console.log(
      "aliased_8 metric=",
      preferredMetric,
      "cost=",
      aliased.costFromExt,
      "spentDelta=",
      aliased.spentDelta,
      "errors=",
      aliased.errors?.[0]?.message ?? null,
    );
  }

  // 4) Eight separate queries cost
  const separate = [];
  for (const [slug, id] of Object.entries(ENCOUNTERS)) {
    const r = await gql(
      token,
      `query EncounterRankingsOne($name: String!, $serverSlug: String!, $serverRegion: String!, $encounterID: Int!) {
        characterData {
          character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
            encounterRankings(encounterID: $encounterID, metric: ${preferredMetric}, byBracket: true, compare: Parses)
          }
        }
      }`,
      {
        name: "Wallidrixe",
        serverSlug: "archimonde",
        serverRegion: "EU",
        encounterID: id,
      },
    );
    let payload = r.data?.characterData?.character?.encounterRankings;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        /* */
      }
    }
    separate.push({
      slug,
      id,
      costFromExt: r.costFromExt,
      spentDelta: r.spentDelta,
      durationMs: r.durationMs,
      errors: r.errors?.[0]?.message ?? null,
      rowCount: Array.isArray(payload?.rankings) ? payload.rankings.length : null,
    });
    console.log("separate", slug, "cost=", r.costFromExt, "rows=", separate.at(-1).rowCount);
  }
  results.steps.push({
    name: "eight_separate",
    totalCostExt: separate.reduce((a, s) => a + (s.costFromExt ?? 0), 0),
    totalSpentDelta: separate.reduce((a, s) => a + (s.spentDelta ?? 0), 0),
    separate,
  });

  writeFileSync(resolve(outDir, "00-summary.json"), JSON.stringify(results, null, 2));
  console.log("\nWrote", outDir);
  console.log(JSON.stringify(results.steps.map((s) => ({ name: s.name, cost: s.costFromExt ?? s.totalCostExt, errors: s.errors?.[0]?.message ?? null, rows: s.rankingCount })), null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
