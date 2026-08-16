import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import SelectedRunsSection from "./SelectedRunsSection.vue";
import { aleriaScoringRunSelection } from "../../api/mock/fixtures";

describe("SelectedRunsSection affordance", () => {
  it("renders the dungeon click hint and interactive cards", async () => {
    const wrapper = mount(SelectedRunsSection, {
      props: {
        selection: aleriaScoringRunSelection,
        canonicalDungeonEvidence: [
          {
            dungeonSlug: aleriaScoringRunSelection.selectedRuns[0]!.dungeonSlug,
            dungeonName: aleriaScoringRunSelection.selectedRuns[0]!.dungeonName,
            reports: [
              {
                identity: "PRIMARY",
                keyLevel: 12,
                completedAt: "2026-01-01T00:00:00.000Z",
                wclUrl: "https://www.warcraftlogs.com/reports/ABC?fight=1",
                cooldownTimeline: {
                  status: "AVAILABLE",
                  durationMs: 120000,
                  events: [
                    {
                      kind: "COOLDOWN",
                      timestampMs: 1000,
                      dimension: "PERFORMANCE",
                      type: "offensive cooldown",
                      abilityId: 1,
                      abilityName: "Avatar",
                      iconUrl: null,
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    });
    expect(wrapper.text()).toContain("Click a dungeon to inspect cooldown usage");
    const card = wrapper.findAll(".run-card").find((node) => node.attributes("data-missing") === "false");
    expect(card?.attributes("role")).toBe("button");
    expect(card?.attributes("tabindex")).toBe("0");
    await card!.trigger("click");
    expect(wrapper.emitted("openRun")).toHaveLength(1);
    expect(wrapper.emitted("openRun")?.[0]?.[0]).toMatchObject({
      identity: "PRIMARY",
      cooldownTimeline: {
        status: "AVAILABLE",
        durationMs: 120000,
      },
    });
  });

  it("does not open the drawer when the nested Warcraft Logs link is clicked", async () => {
    const first = aleriaScoringRunSelection.selectedRuns.find((run) => run.canonicalRunId);
    const wrapper = mount(SelectedRunsSection, {
      props: {
        selection: {
          ...aleriaScoringRunSelection,
          selectedRuns: [first!],
        },
        canonicalDungeonEvidence: [
          {
            dungeonSlug: first!.dungeonSlug,
            dungeonName: first!.dungeonName,
            reports: [
              {
                identity: "PRIMARY",
                keyLevel: first!.keyLevel,
                completedAt: first!.completedAt,
                wclUrl: "https://www.warcraftlogs.com/reports/ABC?fight=1",
              },
            ],
          },
        ],
      },
    });
    await wrapper.get("[data-testid='run-card-wcl-link']").trigger("click");
    expect(wrapper.emitted("openRun")).toBeUndefined();
  });
});
