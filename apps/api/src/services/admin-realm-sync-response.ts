import type { AdminRealmSyncResult, AdminRealmSyncResponse } from "@mplus/contracts";
import type { RealmSyncResult } from "@mplus/worker";

/**
 * Map the worker's internal sync result to the public admin HTTP DTO.
 * Never pass `RealmSyncResult` directly to Fastify — field names diverge (`indexEntries` vs legacy `indexed`).
 */
export function toAdminRealmSyncResult(result: RealmSyncResult): AdminRealmSyncResult {
  return {
    region: result.region,
    indexEntries: result.indexEntries,
    rejectedAtIndex: result.rejectedAtIndex,
    detailCandidates: result.detailCandidates,
    detailsFetched: result.detailsFetched,
    eligible: result.eligible,
    rejectedTournament: result.rejectedTournament,
    rejectedInternal: result.rejectedInternal,
    detailFailures: result.detailFailures,
    retainedLastKnownGood: result.retainedLastKnownGood,
    newlyDeactivated: result.newlyDeactivated,
    activeCatalogCount: result.activeCatalogCount,
    rejectedSamples: [...result.rejectedSamples],
    upserted: result.upserted,
    minimallyUpserted: result.minimallyUpserted,
    enriched: result.enriched,
    enrichmentFailures: result.enrichmentFailures,
    skippedDetails: result.skippedDetails,
    errors: [...result.errors],
  };
}

export function toAdminRealmSyncResponse(results: RealmSyncResult[]): AdminRealmSyncResponse {
  return {
    ok: true,
    results: results.map(toAdminRealmSyncResult),
  };
}

/** TW-style log sample used in regression tests (successful sync diagnostics). */
export function twStyleRealmSyncResultFixture(): RealmSyncResult {
  return {
    region: "TW",
    indexEntries: 11,
    rejectedAtIndex: 2,
    detailCandidates: 9,
    detailsFetched: 9,
    eligible: 8,
    rejectedTournament: 1,
    rejectedInternal: 1,
    detailFailures: 1,
    retainedLastKnownGood: 1,
    newlyDeactivated: 0,
    activeCatalogCount: 8,
    upserted: 8,
    minimallyUpserted: 0,
    enriched: 8,
    enrichmentFailures: 0,
    skippedDetails: 0,
    errors: [],
    rejectedSamples: ["Arena (TOURNAMENT)", "Internal Test (INTERNAL_OTHER)"],
  };
}
