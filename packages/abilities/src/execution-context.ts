/**
 * Process-local AsyncLocalStorage seam for one AbilityCatalogContext per analysis.
 * Node/worker only — do not import from browser bundles.
 * When set, registry lookups delegate to this context.
 * Production traffic leaves ALS empty → static RETAIL_ABILITY_CATALOG authority.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { AbilityCatalogContext } from "./catalog-context.js";
import { setAbilityCatalogContextGetter } from "./catalog-context-holder.js";

const als = new AsyncLocalStorage<AbilityCatalogContext>();

setAbilityCatalogContextGetter(() => als.getStore() ?? null);

export function getActiveAbilityCatalogContext(): AbilityCatalogContext | null {
  return als.getStore() ?? null;
}

export function runWithAbilityCatalogContext<T>(
  context: AbilityCatalogContext,
  fn: () => T,
): T {
  return als.run(context, fn);
}

export async function runWithAbilityCatalogContextAsync<T>(
  context: AbilityCatalogContext,
  fn: () => Promise<T>,
): Promise<T> {
  return als.run(context, fn);
}
