import { createHash } from "node:crypto";
import type {
  CharacterIdentityInput,
  MythicRunDTO,
  RaiderIoRunCandidate,
  RegionCode,
  RunParticipantDTO,
  RunSourceRefDTO,
} from "@mplus/contracts";

/** Time window for exact completion alignment (same as WCL HIGH time tolerance). */
export const MATCH_TIME_TOLERANCE_MS = 120_000;
/** Duration window used when clocks disagree but the key length matches (WCL MEDIUM). */
export const MATCH_DURATION_TOLERANCE_MS = 15_000;

function fingerprint(parts: string[]): string {
  return createHash("sha256").update(parts.join("|"), "utf8").digest("hex").slice(0, 32);
}

function normalizeDungeonSlug(slug: string): string {
  return slug.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

/**
 * Canonical dungeon keys so RIO short names and WCL/Blizzard full slugs can merge.
 * Extend as season pools rotate.
 */
const DUNGEON_CANONICAL: Record<string, string> = {
  // TWW / Midnight overlapping aliases (RIO short_name ↔ full / WCL slugs)
  arak: "ara-kara-city-of-echoes",
  "ara-kara": "ara-kara-city-of-echoes",
  "ara-kara-city-of-echoes": "ara-kara-city-of-echoes",
  aa: "algethar-academy",
  "algethar-academy": "algethar-academy",
  "algeth-ar-academy": "algethar-academy",
  mt: "magisters-terrace",
  "magisters-terrace": "magisters-terrace",
  "magister-s-terrace": "magisters-terrace",
  pos: "priory-of-the-sacred-flame",
  "priory-of-the-sacred-flame": "priory-of-the-sacred-flame",
  mc: "motherlode",
  "the-motherlode": "motherlode",
  motherlode: "motherlode",
  nx: "nexus-point-xenas",
  npx: "nexus-point-xenas",
  "nexus-point-xenas": "nexus-point-xenas",
  sot: "seat-of-the-triumvirate",
  seat: "seat-of-the-triumvirate",
  "seat-of-the-triumvirate": "seat-of-the-triumvirate",
  sr: "skyreach",
  skyreach: "skyreach",
  maisara: "maisara-caverns",
  "maisara-caverns": "maisara-caverns",
  windrunner: "windrunner-spire",
  "windrunner-spire": "windrunner-spire",
  posaron: "pit-of-saron",
  "pit-of-saron": "pit-of-saron",
};

export function canonicalDungeonKey(slug: string): string {
  const normalized = normalizeDungeonSlug(slug);
  return DUNGEON_CANONICAL[normalized] ?? normalized;
}

function dungeonsCompatible(a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) return false;
  return canonicalDungeonKey(a) === canonicalDungeonKey(b);
}

/** Runs older than this are excluded from current-season fusion/matching budgets. */
export const ACTIVE_RUN_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

/** Drop historical runs that must not consume the selected-run budget. */
export function filterRunsToActiveWindow<T extends { completedAt: string }>(
  runs: T[],
  options: { nowMs: number; maxAgeMs?: number },
): T[] {
  const maxAgeMs = options.maxAgeMs ?? ACTIVE_RUN_MAX_AGE_MS;
  return runs.filter((run) => {
    const completedMs = Date.parse(run.completedAt);
    if (Number.isNaN(completedMs)) return false;
    return options.nowMs - completedMs <= maxAgeMs;
  });
}

/**
 * Cross-provider match key: region + dungeon + key + completedAt bucket.
 * Prefer calling this on the match-winner identity (Blizzard > RIO > WCL), never on a
 * provider-local fingerprint.
 */
export function computeCrossProviderRunKey(
  run: Pick<MythicRunDTO, "region" | "dungeonSlug" | "keyLevel" | "completedAt">,
): string {
  const completedBucket = Math.round(new Date(run.completedAt).getTime() / 60_000);
  return fingerprint([
    String(run.region).toUpperCase(),
    canonicalDungeonKey(run.dungeonSlug),
    String(run.keyLevel),
    String(completedBucket),
  ]);
}

function sourcePriority(provider: string): number {
  switch (provider) {
    case "BLIZZARD":
      return 3;
    case "RAIDER_IO":
      return 2;
    case "WARCRAFT_LOGS":
      return 1;
    default:
      return 0;
  }
}

function bestSourcePriority(run: MythicRunDTO): number {
  return Math.max(0, ...run.sources.map((s) => sourcePriority(s.provider)));
}

/** Identity fields used for fingerprinting: prefer Blizzard/RIO over WCL clocks. */
export function pickMatchIdentity(run: MythicRunDTO): Pick<
  MythicRunDTO,
  "region" | "dungeonSlug" | "keyLevel" | "completedAt" | "durationMs"
