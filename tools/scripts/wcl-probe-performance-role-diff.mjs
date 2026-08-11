/**
 * Differential role/spec filter proof for Agent 04A.
 * Usage: node tools/scripts/with-env.mjs node tools/scripts/wcl-probe-performance-role-diff.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

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
    errors: body.errors ?? null,
    data: body.data ?? null,
    spentDelta: before != null && after != null ? after - before : null,
    cost: body.extensions?.rateLimit?.cost ?? null,
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

function summarize(raw) {
  const p = parse(raw);
  if (p == null || typeof p !== "object") return null;
  const thr = p.throughputRankings ?? {};
  const rows = Object.entries(thr).map(([id, r]) => ({ id, ...r }));
  const avg = (k) =>
    rows.length
      ? rows.reduce((s, r) => s + (typeof r[k] === "number" ? r[k] : 0), 0) /
        rows.length
      : null;
  return {
    metric: p.metric ?? null,
    topKeys: Object.keys(p),
    bestAvg: p.bestPerformanceAverage ?? null,
    medAvg: p.medianPerformanceAverage ?? null,
    dungeons: rows.length,
    rankingsCount: Array.isArray(p.rankings) ? p.rankings.length : 0,
    avgBestPct: avg("best_historical_percentile"),
    avgMedianPct: avg("median_historical_percentile"),
    avgPerSecond: avg("best_per_second_amount"),
    allStars: (p.allStars ?? []).map((s) => ({
      spec: s.spec,
      points: s.points,
      total: s.total,
      rankPercent: s.rankPercent,
    })),
    rankingSpecs: [
      ...new Set((p.rankings ?? []).map((r) => r.spec).filter(Boolean)),
    ],
    sampleRank: p.rankings?.[0]
      ? {
          spec: p.rankings[0].spec,
          bestSpec: p.rankings[0].bestSpec,
          bestAmount: p.rankings[0].bestAmount,
          class: p.rankings[0].bestRank?.class ?? null,
          specId: p.rankings[0].bestRank?.spec ?? null,
          perSecond: p.rankings[0].bestRank?.per_second_amount ?? null,
        }
      : null,
    // For dps metric without throughputRankings: peek rankings percentiles
    rankingPctSample: (p.rankings ?? []).slice(0, 2).map((r) => ({
      encounter: r.encounter?.name ?? r.encounter?.id ?? null,
      rankPercent: r.rankPercent ?? null,
      medianPercent: r.medianPercent ?? null,
      bestAmount: r.bestAmount ?? null,
      spec: r.spec ?? null,
    })),
  };
}

const PROBES = [
  ["aspha_heal_Healer_Restoration", "Aspha", "garona", "points_and_healing", "Healer", "Restoration"],
  ["aspha_dmg_Healer_Restoration", "Aspha", "garona", "points_and_damage", "Healer", "Restoration"],
  ["aspha_dmg_DPS_Restoration", "Aspha", "garona", "points_and_damage", "DPS", "Restoration"],
  ["aspha_dmg_Healer_Holy", "Aspha", "garona", "points_and_damage", "Healer", "Holy"],
  ["aspha_dmg_Any_Restoration", "Aspha", "garona", "points_and_damage", "Any", "Restoration"],
  ["aspha_healercombineddps", "Aspha", "garona", "healercombineddps", "Healer", "Restoration"],
  ["wall_dmg_Healer_Demonology", "Wallidrixe", "archimonde", "points_and_damage", "Healer", "Demonology"],
  ["wall_dmg_DPS_Demonology", "Wallidrixe", "archimonde", "points_and_damage", "DPS", "Demonology"],
  ["zam_dmg_Tank_Guardian", "Zam", "hyjal", "points_and_damage", "Tank", "Guardian"],
  ["zam_dmg_DPS_Guardian", "Zam", "hyjal", "points_and_damage", "DPS", "Guardian"],
  ["zam_dmg_Tank_Protection", "Zam", "hyjal", "points_and_damage", "Tank", "Protection"],
  ["zam_char_identity", "Zam", "hyjal", "points_and_damage", null, null],
  ["aspha_char_identity", "Aspha", "garona", "points_and_healing", null, null],
];

async function main() {
  const token = await getToken();
  const outDir = resolve("tmp/wcl-performance-role-aware-04a");
  mkdirSync(outDir, { recursive: true });
  const out = {};

  for (const [label, name, realm, metric, role, spec] of PROBES) {
    const roleArg = role ? `role: ${role}` : "";
    const specArg = spec ? `specName: "${spec}"` : "";
    const safe = label.replace(/[^A-Za-z0-9_]/g, "_");
    const query = `query Diff_${safe}(
  $n: String!
  $s: String!
  $r: String!
  $z: Int!
) {
  characterData {
    character(name: $n, serverSlug: $s, serverRegion: $r) {
      id
      name
      classID
      zoneRankings(
        zoneID: $z
        metric: ${metric}
        byBracket: true
        ${roleArg}
        ${specArg}
      )
    }
  }
}`;
    const res = await gql(token, query, {
      n: name,
      s: realm,
      r: "EU",
      z: 47,
    });
    const ch = res.data?.characterData?.character;
    out[label] = {
      spentDelta: res.spentDelta,
      cost: res.cost,
      errors: res.errors?.map((e) => e.message) ?? null,
      classID: ch?.classID ?? null,
      request: { metric, role, spec },
      summary: summarize(ch?.zoneRankings),
    };
    console.log(
      label,
      "classID=",
      ch?.classID,
      "dungeons=",
      out[label].summary?.dungeons,
      "bestAvg=",
      out[label].summary?.bestAvg,
      "avgPerSec=",
      out[label].summary?.avgPerSecond?.toFixed?.(1),
      "err=",
      out[label].errors?.[0] ?? "none",
    );
  }

  writeFileSync(resolve(outDir, "DIFF_FILTERS.json"), JSON.stringify(out, null, 2));
  console.log("Wrote DIFF_FILTERS.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
