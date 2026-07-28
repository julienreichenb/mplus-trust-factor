import { describe, expect, it } from "vitest";
import {
  buildHealthTimeline,
  collectExplicitHealthSnapshots,
  extractResourcePairsFromEvent,
  resolveMaxHpFromSnapshots,
} from "./survival-v1_1-health.js";
import { determineScoreMode } from "./survival-v1_1-logic.js";
import { SURVIVAL_STANDALONE_V1_1_CONFIG } from "./survival-v1_1-config.js";

describe("survival-v1.1 health extraction", () => {
  it("extracts hitPoints/maxHitPoints from targetResources", () => {
    const pairs = extractResourcePairsFromEvent({
      timestamp: 1000,
      targetID: 7,
      targetResources: { hitPoints: 400_000, maxHitPoints: 1_000_000, absorb: 0 },
    });
    expect(pairs.some((p) => p.maxHp === 1_000_000 && p.currentHp === 400_000)).toBe(true);
  });

  it("extracts root hitPoints/maxHitPoints from includeResources damage events", () => {
    const pairs = extractResourcePairsFromEvent({
      timestamp: 1000,
      hitPoints: 411_147,
      maxHitPoints: 531_300,
      absorb: 0,
      classResources: [{ amount: 248_798, max: 250_000, type: 0 }],
      target: { id: 30, name: "Wallidrixe" },
    });
    expect(pairs.some((p) => p.maxHp === 531_300 && p.currentHp === 411_147)).toBe(true);
    // Mana classResources type=0 must not be treated as HP
    expect(pairs.some((p) => p.maxHp === 250_000)).toBe(false);
  });

  it("resolves nested target.id for player filtering", () => {
    const snaps = collectExplicitHealthSnapshots(
      [
        {
          timestamp: 1000,
          hitPoints: 411_147,
          maxHitPoints: 531_300,
          target: { id: 30, name: "Wallidrixe" },
          source: { id: 47, name: "Mob" },
        },
      ],
      "DamageTaken",
      30,
    );
    expect(snaps.length).toBeGreaterThan(0);
    expect(snaps[0]?.maxHp).toBe(531_300);
  });

  it("does not invent max HP from empty events", () => {
    const resolution = resolveMaxHpFromSnapshots({
      runId: "r:1",
      reportCode: "r",
      fightId: 1,
      dungeonSlug: "skyreach",
      snapshots: [],
    });
    expect(resolution.maxHp).toBeNull();
    expect(resolution.maxHpConfidence).toBe("NONE");
    expect(resolution.resolutionFailureReason).toContain("no_explicit_max_hp");
  });

  it("uses modal stable max HP and flags temporary outliers", () => {
    const snapshots = [
      ...Array.from({ length: 10 }, (_, i) => ({
        timestamp: i * 1000,
        currentHp: 900_000,
        maxHp: 1_000_000,
        absorb: null,
        path: "DamageTaken.event.targetResources",
        dataType: "DamageTaken",
        abilityGameID: 1,
        sourceID: 2,
        targetID: 7,
        eventType: "damage",
        rawFragment: {},
      })),
      {
        timestamp: 50_000,
        currentHp: 1_200_000,
        maxHp: 1_200_000,
        absorb: null,
        path: "DamageTaken.event.targetResources",
        dataType: "DamageTaken",
        abilityGameID: 1,
        sourceID: 2,
        targetID: 7,
        eventType: "damage",
        rawFragment: {},
      },
    ];
    const resolution = resolveMaxHpFromSnapshots({
      runId: "r:1",
      reportCode: "r",
      fightId: 1,
      dungeonSlug: "skyreach",
      snapshots,
    });
    expect(resolution.maxHp).toBe(1_000_000);
    expect(resolution.temporaryMaxHpValues).toContain(1_200_000);
    expect(resolution.corroboratingEventCount).toBe(10);
  });
});

describe("survival-v1.1 health timeline", () => {
  it("prefers observed snapshots and reconstructs between anchors when complete", () => {
    const timeline = buildHealthTimeline({
      runId: "r:1",
      reportCode: "r",
      fightId: 1,
      maxHp: 1_000_000,
      snapshots: [
        {
          timestamp: 0,
          currentHp: 1_000_000,
          maxHp: 1_000_000,
          absorb: 0,
          path: "x",
          dataType: "DamageTaken",
          abilityGameID: null,
          sourceID: 1,
          targetID: 7,
          eventType: "damage",
          rawFragment: {},
        },
        {
          timestamp: 10_000,
          currentHp: 500_000,
          maxHp: 1_000_000,
          absorb: 0,
          path: "x",
          dataType: "DamageTaken",
          abilityGameID: null,
          sourceID: 1,
          targetID: 7,
          eventType: "damage",
          rawFragment: {},
        },
      ],
      damageEvents: [{ timestamp: 5_000, amount: 200_000, abilityGameID: 9 }],
      healEvents: [],
      deathTimestamps: [],
      fightStart: 0,
      fightEnd: 20_000,
      eventPagesComplete: true,
    });
    expect(timeline.observedSnapshotCount).toBe(2);
    expect(timeline.points.some((p) => !p.directlyObserved && p.timestamp === 5_000)).toBe(true);
    expect(timeline.complete).toBe(true);
  });

  it("does not reconstruct across incomplete pagination", () => {
    const timeline = buildHealthTimeline({
      runId: "r:1",
      reportCode: "r",
      fightId: 1,
      maxHp: 1_000_000,
      snapshots: [
        {
          timestamp: 0,
          currentHp: 1_000_000,
          maxHp: 1_000_000,
          absorb: 0,
          path: "x",
          dataType: "DamageTaken",
          abilityGameID: null,
          sourceID: 1,
          targetID: 7,
          eventType: "damage",
          rawFragment: {},
        },
      ],
      damageEvents: [{ timestamp: 5_000, amount: 200_000 }],
      healEvents: [],
      deathTimestamps: [],
      fightStart: 0,
      fightEnd: 20_000,
      eventPagesComplete: false,
    });
    expect(timeline.reconstructedPointCount).toBe(0);
    expect(timeline.complete).toBe(false);
    expect(timeline.incompletenessReasons).toContain("incomplete_event_pagination");
  });
});

describe("survival-v1.1 score mode", () => {
  it("maps coverage shares to FULL / PARTIAL / OUTCOME_ONLY", () => {
    expect(determineScoreMode(21, 17, 21)).toBe("FULL_BEHAVIORAL"); // ~81% complete
    expect(determineScoreMode(21, 5, 21)).toBe("PARTIAL_BEHAVIORAL"); // max HP ok, timelines incomplete
    expect(determineScoreMode(5, 5, 21)).toBe("OUTCOME_ONLY"); // ~23% max HP
    expect(SURVIVAL_STANDALONE_V1_1_CONFIG.reaction.minReactionIntervalMs).toBe(1500);
  });
});
