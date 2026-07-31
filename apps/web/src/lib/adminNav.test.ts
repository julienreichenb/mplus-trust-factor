import { describe, expect, it } from "vitest";
import {
  ADMIN_DESTINATIONS,
  hasAnyAuthorizedAdminDestination,
  isAdminRoutePath,
  isAuthorizedForAdminDestination,
  visibleAdminNavDestinations,
} from "./adminNav";

const CASES = [
  {
    permissions: ["admin.score_models.manage"],
    id: "score-models" as const,
    path: "/admin/models",
  },
  {
    permissions: ["admin.ability_catalog.read"],
    id: "ability-catalog" as const,
    path: "/admin/ability-catalog",
  },
  {
    permissions: ["admin.users.read"],
    id: "admin-users" as const,
    path: "/admin/users",
  },
  {
    permissions: ["admin.users.manage"],
    id: "admin-users" as const,
    path: "/admin/users",
  },
  {
    permissions: ["admin.jobs.manage"],
    id: "bulk-processing" as const,
    path: "/admin/bulk-processing",
  },
];

describe("admin destination registry", () => {
  it.each(CASES)(
    "navbar and route predicates agree for $path with $permissions",
    ({ permissions, id, path }) => {
      const visible = visibleAdminNavDestinations(permissions);
      expect(visible.map((d) => d.path)).toEqual([path]);
      expect(isAuthorizedForAdminDestination(id, permissions)).toBe(true);
      for (const destination of ADMIN_DESTINATIONS) {
        const expected = destination.id === id;
        expect(destination.isAuthorized(permissions)).toBe(expected);
        expect(isAuthorizedForAdminDestination(destination.id, permissions)).toBe(expected);
      }
    },
  );

  it("hides Admin trigger when no destination is authorized", () => {
    expect(visibleAdminNavDestinations(["admin.settings.manage"])).toEqual([]);
    expect(hasAnyAuthorizedAdminDestination(["admin.settings.manage"])).toBe(false);
    expect(hasAnyAuthorizedAdminDestination(["score.recalculate"])).toBe(false);
    expect(hasAnyAuthorizedAdminDestination([])).toBe(false);
  });

  it("returns all destinations when fully authorized", () => {
    const full = [
      "admin.score_models.manage",
      "admin.ability_catalog.read",
      "admin.users.read",
      "admin.jobs.manage",
    ];
    expect(visibleAdminNavDestinations(full).map((d) => d.path)).toEqual(
      ADMIN_DESTINATIONS.map((d) => d.path),
    );
  });
});

describe("isAdminRoutePath", () => {
  it("matches /admin and admin descendants only", () => {
    expect(isAdminRoutePath("/admin")).toBe(true);
    expect(isAdminRoutePath("/admin/")).toBe(true);
    expect(isAdminRoutePath("/admin/models")).toBe(true);
    expect(isAdminRoutePath("/admin/users")).toBe(true);
    expect(isAdminRoutePath("/admin/models?tab=draft")).toBe(true);
    expect(isAdminRoutePath("/admin/models#draft")).toBe(true);
    expect(isAdminRoutePath("/administrator")).toBe(false);
    expect(isAdminRoutePath("/account")).toBe(false);
    expect(isAdminRoutePath("/compare")).toBe(false);
  });
});