> {
  return {
    region: run.region,
    dungeonSlug: run.dungeonSlug,
    keyLevel: run.keyLevel,
    completedAt: run.completedAt,
    durationMs: run.durationMs,
  };
}

function applyIdentityWinner(target: MythicRunDTO, incoming: MythicRunDTO): void {
  const incomingPriority = bestSourcePriority(incoming);
  const existingPriority = bestSourcePriority(target);
  if (incomingPriority > existingPriority) {
    target.dungeonSlug = incoming.dungeonSlug || target.dungeonSlug;
    target.keyLevel = incoming.keyLevel;
    target.completedAt = incoming.completedAt;
    target.durationMs = incoming.durationMs || target.durationMs;
    target.timerMs = incoming.timerMs ?? target.timerMs;
    target.timed = incoming.timed;
    target.scoreValue = incoming.scoreValue ?? target.scoreValue;
    if (incoming.seasonSlug !== "unknown" && !incoming.seasonSlug.startsWith("placeholder")) {
      target.seasonSlug = incoming.seasonSlug;
    }
  } else if (incomingPriority === existingPriority) {
    if (!target.dungeonSlug.trim() && incoming.dungeonSlug.trim()) {
      target.dungeonSlug = incoming.dungeonSlug;
    }
    target.durationMs = target.durationMs || incoming.durationMs;
    target.timerMs = target.timerMs ?? incoming.timerMs;
    target.scoreValue = target.scoreValue ?? incoming.scoreValue;
  } else {
    // Incoming is weaker (e.g. WCL onto RIO): keep winner clocks; fill gaps only.
    if (!target.dungeonSlug.trim() && incoming.dungeonSlug.trim()) {
      target.dungeonSlug = incoming.dungeonSlug;
    }
    if (!target.durationMs && incoming.durationMs) target.durationMs = incoming.durationMs;
  }
  if (target.seasonSlug === "unknown" && incoming.seasonSlug !== "unknown") {
    target.seasonSlug = incoming.seasonSlug;
  }
}

export interface CrossProviderMatchEvidence {
  dungeonMatch: boolean;
  keyLevelMatch: boolean;
  timeDeltaMs: number | null;
  durationDeltaMs: number | null;
  timeMatch: boolean;
  durationMatch: boolean;
}

/**
 * Persist-time match: dungeon + key + (time OR duration).
 * Matching identity takes precedence over provider-local fingerprints.
 * When WCL dungeon is unknown, key + (time|duration within clock-skew) is enough to attach.
 */
export function evaluateCrossProviderPersistMatch(
  a: Pick<MythicRunDTO, "dungeonSlug" | "keyLevel" | "completedAt" | "durationMs">,
  b: Pick<MythicRunDTO, "dungeonSlug" | "keyLevel" | "completedAt" | "durationMs">,
  options?: { timeToleranceMs?: number; durationToleranceMs?: number; clockSkewMs?: number },
): { matched: boolean; evidence: CrossProviderMatchEvidence } {
  const timeToleranceMs = options?.timeToleranceMs ?? MATCH_TIME_TOLERANCE_MS;
  const durationToleranceMs = options?.durationToleranceMs ?? MATCH_DURATION_TOLERANCE_MS;
  const clockSkewMs = options?.clockSkewMs ?? 45 * 60 * 1000;

  const aDungeonMissing = isDungeonUnknown(a.dungeonSlug);
  const bDungeonMissing = isDungeonUnknown(b.dungeonSlug);
  const dungeonMatch =
    !aDungeonMissing && !bDungeonMissing && dungeonsCompatible(a.dungeonSlug, b.dungeonSlug);
  const keyLevelMatch = a.keyLevel === b.keyLevel;
  const timeDeltaMs = Math.abs(
    new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime(),
  );
  const durationDeltaMs =
    a.durationMs > 0 && b.durationMs > 0 ? Math.abs(a.durationMs - b.durationMs) : null;
  const timeMatch = timeDeltaMs <= timeToleranceMs;
  const durationMatch =
    durationDeltaMs !== null && durationDeltaMs <= durationToleranceMs;

  const evidence: CrossProviderMatchEvidence = {
    dungeonMatch,
    keyLevelMatch,
    timeDeltaMs,
    durationDeltaMs,
    timeMatch,
    durationMatch,
  };

  if (!keyLevelMatch) {
    return { matched: false, evidence };
  }

  if (dungeonMatch && (timeMatch || durationMatch)) {
    return { matched: true, evidence };
  }

  // WCL often lacks Midnight encounter→dungeon mapping; still attach when key + timing align.
  if ((aDungeonMissing || bDungeonMissing) && (timeMatch || (durationMatch && timeDeltaMs <= clockSkewMs))) {
    return { matched: true, evidence: { ...evidence, dungeonMatch: true } };
  }

  return { matched: false, evidence };
}

