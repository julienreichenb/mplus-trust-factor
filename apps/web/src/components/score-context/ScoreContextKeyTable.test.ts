import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import ScoreContextKeyTable from "./ScoreContextKeyTable.vue";

describe("ScoreContextKeyTable", () => {
  it("renders read-only factors as values and keeps unavailable explicit", () => {
    const unavailable = mount(ScoreContextKeyTable, {
      props: { rows: [], unavailable: true, readOnly: true },
    });
    expect(unavailable.find("[data-testid='missing-distribution']").exists()).toBe(true);

    const wrapper = mount(ScoreContextKeyTable, {
      props: {
        unavailable: false,
        readOnly: true,
        rows: [
          {
            percentileBps: 9000,
            percentileLabel: "P90",
            factor: 1.05,
            thresholds: { EU: 12, US: 11, KR: null, TW: 10 },
          },
        ],
      },
    });
    expect(wrapper.get("[data-testid='key-factor-9000']").text()).toContain("×1.05");
    expect(wrapper.find("input").exists()).toBe(false);
    expect(wrapper.get("[data-testid='anchor-threshold-KR']").text()).toBe("—");
  });
});
