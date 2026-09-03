import { describe, expect, it, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import CooldownReplayTimeline from "./CooldownReplayTimeline.vue";
import type { RunCooldownEventPublicDTO } from "@mplus/contracts";
import * as spellIcons from "../../integrations/wowhead/spellIcons";
import { WOW_ICON_FALLBACK_DATA_URI, classIconName } from "../../lib/wowIcons";
import { classColor } from "../../lib/wowClass";
import SpellWowIcon from "../ability-catalog/SpellWowIcon.vue";
import DimensionAxisIcon from "../charts/DimensionAxisIcon.vue";

const fixtureEvents: RunCooldownEventPublicDTO[] = [
  {
    kind: "COOLDOWN",
    timestampMs: 19_000,
    dimension: "UTILITY",
    type: "utility",
    abilityId: 111771,
    abilityName: "Demonic Gateway",
    iconName: null,
    iconUrl: null,
    segmentIndex: null,
  },
  {
    kind: "COOLDOWN",
    timestampMs: 36_000,
    dimension: "UTILITY",
    type: "crowd control",
    abilityId: 1714,
    abilityName: "Curse of Tongues",
    iconName: null,
    iconUrl: null,
    segmentIndex: 1,
  },
  {
    kind: "COOLDOWN",
    timestampMs: 43_000,
    dimension: "SURVIVAL",
    type: "defensive cooldown",
    abilityId: 108416,
    abilityName: "Dark Pact",
    iconName: null,
    iconUrl: null,
    segmentIndex: 1,
  },
  {
    kind: "COOLDOWN",
    timestampMs: 47_000,
    dimension: "PERFORMANCE",
    type: "offensive cooldown",
    abilityId: 265187,
    abilityName: "Summon Demonic Tyrant",
    iconName: null,
    iconUrl: null,
    segmentIndex: 1,
  },
];

describe("CooldownReplayTimeline", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows unavailable when no persisted digest exists", () => {
    const wrapper = mount(CooldownReplayTimeline);
    expect(wrapper.find("[data-testid='cooldown-timeline-empty']").exists()).toBe(true);
    expect(wrapper.text()).toContain("Cooldown replay unavailable for this run.");
    expect(wrapper.findAll(".event")).toHaveLength(0);
  });

  it("shows empty tracked-events copy when the digest has no activations", () => {
    const wrapper = mount(CooldownReplayTimeline, {
      props: { timeline: { status: "EMPTY", durationMs: 180_000, events: [] } },
    });
    expect(wrapper.find("[data-testid='cooldown-timeline-empty-tracked']").exists()).toBe(true);
    expect(wrapper.text()).toContain("No tracked uptime evidence for this run.");
    expect(wrapper.findAll(".event")).toHaveLength(0);
  });

  it("renders glyphs, SpellWowIcon, pull groups, and filters events not lanes", async () => {
    vi.spyOn(spellIcons, "resolveWowheadSpellIconName").mockResolvedValue("inv_misc_questionmark");
    const wrapper = mount(CooldownReplayTimeline, {
      props: {
        timeline: {
          status: "AVAILABLE",
          durationMs: 180_000,
          events: fixtureEvents,
          segments: [{ index: 1, startMs: 30_000, endMs: 60_000, bossName: "Loom'ithar", bossPortraitUrl: null }],
        },
      },
    });
    await flushPromises();
    expect(wrapper.find("[data-testid='cooldown-vertical-axis']").exists()).toBe(true);
    expect(wrapper.findComponent(SpellWowIcon).exists()).toBe(true);
    expect(wrapper.findAllComponents(DimensionAxisIcon).length).toBeGreaterThan(3);
    expect(wrapper.text()).toContain("Between pulls");
    expect(wrapper.text()).toContain("Pull 1 · Loom'ithar");
    expect(wrapper.find("[data-testid='cooldown-boss-portrait']").exists()).toBe(false);
    expect(wrapper.text()).toContain("Summon Demonic Tyrant");
    expect(wrapper.text()).not.toContain("warlock.offensive.demonic-tyrant");
    expect(wrapper.get("[data-testid='cooldown-filter-P']").text()).not.toContain("[P]");
    expect(wrapper.html()).not.toContain("warcraftlogs.com");
    await wrapper.get("[data-testid='cooldown-filter-P']").trigger("click");
    expect(wrapper.text()).not.toContain("Summon Demonic Tyrant");
    expect(wrapper.find("[data-testid='cooldown-pull-1']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='cooldown-lane-P']").exists()).toBe(false);
  });

  it("uses the existing WowIcon fallback when Wowhead resolution fails", async () => {
    vi.spyOn(spellIcons, "resolveWowheadSpellIconName").mockResolvedValue(null);
    const wrapper = mount(CooldownReplayTimeline, {
      props: {
        timeline: {
          status: "AVAILABLE",
          durationMs: 180_000,
          events: [fixtureEvents[3]!],
          segments: [{ index: 1, startMs: 40_000, endMs: 60_000 }],
        },
      },
    });
    await flushPromises();
    expect(wrapper.get("[data-testid='wow-icon']").attributes("src")).toBe(WOW_ICON_FALLBACK_DATA_URI);
  });

  it("keeps the boss name when no portrait URL exists", () => {
    const wrapper = mount(CooldownReplayTimeline, {
      props: {
        timeline: {
          status: "AVAILABLE",
          durationMs: 180_000,
          events: [{ ...fixtureEvents[3]!, segmentIndex: 6 }],
          segments: [
            {
              index: 6,
              startMs: 40_000,
              endMs: 60_000,
              bossName: "Loom'ithar",
              bossPortraitUrl: null,
            },
          ],
        },
      },
    });
    expect(wrapper.text()).toContain("Pull 6 · Loom'ithar");
    expect(wrapper.find("[data-testid='cooldown-boss-portrait']").exists()).toBe(false);
  });

  it("places Self and class-colored friendly names at the far right", async () => {
    vi.spyOn(spellIcons, "resolveWowheadSpellIconName").mockResolvedValue("inv_misc_questionmark");
    const wrapper = mount(CooldownReplayTimeline, {
      props: {
        timeline: {
          status: "AVAILABLE",
          durationMs: 180_000,
          events: [
            {
              ...fixtureEvents[3]!,
              target: {
                kind: "SELF",
                name: null,
                classSlug: null,
                iconName: null,
                portraitUrl: null,
              },
            },
            {
              ...fixtureEvents[0]!,
              timestampMs: 20_000,
              target: {
                kind: "FRIENDLY_PLAYER",
                name: "Locky",
                classSlug: "warlock",
                iconName: null,
                portraitUrl: null,
              },
            },
            {
              ...fixtureEvents[1]!,
              target: {
                kind: "FRIENDLY_PLAYER",
                name: "Havoc",
                classSlug: "demon-hunter",
                iconName: null,
                portraitUrl: null,
              },
            },
          ],
          segments: [{ index: 1, startMs: 30_000, endMs: 60_000 }],
        },
      },
    });
    await flushPromises();
    expect(wrapper.text()).toContain("Self");
    expect(wrapper.text()).toContain("Locky");
    expect(wrapper.text()).not.toContain("Archimonde");
    expect(wrapper.get('[data-class-slug="warlock"]').text()).toContain("Locky");
    expect(wrapper.get('[data-class-slug="warlock"] .target-player__name').attributes("style")).toMatch(
      /135,\s*136,\s*238|#8788EE/i,
    );
    expect(wrapper.get('[data-class-slug="demon-hunter"] .target-player__name').attributes("style")).toMatch(
      /163,\s*48,\s*201|#A330C9/i,
    );
    expect(classColor("warlock")).toBe("#8788EE");
    expect(classColor("demon-hunter")).toBe("#A330C9");
    expect(classIconName("warlock")).toBe("classicon_warlock");
    expect(wrapper.find(".event").classes()).toContain("event");
    expect(wrapper.find(".event__dim").exists()).toBe(true);
  });

  it("shows boss jump chips and masks deaths when the death filter is off", async () => {
    const wrapper = mount(CooldownReplayTimeline, {
      props: {
        timeline: {
          status: "AVAILABLE",
          durationMs: 180_000,
          events: [
            fixtureEvents[3]!,
            {
              kind: "DEATH",
              timestampMs: 50_000,
              playerName: "Ally",
              classSlug: "paladin",
              segmentIndex: 1,
            },
          ],
          segments: [
            { index: 1, startMs: 30_000, endMs: 60_000, bossName: "Loom'ithar", bossPortraitUrl: null },
            { index: 6, startMs: 90_000, endMs: 110_000, bossName: "Loom'ithar", bossPortraitUrl: null },
          ],
        },
      },
    });
    expect(wrapper.find("[data-testid='death-glyph-icon']").exists()).toBe(true);
    expect(wrapper.get("[data-testid='cooldown-filter-D']").attributes("aria-pressed")).toBe("true");
    expect(wrapper.get("[data-testid='cooldown-filter-D']").text()).toMatch(/Deaths\s*1/);
    expect(wrapper.get("[data-testid='cooldown-boss-chip-1']").text()).toContain("Loom'ithar");
    expect(wrapper.find("[data-testid='cooldown-boss-chip-6']").exists()).toBe(false);
    expect(wrapper.text()).toContain("Ally");
    expect(wrapper.find(".event__time").exists()).toBe(true);
    await wrapper.get("[data-testid='cooldown-filter-D']").trigger("click");
    expect(wrapper.text()).not.toContain("Ally");
    expect(wrapper.text()).toContain("Summon Demonic Tyrant");
    expect(wrapper.find("[data-testid='cooldown-pull-1']").exists()).toBe(true);
  });

  it("keeps deaths when Survival is off and hides empty pulls when only deaths are filtered out", async () => {
    const wrapper = mount(CooldownReplayTimeline, {
      props: {
        timeline: {
          status: "AVAILABLE",
          durationMs: 180_000,
          events: [
            {
              kind: "DEATH",
              timestampMs: 12_000,
              playerName: "Wallidrixe",
              classSlug: "warlock",
              segmentIndex: null,
            },
            {
              kind: "DEATH",
              timestampMs: 50_000,
              playerName: "Ally",
              classSlug: "paladin",
              segmentIndex: 2,
            },
            fixtureEvents[2]!,
          ],
          segments: [
            { index: 1, startMs: 30_000, endMs: 40_000, bossName: "Empty" },
            { index: 2, startMs: 45_000, endMs: 60_000, bossName: "Loom'ithar" },
          ],
        },
      },
    });
    expect(wrapper.text()).toContain("Wallidrixe died");
    expect(wrapper.text()).not.toContain("Self died");
    expect(wrapper.get("[data-testid='cooldown-event-DEATH']").html()).toContain("rgb(135, 136, 238)");
    expect(wrapper.find("[data-testid='cooldown-between-pulls']").text()).toContain("Wallidrixe");
    await wrapper.get("[data-testid='cooldown-filter-S']").trigger("click");
    expect(wrapper.text()).toContain("Wallidrixe died");
    await wrapper.get("[data-testid='cooldown-filter-S']").trigger("click");
    await wrapper.get("[data-testid='cooldown-filter-D']").trigger("click");
    expect(wrapper.find("[data-testid='cooldown-pull-2']").exists()).toBe(false);
    expect(wrapper.text()).toContain("Dark Pact");
  });
});
