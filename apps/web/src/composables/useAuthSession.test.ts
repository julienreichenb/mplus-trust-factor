import { describe, expect, it } from "vitest";
import { hasAdminNavPermission, hasPermission } from "./useAuthSession";

describe("useAuthSession helpers", () => {
  it("hides admin navigation for users without destination permissions", () => {
    expect(hasAdminNavPermission([])).toBe(false);
    expect(hasAdminNavPermission(["profile.refresh.request"])).toBe(false);
    expect(hasAdminNavPermission(["admin.settings.manage"])).toBe(true);
    expect(hasAdminNavPermission(["score.recalculate"])).toBe(false);
  });

  it("shows admin navigation when a destination permission is present", () => {
    expect(hasAdminNavPermission(["admin.users.read"])).toBe(true);
    expect(hasAdminNavPermission(["admin.score_models.manage"])).toBe(true);
    expect(hasAdminNavPermission(["admin.ability_catalog.read"])).toBe(true);
    expect(hasAdminNavPermission(["admin.jobs.manage"])).toBe(true);
  });

  it("checks force refresh permission explicitly", () => {
    expect(hasPermission(["profile.refresh.request"], "profile.refresh.force")).toBe(false);
    expect(
      hasPermission(["profile.refresh.request", "profile.refresh.force"], "profile.refresh.force"),
    ).toBe(true);
  });
});
