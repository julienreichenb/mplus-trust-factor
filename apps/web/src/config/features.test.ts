import { afterEach, describe, expect, it } from "vitest";
import { resolveFeatureFlags, resetFeatureFlagsCache } from "./features";

describe("feature flags", () => {
  afterEach(() => {
    resetFeatureFlagsCache();
  });

  it("uses safe production defaults", () => {
    expect(resolveFeatureFlags({})).toEqual({
      wowheadLinksEnabled: false,
      wowheadTooltipsEnabled: false,
      characterMediaEnabled: true,
      adminCalibrationEnabled: false,
    });
  });

  it("parses explicit boolean-like values", () => {
    expect(
      resolveFeatureFlags({
        VITE_WOWHEAD_LINKS_ENABLED: "false",
        VITE_WOWHEAD_TOOLTIPS_ENABLED: "1",
        VITE_CHARACTER_MEDIA_ENABLED: "off",
        VITE_ADMIN_CALIBRATION_ENABLED: "true",
      }),
    ).toEqual({
      wowheadLinksEnabled: false,
      wowheadTooltipsEnabled: true,
      characterMediaEnabled: false,
      adminCalibrationEnabled: true,
    });
  });

  it("ignores invalid values and keeps defaults", () => {
    expect(
      resolveFeatureFlags({
        VITE_WOWHEAD_LINKS_ENABLED: "maybe",
        VITE_WOWHEAD_TOOLTIPS_ENABLED: "maybe",
        VITE_CHARACTER_MEDIA_ENABLED: "maybe",
        VITE_ADMIN_CALIBRATION_ENABLED: "maybe",
      }),
    ).toEqual({
      wowheadLinksEnabled: false,
      wowheadTooltipsEnabled: false,
      characterMediaEnabled: true,
      adminCalibrationEnabled: false,
    });
  });
});
