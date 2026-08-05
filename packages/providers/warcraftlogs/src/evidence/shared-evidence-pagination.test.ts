/**
 * Shared ReportEvents pagination coverage and stop-reason tests.
 */
import { describe, expect, it, vi } from "vitest";
import {
  decideSharedEvidencePageContinuation,
  computePaginationCoverageRatio,
} from "./shared-evidence-pagination.js";
import {
  fetchSharedEventDataset,
  SharedEvidencePaginationError,
} from "./wcl-run-evidence.js";
import { InMemorySharedEvidenceStore } from "./shared-evidence-ingest.js";

function castEvent(timestamp: number, id: number): Record<string, unknown> {
  return {
    timestamp,
    type: "cast",
    source: { id: 10 },
    ability: { guid: 1000 + id },
  };
}

function pageResponse(
  events: Array<Record<string, unknown>>,
  nextPageTimestamp: number | null,
) {
  return {
    response: {
      data: {
        reportData: {
          report: {
            events: { data: events, nextPageTimestamp },
          },
        },
      },
    },
    costUnits: 1,
    durationMs: 1,
    fingerprint: "fp",
  };
}

describe("decideSharedEvidencePageContinuation", () => {
  it("continues across more than two pages when nextPageTimestamp advances", () => {
    const seen = new Set<number>();
    const first = decideSharedEvidencePageContinuation({
      pageEventsRawCount: 1000,
      pageLimit: 1000,
      nextPageTimestamp: 500_000,
      pageLastTimestampMs: 499_000,
      fightEndMs: 2_000_000,
      seenPageCursors: seen,
      highWaterTimestamp: null,
      datasetLabel: "Casts",
    });
    expect(first.continue).toBe(true);
    expect(first.nextStartTime).toBe(500_000);
    seen.add(500_000);

    const second = decideSharedEvidencePageContinuation({
      pageEventsRawCount: 1000,
      pageLimit: 1000,
      nextPageTimestamp: 900_000,
      pageLastTimestampMs: 899_000,
      fightEndMs: 2_000_000,
      seenPageCursors: seen,
      highWaterTimestamp: 499_000,
      datasetLabel: "Casts",
    });
    expect(second.continue).toBe(true);
    expect(second.nextStartTime).toBe(900_000);
  });

  it("continues when a full 1000-event page omits nextPageTimestamp before fight end", () => {
    const decision = decideSharedEvidencePageContinuation({
      pageEventsRawCount: 1000,
      pageLimit: 1000,
      nextPageTimestamp: null,
      pageLastTimestampMs: 502_838,
      fightEndMs: 2_121_223,
      seenPageCursors: new Set(),
      highWaterTimestamp: null,
      datasetLabel: "Casts",
    });
    expect(decision.continue).toBe(true);
    expect(decision.nextStartTime).toBe(502_838);
  });

  it("fails closed on a non-progressing cursor", () => {
    const decision = decideSharedEvidencePageContinuation({
      pageEventsRawCount: 10,
      pageLimit: 1000,
      nextPageTimestamp: 400_000,
      pageLastTimestampMs: 399_000,
      fightEndMs: 2_000_000,
      seenPageCursors: new Set([400_000]),
      highWaterTimestamp: 350_000,
      datasetLabel: "Casts",
    });
    expect(decision.fail).toBe(true);
    expect(decision.stopReason).toBe("NON_PROGRESSING_CURSOR");
  });

  it("marks fight complete when nextPageTimestamp reaches fight end", () => {
    const decision = decideSharedEvidencePageContinuation({
      pageEventsRawCount: 12,
      pageLimit: 1000,
      nextPageTimestamp: 2_121_223,
      pageLastTimestampMs: 2_120_000,
      fightEndMs: 2_121_223,
      seenPageCursors: new Set(),
      highWaterTimestamp: 1_000_000,
      datasetLabel: "Casts",
    });
    expect(decision.continue).toBe(false);
    expect(decision.complete).toBe(true);
    expect(decision.stopReason).toBe("CURSOR_REACHED_FIGHT_END");
  });

  it("marks incomplete when next is null far before fight end on a short page", () => {
    const decision = decideSharedEvidencePageContinuation({
      pageEventsRawCount: 10,
      pageLimit: 1000,
      nextPageTimestamp: null,
      pageLastTimestampMs: 502_838,
      fightEndMs: 2_121_223,
      seenPageCursors: new Set(),
      highWaterTimestamp: 400_000,
      datasetLabel: "Casts",
    });
    expect(decision.continue).toBe(false);
    expect(decision.complete).toBe(true);
    expect(decision.stopReason).toBe("NEXT_PAGE_NULL");
  });
});

describe("computePaginationCoverageRatio", () => {
  it("reports ~0.104 for the observed Wallidrixe early stop", () => {
    const ratio = computePaginationCoverageRatio({
      requestedFightStartMs: 314_641,
      requestedFightEndMs: 2_121_223,
      lastEventTimestampMs: 502_838,
    });
    expect(ratio).toBe(0.104);
  });
});

