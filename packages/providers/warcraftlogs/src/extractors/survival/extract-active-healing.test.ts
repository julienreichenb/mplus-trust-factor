import { describe, expect, it } from "vitest";
import type { CapabilityCompactEvent } from "@mplus/contracts";
import { extractSurvivalActiveHealingEvents } from "./extract-active-healing.js";

function heal(partial: Partial<CapabilityCompactEvent> & { eventId: string; timestampMs: number }): CapabilityCompactEvent {
  return {
    dataset: "Healing",
    eventType: "heal",
    spellId: 85673,
    rawName: "Word of Glory",
    sourceActorId: 10,
    sourceOwnerPlayerActorId: 10,
    targetActorId: 10,
    targetPlayerActorId: 10,
    amount: 80_000,
    overheal: 0,
    hitPoints: 400_000,
    maxHitPoints: 500_000,
    capabilities: ["SURVIVAL_RECOVERY_ACTIVATIONS"],
    ...partial,
  };
}

describe("extractSurvivalActiveHealingEvents", () => {
  it("classifies self and ally heals for Retribution", () => {
    const events = extractSurvivalActiveHealingEvents({
      compactEvents: [
        heal({ eventId: "h1", timestampMs: 1, targetActorId: 10, targetPlayerActorId: 10 }),
        heal({ eventId: "h2", timestampMs: 2, targetActorId: 11, targetPlayerActorId: 11 }),
      ],
      participantActorId: 10,
      friendlyPlayerActorIds: [10, 11],
      classSlug: "paladin",
      specSlug: "retribution",
    });
    expect(events.map((e) => e.targetRelation)).toEqual(["SELF", "ALLY"]);
    expect(events.every((e) => e.effectiveAmount === 80_000)).toBe(true);
    expect(events[0]?.effectiveHealPctMaxHp).toBeCloseTo(80_000 / 500_000);
  });

  it("uses amount as effective heal and does not subtract overheal", () => {
    const events = extractSurvivalActiveHealingEvents({
      compactEvents: [
        heal({
          eventId: "h1",
          timestampMs: 1,
          amount: 10_000,
          overheal: 90_000,
        }),
      ],
      participantActorId: 10,
      friendlyPlayerActorIds: [10],
      classSlug: "paladin",
      specSlug: "protection",
    });
    expect(events[0]?.effectiveAmount).toBe(10_000);
  });

  it("ignores Holy Paladin and Restoration Shaman", () => {
    const holy = extractSurvivalActiveHealingEvents({
      compactEvents: [heal({ eventId: "h1", timestampMs: 1, spellId: 19750 })],
      participantActorId: 10,
      friendlyPlayerActorIds: [10],
      classSlug: "paladin",
      specSlug: "holy",
    });
    const resto = extractSurvivalActiveHealingEvents({
      compactEvents: [heal({ eventId: "h1", timestampMs: 1, spellId: 8004 })],
      participantActorId: 10,
      friendlyPlayerActorIds: [10],
      classSlug: "shaman",
      specSlug: "restoration",
    });
    expect(holy).toEqual([]);
    expect(resto).toEqual([]);
  });

  it("excludes NPC and pet targets", () => {
    const events = extractSurvivalActiveHealingEvents({
      compactEvents: [
        heal({
          eventId: "npc",
          timestampMs: 1,
          spellId: 8004,
          targetActorId: 99,
          targetPlayerActorId: null,
        }),
        heal({
          eventId: "pet",
          timestampMs: 2,
          spellId: 8004,
          targetActorId: 50,
          targetPlayerActorId: null,
        }),
      ],
      participantActorId: 10,
      friendlyPlayerActorIds: [10, 11],
      classSlug: "shaman",
      specSlug: "enhancement",
    });
    expect(events.every((e) => e.targetRelation === "EXCLUDED")).toBe(true);
  });

  it("ignores healing produced by another player", () => {
    const events = extractSurvivalActiveHealingEvents({
      compactEvents: [
        heal({
          eventId: "other",
          timestampMs: 1,
          sourceActorId: 11,
          sourceOwnerPlayerActorId: 11,
        }),
      ],
      participantActorId: 10,
      friendlyPlayerActorIds: [10, 11],
      classSlug: "paladin",
      specSlug: "retribution",
    });
    expect(events).toEqual([]);
  });
});
