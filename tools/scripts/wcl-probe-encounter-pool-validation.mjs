/**
 * Live end-to-end validation: encounterRankings for every active-season dungeon.
 * Usage: node tools/scripts/with-env.mjs node tools/scripts/wcl-probe-encounter-pool-validation.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  CURRENT_MPLUS_ZONE_ENCOUNTER_IDS,
  ENCOUNTER_DUNGEON_MAP,
  buildAliasedEncounterRankingsQuery,
  requireActiveDungeonEncounters,
  mapAliasedEncounterRankings,
  rankingsToEncounterCandidates,
  summarizeEncounterRanksPayload,
  parseAliasedEncounterPayloads,
  encounterObservationsToZoneRankingsPayload,
  resolveRankingParseFromZoneRankings,
  timedEligibleCoverageByDungeon,
} from "../../packages/providers/warcraftlogs/dist/index.js";
import { EVIDENCE_SELECTOR_VERSION } from "../../packages/contracts/dist/index.js";
import {
  buildEvidenceAcquisitionPlanV2,
  finalizeEvidenceManifestV2,
} from "../../packages/scoring/dist/index.js";

function envFlag(v, d = false) {
  if (v === undefined || v === "") return d;
  return ["1", "true", "yes", "on"].includes(String(v).trim().toLowerCase());
}

async function getToken() {
  const id = process.env.WCL_CLIENT_ID ?? "";
  const secret = process.env.WCL_CLIENT_SECRET ?? "";
  const tokenUrl = process.env.WCL_TOKEN_URL ?? "https://www.warcraftlogs.com/oauth/token";
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`token ${res.status}`);
  return (await res.json()).access_token;
}

async function rate(token) {
  const url = process.env.WCL_PUBLIC_GRAPHQL_URL ?? "https://www.warcraftlogs.com/api/v2/client";
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      operationName: "RateLimitData",
      query: `query RateLimitData { rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn } }`,
    }),
  });
  return (await res.json()).data?.rateLimitData ?? null;
}

async function gql(token, query, variables) {
  const operationName = query.match(/\bquery\s+([A-Za-z_]+)/)?.[1];
  const url = process.env.WCL_PUBLIC_GRAPHQL_URL ?? "https://www.warcraftlogs.com/api/v2/client";
  const before = await rate(token);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ operationName, query, variables }),
  });
  const body = await res.json();
  const after = await rate(token);
  return {
    body,
    spentDelta:
      before && after ? after.pointsSpentThisHour - before.pointsSpentThisHour : null,
    errors: body.errors ?? null,
  };
}

async function main() {
  if (!envFlag(process.env.ALLOW_LIVE_PROVIDER_CALLS)) {
    console.error("FAIL: ALLOW_LIVE_PROVIDER_CALLS must be true");
    process.exit(1);
  }

  const activeSlugs = CURRENT_MPLUS_ZONE_ENCOUNTER_IDS.map((id) => ENCOUNTER_DUNGEON_MAP[id]);
  // Simulate SeasonDungeon authority bindings (same source as sync catalog).
  const authoritativeEncounters = CURRENT_MPLUS_ZONE_ENCOUNTER_IDS.map((id) => ({
    dungeonSlug: ENCOUNTER_DUNGEON_MAP[id],
    encounterId: id,
  }));
  const encounters = requireActiveDungeonEncounters({
    activeDungeonSlugs: activeSlugs,
    authoritativeEncounters,
  });

  const aliased = buildAliasedEncounterRankingsQuery(encounters);
  const token = await getToken();

  let graphqlPosts = 0;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).includes("/api/v2/client") && init?.method === "POST") graphqlPosts += 1;
    return origFetch(input, init);
  };

  const started = Date.now();
  const result = await gql(token, aliased.query, {
    name: "Wallidrixe",
    serverSlug: "archimonde",
    serverRegion: "EU",
  });
  globalThis.fetch = origFetch;

  if (result.errors?.length) {
    console.error(JSON.stringify(result.errors, null, 2));
    process.exit(1);
  }

  const character = result.body.data?.characterData?.character ?? null;
  const perDungeonPayloads = parseAliasedEncounterPayloads({
    characterPayload: character,
    encounters,
  });

  const observations = mapAliasedEncounterRankings({
    characterPayload: character,
    encounters,
    zoneId: 47,
  });
  const slugByEncounter = new Map(encounters.map((e) => [e.encounterId, e.dungeonSlug]));
  const candidates = rankingsToEncounterCandidates(observations, slugByEncounter);
  const coverage = timedEligibleCoverageByDungeon(candidates, activeSlugs);

  const meta = candidates.map((c) => ({
    discoveryIdentity: { reportCode: c.reportCode, fightId: c.fightId },
    reportRevision: null,
    dungeonSlug: c.dungeonSlug,
    keyLevel: c.keyLevel,
    timed: c.timed,
    runScore: c.score,
    evidenceCompleteness: 1,
    completedAt: c.completedAt,
    fightDurationMs: c.durationMs,
    actorId: 1,
    accessState: "PUBLIC",
    identityResolution: "RESOLVED",
    fightAccessible: true,
    hardError: false,
    discoverySource: c.source,
  }));

  const scope = {
    characterId: "wallidrixe",
    seasonId: "midnight-s1",
    seasonSlug: "midnight-season-1",
    specializationId: "demo",
    classSlug: "warlock",
    specSlug: "demonology",
    role: "DPS",
    refreshContractHash: "live-validate",
    selectorVersion: EVIDENCE_SELECTOR_VERSION,
    evidenceCutoffAt: new Date().toISOString(),
    highKeyPolicyId: "high-key-v1",
    activeDungeonSlugs: activeSlugs,
  };

  const { plan } = buildEvidenceAcquisitionPlanV2({
    scope,
    candidates: meta,
    plannedAt: new Date().toISOString(),
  });
  const seen = new Set();
  const acquisition = [];
  for (const slot of plan.slots) {
    for (const c of slot.orderedCandidates) {
      const key = `${c.discoveryIdentity.reportCode}:${c.discoveryIdentity.fightId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      acquisition.push({
        discoveryIdentity: { ...c.discoveryIdentity },
        acquisitionStatus: "ACQUIRED",
        reportRevision: 1,
        rejectionReason: null,
        rejectionDetail: null,
        datasetHashes: [],
        factSetHash: `f-${key}`,
        dimensionValidity: {
          performance: "VALID",
          survival: "VALID",
          utility: "VALID",
          reasons: [],
        },
        keyLevel: c.keyLevel,
        timed: c.timed,
        runScore: c.runScore,
        completedAt: c.completedAt,
        actorId: c.actorId,
        evidenceCompleteness: c.evidenceCompleteness,
      });
    }
  }
  const { manifest } = finalizeEvidenceManifestV2({
    plan,
    acquisitionResults: acquisition,
    selectedAt: new Date().toISOString(),
  });
  const selected = manifest.slots.filter((s) => s.state === "SELECTED");

  const zonePayload = encounterObservationsToZoneRankingsPayload(observations, 47);
  const rankingEvidence = selected.map((s) => {
    const resolved = resolveRankingParseFromZoneRankings({
      payload: zonePayload,
      zoneId: 47,
      reportCode: s.identity.reportCode,
      fightId: s.identity.fightId,
      reportRevision: s.identity.reportRevision ?? 1,
      dungeonSlug: s.dungeonSlug,
      keyLevel: s.keyLevel,
    });
    return {
      dungeonSlug: s.dungeonSlug,
      reportCode: s.identity.reportCode,
      fightId: s.identity.fightId,
      keyLevel: s.keyLevel,
      rankPercent: resolved.evidence?.rankPercent ?? null,
      unavailableReason: resolved.unavailableReason,
    };
  });

  const table = perDungeonPayloads.map((row) => {
    const summary = summarizeEncounterRanksPayload(row);
    const selectedRuns = selected
      .filter((s) => s.dungeonSlug === row.dungeonSlug)
      .map((s) => `${s.identity.reportCode}:${s.identity.fightId}`)
      .join(",");
    return { ...summary, selectedRuns, selectedCount: selectedRuns ? selectedRuns.split(",").length : 0 };
  });

  const withRank = rankingEvidence.filter((r) => r.rankPercent != null).length;
  const missingRank = rankingEvidence.filter((r) => r.rankPercent == null);

  const report = {
    activeDungeonCount: encounters.length,
    aliasesInQuery: aliased.query.match(/encounterRankings\(/g)?.length ?? 0,
    graphqlHttpForAliasedQuery: 1,
    rateLimitProbesExtra: graphqlPosts - 1,
    spentDeltaPoints: result.spentDelta,
    durationMs: Date.now() - started,
    coverage,
    selectedSlotCount: selected.length,
    expectedSlots: activeSlugs.length * 2,
    distinctSelectedIdentities: new Set(
      selected.map((s) => `${s.identity.reportCode}:${s.identity.fightId}`),
    ).size,
    rankingEvidenceWithPercent: withRank,
    rankingEvidenceMissing: missingRank.length,
    rankingEvidenceMissingDetails: missingRank,
    table,
  };

  const outDir = resolve("tmp/wcl-encounter-pool-validation");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "report.json"), JSON.stringify(report, null, 2));

  console.log(
    "dungeonSlug | encounterId | rankRows | logBackedRows | timedRows | eligibleRows | selectedRuns",
  );
  for (const row of table) {
    console.log(
      [
        row.dungeonSlug,
        row.encounterId,
        row.rankRows,
        row.logBackedRows,
        row.timedRows,
        row.eligibleRows,
        row.selectedRuns || "-",
      ].join(" | "),
    );
  }
  console.log(
    JSON.stringify(
      {
        acceptance: {
          dungeonsResolved: `${encounters.length}/${activeSlugs.length}`,
          includedInQuery: `${report.aliasesInQuery}/${activeSlugs.length}`,
          selectedOverall: `${selected.length}/${report.expectedSlots}`,
          rankingEvidence: `${withRank}/${selected.length}`,
        },
        spentDeltaPoints: result.spentDelta,
        graphqlHttpForAliasedQuery: 1,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
