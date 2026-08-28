/**
 * Explicit ability-catalog execution pin (Phase 3B.4).
 *
 * STATIC and RELEASE are distinct identities — never encode static as null.
 * Absent optional job fields map to STATIC via {@link decodeAbilityCatalogExecutionPin}.
 *
 * THIS IS NOT AN ACTIVE RELEASE. Pins are frozen at job enqueue; workers never
 * look up ACTIVE or latest VALIDATED.
 */

import { z } from "zod";

export const ABILITY_CATALOG_EXECUTION_PIN_SCHEMA_VERSION =
  "ability-catalog-execution-pin-v1" as const;

export const abilityCatalogStaticPinSchema = z.object({
  kind: z.literal("STATIC"),
  catalogVersionId: z.string().min(1).max(128),
});

export const abilityCatalogReleasePinSchema = z.object({
  kind: z.literal("RELEASE"),
  releaseId: z.string().uuid(),
  releaseKey: z.string().min(1).max(256),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
  schemaVersion: z.string().min(1).max(64),
});

export const abilityCatalogExecutionPinSchema = z.discriminatedUnion("kind", [
  abilityCatalogStaticPinSchema,
  abilityCatalogReleasePinSchema,
]);

export type AbilityCatalogStaticPin = z.infer<typeof abilityCatalogStaticPinSchema>;
export type AbilityCatalogReleasePin = z.infer<typeof abilityCatalogReleasePinSchema>;
export type AbilityCatalogExecutionPin = z.infer<typeof abilityCatalogExecutionPinSchema>;

/** Stable key for refresh-contract hash / score uniqueness / dedupe. */
export function abilityCatalogExecutionKey(pin: AbilityCatalogExecutionPin): string {
  if (pin.kind === "STATIC") {
    return `static:${pin.catalogVersionId}`;
  }
  return `release:${pin.releaseId}:${pin.contentDigest}`;
}

/**
 * Bridge stamp for legacy `abilityCatalogVersion` refresh-contract field.
 * STATIC → catalogVersionId; RELEASE → releaseKey (not interchangeable provenance).
 */
export function abilityCatalogVersionStamp(pin: AbilityCatalogExecutionPin): string {
  if (pin.kind === "STATIC") return pin.catalogVersionId;
  return pin.releaseKey;
}

export function createStaticAbilityCatalogPin(
  catalogVersionId: string,
): AbilityCatalogStaticPin {
  return { kind: "STATIC", catalogVersionId };
}

/**
 * Legacy / absent job field → STATIC.
 * Never interprets absence as a release pin.
 */
export function decodeAbilityCatalogExecutionPin(
  raw: unknown,
  fallbackCatalogVersionId: string,
): AbilityCatalogExecutionPin {
  if (raw == null) {
    return createStaticAbilityCatalogPin(fallbackCatalogVersionId);
  }
  const parsed = abilityCatalogExecutionPinSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `ABILITY_CATALOG_EXECUTION_PIN_INVALID: ${parsed.error.issues
        .map((i) => i.message)
        .join("; ")}`,
    );
  }
  return parsed.data;
}

export type AbilityCatalogPinErrorCode =
  | "ABILITY_CATALOG_RELEASE_NOT_FOUND"
  | "ABILITY_CATALOG_RELEASE_INVALID"
  | "ABILITY_CATALOG_RELEASE_DIGEST_MISMATCH"
  | "ABILITY_CATALOG_RELEASE_SCHEMA_UNSUPPORTED"
  | "ABILITY_CATALOG_RELEASE_STATUS_NOT_EXECUTABLE"
  | "ABILITY_CATALOG_EXECUTION_PIN_INVALID"
  | "ABILITY_CATALOG_EXECUTION_PIN_UNSUPPORTED";

export class AbilityCatalogPinError extends Error {
  readonly code: AbilityCatalogPinErrorCode;

  constructor(code: AbilityCatalogPinErrorCode, message: string) {
    super(message);
    this.name = "AbilityCatalogPinError";
    this.code = code;
  }
}

/** Statuses allowed for RELEASE-pinned job execution (immutable content). */
export const ABILITY_CATALOG_EXECUTABLE_RELEASE_STATUSES = [
  "VALIDATED",
  "ACTIVE",
  "SUPERSEDED",
] as const;

export type AbilityCatalogExecutableReleaseStatus =
  (typeof ABILITY_CATALOG_EXECUTABLE_RELEASE_STATUSES)[number];

export function isExecutableAbilityCatalogReleaseStatus(
  status: string,
): status is AbilityCatalogExecutableReleaseStatus {
  return (ABILITY_CATALOG_EXECUTABLE_RELEASE_STATUSES as readonly string[]).includes(
    status,
  );
}

/** Statuses that may be selected as ACTIVE via publish/rollback (Phase 3B.5). */
export const ABILITY_CATALOG_ACTIVATABLE_RELEASE_STATUSES = [
  "VALIDATED",
  "SUPERSEDED",
] as const;

