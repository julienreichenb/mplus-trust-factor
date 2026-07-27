/**
 * Shared helpers for manually invoked live provider smoke commands.
 * Cross-platform Node ESM — no Unix-only shell syntax.
 */

const SENSITIVE_KEY =
  /secret|password|token|authorization|cookie|api[_-]?key|client[_-]?id|client[_-]?secret|session|bearer/i;

/**
 * @typedef {{ region: string, realm: string, name: string }} SmokeIdentity
 */

/**
 * @param {string | undefined} value
 * @param {boolean} defaultValue
 */
export function envFlag(value, defaultValue = true) {
  if (value === undefined || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

/**
 * Refuse unless ALLOW_LIVE_PROVIDER_CALLS is an explicit truthy opt-in.
 * @returns {void}
 */
export function assertLiveCallsAllowed() {
  if (!envFlag(process.env.ALLOW_LIVE_PROVIDER_CALLS, false)) {
    console.error(
      "REFUSED: live smoke requires ALLOW_LIVE_PROVIDER_CALLS=true (never enable this in CI).",
    );
    process.exit(2);
  }
}

/**
 * Parse `--region`, `--realm`, `--name` from argv. No default player identity is embedded.
 * @param {string[]} argv
 * @returns {{ region: string, realm: string, name: string }}
 */
export function parseIdentityArgs(argv = process.argv.slice(2)) {
  /** @type {Record<string, string>} */
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    flags[key] = next;
    i += 1;
  }

  const region = flags.region?.trim();
  const realm = flags.realm?.trim();
  const name = flags.name?.trim();

  if (!region || !realm || !name) {
    throw new Error(
      "Usage: --region <EU|US|KR|TW> --realm <canonical-realm-slug> --name <exact-character-name>",
    );
  }

  const normalizedRegion = region.toUpperCase();
  if (!["EU", "US", "KR", "TW"].includes(normalizedRegion)) {
    throw new Error(`Unsupported region "${region}". Use EU, US, KR, or TW.`);
  }

  return { region: normalizedRegion, realm: realm.toLowerCase(), name };
}

/**
 * CLI wrapper: parse identity or exit non-zero.
 * @param {string[]} [argv]
 */
export function requireIdentityArgs(argv = process.argv.slice(2)) {
  try {
    return parseIdentityArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}

/**
 * Deep-redact sensitive keys from plain objects before printing.
 * @param {unknown} value
 * @returns {unknown}
 */
export function redactForOutput(value) {
  if (Array.isArray(value)) {
    return value.map((item) => redactForOutput(item));
  }
  if (value && typeof value === "object") {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? "[Redacted]" : redactForOutput(child);
    }
    return out;
  }
  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [Redacted]")
      .replace(/("?(?:client_secret|access_token|refresh_token|api_key)"?\s*[:=]\s*")[^"]+"/gi, '$1[Redacted]"');
  }
  return value;
}

/**
 * Print a JSON summary with secrets redacted.
 * @param {string} label
 * @param {unknown} payload
 */
export function printRedacted(label, payload) {
  console.log(label);
  console.log(JSON.stringify(redactForOutput(payload), null, 2));
}

/**
 * Env-only boolean/mode summary for smoke scripts — never prints credential values.
 */
export function printEnvModeSummary() {
  printRedacted("config", {
    providerMode: process.env.PROVIDER_MODE ?? "fixture",
    allowLiveProviderCalls: process.env.ALLOW_LIVE_PROVIDER_CALLS ?? "false",
    blizzardEnabled: process.env.BLIZZARD_ENABLED ?? "true",
    wclEnabled: process.env.WCL_ENABLED ?? "true",
    raiderioEnabled: process.env.RAIDERIO_ENABLED ?? "true",
    blizzardCredentialsConfigured: Boolean(
      process.env.BLIZZARD_CLIENT_ID && process.env.BLIZZARD_CLIENT_SECRET,
    ),
    wclCredentialsConfigured: Boolean(process.env.WCL_CLIENT_ID && process.env.WCL_CLIENT_SECRET),
    raiderioAppKeyConfigured: Boolean(process.env.RAIDERIO_APP_KEY),
  });
}
