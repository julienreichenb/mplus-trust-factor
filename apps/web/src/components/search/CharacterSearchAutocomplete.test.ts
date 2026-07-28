import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import CharacterSearchAutocomplete from "./CharacterSearchAutocomplete.vue";
import SelectedRunsSection from "../profile/SelectedRunsSection.vue";
import { routeDefs } from "../../routes";
import { aleriaScoringRunSelection } from "../../api/mock/fixtures";

describe("CharacterSearchAutocomplete", () => {
  it("renders a single combobox input", async () => {
    setActivePinia(createPinia());
    const router = createRouter({ history: createMemoryHistory(), routes: routeDefs });
    await router.push("/");
    await router.isReady();

    const wrapper = mount(CharacterSearchAutocomplete, {
      global: { plugins: [router] },
    });

    expect(wrapper.find("[data-testid='character-autocomplete-input']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='realm-input']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='name-input']").exists()).toBe(false);
  });
});

describe("SelectedRunsSection", () => {
  it("renders eight dungeon slots from the shared contract", () => {
    const wrapper = mount(SelectedRunsSection, {
      props: { selection: aleriaScoringRunSelection },
    });
    expect(wrapper.get("[data-testid='selected-runs-panel']").text()).toContain("Priory of the Sacred Flame");
    expect(wrapper.findAll(".run-card")).toHaveLength(8);
    expect(wrapper.text()).not.toContain("Analyzed runs");
  });
});
