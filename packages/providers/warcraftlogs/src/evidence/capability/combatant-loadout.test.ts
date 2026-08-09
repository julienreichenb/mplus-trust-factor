import { describe, expect, it } from "vitest";
import {
  extractLoadoutIdsFromCombatantInfo,
  extractParticipantLoadoutsFromCombatantEvents,
} from "./combatant-loadout.js";

describe("CombatantInfo loadout extraction", () => {
  it("extracts spellIds from talentTree nodes", () => {
    const result = extractLoadoutIdsFromCombatantInfo({
      sourceID: 10,
      specID: 63,
      talentTree: [
        { id: 100, nodeId: 200, rank: 1, spellId: 382440 },
        { id: 101, nodeId: 201, rank: 1, spellId: 190319 },
      ],
    });
    expect(result.evidenceState).toBe("PRESENT");
    expect(result.blizzardSpecId).toBe(63);
    expect(result.talentSpellIds).toEqual([190319, 382440]);
    expect(result.talentTreeNodeIds).toEqual([100, 101]);
  });

  it("marks ABSENT when no talent payload", () => {
    const result = extractLoadoutIdsFromCombatantInfo({
      sourceID: 10,
      specID: 63,
    });
    expect(result.evidenceState).toBe("ABSENT");
    expect(result.talentSpellIds).toEqual([]);
  });

  it("scopes loadouts to friendly players only", () => {
    const rows = extractParticipantLoadoutsFromCombatantEvents(
      [
        {
          sourceID: 10,
          specID: 63,
          talentTree: [{ id: 1, spellId: 382440, rank: 1 }],
        },
        {
          sourceID: 99,
          specID: 71,
          talentTree: [{ id: 2, spellId: 123, rank: 1 }],
        },
      ],
      new Set([10]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorId).toBe(10);
    expect(rows[0]!.talentSpellIds).toEqual([382440]);
  });
});
