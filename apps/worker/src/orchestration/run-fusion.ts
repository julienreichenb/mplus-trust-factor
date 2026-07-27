import { createHash } from "node:crypto";
import type {
  CharacterIdentityInput,
  MythicRunDTO,
  RaiderIoRunCandidate,
  RegionCode,
  RunParticipantDTO,
  RunSourceRefDTO,
} from "@mplus/contracts";

function fingerprint(parts: string[]): string {
  return createHash("sha256").update(parts.join("|"), "utf8").digest("hex").slice(0, 32);
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

  const canonicalFingerprint = fingerprint([
    "raiderio",
    candidate.externalRunId,
    candidate.dungeonSlug,
    String(candidate.keyLevel),
    candidate.completedAt,
  ]);

  return {
    id: `rio:${candidate.externalRunId}`,
    region: target.region as RegionCode,
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

/** Deduplicate runs that share dungeon+key+completion window across providers. */
export function mergeRunSources(runs: MythicRunDTO[]): MythicRunDTO[] {
  const merged: MythicRunDTO[] = [];
  for (const run of runs) {
    const match = merged.find(
      (existing) =>
        existing.dungeonSlug === run.dungeonSlug &&
        existing.keyLevel === run.keyLevel &&
        Math.abs(new Date(existing.completedAt).getTime() - new Date(run.completedAt).getTime()) <=
          120_000,
    );
    if (!match) {
      merged.push({ ...run, sources: [...run.sources], participants: [...run.participants] });
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
  }
  return merged;
}
