/**
 * Agent 01 provider-only Wallidrixe audit (no monorepo install required).
 * Loads Blizzard credentials from sibling .env; never prints secrets.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(path) {
  const out = {};
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const envPath =
  process.env.EXPERIENCE_AUDIT_ENV_PATH ??
  resolve(process.cwd(), "../scoring-audit/.env");
if (!existsSync(envPath)) throw new Error(`missing ${envPath}`);
const env = loadEnvFile(envPath);

const REGION = (env.BLIZZARD_DEFAULT_REGION || "eu").toLowerCase();
const REALM = "archimonde";
const NAME = "Wallidrixe";
const NAMESPACE_DYNAMIC = `dynamic-${REGION}`;
const NAMESPACE_PROFILE = `profile-${REGION}`;
const LOCALE = env.BLIZZARD_DEFAULT_LOCALE || "en_GB";

async function blizzardToken() {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
  });
  const auth = Buffer.from(
    `${env.BLIZZARD_CLIENT_ID}:${env.BLIZZARD_CLIENT_SECRET}`,
  ).toString("base64");
  const res = await fetch(`https://${REGION}.battle.net/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) throw new Error(`oauth ${res.status}`);
  const json = await res.json();
  return json.access_token;
}

async function blizzardGet(token, path, namespace) {
  const url = new URL(`https://${REGION}.api.blizzard.com${path}`);
  url.searchParams.set("namespace", namespace);
  url.searchParams.set("locale", LOCALE);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { status: res.status, ok: res.ok, json };
}

async function rioGet(path) {
  const res = await fetch(`https://raider.io${path}`);
  const json = await res.json();
  return { status: res.status, ok: res.ok, json };
}

function isCanonicalSlug(slug) {
  return /^season-[a-z]+-\d+$/i.test(String(slug || "").trim());
}

function parseStartMs(season) {
  const starts = season.starts || season.starts_at;
  if (typeof starts === "string") return Date.parse(starts);
  if (starts && typeof starts === "object") {
    const v = starts.eu || starts.us || Object.values(starts)[0];
    return typeof v === "string" ? Date.parse(v) : NaN;
  }
  return NaN;
}

function pickPreviousByStart(currentStart, seasons) {
  const eligible = seasons
    .map((s) => ({ slug: s.slug, start: parseStartMs(s), main: s.is_main_season }))
    .filter((s) => Number.isFinite(s.start) && s.start < currentStart);
  if (!eligible.length) return null;
  let best = -Infinity;
  for (const s of eligible) if (s.start > best) best = s.start;
  const tied = eligible.filter((s) => s.start === best);
  return tied.length === 1 ? tied[0] : { ambiguous: tied.map((t) => t.slug) };
}

const token = await blizzardToken();

const seasonIndex = await blizzardGet(
  token,
  "/data/wow/mythic-keystone/season/index",
  NAMESPACE_DYNAMIC,
);
const currentSeasonRef = seasonIndex.json?.current_season;
const currentSeasonId = currentSeasonRef?.id ?? null;

const seasonsDetailed = [];
for (const s of seasonIndex.json?.seasons ?? []) {
  const detail = await blizzardGet(
    token,
    `/data/wow/mythic-keystone/season/${s.id}`,
    NAMESPACE_DYNAMIC,
  );
  seasonsDetailed.push({
    id: s.id,
    name: detail.json?.name ?? null,
    start_timestamp: detail.json?.start_timestamp ?? null,
    end_timestamp: detail.json?.end_timestamp ?? null,
    status: detail.status,
  });
}

const currentDetail = seasonsDetailed.find((s) => s.id === currentSeasonId) ?? null;

// Recompute previous with Blizzard IDs properly
let previousSeason = null;
if (currentDetail?.start_timestamp != null) {
  const eligible = seasonsDetailed.filter(
    (s) =>
      s.id !== currentSeasonId &&
      s.start_timestamp != null &&
      s.start_timestamp < currentDetail.start_timestamp,
  );
  eligible.sort((a, b) => b.start_timestamp - a.start_timestamp);
  previousSeason = eligible[0] ?? null;
}

const previousProfile =
  previousSeason != null
    ? await blizzardGet(
        token,
        `/profile/wow/character/${REALM}/${NAME.toLowerCase()}/mythic-keystone-profile/season/${previousSeason.id}`,
        NAMESPACE_PROFILE,
      )
    : null;

const currentProfile = currentSeasonId
  ? await blizzardGet(
      token,
      `/profile/wow/character/${REALM}/${NAME.toLowerCase()}/mythic-keystone-profile/season/${currentSeasonId}`,
      NAMESPACE_PROFILE,
    )
  : null;

const rioProfile = await rioGet(
  `/api/v1/characters/profile?region=${REGION}&realm=${REALM}&name=${NAME}&fields=mythic_plus_scores_by_season:current:previous,previous_mythic_plus_ranks,mythic_plus_ranks`,
);
const rioExactPrev = await rioGet(
  `/api/v1/characters/profile?region=${REGION}&realm=${REALM}&name=${NAME}&fields=mythic_plus_scores_by_season:season-tww-3`,
);
const rioStatic11 = await rioGet(`/api/v1/mythic-plus/static-data?expansion_id=11`);
const rioStatic10 = await rioGet(`/api/v1/mythic-plus/static-data?expansion_id=10`);
const rioCutoffsPrev = await rioGet(
  `/api/v1/mythic-plus/season-cutoffs?region=${REGION}&season=season-tww-3`,
);

const mnSeasons = rioStatic11.json?.seasons ?? [];
const mn2 = mnSeasons.find((s) => s.slug === "season-mn-2");
const mn2Start = mn2 ? parseStartMs(mn2) : NaN;
const prevAll = Number.isFinite(mn2Start) ? pickPreviousByStart(mn2Start, mnSeasons) : null;
const prevCanonical = Number.isFinite(mn2Start)
  ? pickPreviousByStart(
      mn2Start,
      mnSeasons.filter((s) => isCanonicalSlug(s.slug)),
    )
  : null;
const prevMainFlag = Number.isFinite(mn2Start)
  ? pickPreviousByStart(
      mn2Start,
      mnSeasons.filter((s) => s.is_main_season === true),
    )
  : null;

const scores = rioProfile.json?.mythic_plus_scores_by_season ?? [];
const cut = rioCutoffsPrev.json?.cutoffs ?? {};

const report = {
  auditedAt: new Date().toISOString(),
  character: { region: REGION.toUpperCase(), realm: REALM, name: NAME },
  blizzard: {
    seasonIndexStatus: seasonIndex.status,
    currentSeasonId,
    currentSeason: currentDetail,
    previousSeason,
    currentProfile: {
      status: currentProfile?.status ?? null,
      rating:
        currentProfile?.json?.current_mythic_rating?.rating ??
        currentProfile?.json?.mythic_rating?.rating ??
        null,
      bestRuns: currentProfile?.json?.best_runs?.length ?? null,
    },
    previousProfile: {
      status: previousProfile?.status ?? null,
      rating:
        previousProfile?.json?.current_mythic_rating?.rating ??
        previousProfile?.json?.mythic_rating?.rating ??
        null,
      bestRuns: previousProfile?.json?.best_runs?.length ?? null,
      code: previousProfile?.json?.code ?? null,
      detail: previousProfile?.json?.detail ?? null,
      type: previousProfile?.json?.type ?? null,
    },
    allSeasons: seasonsDetailed,
  },
  raiderIo: {
    profileStatus: rioProfile.status,
    scoresBySeasonRequestedCurrentPrevious: scores.map((s) => ({
      season: s.season,
      all: s.scores?.all ?? null,
    })),
    previousRanks: rioProfile.json?.previous_mythic_plus_ranks ?? null,
    currentClassRankRegion: rioProfile.json?.mythic_plus_ranks?.class?.region ?? null,
    exactSeasonTww3: {
      status: rioExactPrev.status,
      season: rioExactPrev.json?.mythic_plus_scores_by_season?.[0]?.season ?? null,
      all: rioExactPrev.json?.mythic_plus_scores_by_season?.[0]?.scores?.all ?? null,
    },
    midnightSeasons: mnSeasons.map((s) => ({
      slug: s.slug,
      name: s.name,
      blizzard_season_id: s.blizzard_season_id,
      is_main_season: s.is_main_season,
      starts_eu: s.starts?.eu ?? null,
      ends_eu: s.ends?.eu ?? null,
      canonicalSlugRegex: isCanonicalSlug(s.slug),
    })),
    twwMainishSeasons: (rioStatic10.json?.seasons ?? [])
      .filter((s) => s.is_main_season || /break-the-meta|post|remix|cutoffs/i.test(s.slug))
      .map((s) => ({
        slug: s.slug,
        blizzard_season_id: s.blizzard_season_id,
        is_main_season: s.is_main_season,
        starts_eu: s.starts?.eu ?? null,
        canonicalSlugRegex: isCanonicalSlug(s.slug),
      })),
    cutoffsSeasonTww3: {
      status: rioCutoffsPrev.status,
      ui: rioCutoffsPrev.json?.ui ?? null,
      isRemappedSeason: cut.isRemappedSeason ?? null,
      nativeQuantileKeys: ["p999", "p990", "p900", "p750", "p600"].map((k) => ({
        key: k,
        score: cut[k]?.score ?? cut[k]?.all?.quantileMinValue ?? null,
        quantile: cut[k]?.all?.quantile ?? null,
      })),
      additionalNativeKeysPresent: Object.keys(cut).filter(
        (k) =>
          ![
            "updatedAt",
            "region",
            "p999",
            "p990",
            "p900",
            "p750",
            "p600",
            "graphData",
            "bracketDungeonLevels",
            "isRemappedSeason",
          ].includes(k),
      ),
    },
    simulateMn2BecomesCurrent: {
      previousAmongAllSeasons: prevAll,
      previousCanonicalSlugRegexOnly: prevCanonical,
      previousIsMainSeasonTrueOnly: prevMainFlag,
    },
  },
  inferredExperienceFailureModes: [],
};

// Infer likely PREVIOUS_EVIDENCE_UNAVAILABLE causes from product path
const prevRating = report.blizzard.previousProfile.rating;
const prevStatus = report.blizzard.previousProfile.status;
const rioPrevScore = scores[1]?.scores?.all ?? null;
if (prevStatus === 404) {
  report.inferredExperienceFailureModes.push(
    "BLIZZARD_PREVIOUS_SEASON_PROFILE_404 — requires RIO corroboration; RIO previous score is " +
      String(rioPrevScore),
  );
  if (rioPrevScore != null && rioPrevScore > 0) {
    report.inferredExperienceFailureModes.push(
      "RIO_CONTRADICTS_BLIZZARD_404 — path stays PROVIDER_FAILURE (not CONFIRMED_NO_ACTIVITY)",
    );
  } else {
    report.inferredExperienceFailureModes.push(
      "RIO_ZERO_OR_ABSENT — corroboratePreviousSeasonBlizzardNotFound can yield CONFIRMED_NO_ACTIVITY → E=0 if wired",
    );
  }
}
if (typeof prevRating === "number" && prevRating === 0) {
  report.inferredExperienceFailureModes.push(
    "BLIZZARD_RATING_ZERO_AS_HAS_VALUE — estimatePreviousSeasonStanding(0) → BELOW_SUPPORTED_RANGE → synthetic score 25 unless CONFIRMED_NO_ACTIVITY path used",
  );
}
if (cut.isRemappedSeason === true) {
  report.inferredExperienceFailureModes.push(
    "PREVIOUS_SEASON_CUTOFFS_IS_REMAPPED — historical cutoffs may fail policy validation / NO_USABLE_POLICY → MISSING_POPULATION_POLICY → PREVIOUS_EVIDENCE_UNAVAILABLE",
  );
}
if ((report.raiderIo.previousRanks?.class?.region ?? 0) === 0) {
  report.inferredExperienceFailureModes.push(
    "PREVIOUS_CLASS_RANK_ZERO — usablePreviousRegionalClassRank rejects <=0; no class-rank floor fallback",
  );
}

const out = resolve(
  process.cwd(),
  ".cursor-orchestration/2026-08-experience-evidence-completion/common/AGENT01_WALLIDRIXE_RUNTIME.json",
);
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      wrote: out,
      currentSeasonId,
      previousSeasonId: previousSeason?.id ?? null,
      blizzardPreviousStatus: prevStatus,
      blizzardPreviousRating: prevRating,
      rioPreviousSeason: scores[1]?.season ?? null,
      rioPreviousScore: rioPrevScore,
      mn2PreviousTrap: report.raiderIo.simulateMn2BecomesCurrent,
      inferred: report.inferredExperienceFailureModes,
    },
    null,
    2,
  ),
);
