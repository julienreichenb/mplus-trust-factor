import { createHash } from "node:crypto";
import type {
  CharacterIdentityInput,
  MythicRunDTO,
  RaiderIoRunCandidate,
  RegionCode,
  RunParticipantDTO,
  RunSourceRefDTO,
} from "@mplus/contracts";

const MATCH_WINDOW_MS = 120_000;

function fingerprint(parts: string[]): string {
  return createHash("sha256").update(parts.join("|"), "utf8").digest("hex").slice(0, 32);
}

function normalizeDungeonSlug(slug: string): string {
  return slug.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

/**
 * Cross-provider match key: region + dungeon + key + completedAt bucket.
 * Intentionally ignores provider-prefixed fingerprints and roster variance so
 * Blizzard, Raider.IO and WCL representations of the same run collapse.
 */
export function computeCrossProviderRunKey(run: Pick<
  MythicRunDTO,
  "region" | "dungeonSlug" | "keyLevel" | "completedAt"
>): string {
  const completedBucket = Math.round(new Date(run.completedAt).getTime() / 60_000);
  return fingerprint([
    String(run.region).toUpperCase(),
    normalizeDungeonSlug(run.dungeonSlug),
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

function runsMatch(a: MythicRunDTO, b: MythicRunDTO): boolean {
  if (normalizeDungeonSlug(a.dungeonSlug) !== normalizeDungeonSlug(b.dungeonSlug)) return false;
  if (a.keyLevel !== b.keyLevel) return false;
  const delta = Math.abs(new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime());
  return delta <= MATCH_WINDOW_MS;
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
 * Uses dungeon + key + completion window, then rewrites fingerprints to a
 * shared cross-provider key so DB upserts also collide.
 */
export function mergeRunSources(runs: MythicRunDTO[]): MythicRunDTO[] {
  const merged: MythicRunDTO[] = [];
  for (const run of runs) {
    const match = merged.find((existing) => runsMatch(existing, run));
    if (!match) {
      merged.push({
        ...run,
        canonicalFingerprint: computeCrossProviderRunKey(run),
        sources: [...run.sources],
        participants: [...run.participants],
      });
      continue;
    }

    for (const source of run.sources) {
      if (
        !match.sources.some(
          (s) => s.provider === source.provider && s.externalRunId === source.externalRunId,
        )
      ) {
        match.sources.push(source);
      }
    }
    match.participants = mergeParticipants(match.participants, run.participants);
    match.canonicalFingerprint = computeCrossProviderRunKey(match);

    const incomingPriority = Math.max(0, ...run.sources.map((s) => sourcePriority(s.provider)));
    const existingPriority = Math.max(
      0,
      ...match.sources
        .filter((s) => !run.sources.some((r) => r.provider === s.provider && r.externalRunId === s.externalRunId))
        .map((s) => sourcePriority(s.provider)),
    );
    if (incomingPriority >= existingPriority) {
      match.durationMs = run.durationMs || match.durationMs;
      match.timerMs = run.timerMs ?? match.timerMs;
      match.timed = run.timed;
      match.scoreValue = run.scoreValue ?? match.scoreValue;
    }
    if (match.seasonSlug === "unknown" && run.seasonSlug !== "unknown") {
      match.seasonSlug = run.seasonSlug;
    } else if (
      incomingPriority > existingPriority &&
      run.seasonSlug !== "unknown" &&
      !run.seasonSlug.startsWith("placeholder")
    ) {
      match.seasonSlug = run.seasonSlug;
    }
  }
  return merged;
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
