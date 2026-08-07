import { afterEach, describe, expect, it } from "vitest";
import {
  ADMIN_DESTINATIONS,
  hasAnyAuthorizedAdminDestination,
  isAdminRoutePath,
  isAuthorizedForAdminDestination,
  visibleAdminNavDestinations,
} from "./adminNav";
import { resetFeatureFlagsCache } from "../config/features";

afterEach(() => {
  resetFeatureFlagsCache();
});

const CASES = [
  {
    permissions: ["admin.score_models.manage"],
    paths: ["/admin/models", "/admin/tuning"],
  },
  {
    permissions: ["admin.calibration.manage"],
    paths: ["/admin/calibration"],
  },
  {
    permissions: ["admin.ability_catalog.read"],
    paths: ["/admin/ability-catalog"],
  },
  {
    permissions: ["admin.users.read"],
    paths: ["/admin/users"],
  },
  {
    permissions: ["admin.jobs.manage"],
    paths: ["/admin/bulk-processing"],
  },
  {
    permissions: ["admin.settings.manage"],
    paths: ["/admin/misc"],
  },
];

describe("admin destination registry", () => {
  it.each(CASES)(
    "navbar shows $paths for $permissions",
    ({ permissions, paths }) => {
      const visible = visibleAdminNavDestinations(permissions);
      expect(visible.map((d) => d.path)).toEqual(paths);
    },
  );

  it("exposes Models / Tuning / Calibration labels without Scoring V2 terminology", () => {
    const labels = ADMIN_DESTINATIONS.map((d) => d.label);
    expect(labels).toContain("Models");
    expect(labels).toContain("Tuning");
    expect(labels).toContain("Calibration");
    expect(labels.join(" ")).not.toMatch(/Scoring V2/i);
    expect(labels.join(" ")).not.toMatch(/Control Center/i);
    expect(ADMIN_DESTINATIONS.find((d) => d.path === "/admin/scoring")).toBeUndefined();
  });

  it("hides Admin trigger when no destination is authorized", () => {
    expect(visibleAdminNavDestinations(["score.recalculate"])).toEqual([]);
    expect(hasAnyAuthorizedAdminDestination(["score.recalculate"])).toBe(false);
  });

  it("shows calibration with permission (no feature-flag gate)", () => {
    expect(isAuthorizedForAdminDestination("calibration", ["admin.calibration.manage"])).toBe(
      true,
    );
  });
});

describe("isAdminRoutePath", () => {
  it("matches /admin and admin descendants only", () => {
    expect(isAdminRoutePath("/admin")).toBe(true);
    expect(isAdminRoutePath("/admin/models")).toBe(true);
    expect(isAdminRoutePath("/admin/tuning")).toBe(true);
    expect(isAdminRoutePath("/administrator")).toBe(false);
  });
});
