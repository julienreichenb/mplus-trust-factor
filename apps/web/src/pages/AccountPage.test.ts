import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import AccountPage from "./AccountPage.vue";

vi.mock("../components/landing/TrustTierBadge.vue", () => ({
  default: { name: "TrustTierBadge", template: "<div class='tier-badge-stub' />" },
}));

describe("AccountPage", () => {
  it("renders relevant character rows as links with class color and set-primary stop", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/account", name: "account", component: AccountPage },
        {
          path: "/character/:region/:realm/:name",
          name: "character",
          component: { template: "<div />" },
        },
        { path: "/auth/signin", name: "signin", component: { template: "<div />" } },
      ],
    });
    await router.push("/account");
    await router.isReady();

    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/auth/me")) {
        return new Response(
          JSON.stringify({
            authenticated: true,
            user: { id: "u1", displayName: "Tester", roles: ["user"], permissions: [] },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/me/battlenet")) {
        return new Response(
          JSON.stringify({
            linked: true,
            account: {
              providerAccountId: "1",
              battletag: "Tester#1",
              linkedAt: new Date().toISOString(),
              lastOwnershipSyncAt: null,
              lastOwnershipSyncError: null,
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/me/characters")) {
        return new Response(
          JSON.stringify({
            characters: [
              {
                ownershipId: "own-1",
                characterId: "char-1",
                region: "EU",
                realmSlug: "tarren-mill",
                realmName: "Tarren Mill",
                name: "Mainalt",
                level: 90,
                isPrimary: false,
                characterClass: { id: 8, slug: "mage", name: "Mage", color: "#3FC7EB" },
                media: { portraitUrl: null },
                currentSeasonMythic: {
                  rating: 2100,
                  seasonId: "s1",
                  fetchedAt: new Date().toISOString(),
                  source: "blizzard",
                  state: "OK",
                },
                trustScore: {
                  status: "AVAILABLE",
                  jobId: null,
                  score: 72,
                  grade: "B",
                  confidence: 0.8,
                  modelVersion: 6,
                  calculatedAt: new Date().toISOString(),
                  errorCode: null,
                  errorMessage: null,
                },
                relevance: {
                  policyVersion: "v1",
                  eligible: true,
                  reasons: ["MYTHIC_RATING_THRESHOLD"],
                  evaluatedAt: new Date().toISOString(),
                },
              },
            ],
            discovery: {
              status: "COMPLETED",
              jobId: "j1",
              startedAt: null,
              finishedAt: null,
              error: null,
            },
            hiddenCharacterCount: 3,
            totalOwnedCharacterCount: 4,
            primaryDiagnostic: null,
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(AccountPage, {
      global: { plugins: [router] },
    });

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("Mainalt");
    });

    const link = wrapper.find("a.char-row__link");
    expect(link.exists()).toBe(true);
    expect(link.attributes("href")).toContain("/character/eu/tarren-mill/Mainalt");
    expect(wrapper.find(".name").attributes("style")).toContain("color");
    expect(wrapper.text()).toContain("3 hidden");
    expect(wrapper.find(".tier-badge-stub").exists()).toBe(true);

    const setPrimary = wrapper.find("button.btn--ghost");
    expect(setPrimary.exists()).toBe(true);
    expect(setPrimary.attributes("class")).toContain("btn--ghost");
  });
});
