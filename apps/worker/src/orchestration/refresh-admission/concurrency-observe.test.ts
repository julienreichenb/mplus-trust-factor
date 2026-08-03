import { describe, expect, it } from "vitest";
import {
  CONCURRENCY_OBSERVATION_FRESHNESS_MS,
  deriveConcurrencySyncState,
  parseConcurrencyObservation,
  serializeConcurrencyObservation,
  type ConcurrencyObservation,
} from "./concurrency-observe.js";

function obs(
  partial: Partial<ConcurrencyObservation> & Pick<ConcurrencyObservation, "workerId">,
  nowMs: number,
): ConcurrencyObservation {
  const observedAtMs = partial.observedAtMs ?? nowMs;
  return {
    workerId: partial.workerId,
    settingsVersion: partial.settingsVersion ?? 3,
    concurrencyCalibration: partial.concurrencyCalibration ?? 4,
    concurrencyOperation: partial.concurrencyOperation ?? 2,
    observedAtMs,
    observedAt: partial.observedAt ?? new Date(observedAtMs).toISOString(),
  };
}

describe("serialize/parse concurrency observation", () => {
  it("round-trips payload JSON", () => {
    const raw = serializeConcurrencyObservation({
      settingsVersion: 5,
      concurrencyCalibration: 4,
      concurrencyOperation: 2,
      nowMs: Date.parse("2026-08-03T12:00:00.000Z"),
    });
    const parsed = parseConcurrencyObservation("worker-a", raw);
    expect(parsed).toMatchObject({
      workerId: "worker-a",
      settingsVersion: 5,
      concurrencyCalibration: 4,
      concurrencyOperation: 2,
      observedAt: "2026-08-03T12:00:00.000Z",
    });
  });

  it("rejects corrupt payloads", () => {
    expect(parseConcurrencyObservation("w", "{")).toBeNull();
    expect(parseConcurrencyObservation("w", JSON.stringify({ settingsVersion: 1 }))).toBeNull();
  });
});

describe("deriveConcurrencySyncState", () => {
  const nowMs = Date.parse("2026-08-03T12:00:00.000Z");
  const base = {
    settingsVersion: 3,
    configuredCalibration: 4,
    configuredOperation: 2,
    nowMs,
  };

  it("returns UNKNOWN when Redis unavailable", () => {
    const result = deriveConcurrencySyncState({
      ...base,
      redisAvailable: false,
      observations: [obs({ workerId: "a" }, nowMs)],
    });
    expect(result.syncState).toBe("UNKNOWN");
    expect(result.synchronized).toBe(false);
    expect(result.observedReplicaCount).toBe(0);
    expect(result.effectiveCalibration).toBe(4);
  });

  it("returns UNKNOWN when no observations", () => {
    const result = deriveConcurrencySyncState({
      ...base,
      redisAvailable: true,
      observations: [],
    });
    expect(result.syncState).toBe("UNKNOWN");
    expect(result.synchronized).toBe(false);
    expect(result.observedReplicaCount).toBe(0);
  });

  it("returns STALE when all observations are outside freshness window", () => {
    const staleAt = nowMs - CONCURRENCY_OBSERVATION_FRESHNESS_MS - 1;
    const result = deriveConcurrencySyncState({
      ...base,
      redisAvailable: true,
      observations: [obs({ workerId: "a", observedAtMs: staleAt }, nowMs)],
    });
    expect(result.syncState).toBe("STALE");
    expect(result.synchronized).toBe(false);
    expect(result.observedReplicaCount).toBe(1);
    expect(result.effectiveCalibration).toBe(4);
  });

  it("returns PARTIALLY_OBSERVED when mix of fresh and stale", () => {
    const staleAt = nowMs - CONCURRENCY_OBSERVATION_FRESHNESS_MS - 5_000;
    const result = deriveConcurrencySyncState({
      ...base,
      redisAvailable: true,
      observations: [
        obs({ workerId: "stale", observedAtMs: staleAt }, nowMs),
        obs({ workerId: "fresh", observedAtMs: nowMs }, nowMs),
      ],
    });
    expect(result.syncState).toBe("PARTIALLY_OBSERVED");
    expect(result.synchronized).toBe(false);
    expect(result.observedReplicaCount).toBe(2);
  });

  it("returns UNSYNCHRONIZED when fresh observation version disagrees", () => {
    const result = deriveConcurrencySyncState({
      ...base,
      redisAvailable: true,
      observations: [obs({ workerId: "a", settingsVersion: 2 }, nowMs)],
    });
    expect(result.syncState).toBe("UNSYNCHRONIZED");
    expect(result.synchronized).toBe(false);
  });

  it("returns UNSYNCHRONIZED when fresh observation limits disagree", () => {
    const result = deriveConcurrencySyncState({
      ...base,
      redisAvailable: true,
      observations: [
        obs({ workerId: "a", concurrencyCalibration: 8, concurrencyOperation: 1 }, nowMs),
      ],
    });
    expect(result.syncState).toBe("UNSYNCHRONIZED");
    expect(result.effectiveCalibration).toBe(8);
    expect(result.effectiveOperation).toBe(1);
  });

  it("returns SYNCHRONIZED when all fresh observations match settings", () => {
    const result = deriveConcurrencySyncState({
      ...base,
      redisAvailable: true,
      observations: [
        obs({ workerId: "a", observedAtMs: nowMs - 10_000 }, nowMs),
        obs({ workerId: "b", observedAtMs: nowMs - 1_000 }, nowMs),
      ],
    });
    expect(result.syncState).toBe("SYNCHRONIZED");
    expect(result.synchronized).toBe(true);
    expect(result.observedReplicaCount).toBe(2);
    expect(result.oldestObservationAt).toBe(new Date(nowMs - 10_000).toISOString());
    expect(result.newestObservationAt).toBe(new Date(nowMs - 1_000).toISOString());
    expect(result.effectiveCalibration).toBe(4);
    expect(result.effectiveOperation).toBe(2);
  });

  it("uses newest observation for effective limits when present", () => {
    const result = deriveConcurrencySyncState({
      ...base,
      redisAvailable: true,
      observations: [
        obs(
          {
            workerId: "old",
            observedAtMs: nowMs - 20_000,
            concurrencyCalibration: 3,
            concurrencyOperation: 1,
            settingsVersion: 2,
          },
          nowMs,
        ),
        obs(
          {
            workerId: "new",
            observedAtMs: nowMs - 1_000,
            concurrencyCalibration: 6,
            concurrencyOperation: 3,
            settingsVersion: 2,
          },
          nowMs,
        ),
      ],
    });
    expect(result.syncState).toBe("UNSYNCHRONIZED");
    expect(result.effectiveCalibration).toBe(6);
    expect(result.effectiveOperation).toBe(3);
  });
});
