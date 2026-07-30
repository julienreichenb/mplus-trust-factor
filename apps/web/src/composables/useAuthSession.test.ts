import { describe, expect, it } from "vitest";
import { hasAdminNavPermission, hasPermission } from "./useAuthSession";

describe("useAuthSession helpers", () => {
  it("hides admin navigation for users without admin permissions", () => {
    expect(hasAdminNavPermission([])).toBe(false);
    expect(hasAdminNavPermission(["profile.refresh.request"])).toBe(false);
  });

  it("shows admin navigation when admin permissions are present", () => {
    expect(hasAdminNavPermission(["admin.users.read"])).toBe(true);
    expect(hasAdminNavPermission(["admin.score_models.manage"])).toBe(true);
  });

  it("checks force refresh permission explicitly", () => {
    expect(hasPermission(["profile.refresh.request"], "profile.refresh.force")).toBe(false);
    expect(
      hasPermission(["profile.refresh.request", "profile.refresh.force"], "profile.refresh.force"),
    ).toBe(true);
  });
});
