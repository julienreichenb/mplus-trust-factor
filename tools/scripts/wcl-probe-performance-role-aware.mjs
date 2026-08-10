/**
 * Agent 04A — live role-aware Performance WCL probe (diagnostic only).
 *
 * Usage:
 *   node tools/scripts/with-env.mjs node tools/scripts/wcl-probe-performance-role-aware.mjs
 *
 * Requires ALLOW_LIVE_PROVIDER_CALLS=true + WCL credentials.
 * Writes sanitized samples under tmp/wcl-performance-role-aware-04a/ (gitignored).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function envFlag(v, d = false) {
  if (v === undefined || v === "") return d;
  return ["1", "true", "yes", "on"].includes(String(v).trim().toLowerCase());
}

async function getToken() {
  const id = process.env.WCL_CLIENT_ID ?? "";
  const secret = process.env.WCL_CLIENT_SECRET ?? "";
  const tokenUrl =
    process.env.WCL_TOKEN_URL ?? "https://www.warcraftlogs.com/oauth/token";
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

async function rate(token) {
  const url =
    process.env.WCL_PUBLIC_GRAPHQL_URL ??
    "https://www.warcraftlogs.com/api/v2/client";
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

async function gql(token, query, variables = {}) {
  const operationName = opNameFromQuery(query);
  if (!operationName) throw new Error("query must declare an operation name");
  const url =
    process.env.WCL_PUBLIC_GRAPHQL_URL ??
    "https://www.warcraftlogs.com/api/v2/client";
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
    after && before
      ? after.pointsSpentThisHour - before.pointsSpentThisHour
      : null;
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

function parseJsonScalar(value) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function isRecord(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function summarizeThroughput(raw) {
  const payload = parseJsonScalar(raw);
  if (!isRecord(payload)) {
    return {
      nullPayload: true,
      topKeys: [],
      metric: null,
      role: null,
      spec: null,
      dungeonCount: 0,
      throughput: [],
      bestPerformanceAverage: null,
      medianPerformanceAverage: null,
      allStars: [],
    };
  }
  const thr = payload.throughputRankings;
  const rows = [];
  if (isRecord(thr)) {
    for (const [encounterId, row] of Object.entries(thr)) {
      if (!isRecord(row)) continue;
      rows.push({
        encounterId,
        best_historical_percentile: row.best_historical_percentile ?? null,
        median_historical_percentile: row.median_historical_percentile ?? null,
        best_per_second_amount: row.best_per_second_amount ?? null,
        best_level: row.best_level ?? null,
        best_historical_low_parses: row.best_historical_low_parses ?? null,
        rowKeys: Object.keys(row),
      });
    }
  } else if (Array.isArray(thr)) {
    for (const row of thr) {
      if (!isRecord(row)) continue;
      rows.push({
        encounterId: row.encounter?.id ?? row.encounterID ?? null,
        best_historical_percentile:
          row.best_historical_percentile ?? row.rankPercent ?? null,
        median_historical_percentile:
          row.median_historical_percentile ?? row.medianPercent ?? null,
        best_per_second_amount:
          row.best_per_second_amount ?? row.bestAmount ?? null,
        best_level: row.best_level ?? row.bracket ?? null,
        best_historical_low_parses: row.best_historical_low_parses ?? null,
        rowKeys: Object.keys(row),
      });
    }
  }
  const allStars = Array.isArray(payload.allStars)
    ? payload.allStars.map((s) =>
        isRecord(s)
          ? {
              spec: s.spec ?? null,
              points: s.points ?? null,
              rankPercent: s.rankPercent ?? null,
              total: s.total ?? null,
              regionRank: s.regionRank ?? null,
            }
          : s,
      )
    : [];
  return {
    nullPayload: false,
    topKeys: Object.keys(payload),
    metric: payload.metric ?? null,
    role: payload.role ?? null,
    spec: payload.spec ?? payload.bestSpec ?? null,
    difficulty: payload.difficulty ?? null,
    partition: payload.partition ?? null,
    zone: payload.zone ?? null,
    size: payload.size ?? null,
    dungeonCount: rows.length,
    throughput: rows.sort((a, b) =>
      String(a.encounterId).localeCompare(String(b.encounterId)),
    ),
    bestPerformanceAverage: payload.bestPerformanceAverage ?? null,
    medianPerformanceAverage: payload.medianPerformanceAverage ?? null,
    allStars,
    rankingsCount: Array.isArray(payload.rankings) ? payload.rankings.length : 0,
    sampleThroughputKeys: rows[0]?.rowKeys ?? [],
  };
}

function summarizeEncounterRanks(raw, selectedIds = null) {
  const payload = parseJsonScalar(raw);
  if (!isRecord(payload)) {
    return { nullPayload: true, metric: null, ranksCount: 0, matched: [] };
  }
  const ranks = Array.isArray(payload.ranks) ? payload.ranks : [];
  const matched = [];
  for (const row of ranks) {
    if (!isRecord(row)) continue;
    const code = row.report?.code ?? null;
    const fightID = row.report?.fightID ?? row.fightID ?? null;
    const key = code && fightID != null ? `${code}:${fightID}` : null;
    if (selectedIds && key && !selectedIds.has(key)) continue;
    matched.push({
      reportCode: code,
      fightID,
      rankPercent: row.rankPercent ?? null,
      historicalPercent: row.historicalPercent ?? null,
      todayPercent: row.todayPercent ?? null,
      amount: row.amount ?? null,
      bracketData: row.bracketData ?? null,
      spec: row.spec ?? null,
      medal: row.medal ?? null,
      score: row.score ?? null,
    });
    if (!selectedIds && matched.length >= 5) break;
  }
  return {
    nullPayload: false,
    metric: payload.metric ?? null,
    partition: payload.partition ?? null,
    zone: payload.zone ?? null,
    bestAmount: payload.bestAmount ?? null,
    medianPerformance: payload.medianPerformance ?? null,
    averagePerformance: payload.averagePerformance ?? null,
    totalKills: payload.totalKills ?? null,
    ranksCount: ranks.length,
    matchedCount: matched.length,
    matchedSample: matched.slice(0, 8),
    rankFieldPresence: {
      rankPercent: ranks.some((r) => isRecord(r) && r.rankPercent != null),
      historicalPercent: ranks.some(
        (r) => isRecord(r) && r.historicalPercent != null,
      ),
      todayPercent: ranks.some((r) => isRecord(r) && r.todayPercent != null),
      reportCode: ranks.some((r) => isRecord(r) && r.report?.code),
    },
  };
}

const ZONE_ID = Number(process.env.WCL_MPLUS_ZONE_ID ?? 47);
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

/** Public candidates used to discover one DPS / TANK / HEALER with current logs. */
const CANDIDATES = [
  { region: "EU", realm: "archimonde", name: "Wallidrixe", hint: "DPS" },
  { region: "EU", realm: "ysondre", name: "Lfgmasochist", hint: "DPS" },
  { region: "EU", realm: "ysondre", name: "Haart", hint: "?" },
  { region: "EU", realm: "ysondre", name: "Lfgaddict", hint: "?" },
  { region: "EU", realm: "hyjal", name: "Zam", hint: "?" },
  { region: "EU", realm: "garona", name: "Aspha", hint: "?" },
  { region: "EU", realm: "sylvanas", name: "Serahz", hint: "?" },
  { region: "EU", realm: "ravencrest", name: "Moosevoker", hint: "HEALER?" },
];

