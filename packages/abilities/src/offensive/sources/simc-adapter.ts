import {
  CATALOG_GAME_VERSION,
  CATALOG_VERIFIED_AT,
  CURRENT_CATALOG_VERSION_ID,
} from "../../version.js";
import type { OffensiveSourceAdapter, OffensiveSourceSnapshot } from "./types.js";

/**
 * SimulationCraft advisory adapter.
 *
 * Prefer consuming a generated SpellDataDump / APL summary at build time rather
 * than vendoring SimC C++ sources. Default snapshot is empty until an operator
 * supplies `generated/offensive/source-snapshots/simc-advisory.json`.
 *
 * License: SimulationCraft is typically GPLv3 — do not copy implementation code
 * into this repository; consume generated ID lists only when license-compatible.
 */
export const simcAdvisoryAdapter: OffensiveSourceAdapter = {
  meta: {
    kind: "SIMC_ADVISORY",
    adapterId: "simc-spelldata-advisory",
    licenseNote:
      "SimulationCraft (typically GPLv3) — advisory generated spell/cooldown lists only; no SimC sources vendored.",
    mayProposeClassification: false,
  },

  loadSnapshot(input): OffensiveSourceSnapshot {
    return {
      meta: this.meta,
      gameVersion: input.gameVersion || CATALOG_GAME_VERSION,
      catalogVersion: input.catalogVersion || CURRENT_CATALOG_VERSION_ID,
      generatedAt: new Date().toISOString(),
      candidates: [],
    };
  },
};

/** Placeholder verified-at stamp for docs / reports. */
export const SIMC_ADAPTER_DOCUMENTED_AT = CATALOG_VERIFIED_AT;
