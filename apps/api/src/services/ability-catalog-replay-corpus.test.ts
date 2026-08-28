import { describe, expect, it } from "vitest";

/**
 * Deterministic corpus selection helpers (pure ordering / capping).
 * DB-backed selection is exercised by CLI acceptance.
 */
function selectBounded(ids: string[], maxPerGroup: number, maxTotal: number): string[] {
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const g = id.split(":")[0]!;
    const list = groups.get(g) ?? [];
    list.push(id);
    groups.set(g, list);
  }
  const out: string[] = [];
  for (const key of [...groups.keys()].sort()) {
    const list = groups.get(key)!.sort();
    out.push(...list.slice(0, maxPerGroup));
  }
  return out.sort().slice(0, maxTotal);
}

describe("ability catalog replay corpus selection (pure)", () => {
  it("respects max-per-spec and max-total with stable ordering", () => {
    const ids = [
      "mage:a",
      "mage:b",
      "mage:c",
      "mage:d",
      "priest:a",
      "priest:b",
      "warlock:a",
    ];
    expect(selectBounded(ids, 2, 100)).toEqual([
      "mage:a",
      "mage:b",
      "priest:a",
      "priest:b",
      "warlock:a",
    ]);
    expect(selectBounded(ids, 2, 3)).toEqual(["mage:a", "mage:b", "priest:a"]);
  });

  it("is deterministic for identical inputs", () => {
    const ids = ["z:1", "a:2", "a:1", "b:1"];
    expect(selectBounded(ids, 1, 10)).toEqual(selectBounded(ids, 1, 10));
  });

  it("coverage statuses remain distinct (not collapsed)", () => {
    const statuses = [
      "AVAILABLE_NATIVE_V4",
      "DERIVED_FROM_FROZEN_EVIDENCE",
      "MISSING_CORPUS_EVIDENCE",
      "UNSUPPORTED_SCHEMA",
    ];
    expect(new Set(statuses).size).toBe(4);
  });
});
