/**
 * Regression fixtures for WCL fight ownership invariant.
 * Report 8WawmdrjbYtRFPqy / fight 1: Wallidrixe is report-wide but not in friendlyPlayers.
 */
import { describe, expect, it, vi } from "vitest";
import {
  candidatesFromHydratedReport,
  type HydrationReportPayload,
} from "./report-hydration.js";
import {
  nameRealmMatches,
  normalizeWclRealmSlug,
  resolveFightOwnership,
  wclRealmCompareKey,
} from "./fight-ownership.js";
import { buildRunCombatFactsFromEvents } from "../analysis/event-fetcher.js";
import { buildEvidenceDatasetScopeFingerprint } from "@mplus/contracts";

/** Confirmed regression fixture: Wallidrixe in masterData, absent from fight 1 roster. */
export const WALLIDRIXE_POISON_REPORT: HydrationReportPayload = {
  code: "8WawmdrjbYtRFPqy",
  startTime: 1_700_000_000_000,
  visibility: "public",
  zone: { id: 42, name: "Mythic+" },
  fights: [
    {
      id: 1,
      encounterID: 1260,
      name: "Priory of the Sacred Flame",
      kill: true,
      startTime: 0,
      endTime: 1_800_000,
      keystoneLevel: 12,
      keystoneBonus: 1,
      keystoneTime: 1_750_000,
      inProgress: false,
      // Actual fight roster — Coomerhabile is actor 1; Wallidrixe (317) is absent.
      friendlyPlayers: [3, 7, 4, 1, 5],
    },
    {
      id: 2,
      encounterID: 1260,
      name: "Priory of the Sacred Flame",
      kill: true,
      startTime: 2_000_000,
      endTime: 3_800_000,
      keystoneLevel: 10,
      keystoneBonus: 0,
      inProgress: false,
      // Wallidrixe participates only in fight 2.
      friendlyPlayers: [317, 10, 11, 12, 13],
    },
  ],
  masterData: {
    actors: [
      { id: 1, name: "Coomerhabile", type: "Player", server: "Archimonde" },
      { id: 3, name: "TankA", type: "Player", server: "Archimonde" },
      { id: 4, name: "HealA", type: "Player", server: "Archimonde" },
      { id: 5, name: "DpsA", type: "Player", server: "Archimonde" },
      { id: 7, name: "DpsB", type: "Player", server: "Archimonde" },
      { id: 10, name: "TankB", type: "Player", server: "Archimonde" },
      { id: 11, name: "HealB", type: "Player", server: "Archimonde" },
      { id: 12, name: "DpsC", type: "Player", server: "Archimonde" },
      { id: 13, name: "DpsD", type: "Player", server: "Archimonde" },
      // Report-wide actor — present in masterData but NOT in fight 1 friendlyPlayers.
      { id: 317, name: "Wallidrixe", type: "Player", server: "Archimonde" },
    ],
  },
};

