import { describe, expect, it } from "vitest";
import {
  addProviderAccounting,
  aggregateProviderAccounting,
  emptyProviderAccounting,
  parseProviderAccounting,
} from "./provider-accounting.js";

describe("provider-accounting", () => {
  it("aggregates slot counters and preserves null points until known", () => {
    const empty = emptyProviderAccounting();
    expect(empty.pointsConsumed).toBeNull();

    const withCalls = addProviderAccounting(empty, {
      providerCalls: 2,
      cacheHits: 1,
      avoidedRequests: 1,
      pages: 3,
      bytes: 100,
    });
    expect(withCalls.pointsConsumed).toBeNull();
    expect(withCalls.providerCalls).toBe(2);
    expect(withCalls.pages).toBe(3);

    const withPoints = addProviderAccounting(withCalls, { pointsConsumed: 4.5, providerCalls: 1 });
    expect(withPoints.pointsConsumed).toBe(4.5);
    expect(withPoints.providerCalls).toBe(3);

    const summed = aggregateProviderAccounting([
      { providerCalls: 1, pointsConsumed: 2, singleflightReuse: 1 },
      { providerCalls: 0, cacheHits: 2, avoidedRequests: 2, pointsConsumed: 0 },
      null,
    ]);
    expect(summed).toEqual({
      providerCalls: 1,
      cacheHits: 2,
      avoidedRequests: 2,
      singleflightReuse: 1,
      pointsConsumed: 2,
      pages: 0,
      bytes: 0,
    });
  });

  it("parses persisted JSON safely", () => {
    expect(parseProviderAccounting(null)).toBeNull();
    expect(parseProviderAccounting({ providerCalls: 5, pointsConsumed: 1.2 })?.providerCalls).toBe(
      5,
    );
    expect(parseProviderAccounting({ providerCalls: 5, pointsConsumed: 1.2 })?.pointsConsumed).toBe(
      1.2,
    );
  });
});
