import type {
  ExternalRunMatchInput,
  RunMatchConfidence,
  RunMatchResult,
  WclActorMap,
  WclRunCandidate,
} from "../types.js";

export interface RunMatchingConfig {
  timeToleranceMs: number;
  durationToleranceMs: number;
  rosterOverlapHigh: number;
  rosterOverlapMedium: number;
}

export const DEFAULT_MATCHING_CONFIG: RunMatchingConfig = {
  timeToleranceMs: 120_000,
  durationToleranceMs: 15_000,
  rosterOverlapHigh: 0.8,
  rosterOverlapMedium: 0.5,
};

export function matchRunCandidate(
  candidate: WclRunCandidate,
  external: ExternalRunMatchInput,
  rosterFromFight: Array<{ realmSlug: string; name: string }> = [],
  config: RunMatchingConfig = DEFAULT_MATCHING_CONFIG,
): RunMatchResult {
  const dungeonMatch =
    candidate.dungeonSlug !== null &&
    candidate.dungeonSlug.toLowerCase() === external.dungeonSlug.toLowerCase();

  const keyLevel = candidate.keyLevel;
  const keyLevelDelta =
    keyLevel !== null && keyLevel !== undefined ? Math.abs(keyLevel - external.keyLevel) : null;
  const keyLevelMatch = keyLevelDelta === 0;

  let timeDeltaMs: number | null = null;
  if (candidate.completedAt) {
    timeDeltaMs = Math.abs(
      new Date(candidate.completedAt).getTime() - new Date(external.completedAt).getTime(),
    );
  }

  const durationDeltaMs =
    candidate.durationMs != null
      ? Math.abs(candidate.durationMs - external.durationMs)
      : null;

  const rosterOverlapRatio = computeRosterOverlap(rosterFromFight, external.participants);
  const timeMatch = timeDeltaMs !== null && timeDeltaMs <= config.timeToleranceMs;
  const durationMatch =
    durationDeltaMs !== null && durationDeltaMs <= config.durationToleranceMs;

  let confidence: RunMatchConfidence = "NONE";
  if (
    dungeonMatch &&
    keyLevelMatch &&
    timeMatch &&
    durationMatch &&
    rosterOverlapRatio !== null &&
    rosterOverlapRatio >= config.rosterOverlapHigh
  ) {
    confidence = "HIGH";
  } else if (
    dungeonMatch &&
    keyLevelMatch &&
    (timeMatch || durationMatch) &&
    rosterOverlapRatio !== null &&
    rosterOverlapRatio >= config.rosterOverlapMedium
  ) {
    confidence = "MEDIUM";
  } else if (dungeonMatch && keyLevelMatch) {
    confidence = "LOW";
  }

  return {
    confidence,
    evidence: {
      dungeonMatch,
      keyLevelMatch,
      keyLevelDelta,
      timeDeltaMs,
      durationDeltaMs,
      rosterOverlapRatio,
    },
    autoMergeAllowed: confidence === "HIGH",
  };
}

function computeRosterOverlap(
  wclRoster: Array<{ realmSlug: string; name: string }>,
  external: Array<{ realmSlug: string; name: string }>,
): number | null {
  if (wclRoster.length === 0 || external.length === 0) {
    return null;
  }
  const externalKeys = new Set(
    external.map((p) => `${p.realmSlug.toLowerCase()}|${p.name.toLowerCase()}`),
  );
  const matches = wclRoster.filter((p) =>
    externalKeys.has(`${p.realmSlug.toLowerCase()}|${p.name.toLowerCase()}`),
  ).length;
  return matches / Math.max(wclRoster.length, external.length);
}

export function buildActorMap(
  actors: Array<{
    id: number;
    name: string;
    type: string;
    subType?: string | null;
    server?: string | null;
    petOwner?: number | null;
    petOwnerId?: number | null;
  }>,
): WclActorMap {
  const byId = new Map<number, { id: number; name: string; type: string; subType: string | null; server: string | null; petOwnerId: number | null }>();
  const byName = new Map<string, number[]>();

  for (const actor of actors) {
    byId.set(actor.id, {
      id: actor.id,
      name: actor.name,
      type: actor.type,
      subType: actor.subType ?? null,
      server: actor.server ?? null,
      petOwnerId: actor.petOwnerId ?? actor.petOwner ?? null,
    });
    const key = actor.name.toLowerCase();
    const existing = byName.get(key) ?? [];
    existing.push(actor.id);
    byName.set(key, existing);
  }

  return { byId, byName };
}

/**
 * Player source id plus owned pet actor ids for interrupt/CC/dispel attribution.
 */
export function resolveAttributedSourceIds(
  actorMap: WclActorMap,
  playerSourceId: number,
): Set<number> {
  const ids = new Set<number>([playerSourceId]);
  for (const actor of actorMap.byId.values()) {
    if (actor.petOwnerId === playerSourceId) {
      ids.add(actor.id);
    }
  }
  return ids;
}

