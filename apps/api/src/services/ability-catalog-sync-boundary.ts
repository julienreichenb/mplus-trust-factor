/**
 * API boundary for Ability Catalog source sync.
 * Production/staging must never execute SimC inside the API process.
 */

import type { AppEnv } from "@mplus/config";
import { HttpError } from "../errors.js";

const API_SIMC_ALLOWED_ENVS = new Set(["development", "test"]);

export function assertApiCatalogSimcRefreshAllowed(appEnv: AppEnv["APP_ENV"]): void {
  if (API_SIMC_ALLOWED_ENVS.has(appEnv)) return;
  throw HttpError.forbidden(
    "CATALOG_SYNC_NOT_VIA_API",
    "Ability Catalog source sync must run via the catalog-sync one-shot container, not the API process. " +
      "Use: docker compose --profile catalog-sync run --rm catalog-sync",
  );
}

export function isApiCatalogSimcRefreshAllowed(appEnv: AppEnv["APP_ENV"]): boolean {
  return API_SIMC_ALLOWED_ENVS.has(appEnv);
}
