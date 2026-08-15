import { describe, expect, it, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { routeDefs } from "../routes";
import type { PublicFaqEntryDTO } from "@mplus/contracts";

const listFaq = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    listFaq: (...args: unknown[]) => listFaq(...args),
    getPublishedScoringContext: async () => ({
      available: false,
      unavailableReason: "Current Meta context is temporarily unavailable.",
      scoringSeason: null,
      revision: null,
      meta: null,
      key: null,
    }),
    listPublicScoreModels: async () => [
      {
        id: "m",
        key: "default",
        version: 6,
        name: "Default",
        status: "ACTIVE",
        config: {
          weights: {
            performance: 0.35,
            survival: 0.3,
            utility: 0.25,
            experienceConsistency: 0.1,
            mythicRaid: 0,
          },
        },
        createdAt: "2026-01-01T00:00:00.000Z",
        activatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  },
}));

import FaqPage from "./FaqPage.vue";
import { resetPublishedScoringContextCache } from "../composables/usePublishedScoringContext";
import { resetPublicScoreModelCache } from "../composables/usePublicScoreModel";

const entries: PublicFaqEntryDTO[] = [
  {
    id: "faq-1",
    title: "How is Trust Score calculated?",
    description: "It uses four public skill dimensions.",
    position: 1,
    embedType: null,
  },
  {
    id: "faq-2",
    title: "Where does data come from?",
    description: "Blizzard, Raider.IO and Warcraft Logs.",
    position: 2,
    embedType: null,
  },
];

