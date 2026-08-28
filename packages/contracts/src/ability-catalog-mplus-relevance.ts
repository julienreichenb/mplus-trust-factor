import { z } from "zod";
import type { IsoDateTime } from "./identity.js";

export const MPLUS_RELEVANCE_STATES = ["INCLUDED", "EXCLUDED", "UNCLASSIFIED"] as const;
export type MplusRelevance = (typeof MPLUS_RELEVANCE_STATES)[number];

export const abilityCatalogExclusionMutationSchema = z
  .object({
    canonicalKey: z.string().min(1).max(200).optional(),
    primarySpellId: z.number().int().positive().optional(),
    note: z.string().max(4000).optional(),
  })
  .strict()
  .refine((body) => Boolean(body.canonicalKey?.trim() || body.primarySpellId), {
    message: "canonicalKey or primarySpellId is required",
  });

export type AbilityCatalogExclusionMutation = z.infer<typeof abilityCatalogExclusionMutationSchema>;

export interface AbilityCatalogExclusionDTO {
  id: string;
  stableAbilityIdentity: string;
  canonicalKey: string | null;
  primarySpellId: number | null;
  excludedByUserId: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
