/**
 * Bounded recentReports → fight/masterData hydration.
 * Stubs (fightUnknown) are expanded into Mythic+ candidates before discoverCharacterRuns filtering.
 *
 * Coverage-aware mode (when activeDungeonSlugs is provided) hydrates progressively until
 * every active dungeon has TARGET_ELIGIBLE_CANDIDATES_PER_DUNGEON distinct *timed-eligible*
 * reportCode+fightId identities (`timed === true`, matching plan eligibility), the explicit
 * report budget is exhausted, or no more public stubs remain. Untimed / timer-unknown fights
 * must not fill coverage or early-stop would strand SELECTED slots. Same reportCode is never
 * fetched twice in one call.
 */
import type { IsoDateTime } from "@mplus/contracts";
import type { WclRunCandidate } from "../types.js";
import {
  HYDRATION_HINT_WINDOW_MS,
  MAX_FIGHTS_PER_HYDRATED_REPORT,
  MAX_HYDRATION_REPORTS,
  TARGET_ELIGIBLE_CANDIDATES_PER_DUNGEON,
} from "./bounds.js";
import {
  extractFriendlyPlayerActorIds,
  resolveFightOwnership,
  type FightOwnershipRejectionReason,
} from "./fight-ownership.js";
import { ENCOUNTER_DUNGEON_MAP } from "./run-discovery.js";

export interface HydrationHint {
  completedAt: IsoDateTime;
  dungeonSlug?: string;
  keyLevel?: number;
  /** When set, stubs with this reportCode inherit dungeonSlug before fetch. */
  reportCode?: string;
}

export type OmittedHydrationReason =
  | "REPORT_EXCLUDED_BY_HYDRATION_CAP"
  | "REPORT_ALREADY_COVERED_DUNGEON_DEFERRED"
  | "REPORT_LEFT_UNHYDRATED_NO_MORE_BUDGET";

export interface OmittedHydrationReport {
  reportCode: string;
  reason: OmittedHydrationReason;
  /** Known or hinted dungeon when available. */
  dungeonSlug: string | null;
  startTimeMs: number | null;
  /** 0-based index in deterministic listed-report exploration order. */
  listedOrderIndex?: number | null;
}

export interface HydrationActor {
  id: number;
  name: string;
  type: string;
  server?: string | null;
}

export interface HydrationFight {
  id: number;
  encounterID?: number | null;
  name?: string | null;
  difficulty?: number | null;
  kill?: boolean | null;
  startTime: number;
  endTime: number;
  keystoneLevel?: number | null;
  /** WCL +1/+2/+3 when timed; 0 depleted; null/undefined unknown. */
  keystoneBonus?: number | null;
  /** Keystone completion duration (ms) when present on ReportFight. */
  keystoneTime?: number | null;
  /** True while the fight is still being logged. */
  inProgress?: boolean | null;
  friendlyPlayers?: Array<number | { id: number; name?: string; server?: string }>;
}

/**
 * Derive Mythic+ timed state from WCL keystoneBonus only.
 * Never invent timed=true without bonus evidence.
 */
export function timedFromKeystoneBonus(keystoneBonus: number | null | undefined): boolean | null {
  if (typeof keystoneBonus !== "number" || !Number.isFinite(keystoneBonus)) return null;
  if (keystoneBonus > 0) return true;
  if (keystoneBonus === 0) return false;
  return null;
}

export interface HydrationReportPayload {
  code: string;
  /** Authoritative WCL report revision when present in GraphQL payload. */
  revision?: number | null;
  startTime: number;
  endTime?: number | null;
  visibility?: string | null;
  zone?: { id: number; name?: string | null } | null;
  fights: HydrationFight[];
  masterData?: { actors?: HydrationActor[] } | null;
}

export type FetchReportForHydration = (reportCode: string) => Promise<HydrationReportPayload | null>;

export type HydrationStopReason =
  | "full_coverage"
  | "budget_exhausted"
  | "no_more_reports"
  | "legacy_fixed_budget";

