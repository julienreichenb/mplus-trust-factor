import { existsSync } from "node:fs";
import { platform } from "node:os";

/** Linux catalog-refresh runner / container convention (not a filesystem scan). */
export const BUNDLED_LINUX_SIMC_PATH = "/usr/local/bin/simc";

export class SimcNotConfiguredError extends Error {
  readonly code = "SIMC_NOT_CONFIGURED";
  constructor(message: string) {
    super(message);
    this.name = "SimcNotConfiguredError";
  }
}

export interface ResolveCatalogSimcBinaryInput {
  /** Explicit operator/dev override (e.g. ABILITY_CATALOG_SIMC_BIN). */
  overridePath?: string | null;
  /** Platform override for tests (`win32` | `linux` | …). Defaults to `os.platform()`. */
  platform?: NodeJS.Platform;
  /** Injected exists check for tests. */
  existsSync?: (path: string) => boolean;
}

export interface ResolvedCatalogSimcBinary {
  path: string;
  source: "OVERRIDE" | "BUNDLED_DEFAULT";
}

/**
 * Single resolution path for catalog-refresh SimC.
 * 1. explicit override if configured and present
 * 2. bundled Linux default `/usr/local/bin/simc` when on Linux and present
 * 3. fail SIMC_NOT_CONFIGURED
 *
 * Never scans the filesystem. Windows has no magic default.
 */
export function resolveCatalogSimcBinary(
  input: ResolveCatalogSimcBinaryInput = {},
): ResolvedCatalogSimcBinary {
  const exists = input.existsSync ?? existsSync;
  const plat = input.platform ?? platform();
  const override = input.overridePath?.trim() || null;

  if (override) {
    if (!exists(override)) {
      throw new SimcNotConfiguredError(
        `SimulationCraft binary not found at configured path: ${override}. ` +
          `Set ABILITY_CATALOG_SIMC_BIN to a valid simc executable for local development, ` +
          `or install/use the bundled catalog-refresh runner.`,
      );
    }
    return { path: override, source: "OVERRIDE" };
  }

  if (plat === "linux" && exists(BUNDLED_LINUX_SIMC_PATH)) {
    return { path: BUNDLED_LINUX_SIMC_PATH, source: "BUNDLED_DEFAULT" };
  }

  throw new SimcNotConfiguredError(
    "SimulationCraft is not available for catalog refresh. Configure " +
      "ABILITY_CATALOG_SIMC_BIN for local development or install/use the bundled " +
      "catalog-refresh runner.",
  );
}
