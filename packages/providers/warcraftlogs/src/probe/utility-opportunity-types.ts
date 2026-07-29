/**
 * Dimension-independent Utility opportunity contract (V3.2 experiment).
 * Designed to consume a future shared WCL evidence bundle (Survival + Utility).
 */
export type UtilityOpportunityType =
  | "interrupt"
  | "stun_or_disorient_cast_stop"
  | "dispel"
  | "purge"
  | "crowd_control_application"
  | "external_defensive"
  | "emergency_support"
  | "mechanic_avoidance"
  | "group_mobility";

export type UtilityOpportunityOutcome =
  | "SUCCESS_DIRECT_INTERRUPT"
  | "SUCCESS_ALTERNATIVE_STOP"
  | "SUCCESS_OTHER_PLAYER"
  | "SUCCESS_REACTIVE_SUPPORT"
  | "SUCCESS_STRATEGIC_SUPPORT"
  | "CAST_COMPLETED_CONFIRMED_MISS"
  | "SUPPORT_OPPORTUNITY_MISSED"
  | "NOT_OBSERVABLE"
  | "NOT_APPLICABLE";

export type UtilityOpportunityConfidence = "HIGH" | "MEDIUM" | "LOW";

export type SupportSemanticClass =
  | "PERSONAL_MOBILITY"
  | "ROUTINE_ROTATIONAL_SUPPORT"
  | "PASSIVE_SUPPORT"
  | "REACTIVE_SUPPORT"
  | "STRATEGIC_SUPPORT"
  | "EMERGENCY_SUPPORT"
  | "UNVERIFIED_EXTERNAL";

export interface UtilityOpportunity {
  id: string;
  runId: string;
  dungeonSlug: string;
  sourceActorId: number | null;
  targetActorId: number | null;
  hostileSpellId: number | null;
  abilityGameId: number | null;
  opportunityType: UtilityOpportunityType;
  openedAt: number;
  closedAt: number | null;
  outcome: UtilityOpportunityOutcome;
  confidence: UtilityOpportunityConfidence;
  /** Severity 0–1 from mechanic catalog or heuristic. */
  severity: number;
  eligibleActions: number[];
  exclusionReasons: string[];
  evidenceReferences: string[];
  /** How this opportunity was derived. */
  derivation:
    | "hostile_cast_window"
    | "success_only_implied"
    | "dispel_aura_window"
    | "synthetic_fixture"
    | "catalog_mechanic";
  semanticClass?: SupportSemanticClass | null;
}

export interface OpportunityExtractionCoverage {
  character: string;
  runs: number;
  dungeons: number;
  byType: Record<string, number>;
  byOutcome: Record<string, number>;
  byConfidence: Record<string, number>;
  byDerivation: Record<string, number>;
  interruptSuccessImplied: number;
  interruptConfirmedMisses: number;
  interruptNotObservable: number;
  hostileCastWindowsAvailable: boolean;
  mechanicCatalogPriorityInterrupts: number;
  missingData: Array<{
    opportunityType: string;
    classification:
      | "extraction_logic_missing"
      | "mechanic_catalog_missing"
      | "ability_catalog_missing"
      | "event_stream_missing"
      | "wcl_schema_insufficient"
      | "fundamentally_not_observable";
    detail: string;
  }>;
}

export interface RawEvidenceAuditFinding {
  character: string;
  castsEventCount: number;
  castsNpcSourceCount: number;
  castsFriendlySourceCount: number;
  castsInterruptibleFlagCount: number;
  castFailedOrInterruptedCount: number;
  interruptEventCount: number;
  playerInterruptEventCount: number;
  uniqueInterruptedHostileSpells: number;
  dispelEventCount: number;
  buffEventCount: number;
  debuffEventCount: number;
  deathsArtifactPresent: boolean;
  filterSourceId: number | null;
  interruptOpportunitiesPersisted: number;
  dispelOpportunitiesPersisted: number;
  canDeriveInterruptMissesOffline: boolean;
  canDeriveInterruptSuccessesOffline: boolean;
  canDeriveDispelOpportunitiesOffline: boolean;
  notes: string[];
}
