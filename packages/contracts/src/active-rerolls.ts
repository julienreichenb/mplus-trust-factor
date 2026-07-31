import { z } from "zod";
import type { Grade } from "./scoring.js";

/** Hard cap on Active Rerolls rows returned to any authenticated viewer. */
export const ACTIVE_REROLLS_MAX = 24;

/** Trust Score letter grades accepted on the Active Rerolls DTO. */
export const activeRerollGradeSchema = z.enum(["S", "A", "B", "C", "D", "U"]);

/**
 * Slim Active Rerolls row — authenticated-viewer presentation only.
 * Never includes BattleTag, provider account id, platform user id, email,
 * ownership confidence, relevance diagnostics, or linkage metadata.
 */
export const activeRerollCharacterSchema = z.object({
  characterId: z.string().uuid(),
  region: z.string(),
  realmSlug: z.string(),
  realmName: z.string().nullable(),
  name: z.string(),
  classSlug: z.string().nullable(),
  className: z.string().nullable(),
  classColor: z.string().nullable(),
  portraitUrl: z.string().url().nullable(),
  /** Current Mythic+/Raider.IO score when known (ownership current-season field). */
  mythicPlusScore: z.number().nullable(),
  /**
   * Trust Factor grade from the published score snapshot for the current region
   * season + active score model (same semantics as Account page trustScore.grade).
   * Null when unpublished / unavailable — never fabricated, never a leaderboard rank.
   */
  grade: activeRerollGradeSchema.nullable(),
  /** Derived from VerifiedCharacterOwnership.isPrimary after deterministic resolution. */
  isMain: z.boolean(),
});

export const activeRerollsResponseSchema = z.object({
  /** Whether the displayed character is the resolved account primary (isPrimary). */
  displayedCharacterIsMain: z.boolean(),
  rerolls: z.array(activeRerollCharacterSchema).max(ACTIVE_REROLLS_MAX),
});

export type ActiveRerollGrade = z.infer<typeof activeRerollGradeSchema>;
export type ActiveRerollCharacterDTO = z.infer<typeof activeRerollCharacterSchema>;
export type ActiveRerollsResponse = z.infer<typeof activeRerollsResponseSchema>;

/** Narrow a published snapshot grade string to the public Grade contract. */
export function toActiveRerollGrade(value: unknown): Grade | null {
  const parsed = activeRerollGradeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Explicit Warcraft Logs hostnames accepted for clickable selected-run links. */
export const WARCRAFT_LOGS_URL_HOSTNAMES = ["www.warcraftlogs.com", "warcraftlogs.com"] as const;

/**
 * Validate a public Warcraft Logs report URL.
 * HTTPS only; exact hostname allowlist (no suffix matching).
 */
export function sanitizeWarcraftLogsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (!(WARCRAFT_LOGS_URL_HOSTNAMES as readonly string[]).includes(host)) return null;
    return url.toString();
  } catch {
    return null;
  }
}
