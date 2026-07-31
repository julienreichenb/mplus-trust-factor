import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import DisclosureChevron from "./DisclosureChevron.vue";
import IconSelect from "./IconSelect.vue";
import ValidationIssuesPanel from "./ValidationIssuesPanel.vue";

describe("DisclosureChevron", () => {
  it("renders an SVG chevron without text glyph fallback", () => {
    const wrapper = mount(DisclosureChevron, { props: { expanded: false } });
    expect(wrapper.find("[data-testid='disclosure-chevron']").exists()).toBe(true);
    expect(wrapper.find("svg").exists()).toBe(true);
    expect(wrapper.text().replace(/\s+/g, "")).not.toMatch(/\?/);
    expect(wrapper.classes()).not.toContain("is-expanded");
  });

  it("marks expanded state for rotation", () => {
    const wrapper = mount(DisclosureChevron, { props: { expanded: true } });
    expect(wrapper.find("svg").classes()).toContain("is-expanded");
  });
});

describe("ValidationIssuesPanel", () => {
  const warningOnly = [
    { severity: "warning" as const, code: "W1", message: "Uncertain cooldown", canonicalKey: "a.b" },
  ];
  const mixed = [
    { severity: "warning" as const, code: "W1", message: "Uncertain cooldown", canonicalKey: "a.b" },
    { severity: "error" as const, code: "E1", message: "Missing spell", canonicalKey: "c.d" },
  ];

  it("collapses ordinary warnings by default", () => {
    const wrapper = mount(ValidationIssuesPanel, { props: { issues: warningOnly } });
    expect(wrapper.get("[data-testid='validation-toggle']").attributes("aria-expanded")).toBe("false");
    expect(wrapper.get("[data-testid='validation-panel-body']").attributes("hidden")).toBeDefined();
    expect(wrapper.get("[data-testid='validation-issue-count']").text()).toBe("1");
    expect(wrapper.find(".eyebrow").text()).toBe("Validation warnings");
  });

  it("expands to reveal warnings", async () => {
    const wrapper = mount(ValidationIssuesPanel, { props: { issues: warningOnly } });
    await wrapper.get("[data-testid='validation-toggle']").trigger("click");
    expect(wrapper.get("[data-testid='validation-toggle']").attributes("aria-expanded")).toBe("true");
    expect(wrapper.get("[data-testid='validation-panel-body']").attributes("hidden")).toBeUndefined();
    expect(wrapper.text()).toContain("Uncertain cooldown");
  });

  it("keeps fatal errors visible while the warning panel is collapsed", () => {
    const wrapper = mount(ValidationIssuesPanel, { props: { issues: mixed } });
    expect(wrapper.get("[data-testid='validation-toggle']").attributes("aria-expanded")).toBe("false");
    const fatal = wrapper.get("[data-testid='validation-fatal-status']");
    expect(fatal.attributes("role")).toBe("alert");
    expect(fatal.text()).toContain("Missing spell");
    expect(wrapper.get("[data-testid='validation-fatal-list']").text()).toContain("Missing spell");
    expect(wrapper.get("[data-testid='validation-panel-body']").text()).not.toContain("Missing spell");
    expect(wrapper.get("[data-testid='validation-issue-count']").text()).toBe("1");
  });

  it("does not render an empty disclosure when there are zero issues", () => {
    const wrapper = mount(ValidationIssuesPanel, { props: { issues: [] } });
    expect(wrapper.find("[data-testid='validation-summary']").exists()).toBe(false);
    expect(wrapper.find("[data-testid='validation-toggle']").exists()).toBe(false);
  });

  it("renders fatal-only issues without a warning disclosure", () => {
    const wrapper = mount(ValidationIssuesPanel, {
      props: {
        issues: [{ severity: "error" as const, code: "E1", message: "Broken rule", canonicalKey: "x" }],
      },
    });
    expect(wrapper.find("[data-testid='validation-toggle']").exists()).toBe(false);
    expect(wrapper.get("[data-testid='validation-fatal-status']").attributes("role")).toBe("alert");
  });
});

describe("IconSelect", () => {
  const options = [
    { value: "mage", label: "Mage", iconName: "classicon_mage" },
    { value: "TANK", label: "TANK", iconName: "ability_warrior_defensivestance" },
  ];

  it("shows decorative icons with readable text labels", async () => {
    const wrapper = mount(IconSelect, {
      props: {
        modelValue: "mage",
        options,
        label: "Class",
        emptyLabel: "All classes",
      },
    });
    const trigger = wrapper.get("[data-testid='icon-select-trigger']");
    expect(trigger.find("[data-testid='wow-icon']").attributes("alt")).toBe("");
    expect(trigger.find("[data-testid='wow-icon']").attributes("src")).toContain("classicon_mage");
    expect(trigger.text()).toContain("Mage");
    await trigger.trigger("click");
    const list = wrapper.get("[data-testid='icon-select-list']");
    expect(list.text()).toContain("TANK");
    expect(list.findAll("[role='option']").every((opt) => opt.text().trim().length > 0)).toBe(true);
    const allOption = list.findAll("[role='option']")[0]!;
    expect(allOption.text()).toContain("All classes");
    expect(allOption.find("[data-testid='wow-icon']").exists()).toBe(false);
  });

  it("supports keyboard open, navigate, select, and escape", async () => {
    const wrapper = mount(IconSelect, {
      props: {
        modelValue: "",
        options,
        label: "Role",
        emptyLabel: "Any role",
      },
    });
    const trigger = wrapper.get("[data-testid='icon-select-trigger']");
    expect(trigger.attributes("role")).toBe("combobox");
    expect(trigger.attributes("aria-controls")).toBeTruthy();

    await trigger.trigger("keydown", { key: "Enter" });
    expect(trigger.attributes("aria-expanded")).toBe("true");

    const list = wrapper.get("[data-testid='icon-select-list']");
    await list.trigger("keydown", { key: "ArrowDown" });
    await list.trigger("keydown", { key: "ArrowDown" });
    await list.trigger("keydown", { key: "Home" });
    await list.trigger("keydown", { key: "End" });
    await list.trigger("keydown", { key: "Escape" });
    expect(trigger.attributes("aria-expanded")).toBe("false");
    expect(wrapper.props("modelValue")).toBe("");

    await trigger.trigger("keydown", { key: " " });
    expect(trigger.attributes("aria-expanded")).toBe("true");
    await list.trigger("keydown", { key: "ArrowDown" });
    await list.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("update:modelValue")?.at(-1)?.[0]).toBe("mage");
  });

  it("keeps text when an option has no icon", async () => {
    const wrapper = mount(IconSelect, {
      props: {
        modelValue: "plain",
        options: [{ value: "plain", label: "Plain option", iconName: null }],
        label: "Class",
        emptyLabel: "All classes",
      },
    });
    expect(wrapper.get("[data-testid='icon-select-trigger']").text()).toContain("Plain option");
    await wrapper.get("[data-testid='icon-select-trigger']").trigger("click");
    expect(wrapper.get("[data-testid='icon-select-list']").text()).toContain("Plain option");
  });

  it("respects disabled behavior", async () => {
    const wrapper = mount(IconSelect, {
      props: {
        modelValue: "",
        options,
        label: "Role",
        emptyLabel: "Any role",
        disabled: true,
      },
    });
    const trigger = wrapper.get("[data-testid='icon-select-trigger']");
    expect(trigger.attributes("disabled")).toBeDefined();
    await trigger.trigger("click");
    expect(trigger.attributes("aria-expanded")).toBe("false");
  });
});
