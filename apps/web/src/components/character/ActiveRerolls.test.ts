import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import type { ActiveRerollCharacterDTO } from "@mplus/contracts";
import ActiveRerolls from "./ActiveRerolls.vue";

function makeReroll(
  overrides: Partial<ActiveRerollCharacterDTO> &
    Pick<ActiveRerollCharacterDTO, "characterId" | "name" | "realmSlug" | "region">,
): ActiveRerollCharacterDTO {
  return {
    realmName: overrides.realmName ?? overrides.realmSlug,
    classSlug: "mage",
    className: "Mage",
    classColor: "#3FC7EB",
    portraitUrl: null,
    mythicPlusScore: null,
    grade: null,
    isMain: false,
    ...overrides,
  };
}

const roster: ActiveRerollCharacterDTO[] = [
  makeReroll({
    characterId: "11111111-1111-4111-8111-111111111111",
    name: "Highalt",
    realmSlug: "silvermoon",
    realmName: "Silvermoon",
    region: "EU",
    classSlug: "warrior",
    className: "Warrior",
    classColor: "#C69B6D",
    portraitUrl: "https://cdn.example/high.png",
    mythicPlusScore: 2800.4,
    grade: "S",
    isMain: true,
  }),
  makeReroll({
    characterId: "22222222-2222-4222-8222-222222222222",
    name: "Lowalt",
    realmSlug: "kazzak",
    realmName: "Kazzak",
    region: "EU",
    mythicPlusScore: 1500,
    grade: "B",
    isMain: false,
  }),
];

async function mountRerolls(chars: ActiveRerollCharacterDTO[]) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: "/character/:region/:realm/:name",
        name: "character",
        component: { template: "<div />" },
      },
    ],
  });
  await router.push("/character/eu/tarren-mill/Aleria");
  await router.isReady();

  return mount(ActiveRerolls, {
    props: { characters: chars },
    global: { plugins: [router] },
  });
}

describe("ActiveRerolls", () => {
  it("renders nothing when there are no rerolls", async () => {
    const wrapper = await mountRerolls([]);
    expect(wrapper.find("[data-testid='active-rerolls']").exists()).toBe(false);
  });

  it("uses English Active rerolls label", async () => {
    const wrapper = await mountRerolls(roster);
    expect(wrapper.text()).toContain("Active rerolls");
    expect(wrapper.text()).toContain("Switch character");
  });

  it("renders portrait/fallback, region, class-colored nickname-realm, bold score, MAIN, and right-aligned grade", async () => {
    const wrapper = await mountRerolls(roster);
    await wrapper.get("[data-testid='active-rerolls-trigger']").trigger("click");

    const options = wrapper.findAll(".active-rerolls__option");
    expect(options).toHaveLength(2);

    const first = options[0]!;
    expect(first.find(".active-rerolls__portrait").attributes("src")).toBe("https://cdn.example/high.png");
    expect(first.find(".active-rerolls__region").text()).toBe("EU");
    expect(first.find(".active-rerolls__name").text()).toBe("Highalt-Silvermoon");
    expect(first.find(".active-rerolls__name").attributes("style")).toMatch(/#C69B6D|rgb\(198,\s*155,\s*109\)/i);
    expect(first.find(".active-rerolls__score").text()).toBe("2800");
    expect(first.find(".active-rerolls__score").classes()).toContain("mpts-data");
    expect(first.find("[data-testid='reroll-main-chip']").text()).toBe("MAIN");
    const firstGrade = first.find("[data-testid='reroll-grade']");
    expect(firstGrade.exists()).toBe(true);
    expect(firstGrade.text()).toMatch(/S/);
    expect(firstGrade.find(".tier-badge").exists()).toBe(true);

    const second = options[1]!;
    expect(second.find(".active-rerolls__portrait").attributes("src")).toContain("classicon_mage");
    expect(second.find("[data-testid='reroll-main-chip']").exists()).toBe(false);
    expect(second.find("[data-testid='reroll-grade']").text()).toMatch(/B/);
  });

  it("renders missing grade as an em dash with Grade label", async () => {
    const wrapper = await mountRerolls([
      makeReroll({
        characterId: "33333333-3333-4333-8333-333333333333",
        name: "Nograde",
        realmSlug: "tarren-mill",
        region: "EU",
        mythicPlusScore: 1200,
        grade: null,
      }),
    ]);
    await wrapper.get("[data-testid='active-rerolls-trigger']").trigger("click");
    const grade = wrapper.get("[data-testid='reroll-grade']");
    expect(grade.text()).toContain("—");
    expect(grade.find(".active-rerolls__grade-missing").attributes("aria-label")).toBe(
      "Grade unavailable",
    );
  });

  it("navigates to the CharacterPage on row click", async () => {
    const wrapper = await mountRerolls(roster);
    await wrapper.get("[data-testid='active-rerolls-trigger']").trigger("click");
    const link = wrapper.find('[data-character-id="11111111-1111-4111-8111-111111111111"]');
    expect(link.attributes("href")).toContain("/character/eu/silvermoon/Highalt");
  });

  it("never renders ownership or account identifiers", async () => {
    const wrapper = await mountRerolls(roster);
    await wrapper.get("[data-testid='active-rerolls-trigger']").trigger("click");
    const html = wrapper.html();
    expect(html).not.toMatch(/ownershipId|battletag|providerAccountId|userId|relevanceEligible/i);
  });
});
