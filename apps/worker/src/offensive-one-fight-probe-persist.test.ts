import { describe, expect, it } from "vitest";
import {
  formatPersistedCandidateLoadFailures,
  fightTimesFromMasterData,
  prioritizeOffensiveProbeCandidates,
  resolvePersistedFightWindow,
} from "./offensive-one-fight-probe-persist.js";

const SPIKE = {
  reportCode: "1WKcCz2BnAQmbhfq",
  fightId: 1,
  reportRevision: 1,
} as const;

describe("offensive one-fight provider-free persist helpers", () => {
  it("uses selection fight window when capability masterData has no fights[]", () => {
    const masterData = { actors: [{ id: 30 }], abilities: [{ id: 265187 }] };
    expect(fightTimesFromMasterData(masterData, 1)).toBeNull();

    const window = resolvePersistedFightWindow(masterData, {
      fightId: 1,
      fightStartMs: 314_641,
      fightEndMs: 2_121_223,
    });
    expect(window).toEqual({ fightStartMs: 314_641, fightEndMs: 2_121_223 });
  });

  it("prefers masterData.fights[] when present", () => {
    const masterData = {
      fights: [{ id: 1, startTime: 100, endTime: 900 }],
      actors: [],
    };
    expect(
      resolvePersistedFightWindow(masterData, {
        fightId: 1,
        fightStartMs: 314_641,
        fightEndMs: 2_121_223,
      }),
    ).toEqual({ fightStartMs: 100, fightEndMs: 900 });
  });

  it("fails explicitly when neither masterData nor selection has a complete fight window", () => {
    expect(() =>
      resolvePersistedFightWindow(
        { actors: [], abilities: [] },
        { fightId: 1, fightStartMs: 314_641, fightEndMs: null },
      ),
    ).toThrow(/lacks a complete fight window/);

    expect(() =>
      resolvePersistedFightWindow(
        { actors: [], abilities: [] },
        { fightId: 1, fightStartMs: Number.NaN, fightEndMs: 2_121_223 },
      ),
    ).toThrow(/lacks a complete fight window/);
  });

  it("selects the readable pg:// spike candidate before unrelated cas-only candidates", () => {
    const casOnly = {
      reportCode: "Gq4jDxYLCcyNFBHT",
      fightId: 6,
      reportRevision: 11,
      storage: "cas://" as const,
    };
    const spikePg = {
      ...SPIKE,
      storage: "pg://" as const,
    };
    const anotherCas = {
      reportCode: "QfMvDaxTqAkXmwyR",
      fightId: 3,
      reportRevision: 4,
      storage: "cas://" as const,
    };

    const ordered = prioritizeOffensiveProbeCandidates(
      [casOnly, anotherCas, spikePg],
      SPIKE,
    );
    expect(ordered.map((c) => c.reportCode)).toEqual([
      SPIKE.reportCode,
      casOnly.reportCode,
      anotherCas.reportCode,
    ]);
    expect(ordered[0]?.storage).toBe("pg://");
  });

  it("reports the first candidate failure instead of only the last legacy-CAS error", () => {
    const message = formatPersistedCandidateLoadFailures([
      {
        candidate: SPIKE,
        error:
          "Could not resolve fight start/end for fight 1: masterData has no fights[] and selection lacks a complete fight window",
      },
      {
        candidate: {
          reportCode: "Gq4jDxYLCcyNFBHT",
          fightId: 6,
          reportRevision: 11,
        },
        error:
          "Legacy external artifact payload missing for artifactId=ecdde61d storageUri=cas://sha256/634fcf06.bin.gz",
      },
    ]);

    expect(message).toContain("[0] 1WKcCz2BnAQmbhfq:1:r1:");
    expect(message).toContain("lacks a complete fight window");
    expect(message).toContain("[1] Gq4jDxYLCcyNFBHT:6:r11:");
    expect(message.indexOf("[0]")).toBeLessThan(message.indexOf("[1]"));
  });

  it("keeps providerCalls at 0 for the provider-free persist helpers", () => {
    const providerCalls = 0;
    const track = <T>(fn: () => T): T => {
      // Pure helpers must not touch providers.
      const before = providerCalls;
      const result = fn();
      expect(providerCalls).toBe(before);
      return result;
    };

    track(() =>
      resolvePersistedFightWindow(
        { actors: [], abilities: [] },
        { fightId: 1, fightStartMs: 10, fightEndMs: 20 },
      ),
    );
    track(() =>
      prioritizeOffensiveProbeCandidates(
        [
          { reportCode: "cas", fightId: 1, reportRevision: 1 },
          SPIKE,
        ],
        SPIKE,
      ),
    );
    expect(providerCalls).toBe(0);
  });
});
