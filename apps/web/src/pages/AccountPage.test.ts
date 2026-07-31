import { describe, expect, it, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
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
  const pinia = createPinia();
  setActivePinia(pinia);
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
      { path: "/admin/models", name: "admin-models", component: { template: "<div />" } },
      {
        path: "/admin/ability-catalog",
        name: "admin-ability-catalog",
        component: { template: "<div />" },
      },
      { path: "/admin/users", name: "admin-users", component: { template: "<div />" } },
    ],
  });
  vi.stubGlobal("fetch", fetchMock);
  return router.push("/account").then(() =>
    router.isReady().then(() =>
      mount(AccountPage, {
        global: { plugins: [router, pinia] },
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

  it("merges profile and linked account into one section without USER role", async () => {
    const fetchMock = baseFetch({
      characters: [characterPayload("AVAILABLE")],
      discovery: { status: "COMPLETED", jobId: "j1", startedAt: null, finishedAt: null, error: null },
      hiddenCharacterCount: 0,
      totalOwnedCharacterCount: 1,
      primaryDiagnostic: null,
    });
    const wrapper = await mountAccount(fetchMock);
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("Tester");
    });

    expect(wrapper.findAll("[data-testid='account-profile']")).toHaveLength(1);
    expect(wrapper.text()).not.toContain("Linked Battle.net");
    expect(wrapper.text()).not.toContain("Roles:");
    expect(wrapper.text()).not.toMatch(/\bUSER\b/i);
    expect(wrapper.find("[data-testid='admin-role-chip']").exists()).toBe(false);
    expect(wrapper.text()).toContain("Battle.net");
    expect(wrapper.text()).toContain("Tester#1");
  });

  it("renders ADMIN as a chip next to Profile", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/auth/me")) {
        return new Response(
          JSON.stringify({
            authenticated: true,
            user: {
              id: "u1",
              displayName: "Admin Tester",
              roles: ["admin"],
              permissions: ["admin.users.read"],
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/me/battlenet")) {
        return new Response(JSON.stringify({ linked: false }), { status: 200 });
      }
      if (url.includes("/me/characters")) {
        return new Response(
          JSON.stringify({
            characters: [],
            discovery: {
              status: "COMPLETED",
              jobId: null,
              startedAt: null,
              finishedAt: null,
              error: null,
            },
            hiddenCharacterCount: 0,
            totalOwnedCharacterCount: 0,
            primaryDiagnostic: null,
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    });

    const wrapper = await mountAccount(fetchMock);
    await vi.waitFor(() => {
      expect(wrapper.find("[data-testid='admin-role-chip']").exists()).toBe(true);
    });

    const chip = wrapper.get("[data-testid='admin-role-chip']");
    expect(chip.text()).toBe("ADMIN");
    expect(wrapper.findAll("[data-testid='admin-role-chip']")).toHaveLength(1);
    expect(wrapper.findAll(".role-chip")).toHaveLength(1);
    const heading = wrapper.get(".profile-heading");
    expect(heading.text()).toContain("ADMIN");
    expect(heading.text()).toContain("Profile");
    const chipIndex = heading.element.textContent?.indexOf("ADMIN") ?? -1;
    const profileIndex = heading.element.textContent?.indexOf("Profile") ?? -1;
    expect(chipIndex).toBeGreaterThanOrEqual(0);
    expect(profileIndex).toBeGreaterThan(chipIndex);
    expect(wrapper.text()).not.toMatch(/\bUSER\b/);
    expect(wrapper.text()).not.toContain("admin.users.read");
  });

  it("does not render a role chip for missing or unknown roles", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/auth/me")) {
        return new Response(
          JSON.stringify({
            authenticated: true,
            user: {
              id: "u1",
              displayName: "Mystery",
              roles: ["moderator"],
              permissions: [],
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/me/battlenet")) {
        return new Response(JSON.stringify({ linked: false }), { status: 200 });
      }
      if (url.includes("/me/characters")) {
        return new Response(
          JSON.stringify({
            characters: [],
            discovery: {
              status: "COMPLETED",
              jobId: null,
              startedAt: null,
              finishedAt: null,
              error: null,
            },
            hiddenCharacterCount: 0,
            totalOwnedCharacterCount: 0,
            primaryDiagnostic: null,
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    });
    const wrapper = await mountAccount(fetchMock);
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("Profile");
    });
    expect(wrapper.find("[data-testid='admin-role-chip']").exists()).toBe(false);
    expect(wrapper.findAll(".role-chip")).toHaveLength(0);
  });

  it("shows masked email once, without duplicating BattleTag or leaking full email", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/auth/me")) {
        return new Response(
          JSON.stringify({
            authenticated: true,
            user: { id: "u1", displayName: "Tester#1", roles: ["user"], permissions: [] },
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
              emailMasked: "te******45@gmail.com",
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
            characters: [characterPayload("AVAILABLE")],
            discovery: {
              status: "COMPLETED",
              jobId: "j1",
              startedAt: null,
              finishedAt: null,
              error: null,
            },
            hiddenCharacterCount: 0,
            totalOwnedCharacterCount: 1,
            primaryDiagnostic: null,
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    });
    const wrapper = await mountAccount(fetchMock);
    await vi.waitFor(() => {
      expect(wrapper.find("[data-testid='account-email-masked']").exists()).toBe(true);
    });
    expect(wrapper.findAll("[data-testid='account-battletag']")).toHaveLength(1);
    expect(wrapper.get("[data-testid='account-email-masked']").text()).toBe("te******45@gmail.com");
    expect(wrapper.html()).not.toContain("test45@gmail.com");
    expect(wrapper.html()).not.toMatch(/title="[^"]*@gmail\.com"/i);
    expect(wrapper.html()).not.toMatch(/aria-label="[^"]*@gmail\.com"/i);
    expect(wrapper.text()).not.toContain("Score models");
    expect(wrapper.text()).not.toContain("Ability catalog");
  });

  it("keeps Primary and Set primary action widths equal", async () => {
    const primary = {
      ...characterPayload("AVAILABLE"),
      ownershipId: "own-primary",
      isPrimary: true,
      name: "Primarychar",
    };
    const secondary = {
      ...characterPayload("AVAILABLE"),
      ownershipId: "own-secondary",
      isPrimary: false,
      name: "Altchar",
    };
    const fetchMock = baseFetch({
      characters: [primary, secondary],
      discovery: { status: "COMPLETED", jobId: "j1", startedAt: null, finishedAt: null, error: null },
      hiddenCharacterCount: 0,
      totalOwnedCharacterCount: 2,
      primaryDiagnostic: null,
    });
    const wrapper = await mountAccount(fetchMock);
    await vi.waitFor(() => {
      expect(wrapper.find("[data-testid='primary-state']").exists()).toBe(true);
    });
    const primaryEl = wrapper.get("[data-testid='primary-state']");
    const setPrimaryEl = wrapper.get("[data-testid='set-primary']");
    expect(primaryEl.classes()).toContain("primary-slot");
    expect(setPrimaryEl.classes()).toContain("primary-slot");
  });

  it("preserves link and unlink Battle.net flows after the profile merge", async () => {
    let linked = true;
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
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
      if (url.includes("/me/battlenet/unlink") && init?.method === "POST") {
        linked = false;
        return new Response("{}", { status: 200 });
      }
      if (url.includes("/me/battlenet")) {
        return new Response(
          JSON.stringify(
            linked
              ? {
                  linked: true,
                  account: {
                    providerAccountId: "1",
                    battletag: "Tester#1",
                    linkedAt: new Date().toISOString(),
                    lastOwnershipSyncAt: null,
                    lastOwnershipSyncError: null,
                  },
                }
              : { linked: false },
          ),
          { status: 200 },
        );
      }
      if (url.includes("/me/characters")) {
        return new Response(
          JSON.stringify({
            characters: [],
            discovery: {
              status: "COMPLETED",
              jobId: null,
              startedAt: null,
              finishedAt: null,
              error: null,
            },
            hiddenCharacterCount: 0,
            totalOwnedCharacterCount: 0,
            primaryDiagnostic: null,
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    });

    const linkedWrapper = await mountAccount(fetchMock);
    await vi.waitFor(() => {
      expect(linkedWrapper.text()).toContain("Tester#1");
    });
    expect(linkedWrapper.get("[data-testid='account-profile']").text()).toContain("Unlink");
    await linkedWrapper.get(".btn--danger").trigger("click");
    expect(linkedWrapper.find("#unlink-title").exists()).toBe(true);
    await linkedWrapper.get(".confirm .btn--danger").trigger("click");
    await flushPromises();
    await vi.waitFor(() => {
      expect(linkedWrapper.text()).toContain("No Battle.net account linked.");
      expect(linkedWrapper.text()).toContain("Link Battle.net");
    });
    linkedWrapper.unmount();
  });

  it("renders discovery, refresh and recoverable sync error states with English labels", async () => {
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
              lastOwnershipSyncError: "token expired",
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/me/characters")) {
        return new Response(
          JSON.stringify({
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
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    });

    const wrapper = await mountAccount(fetchMock);
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("Tester#1");
    });
    expect(wrapper.text()).toContain("Analyzing your characters");
    expect(wrapper.text()).toContain("Refreshing");
    expect(wrapper.text()).toContain("Sync error: token expired");
    expect(wrapper.text()).not.toContain("REFRESHING");
    expect(wrapper.find(".spinner").exists()).toBe(false);
    expect(wrapper.find("[data-testid='status-chip-spinner']").exists()).toBe(true);
    wrapper.unmount();
  });

  it("shows loading characters while the roster request is outstanding", async () => {
    const deferred: {
      resolve: ((value: Response) => void) | null;
    } = { resolve: null };
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
        return new Response(JSON.stringify({ linked: false }), { status: 200 });
      }
      if (url.includes("/me/characters")) {
        return new Promise<Response>((resolve) => {
          deferred.resolve = resolve;
        });
      }
      return new Response("{}", { status: 200 });
    });

    const wrapper = await mountAccount(fetchMock);
    await flushPromises();
    expect(wrapper.text()).toContain("Loading characters");
    deferred.resolve?.(
      new Response(
        JSON.stringify({
          characters: [],
          discovery: {
            status: "COMPLETED",
            jobId: null,
            startedAt: null,
            finishedAt: null,
            error: null,
          },
          hiddenCharacterCount: 0,
          totalOwnedCharacterCount: 0,
          primaryDiagnostic: null,
        }),
        { status: 200 },
      ),
    );
    await flushPromises();
    wrapper.unmount();
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
    expect(wrapper.find(".char-identity__nickname").attributes("style")).toContain("color");
    expect(wrapper.text()).toContain("3 hidden");
    expect(wrapper.find(".tier-badge-stub").exists()).toBe(true);

    const setPrimary = wrapper.find("[data-testid='set-primary']");
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