describe("WCL fight ownership invariant", () => {
  it("A: Wallidrixe in masterData but not friendlyPlayers => TARGET_NOT_IN_FIGHT", () => {
    const ownership = resolveFightOwnership({
      actors: WALLIDRIXE_POISON_REPORT.masterData!.actors!,
      friendlyPlayers: WALLIDRIXE_POISON_REPORT.fights[0]!.friendlyPlayers,
      characterName: "Wallidrixe",
      realmSlug: "archimonde",
      keystoneLevel: 12,
      inProgress: false,
    });
    expect(ownership.ok).toBe(false);
    if (!ownership.ok) {
      expect(ownership.reason).toBe("TARGET_NOT_IN_FIGHT");
      expect(ownership.targetActorId).toBe(317);
      expect(ownership.targetInFight).toBe(false);
      expect(ownership.fightFriendlyPlayerActorIds).toEqual([3, 7, 4, 1, 5]);
    }

    const hydrated = candidatesFromHydratedReport(
      WALLIDRIXE_POISON_REPORT,
      "Wallidrixe",
      "archimonde",
    );
    expect(hydrated.candidates.some((c) => c.fightId === 1)).toBe(false);
    expect(
      hydrated.rejected.some((r) => r.includes("fight_1_TARGET_NOT_IN_FIGHT")),
    ).toBe(true);
  });

  it("A: TARGET_NOT_IN_FIGHT produces zero ReportEvents calls", async () => {
    const request = vi.fn();
    const client = { request } as never;
    await expect(
      buildRunCombatFactsFromEvents(client, {
        reportCode: "8WawmdrjbYtRFPqy",
        fightId: 1,
        revision: 1,
        characterName: "Wallidrixe",
        realmSlug: "archimonde",
        actors: WALLIDRIXE_POISON_REPORT.masterData!.actors!,
        friendlyPlayers: WALLIDRIXE_POISON_REPORT.fights[0]!.friendlyPlayers,
        keystoneLevel: 12,
        inProgress: false,
      }),
    ).rejects.toMatchObject({
      details: { ownershipReason: "TARGET_NOT_IN_FIGHT" },
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("B: Coomerhabile accepted for fight 1 with actorId 1", () => {
    const ownership = resolveFightOwnership({
      actors: WALLIDRIXE_POISON_REPORT.masterData!.actors!,
      friendlyPlayers: WALLIDRIXE_POISON_REPORT.fights[0]!.friendlyPlayers,
      characterName: "Coomerhabile",
      realmSlug: "archimonde",
      keystoneLevel: 12,
    });
    expect(ownership.ok).toBe(true);
    if (ownership.ok) {
      expect(ownership.targetActorId).toBe(1);
      expect(ownership.targetInFight).toBe(true);
    }

    const hydrated = candidatesFromHydratedReport(
      WALLIDRIXE_POISON_REPORT,
      "Coomerhabile",
      "archimonde",
    );
    const fight1 = hydrated.candidates.find((c) => c.fightId === 1);
    expect(fight1?.targetActorId).toBe(1);
  });

  it("C: multi-fight report — Wallidrixe only becomes candidate for fight 2", () => {
    const hydrated = candidatesFromHydratedReport(
      WALLIDRIXE_POISON_REPORT,
      "Wallidrixe",
      "archimonde",
    );
    expect(hydrated.candidates.map((c) => c.fightId)).toEqual([2]);
    expect(hydrated.candidates[0]?.targetActorId).toBe(317);
  });

  it("D: actor-scoped dataset pages have different scope fingerprints", () => {
    const wallidrixe = buildEvidenceDatasetScopeFingerprint({
      datasetKey: "Deaths",
      sourceActorId: 317,
      filterExpression: null,
      hostilityType: null,
      includeResources: false,
      startTime: 0,
      endTime: 1_800_000,
      providerContractVersion: "wcl-graphql-v2-events",
    });
    const coomer = buildEvidenceDatasetScopeFingerprint({
      datasetKey: "Deaths",
      sourceActorId: 1,
      filterExpression: null,
      hostilityType: null,
      includeResources: false,
      startTime: 0,
      endTime: 1_800_000,
      providerContractVersion: "wcl-graphql-v2-events",
    });
    expect(wallidrixe).not.toBe(coomer);
    expect(wallidrixe).toContain("a:317");
    expect(coomer).toContain("a:1");
  });

  it("E: same character name on different realms does not match", () => {
    expect(nameRealmMatches("Wallidrixe", "Archimonde", "Wallidrixe", "kazzak")).toBe(false);
    expect(nameRealmMatches("Wallidrixe", "Kazzak", "Wallidrixe", "archimonde")).toBe(false);
    expect(nameRealmMatches("Wallidrixe", "Archimonde", "Wallidrixe", "archimonde")).toBe(true);

    const ownership = resolveFightOwnership({
      actors: [
        { id: 10, name: "Wallidrixe", type: "Player", server: "Kazzak" },
        { id: 317, name: "Wallidrixe", type: "Player", server: "Archimonde" },
      ],
      friendlyPlayers: [10, 317],
      characterName: "Wallidrixe",
      realmSlug: "archimonde",
      keystoneLevel: 12,
    });
    expect(ownership.ok).toBe(true);
    if (ownership.ok) expect(ownership.targetActorId).toBe(317);
  });

  it("F: partial realm names never prove ownership (no substring match)", () => {
    expect(normalizeWclRealmSlug("Tarren Mill")).toBe("tarren-mill");
    expect(normalizeWclRealmSlug("tarren_mill")).toBe("tarren-mill");
    expect(nameRealmMatches("Wallidrixe", "Archimonde", "Wallidrixe", "archi")).toBe(false);
    expect(nameRealmMatches("Wallidrixe", "Archi", "Wallidrixe", "archimonde")).toBe(false);
    expect(nameRealmMatches("Wallidrixe", "Archimonde", "Wallidrixe", "Archimonde")).toBe(true);
  });

  it("F2: WCL separator-omitted realms match canonical hyphenated slugs", () => {
    expect(normalizeWclRealmSlug("burning-legion")).toBe("burning-legion");
    expect(normalizeWclRealmSlug("burninglegion")).toBe("burninglegion");
    expect(wclRealmCompareKey("burning-legion")).toBe("burninglegion");
    expect(wclRealmCompareKey("burninglegion")).toBe("burninglegion");
    expect(wclRealmCompareKey("Burning-Legion")).toBe("burninglegion");
    expect(wclRealmCompareKey("Burning Legion")).toBe("burninglegion");

    expect(nameRealmMatches("Myzouth", "burninglegion", "Myzouth", "burning-legion")).toBe(true);
    expect(nameRealmMatches("Myzouth", "Burning-Legion", "Myzouth", "burninglegion")).toBe(true);
    expect(nameRealmMatches("Myzouth", "Burning Legion", "Myzouth", "burning-legion")).toBe(true);

    expect(nameRealmMatches("Myzouth", "burninglegion", "Myzouth", "burning-blade")).toBe(false);
    expect(nameRealmMatches("Myzouth", "burninglegion", "Myzouth", "burninglegion-other")).toBe(
      false,
    );
    expect(nameRealmMatches("Other", "burninglegion", "Myzouth", "burning-legion")).toBe(false);
  });

  it("G: missing actor server does not prove ownership", () => {
    expect(nameRealmMatches("Wallidrixe", null, "Wallidrixe", "archimonde")).toBe(false);
    expect(nameRealmMatches("Wallidrixe", undefined, "Wallidrixe", "archimonde")).toBe(false);
    expect(nameRealmMatches("Wallidrixe", "", "Wallidrixe", "archimonde")).toBe(false);
    expect(nameRealmMatches("Wallidrixe", "   ", "Wallidrixe", "archimonde")).toBe(false);

    const ownership = resolveFightOwnership({
      actors: [{ id: 317, name: "Wallidrixe", type: "Player", server: null }],
      friendlyPlayers: [317],
      characterName: "Wallidrixe",
      realmSlug: "archimonde",
      keystoneLevel: 12,
    });
    expect(ownership.ok).toBe(false);
    if (!ownership.ok) expect(ownership.reason).toBe("TARGET_NOT_IN_REPORT");
  });
});
