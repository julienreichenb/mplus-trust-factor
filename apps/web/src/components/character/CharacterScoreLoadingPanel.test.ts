import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import CharacterScoreLoadingPanel from "./CharacterScoreLoadingPanel.vue";

describe("CharacterScoreLoadingPanel", () => {
  it("renders calculating skeletons without Unavailable score copy", () => {
    const wrapper = mount(CharacterScoreLoadingPanel, {
      props: { phase: "calculating" },
    });
    expect(wrapper.attributes("data-phase")).toBe("calculating");
    expect(wrapper.text()).toContain("Calculating Trust Score");
    expect(wrapper.text()).not.toContain("Unavailable");
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(true);
    expect(wrapper.attributes("aria-busy")).toBe("true");
  });

  it("renders terminal failure with retry", async () => {
    const wrapper = mount(CharacterScoreLoadingPanel, {
      props: { phase: "failed" },
    });
    expect(wrapper.text()).toContain("Calculation failed");
    await wrapper.get("[data-testid='character-score-loading-retry']").trigger("click");
    expect(wrapper.emitted("retry")).toBeTruthy();
  });

  it("renders timeout with retry", () => {
    const wrapper = mount(CharacterScoreLoadingPanel, {
      props: { phase: "timed_out" },
    });
    expect(wrapper.text()).toContain("timed out");
    expect(wrapper.find("[data-testid='character-score-loading-retry']").exists()).toBe(true);
  });
});