describe("fetchSharedEventDataset pagination", () => {
  it("fetches more than two pages and forwards fight start/end bounds", async () => {
    const requestPermissive = vi.fn(async (options: { variables?: Record<string, unknown> }) => {
      const start = (options.variables?.startTime as number | undefined) ?? 0;
      if (start === 0 || start === 100) {
        return pageResponse(
          Array.from({ length: 3 }, (_, i) => castEvent(start + i + 1, start + i)),
          start === 0 ? 100 : 200,
        );
      }
      if (start === 200) {
        return pageResponse([castEvent(250, 250)], null);
      }
      throw new Error(`unexpected startTime ${start}`);
    });

    const fetched = await fetchSharedEventDataset({
      client: { requestPermissive, request: requestPermissive } as never,
      reportCode: "abc123",
      fightId: 1,
      dataset: "Casts",
      startTime: 0,
      endTime: 1000,
      maxPages: 6,
      pageLimit: 1000,
    });

    expect(fetched.dataset.pageCount).toBe(3);
    expect(fetched.dataset.eventCount).toBe(7);
    expect(fetched.dataset.pagination?.complete).toBe(true);
    expect(fetched.dataset.pagination?.stopReason).toBe("NEXT_PAGE_NULL");
    expect(requestPermissive.mock.calls[0]?.[0].variables).toMatchObject({
      startTime: 0,
      endTime: 1000,
    });
  });

  it("continues after exactly 1000 events with a continuation cursor", async () => {
    const requestPermissive = vi.fn(async (options: { variables?: Record<string, unknown> }) => {
      const start = options.variables?.startTime as number | undefined;
      if (start === 0) {
        return pageResponse(
          Array.from({ length: 1000 }, (_, i) => castEvent(i + 1, i)),
          1000,
        );
      }
      if (start === 1000) {
        return pageResponse(
          Array.from({ length: 5 }, (_, i) => castEvent(1001 + i, 1000 + i)),
          null,
        );
      }
      throw new Error(`unexpected start ${start}`);
    });

    const fetched = await fetchSharedEventDataset({
      client: { requestPermissive, request: requestPermissive } as never,
      reportCode: "abc123",
      fightId: 1,
      dataset: "Casts",
      startTime: 0,
      endTime: 5000,
      maxPages: 6,
      pageLimit: 1000,
    });

    expect(fetched.wclRequests).toBe(2);
    expect(fetched.dataset.eventCount).toBe(1005);
    expect(fetched.dataset.pagination?.complete).toBe(true);
  });

  it("throws on a non-progressing cursor", async () => {
    const requestPermissive = vi.fn(async () => pageResponse([castEvent(10, 1)], 10));
    // Second call repeats the same next cursor via seen set — first page next=10,
    // second page also returns next=10.
    requestPermissive
      .mockResolvedValueOnce(pageResponse([castEvent(10, 1)], 10))
      .mockResolvedValueOnce(pageResponse([castEvent(11, 2)], 10));

    await expect(
      fetchSharedEventDataset({
        client: { requestPermissive, request: requestPermissive } as never,
        reportCode: "abc123",
        fightId: 1,
        dataset: "Casts",
        startTime: 0,
        endTime: 1000,
        maxPages: 6,
      }),
    ).rejects.toBeInstanceOf(SharedEvidencePaginationError);
  });

  it("reports MAX_PAGES exhaustion as incomplete", async () => {
    const requestPermissive = vi.fn(async (options: { variables?: Record<string, unknown> }) => {
      const start = (options.variables?.startTime as number | undefined) ?? 0;
      return pageResponse([castEvent(start + 1, start + 1)], start + 10);
    });

    const fetched = await fetchSharedEventDataset({
      client: { requestPermissive, request: requestPermissive } as never,
      reportCode: "abc123",
      fightId: 1,
      dataset: "Casts",
      startTime: 0,
      endTime: 100_000,
      maxPages: 3,
      pageLimit: 1000,
    });

    expect(fetched.dataset.pageCount).toBe(3);
    expect(fetched.dataset.truncated).toBe(true);
    expect(fetched.dataset.pagination?.complete).toBe(false);
    expect(fetched.dataset.pagination?.stopReason).toBe("MAX_PAGES");
  });

  it("reports full fight completion when the final page has no continuation", async () => {
    const requestPermissive = vi.fn(async () =>
      pageResponse([castEvent(900, 1), castEvent(950, 2)], null),
    );

    const fetched = await fetchSharedEventDataset({
      client: { requestPermissive, request: requestPermissive } as never,
      reportCode: "abc123",
      fightId: 1,
      dataset: "Buffs",
      sourceId: 10,
      startTime: 0,
      endTime: 1000,
      maxPages: 6,
    });

    expect(fetched.dataset.pagination?.complete).toBe(true);
    expect(fetched.dataset.pagination?.stopReason).toBe("NEXT_PAGE_NULL");
    expect(fetched.dataset.pagination?.coverageRatio).toBe(0.95);
  });

  it("preserves all pages in order through an in-memory store round-trip", async () => {
    const store = new InMemorySharedEvidenceStore();
    const requestPermissive = vi.fn(async (options: { variables?: Record<string, unknown> }) => {
      const start = (options.variables?.startTime as number | undefined) ?? 0;
      if (start === 0) {
        return pageResponse(
          [castEvent(1, 1), castEvent(2, 2)],
          3,
        );
      }
      return pageResponse([castEvent(4, 4), castEvent(5, 5)], null);
    });

    const fetched = await fetchSharedEventDataset({
      client: { requestPermissive, request: requestPermissive } as never,
      reportCode: "abc123",
      fightId: 1,
      dataset: "Casts",
      startTime: 0,
      endTime: 100,
      maxPages: 6,
    });

    const key = "wcl-evidence|abc123|r1|f1|a10|Casts|t0-100|fe:none|contract|nopayload";
    await store.saveDataset(key, fetched.dataset, {
      reportCode: "abc123",
      reportRevision: 1,
      fightId: 1,
      dataset: "Casts",
    });
    const reloaded = await store.loadDataset(key);
    expect(reloaded?.pageCount).toBe(2);
    expect(reloaded?.pages.map((p) => p.pageIndex)).toEqual([0, 1]);
    expect(reloaded?.events.map((e) => e.timestamp)).toEqual([1, 2, 4, 5]);
  });
});
