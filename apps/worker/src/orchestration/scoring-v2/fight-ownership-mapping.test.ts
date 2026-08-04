/**
 * Transport mapping: RunCombatFacts.targetSourceId → playerActorId,
 * attributedSourceIds excluding target → ownedPetActorIds.
 */
import { describe, expect, it } from "vitest";
import { buildEvidenceDatasetScopeFingerprint } from "@mplus/contracts";
import { scopeFingerprintForFightDetails } from "./fight-details-persist.js";

function asActorMeta(data: unknown): {
  playerActorId: number | null;
  ownedPetActorIds: number[];
  fightFriendlyPlayerActorIds: number[];
  targetInFight: boolean;
} {
  // Mirror evidence-transport-provider.actorFromFightDetails without importing private fn.
  const payload = data as Record<string, unknown>;
  const fight = payload.fight as Record<string, unknown>;
  const combatFacts = payload.combatFacts as Record<string, unknown>;
  const targetSourceId =
    typeof combatFacts?.targetSourceId === "number" ? combatFacts.targetSourceId : null;
  const fightTargetActorId =
    typeof fight?.targetActorId === "number" ? fight.targetActorId : null;
  const playerActorId = targetSourceId ?? fightTargetActorId;
  const attributed = Array.isArray(combatFacts?.attributedSourceIds)
    ? (combatFacts.attributedSourceIds as number[])
    : [];
  const ownedPetActorIds =
    playerActorId != null ? attributed.filter((id) => id !== playerActorId) : [];
  const fightFriendlyPlayerActorIds = Array.isArray(fight?.fightFriendlyPlayerActorIds)
    ? (fight.fightFriendlyPlayerActorIds as number[])
    : [];
  const targetInFight =
    typeof fight?.targetInFight === "boolean"
      ? fight.targetInFight
      : playerActorId != null && fightFriendlyPlayerActorIds.includes(playerActorId);
  return { playerActorId, ownedPetActorIds, fightFriendlyPlayerActorIds, targetInFight };
}

describe("F: fight details ownership proof mapping", () => {
  it("maps targetSourceId / attributedSourceIds and preserves ownership fields", () => {
    const data = {
      report: { code: "8WawmdrjbYtRFPqy", revision: 3 },
      fight: {
        id: 1,
        startTime: 0,
        endTime: 1000,
        keystoneLevel: 12,
        keystoneBonus: 1,
        keystoneTime: 900,
        inProgress: false,
        fightFriendlyPlayerActorIds: [3, 7, 4, 1, 5],
        targetActorId: 1,
        targetInFight: true,
        friendlyPlayers: [
          { id: 1, name: "Coomerhabile", server: "Archimonde", type: "Player" },
        ],
      },
      combatFacts: {
        targetSourceId: 1,
        attributedSourceIds: [1, 88, 89],
      },
    };
    const meta = asActorMeta(data);
    expect(meta.playerActorId).toBe(1);
    expect(meta.ownedPetActorIds).toEqual([88, 89]);
    expect(meta.fightFriendlyPlayerActorIds).toEqual([3, 7, 4, 1, 5]);
    expect(meta.targetInFight).toBe(true);
    expect(scopeFingerprintForFightDetails(data)).toContain("a:1");
  });

  it("does not invent playerActorId from nonexistent combatFacts.playerActorId", () => {
    const meta = asActorMeta({
      fight: {
        fightFriendlyPlayerActorIds: [1],
        targetActorId: null,
        targetInFight: false,
      },
      combatFacts: {
        // Intentionally omit playerActorId / ownedPetActorIds (live shape).
        targetSourceId: undefined,
        attributedSourceIds: [],
      },
    });
    expect(meta.playerActorId).toBeNull();
    expect(meta.ownedPetActorIds).toEqual([]);
  });

  it("D: fight-details scope fingerprints differ per actor", () => {
    const a = scopeFingerprintForFightDetails({
      combatFacts: { targetSourceId: 1 },
      fight: { targetActorId: 1 },
    });
    const b = scopeFingerprintForFightDetails({
      combatFacts: { targetSourceId: 317 },
      fight: { targetActorId: 317 },
    });
    expect(a).not.toBe(b);
    expect(
      buildEvidenceDatasetScopeFingerprint({
        datasetKey: "Deaths",
        sourceActorId: 1,
        providerContractVersion: "wcl-graphql-v2-events",
      }),
    ).not.toBe(
      buildEvidenceDatasetScopeFingerprint({
        datasetKey: "Deaths",
        sourceActorId: 317,
        providerContractVersion: "wcl-graphql-v2-events",
      }),
    );
  });
});
