import { computed, ref } from "vue";
import { hasAnyAuthorizedAdminDestination } from "../lib/adminNav";
import { hasPermission } from "../lib/permissions";

export { hasPermission } from "../lib/permissions";

const apiBase = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export interface AuthMeUser {
  id: string;
  displayName: string | null;
  roles: string[];
  permissions: string[];
}

export interface AuthMeResponse {
  authenticated: boolean;
  user?: AuthMeUser;
}

const me = ref<AuthMeResponse | null>(null);
const loading = ref(false);
let inflight: Promise<AuthMeResponse> | null = null;
let fetchGeneration = 0;

/** True when the user may see at least one Admin destination. */
export function hasAdminNavPermission(permissions: string[] | undefined): boolean {
  return hasAnyAuthorizedAdminDestination(permissions);
}

/** Apply a known /auth/me payload into the shared session (e.g. after page-local fetch). */
export function applyAuthMe(body: AuthMeResponse): AuthMeResponse {
  me.value = body.authenticated ? body : { authenticated: false };
  return me.value;
}

/** Clear cached session immediately (logout / session loss). */
export function clearAuthSession(): void {
  fetchGeneration += 1;
  inflight = null;
  me.value = { authenticated: false };
  loading.value = false;
}

export async function fetchAuthMe(force = false): Promise<AuthMeResponse> {
  if (!force && me.value) return me.value;
  if (!force && inflight) return inflight;

  const generation = ++fetchGeneration;
  loading.value = true;
  const request = (async () => {
    try {
      const response = await fetch(`${apiBase}/api/v1/auth/me`, { credentials: "include" });
      const body = (await response.json()) as AuthMeResponse;
      if (generation !== fetchGeneration) {
        return me.value ?? { authenticated: false };
      }
      return applyAuthMe(body);
    } catch {
      if (generation !== fetchGeneration) {
        return me.value ?? { authenticated: false };
      }
      return applyAuthMe({ authenticated: false });
    } finally {
      if (generation === fetchGeneration) {
        loading.value = false;
        inflight = null;
      }
    }
  })();
  inflight = request;
  return request;
}

export function useAuthSession() {
  const authenticated = computed(() => Boolean(me.value?.authenticated));
  const user = computed(() => me.value?.user ?? null);
  const permissions = computed(() => me.value?.user?.permissions ?? []);
  const canSeeAdminNav = computed(() => hasAnyAuthorizedAdminDestination(permissions.value));
  const canForceRefresh = computed(() =>
    hasPermission(permissions.value, "profile.refresh.force"),
  );
  const canManageUsers = computed(() => hasPermission(permissions.value, "admin.users.manage"));
  const canReadUsers = computed(() =>
    hasPermission(permissions.value, ["admin.users.read"]) || canManageUsers.value,
  );

  return {
    me,
    loading,
    authenticated,
    user,
    permissions,
    canSeeAdminNav,
    canForceRefresh,
    canManageUsers,
    canReadUsers,
    fetchAuthMe,
    applyAuthMe,
    clearAuthSession,
    hasPermission: (required: string | string[]) => hasPermission(permissions.value, required),
  };
}
