import { describe, expect, it } from "vitest";
import { rule, ALL_ROLES } from "../catalog/rule.js";
import {
  classifyActivationSignal,
  projectSurvivalActivations,
} from "./activation.js";

const ams = rule({
  canonicalKey: "death-knight.defensive-major.anti-magic-shell",
  name: "Anti-Magic Shell",
  spellIds: [48707],
  activationSpellIds: [48707],
  activationBuffIds: [48707],
  triggeredEffectIds: [444741],
  activationSource: "PLAYER_CAST",
  activationEventTypes: ["cast"],
  activationEffectDurationMs: 8_000,
  classSlug: "death-knight",
  roles: ALL_ROLES,
  category: "DEFENSIVE_MAJOR",
  cooldownSeconds: 60,
});

const barkskin = rule({
  canonicalKey: "druid.defensive-minor.barkskin",
  name: "Barkskin",
  spellIds: [22812],
  classSlug: "druid",
  roles: ALL_ROLES,
  category: "DEFENSIVE_MINOR",
  cooldownSeconds: 60,
});

const healthstone = rule({
  canonicalKey: "shared.consumable.healthstone",
  name: "Healthstone",
  spellIds: [6262],
  aliases: [452930],
  activationSpellIds: [6262, 452930],
  activationSource: "ITEM_CAST",
  activationEventTypes: ["cast"],
  classSlug: null,
  roles: ALL_ROLES,
  category: "CONSUMABLE",
  availability: "SHARED",
});

const ironbark = rule({
  canonicalKey: "druid.external-defensive.ironbark",
  name: "Ironbark",
  spellIds: [102342],
  classSlug: "druid",
  roles: ["HEALER"],
  category: "EXTERNAL_DEFENSIVE",
  cooldownSeconds: 90,
});

const auraOnly = rule({
  canonicalKey: "test.defensive.aura-only",
  name: "Aura Only",
  spellIds: [999001],
  activationSource: "PLAYER_BUFF",
  activationEventTypes: ["applybuff"],
  classSlug: "warrior",
  roles: ALL_ROLES,
  category: "DEFENSIVE_MINOR",
  cooldownSeconds: 30,
});

