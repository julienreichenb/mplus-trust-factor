export interface BulkOrchestratorCheckpoint {
  cursor: number;
  processedCount: number;
  enqueuedCount: number;
  dispatchedCount: number;
  dispatchFailedCount: number;
  skippedCount: number;
  consumedWclCalls: number;
  lastCharacterId: string | null;
  selectionComplete: boolean;
}

export function emptyBulkCheckpoint(): BulkOrchestratorCheckpoint {
  return {
    cursor: 0,
    processedCount: 0,
    enqueuedCount: 0,
    dispatchedCount: 0,
    dispatchFailedCount: 0,
    skippedCount: 0,
    consumedWclCalls: 0,
    lastCharacterId: null,
    selectionComplete: false,
  };
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Reconstruct checkpoint JSON; returns empty checkpoint when shape is invalid. */
export function parseBulkCheckpoint(value: unknown): BulkOrchestratorCheckpoint {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    return emptyBulkCheckpoint();
  }
  const row = value as Record<string, unknown>;
  const cursor = readFiniteNumber(row.cursor);
  const processedCount = readFiniteNumber(row.processedCount);
  const enqueuedCount = readFiniteNumber(row.enqueuedCount);
  const dispatchedCount = readFiniteNumber(row.dispatchedCount);
  const dispatchFailedCount = readFiniteNumber(row.dispatchFailedCount);
  const skippedCount = readFiniteNumber(row.skippedCount);
  const consumedWclCalls = readFiniteNumber(row.consumedWclCalls);
  if (
    cursor === null ||
    processedCount === null ||
    enqueuedCount === null ||
    dispatchedCount === null ||
    dispatchFailedCount === null ||
    skippedCount === null ||
    consumedWclCalls === null
  ) {
    return emptyBulkCheckpoint();
  }
  const lastCharacterId = row.lastCharacterId;
  if (lastCharacterId !== null && typeof lastCharacterId !== "string") {
    return emptyBulkCheckpoint();
  }
  return {
    cursor,
    processedCount,
    enqueuedCount,
    dispatchedCount,
    dispatchFailedCount,
    skippedCount,
    consumedWclCalls,
    lastCharacterId,
    selectionComplete: row.selectionComplete === true,
  };
}

export function bulkCheckpointToJson(checkpoint: BulkOrchestratorCheckpoint): Record<string, unknown> {
  return {
    cursor: checkpoint.cursor,
    processedCount: checkpoint.processedCount,
    enqueuedCount: checkpoint.enqueuedCount,
    dispatchedCount: checkpoint.dispatchedCount,
    dispatchFailedCount: checkpoint.dispatchFailedCount,
    skippedCount: checkpoint.skippedCount,
    consumedWclCalls: checkpoint.consumedWclCalls,
    lastCharacterId: checkpoint.lastCharacterId,
    selectionComplete: checkpoint.selectionComplete,
  };
}

export function shouldStopForWclBudget(input: {
  mode: "FULL_REFRESH" | "RECALCULATE_ONLY";
  maxWclCalls: number | null | undefined;
  consumedWclCalls: number;
  nextBatchEstimatedCalls: number;
}): boolean {
  if (input.mode !== "FULL_REFRESH") {
    return false;
  }
  if (input.maxWclCalls == null) {
    return false;
  }
  return input.consumedWclCalls + input.nextBatchEstimatedCalls > input.maxWclCalls;
}