function isDungeonUnknown(slug: string): boolean {
  const normalized = slug?.normalize("NFKC").trim().toLocaleLowerCase("en-US") ?? "";
  return !normalized || normalized === "unknown";
}

/** Dungeon+key only — used to detect unresolved cross-provider near-misses. */
function dungeonKeyOnlyMatch(
  a: Pick<MythicRunDTO, "dungeonSlug" | "keyLevel">,
  b: Pick<MythicRunDTO, "dungeonSlug" | "keyLevel">,
): boolean {
  return dungeonsCompatible(a.dungeonSlug, b.dungeonSlug) && a.keyLevel === b.keyLevel;
}

function hasExternalSource(run: MythicRunDTO): boolean {
  return run.sources.some((s) => s.provider === "BLIZZARD" || s.provider === "RAIDER_IO");
}

function hasWclSource(run: MythicRunDTO): boolean {
  return run.sources.some((s) => s.provider === "WARCRAFT_LOGS");
}

function mergeParticipants(
  existing: RunParticipantDTO[],
  incoming: RunParticipantDTO[],
): RunParticipantDTO[] {
  if (incoming.length === 0) return [...existing];
  if (existing.length === 0) return [...incoming];
  const byKey = new Map<string, RunParticipantDTO>();
  for (const participant of [...existing, ...incoming]) {
    const key = participant.providerCharacterKey.toLocaleLowerCase("en-US");
    const prior = byKey.get(key);
    if (!prior) {
      byKey.set(key, participant);
      continue;
    }
    byKey.set(key, {
      ...prior,
      ...participant,
      classSlug: participant.classSlug ?? prior.classSlug,
      specSlug: participant.specSlug ?? prior.specSlug,
      role: participant.role ?? prior.role,
      itemLevel: participant.itemLevel ?? prior.itemLevel,
      mythicRatingAtRun: participant.mythicRatingAtRun ?? prior.mythicRatingAtRun,
      isTargetCharacter: prior.isTargetCharacter || participant.isTargetCharacter,
      characterId: participant.characterId ?? prior.characterId,
    });
  }
  return [...byKey.values()];
}

function appendSources(target: MythicRunDTO, incoming: MythicRunDTO): void {
  for (const source of incoming.sources) {
    if (
      !target.sources.some(
        (s) => s.provider === source.provider && s.externalRunId === source.externalRunId,
      )
    ) {
      target.sources.push(source);
    }
  }
}

function runsMatchForPersist(a: MythicRunDTO, b: MythicRunDTO): boolean {
  return evaluateCrossProviderPersistMatch(a, b).matched;
}

function candidateToParticipants(
  candidate: RaiderIoRunCandidate,
  target: CharacterIdentityInput,
): RunParticipantDTO[] {
  if (candidate.roster.length > 0) {
    return candidate.roster.map((member) => ({
      providerCharacterKey: member.providerCharacterKey,
      displayName: member.displayName,
      realmSlug: member.realmSlug,
      region: member.region,
      classSlug: member.classSlug,
      specSlug: member.specSlug,
      role: member.role,
      itemLevel: null,
      mythicRatingAtRun: member.mythicRating,
      isTargetCharacter:
        member.realmSlug.toLowerCase() === target.realmSlug.toLowerCase() &&
        member.displayName.toLowerCase() === target.name.toLowerCase(),
      characterId: null,
    }));
  }

  return [
    {
      providerCharacterKey: `${target.region}|${target.realmSlug}|${target.name}`.toLowerCase(),
      displayName: target.name,
      realmSlug: target.realmSlug,
      region: target.region as RegionCode,
      classSlug: null,
      specSlug: null,
      role: null,
      itemLevel: null,
      mythicRatingAtRun: null,
      isTargetCharacter: true,
      characterId: null,
    },
  ];
}

/** Map a Raider.IO run candidate into a MythicRunDTO for persistence/fusion. */
export function raiderIoCandidateToMythicRun(
  candidate: RaiderIoRunCandidate,
  target: CharacterIdentityInput,
): MythicRunDTO {
  const sources: RunSourceRefDTO[] = [
    {
      provider: "RAIDER_IO",
      externalRunId: candidate.externalRunId,
      externalUrl: candidate.profileUrl,
      reportCode: null,
      fightId: null,
      revision: null,
    },
  ];

  const runBase = {
    region: target.region as RegionCode,
    dungeonSlug: candidate.dungeonSlug,
    keyLevel: candidate.keyLevel,
    completedAt: candidate.completedAt,
  };
  const canonicalFingerprint = computeCrossProviderRunKey(runBase);

  return {
    id: `rio:${candidate.externalRunId}`,
    region: runBase.region,
    seasonSlug: candidate.seasonSlug,
    dungeonSlug: candidate.dungeonSlug,
    keyLevel: candidate.keyLevel,
    completedAt: candidate.completedAt,
    durationMs: candidate.durationMs,
    timerMs: candidate.timerMs,
    timed: candidate.timed,
    scoreValue: candidate.scoreValue,
    canonicalFingerprint,
    affixes: {},
    participants: candidateToParticipants(candidate, target),
    sources,
  };
}

