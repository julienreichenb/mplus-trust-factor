import { z } from "zod";
import type { MythicRunDTO } from "@mplus/contracts";

export const blizzardCharacterFixtureSchema = z.object({
  region: z.string().min(1),
  realmSlug: z.string().min(1),
  name: z.string().min(1),
  displayName: z.string().min(1),
  classSlug: z.string().nullable(),
  specSlug: z.string().nullable(),
  role: z.enum(["DPS", "TANK", "HEALER"]).nullable(),
  blizzardCharacterId: z.string().nullable(),
  wclCanonicalId: z.string().nullable(),
  raiderioProfileUrl: z.string().nullable(),
  itemLevelEquipped: z.number().nullable(),
  mythicRating: z.number().nullable(),
  lastSeenAt: z.string().datetime().nullable(),
  lastPublicRefreshAt: z.string().datetime().nullable(),
});

export const runParticipantFixtureSchema = z.object({
  providerCharacterKey: z.string().min(1),
  displayName: z.string().min(1),
  realmSlug: z.string().min(1),
  region: z.string().min(1),
  classSlug: z.string().nullable(),
  specSlug: z.string().nullable(),
  role: z.enum(["DPS", "TANK", "HEALER"]).nullable(),
  itemLevel: z.number().nullable(),
  mythicRatingAtRun: z.number().nullable(),
  isTargetCharacter: z.boolean(),
  characterId: z.string().uuid().nullable(),
});

export const runSourceFixtureSchema = z.object({
  provider: z.enum(["BLIZZARD", "WARCRAFT_LOGS", "RAIDER_IO"]),
  externalRunId: z.string().min(1),
  externalUrl: z.string().nullable(),
  reportCode: z.string().nullable(),
  fightId: z.number().nullable(),
  revision: z.number().nullable(),
});

export const mythicRunFixtureSchema = z.object({
  id: z.string().min(1),
  region: z.string().min(1),
  seasonSlug: z.string().min(1),
  dungeonSlug: z.string().min(1),
  keyLevel: z.number().int().positive(),
  completedAt: z.string().datetime(),
  durationMs: z.number().int().nonnegative(),
  timerMs: z.number().int().positive().nullable(),
  timed: z.boolean(),
  scoreValue: z.number().nullable(),
  canonicalFingerprint: z.string().min(32),
  affixes: z.unknown(),
  participants: z.array(runParticipantFixtureSchema).min(1),
  sources: z.array(runSourceFixtureSchema).min(1),
});

export const warcraftlogsCharacterRunsFixtureSchema = z.object({
  characterCanonicalId: z.number(),
  runs: z.array(mythicRunFixtureSchema),
});

export const raiderioCharacterFixtureSchema = z.object({
  region: z.string().min(1),
  realm: z.string().min(1),
  name: z.string().min(1),
  mythic_plus_scores: z.object({
    all: z.number(),
    dps: z.number().optional(),
    healer: z.number().optional(),
    tank: z.number().optional(),
  }),
  mythic_plus_ranks: z.record(z.unknown()).optional(),
  mythic_plus_recent_runs: z.array(z.record(z.unknown())).optional(),
});

export const expertCohortFixtureSchema = z.object({
  cohortVersion: z.string(),
  description: z.string(),
  characters: z.array(
    z.object({
      id: z.string(),
      region: z.string(),
      realmSlug: z.string(),
      name: z.string(),
      expectedScoreRange: z.object({ min: z.number(), max: z.number() }),
      observations: z.array(z.record(z.unknown())),
    }),
  ),
});

export function parseMythicRunFixture(data: unknown): MythicRunDTO {
  return mythicRunFixtureSchema.parse(data) as MythicRunDTO;
}
