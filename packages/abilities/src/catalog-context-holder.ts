/**
 * Browser-safe catalog context holder (no node:async_hooks).
 * Node workers install an AsyncLocalStorage-backed getter via execution-context.ts.
 */

import type { AbilityCatalogContext } from "./catalog-context.js";

type ContextGetter = () => AbilityCatalogContext | null;

let getter: ContextGetter = () => null;

/** Install process-local context resolution (worker/Node only). */
export function setAbilityCatalogContextGetter(next: ContextGetter): void {
  getter = next;
}

export function getActiveAbilityCatalogContext(): AbilityCatalogContext | null {
  return getter();
}
