/**
 * WclRunRaw.payload envelope for Scoring.
 *
 * Persists the capability package together with fight masterData so warm cache
 * and provider-free replay can resolve the same roster without calling WCL.
 *
 * Backward compatible with legacy bare CapabilityEvidencePackageV1 payloads.
 */
import { z } from "zod";
import {
  assertCapabilityEvidencePackageV1,
  capabilityEvidencePackageV1Schema,
  CAPABILITY_EVIDENCE_PACKAGE_SCHEMA_VERSION,
  type CapabilityEvidencePackageV1,
} from "./capability-evidence-v1.js";

export const WCL_RUN_RAW_PAYLOAD_SCHEMA_VERSION =
  "wcl-run-raw-payload-v1" as const;

export const wclRunRawPayloadV1Schema = z
  .object({
    schemaVersion: z.literal(WCL_RUN_RAW_PAYLOAD_SCHEMA_VERSION),
    capabilityPackage: capabilityEvidencePackageV1Schema,
    masterData: z.unknown(),
    regionCode: z.string().min(1).nullable().optional(),
    combatantInfoEvents: z
      .array(z.record(z.string(), z.unknown()))
      .nullable()
      .optional(),
  })
  .strict();

export type WclRunRawPayloadV1 = z.infer<typeof wclRunRawPayloadV1Schema>;

export interface ParsedWclRunRawPayload {
  package: CapabilityEvidencePackageV1;
  masterData: unknown | null;
  regionCode: string | null;
  combatantInfoEvents: Array<Record<string, unknown>> | null;
  /** True when payload is the envelope that includes masterData. */
  hasEmbeddedRosterSource: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function incompatible(message: string): never {
  throw Object.assign(new Error(message), {
    code: "RAW_PACKAGE_SCHEMA_INCOMPATIBLE" as const,
  });
}

/**
 * Parse WclRunRaw.payload: envelope v1 or legacy bare capability package.
 */
export function parseWclRunRawPayload(payload: unknown): ParsedWclRunRawPayload {
  const root = asRecord(payload);
  if (!root) {
    incompatible("wcl_run_raw_payload_invalid");
  }

  const schemaVersion =
    typeof root.schemaVersion === "string" ? root.schemaVersion : null;

  if (schemaVersion === WCL_RUN_RAW_PAYLOAD_SCHEMA_VERSION) {
    let parsed: WclRunRawPayloadV1;
    try {
      parsed = wclRunRawPayloadV1Schema.parse(payload);
    } catch (err) {
      incompatible(
        `wcl_run_raw_payload_v1_invalid:${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const masterData = parsed.masterData ?? null;
    return {
      package: parsed.capabilityPackage,
      masterData,
      regionCode: parsed.regionCode ?? null,
      combatantInfoEvents: parsed.combatantInfoEvents ?? null,
      hasEmbeddedRosterSource: masterData != null,
    };
  }

  if (
    schemaVersion != null &&
    schemaVersion.startsWith("wcl-run-raw-payload") &&
    schemaVersion !== WCL_RUN_RAW_PAYLOAD_SCHEMA_VERSION
  ) {
    incompatible(`wcl_run_raw_payload_unsupported_version:${schemaVersion}`);
  }

  // Legacy: bare CapabilityEvidencePackageV1 (no masterData).
  if (
    schemaVersion != null &&
    schemaVersion !== CAPABILITY_EVIDENCE_PACKAGE_SCHEMA_VERSION
  ) {
    incompatible(`wcl_run_raw_payload_unknown_schema:${schemaVersion}`);
  }

  try {
    const pkg = assertCapabilityEvidencePackageV1(payload);
    return {
      package: pkg,
      masterData: null,
      regionCode: null,
      combatantInfoEvents: null,
      hasEmbeddedRosterSource: false,
    };
  } catch (err) {
    incompatible(
      `wcl_run_raw_payload_legacy_package_invalid:${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function assertCapabilityPackageFromRawPayload(
  payload: unknown,
): CapabilityEvidencePackageV1 {
  return parseWclRunRawPayload(payload).package;
}

export function buildWclRunRawPayloadV1(input: {
  capabilityPackage: CapabilityEvidencePackageV1;
  masterData: unknown;
  regionCode?: string | null;
  combatantInfoEvents?: Array<Record<string, unknown>> | null;
}): WclRunRawPayloadV1 {
  const pkg = assertCapabilityEvidencePackageV1(input.capabilityPackage);
  return wclRunRawPayloadV1Schema.parse({
    schemaVersion: WCL_RUN_RAW_PAYLOAD_SCHEMA_VERSION,
    capabilityPackage: pkg,
    masterData: input.masterData,
    regionCode: input.regionCode ?? null,
    combatantInfoEvents: input.combatantInfoEvents ?? null,
  });
}
