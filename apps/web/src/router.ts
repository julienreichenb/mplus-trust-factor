import { createRouter, createWebHistory } from "vue-router";
import { hasAdminNavPermission } from "./composables/useAuthSession";
import { routeDefs } from "./routes";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export const router = createRouter({
  history: createWebHistory(),
  routes: routeDefs,
});

router.beforeEach(async (to) => {
  if (!to.meta.requiresAuth && !to.meta.requiresAdmin) {
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
    if (to.meta.requiresAdmin) {
      const permissions = body.user?.permissions ?? [];
      if (!hasAdminNavPermission(permissions)) {
        return { name: "access-denied" };
      }
    }
    return true;
  } catch {
    return { name: "auth-signin" };
  }
});