const WCL_CLASS = {
  1: "Warrior",
  2: "Paladin",
  3: "Hunter",
  4: "Rogue",
  5: "Priest",
  6: "DeathKnight",
  7: "Shaman",
  8: "Mage",
  9: "Warlock",
  10: "Monk",
  11: "Druid",
  12: "DemonHunter",
  13: "Evoker",
};

const HEALER_SPECS = new Set([
  "Holy",
  "Discipline",
  "Restoration",
  "Mistweaver",
  "Preservation",
]);
const TANK_SPECS = new Set([
  "Protection",
  "Blood",
  "Guardian",
  "Brewmaster",
  "Vengeance",
]);

function inferRoleFromSpec(spec) {
  if (!spec) return null;
  if (HEALER_SPECS.has(spec)) return "HEALER";
  if (TANK_SPECS.has(spec)) return "TANK";
  return "DPS";
}

async function main() {
  if (!envFlag(process.env.ALLOW_LIVE_PROVIDER_CALLS)) {
    console.error("FAIL: ALLOW_LIVE_PROVIDER_CALLS must be true");
    process.exit(1);
  }

  const outDir = resolve("tmp/wcl-performance-role-aware-04a");
  mkdirSync(outDir, { recursive: true });
  const token = await getToken();
  const report = {
    generatedAt: new Date().toISOString(),
    zoneId: ZONE_ID,
    steps: [],
    introspection: {},
    discovery: [],
    probes: {},
    dualQuery: null,
    encounterRankings: {},
    summary: {},
  };

  // --- Introspection ---
  const introspect = await gql(
    token,
    `query IntrospectRoleAwareEnums {
      metricType: __type(name: "CharacterPageRankingMetricType") {
        name
        enumValues { name }
      }
      roleType: __type(name: "RoleType") {
        name
        enumValues { name }
      }
      rankingRoleType: __type(name: "CharacterRankingRoleType") {
        name
        enumValues { name }
      }
      character: __type(name: "Character") {
        fields {
          name
          args {
            name
            type { kind name ofType { kind name ofType { kind name } } }
          }
        }
      }
    }`,
  );
  const zoneRankingsArgs =
    introspect.data?.character?.fields?.find((f) => f.name === "zoneRankings")
      ?.args ?? [];
  const encounterRankingsArgs =
    introspect.data?.character?.fields?.find(
      (f) => f.name === "encounterRankings",
    )?.args ?? [];
  report.introspection = {
    costFromExt: introspect.costFromExt,
    spentDelta: introspect.spentDelta,
    errors: introspect.errors,
    metrics:
      introspect.data?.metricType?.enumValues?.map((e) => e.name) ?? null,
    roleType: introspect.data?.roleType?.enumValues?.map((e) => e.name) ?? null,
    rankingRoleType:
      introspect.data?.rankingRoleType?.enumValues?.map((e) => e.name) ?? null,
    zoneRankingsArgNames: zoneRankingsArgs.map((a) => a.name),
    encounterRankingsArgNames: encounterRankingsArgs.map((a) => a.name),
    zoneRankingsArgsDetail: zoneRankingsArgs,
    encounterRankingsArgsDetail: encounterRankingsArgs,
  };
  report.steps.push({
    name: "introspection",
    costFromExt: introspect.costFromExt,
    spentDelta: introspect.spentDelta,
  });
  console.log(
    "INTROSPECT metrics=",
    report.introspection.metrics,
    "roleType=",
    report.introspection.roleType,
    "rankingRoleType=",
    report.introspection.rankingRoleType,
  );

  const roleEnum =
    report.introspection.roleType ??
    report.introspection.rankingRoleType ??
    ["DPS", "Tank", "Healer", "Any"];
  const roleDps = roleEnum.find((r) => /dps/i.test(r)) ?? "DPS";
  const roleTank = roleEnum.find((r) => /tank/i.test(r)) ?? "Tank";
  const roleHealer = roleEnum.find((r) => /heal/i.test(r)) ?? "Healer";
  report.summary.roleEnumResolved = { roleDps, roleTank, roleHealer };

  // --- Discover class/spec via unfiltered points_and_damage ---
  const discovered = [];
  for (const c of CANDIDATES) {
    const res = await gql(
      token,
      `query DiscoverCharacterPad(
        $name: String!
        $serverSlug: String!
        $serverRegion: String!
        $zoneID: Int!
      ) {
        characterData {
          character(
            name: $name
            serverSlug: $serverSlug
            serverRegion: $serverRegion
          ) {
            id
            name
            classID
            zoneRankings(
              zoneID: $zoneID
              metric: points_and_damage
              byBracket: true
            )
          }
        }
      }`,
      {
        name: c.name,
        serverSlug: c.realm,
        serverRegion: c.region,
        zoneID: ZONE_ID,
      },
    );
    const ch = res.data?.characterData?.character;
    const summary = summarizeThroughput(ch?.zoneRankings);
    const primarySpec =
      summary.allStars?.[0]?.spec ??
      (Array.isArray(parseJsonScalar(ch?.zoneRankings)?.rankings)
        ? parseJsonScalar(ch.zoneRankings).rankings[0]?.spec
        : null) ??
      null;
    const inferredRole = inferRoleFromSpec(primarySpec);
    const entry = {
      ...c,
      classID: ch?.classID ?? null,
      className: WCL_CLASS[ch?.classID] ?? null,
      primarySpec,
      inferredRole,
      dungeonCount: summary.dungeonCount,
      bestPerformanceAverage: summary.bestPerformanceAverage,
      costFromExt: res.costFromExt,
      spentDelta: res.spentDelta,
      errors: res.errors,
      nullCharacter: ch == null,
    };
    discovered.push(entry);
    report.discovery.push(entry);
    report.steps.push({
      name: `discover:${c.name}`,
      costFromExt: res.costFromExt,
      spentDelta: res.spentDelta,
      inferredRole,
      primarySpec,
      dungeonCount: summary.dungeonCount,
    });
    console.log(
      `DISCOVER ${c.name}: class=${entry.className} spec=${primarySpec} role=${inferredRole} dungeons=${summary.dungeonCount} cost=${res.costFromExt}`,
    );
  }

  function pick(role) {
    return (
      discovered.find(
        (d) =>
          d.inferredRole === role &&
          !d.nullCharacter &&
          d.dungeonCount > 0 &&
          !d.errors,
      ) ??
      discovered.find(
        (d) => d.inferredRole === role && !d.nullCharacter && !d.errors,
      ) ??
      null
    );
  }

  let dpsChar = pick("DPS");
  let tankChar = pick("TANK");
  let healerChar = pick("HEALER");

  // Fallback tank/healer search via known public M+ names if discovery missed.
  const EXTRA = [
    { region: "EU", realm: "kazzak", name: "Liquid", hint: "maybe" },
  ];
  if (!tankChar || !healerChar) {
    console.log(
      "WARN: missing tank/healer from fixture list; trying RIO-less WCL search via Moosevoker dual metrics...",
    );
  }

  report.summary.selected = {
    dps: dpsChar,
    tank: tankChar,
    healer: healerChar,
  };
  console.log("SELECTED", report.summary.selected);

  async function probeZone(label, character, metric, role, specName) {
    if (!character) {
      report.probes[label] = { skipped: true, reason: "no_character" };
      return null;
    }
    const vars = {
      name: character.name,
      serverSlug: character.realm,
      serverRegion: character.region,
      zoneID: ZONE_ID,
    };
    // Build query with literal enums (GraphQL enums cannot be String variables
    // for RoleType / CharacterPageRankingMetricType in WCL).
    const roleArg = role ? `role: ${role}` : "";
    const specArg = specName
      ? `specName: ${JSON.stringify(specName)}`
      : "";
    const query = `query ProbeZoneRoleAware_${label.replace(/[^A-Za-z0-9_]/g, "_")}(
  $name: String!
  $serverSlug: String!
  $serverRegion: String!
  $zoneID: Int!
) {
  characterData {
    character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
      id
      name
      classID
      zoneRankings(
        zoneID: $zoneID
        metric: ${metric}
        byBracket: true
        ${roleArg}
        ${specArg}
      )
    }
  }
}`;
    const res = await gql(token, query, vars);
    const raw = res.data?.characterData?.character?.zoneRankings;
    const summary = summarizeThroughput(raw);
    const minimized = {
      topKeys: summary.topKeys,
      metric: summary.metric,
      role: summary.role,
      spec: summary.spec,
      allStars: summary.allStars,
      bestPerformanceAverage: summary.bestPerformanceAverage,
      medianPerformanceAverage: summary.medianPerformanceAverage,
      dungeonCount: summary.dungeonCount,
      throughput: summary.throughput,
      rankingsCount: summary.rankingsCount,
      sampleThroughputKeys: summary.sampleThroughputKeys,
    };
    const result = {
      character: {
        name: character.name,
        realm: character.realm,
        region: character.region,
        className: character.className,
        primarySpec: character.primarySpec,
      },
      request: { metric, role: role || null, specName: specName || null },
      costFromExt: res.costFromExt,
      spentDelta: res.spentDelta,
      errors: res.errors,
      summary: minimized,
    };
    report.probes[label] = result;
    writeFileSync(
      resolve(outDir, `${label}.summary.json`),
      JSON.stringify(result, null, 2),
    );
    // Sanitized raw: strip nothing sensitive; payloads have no tokens.
    if (raw != null) {
      writeFileSync(
        resolve(outDir, `${label}.raw.min.json`),
        JSON.stringify(parseJsonScalar(raw), null, 2).slice(0, 200_000),
      );
    }
    report.steps.push({
      name: label,
      costFromExt: res.costFromExt,
      spentDelta: res.spentDelta,
      dungeonCount: summary.dungeonCount,
      errors: res.errors?.map((e) => e.message) ?? null,
    });
    console.log(
      `PROBE ${label}: dungeons=${summary.dungeonCount} metric=${summary.metric} bestAvg=${summary.bestPerformanceAverage} cost=${res.costFromExt} err=${res.errors?.[0]?.message ?? "none"}`,
    );
    return result;
  }

  // Prefer Wallidrixe for DPS (known Demonology) when available.
  if (dpsChar?.name !== "Wallidrixe") {
    const wall = discovered.find((d) => d.name === "Wallidrixe" && d.dungeonCount > 0);
    if (wall) dpsChar = wall;
  }

  // Unfiltered baseline + role-filtered for DPS
  await probeZone(
    "dps_unfiltered_points_and_damage",
    dpsChar,
    "points_and_damage",
    null,
    null,
  );
  await probeZone(
    "dps_role_spec_points_and_damage",
    dpsChar,
    "points_and_damage",
    roleDps,
    dpsChar?.primarySpec ?? null,
  );

  // Tank
  if (!tankChar) {
    // Try Haart etc. with Protection-like via points_and_healing miss — leave gap.
    console.log("NO TANK CHARACTER FOUND IN CANDIDATES");
  }
  await probeZone(
    "tank_unfiltered_points_and_damage",
    tankChar,
    "points_and_damage",
    null,
    null,
  );
  await probeZone(
    "tank_role_spec_points_and_damage",
    tankChar,
    "points_and_damage",
    roleTank,
    tankChar?.primarySpec ?? null,
  );

  // Healer healing + damage
  await probeZone(
    "healer_unfiltered_points_and_healing",
    healerChar,
    "points_and_healing",
    null,
    null,
  );
  await probeZone(
    "healer_role_spec_points_and_healing",
    healerChar,
    "points_and_healing",
    roleHealer,
    healerChar?.primarySpec ?? null,
  );
  await probeZone(
    "healer_role_spec_points_and_damage",
    healerChar,
    "points_and_damage",
    roleHealer,
    healerChar?.primarySpec ?? null,
  );
  await probeZone(
    "healer_role_spec_dps",
    healerChar,
    "dps",
    roleHealer,
    healerChar?.primarySpec ?? null,
  );
  await probeZone(
    "healer_unfiltered_points_and_damage",
    healerChar,
    "points_and_damage",
    null,
    null,
  );

  // --- Mission C: aliased dual query ---
  if (healerChar) {
    const dual = await gql(
      token,
      `query HealerDualZoneRankings(
  $name: String!
  $serverSlug: String!
  $serverRegion: String!
  $zoneID: Int!
) {
  characterData {
    character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
      healing: zoneRankings(
        zoneID: $zoneID
        metric: points_and_healing
        byBracket: true
        role: ${roleHealer}
        specName: ${JSON.stringify(healerChar.primarySpec)}
      )
      damage: zoneRankings(
        zoneID: $zoneID
        metric: points_and_damage
        byBracket: true
        role: ${roleHealer}
        specName: ${JSON.stringify(healerChar.primarySpec)}
      )
    }
  }
}`,
      {
        name: healerChar.name,
        serverSlug: healerChar.realm,
        serverRegion: healerChar.region,
        zoneID: ZONE_ID,
      },
    );
    const ch = dual.data?.characterData?.character;
    report.dualQuery = {
      accepted: dual.errors == null || dual.errors.length === 0,
      httpRequests: 1,
      costFromExt: dual.costFromExt,
      spentDelta: dual.spentDelta,
      errors: dual.errors,
      healing: summarizeThroughput(ch?.healing),
      damage: summarizeThroughput(ch?.damage),
    };
    writeFileSync(
      resolve(outDir, "healer_dual_query.summary.json"),
      JSON.stringify(report.dualQuery, null, 2),
    );
    report.steps.push({
      name: "healer_dual_query",
      costFromExt: dual.costFromExt,
      spentDelta: dual.spentDelta,
      accepted: report.dualQuery.accepted,
    });
    console.log(
      `DUAL QUERY accepted=${report.dualQuery.accepted} cost=${dual.costFromExt} healDungeons=${report.dualQuery.healing.dungeonCount} dmgDungeons=${report.dualQuery.damage.dungeonCount}`,
    );
  }

  // --- Mission D: encounterRankings dps/hps vs playerscore ---
  async function probeEncounter(label, character, metric, role, specName, encounterId) {
    if (!character) return null;
    const roleArg = role ? `role: ${role}` : "";
    const specArg = specName
      ? `specName: ${JSON.stringify(specName)}`
      : "";
    const res = await gql(
      token,
      `query ProbeEncounter_${label.replace(/[^A-Za-z0-9_]/g, "_")}(
  $name: String!
  $serverSlug: String!
  $serverRegion: String!
  $encounterID: Int!
) {
  characterData {
    character(name: $name, serverSlug: $serverSlug, serverRegion: $serverRegion) {
      encounterRankings(
        encounterID: $encounterID
        metric: ${metric}
        byBracket: true
        compare: Parses
        ${roleArg}
        ${specArg}
      )
    }
  }
}`,
      {
        name: character.name,
        serverSlug: character.realm,
        serverRegion: character.region,
        encounterID: encounterId,
      },
    );
    const raw = res.data?.characterData?.character?.encounterRankings;
    const summary = summarizeEncounterRanks(raw);
    const result = {
      character: character.name,
      request: { metric, role: role || null, specName: specName || null, encounterId },
      costFromExt: res.costFromExt,
      spentDelta: res.spentDelta,
      errors: res.errors,
      summary,
    };
    report.encounterRankings[label] = result;
    writeFileSync(
      resolve(outDir, `${label}.summary.json`),
      JSON.stringify(result, null, 2),
    );
    if (raw != null) {
      writeFileSync(
        resolve(outDir, `${label}.raw.min.json`),
        JSON.stringify(parseJsonScalar(raw), null, 2).slice(0, 120_000),
      );
    }
    report.steps.push({
      name: label,
      costFromExt: res.costFromExt,
      ranksCount: summary.ranksCount,
      errors: res.errors?.map((e) => e.message) ?? null,
    });
    console.log(
      `ENCOUNTER ${label}: ranks=${summary.ranksCount} metric=${summary.metric} cost=${res.costFromExt} err=${res.errors?.[0]?.message ?? "none"}`,
    );
    return result;
  }

  const encId = ENCOUNTERS["algethar-academy"];
  if (dpsChar) {
    await probeEncounter(
      "dps_encounter_playerscore",
      dpsChar,
      "playerscore",
      null,
      null,
      encId,
    );
    await probeEncounter(
      "dps_encounter_dps_role_spec",
      dpsChar,
      "dps",
      roleDps,
      dpsChar.primarySpec,
      encId,
    );
  }
  if (tankChar) {
    await probeEncounter(
      "tank_encounter_playerscore",
      tankChar,
      "playerscore",
      null,
      null,
      encId,
    );
    await probeEncounter(
      "tank_encounter_dps_role_spec",
      tankChar,
      "dps",
      roleTank,
      tankChar.primarySpec,
      encId,
    );
  }
  if (healerChar) {
    await probeEncounter(
      "healer_encounter_playerscore",
      healerChar,
      "playerscore",
      null,
      null,
      encId,
    );
    await probeEncounter(
      "healer_encounter_hps_role_spec",
      healerChar,
      "hps",
      roleHealer,
      healerChar.primarySpec,
      encId,
    );
    await probeEncounter(
      "healer_encounter_dps_role_spec",
      healerChar,
      "dps",
      roleHealer,
      healerChar.primarySpec,
      encId,
    );
  }

  // Coverage compare: for DPS, collect reportCode:fightID from playerscore
  // and see how many appear in dps metric.
  const ps = report.encounterRankings.dps_encounter_playerscore;
  const dpsEr = report.encounterRankings.dps_encounter_dps_role_spec;
  if (ps?.summary && dpsEr?.summary) {
    const psKeys = new Set(
      (ps.summary.matchedSample ?? [])
        .filter((r) => r.reportCode && r.fightID != null)
        .map((r) => `${r.reportCode}:${r.fightID}`),
    );
    // Re-fetch dps raw and count overlap against all playerscore ranks if available
    report.summary.encounterCoverageCompare = {
      dps: {
        playerscoreRanks: ps.summary.ranksCount,
        dpsMetricRanks: dpsEr.summary.ranksCount,
        playerscoreHasHistoricalPercent: ps.summary.rankFieldPresence?.historicalPercent,
        dpsHasHistoricalPercent: dpsEr.summary.rankFieldPresence?.historicalPercent,
        playerscoreHasRankPercent: ps.summary.rankFieldPresence?.rankPercent,
        dpsHasRankPercent: dpsEr.summary.rankFieldPresence?.rankPercent,
      },
      healer: healerChar
        ? {
            playerscoreRanks:
              report.encounterRankings.healer_encounter_playerscore?.summary
                ?.ranksCount ?? null,
            hpsRanks:
              report.encounterRankings.healer_encounter_hps_role_spec?.summary
                ?.ranksCount ?? null,
            dpsRanks:
              report.encounterRankings.healer_encounter_dps_role_spec?.summary
                ?.ranksCount ?? null,
          }
        : null,
      tank: tankChar
        ? {
            playerscoreRanks:
              report.encounterRankings.tank_encounter_playerscore?.summary
                ?.ranksCount ?? null,
            dpsRanks:
              report.encounterRankings.tank_encounter_dps_role_spec?.summary
                ?.ranksCount ?? null,
          }
        : null,
    };
  }

  const totalCost = report.steps.reduce(
    (s, st) => s + (typeof st.costFromExt === "number" ? st.costFromExt : 0),
    0,
  );
  report.summary.totalCostFromExt = totalCost;
  report.summary.gaps = {
    missingTank: tankChar == null,
    missingHealer: healerChar == null,
    missingDps: dpsChar == null,
  };

  writeFileSync(
    resolve(outDir, "REPORT.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(`\nWrote ${outDir}/REPORT.json totalCost≈${totalCost}`);
  console.log(
    JSON.stringify(
      {
        selected: report.summary.selected,
        gaps: report.summary.gaps,
        dualQuery: report.dualQuery
          ? {
              accepted: report.dualQuery.accepted,
              cost: report.dualQuery.costFromExt,
              healDungeons: report.dualQuery.healing.dungeonCount,
              dmgDungeons: report.dualQuery.damage.dungeonCount,
            }
          : null,
        encounterCoverageCompare: report.summary.encounterCoverageCompare,
        probeLabels: Object.keys(report.probes),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
