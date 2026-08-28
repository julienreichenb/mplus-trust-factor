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
    paths: ["/admin/scoring"],
  },
  {
    permissions: ["admin.calibration.manage"],
    paths: ["/admin/scoring"],
  },
  {
    permissions: ["admin.ability_catalog.read"],
    paths: ["/admin/ability-catalog"],
  },
  {
    permissions: ["admin.ability_catalog.publish"],
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
    paths: ["/admin/faq", "/admin/misc"],
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

  it("exposes a single Scoring destination with Models/Tuning/Calibration as console tabs", () => {
    const labels = ADMIN_DESTINATIONS.map((d) => d.label);
    expect(labels).toContain("Scoring");
    expect(labels).not.toContain("Models");
    expect(labels).not.toContain("Tuning");
    expect(labels).not.toContain("Calibration");
    expect(labels.join(" ")).not.toMatch(/Scoring V2/i);
    expect(labels.join(" ")).not.toMatch(/Control Center/i);
    expect(ADMIN_DESTINATIONS.find((d) => d.path === "/admin/scoring")?.id).toBe("score-console");
  });

  it("exposes a single Ability catalog destination with Catalog/Review/Releases as console tabs", () => {
    const labels = ADMIN_DESTINATIONS.map((d) => d.label);
    expect(labels).toContain("Ability catalog");
    expect(labels).not.toContain("Ability review");
    expect(labels).not.toContain("Ability releases");
    expect(ADMIN_DESTINATIONS.find((d) => d.path === "/admin/ability-catalog")?.id).toBe(
      "ability-catalog",
    );
    expect(isAuthorizedForAdminDestination("ability-catalog-review", ["admin.ability_catalog.read"])).toBe(
      true,
    );
    expect(
      isAuthorizedForAdminDestination("ability-catalog-releases", ["admin.ability_catalog.publish"]),
    ).toBe(true);
  });

  it("hides Admin trigger when no destination is authorized", () => {
    expect(visibleAdminNavDestinations(["score.recalculate"])).toEqual([]);
    expect(hasAnyAuthorizedAdminDestination(["score.recalculate"])).toBe(false);
  });

  it("shows scoring console with calibration or score_models permission", () => {
    expect(isAuthorizedForAdminDestination("calibration", ["admin.calibration.manage"])).toBe(
      true,
    );
    expect(isAuthorizedForAdminDestination("calibration", ["admin.score_models.manage"])).toBe(
      true,
    );
    expect(isAuthorizedForAdminDestination("score-console", ["admin.score_models.manage"])).toBe(
      true,
    );
  });
});

describe("isAdminRoutePath", () => {
  it("matches /admin and admin descendants only", () => {
    expect(isAdminRoutePath("/admin")).toBe(true);
    expect(isAdminRoutePath("/admin/scoring")).toBe(true);
    expect(isAdminRoutePath("/admin/scoring/models")).toBe(true);
    expect(isAdminRoutePath("/administrator")).toBe(false);
  });
});
