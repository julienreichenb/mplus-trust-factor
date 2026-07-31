import { createRouter, createWebHistory, type Router } from "vue-router";
import { isAuthorizedForAdminDestination } from "./lib/adminNav";
import { routeDefs } from "./routes";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export function createAppRouter(
  history = createWebHistory(),
): Router {
  const router = createRouter({
    history,
    routes: routeDefs,
  });

  router.beforeEach(async (to) => {
    const adminDestinationId = to.meta.adminDestinationId;
    if (!to.meta.requiresAuth && !adminDestinationId) {
      return true;
    }
    try {
      const response = await fetch(`${apiBase}/api/v1/auth/me`, { credentials: "include" });
      const body = (await response.json()) as {
        authenticated?: boolean;
        user?: { permissions?: string[] };
      };
      if (!body.authenticated) {
        return { name: "auth-signin", query: { returnTo: to.fullPath } };
      }
      if (adminDestinationId) {
        const permissions = body.user?.permissions ?? [];
        if (!isAuthorizedForAdminDestination(adminDestinationId, permissions)) {
          return { name: "access-denied" };
        }
      }
      return true;
    } catch {
      return { name: "auth-signin" };
    }
  });

  return router;
}

export const router = createAppRouter();
