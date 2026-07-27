#!/usr/bin/env node
/**
 * Warcraft Logs live smoke entrypoint (`pnpm wcl:smoke`).
 * Delegates to live-smoke-wcl.mjs (shallow OAuth/character or --deep diagnostic).
 * Requires ALLOW_LIVE_PROVIDER_CALLS=true.
 *
 *   pnpm wcl:smoke -- --region EU --realm archimonde --name Wallidrixe
 *   pnpm wcl:smoke -- --region EU --realm archimonde --name Wallidrixe --deep
 */
import "./live-smoke-wcl.mjs";
