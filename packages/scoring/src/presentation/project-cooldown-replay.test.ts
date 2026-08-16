import { describe, expect, it } from "vitest";
import {
  COOLDOWN_REPLAY_MAX_EVENTS,
  projectCooldownReplayFromDigest,
} from "./project-cooldown-replay.js";

function digest(partial?: {
  fightId?: number;
  fightStartMs?: number | null;
  participantActorId?: number | null;
  offensive?: unknown;
  utility?: unknown;
  survival?: unknown;
  partyDeaths?: unknown;
  partyRoster?: Array<{ participantActorId: number; name: string; classSlug?: string | null }>;
  hostileActors?: unknown;
}) {
  return {
    reportCode: "ABC",
    fightId: partial?.fightId ?? 11,
    classSlug: "warrior",
    specSlug: "arms",
    participantActorId: partial?.participantActorId ?? 10,
    fightStartMs: partial?.fightStartMs,
    offensive: partial?.offensive ?? { offensiveActivations: [], activeCombatMs: 600_000 },
    utility: partial?.utility ?? { actions: [] },
    survival: partial?.survival ?? {
      personalDefensiveActivations: [],
      recoveryActivations: [],
      fightDurationMs: 600_000,
    },
    partyDeaths: partial?.partyDeaths,
    partyRoster: partial?.partyRoster,
    hostileActors: partial?.hostileActors,
  };
}