describe("survival activation projection", () => {
  it("cast + repeated applybuff/refresh produce one activation", () => {
    const projection = projectSurvivalActivations({
      rules: [barkskin],
      events: [
        {
          eventId: "c1",
          timestampMs: 1000,
          eventType: "cast",
          spellId: 22812,
          canonicalKey: barkskin.canonicalKey,
          sourceOwnerPlayerActorId: 10,
          sourceActorId: 10,
        },
        {
          eventId: "b1",
          timestampMs: 1050,
          eventType: "applybuff",
          spellId: 22812,
          canonicalKey: barkskin.canonicalKey,
          sourceOwnerPlayerActorId: 10,
          sourceActorId: 10,
        },
        {
          eventId: "r1",
          timestampMs: 2000,
          eventType: "refreshbuff",
          spellId: 22812,
          canonicalKey: barkskin.canonicalKey,
          sourceOwnerPlayerActorId: 10,
          sourceActorId: 10,
        },
      ],
    });
    expect(projection.deduplicatedActivationCount).toBe(1);
  });

  it("absorb/tick alias updates do not open activations", () => {
    expect(
      classifyActivationSignal({
        rule: ams,
        eventType: "applybuff",
        spellId: 444741,
      }),
    ).toBe("CORRELATE");
    const projection = projectSurvivalActivations({
      rules: [ams],
      events: [
        {
          eventId: "c1",
          timestampMs: 1000,
          eventType: "cast",
          spellId: 48707,
          canonicalKey: ams.canonicalKey,
          sourceOwnerPlayerActorId: 39,
          sourceActorId: 39,
        },
        {
          eventId: "p1",
          timestampMs: 5000,
          eventType: "applybuff",
          spellId: 444741,
          canonicalKey: ams.canonicalKey,
          sourceOwnerPlayerActorId: 39,
          sourceActorId: 59,
        },
        {
          eventId: "p2",
          timestampMs: 12000,
          eventType: "applybuff",
          spellId: 444741,
          canonicalKey: ams.canonicalKey,
          sourceOwnerPlayerActorId: 39,
          sourceActorId: 60,
        },
      ],
    });
    expect(projection.deduplicatedActivationCount).toBe(1);
  });

  it("two genuine uses separated in time remain two activations", () => {
    const projection = projectSurvivalActivations({
      rules: [barkskin],
      events: [
        {
          eventId: "c1",
          timestampMs: 1000,
          eventType: "cast",
          spellId: 22812,
          canonicalKey: barkskin.canonicalKey,
          sourceOwnerPlayerActorId: 10,
          sourceActorId: 10,
        },
        {
          eventId: "c2",
          timestampMs: 70_000,
          eventType: "cast",
          spellId: 22812,
          canonicalKey: barkskin.canonicalKey,
          sourceOwnerPlayerActorId: 10,
          sourceActorId: 10,
        },
      ],
    });
    expect(projection.deduplicatedActivationCount).toBe(2);
  });

  it("aura-only defensives open on the first valid applybuff", () => {
    const projection = projectSurvivalActivations({
      rules: [auraOnly],
      events: [
        {
          eventId: "b1",
          timestampMs: 1000,
          eventType: "applybuff",
          spellId: 999001,
          canonicalKey: auraOnly.canonicalKey,
          sourceOwnerPlayerActorId: 10,
          sourceActorId: 10,
        },
        {
          eventId: "r1",
          timestampMs: 1500,
          eventType: "refreshbuff",
          spellId: 999001,
          canonicalKey: auraOnly.canonicalKey,
          sourceOwnerPlayerActorId: 10,
          sourceActorId: 10,
        },
      ],
    });
    expect(projection.deduplicatedActivationCount).toBe(1);
  });

  it("consumable cast + heal/buff evidence merges into one use", () => {
    const projection = projectSurvivalActivations({
      rules: [healthstone],
      events: [
        {
          eventId: "c1",
          timestampMs: 1000,
          eventType: "cast",
          spellId: 452930,
          canonicalKey: healthstone.canonicalKey,
          sourceOwnerPlayerActorId: 10,
          sourceActorId: 10,
        },
        {
          eventId: "b1",
          timestampMs: 1100,
          eventType: "applybuff",
          spellId: 452930,
          canonicalKey: healthstone.canonicalKey,
          sourceOwnerPlayerActorId: 10,
          sourceActorId: 10,
        },
      ],
    });
    expect(projection.deduplicatedActivationCount).toBe(1);
    expect(projection.activations[0]?.primarySpellId).toBe(6262);
  });

  it("external received aura updates merge per recipient", () => {
    const projection = projectSurvivalActivations({
      rules: [ironbark],
      events: [
        {
          eventId: "c1",
          timestampMs: 1000,
          eventType: "cast",
          spellId: 102342,
          canonicalKey: ironbark.canonicalKey,
          sourceOwnerPlayerActorId: 12,
          sourceActorId: 12,
          targetPlayerActorId: 10,
        },
        {
          eventId: "b1",
          timestampMs: 1050,
          eventType: "applybuff",
          spellId: 102342,
          canonicalKey: ironbark.canonicalKey,
          sourceOwnerPlayerActorId: 12,
          sourceActorId: 12,
          targetPlayerActorId: 10,
        },
        {
          eventId: "c2",
          timestampMs: 1200,
          eventType: "cast",
          spellId: 102342,
          canonicalKey: ironbark.canonicalKey,
          sourceOwnerPlayerActorId: 12,
          sourceActorId: 12,
          targetPlayerActorId: 11,
        },
        {
          eventId: "b2",
          timestampMs: 1250,
          eventType: "applybuff",
          spellId: 102342,
          canonicalKey: ironbark.canonicalKey,
          sourceOwnerPlayerActorId: 12,
          sourceActorId: 12,
          targetPlayerActorId: 11,
        },
      ],
    });
    expect(projection.deduplicatedActivationCount).toBe(2);
  });

  it("alias / triggered IDs map to canonical key without multiplying uses", () => {
    const projection = projectSurvivalActivations({
      rules: [ams],
      events: [
        {
          eventId: "c1",
          timestampMs: 1000,
          eventType: "cast",
          spellId: 48707,
          canonicalKey: ams.canonicalKey,
          sourceOwnerPlayerActorId: 39,
          sourceActorId: 39,
        },
        {
          eventId: "b1",
          timestampMs: 1020,
          eventType: "applybuff",
          spellId: 48707,
          canonicalKey: ams.canonicalKey,
          sourceOwnerPlayerActorId: 39,
          sourceActorId: 39,
        },
        {
          eventId: "t1",
          timestampMs: 1100,
          eventType: "applybuff",
          spellId: 444741,
          canonicalKey: ams.canonicalKey,
          sourceOwnerPlayerActorId: 39,
          sourceActorId: 59,
        },
      ],
    });
    expect(projection.deduplicatedActivationCount).toBe(1);
    expect(projection.activations[0]?.primarySpellId).toBe(48707);
    expect(projection.activations[0]?.contributingSpellIds).toEqual([
      48707, 48707, 444741,
    ]);
  });
});
