import { describe, expect, it } from "vitest";
import { validateConcurrencyValue } from "./scoring-v2-runtime-settings.js";
import {
  deriveConcurrencySyncState,
  type ConcurrencyObservation,
} from "@mplus/worker";

describe("concurrency validation", () => {
  it("accepts values in 1..8", () => {
    expect(validateConcurrencyValue(1)).toBe(1);
    expect(validateConcurrencyValue(8)).toBe(8);
    expect(validateConcurrencyValue(4)).toBe(4);
  });

  it("rejects out of range", () => {
    expect(() => validateConcurrencyValue(0)).toThrow();
    expect(() => validateConcurrencyValue(9)).toThrow();
    expect(() => validateConcurrencyValue(3.5)).toThrow();
  });
});

describe("concurrency syncState derivation (API surface)", () => {
  const nowMs = Date.parse("2026-08-03T15:00:00.000Z");

  function observation(
    workerId: string,
    overrides: Partial<ConcurrencyObservation> = {},
  ): ConcurrencyObservation {
    const observedAtMs = overrides.observedAtMs ?? nowMs;
    return {
      workerId,
      settingsVersion: overrides.settingsVersion ?? 1,
      concurrencyCalibration: overrides.concurrencyCalibration ?? 4,
      concurrencyOperation: overrides.concurrencyOperation ?? 2,
      observedAtMs,
      observedAt: overrides.observedAt ?? new Date(observedAtMs).toISOString(),
    };
  }

  it("never claims synchronized without Redis evidence", () => {
    expect(
      deriveConcurrencySyncState({
        redisAvailable: false,
        observations: [],
        settingsVersion: 1,
        configuredCalibration: 4,
        configuredOperation: 2,
        nowMs,
      }).synchronized,
    ).toBe(false);

    expect(
      deriveConcurrencySyncState({
        redisAvailable: true,
        observations: [],
        settingsVersion: 1,
        configuredCalibration: 4,
        configuredOperation: 2,
        nowMs,
      }).syncState,
    ).toBe("UNKNOWN");
  });

  it("derives SYNCHRONIZED only when fresh observations match", () => {
    const result = deriveConcurrencySyncState({
      redisAvailable: true,
      observations: [observation("w1"), observation("w2")],
      settingsVersion: 1,
      configuredCalibration: 4,
      configuredOperation: 2,
      nowMs,
    });
    expect(result.syncState).toBe("SYNCHRONIZED");
    expect(result.synchronized).toBe(true);
  });
});