describe("projectCooldownReplayFromDigest", () => {
  it("is unavailable when no digest is provided", () => {
    expect(projectCooldownReplayFromDigest(null).status).toBe("UNAVAILABLE");
  });

  it("is unavailable without exact full-fight duration even if activeCombatMs is present", () => {
    const timeline = projectCooldownReplayFromDigest(
      digest({
        offensive: {
          offensiveActivations: [{ primarySpellId: 1, fightOffsetMs: 1_000, canonicalKey: "a" }],
          activeCombatMs: 500_000,
        },
        survival: {
          personalDefensiveActivations: [],
          recoveryActivations: [],
          fightDurationMs: null,
        },
      }),
    );
    expect(timeline.status).toBe("UNAVAILABLE");
    expect(timeline.durationMs).toBeNull();
    expect(timeline.events).toEqual([]);
  });

  it("uses fightOffsetMs as an explicit relative offset", () => {
    const timeline = projectCooldownReplayFromDigest(
      digest({
        offensive: {
          offensiveActivations: [{ primarySpellId: 1, fightOffsetMs: 42_000, canonicalKey: "a" }],
        },
      }),
    );
    expect(timeline.events[0]?.timestampMs).toBe(42_000);
  });

  it("normalizes an absolute timestamp using the exact fight start", () => {
    const timeline = projectCooldownReplayFromDigest(
      digest({
        fightStartMs: 5_000_000,
        offensive: {
          offensiveActivations: [{ primarySpellId: 1, timestampMs: 5_030_000, canonicalKey: "a" }],
        },
      }),
    );
    expect(timeline.events[0]?.timestampMs).toBe(30_000);
  });

  it("derives fight start from a persisted timestamp/offset pair, not magnitude", () => {
    const timeline = projectCooldownReplayFromDigest(
      digest({
        offensive: {
          offensiveActivations: [
            {
              primarySpellId: 1,
              timestampMs: 5_000_000,
              fightOffsetMs: 0,
              canonicalKey: "paired",
            },
            { primarySpellId: 2, timestampMs: 5_045_000, canonicalKey: "absolute-only" },
          ],
        },
      }),
    );
    expect(timeline.events.map((event) => event.timestampMs)).toEqual([0, 45_000]);
  });

  it("omits an ambiguous timestamp instead of guessing from magnitude", () => {
    const timeline = projectCooldownReplayFromDigest(
      digest({
        offensive: {
          offensiveActivations: [
            { primarySpellId: 1, timestampMs: 8_000, canonicalKey: "looks-relative" },
            { primarySpellId: 2, timestampMs: 1_700_000_000_000, canonicalKey: "epoch-shaped" },
          ],
        },
      }),
    );
    expect(timeline.status).toBe("EMPTY");
    expect(timeline.events).toEqual([]);
  });

  it("maps P/U/S events with fightOffsetMs and rejects out-of-range timestamps", () => {
    const timeline = projectCooldownReplayFromDigest(
      digest({
        offensive: {
          offensiveActivations: [
            { primarySpellId: 107574, canonicalKey: "avatar", fightOffsetMs: 30_000 },
            { primarySpellId: 1, canonicalKey: "late", fightOffsetMs: 900_000 },
          ],
          activeCombatMs: 400_000,
        },
        utility: {
          actions: [
            {
              utilityCategory: "INTERRUPT",
              primarySpellId: 6552,
              canonicalName: "Pummel",
              fightOffsetMs: 90_000,
            },
            {
              utilityCategory: "CROWD_CONTROL",
              primarySpellId: 107570,
              canonicalName: "Storm Bolt",
              fightOffsetMs: 120_000,
            },
            {
              utilityCategory: "STOP",
              primarySpellId: 46968,
              canonicalName: "Shockwave",
              fightOffsetMs: 150_000,
            },
            {
              utilityCategory: "DEFENSIVE_DISPEL",
              primarySpellId: 384100,
              canonicalName: "Dispel",
              fightOffsetMs: 180_000,
            },
          ],
        },
        survival: {
          fightDurationMs: 600_000,
          personalDefensiveActivations: [
            {
              activationKind: "PERSONAL_DEFENSIVE",
              defensiveCategory: "DEFENSIVE_MAJOR",
              primarySpellId: 871,
              canonicalName: "Shield Wall",
              fightOffsetMs: 210_000,
            },
            {
              activationKind: "PERSONAL_DEFENSIVE",
              defensiveCategory: "CONSUMABLE",
              primarySpellId: 431416,
              canonicalName: "Healing Potion",
              fightOffsetMs: 240_000,
            },
            {
              activationKind: "EXTERNAL_DEFENSIVE_RECEIVED",
              defensiveCategory: "EXTERNAL_DEFENSIVE",
              primarySpellId: 1022,
              canonicalName: "Blessing",
              fightOffsetMs: 50_000,
            },
          ],
          recoveryActivations: [],
        },
      }),
    );
    expect(timeline.status).toBe("AVAILABLE");
    expect(timeline.durationMs).toBe(600_000);
    expect(timeline.truncated).toBe(false);
    expect(timeline.events.map((e) => e.type)).toEqual([
      "offensive cooldown",
      "interrupt",
      "crowd control",
      "stop",
      "dispel",
      "defensive cooldown",
      "consumable",
    ]);
    expect(timeline.events.find((e) => e.type === "offensive cooldown")?.timestampMs).toBe(30_000);
    expect(timeline.events.some((e) => e.timestampMs === 900_000)).toBe(false);
    expect(timeline.events.some((e) => e.abilityName === "Blessing")).toBe(false);
  });

  it("keeps a normal observed-size timeline complete", () => {
    const activations = Array.from({ length: 527 }, (_, index) => ({
      primarySpellId: index + 1,
      canonicalKey: `spell-${index}`,
      fightOffsetMs: index * 1_000,
    }));
    const timeline = projectCooldownReplayFromDigest(
      digest({
        offensive: { offensiveActivations: activations },
        survival: {
          personalDefensiveActivations: [],
          recoveryActivations: [],
          fightDurationMs: 600_000,
        },
      }),
    );
    expect(timeline.truncated).toBe(false);
    expect(timeline.totalEventCount).toBe(527);
    expect(timeline.events).toHaveLength(527);
    expect(timeline.events[0]?.timestampMs).toBe(0);
    expect(timeline.events.at(-1)?.timestampMs).toBe(526_000);
  });

  it("caps pathological overflow after dedup and chronological sort", () => {
    const activations = Array.from({ length: COOLDOWN_REPLAY_MAX_EVENTS + 5 }, (_, index) => ({
      primarySpellId: index + 1,
      canonicalKey: `spell-${index}`,
      fightOffsetMs: (COOLDOWN_REPLAY_MAX_EVENTS + 5 - index) * 100,
    }));
    const timeline = projectCooldownReplayFromDigest(
      digest({
        offensive: { offensiveActivations: activations },
        survival: {
          personalDefensiveActivations: [],
          recoveryActivations: [],
          fightDurationMs: 600_000,
        },
      }),
    );
    expect(timeline.truncated).toBe(true);
    expect(timeline.totalEventCount).toBe(COOLDOWN_REPLAY_MAX_EVENTS + 5);
    expect(timeline.events).toHaveLength(COOLDOWN_REPLAY_MAX_EVENTS);
    const stamps = timeline.events.map((event) => event.timestampMs);
    expect(stamps).toEqual([...stamps].sort((a, b) => a - b));
    expect(stamps[0]).toBe(100);
    expect(stamps.at(-1)).toBe(COOLDOWN_REPLAY_MAX_EVENTS * 100);
  });

  it("does not duplicate the same survival activation across personal and recovery slices", () => {
    const timeline = projectCooldownReplayFromDigest(
      digest({
        survival: {
          fightDurationMs: 600_000,
          personalDefensiveActivations: [
            {
              canonicalActivationId: "same-cast",
              activationKind: "PERSONAL_DEFENSIVE",
              defensiveCategory: "DEFENSIVE_MAJOR",
              primarySpellId: 871,
              canonicalName: "Shield Wall",
              fightOffsetMs: 10_000,
            },
          ],
          recoveryActivations: [
            {
              canonicalActivationId: "same-cast",
              activationKind: "RECOVERY",
              defensiveCategory: "SELF_HEAL",
              primarySpellId: 871,
              canonicalName: "Shield Wall",
              fightOffsetMs: 10_000,
            },
          ],
        },
      }),
    );
    expect(timeline.events).toHaveLength(1);
    expect(timeline.events[0]?.type).toBe("defensive cooldown");
  });

  it("does not cross-wire two fights with the same dungeon/key", () => {
    const a = projectCooldownReplayFromDigest(
      digest({
        fightId: 11,
        offensive: {
          offensiveActivations: [{ primarySpellId: 1, fightOffsetMs: 1_000, canonicalKey: "a" }],
        },
      }),
    );
    const b = projectCooldownReplayFromDigest(
      digest({
        fightId: 12,
        offensive: {
          offensiveActivations: [{ primarySpellId: 2, fightOffsetMs: 2_000, canonicalKey: "b" }],
        },
      }),
    );
    expect(a.events[0]?.timestampMs).toBe(1_000);
    expect(b.events[0]?.timestampMs).toBe(2_000);
    expect(a.events[0]?.abilityId).not.toBe(b.events[0]?.abilityId);
  });

  it("returns EMPTY when the exact digest has no tracked activations", () => {
    expect(projectCooldownReplayFromDigest(digest()).status).toBe("EMPTY");
  });

  it("projects Demonic Tyrant from canonicalKey instead of leaking the internal key", () => {
    const timeline = projectCooldownReplayFromDigest({
      ...digest(),
      classSlug: "warlock",
      specSlug: "demonology",
      offensive: {
        offensiveActivations: [
          {
            activationId: "act-tyrant",
            canonicalKey: "warlock.offensive.demonic-tyrant",
            primarySpellId: 265187,
            observedSpellIds: [265187],
            fightOffsetMs: 47_000,
          },
        ],
      },
    });
    const event = timeline.events[0];
    expect(event?.abilityName).toBe("Summon Demonic Tyrant");
    expect(event?.abilityName).not.toBe("warlock.offensive.demonic-tyrant");
    expect(event?.abilityId).toBe(265187);
    expect(event?.dimension).toBe("PERFORMANCE");
  });

  it("keeps Utility and Survival catalog names", () => {
    const timeline = projectCooldownReplayFromDigest({
      ...digest(),
      classSlug: "warlock",
      specSlug: "demonology",
      utility: {
        actions: [
          {
            canonicalActionId: "gw",
            utilityCategory: "OTHER_UTILITY",
            primarySpellId: 111771,
            canonicalName: "Demonic Gateway",
            fightOffsetMs: 19_000,
          },
          {
            canonicalActionId: "tongues",
            utilityCategory: "CROWD_CONTROL",
            primarySpellId: 1714,
            canonicalName: "Curse of Tongues",
            fightOffsetMs: 36_000,
          },
        ],
      },
      survival: {
        fightDurationMs: 600_000,
        personalDefensiveActivations: [
          {
            canonicalActivationId: "pact",
            activationKind: "PERSONAL_DEFENSIVE",
            defensiveCategory: "DEFENSIVE_MINOR",
            primarySpellId: 108416,
            canonicalName: "Dark Pact",
            fightOffsetMs: 43_000,
          },
        ],
        recoveryActivations: [],
      },
    });
    expect(timeline.events.map((event) => event.abilityName)).toEqual([
      "Demonic Gateway",
      "Curse of Tongues",
      "Dark Pact",
    ]);
  });

  it("clusters group hostile casts into pulls and leaves between-pull events unsegmented", () => {
    const timeline = projectCooldownReplayFromDigest(
      digest({
        offensive: {
          offensiveActivations: [
            { primarySpellId: 1, fightOffsetMs: 5_000, canonicalKey: "prep" },
            { primarySpellId: 2, fightOffsetMs: 36_000, canonicalKey: "pull-one" },
            { primarySpellId: 3, fightOffsetMs: 85_000, canonicalKey: "pull-two" },
          ],
        },
        utility: {
          actions: [],
          hostileCastEvents: [
            { eventId: "h1", fightOffsetMs: 30_000 },
            { eventId: "h2", fightOffsetMs: 35_000 },
            { eventId: "h3", fightOffsetMs: 38_000 },
            { eventId: "h4", fightOffsetMs: 80_000 },
            { eventId: "h5", fightOffsetMs: 88_000 },
          ],
        },
      }),
    );
    expect(timeline.segments).toEqual([
      { index: 1, startMs: 30_000, endMs: 38_000, bossName: null, bossPortraitUrl: null },
      { index: 2, startMs: 80_000, endMs: 88_000, bossName: null, bossPortraitUrl: null },
    ]);
    expect(timeline.events.find((event) => event.timestampMs === 5_000)?.segmentIndex).toBeNull();
    expect(timeline.events.find((event) => event.timestampMs === 36_000)?.segmentIndex).toBe(1);
    expect(timeline.events.find((event) => event.timestampMs === 85_000)?.segmentIndex).toBe(2);
  });

  it("does not split a pull on a short hostile quiet gap", () => {
    const timeline = projectCooldownReplayFromDigest(
      digest({
        utility: {
          actions: [],
          hostileCastEvents: [
            { eventId: "a", fightOffsetMs: 10_000 },
            { eventId: "b", fightOffsetMs: 22_000 },
          ],
        },
      }),
    );
    expect(timeline.segments).toHaveLength(1);
    expect(timeline.segments?.[0]).toMatchObject({ startMs: 10_000, endMs: 22_000 });
  });

  it("does not split combat from subject cooldown inactivity", () => {
    const hostileCastEvents = Array.from({ length: 19 }, (_, index) => ({
      eventId: `h${index}`,
      fightOffsetMs: index * 5_000,
    }));
    const timeline = projectCooldownReplayFromDigest(
      digest({
        offensive: {
          offensiveActivations: [
            { primarySpellId: 1, fightOffsetMs: 2_000, canonicalKey: "early" },
            { primarySpellId: 2, fightOffsetMs: 80_000, canonicalKey: "late" },
          ],
        },
        utility: { actions: [], hostileCastEvents },
      }),
    );
    expect(timeline.segments).toHaveLength(1);
    expect(timeline.segments?.[0]).toMatchObject({ startMs: 0, endMs: 90_000 });
  });

  it("labels a pull from WCL subType Boss actors active in the segment", () => {
    const timeline = projectCooldownReplayFromDigest(
      digest({
        utility: {
          actions: [],
          hostileCastEvents: [
            { eventId: "trash", fightOffsetMs: 10_000, sourceActorId: 40 },
            { eventId: "boss", fightOffsetMs: 50_000, sourceActorId: 80 },
            { eventId: "boss2", fightOffsetMs: 52_000, targetActorId: 80 },
          ],
        },
        hostileActors: [
          { id: -1, name: "Environment", type: "NPC", subType: "Boss", petOwner: null },
          { id: 40, name: "Skittering Assistant", type: "NPC", subType: "NPC" },
          { id: 80, name: "Loom'ithar", type: "NPC", subType: "Boss" },
        ],
      }),
    );
    expect(timeline.segments?.[0]?.bossName).toBeNull();
    expect(timeline.segments?.[1]?.bossName).toBe("Loom'ithar");
    expect(timeline.segments?.[1]?.bossPortraitUrl).toBeNull();
  });

  it("joins multiple Boss actors in one pull deterministically", () => {
    const timeline = projectCooldownReplayFromDigest(
      digest({
        utility: {
          actions: [],
          hostileCastEvents: [
            { eventId: "a", fightOffsetMs: 20_000, sourceActorId: 2 },
            { eventId: "b", fightOffsetMs: 21_000, sourceActorId: 1 },
          ],
        },
        hostileActors: [
          { id: 1, name: "Boss B", type: "NPC", subType: "Boss" },
          { id: 2, name: "Boss A", type: "NPC", subType: "Boss" },
        ],
      }),
    );
    expect(timeline.segments).toHaveLength(1);
    expect(timeline.segments?.[0]?.bossName).toBe("Boss A & Boss B");
  });

  it("does not treat NPC names as bosses without subType Boss", () => {
    const timeline = projectCooldownReplayFromDigest(
      digest({
        utility: {
          actions: [],
          hostileCastEvents: [{ eventId: "n", fightOffsetMs: 12_000, sourceActorId: 9 }],
        },
        hostileActors: [{ id: 9, name: "Forgemaster Garfrost", type: "NPC", subType: "NPC" }],
      }),
    );
    expect(timeline.segments?.[0]?.bossName).toBeNull();
  });

  it("does not apply a boss actor from another segment", () => {
    const timeline = projectCooldownReplayFromDigest(
      digest({
        utility: {
          actions: [],
          hostileCastEvents: [
            { eventId: "early", fightOffsetMs: 5_000, sourceActorId: 80 },
            { eventId: "late", fightOffsetMs: 40_000, sourceActorId: 41 },
          ],
        },
        hostileActors: [
          { id: 80, name: "Loom'ithar", type: "NPC", subType: "Boss" },
          { id: 41, name: "Trash", type: "NPC", subType: "NPC" },
        ],
      }),
    );
    expect(timeline.segments?.[0]?.bossName).toBe("Loom'ithar");
    expect(timeline.segments?.[1]?.bossName).toBeNull();
  });

  it("marks Self only when targetActorId equals the participant", () => {
    const timeline = projectCooldownReplayFromDigest(
      digest({
        participantActorId: 10,
        offensive: {
          offensiveActivations: [
            { primarySpellId: 265187, fightOffsetMs: 47_000, canonicalKey: "warlock.offensive.demonic-tyrant", targetActorId: 10 },
            { primarySpellId: 1, fightOffsetMs: 48_000, canonicalKey: "x", targetActorId: 11 },
            { primarySpellId: 2, fightOffsetMs: 49_000, canonicalKey: "y" },
          ],
        },
        hostileActors: [
          { id: 10, name: "Subject", type: "Player", subType: "Warlock", server: "Archimonde" },
          { id: 11, name: "Ally", type: "Player", subType: "Paladin", server: "Archimonde" },
        ],
      }),
    );
    expect(timeline.events[0]?.target).toMatchObject({ kind: "SELF", name: null, classSlug: null });
    expect(timeline.events[1]?.target).toMatchObject({
      kind: "FRIENDLY_PLAYER",
      name: "Ally",
      classSlug: "paladin",
    });
    expect(timeline.events[1]?.target?.name).not.toContain("Archimonde");
    expect(timeline.events[2]?.target).toBeNull();
  });

  it("projects friendly Warlock nickname and Demon Hunter classSlug from WCL subType", () => {
    const timeline = projectCooldownReplayFromDigest(
      digest({
        participantActorId: 1,
        utility: {
          actions: [
            {
              canonicalActionId: "kick",
              utilityCategory: "INTERRUPT",
              primarySpellId: 1766,
              canonicalName: "Kick",
              fightOffsetMs: 12_000,
              targetActorId: 22,
            },
            {
              canonicalActionId: "cc",
              utilityCategory: "CROWD_CONTROL",
              primarySpellId: 2094,
              canonicalName: "Blind",
              fightOffsetMs: 13_000,
              targetActorId: 33,
            },
          ],
        },
        hostileActors: [
          { id: 22, name: "Locky", type: "Player", subType: "Warlock", server: "Illidan" },
          { id: 33, name: "Havoc", type: "Player", subType: "DemonHunter", server: "Illidan" },
        ],
      }),
    );
    expect(timeline.events[0]?.target).toMatchObject({
      kind: "FRIENDLY_PLAYER",
      name: "Locky",
      classSlug: "warlock",
    });
    expect(timeline.events[1]?.target).toMatchObject({
      kind: "FRIENDLY_PLAYER",
      name: "Havoc",
      classSlug: "demon-hunter",
    });
  });

  it("projects hostile NPC name without a fabricated portrait", () => {
    const timeline = projectCooldownReplayFromDigest(
      digest({
        utility: {
          actions: [
            {
              canonicalActionId: "kick",
              utilityCategory: "INTERRUPT",
              primarySpellId: 1766,
              canonicalName: "Kick",
              fightOffsetMs: 20_000,
              targetActorId: 80,
            },
          ],
        },
        hostileActors: [{ id: 80, name: "Loom'ithar", type: "NPC", subType: "Boss" }],
      }),
    );
    expect(timeline.events[0]?.target).toEqual({
      kind: "HOSTILE",
      name: "Loom'ithar",
      classSlug: null,
      iconName: null,
      portraitUrl: null,
    });
    expect(timeline.segments?.every((segment) => segment.bossPortraitUrl == null)).toBe(true);
  });

  it("projects party deaths with nickname and class, never Self or cooldown fields", () => {
    const timeline = projectCooldownReplayFromDigest(
      digest({
        participantActorId: 10,
        partyDeaths: [
          {
            deathEventId: "d1",
            participantActorId: 10,
            fightOffsetMs: 55_000,
            killingAbilitySpellId: 123,
            killingAbilityName: "Smash",
          },
          {
            deathEventId: "d2",
            participantActorId: 11,
            fightOffsetMs: 56_000,
          },
        ],
        hostileActors: [
          { id: 10, name: "Subject", type: "Player", subType: "Warlock", server: "Archimonde" },
          { id: 11, name: "Ally", type: "Player", subType: "Paladin", server: "Archimonde" },
        ],
      }),
    );
    const deaths = timeline.events.filter((event) => event.kind === "DEATH");
    expect(deaths).toHaveLength(2);
    expect(deaths[0]).toEqual({
      kind: "DEATH",
      timestampMs: 55_000,
      playerName: "Subject",
      classSlug: "warlock",
      segmentIndex: null,
    });
    expect(deaths[1]).toMatchObject({
      kind: "DEATH",
      playerName: "Ally",
      classSlug: "paladin",
    });
    expect(deaths[1]?.playerName).not.toContain("Archimonde");
    expect(JSON.stringify(deaths[0])).not.toContain("abilityId");
    expect(JSON.stringify(deaths[0])).not.toContain("SELF");
  });

  it("uses survival.deaths when partyDeaths is an empty array", () => {
    const timeline = projectCooldownReplayFromDigest(
      digest({
        participantActorId: 10,
        partyDeaths: [],
        survival: {
          personalDefensiveActivations: [],
          recoveryActivations: [],
          fightDurationMs: 600_000,
          deaths: [
            {
              deathEventId: "self-death",
              participantActorId: 10,
              fightOffsetMs: 12_000,
            },
          ],
        },
        hostileActors: [{ id: 10, name: "Subject", type: "Player", subType: "Warrior" }],
      }),
    );
    expect(timeline.events.filter((event) => event.kind === "DEATH")).toHaveLength(1);
  });

  it("projects a death without masterData when the digest roster names the player", () => {
    const timeline = projectCooldownReplayFromDigest(
      digest({
        participantActorId: 10,
        partyDeaths: [
          {
            deathEventId: "d-roster",
            participantActorId: 11,
            fightOffsetMs: 8_000,
          },
        ],
        partyRoster: [{ participantActorId: 11, name: "Ally", classSlug: "paladin" }],
        hostileActors: [],
      }),
    );
    expect(timeline.events.filter((event) => event.kind === "DEATH")[0]).toEqual({
      kind: "DEATH",
      timestampMs: 8_000,
      playerName: "Ally",
      classSlug: "paladin",
      segmentIndex: null,
    });
  });

  it("keeps deaths that land after fightDurationMs", () => {
    const timeline = projectCooldownReplayFromDigest(
      digest({
        partyDeaths: [
          {
            deathEventId: "late",
            participantActorId: 10,
            fightOffsetMs: 601_000,
          },
        ],
        hostileActors: [{ id: 10, name: "Subject", type: "Player", subType: "Warrior" }],
      }),
    );
    expect(timeline.events.filter((event) => event.kind === "DEATH")).toHaveLength(1);
  });

  it("excludes hostile NPC, boss, pet, guardian, and Environment deaths", () => {
    const timeline = projectCooldownReplayFromDigest(
      digest({
        partyDeaths: [
          { deathEventId: "npc", participantActorId: 80, fightOffsetMs: 10_000 },
          { deathEventId: "boss", participantActorId: 81, fightOffsetMs: 11_000 },
          { deathEventId: "pet", participantActorId: 82, fightOffsetMs: 12_000 },
          { deathEventId: "guard", participantActorId: 83, fightOffsetMs: 13_000 },
          { deathEventId: "env", participantActorId: 84, fightOffsetMs: 14_000 },
        ],
        hostileActors: [
          { id: 80, name: "Trash", type: "NPC", subType: "NPC" },
          { id: 81, name: "Loom'ithar", type: "NPC", subType: "Boss" },
          { id: 82, name: "Imp", type: "Pet", petOwner: 10 },
          { id: 83, name: "Guardian", type: "Guardian", petOwner: 10 },
          { id: 84, name: "Environment", type: "NPC" },
        ],
      }),
    );
    expect(timeline.events.filter((event) => event.kind === "DEATH")).toHaveLength(0);
  });

  it("keeps two deaths for the same player at different timestamps", () => {
    const timeline = projectCooldownReplayFromDigest(
      digest({
        partyDeaths: [
          { deathEventId: "a", participantActorId: 10, fightOffsetMs: 10_000 },
          { deathEventId: "b", participantActorId: 10, fightOffsetMs: 40_000 },
        ],
        hostileActors: [{ id: 10, name: "Subject", type: "Player", subType: "Warrior" }],
      }),
    );
    expect(timeline.events.filter((event) => event.kind === "DEATH")).toHaveLength(2);
  });

  it("deduplicates the same deathEventId", () => {
    const timeline = projectCooldownReplayFromDigest(
      digest({
        partyDeaths: [
          { deathEventId: "same", participantActorId: 10, fightOffsetMs: 10_000 },
          { deathEventId: "same", participantActorId: 10, fightOffsetMs: 10_000 },
        ],
        hostileActors: [{ id: 10, name: "Subject", type: "Player", subType: "Warrior" }],
      }),
    );
    expect(timeline.events.filter((event) => event.kind === "DEATH")).toHaveLength(1);
  });

  it("assigns segmentIndex from existing pulls and leaves outside-pull deaths null", () => {
    const timeline = projectCooldownReplayFromDigest(
      digest({
        partyDeaths: [
          { deathEventId: "in", participantActorId: 10, fightOffsetMs: 36_000 },
          { deathEventId: "out", participantActorId: 10, fightOffsetMs: 5_000 },
        ],
        utility: {
          actions: [],
          hostileCastEvents: [
            { eventId: "h1", fightOffsetMs: 30_000, sourceActorId: 80 },
            { eventId: "h2", fightOffsetMs: 40_000, sourceActorId: 80 },
          ],
        },
        hostileActors: [
          { id: 10, name: "Subject", type: "Player", subType: "Warrior" },
          { id: 80, name: "Loom'ithar", type: "NPC", subType: "Boss" },
        ],
      }),
    );
    const deaths = timeline.events.filter((event) => event.kind === "DEATH");
    expect(deaths.find((event) => event.timestampMs === 36_000)?.segmentIndex).toBe(1);
    expect(deaths.find((event) => event.timestampMs === 5_000)?.segmentIndex).toBeNull();
  });

  it("orders a same-timestamp cooldown before a death", () => {
    const timeline = projectCooldownReplayFromDigest(
      digest({
        offensive: {
          offensiveActivations: [
            { primarySpellId: 265187, fightOffsetMs: 20_000, canonicalKey: "warlock.offensive.demonic-tyrant" },
          ],
        },
        partyDeaths: [{ deathEventId: "d", participantActorId: 10, fightOffsetMs: 20_000 }],
        hostileActors: [{ id: 10, name: "Subject", type: "Player", subType: "Warlock" }],
      }),
    );
    expect(timeline.events.map((event) => event.kind)).toEqual(["COOLDOWN", "DEATH"]);
  });
});