export interface HydrationCoverageDiagnostics {
  /** Unique fightUnknown stubs discovered before hydration. */
  recentReportsDiscovered: number;
  /**
   * Unique fetchReport invocations attempted (strict maxReports budget).
   * Alias retained for callers that read reportsConsideredForHydration.
   */
  reportsConsideredForHydration: number;
  /** Same as reportsConsideredForHydration — explicit attempt count. */
  reportFetchAttempts: number;
  /** Successful non-null report payloads returned. */
  reportsHydrated: number;
  /** Fetch attempts that returned null or threw. */
  reportsFailedOrEmpty: number;
  /** Unique stubs still unattempted when stopping. */
  reportsLeftUnhydratedBudget: number;
  /** Distinct eligible reportCode:fightId identities per active dungeon. */
  candidatesProducedPerDungeon: Record<string, number>;
  distinctCandidatesPerDungeon: Record<string, number>;
  targetCandidatesPerDungeon: number;
  targetCoverageReached: boolean;
  stopReason: HydrationStopReason;
  /** Bounded structured rejection counts (no raw WCL payloads). */
  rejectionCountsByReason: Record<string, number>;
  /** Reports listed as stubs but never fetched — exact omission reason. */
  omittedReports: OmittedHydrationReport[];
}

export function slugifyDungeonName(value: string): string {
  const hasPossessiveS = /['’]s\b/i.test(value);
  let slug = value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    ;

  if (hasPossessiveS) {
    // "Maisara's Caverns" -> "maisara-caverns" instead of "maisaras-caverns"
    slug = slug.replace(/^([a-z0-9]+)s-/, "$1-");
  }

  return slug;
}

export function resolveDungeonSlug(
  fight: HydrationFight,
  reportZoneName?: string | null,
): string | null {
  if (fight.encounterID != null && ENCOUNTER_DUNGEON_MAP[fight.encounterID]) {
    return ENCOUNTER_DUNGEON_MAP[fight.encounterID]!;
  }
  // For recentReports hydration, `fight.name` can be a boss/encounter name,
  // while `reportZoneName` is the actual dungeon/zone. Prefer the zone name
  // so we don't emit non-canonical dungeon slugs.
  const reportZoneTrimmed = reportZoneName?.trim() ?? null;
  const reportZoneLower = reportZoneTrimmed?.toLowerCase() ?? null;
  const looksLikeMplusContainerZone =
    reportZoneLower === "mythic" ||
    reportZoneLower === "mythic+" ||
    reportZoneLower?.startsWith("mythic+");

  if (fight.name && fight.name.trim()) {
    // WCL "report.zone.name" is often "Mythic+" even when the dungeon is
    // not encoded there (unit tests cover this). In that case we must
    // fall back to `fight.name`.
    if (reportZoneTrimmed && !looksLikeMplusContainerZone) {
      return slugifyDungeonName(reportZoneTrimmed);
    }
    return slugifyDungeonName(fight.name);
  }
  if (reportZoneTrimmed && !looksLikeMplusContainerZone) {
    return slugifyDungeonName(reportZoneTrimmed);
  }
  return null;
}

/** Mythic+ fights expose a keystone level; raid/trash do not. */
export function isMythicPlusFight(fight: HydrationFight): boolean {
  return typeof fight.keystoneLevel === "number" && fight.keystoneLevel > 0;
}

/**
 * Resolve the target actor for a fight only when masterData identity matches
 * AND the actor is present in fight.friendlyPlayers.
 * Returns null when ownership cannot be proven (callers should prefer
 * {@link resolveFightTargetForHydration} for structured rejection reasons).
 */
export function resolveTargetActorId(
  actors: HydrationActor[],
  friendlyPlayers: HydrationFight["friendlyPlayers"],
  characterName: string,
  realmSlug: string,
): number | null {
  const ownership = resolveFightOwnership({
    actors,
    friendlyPlayers,
    characterName,
    realmSlug,
    requireMythicPlus: false,
  });
  return ownership.ok ? ownership.targetActorId : null;
}

export function resolveFightTargetForHydration(
  fight: HydrationFight,
  actors: HydrationActor[],
  characterName: string,
  realmSlug: string,
):
  | { ok: true; targetActorId: number; fightFriendlyPlayerActorIds: number[] }
  | { ok: false; reason: FightOwnershipRejectionReason; targetActorId: number | null; fightFriendlyPlayerActorIds: number[] } {
  const ownership = resolveFightOwnership({
    actors,
    friendlyPlayers: fight.friendlyPlayers,
    characterName,
    realmSlug,
    keystoneLevel: fight.keystoneLevel,
    inProgress: fight.inProgress,
    requireMythicPlus: true,
  });
  if (ownership.ok) {
    return {
      ok: true,
      targetActorId: ownership.targetActorId,
      fightFriendlyPlayerActorIds: ownership.fightFriendlyPlayerActorIds,
    };
  }
  return {
    ok: false,
    reason: ownership.reason,
    targetActorId: ownership.targetActorId,
    fightFriendlyPlayerActorIds: ownership.fightFriendlyPlayerActorIds,
  };
}

export { extractFriendlyPlayerActorIds };

function normalizeDungeonSlug(slug: string | null | undefined): string | null {
  if (!slug?.trim()) return null;
  return slug.trim().toLowerCase();
}

function candidateIdentityKey(reportCode: string, fightId: number): string {
  return `${reportCode}:${fightId}`;
}

/**
 * Hydration early-stop coverage must match scoring plan eligibility:
 * active-pool dungeon + known fight + keyLevel + timed === true.
 * Untimed / timer-unknown M+ fights remain discoverable candidates but do not
 * satisfy TARGET_ELIGIBLE_CANDIDATES_PER_DUNGEON (otherwise hydration stops
 * before a second timed run is found → selection shortfall).
 */
export function countsTowardHydrationCoverage(candidate: {
  keyLevel: number | null;
  timed: boolean | null;
  fightId: number;
  incompleteness: { fightUnknown: boolean };
}): boolean {
  if (candidate.incompleteness.fightUnknown) return false;
  if (candidate.fightId <= 0) return false;
  if (candidate.keyLevel == null || candidate.keyLevel <= 0) return false;
  return candidate.timed === true;
}

function emptyCoverageMap(activeDungeonSlugs: readonly string[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const slug of activeDungeonSlugs) {
    const normalized = normalizeDungeonSlug(slug);
    if (normalized) map.set(normalized, new Set());
  }
  return map;
}

function isFullCoverage(
  coverage: Map<string, Set<string>>,
  targetPerDungeon: number,
): boolean {
  if (coverage.size === 0) return false;
  for (const identities of coverage.values()) {
    if (identities.size < targetPerDungeon) return false;
  }
  return true;
}

function underCoveredDungeons(
  coverage: Map<string, Set<string>>,
  targetPerDungeon: number,
): Set<string> {
  const under = new Set<string>();
  for (const [slug, identities] of coverage) {
    if (identities.size < targetPerDungeon) under.add(slug);
  }
  return under;
}

/** Deficit: 0 identities → 0 (highest priority), 1 → 1, at-target → Infinity. */
function dungeonDeficit(
  coverage: Map<string, Set<string>>,
  slug: string,
  targetPerDungeon: number,
): number {
  const n = coverage.get(slug)?.size ?? 0;
  if (n >= targetPerDungeon) return Number.POSITIVE_INFINITY;
  return n;
}

function annotateStubDungeonFromHints(
  stub: WclRunCandidate,
  hints: HydrationHint[],
): string | null {
  const existing = normalizeDungeonSlug(stub.dungeonSlug);
  if (existing) return existing;
  for (const h of hints) {
    if (!h.reportCode || h.reportCode !== stub.reportCode) continue;
    const slug = normalizeDungeonSlug(h.dungeonSlug);
    if (slug) return slug;
  }
  return hintDungeonForStub(stub, hints);
}

function hintDungeonForStub(
  stub: WclRunCandidate,
  hints: HydrationHint[],
): string | null {
  if (!hints.length) return null;
  const start = stub.startTimeMs ?? 0;
  let best: { slug: string; delta: number } | null = null;
  for (const h of hints) {
    const slug = normalizeDungeonSlug(h.dungeonSlug);
    if (!slug) continue;
    const hintMs = Date.parse(h.completedAt);
    if (Number.isNaN(hintMs)) continue;
    const delta = Math.abs(hintMs - start);
    if (delta > HYDRATION_HINT_WINDOW_MS) continue;
    if (!best || delta < best.delta) best = { slug, delta };
  }
  return best?.slug ?? null;
}

/**
 * Deterministic exploration order for unknown-dungeon stubs.
 * Alternates newest and oldest so the hydration cap cannot consume only the
 * global newest prefix (which over-samples already-popular dungeons).
 */
export function roundRobinUnknownStubs(stubs: WclRunCandidate[]): WclRunCandidate[] {
  if (stubs.length <= 1) return [...stubs];
  const sorted = [...stubs].sort((a, b) => (b.startTimeMs ?? 0) - (a.startTimeMs ?? 0));
  const out: WclRunCandidate[] = [];
  let lo = 0;
  let hi = sorted.length - 1;
  let takeNewest = true;
  while (lo <= hi) {
    if (takeNewest) {
      out.push(sorted[lo]!);
      lo += 1;
    } else {
      out.push(sorted[hi]!);
      hi -= 1;
    }
    takeNewest = !takeNewest;
  }
  return out;
}

/**
 * Unique fightUnknown stubs ordered for hydration.
 *
 * Missing-dungeon-first:
 * 1. known-dungeon stubs for dungeons with 0 candidates;
 * 2. known-dungeon stubs for dungeons with 1 candidate;
 * 3. unknown-dungeon stubs via bounded round-robin (not global newest-24);
 * 4. stubs for already-complete dungeons last.
 */
export function prioritizeReportsForHydration(
  stubs: WclRunCandidate[],
  hints: HydrationHint[],
  maxReports = MAX_HYDRATION_REPORTS,
  options?: {
    underCoveredDungeonSlugs?: ReadonlySet<string>;
    /** When set, enables deficit-aware missing-dungeon-first ordering. */
    coverage?: ReadonlyMap<string, ReadonlySet<string>>;
    targetCandidatesPerDungeon?: number;
  },
): WclRunCandidate[] {
  const byCode = new Map<string, WclRunCandidate>();
  for (const stub of stubs) {
    if (!stub.reportCode || !stub.incompleteness.fightUnknown) continue;
    if (!byCode.has(stub.reportCode)) byCode.set(stub.reportCode, stub);
  }
  const unique = [...byCode.values()];
  const target =
    options?.targetCandidatesPerDungeon ?? TARGET_ELIGIBLE_CANDIDATES_PER_DUNGEON;
  const coverage = options?.coverage;
  const underCovered =
    options?.underCoveredDungeonSlugs ??
    (coverage
      ? underCoveredDungeons(
          new Map([...coverage.entries()].map(([k, v]) => [k, new Set(v)])),
          target,
        )
      : undefined);

  const hintTimes = hints
    .map((h) => Date.parse(h.completedAt))
    .filter((ms) => !Number.isNaN(ms));

  const recencyThenHint = (a: WclRunCandidate, b: WclRunCandidate): number => {
    const aStart = a.startTimeMs ?? 0;
    const bStart = b.startTimeMs ?? 0;
    if (hintTimes.length > 0) {
      const aDelta = Math.min(...hintTimes.map((t) => Math.abs(t - aStart)));
      const bDelta = Math.min(...hintTimes.map((t) => Math.abs(t - bStart)));
      const aInWindow = aDelta <= HYDRATION_HINT_WINDOW_MS ? 0 : 1;
      const bInWindow = bDelta <= HYDRATION_HINT_WINDOW_MS ? 0 : 1;
      if (aInWindow !== bInWindow) return aInWindow - bInWindow;
      if (aDelta !== bDelta) return aDelta - bDelta;
    }
    return bStart - aStart;
  };

  if (coverage && underCovered && underCovered.size > 0) {
    const zero: WclRunCandidate[] = [];
    const one: WclRunCandidate[] = [];
    const unknown: WclRunCandidate[] = [];
    const complete: WclRunCandidate[] = [];

    for (const stub of unique) {
      const dungeon = annotateStubDungeonFromHints(stub, hints);
      if (dungeon == null) {
        unknown.push(stub);
        continue;
      }
      const deficit = dungeonDeficit(
        new Map([...coverage.entries()].map(([k, v]) => [k, new Set(v)])),
        dungeon,
        target,
      );
      if (deficit === 0) zero.push(stub);
      else if (deficit === 1) one.push(stub);
      else complete.push(stub);
    }

    zero.sort(recencyThenHint);
    one.sort(recencyThenHint);
    complete.sort(recencyThenHint);
    const unknownRr = roundRobinUnknownStubs(unknown);
    return [...zero, ...one, ...unknownRr, ...complete].slice(0, maxReports);
  }

  // Legacy / underCovered-only path (no full coverage map).
  unique.sort((a, b) => {
    if (underCovered && underCovered.size > 0) {
      const aDungeon = annotateStubDungeonFromHints(a, hints);
      const bDungeon = annotateStubDungeonFromHints(b, hints);
      const aFills = aDungeon != null && underCovered.has(aDungeon) ? 0 : 1;
      const bFills = bDungeon != null && underCovered.has(bDungeon) ? 0 : 1;
      if (aFills !== bFills) return aFills - bFills;
      // Prefer zero-candidate dungeons when both fill under-covered.
      if (aFills === 0 && coverage) {
        const cov = new Map([...coverage.entries()].map(([k, v]) => [k, new Set(v)]));
        const aDef = aDungeon ? dungeonDeficit(cov, aDungeon, target) : 99;
        const bDef = bDungeon ? dungeonDeficit(cov, bDungeon, target) : 99;
        if (aDef !== bDef) return aDef - bDef;
      }
    }
    return recencyThenHint(a, b);
  });

  return unique.slice(0, maxReports);
}

export function hydratedFightToCandidate(
  report: HydrationReportPayload,
  fight: HydrationFight,
  targetActorId: number,
  hints: HydrationHint[] = [],
): WclRunCandidate {
  let dungeonSlug = resolveDungeonSlug(fight, report.zone?.name);
  const durationMs = Math.max(0, fight.endTime - fight.startTime);
  const completedAtMs = report.startTime + fight.endTime;
  const keyLevel = fight.keystoneLevel ?? null;
  const completedAt = new Date(completedAtMs).toISOString();
  const timed = timedFromKeystoneBonus(fight.keystoneBonus);

  // Prefer external hydration hints when encounter→dungeon map misses the season pool.
  if (dungeonSlug == null && keyLevel != null && hints.length > 0) {
    const CLOCK_SKEW_MS = 45 * 60 * 1000;
    let best: { hint: HydrationHint; delta: number } | null = null;
    for (const h of hints) {
      if (!h.dungeonSlug?.trim()) continue;
      if (h.keyLevel != null && h.keyLevel !== keyLevel) continue;
      const delta = Math.abs(Date.parse(h.completedAt) - completedAtMs);
      if (delta > CLOCK_SKEW_MS) continue;
      if (!best || delta < best.delta) best = { hint: h, delta };
    }
    if (best?.hint.dungeonSlug) {
      dungeonSlug = best.hint.dungeonSlug;
    }
  }

  const reportRevision =
    typeof report.revision === "number" && Number.isFinite(report.revision)
      ? report.revision
      : null;

  return {
    reportCode: report.code,
    fightId: fight.id,
    encounterId: fight.encounterID ?? 0,
    zoneId: report.zone?.id ?? null,
    dungeonSlug,
    seasonSlug: null,
    keyLevel,
    score: null,
    startTimeMs: report.startTime + fight.startTime,
    completedAt,
    durationMs,
    timed,
    selectionTags: [],
    source: "recentReports",
    matchConfidence: null,
    targetActorId,
    reportRevision,
    incompleteness: {
      dungeonUnknown: dungeonSlug == null,
      seasonUnknown: true,
      timedUnknown: timed == null,
      keyLevelUnknown: keyLevel == null,
      rosterIncomplete: true,
      fightUnknown: false,
    },
    warnings: [
      "hydrated from recentReports fight/masterData",
      ...(dungeonSlug == null ? ["dungeonSlug unresolved from encounter/fight name"] : []),
      ...(timed == null ? ["timed unresolved — keystoneBonus absent"] : []),
      ...(reportRevision == null ? ["reportRevision unresolved from WCL metadata"] : []),
    ],
  };
}

export function candidatesFromHydratedReport(
  report: HydrationReportPayload,
  characterName: string,
  realmSlug: string,
  hints: HydrationHint[] = [],
): { candidates: WclRunCandidate[]; rejected: string[] } {
  const rejected: string[] = [];
  const vis = (report.visibility ?? "public").toLowerCase();
  if (vis !== "public") {
    rejected.push(`report_${report.code}_not_public`);
    return { candidates: [], rejected };
  }

  const actors = report.masterData?.actors ?? [];
  const candidates: WclRunCandidate[] = [];
  let mplusSeen = 0;

  for (const fight of report.fights) {
    if (!isMythicPlusFight(fight)) {
      rejected.push(`fight_${fight.id}_FIGHT_NOT_MYTHIC_PLUS`);
      continue;
    }
    mplusSeen += 1;
    if (mplusSeen > MAX_FIGHTS_PER_HYDRATED_REPORT) {
      rejected.push(`fight_${fight.id}_over_report_cap`);
      continue;
    }
    const ownership = resolveFightTargetForHydration(fight, actors, characterName, realmSlug);
    if (!ownership.ok) {
      rejected.push(`fight_${fight.id}_${ownership.reason}`);
      continue;
    }
    candidates.push(hydratedFightToCandidate(report, fight, ownership.targetActorId, hints));
  }

  return { candidates, rejected };
}

function classifyRejectionReason(raw: string): string {
  if (raw.includes("not_public")) return "not_public";
  if (raw.includes("FIGHT_NOT_MYTHIC_PLUS")) return "not_mythic_plus";
  if (raw.includes("over_report_cap")) return "over_report_cap";
  if (raw.includes("TARGET_NOT_IN_FIGHT")) return "ownership_target_not_in_fight";
  if (raw.includes("TARGET_NOT_IN_REPORT")) return "ownership_target_not_in_report";
  if (raw.includes("TARGET_AMBIGUOUS")) return "ownership_ambiguous";
  if (raw.includes("FIGHT_IN_PROGRESS")) return "fight_in_progress";
  if (raw.includes("fetch_empty")) return "fetch_empty";
  if (raw.includes("fetch_error")) return "fetch_error";
  return "other";
}

function recordRejection(
  counts: Record<string, number>,
  reasons: string[],
  raw: string,
): void {
  const key = classifyRejectionReason(raw);
  counts[key] = (counts[key] ?? 0) + 1;
  if (reasons.length < 40) reasons.push(raw);
}

function coverageDiagnosticsMaps(
  coverage: Map<string, Set<string>>,
): {
  candidatesProducedPerDungeon: Record<string, number>;
  distinctCandidatesPerDungeon: Record<string, number>;
} {
  const candidatesProducedPerDungeon: Record<string, number> = {};
  const distinctCandidatesPerDungeon: Record<string, number> = {};
  for (const [slug, identities] of [...coverage.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    candidatesProducedPerDungeon[slug] = identities.size;
    distinctCandidatesPerDungeon[slug] = identities.size;
  }
  return { candidatesProducedPerDungeon, distinctCandidatesPerDungeon };
}

/**
 * Expand fightUnknown stubs into Mythic+ candidates.
 *
 * When `activeDungeonSlugs` is provided, hydrates progressively until each
 * active dungeon has `targetCandidatesPerDungeon` (default 2) distinct
 * timed-eligible identities, the `maxReports` budget is exhausted, or no stubs remain.
 * Without an active dungeon pool, preserves the legacy fixed-budget slice.
 */
export async function hydrateFightUnknownCandidates(input: {
  candidates: WclRunCandidate[];
  characterName: string;
  realmSlug: string;
  hints?: HydrationHint[];
  maxReports?: number;
  /** When set, enable coverage-aware progressive hydration + early stop. */
  activeDungeonSlugs?: readonly string[];
  /** Distinct eligible identities required per active dungeon (default 2). */
  targetCandidatesPerDungeon?: number;
  fetchReport: FetchReportForHydration;
}): Promise<{
  candidates: WclRunCandidate[];
  hydratedReportCount: number;
  rejectedReasons: string[];
  diagnostics: HydrationCoverageDiagnostics;
}> {
  const stubs = input.candidates.filter((c) => c.incompleteness.fightUnknown);
  const known = input.candidates.filter((c) => !c.incompleteness.fightUnknown);
  const hints = input.hints ?? [];
  const maxReports = input.maxReports ?? MAX_HYDRATION_REPORTS;
  const targetPerDungeon =
    input.targetCandidatesPerDungeon ?? TARGET_ELIGIBLE_CANDIDATES_PER_DUNGEON;
  const activeSlugs = (input.activeDungeonSlugs ?? [])
    .map((s) => normalizeDungeonSlug(s))
    .filter((s): s is string => s != null);
  const coverageAware = activeSlugs.length > 0;
  const coverage = emptyCoverageMap(activeSlugs);
  const activeSet = new Set(activeSlugs);

  // Seed coverage from already fight-known *timed* candidates in the active pool.
  for (const c of known) {
    const slug = normalizeDungeonSlug(c.dungeonSlug);
    if (!slug || !activeSet.has(slug)) continue;
    if (!countsTowardHydrationCoverage(c)) continue;
    coverage.get(slug)?.add(candidateIdentityKey(c.reportCode, c.fightId));
  }

  const hydrated: WclRunCandidate[] = [];
  const rejectedReasons: string[] = [];
  const rejectionCountsByReason: Record<string, number> = {};
  /** reportCodes for which fetchReport was invoked (attempt budget consumers). */
  const attemptedCodes = new Set<string>();
  let reportFetchAttempts = 0;
  let hydratedReportCount = 0;
  let reportsFailedOrEmpty = 0;
  let stopReason: HydrationStopReason = coverageAware ? "no_more_reports" : "legacy_fixed_budget";

  // Unique stubs ordered once; coverage-aware re-ranks remaining by missing-dungeon-first.
  const uniqueStubs = prioritizeReportsForHydration(stubs, hints, Number.MAX_SAFE_INTEGER, {
    coverage: coverageAware ? coverage : undefined,
    targetCandidatesPerDungeon: targetPerDungeon,
  });
  const remaining = [...uniqueStubs];

  const takeNextStub = (): WclRunCandidate | null => {
    if (remaining.length === 0) return null;
    if (coverageAware) {
      const under = underCoveredDungeons(coverage, targetPerDungeon);
      // Re-rank only when a remaining stub is known to fill an under-covered dungeon.
      // Re-running round-robin on unknown-only stubs reshuffles and can pull
      // middle-position reports into the initial budget incorrectly.
      const hasKnownUnderCovered = remaining.some((s) => {
        const dungeon = annotateStubDungeonFromHints(s, hints);
        return dungeon != null && under.has(dungeon);
      });
      if (hasKnownUnderCovered) {
        const ordered = prioritizeReportsForHydration(remaining, hints, remaining.length, {
          underCoveredDungeonSlugs: under,
          coverage,
          targetCandidatesPerDungeon: targetPerDungeon,
        });
        remaining.splice(0, remaining.length, ...ordered);
      }
    }
    return remaining.shift() ?? null;
  };

  // maxReports is a strict upper bound on unique fetchReport invocations.
  while (reportFetchAttempts < maxReports) {
    if (coverageAware && isFullCoverage(coverage, targetPerDungeon)) {
      stopReason = "full_coverage";
      break;
    }

    const stub = takeNextStub();
    if (!stub) {
      stopReason = coverageAware ? "no_more_reports" : "legacy_fixed_budget";
      break;
    }
    if (attemptedCodes.has(stub.reportCode)) {
      continue;
    }

    // Consume budget before the provider call — null/throw still count.
    attemptedCodes.add(stub.reportCode);
    reportFetchAttempts += 1;

    try {
      const report = await input.fetchReport(stub.reportCode);
      if (!report) {
        reportsFailedOrEmpty += 1;
        recordRejection(
          rejectionCountsByReason,
          rejectedReasons,
          `report_${stub.reportCode}_fetch_empty`,
        );
        continue;
      }
      hydratedReportCount += 1;
      const mapped = candidatesFromHydratedReport(
        report,
        input.characterName,
        input.realmSlug,
        hints,
      );
      for (const reason of mapped.rejected) {
        recordRejection(rejectionCountsByReason, rejectedReasons, reason);
      }
      for (const candidate of mapped.candidates) {
        hydrated.push(candidate);
        const slug = normalizeDungeonSlug(candidate.dungeonSlug);
        if (!slug || !activeSet.has(slug)) continue;
        // Ownership-rejected fights never appear in mapped.candidates.
        // Untimed / timer-unknown fights are retained as candidates but do not
        // satisfy coverage (plan eligibility requires timed === true).
        if (!countsTowardHydrationCoverage(candidate)) continue;
        coverage
          .get(slug)
          ?.add(candidateIdentityKey(candidate.reportCode, candidate.fightId));
      }

      if (coverageAware && isFullCoverage(coverage, targetPerDungeon)) {
        stopReason = "full_coverage";
        break;
      }
    } catch (error) {
      reportsFailedOrEmpty += 1;
      recordRejection(
        rejectionCountsByReason,
        rejectedReasons,
        `report_${stub.reportCode}_fetch_error:${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (coverageAware && stopReason !== "full_coverage") {
    if (reportFetchAttempts >= maxReports) {
      stopReason = "budget_exhausted";
    } else if (remaining.length === 0 && !isFullCoverage(coverage, targetPerDungeon)) {
      stopReason = "no_more_reports";
    }
  } else if (!coverageAware && reportFetchAttempts >= maxReports && remaining.length > 0) {
    stopReason = "legacy_fixed_budget";
  }

  const untouchedStubs = stubs.filter((s) => !attemptedCodes.has(s.reportCode));
  const { candidatesProducedPerDungeon, distinctCandidatesPerDungeon } =
    coverageDiagnosticsMaps(coverage);
  const targetCoverageReached = coverageAware && isFullCoverage(coverage, targetPerDungeon);
  const reportsLeftUnhydratedBudget = remaining.filter(
    (s) => !attemptedCodes.has(s.reportCode),
  ).length;

  const omittedByCode = new Map<string, OmittedHydrationReport>();
  for (const [listedOrderIndex, stub] of uniqueStubs.entries()) {
    if (attemptedCodes.has(stub.reportCode)) continue;
    const dungeon = annotateStubDungeonFromHints(stub, hints);
    const deferredComplete =
      coverageAware &&
      dungeon != null &&
      (coverage.get(dungeon)?.size ?? 0) >= targetPerDungeon &&
      !isFullCoverage(coverage, targetPerDungeon);
    omittedByCode.set(stub.reportCode, {
      reportCode: stub.reportCode,
      reason: deferredComplete
        ? "REPORT_ALREADY_COVERED_DUNGEON_DEFERRED"
        : stopReason === "budget_exhausted" || stopReason === "legacy_fixed_budget"
          ? "REPORT_EXCLUDED_BY_HYDRATION_CAP"
          : "REPORT_LEFT_UNHYDRATED_NO_MORE_BUDGET",
      dungeonSlug: dungeon,
      startTimeMs: stub.startTimeMs ?? null,
      listedOrderIndex,
    });
  }

  return {
    candidates: [...known, ...hydrated, ...untouchedStubs],
    hydratedReportCount,
    rejectedReasons: rejectedReasons.slice(0, 40),
    diagnostics: {
      recentReportsDiscovered: uniqueStubs.length,
      reportsConsideredForHydration: reportFetchAttempts,
      reportFetchAttempts,
      reportsHydrated: hydratedReportCount,
      reportsFailedOrEmpty,
      reportsLeftUnhydratedBudget,
      candidatesProducedPerDungeon,
      distinctCandidatesPerDungeon,
      targetCandidatesPerDungeon: targetPerDungeon,
      targetCoverageReached,
      stopReason,
      rejectionCountsByReason,
      omittedReports: [...omittedByCode.values()].sort((a, b) =>
        a.reportCode.localeCompare(b.reportCode),
      ),
    },
  };
}
