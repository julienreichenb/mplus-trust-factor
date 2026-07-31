import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory } from "vue-router";
import { ADMIN_DESTINATIONS } from "./lib/adminNav";
import { createAppRouter } from "./router";
import { routeDefs } from "./routes";

function stubAuthMe(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/auth/me")) {
        return new Response(JSON.stringify(body), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }),
  );
}

describe("web router registration", () => {
  it("registers required foundation routes with destination meta", () => {
    const names = routeDefs.map((route) => route.name);
    expect(names).toContain("home");
    expect(names).toContain("character");
    expect(names).toContain("compare");
    expect(names).toContain("admin-models");
    expect(names).toContain("admin-ability-catalog");
    expect(names).toContain("admin-users");
    expect(names).toContain("admin-bulk-processing");
    expect(names).toContain("auth-signin");
    expect(names).toContain("auth-error");
    expect(names).toContain("account");
    expect(names).toContain("access-denied");

    for (const destination of ADMIN_DESTINATIONS) {
      const route = routeDefs.find((entry) => entry.name === destination.name);
      expect(route?.path).toBe(destination.path);
      expect(route?.meta?.adminDestinationId).toBe(destination.id);
      expect(route?.meta?.requiresAdmin).toBeUndefined();
    }
  });
});

describe("admin route guards", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function navigate(path: string, permissions: string[]) {
    stubAuthMe({
      authenticated: true,
      user: {
        id: "u1",
        displayName: "Tester",
        roles: [],
        permissions,
      },
    });
    const router = createAppRouter(createMemoryHistory());
    await router.push(path);
    await router.isReady();
    return router;
  }

  it.each([
    {
      path: "/admin/models",
      allow: ["admin.score_models.manage"],
      deny: ["admin.ability_catalog.read"],
    },
    {
      path: "/admin/ability-catalog",
      allow: ["admin.ability_catalog.read"],
      deny: ["admin.score_models.manage"],
    },
    {
      path: "/admin/users",
      allow: ["admin.users.read"],
      deny: ["admin.jobs.manage"],
    },
    {
      path: "/admin/users",
      allow: ["admin.users.manage"],
      deny: ["admin.score_models.manage"],
    },
    {
      path: "/admin/bulk-processing",
      allow: ["admin.jobs.manage"],
      deny: ["admin.users.read"],
    },
  ])("allows $path with $allow and denies with $deny", async ({ path, allow, deny }) => {
    const allowed = await navigate(path, allow);
    expect(allowed.currentRoute.value.path).toBe(path);

    const denied = await navigate(path, deny);
    expect(denied.currentRoute.value.name).toBe("access-denied");
  });

  it("rejects unauthenticated admin navigation to sign-in", async () => {
    stubAuthMe({ authenticated: false });
    const router = createAppRouter(createMemoryHistory());
    await router.push("/admin/models");
    await router.isReady();
    expect(router.currentRoute.value.name).toBe("auth-signin");
  });

  it("rejects broad admin.* without destination permission", async () => {
    const router = await navigate("/admin/models", ["admin.settings.manage"]);
    expect(router.currentRoute.value.name).toBe("access-denied");
  });
});
