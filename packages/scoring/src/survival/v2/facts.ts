import {
  SURVIVAL_V2_EXTRACTOR_FAMILY,
  SURVIVAL_V2_SCHEMA_VERSION,
} from "./constants.js";
import type {
  SurvivalFactDocumentV2,
  SurvivalV2ActiveHealingFactEvent,
  SurvivalV2DangerWindowFact,
  SurvivalV2DefensiveActivationFact,
  SurvivalV2DeathFact,
  SurvivalV2HealthEvidenceMode,
  SurvivalV2TimedActivationFact,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asNonNegInt(value: unknown): number | null {
  const n = asFiniteNumber(value);
  if (n == null || n < 0 || !Number.isInteger(n)) return null;
  return n;
}

/**
 * Parse a bounded Survival fact document. Rejects unbounded event arrays.
 * Returns null when schema is wrong or document exceeds Phase 1 bounds.
 */
export function parseSurvivalFactDocumentV2(
  raw: unknown,
): { ok: true; document: SurvivalFactDocumentV2 } | { ok: false; reason: string } {
  if (!isRecord(raw)) return { ok: false, reason: "not_object" };
  if (raw.schemaVersion !== SURVIVAL_V2_SCHEMA_VERSION) {
    return { ok: false, reason: "schema_version_mismatch" };
  }
  if (raw.extractorFamily !== SURVIVAL_V2_EXTRACTOR_FAMILY) {
    return { ok: false, reason: "extractor_family_mismatch" };
  }
  if (typeof raw.extractorVersion !== "string" || raw.extractorVersion.length === 0) {
    return { ok: false, reason: "missing_extractor_version" };
  }
  if (typeof raw.dungeonSlug !== "string" || raw.dungeonSlug.length === 0) {
    return { ok: false, reason: "missing_dungeon_slug" };
  }
  const slotIndex = asNonNegInt(raw.slotIndex);
  if (slotIndex == null) return { ok: false, reason: "invalid_slot_index" };

  if (!isRecord(raw.identity)) return { ok: false, reason: "missing_identity" };
  const reportCode = raw.identity.reportCode;
  const fightId = asNonNegInt(raw.identity.fightId);
  const reportRevision = asNonNegInt(raw.identity.reportRevision);
  if (typeof reportCode !== "string" || fightId == null || reportRevision == null) {
    return { ok: false, reason: "invalid_identity" };
  }

  const deaths = parseDeaths(raw.deaths);
  if (!deaths.ok) return deaths;
  const activeCombat = parseActiveCombat(raw.activeCombat);
  if (!activeCombat.ok) return activeCombat;
  const defensive = parseDefensive(raw.defensiveActivations);
  if (!defensive.ok) return defensive;

  if (!Array.isArray(raw.dangerWindows)) {
    return { ok: false, reason: "danger_windows_not_array" };
  }
  if (raw.dangerWindows.length > 256) {
    return { ok: false, reason: "danger_windows_unbounded" };
  }
  const dangerWindows: SurvivalV2DangerWindowFact[] = [];
  for (const row of raw.dangerWindows) {
    const parsed = parseDangerWindow(row);
    if (!parsed.ok) return parsed;
    dangerWindows.push(parsed.window);
  }

  if (!isRecord(raw.healthEvidence) || typeof raw.healthEvidence.mode !== "string") {
    return { ok: false, reason: "missing_health_evidence" };
  }
  const healthMode = raw.healthEvidence.mode as SurvivalV2HealthEvidenceMode;
  if (
    healthMode !== "FULL" &&
    healthMode !== "PARTIAL" &&
    healthMode !== "OUTCOME_ONLY" &&
    healthMode !== "TRUNCATED" &&
    healthMode !== "MISSING"
  ) {
    return { ok: false, reason: "invalid_health_evidence_mode" };
  }

  if (!Array.isArray(raw.limitations)) {
    return { ok: false, reason: "limitations_not_array" };
  }
  if (raw.limitations.length > 64) {
    return { ok: false, reason: "limitations_unbounded" };
  }
  for (const lim of raw.limitations) {
    if (typeof lim !== "string") return { ok: false, reason: "invalid_limitation" };
  }

  const keyLevel =
    raw.keyLevel == null ? null : asFiniteNumber(raw.keyLevel);

  const document: SurvivalFactDocumentV2 = {
    schemaVersion: SURVIVAL_V2_SCHEMA_VERSION,
    extractorFamily: SURVIVAL_V2_EXTRACTOR_FAMILY,
    extractorVersion: raw.extractorVersion,
    dungeonSlug: raw.dungeonSlug,
    slotIndex,
    identity: { reportCode, fightId, reportRevision },
    keyLevel,
    deaths: deaths.deaths,
    activeCombat: activeCombat.activeCombat,
    defensiveActivations: defensive.defensive,
    dangerWindows,
    pressureClustersPremerged: raw.pressureClustersPremerged === true,
    healthEvidence: {
      mode: healthMode,
      catalogSelfHealCoverage:
        asFiniteNumber(raw.healthEvidence.catalogSelfHealCoverage) ?? undefined,
    },
    relativeDamage: parseRelativeDamage(raw.relativeDamage),
    activeHealingEvents: parseActiveHealingEvents(raw.activeHealingEvents),
    recoveryTimedActivations: parseRecoveryTimedActivations(raw.recoveryTimedActivations),
    limitations: raw.limitations as string[],
  };

  return { ok: true, document };
}

function parseDeaths(
  raw: unknown,
): { ok: true; deaths: SurvivalV2DeathFact } | { ok: false; reason: string } {
  if (!isRecord(raw)) return { ok: false, reason: "missing_deaths" };
  const count = asNonNegInt(raw.count);
  if (count == null) return { ok: false, reason: "invalid_death_count" };
  const evidenceState =
    raw.evidenceState === "MISSING" || raw.evidenceState === "OBSERVED"
      ? raw.evidenceState
      : "OBSERVED";
  return {
    ok: true,
    deaths: {
      count,
      evidenceState,
      timestampsMs: Array.isArray(raw.timestampsMs)
        ? (raw.timestampsMs.filter(
            (t): t is number => typeof t === "number" && Number.isFinite(t),
          ) as number[])
        : undefined,
      causes: Array.isArray(raw.causes)
        ? (raw.causes.filter((c): c is string => typeof c === "string") as string[])
        : undefined,
    },
  };
}

function parseActiveCombat(
  raw: unknown,
):
  | { ok: true; activeCombat: SurvivalFactDocumentV2["activeCombat"] }
  | { ok: false; reason: string } {
  if (!isRecord(raw)) return { ok: false, reason: "missing_active_combat" };
  const durationMs = asFiniteNumber(raw.durationMs);
  const fightDurationMs = asFiniteNumber(raw.fightDurationMs);
  if (durationMs == null || durationMs < 0 || fightDurationMs == null || fightDurationMs < 0) {
    return { ok: false, reason: "invalid_active_combat" };
  }
  return {
    ok: true,
    activeCombat: {
      durationMs,
      fightDurationMs,
      truncated: raw.truncated === true,
    },
  };
}

function parseDefensive(
  raw: unknown,
):
  | { ok: true; defensive: SurvivalV2DefensiveActivationFact }
  | { ok: false; reason: string } {
  if (!isRecord(raw)) return { ok: false, reason: "missing_defensive_activations" };
  if (!isRecord(raw.byCategory)) return { ok: false, reason: "missing_by_category" };
  if (!Array.isArray(raw.toolkit)) return { ok: false, reason: "missing_toolkit" };
  if (raw.toolkit.length > 128) return { ok: false, reason: "toolkit_unbounded" };
  const catalogCoverage = asFiniteNumber(raw.catalogCoverage);
  if (catalogCoverage == null || catalogCoverage < 0 || catalogCoverage > 1) {
    return { ok: false, reason: "invalid_catalog_coverage" };
  }
  const byCategory: SurvivalV2DefensiveActivationFact["byCategory"] = {};
  for (const [key, value] of Object.entries(raw.byCategory)) {
    const n = asNonNegInt(value);
    if (n == null) return { ok: false, reason: "invalid_activation_count" };
    byCategory[key as keyof typeof byCategory] = n;
  }
  return {
    ok: true,
    defensive: {
      byCategory,
      toolkit: raw.toolkit as SurvivalV2DefensiveActivationFact["toolkit"],
      catalogCoverage,
      timedActivations: Array.isArray(raw.timedActivations)
        ? (raw.timedActivations as SurvivalV2DefensiveActivationFact["timedActivations"])
        : undefined,
    },
  };
}

function parseDangerWindow(
  raw: unknown,
):
  | { ok: true; window: SurvivalV2DangerWindowFact }
  | { ok: false; reason: string } {
  if (!isRecord(raw)) return { ok: false, reason: "invalid_danger_window" };
  const startMs = asFiniteNumber(raw.startMs);
  const endMs = asFiniteNumber(raw.endMs);
  if (startMs == null || endMs == null || endMs < startMs) {
    return { ok: false, reason: "invalid_danger_window_bounds" };
  }
  if (!Array.isArray(raw.triggerTypes)) {
    return { ok: false, reason: "invalid_trigger_types" };
  }
  return {
    ok: true,
    window: {
      startMs,
      endMs,
      triggerTypes: raw.triggerTypes.filter((t): t is string => typeof t === "string"),
      hpEvidenceQuality:
        raw.hpEvidenceQuality === "EXPLICIT" ||
        raw.hpEvidenceQuality === "RECONSTRUCTED" ||
        raw.hpEvidenceQuality === "PARTIAL" ||
        raw.hpEvidenceQuality === "MISSING"
          ? raw.hpEvidenceQuality
          : "MISSING",
      damageAmount: asFiniteNumber(raw.damageAmount),
      recoveryUseful: raw.recoveryUseful === true,
      recoveryEligible: raw.recoveryEligible === true,
      deathOutcome: raw.deathOutcome === true,
      availabilityState:
        typeof raw.availabilityState === "string"
          ? (raw.availabilityState as SurvivalV2DangerWindowFact["availabilityState"])
          : null,
      defensiveResponseClass:
        raw.defensiveResponseClass === "ANTICIPATED" ||
        raw.defensiveResponseClass === "REACTIVE" ||
        raw.defensiveResponseClass === "NO_RESPONSE_AVAILABLE" ||
        raw.defensiveResponseClass === "NO_TOOL_AVAILABLE" ||
        raw.defensiveResponseClass === "NOT_OBSERVABLE"
          ? raw.defensiveResponseClass
          : undefined,
      recoveryResponseClass:
        raw.recoveryResponseClass === "TIMELY_RECOVERY" ||
        raw.recoveryResponseClass === "LATE_RECOVERY" ||
        raw.recoveryResponseClass === "NO_RECOVERY_AVAILABLE" ||
        raw.recoveryResponseClass === "NO_SELF_HEAL_AVAILABLE" ||
        raw.recoveryResponseClass === "NOT_OBSERVABLE"
          ? raw.recoveryResponseClass
          : undefined,
    },
  };
}

function parseRelativeDamage(
  raw: unknown,
): SurvivalFactDocumentV2["relativeDamage"] {
  if (raw == null) return null;
  if (!isRecord(raw)) return null;
  const role = raw.role;
  if (role !== "DPS" && role !== "TANK" && role !== "HEALER") return null;
  return {
    role,
    targetDamagePerActiveSecond: asFiniteNumber(raw.targetDamagePerActiveSecond),
    nonTankGroupMedianPerActiveSecond: asFiniteNumber(
      raw.nonTankGroupMedianPerActiveSecond,
    ),
    selfDamageExcluded: raw.selfDamageExcluded === true,
    mandatoryDamageExcluded: raw.mandatoryDamageExcluded === true,
    mechanicExclusionCoverage: asFiniteNumber(raw.mechanicExclusionCoverage) ?? 0,
    passiveMitigationCaveat:
      typeof raw.passiveMitigationCaveat === "string" ? raw.passiveMitigationCaveat : null,
    limitations: Array.isArray(raw.limitations)
      ? raw.limitations.filter((l): l is string => typeof l === "string")
      : [],
  };
}

function parseRecoveryTimedActivations(
  raw: unknown,
): SurvivalV2TimedActivationFact[] | undefined {
  if (raw == null) return undefined;
  if (!Array.isArray(raw) || raw.length > 512) return [];
  const out: SurvivalV2TimedActivationFact[] = [];
  for (const row of raw) {
    if (!isRecord(row)) continue;
    const timestampMs = asFiniteNumber(row.timestampMs);
    const abilityGameId = asNonNegInt(row.abilityGameId);
    if (timestampMs == null || abilityGameId == null) continue;
    out.push({
      id: typeof row.id === "string" ? row.id : `${abilityGameId}:${timestampMs}`,
      timestampMs,
      abilityGameId,
      category: (typeof row.category === "string" ? row.category : "SELF_HEAL") as SurvivalV2TimedActivationFact["category"],
    });
  }
  return out;
}

function parseActiveHealingEvents(raw: unknown): SurvivalV2ActiveHealingFactEvent[] | undefined {
  if (raw == null) return undefined;
  if (!Array.isArray(raw) || raw.length > 512) return [];
  const out: SurvivalV2ActiveHealingFactEvent[] = [];
  for (const row of raw) {
    if (!isRecord(row)) continue;
    const timestampMs = asFiniteNumber(row.timestampMs);
    const primarySpellId = asNonNegInt(row.primarySpellId);
    if (timestampMs == null || primarySpellId == null) continue;
    const relation = row.targetRelation;
    if (relation !== "SELF" && relation !== "ALLY" && relation !== "EXCLUDED") continue;
    const quality = row.evidenceQuality;
    if (
      quality !== "FULL" &&
      quality !== "AMOUNT_ONLY" &&
      quality !== "OVERHEAL_UNOBSERVABLE" &&
      quality !== "MAX_HP_UNAVAILABLE" &&
      quality !== "EXCLUDED"
    ) {
      continue;
    }
    out.push({
      canonicalEventId: typeof row.canonicalEventId === "string" ? row.canonicalEventId : "",
      timestampMs,
      primarySpellId,
      targetRelation: relation,
      effectiveAmount: asFiniteNumber(row.effectiveAmount),
      effectiveHealPctMaxHp: asFiniteNumber(row.effectiveHealPctMaxHp),
      evidenceQuality: quality,
    });
  }
  return out;
}

/** Stable key for matching fact sets to manifest slots. */
export function survivalFactSlotKey(dungeonSlug: string, slotIndex: number): string {
  return `${dungeonSlug.trim().toLowerCase()}#${slotIndex}`;
}
