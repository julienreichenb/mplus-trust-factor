import { describe, expect, it, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import AccountPage from "./AccountPage.vue";

vi.mock("../components/landing/TrustTierBadge.vue", () => ({
  default: { name: "TrustTierBadge", template: "<div class='tier-badge-stub' />" },
}));

function characterPayload(status: string) {
  return {
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
      status,
      jobId: status === "REFRESHING" || status === "QUEUED" ? "job-1" : null,
      score: status === "UNAVAILABLE" ? null : 72,
      grade: status === "UNAVAILABLE" ? null : status === "PARTIAL" ? "U" : "B",
      confidence: 0.8,
      modelVersion: 6,
      calculatedAt: new Date().toISOString(),
      errorCode: status === "FAILED" ? "REFRESH_FAILED" : null,
      errorMessage: status === "FAILED" ? "failed" : null,
    },
    relevance: {
      policyVersion: "v1",
      eligible: true,
      reasons: ["MYTHIC_RATING_THRESHOLD"],
      evaluatedAt: new Date().toISOString(),
    },
  };
}

function mountAccount(fetchMock: ReturnType<typeof vi.fn>) {
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
  vi.stubGlobal("fetch", fetchMock);
  return router.push("/account").then(() =>
    router.isReady().then(() =>
      mount(AccountPage, {
        global: { plugins: [router] },
      }),
    ),
  );
}

function baseFetch(charactersBody: unknown) {
  return vi.fn(async (input: RequestInfo) => {
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
      return new Response(JSON.stringify(charactersBody), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
}

describe("AccountPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("renders relevant character rows as links with class color and set-primary stop", async () => {
    const fetchMock = baseFetch({
      characters: [characterPayload("AVAILABLE")],
      discovery: { status: "COMPLETED", jobId: "j1", startedAt: null, finishedAt: null, error: null },
      hiddenCharacterCount: 3,
      totalOwnedCharacterCount: 4,
      primaryDiagnostic: null,
    });
    const wrapper = await mountAccount(fetchMock);

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

  it("does not issue per-character profile requests", async () => {
    const fetchMock = baseFetch({
      characters: [characterPayload("AVAILABLE")],
      discovery: { status: "COMPLETED", jobId: "j1", startedAt: null, finishedAt: null, error: null },
      hiddenCharacterCount: 0,
      totalOwnedCharacterCount: 1,
      primaryDiagnostic: null,
    });
    await mountAccount(fetchMock);
    await flushPromises();

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => /\/api\/v1\/characters\//.test(u))).toBe(false);
    expect(urls.filter((u) => u.includes("/me/characters")).length).toBeGreaterThanOrEqual(1);
  });

  it("stops polling after all jobs become terminal", async () => {
    vi.useFakeTimers();
    let phase: "active" | "done" = "active";
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
        const body =
          phase === "active"
            ? {
                characters: [characterPayload("REFRESHING")],
                discovery: {
                  status: "RUNNING",
                  jobId: "d1",
                  startedAt: null,
                  finishedAt: null,
                  error: null,
                },
                hiddenCharacterCount: 0,
                totalOwnedCharacterCount: 1,
                primaryDiagnostic: null,
              }
            : {
                characters: [characterPayload("AVAILABLE")],
                discovery: {
                  status: "COMPLETED",
                  jobId: "d1",
                  startedAt: null,
                  finishedAt: null,
                  error: null,
                },
                hiddenCharacterCount: 0,
                totalOwnedCharacterCount: 1,
                primaryDiagnostic: null,
              };
        return new Response(JSON.stringify(body), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });

    await mountAccount(fetchMock);
    await flushPromises();

    const before = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/me/characters")).length;
    await vi.advanceTimersByTimeAsync(4000);
    await flushPromises();
    phase = "done";
    await vi.advanceTimersByTimeAsync(4000);
    await flushPromises();
    const mid = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/me/characters")).length;
    expect(mid).toBeGreaterThan(before);

    await vi.advanceTimersByTimeAsync(20_000);
    await flushPromises();
    const after = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/me/characters")).length;
    expect(after).toBe(mid);
  });

  it.each(["FAILED", "STALE", "PARTIAL", "UNAVAILABLE"] as const)(
    "does not continue polling for %s trust status",
    async (status) => {
      vi.useFakeTimers();
      const fetchMock = baseFetch({
        characters: [characterPayload(status)],
        discovery: {
          status: "FAILED",
          jobId: "d1",
          startedAt: null,
          finishedAt: null,
          error: "boom",
        },
        hiddenCharacterCount: 0,
        totalOwnedCharacterCount: 1,
        primaryDiagnostic: null,
      });
      await mountAccount(fetchMock);
      await flushPromises();
      const before = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/me/characters")).length;
      await vi.advanceTimersByTimeAsync(20_000);
      await flushPromises();
      const after = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/me/characters")).length;
      expect(after).toBe(before);
    },
  );
});
