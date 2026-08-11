/**
 * Agent 04B live diagnostic — role-aware Performance from WCL aggregates only.
 * Usage: node tools/scripts/with-env.mjs node tools/scripts/wcl-probe-performance-role-aware-04b.mjs
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
  const res = await fetch(
    process.env.WCL_TOKEN_URL ?? "https://www.warcraftlogs.com/oauth/token",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    },
  );
  if (!res.ok) throw new Error(`token ${res.status}`);
  return (await res.json()).access_token;
}

async function rate(token) {
  const res = await fetch("https://www.warcraftlogs.com/api/v2/client", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      operationName: "RateLimitData",
      query: `query RateLimitData { rateLimitData { pointsSpentThisHour } }`,
    }),
  });
  return (await res.json()).data?.rateLimitData?.pointsSpentThisHour ?? null;
}

async function gql(token, query, variables) {
  const op = query.match(/\bquery\s+([A-Za-z0-9_]+)/)?.[1];
  const before = await rate(token);
  const res = await fetch("https://www.warcraftlogs.com/api/v2/client", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ operationName: op, query, variables }),
  });
  const body = await res.json();
  const after = await rate(token);
  return {
    errors: body.errors,
    data: body.data,
    spentDelta: before != null && after != null ? after - before : null,
  };
}

function parse(v) {
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}

function channelScore(raw, activeCount = 8) {
  const p = parse(raw);
  if (!p?.throughputRankings) return null;
  const rows = Object.values(p.throughputRankings);
  const bests = rows
    .map((r) => r.best_historical_percentile)
    .filter((n) => typeof n === "number");
  const meds = rows
    .map((r) => r.median_historical_percentile)
    .filter((n) => typeof n === "number");
  const bestAvg = bests.length ? bests.reduce((a, b) => a + b, 0) / bests.length : null;
  const medAvg = meds.length ? meds.reduce((a, b) => a + b, 0) / meds.length : null;
  const availableCells = bests.length + meds.length;
  // Approximate: if every dungeon has both, cells = 2 * dungeonCount
  const expectedCells = activeCount * 2;
  const score =
    bestAvg != null && medAvg != null
      ? 0.45 * bestAvg + 0.55 * medAvg
      : bestAvg ?? medAvg;
  const coverage = expectedCells ? availableCells / expectedCells : 0;
  return {
    dungeonCount: rows.length,
    bestAvg,
    medAvg,
    score,
    availableCells,
    expectedCells,
    confidence: Math.min(1, coverage),
    specs: (p.allStars ?? []).map((s) => s.spec),
  };
}

const CHARS = [
  {
    label: "DPS",
    role: "DPS",
    name: "Wallidrixe",
    realm: "archimonde",
    spec: "Demonology",
  },
  {
    label: "TANK",
    role: "TANK",
    name: "Zam",
    realm: "hyjal",
    spec: "Guardian",
  },
  {
    label: "HEALER",
    role: "HEALER",
    name: "Aspha",
    realm: "garona",
    spec: "Restoration",
  },
  {
    label: "LFG",
    role: "DPS",
    name: "Lfgmasochist",
    realm: "ysondre",
    spec: "Elemental",
  },
];

async function main() {
  if (!envFlag(process.env.ALLOW_LIVE_PROVIDER_CALLS)) {
    console.error("ALLOW_LIVE_PROVIDER_CALLS required");
    process.exit(1);
  }
  const token = await getToken();
  const outDir = resolve("tmp/wcl-performance-role-aware-04b");
  mkdirSync(outDir, { recursive: true });
  const report = { generatedAt: new Date().toISOString(), characters: [] };

  for (const c of CHARS) {
    const before = await rate(token);
    let spentDelta;
    let damageRaw;
    let healingRaw = null;
    let http = 1;
    if (c.role === "HEALER") {
      const res = await gql(
        token,
        `query HealerDual($n:String!,$s:String!,$r:String!,$z:Int!){
          characterData{character(name:$n,serverSlug:$s,serverRegion:$r){
            healing: zoneRankings(zoneID:$z, metric:points_and_healing, byBracket:true)
            damage: zoneRankings(zoneID:$z, metric:points_and_damage, byBracket:true)
          }}
        }`,
        { n: c.name, s: c.realm, r: "EU", z: 47 },
      );
      spentDelta = res.spentDelta;
      damageRaw = res.data?.characterData?.character?.damage;
      healingRaw = res.data?.characterData?.character?.healing;
    } else {
      const res = await gql(
        token,
        `query DpsTank($n:String!,$s:String!,$r:String!,$z:Int!){
          characterData{character(name:$n,serverSlug:$s,serverRegion:$r){
            damage: zoneRankings(zoneID:$z, metric:points_and_damage, byBracket:true)
          }}
        }`,
        { n: c.name, s: c.realm, r: "EU", z: 47 },
      );
      spentDelta = res.spentDelta;
      damageRaw = res.data?.characterData?.character?.damage;
    }
    const after = await rate(token);
    const damage = channelScore(damageRaw);
    const healing = healingRaw ? channelScore(healingRaw) : null;
    let finalScore = null;
    let finalConf = null;
    let weights = null;
    if (c.role === "DPS" && damage?.score != null) {
      // Cooldown not computed in this lightweight probe — report parse-only + note.
      weights = { damageParse: 0.8, cooldown: 0.2, note: "cooldown not probed here" };
      finalScore = damage.score; // parse component only for live print
      finalConf = damage.confidence;
    } else if (c.role === "TANK" && damage?.score != null) {
      weights = { damageParse: 1 };
      finalScore = damage.score;
      finalConf = damage.confidence;
    } else if (c.role === "HEALER" && damage?.score != null && healing?.score != null) {
      weights = { healingParse: 0.65, damageParse: 0.35 };
      finalScore = 0.65 * healing.score + 0.35 * damage.score;
      finalConf = 0.65 * healing.confidence + 0.35 * damage.confidence;
    }
    const row = {
      label: c.label,
      role: c.role,
      spec: c.spec,
      name: c.name,
      realm: c.realm,
      providerHttpCalls: http,
      spentDelta: spentDelta ?? (after != null && before != null ? after - before : null),
      damageParseScore: damage?.score ?? null,
      damageParseConfidence: damage?.confidence ?? null,
      damageCoverage: damage
        ? `${damage.availableCells}/${damage.expectedCells}`
        : null,
      healingParseScore: healing?.score ?? null,
      healingParseConfidence: healing?.confidence ?? null,
      healingCoverage: healing
        ? `${healing.availableCells}/${healing.expectedCells}`
        : null,
      cooldownScore: c.role === "DPS" ? "(not probed in 04b live helper)" : null,
      weightsApplied: weights,
      finalPerformanceParseOnly: finalScore,
      finalConfidenceParseOnly: finalConf,
      observedSpecs: damage?.specs ?? [],
      lfgmasochistNote:
        c.name === "Lfgmasochist"
          ? "Before 04B: profile_only dominated conf (~0.28→0.43). After: damage parse conf tracks Best/Median cell coverage (no profile_only)."
          : null,
    };
    report.characters.push(row);
    console.log(JSON.stringify(row, null, 2));
  }

  writeFileSync(resolve(outDir, "LIVE_04B.json"), JSON.stringify(report, null, 2));
  console.log("Wrote", resolve(outDir, "LIVE_04B.json"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
