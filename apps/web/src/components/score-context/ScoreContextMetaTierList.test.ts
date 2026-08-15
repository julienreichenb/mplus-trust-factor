import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ScoreContextMetaTierList from "./ScoreContextMetaTierList.vue";

const classes = [
  {
    slug: "warrior",
    name: "Warrior",
    specs: [{ slug: "protection", name: "Protection", role: "TANK" }],
  },
];

describe("ScoreContextMetaTierList", () => {
  it("renders read-only factors as values without drag inputs", () => {
    const wrapper = mount(ScoreContextMetaTierList, {
      props: {
        classes,
        assignments: [{ classSlug: "warrior", specSlug: "protection", tier: 5 }],
        tierFactors: { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1.1 } as Record<1 | 2 | 3 | 4 | 5, number>,
        readOnly: true,
      },
    });
    expect(wrapper.get("[data-testid='tier-factor-5']").text()).toContain("×1.10");
    expect(wrapper.find("input").exists()).toBe(false);
    expect(wrapper.get("[data-testid='spec-warrior-protection']").attributes("draggable")).toBe("false");
  });

  it("reads published factors when JSON keys are strings", () => {
    const wrapper = mount(ScoreContextMetaTierList, {
      props: {
        classes,
        assignments: [],
        tierFactors: { "1": 0.9, "2": 0.95, "3": 1, "4": 1.05, "5": 1.15 } as unknown as Record<
          1 | 2 | 3 | 4 | 5,
          number
        >,
        readOnly: true,
      },
    });
    expect(wrapper.get("[data-testid='tier-factor-5']").text()).toContain("×1.15");
    expect(wrapper.get("[data-testid='tier-factor-1']").text()).toContain("×0.90");
  });
});