export function collectRaiderIoRuns(
  recent: RaiderIoRunCandidate[],
  best: RaiderIoRunCandidate[],
  target: CharacterIdentityInput,
): MythicRunDTO[] {
  const byId = new Map<string, MythicRunDTO>();
  for (const candidate of [...recent, ...best]) {
    const run = raiderIoCandidateToMythicRun(candidate, target);
    const existing = byId.get(candidate.externalRunId);
    if (!existing) {
      byId.set(candidate.externalRunId, run);
    }
  }
  return [...byId.values()];
}

/**
 * Deduplicate Blizzard / Raider.IO / WCL representations of the same run.
 * Matching identity (dungeon + key + time|duration) takes precedence over
 * provider-specific fingerprints; the winner's clocks drive the shared key.
 */
export function mergeRunSources(runs: MythicRunDTO[]): MythicRunDTO[] {
  return fuseCrossProviderRuns(runs).runs;
}

export interface FuseCrossProviderResult {
  runs: MythicRunDTO[];
  /** Successful WCL↔external (or Blizzard↔RIO) merges performed. */
  matchedPairCount: number;
  /** Unique canonical MythicRun rows after merge. */
  mergedCanonicalRunCount: number;
  /** Dungeon+key pairs that did not satisfy time|duration (not merged). */
  unresolvedCrossProviderMatches: number;
}

/**
 * Fuse provider runs and return diagnostics for smoke / provider metadata.
 */
export function fuseCrossProviderRuns(runs: MythicRunDTO[]): FuseCrossProviderResult {
  const merged: MythicRunDTO[] = [];
  let matchedPairCount = 0;

  for (const run of runs) {
    const match = merged.find((existing) => runsMatchForPersist(existing, run));
    if (!match) {
      merged.push({
        ...run,
        sources: [...run.sources],
        participants: [...run.participants],
        canonicalFingerprint: computeCrossProviderRunKey(pickMatchIdentity(run)),
      });
      continue;
    }

    matchedPairCount += 1;
    appendSources(match, run);
    match.participants = mergeParticipants(match.participants, run.participants);
    applyIdentityWinner(match, run);
    // Matching identity wins: fingerprint from the (possibly updated) winner clocks.
    match.canonicalFingerprint = computeCrossProviderRunKey(pickMatchIdentity(match));
  }

  let unresolvedCrossProviderMatches = 0;
  const externals = runs.filter(hasExternalSource);
  const wclOnly = runs.filter((r) => hasWclSource(r) && !hasExternalSource(r));
  const usedExternal = new Set<number>();
  for (const wcl of wclOnly) {
    let foundUnresolved = false;
    for (let ei = 0; ei < externals.length; ei++) {
      if (usedExternal.has(ei)) continue;
      const ext = externals[ei]!;
      if (!dungeonKeyOnlyMatch(wcl, ext)) continue;
      if (runsMatchForPersist(wcl, ext)) continue;
      foundUnresolved = true;
      usedExternal.add(ei);
      break;
    }
    if (foundUnresolved) unresolvedCrossProviderMatches += 1;
  }

  return {
    runs: merged,
    matchedPairCount,
    mergedCanonicalRunCount: merged.length,
    unresolvedCrossProviderMatches,
  };
}

/** Ensure a target-character participant exists when providers omit roster (e.g. WCL-only). */
export function ensureTargetParticipant(
  run: MythicRunDTO,
  target: CharacterIdentityInput,
): MythicRunDTO {
  if (run.participants.some((p) => p.isTargetCharacter)) return run;
  const providerCharacterKey =
    `${target.region}|${target.realmSlug}|${target.name}`.toLocaleLowerCase("en-US");
  return {
    ...run,
    participants: [
      ...run.participants,
      {
        providerCharacterKey,
        displayName: target.name,
        realmSlug: target.realmSlug,
        region: target.region as RegionCode,
        classSlug: null,
        specSlug: null,
        role: null,
        itemLevel: null,
        mythicRatingAtRun: null,
        isTargetCharacter: true,
        characterId: null,
      },
    ],
  };
}
