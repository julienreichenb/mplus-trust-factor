import { hasPermission } from "./permissions";

export type AdminDestinationId =
  | "score-console"
  | "ability-catalog"
  | "admin-users"
  | "bulk-processing"
  | "admin-faq"
  | "admin-misc"
  /** @deprecated legacy ids kept for route meta redirects */
  | "score-models"
  | "score-tuning"
  | "calibration"
  | "ability-catalog-review"
  | "ability-catalog-releases";

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

const abilityCatalogAuthorized = (permissions: string[]) =>
  hasPermission(permissions, "admin.ability_catalog.read") ||
  hasPermission(permissions, "admin.ability_catalog.manage") ||
  hasPermission(permissions, "admin.ability_catalog.publish");

/**
 * Single source of truth for admin destinations.
 * Navbar visibility and router guards both use `isAuthorized`.
 *
 * Scoring product surface: one “Scoring” console with Models / Tuning / Calibration tabs.
 * Ability catalog: one console with Catalog / Review / Releases tabs.
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
    isAuthorized: abilityCatalogAuthorized,
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
    id: "admin-faq",
    name: "admin-faq",
    path: "/admin/faq",
    label: "FAQ",
    isAuthorized: (permissions) => hasPermission(permissions, "admin.settings.manage"),
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

const LEGACY_TO_CANONICAL: Partial<Record<AdminDestinationId, AdminDestinationId>> = {
  "score-models": "score-console",
  "score-tuning": "score-console",
  calibration: "score-console",
  "ability-catalog-review": "ability-catalog",
  "ability-catalog-releases": "ability-catalog",
};

export function getAdminDestination(id: AdminDestinationId): AdminDestination {
  const canonicalId = LEGACY_TO_CANONICAL[id] ?? id;
  const destination = ADMIN_DESTINATIONS.find((entry) => entry.id === canonicalId);
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
  if (pathname === "/admin/ability-catalog" || pathname.startsWith("/admin/ability-catalog/")) {
    return getAdminDestination("ability-catalog");
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
