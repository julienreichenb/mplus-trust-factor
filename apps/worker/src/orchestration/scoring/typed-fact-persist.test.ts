/**
 * Typed fact persistence idempotency / fail-closed conflict tests.
 */
import { describe, expect, it } from "vitest";
import { PERFORMANCE_V2_EXTRACTOR_FAMILY, PERFORMANCE_V2_EXTRACTOR_VERSION } from "@mplus/provider-warcraftlogs";
import { persistTypedFactSet, type TypedDimensionFactPayload } from "./typed-fact-persist.js";

function payload(facts: unknown): TypedDimensionFactPayload {
  return {
    dimension: "PERFORMANCE",
    status: "WRITTEN",
    extractorFamily: PERFORMANCE_V2_EXTRACTOR_FAMILY,
    extractorVersion: PERFORMANCE_V2_EXTRACTOR_VERSION,
    schemaVersion: "performance-facts-v2.0.0",
    facts,
    limitations: [],
    category: null,
    reason: null,
    artifactIds: ["a1"],
    coverage: {},
  };
}

describe("persistTypedFactSet", () => {
  it("is idempotent for identical content", async () => {
    const store: Array<Record<string, unknown>> = [];
    const evidence = {
      findFactSetByLogicalIdentity: async () => store[0] ?? null,
      createFactSet: async (input: Record<string, unknown>) => {
        store.push(input);
        return input;
      },
    };
    const facts = {
      kind: "performance_run_parse_fact_v2",
      slotId: "a:0",
      parsePercentile: 70,
    };
    const first = await persistTypedFactSet({
      evidence: evidence as never,
      logger: { info: () => undefined },
      characterId: "c1",
      manifestSlotId: "ms1",
      reportCode: "R1",
      fightId: 1,
      reportRevision: 1,
      payload: payload(facts),
    });
    expect(first.outcome).toBe("written");
    expect(first.outcome === "written" && first.created).toBe(true);

    const second = await persistTypedFactSet({
      evidence: evidence as never,
      logger: { info: () => undefined },
      characterId: "c1",
      manifestSlotId: "ms1",
      reportCode: "R1",
      fightId: 1,
      reportRevision: 1,
      payload: payload(facts),
    });
    expect(second.outcome).toBe("written");
    expect(second.outcome === "written" && second.created).toBe(false);
    expect(store).toHaveLength(1);
  });

  it("fails closed on conflicting content for the same logical identity", async () => {
    const existing = {
      facts: { kind: "performance_run_parse_fact_v2", parsePercentile: 10 },
      inputFingerprint: "fp-old",
    };
    const evidence = {
      findFactSetByLogicalIdentity: async () => existing,
      createFactSet: async () => {
        throw new Error("should_not_create");
      },
    };
    const result = await persistTypedFactSet({
      evidence: evidence as never,
      logger: { info: () => undefined },
      characterId: "c1",
      manifestSlotId: "ms1",
      reportCode: "R1",
      fightId: 1,
      reportRevision: 1,
      payload: payload({ kind: "performance_run_parse_fact_v2", parsePercentile: 99 }),
    });
    expect(result.outcome).toBe("conflict");
  });

  it("skips UNAVAILABLE without writing placeholder facts", async () => {
    let created = false;
    const evidence = {
      findFactSetByLogicalIdentity: async () => null,
      createFactSet: async () => {
        created = true;
      },
    };
    const result = await persistTypedFactSet({
      evidence: evidence as never,
      logger: { info: () => undefined },
      characterId: "c1",
      manifestSlotId: "ms1",
      reportCode: "R1",
      fightId: 1,
      reportRevision: 1,
      payload: {
        ...payload(null),
        status: "UNAVAILABLE",
        facts: null,
        reason: "missing",
      },
    });
    expect(result.outcome).toBe("skipped_unavailable");
    expect(created).toBe(false);
  });
});