async function mountPage() {
  const router = createRouter({ history: createMemoryHistory(), routes: routeDefs });
  await router.push("/faq");
  await router.isReady();
  const wrapper = mount(FaqPage, { global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

describe("FaqPage", () => {
  beforeEach(() => {
    resetPublishedScoringContextCache();
    resetPublicScoreModelCache();
    listFaq.mockReset();
    listFaq.mockResolvedValue({ entries });
  });

  it("renders entries from the API", async () => {
    const wrapper = await mountPage();
    expect(wrapper.get("[data-testid='faq-page']").text()).toContain("FAQ");
    expect(wrapper.text()).toContain("How is Trust Score calculated?");
    expect(wrapper.text()).toContain("Where does data come from?");
  });

  it("searches title and description case-insensitively", async () => {
    const wrapper = await mountPage();
    const search = wrapper.get("[data-testid='faq-search']");
    await search.setValue("TRUST SCORE");
    await flushPromises();
    expect(wrapper.text()).toContain("How is Trust Score calculated?");
    expect(wrapper.text()).not.toContain("Where does data come from?");

    await search.setValue("warcraft logs");
    await flushPromises();
    expect(wrapper.text()).toContain("Where does data come from?");
    expect(wrapper.text()).not.toContain("How is Trust Score calculated?");
  });

  it("shows no-results when nothing matches", async () => {
    const wrapper = await mountPage();
    await wrapper.get("[data-testid='faq-search']").setValue("xyzzy");
    await flushPromises();
    expect(wrapper.get("[data-testid='faq-no-results']").text()).toContain("No FAQs found");
  });

  it("opens only one accordion item and closes the active item on click", async () => {
    const wrapper = await mountPage();
    const triggers = wrapper.findAll("[data-testid='faq-item-trigger']");
    expect(triggers).toHaveLength(2);
    await triggers[0]!.trigger("click");
    await flushPromises();
    expect(triggers[0]!.attributes("aria-expanded")).toBe("true");
    expect(triggers[1]!.attributes("aria-expanded")).toBe("false");

    await triggers[1]!.trigger("click");
    await flushPromises();
    expect(triggers[0]!.attributes("aria-expanded")).toBe("false");
    expect(triggers[1]!.attributes("aria-expanded")).toBe("true");

    await triggers[1]!.trigger("click");
    await flushPromises();
    expect(triggers[1]!.attributes("aria-expanded")).toBe("false");
  });

  it("closes the open item when it is filtered away", async () => {
    const wrapper = await mountPage();
    const first = wrapper.get("[data-testid='faq-item-trigger']");
    await first.trigger("click");
    expect(first.attributes("aria-expanded")).toBe("true");
    await wrapper.get("[data-testid='faq-search']").setValue("warcraft logs");
    await flushPromises();
    const remaining = wrapper.get("[data-testid='faq-item-trigger']");
    expect(remaining.attributes("aria-expanded")).toBe("false");
  });

  it("shows the empty catalog state", async () => {
    listFaq.mockResolvedValue({ entries: [] });
    const wrapper = await mountPage();
    expect(wrapper.get("[data-testid='faq-empty']").text()).toContain("No FAQ entries are available yet.");
  });

  it("renders a typed artifact after the description and keeps FAQ copy if the artifact fails", async () => {
    listFaq.mockResolvedValue({
      entries: [
        {
          id: "faq-flow",
          title: "How is the Trust Score calculated?",
          description: "Visible FAQ copy stays even if artifacts fail.",
          position: 1,
          embedType: "SCORE_FLOW",
        },
      ],
    });
    const wrapper = await mountPage();
    expect(wrapper.find("[data-testid='faq-embedded-artifact']").exists()).toBe(false);
    await wrapper.get("[data-testid='faq-item-trigger']").trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='faq-item-panel']").text()).toContain("Visible FAQ copy stays");
    expect(wrapper.get("[data-testid='faq-embedded-artifact']").attributes("data-embed-type")).toBe("SCORE_FLOW");
    expect(wrapper.get("[data-testid='faq-score-flow-raw']").text()).toContain("Raw Trust Score");
    const html = wrapper.get("[data-testid='faq-score-flow']").html();
    expect(html.indexOf("Raw Trust Score")).toBeLessThan(html.indexOf("Key Difficulty"));
    expect(html.indexOf("Key Difficulty")).toBeLessThan(html.indexOf("Meta factor"));
    expect(html.indexOf("Meta factor")).toBeLessThan(html.indexOf("Final Trust Score"));
    expect(wrapper.text()).not.toContain("Mythic Raid");
  });

  it("maps each embed type to the matching renderer", async () => {
    listFaq.mockResolvedValue({
      entries: [
        { id: "a", title: "Meta", description: "Meta copy", position: 1, embedType: "META_TIER_TABLE" },
      ],
    });
    const wrapper = await mountPage();
    await wrapper.get("[data-testid='faq-item-trigger']").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid='faq-meta-artifact']").exists()).toBe(true);
  });

  it("shows production dimension mix and component detail", async () => {
    listFaq.mockResolvedValue({
      entries: [
        {
          id: "d",
          title: "What do Performance, Survival, Utility and Experience measure?",
          description: "Four public skill dimensions.",
          position: 1,
          embedType: "SCORING_DIMENSIONS",
        },
      ],
    });
    const wrapper = await mountPage();
    await wrapper.get("[data-testid='faq-item-trigger']").trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='faq-dimension-performance']").text()).toContain("Performance");
    expect(wrapper.get("[data-testid='faq-dim-effective-performance']").text()).toContain("35%");
    expect(wrapper.get("[data-testid='faq-dimension-utility']").text()).toContain("Interrupts");
    expect(wrapper.text()).not.toContain("Mythic Raid");
  });

  it("renders the shared trust grade ladder for TRUST_GRADE_LADDER", async () => {
    listFaq.mockResolvedValue({
      entries: [
        { id: "g", title: "Grades", description: "Letter grades", position: 1, embedType: "TRUST_GRADE_LADDER" },
      ],
    });
    const wrapper = await mountPage();
    await wrapper.get("[data-testid='faq-item-trigger']").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid='faq-trust-grade-ladder']").exists()).toBe(true);
    expect(wrapper.find("[data-testid='trust-grade-ladder']").exists()).toBe(true);
  });
});
