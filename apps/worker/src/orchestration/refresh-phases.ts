/** Explicit refresh processing phases persisted on ingestion jobs. */
export const REFRESH_PHASES = [
  "REQUESTED",
  "COALESCED",
  "PROVIDER_BUDGET_CHECK",
  "FETCH_REQUIRED_DATA",
  "NORMALIZE",
  "PERSIST_OBSERVATIONS",
  "CALCULATE_CANDIDATE",
  "VALIDATE_COHERENCE",
  "PUBLISH_ATOMICALLY",
  "COMPLETE",
] as const;

export type RefreshPhase = (typeof REFRESH_PHASES)[number];

export const REFRESH_FAILURE_PHASES = [
  "DEFERRED_RATE_LIMIT",
  "DEFERRED_COOLDOWN",
  "PARTIAL_PROVIDER_FAILURE",
  "FAILED_RETRYABLE",
  "FAILED_TERMINAL",
  "REJECTED_INCOMPLETE",
] as const;

export type RefreshFailurePhase = (typeof REFRESH_FAILURE_PHASES)[number];

export interface RefreshPhaseTransition {
  phase: RefreshPhase | RefreshFailurePhase;
  at: string;
  diagnostics?: Record<string, unknown>;
}

export function buildPhaseTransition(
  phase: RefreshPhase | RefreshFailurePhase,
  diagnostics?: Record<string, unknown>,
): RefreshPhaseTransition {
  return {
    phase,
    at: new Date().toISOString(),
    ...(diagnostics ? { diagnostics } : {}),
  };
}

export function appendPhaseTransition(
  existing: RefreshPhaseTransition[] | undefined,
  transition: RefreshPhaseTransition,
): RefreshPhaseTransition[] {
  return [...(existing ?? []), transition];
}

export function readRefreshPhases(payload: unknown): RefreshPhaseTransition[] {
  if (!payload || typeof payload !== "object") return [];
  const phases = (payload as { phaseTransitions?: unknown }).phaseTransitions;
  if (!Array.isArray(phases)) return [];
  return phases.filter(
    (p): p is RefreshPhaseTransition =>
      Boolean(p) &&
      typeof p === "object" &&
      typeof (p as RefreshPhaseTransition).phase === "string" &&
      typeof (p as RefreshPhaseTransition).at === "string",
  );
}

export function latestRefreshPhase(payload: unknown): RefreshPhase | RefreshFailurePhase | null {
  const phases = readRefreshPhases(payload);
  return phases.length > 0 ? phases[phases.length - 1]!.phase : null;
}
