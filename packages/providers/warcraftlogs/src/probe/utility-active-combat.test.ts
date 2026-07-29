/**
 * Active-combat duration estimate unit tests.
 */
import { describe, expect, it } from "vitest";
import { estimateActiveCombatMs, ACTIVE_COMBAT_GAP_MS } from "./utility-active-combat.js";

describe("estimateActiveCombatMs", () => {
  it("falls back when fewer than 3 hostile events", () => {
    const r = estimateActiveCombatMs({
      fightDurationMs: 600_000,
      hostileEventTimestampsMs: [0, 1000],
    });
    expect(r.method).toBe("fight_duration_fallback");
    expect(r.activeCombatMs).toBe(600_000);
  });

  it("splits travel gaps and returns smaller active combat time", () => {
    // Two packs: 0-20s and 80-100s with 60s travel (gap > 15s)
    const ts = [0, 5_000, 10_000, 20_000, 80_000, 90_000, 100_000];
    const r = estimateActiveCombatMs({
      fightDurationMs: 120_000,
      hostileEventTimestampsMs: ts,
      gapThresholdMs: ACTIVE_COMBAT_GAP_MS,
    });
    expect(r.method).toBe("hostile_activity_windows");
    expect(r.windowCount).toBe(2);
    expect(r.activeCombatMs).toBeLessThan(120_000);
    expect(r.activeCombatMs).toBeGreaterThan(30_000);
  });

  it("falls back when activity coverage is below 20%", () => {
    const r = estimateActiveCombatMs({
      fightDurationMs: 1_000_000,
      hostileEventTimestampsMs: [0, 1000, 2000],
    });
    expect(r.method).toBe("fight_duration_fallback");
  });
});
