import { hasPermission } from "./permissions";

export type AdminDestinationId =
  | "score-console"
  | "ability-catalog"
  | "admin-users"
  | "bulk-processing"
  | "admin-misc"
  /** @deprecated legacy ids kept for route meta redirects */
  | "score-models"
  | "score-tuning"
  | "calibration";

export interface AdminDestination {
  id: AdminDestinationId;
  /** Vue Router route name */
  name: string;
  path: string;
  label: string;
  /** Same predicate for navbar visibility and route-guard authorization. */
  isAuthorized: (permissions: string[]) => boolean;
}

const scoringAuthorized = (permissions: string[]) =>
  hasPermission(permissions, "admin.score_models.manage") ||
  hasPermission(permissions, "admin.calibration.manage");

/**
 * Single source of truth for admin destinations.
 * Navbar visibility and router guards both use `isAuthorized`.
 *
 * Scoring product surface: one “Scoring” console with Models / Tuning / Calibration tabs.
 */
export const ADMIN_DESTINATIONS: readonly AdminDestination[] = [
  {
    id: "score-console",
    name: "admin-scoring",
    path: "/admin/scoring",
    label: "Scoring",
    isAuthorized: scoringAuthorized,
  },
  {
    id: "ability-catalog",
    name: "admin-ability-catalog",
    path: "/admin/ability-catalog",
    label: "Ability catalog",
    isAuthorized: (permissions) => hasPermission(permissions, "admin.ability_catalog.read"),
  },
  {
    id: "admin-users",
    name: "admin-users",
    path: "/admin/users",
    label: "Admin users",
    isAuthorized: (permissions) =>
      hasPermission(permissions, "admin.users.read") ||
      hasPermission(permissions, "admin.users.manage"),
  },
  {
    id: "bulk-processing",
    name: "admin-bulk-processing",
    path: "/admin/bulk-processing",
    label: "Bulk processing",
    isAuthorized: (permissions) => hasPermission(permissions, "admin.jobs.manage"),
  },
  {
    id: "admin-misc",
    name: "admin-misc",
    path: "/admin/misc",
    label: "Misc tools",
    isAuthorized: (permissions) => hasPermission(permissions, "admin.settings.manage"),
  },
];

/** @deprecated Prefer ADMIN_DESTINATIONS — kept as an alias for existing imports. */
export const ADMIN_NAV_DESTINATIONS = ADMIN_DESTINATIONS;

const LEGACY_SCORING_IDS: AdminDestinationId[] = [
  "score-models",
  "score-tuning",
  "calibration",
];

export function getAdminDestination(id: AdminDestinationId): AdminDestination {
  if (LEGACY_SCORING_IDS.includes(id)) {
    return ADMIN_DESTINATIONS.find((entry) => entry.id === "score-console")!;
  }
  const destination = ADMIN_DESTINATIONS.find((entry) => entry.id === id);
  if (!destination) {
    throw new Error(`Unknown admin destination: ${id}`);
  }
  return destination;
}

export function findAdminDestinationByPath(path: string): AdminDestination | undefined {
  const pathname = normalizePathname(path);
  if (
    pathname === "/admin/scoring" ||
    pathname.startsWith("/admin/scoring/") ||
    pathname === "/admin/models" ||
    pathname === "/admin/tuning" ||
    pathname.startsWith("/admin/calibration")
  ) {
    return getAdminDestination("score-console");
  }
  return ADMIN_DESTINATIONS.find((destination) => destination.path === pathname);
}

export function isAuthorizedForAdminDestination(
  id: AdminDestinationId,
  permissions: string[] | undefined,
): boolean {
  return getAdminDestination(id).isAuthorized(permissions ?? []);
}

export function visibleAdminNavDestinations(
  permissions: string[] | undefined,
): AdminDestination[] {
  const perms = permissions ?? [];
  return ADMIN_DESTINATIONS.filter((destination) => destination.isAuthorized(perms));
}

/** True when at least one admin destination is authorized (Admin trigger visibility). */
export function hasAnyAuthorizedAdminDestination(permissions: string[] | undefined): boolean {
  return visibleAdminNavDestinations(permissions).length > 0;
}

/** True for `/admin` and `/admin/...` only — not similarly named paths like `/administrator`. */
export function isAdminRoutePath(path: string): boolean {
  const pathname = normalizePathname(path);
  if (pathname === "/admin") return true;
  return pathname.startsWith("/admin/");
}

function normalizePathname(path: string): string {
  const pathname = (path.split(/[?#]/, 1)[0] ?? path).replace(/\/+$/, "") || "/";
  return pathname;
}
