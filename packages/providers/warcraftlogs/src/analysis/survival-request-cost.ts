export interface SurvivalRequestCostBreakdown {
  wclHttpRequestCount: number;
  graphqlOperationCount: number;
  reportMasterDataCacheHits: number;
  eventPayloadCacheHits: number;
  reusedRunAnalyses: number;
  newRunAnalyses: number;
  rejectedCandidates: Array<{ reason: string; runId?: string; dungeonSlug?: string }>;
}

export function createSurvivalRequestCost(): SurvivalRequestCostBreakdown {
  return {
    wclHttpRequestCount: 0,
    graphqlOperationCount: 0,
    reportMasterDataCacheHits: 0,
    eventPayloadCacheHits: 0,
    reusedRunAnalyses: 0,
    newRunAnalyses: 0,
    rejectedCandidates: [],
  };
}
