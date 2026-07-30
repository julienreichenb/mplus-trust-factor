import { z } from "zod";

export const accountTrustScoreStatusSchema = z.enum([
  "NOT_REQUESTED",
  "DISCOVERING",
  "QUEUED",
  "RUNNING",
  "AVAILABLE",
  "PARTIAL",
  "STALE",
  /** Published score visible while a background refresh is in flight. */
  "REFRESHING",
  "FAILED",
  "UNAVAILABLE",
]);

export type AccountTrustScoreStatus = z.infer<typeof accountTrustScoreStatusSchema>;

export const accountCharacterClassSchema = z.object({
  id: z.number().int().nullable(),
  slug: z.string().nullable(),
  name: z.string().nullable(),
  color: z.string().nullable(),
});

export const accountCharacterMediaSchema = z.object({
  portraitUrl: z.string().url().nullable(),
});

export const accountCurrentSeasonMythicSchema = z.object({
  rating: z.number().nullable(),
  seasonId: z.string().nullable(),
  fetchedAt: z.string().datetime().nullable(),
  source: z.string().nullable(),
  state: z.enum(["OK", "STALE", "UNAVAILABLE", "ERROR", "PENDING"]).nullable(),
});

export const accountTrustScoreSchema = z.object({
  status: accountTrustScoreStatusSchema,
  jobId: z.string().nullable(),
  score: z.number().nullable(),
  grade: z.string().nullable(),
  confidence: z.number().nullable(),
  modelVersion: z.number().int().nullable(),
  calculatedAt: z.string().datetime().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
});

export const accountRelevanceSchema = z.object({
  policyVersion: z.string(),
  eligible: z.boolean(),
  reasons: z.array(z.string()),
  evaluatedAt: z.string().datetime().nullable(),
});

export const accountOwnedCharacterSchema = z.object({
  ownershipId: z.string().uuid(),
  characterId: z.string().uuid().nullable(),
  region: z.string(),
  realmSlug: z.string(),
  realmName: z.string().nullable(),
  name: z.string(),
  level: z.number().int().nullable(),
  isPrimary: z.boolean(),
  characterClass: accountCharacterClassSchema,
  media: accountCharacterMediaSchema,
  currentSeasonMythic: accountCurrentSeasonMythicSchema,
  trustScore: accountTrustScoreSchema,
  relevance: accountRelevanceSchema,
});

export const accountDiscoveryStatusSchema = z.object({
  status: z.enum(["IDLE", "QUEUED", "RUNNING", "COMPLETED", "FAILED"]),
  jobId: z.string().nullable(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  error: z.string().nullable(),
});

export const accountCharactersResponseSchema = z.object({
  characters: z.array(accountOwnedCharacterSchema),
  discovery: accountDiscoveryStatusSchema,
  hiddenCharacterCount: z.number().int().nonnegative(),
  totalOwnedCharacterCount: z.number().int().nonnegative(),
  /** Present when no CURRENT primary exists among relevant rows. */
  primaryDiagnostic: z.string().nullable().optional(),
});

export type AccountOwnedCharacterDTO = z.infer<typeof accountOwnedCharacterSchema>;
export type AccountCharactersResponse = z.infer<typeof accountCharactersResponseSchema>;
export type AccountDiscoveryStatus = z.infer<typeof accountDiscoveryStatusSchema>;
