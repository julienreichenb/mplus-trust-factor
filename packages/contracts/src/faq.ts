import { z } from "zod";
import type { IsoDateTime } from "./identity.js";

export const FAQ_TITLE_MAX_LENGTH = 200;
export const FAQ_DESCRIPTION_MAX_LENGTH = 8_000;
export const FAQ_POSITION_MIN = -1_000_000;
export const FAQ_POSITION_MAX = 1_000_000;

function requiredTrimmedText(max: number, label: string) {
  return z
    .string({ required_error: `${label} is required` })
    .transform((value) => value.trim())
    .pipe(
      z
        .string()
        .min(1, `${label} is required`)
        .max(max, `${label} must be at most ${max} characters`),
    );
}

function optionalTrimmedText(max: number, label: string) {
  return z
    .string()
    .transform((value) => value.trim())
    .pipe(
      z
        .string()
        .min(1, `${label} is required`)
        .max(max, `${label} must be at most ${max} characters`),
    );
}

export const faqPositionSchema = z
  .number({ invalid_type_error: "Position must be an integer" })
  .int("Position must be an integer")
  .min(FAQ_POSITION_MIN, "Position is out of range")
  .max(FAQ_POSITION_MAX, "Position is out of range");

export const FAQ_EMBED_TYPES = [
  "META_TIER_TABLE",
  "KEY_PERCENTILE_TABLE",
  "SCORE_FLOW",
  "SCORING_DIMENSIONS",
  "TRUST_GRADE_LADDER",
] as const;

export const faqEmbedTypeSchema = z.enum(FAQ_EMBED_TYPES, {
  errorMap: () => ({ message: "Embedded content type is invalid" }),
});

export type FaqEmbedType = z.infer<typeof faqEmbedTypeSchema>;

export const FAQ_EMBED_TYPE_OPTIONS: ReadonlyArray<{ value: FaqEmbedType | null; label: string }> = [
  { value: null, label: "None" },
  { value: "META_TIER_TABLE", label: "Meta specialization tiers" },
  { value: "KEY_PERCENTILE_TABLE", label: "Key Difficulty percentile table" },
  { value: "SCORE_FLOW", label: "Trust Score calculation" },
  { value: "SCORING_DIMENSIONS", label: "Scoring dimensions" },
  { value: "TRUST_GRADE_LADDER", label: "Trust grade scale" },
];

/** Public FAQ row — published entries only. */
export interface PublicFaqEntryDTO {
  id: string;
  title: string;
  description: string;
  position: number;
  embedType: FaqEmbedType | null;
}

/** Admin FAQ row — includes drafts and timestamps. */
export interface AdminFaqEntryDTO extends PublicFaqEntryDTO {
  isPublished: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export const createFaqEntryRequestSchema = z
  .object({
    title: requiredTrimmedText(FAQ_TITLE_MAX_LENGTH, "Title"),
    description: requiredTrimmedText(FAQ_DESCRIPTION_MAX_LENGTH, "Description"),
    position: faqPositionSchema.optional(),
    isPublished: z.boolean().optional(),
    embedType: faqEmbedTypeSchema.nullable().optional(),
  })
  .strict();

export type CreateFaqEntryRequest = z.infer<typeof createFaqEntryRequestSchema>;

export const updateFaqEntryRequestSchema = z
  .object({
    title: optionalTrimmedText(FAQ_TITLE_MAX_LENGTH, "Title").optional(),
    description: optionalTrimmedText(FAQ_DESCRIPTION_MAX_LENGTH, "Description").optional(),
    position: faqPositionSchema.optional(),
    isPublished: z.boolean().optional(),
    embedType: faqEmbedTypeSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.title !== undefined ||
      value.description !== undefined ||
      value.position !== undefined ||
      value.isPublished !== undefined ||
      value.embedType !== undefined,
    { message: "At least one field is required" },
  );

export type UpdateFaqEntryRequest = z.infer<typeof updateFaqEntryRequestSchema>;

export const moveFaqEntryRequestSchema = z
  .object({
    direction: z.enum(["up", "down"]),
  })
  .strict();

export type MoveFaqEntryRequest = z.infer<typeof moveFaqEntryRequestSchema>;

export interface FaqListResponse<T> {
  entries: T[];
}

export type PublicFaqListResponse = FaqListResponse<PublicFaqEntryDTO>;
export type AdminFaqListResponse = FaqListResponse<AdminFaqEntryDTO>;

export function firstZodIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid FAQ payload";
}
