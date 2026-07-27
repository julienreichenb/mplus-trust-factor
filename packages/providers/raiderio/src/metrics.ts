export interface RaiderIoMetrics {
  requestsTotal: number;
  cacheHits: number;
  cacheMisses: number;
  rateLimited: number;
  negativeCacheHits: number;
}

export function createMetrics(): RaiderIoMetrics {
  return {
    requestsTotal: 0,
    cacheHits: 0,
    cacheMisses: 0,
    rateLimited: 0,
    negativeCacheHits: 0,
  };
}