export function resolveActorSourceId(
  actorMap: WclActorMap,
  characterName: string,
  realmSlug: string,
): number | null {
  const ids = actorMap.byName.get(characterName.toLowerCase()) ?? [];
  const players = ids
    .map((id) => actorMap.byId.get(id))
    .filter((actor): actor is NonNullable<typeof actor> => actor != null && actor.type === "Player");

  const realmNorm = realmSlug.toLowerCase().replace(/\s+/g, "-");
  const realmMatches = players.filter((actor) => {
    if (!actor.server) return false;
    const serverNorm = actor.server.toLowerCase().replace(/\s+/g, "-");
    return serverNorm === realmNorm || serverNorm === realmSlug.toLowerCase();
  });

  if (realmMatches.length === 1) {
    return realmMatches[0]!.id;
  }
  if (realmMatches.length > 1) {
    return null; // ambiguous — caller must fail safely
  }

  // No realm match: only accept a single Player with matching name and no conflicting servers
  if (players.length === 1) {
    return players[0]!.id;
  }
  return null;
}

/**
 * Resolve actor or describe why resolution failed (missing / ambiguous).
 */
export function resolveActorSourceIdStrict(
  actorMap: WclActorMap,
  characterName: string,
  realmSlug: string,
): { sourceId: number } | { error: "NOT_FOUND" | "AMBIGUOUS"; message: string } {
  const ids = actorMap.byName.get(characterName.toLowerCase()) ?? [];
  const players = ids
    .map((id) => actorMap.byId.get(id))
    .filter((actor): actor is NonNullable<typeof actor> => actor != null && actor.type === "Player");

  if (players.length === 0) {
    return {
      error: "NOT_FOUND",
      message: `Actor not found for ${characterName}-${realmSlug}`,
    };
  }

  const realmNorm = realmSlug.toLowerCase().replace(/\s+/g, "-");
  const realmMatches = players.filter((actor) => {
    if (!actor.server) return true; // defer; counted below
    const serverNorm = actor.server.toLowerCase().replace(/\s+/g, "-");
    return serverNorm === realmNorm || serverNorm === realmSlug.toLowerCase();
  });

  const withServer = realmMatches.filter((a) => a.server);
  const withoutServer = realmMatches.filter((a) => !a.server);

  if (withServer.length === 1 && withoutServer.length === 0) {
    return { sourceId: withServer[0]!.id };
  }
  if (withServer.length === 0 && withoutServer.length === 1 && players.length === 1) {
    return { sourceId: withoutServer[0]!.id };
  }
  if (withServer.length > 1 || (withServer.length === 0 && players.length > 1)) {
    return {
      error: "AMBIGUOUS",
      message: `Ambiguous actor match for ${characterName}-${realmSlug} (${players.length} players)`,
    };
  }
  if (withServer.length === 1) {
    return { sourceId: withServer[0]!.id };
  }
  if (players.length === 1) {
    return { sourceId: players[0]!.id };
  }
  return {
    error: "AMBIGUOUS",
    message: `Ambiguous actor match for ${characterName}-${realmSlug}`,
  };
}

export function selectLatestAndHighest(candidates: WclRunCandidate[]): {
  latest: WclRunCandidate | null;
  highest: WclRunCandidate | null;
} {
  if (candidates.length === 0) {
    return { latest: null, highest: null };
  }

  const latest = [...candidates].sort((a, b) => {
    const aTime = a.completedAt ? new Date(a.completedAt).getTime() : (a.startTimeMs ?? 0);
    const bTime = b.completedAt ? new Date(b.completedAt).getTime() : (b.startTimeMs ?? 0);
    return bTime - aTime;
  })[0]!;

  const highest = [...candidates].sort((a, b) => {
    const aLevel = a.keyLevel ?? 0;
    const bLevel = b.keyLevel ?? 0;
    if (bLevel !== aLevel) return bLevel - aLevel;
    const aScore = a.score ?? 0;
    const bScore = b.score ?? 0;
    if (bScore !== aScore) return bScore - aScore;
    const aTime = a.completedAt ? new Date(a.completedAt).getTime() : (a.startTimeMs ?? 0);
    const bTime = b.completedAt ? new Date(b.completedAt).getTime() : (b.startTimeMs ?? 0);
    return bTime - aTime;
  })[0]!;

  const isSameRun = latest.reportCode === highest.reportCode && latest.fightId === highest.fightId;
  if (isSameRun) {
    latest.selectionTags = ["LATEST", "HIGHEST"];
    highest.selectionTags = ["LATEST", "HIGHEST"];
  } else {
    latest.selectionTags = ["LATEST"];
    highest.selectionTags = ["HIGHEST"];
  }

  return { latest, highest };
}

export function dedupeCandidates(candidates: WclRunCandidate[]): WclRunCandidate[] {
  const seen = new Map<string, WclRunCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.reportCode}:${candidate.fightId}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, { ...candidate, selectionTags: [...candidate.selectionTags] });
      continue;
    }
    existing.selectionTags = [...new Set([...existing.selectionTags, ...candidate.selectionTags])];
    if ((candidate.keyLevel ?? 0) > (existing.keyLevel ?? 0)) {
      seen.set(key, { ...candidate, selectionTags: existing.selectionTags });
    }
  }
  return [...seen.values()];
}
