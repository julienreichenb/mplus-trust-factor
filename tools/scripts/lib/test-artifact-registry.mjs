/**
 * Authoritative allowlist of automated-test durable markers.
 * Derived from repository test suites — exact formats only.
 *
 * Rules:
 * - Prefer exact regexes that include the random/UUID suffix shape tests generate.
 * - Never treat generic words (Bulk, Force, Hist, Prio, Wallidrixe, Chérith) alone as ownership.
 * - Compound evidence is required for deletion (see cleanup classifiers).
 * - `model-activate:` and `discover:` are NOT test-exclusive alone.
 */

export const CANONICAL_SCORE_MODEL_KEYS = Object.freeze(["default"]);

/** Score model `key` prefixes — tests always append random suffixes. */
export const TEST_SCORE_MODEL_KEY_PREFIXES = Object.freeze([
  "admin-test-",
  "life-arch-",
  "life-inv-",
  "life-act-",
  "life-race-",
  "life-bt-",
  "life-bad-",
  "life-boot-",
  "life-v6-",
  "life-del-",
  "alt-model-",
  "bulk-model-",
  "pub-cancel-model-",
]);

/**
 * Exact character identity patterns (displayName / normalizedName).
 * Each must match the full fixture format including random suffix.
 * @type {ReadonlyArray<{ id: string, displayName: RegExp, normalizedName?: RegExp }>}
 */
export const TEST_CHARACTER_IDENTITY_PATTERNS = Object.freeze([
  // routes.admin-refresh-jobs: AdminRefresh${4hex} / adminrefresh${6hex}
  {
    id: "AdminRefresh",
    displayName: /^AdminRefresh[0-9a-f]{4}$/,
    normalizedName: /^adminrefresh[0-9a-f]{6}$/,
  },
  // publication-cancel-race: PubCancel${label}
  {
    id: "PubCancel",
    displayName: /^PubCancel[a-z0-9-]{3,32}$/,
    normalizedName: /^pubcancel[0-9a-f]{8}$/,
  },
  // bulk-persistence: Bulk${6hex}, Hist${6hex}
  { id: "BulkHex", displayName: /^Bulk[0-9a-f]{6}$/, normalizedName: /^bulk[0-9a-f]{6}$/ },
  { id: "HistHex", displayName: /^Hist[0-9a-f]{6}$/, normalizedName: /^hist[0-9a-f]{6}$/ },
  // admin-bulk: BulkUx${timestamp}
  { id: "BulkUx", displayName: /^BulkUx\d{10,16}$/, normalizedName: /^bulkux\d{10,16}$/ },
  // iam: Iamcd${6hex}
  { id: "Iamcd", displayName: /^Iamcd[0-9a-f]{6}$/, normalizedName: /^iamcd[0-9a-f]{6}$/ },
  // admin-users force target: Force${6hex} (NOT bare "Force")
  { id: "ForceHex", displayName: /^Force[0-9a-f]{6}$/, normalizedName: /^force[0-9a-f]{6}$/ },
  // uniqueName("X") → X-<8hex>
  { id: "Freshcharacter", displayName: /^Freshcharacter-[0-9a-f]{8}$/i },
  { id: "Stalecharacter", displayName: /^Stalecharacter-[0-9a-f]{8}$/i },
  { id: "LastPublicOnly", displayName: /^LastPublicOnly-[0-9a-f]{8}$/i },
  { id: "ReuseStaleJob", displayName: /^ReuseStaleJob-[0-9a-f]{8}$/i },
  { id: "MissingCharacter", displayName: /^MissingCharacter-[0-9a-f]{8}$/i },
  { id: "Cooldowncharacter", displayName: /^Cooldowncharacter-[0-9a-f]{8}$/i },
  { id: "JobLookupCharacter", displayName: /^JobLookupCharacter-[0-9a-f]{8}$/i },
  { id: "SecondRefresh", displayName: /^SecondRefresh-[0-9a-f]{8}$/i },
  { id: "ConcurrentRefresh", displayName: /^ConcurrentRefresh-[0-9a-f]{8}$/i },
  { id: "EnrichmentFields", displayName: /^EnrichmentFields-[0-9a-f]{8}$/i },
  { id: "RefreshPollTerminal", displayName: /^RefreshPollTerminal-[0-9a-f]{8}$/i },
  { id: "NormalRefreshOk", displayName: /^NormalRefreshOk-[0-9a-f]{8}$/i },
  { id: "ForceDenied", displayName: /^ForceDenied-[0-9a-f]{8}$/i },
  { id: "ForceAdminOk", displayName: /^ForceAdminOk-[0-9a-f]{8}$/i },
  { id: "StaleOnceMore", displayName: /^StaleOnceMore-[0-9a-f]{8}$/i },
  { id: "RerollAnon", displayName: /^RerollAnon-[0-9a-f]{8}$/i },
  { id: "RerollViewer", displayName: /^RerollViewer-[0-9a-f]{8}$/i },
  { id: "MainA", displayName: /^MainA-[0-9a-f]{8}$/i },
  { id: "AltA", displayName: /^AltA-[0-9a-f]{8}$/i },
  { id: "OnlyB", displayName: /^OnlyB-[0-9a-f]{8}$/i },
  { id: "AcNxx", displayName: /^Ac[0-9]xx-[0-9a-f]{8}$/i },
  { id: "LowLevelResolve", displayName: /^LowLevelResolve-[0-9a-f]{8}$/i },
  { id: "AdminRecalcTarget", displayName: /^AdminRecalcTarget-[0-9a-f]{8}$/i },
  { id: "CompareA", displayName: /^CompareA-[0-9a-f]{8}$/i },
  { id: "CompareB", displayName: /^CompareB-[0-9a-f]{8}$/i },
  { id: "RankEligA", displayName: /^RankEligA-[0-9a-f]{8}$/i },
  { id: "RankEligB", displayName: /^RankEligB-[0-9a-f]{8}$/i },
  { id: "MismatchA", displayName: /^MismatchA-[0-9a-f]{8}$/i },
  { id: "MismatchB", displayName: /^MismatchB-[0-9a-f]{8}$/i },
  { id: "DisabledBlizzardChar", displayName: /^DisabledBlizzardChar-[0-9a-f]{8}$/i },
  { id: "DisabledBlizzardStatus", displayName: /^DisabledBlizzardStatus-[0-9a-f]{8}$/i },
  { id: "Examplecharacter", displayName: /^Examplecharacter-[0-9a-f]{8}$/i },
  { id: "DisabledProviderChar", displayName: /^DisabledProviderChar-[0-9a-f]{8}$/i },
  { id: "NoRaiderIo", displayName: /^NoRaiderIo-[0-9a-f]{8}$/i },
  { id: "RioFail", displayName: /^RioFail-[0-9a-f]{8}$/i },
  { id: "disabled-test", displayName: /^disabled-test-[0-9a-f]{8}$/i },
  { id: "DedupeChar", displayName: /^DedupeChar-[0-9a-f]{8}$/i },
  { id: "RequeueChar", displayName: /^RequeueChar-[0-9a-f]{8}$/i },
  { id: "InvalidSnap", displayName: /^InvalidSnap-[0-9a-f]{8}$/i },
  { id: "NoPublicLogs", displayName: /^NoPublicLogs-[0-9a-f]{8}$/i },
  { id: "AsyncWclOnly", displayName: /^AsyncWclOnly-[0-9a-f]{8}$/i },
  { id: "WclParseFail", displayName: /^WclParseFail-[0-9a-f]{8}$/i },
  { id: "UnexpectedFail", displayName: /^UnexpectedFail-[0-9a-f]{8}$/i },
  // E2E / integration — never bare realistic names
  { id: "E2eApiA", displayName: /^E2eApiA-[0-9a-f]{8}$/i },
  { id: "E2eApiB", displayName: /^E2eApiB-[0-9a-f]{8}$/i },
  { id: "E2eplayerA", displayName: /^E2eplayerA-[0-9a-z]{4,16}$/i },
  { id: "E2eplayerB", displayName: /^E2eplayerB-[0-9a-z]{4,16}$/i },
  // wallidrixe regression only when suffix is present (never bare "Wallidrixe")
  { id: "WallidrixeSuffix", displayName: /^Wallidrixe-[0-9a-f-]{8,40}$/i },
]);

/** Realm slugs created exclusively by tests. */
export const TEST_REALM_SLUGS = Object.freeze([
  "admin-refresh-realm",
  "pub-cancel-realm",
  "iam-test-realm",
]);
export const TEST_REALM_SLUG_PREFIXES = Object.freeze(["bulk-ux-"]);
export const TEST_DUNGEON_SLUG_PREFIXES = Object.freeze(["admin-test-dungeon-"]);
export const TEST_SEASON_SLUGS = Object.freeze(["pub-cancel-season"]);

/**
 * Exclusive IngestionJob.dedupeKey patterns (full-string).
 * Production dedupe keys are SHA-256 hex and will not match.
 * `discover:` and `model-activate:` are intentionally ABSENT — not exclusive alone.
 */
export const TEST_INGESTION_DEDUPE_KEY_PATTERNS = Object.freeze([
  { id: "refresh:old:", re: /^refresh:old:[0-9a-f-]{8,64}$/i },
  { id: "refresh:new:", re: /^refresh:new:[0-9a-f-]{8,64}$/i },
  { id: "refresh:queued:", re: /^refresh:queued:[0-9a-f-]{8,64}$/i },
  { id: "refresh:model:", re: /^refresh:model:[0-9a-f-]{8,64}$/i },
  { id: "refresh:nomodel:", re: /^refresh:nomodel:[0-9a-f-]{8,64}$/i },
  { id: "admin-prio-", re: /^admin-prio-[0-9a-f-]{8,64}$/i },
  { id: "stub-", re: /^stub-[0-9a-f-]{8,64}$/i },
  { id: "stub-bulk-", re: /^stub-bulk-[0-9a-f-]{8,64}$/i },
  { id: "test-reuse-", re: /^test-reuse-[0-9a-f-]{8,64}$/i },
  { id: "force-reuse-", re: /^force-reuse-[0-9a-f-]{8,64}$/i },
  { id: "concurrent-", re: /^concurrent-[0-9a-f-]{8,64}$/i },
  { id: "bulk-child-", re: /^bulk-child-[0-9a-f-]{8,64}$/i },
  { id: "pub-cancel-", re: /^pub-cancel-[0-9a-f-]{8,64}$/i },
  { id: "test-dedupe-", re: /^test-dedupe-[0-9a-f-]{8,64}$/i },
]);

/**
 * Exclusive payload.name patterns (full-string).
 * Bare "Prio" alone is insufficient — classifiers require compound evidence.
 */
export const TEST_INGESTION_PAYLOAD_NAME_PATTERNS = Object.freeze([
  { id: "FailChar", re: /^FailChar[0-9a-f]{4}$/ },
  { id: "QueuedChar", re: /^QueuedChar$/ },
  { id: "ModelChar", re: /^ModelChar$/ },
  { id: "NoModelChar", re: /^NoModelChar$/ },
  { id: "Prio", re: /^Prio$/ },
  { id: "NormalRefreshOk", re: /^NormalRefreshOk-[0-9a-f]{8}$/i },
  { id: "StaleOnceMore", re: /^StaleOnceMore-[0-9a-f]{8}$/i },
  { id: "E2eApiA", re: /^E2eApiA-[0-9a-f]{8}$/i },
  { id: "E2eApiB", re: /^E2eApiB-[0-9a-f]{8}$/i },
  { id: "E2eplayerA", re: /^E2eplayerA-[0-9a-z]{4,16}$/i },
  { id: "E2eplayerB", re: /^E2eplayerB-[0-9a-z]{4,16}$/i },
  { id: "AdminRefresh", re: /^AdminRefresh[0-9a-f]{4}$/ },
]);

/**
 * BulkOperation.logicalKey patterns that are test-exclusive alone.
 * `model-activate:` is NOT listed — requires referenced ScoreModel to be test-owned.
 */
export const TEST_BULK_LOGICAL_KEY_PATTERNS = Object.freeze([
  { id: "test-bulk-", re: /^test-bulk-[0-9a-f-]{4,64}$/i },
  { id: "pause-cancel-", re: /^pause-cancel-[0-9a-f-]{4,64}$/i },
  { id: "missing-chars-", re: /^missing-chars-[0-9a-f-]{4,64}$/i },
  { id: "explicit-", re: /^explicit-[0-9a-f-]{4,64}$/i },
  { id: "race-bulk-", re: /^race-bulk-[0-9a-f-]{4,64}$/i },
  { id: "concurrent-", re: /^concurrent-[0-9a-f-]{4,64}$/i },
  { id: "paused-terminal-", re: /^paused-terminal-[0-9a-f-]{4,64}$/i },
  { id: "counters-", re: /^counters-[0-9a-f-]{4,64}$/i },
  { id: "childjob-", re: /^childjob-[0-9a-f-]{4,64}$/i },
  { id: "fk-", re: /^fk-[0-9a-f-]{4,64}$/i },
  { id: "test-in-use-", re: /^test-in-use-[0-9a-f-]{4,64}$/i },
]);

export const TEST_MECHANIC_RULE_SOURCES = Object.freeze(["test-fixture"]);

export const TEST_USER_EXTERNAL_SUBJECT_PREFIXES = Object.freeze([
  "force-denied-",
  "reroll-viewer-",
  "reroll-a-",
  "reroll-b-",
  "redis-loss-",
  "bulk-user-",
  "subj-normal-",
  "subj-boss-",
  "subj-target-",
  "subj-noforce-",
]);

/**
 * @param {string | null | undefined} key
 * @returns {{ id: string } | null}
 */
export function matchScoreModelKey(key) {
  if (typeof key !== "string" || !key) return null;
  for (const prefix of TEST_SCORE_MODEL_KEY_PREFIXES) {
    if (key.startsWith(prefix) && key.length > prefix.length) return { id: prefix };
  }
  return null;
}

/**
 * Exact identity match only — never bare prefix.
 * @returns {{ id: string, field: string } | null}
 */
export function matchExactCharacterIdentity(displayName, normalizedName) {
  for (const pattern of TEST_CHARACTER_IDENTITY_PATTERNS) {
    if (typeof displayName === "string" && pattern.displayName.test(displayName)) {
      return { id: pattern.id, field: "displayName" };
    }
    if (
      pattern.normalizedName &&
      typeof normalizedName === "string" &&
      pattern.normalizedName.test(normalizedName)
    ) {
      return { id: pattern.id, field: "normalizedName" };
    }
  }
  return null;
}

/** @deprecated Use matchExactCharacterIdentity — kept for transitional imports. */
export function matchTestCharacterIdentity(displayName, normalizedName) {
  const m = matchExactCharacterIdentity(displayName, normalizedName);
  if (!m) return null;
  return { kind: m.field, prefix: m.id };
}

/**
 * @param {string | null | undefined} dedupeKey
 * @returns {{ id: string } | null}
 */
export function matchIngestionDedupeKey(dedupeKey) {
  if (typeof dedupeKey !== "string" || !dedupeKey) return null;
  for (const { id, re } of TEST_INGESTION_DEDUPE_KEY_PATTERNS) {
    if (re.test(dedupeKey)) return { id };
  }
  return null;
}

/**
 * @param {unknown} payload
 * @returns {{ id: string, name: string } | null}
 */
export function matchIngestionPayloadName(payload) {
  if (!payload || typeof payload !== "object") return null;
  const name = /** @type {{ name?: unknown }} */ (payload).name;
  if (typeof name !== "string") return null;
  for (const { id, re } of TEST_INGESTION_PAYLOAD_NAME_PATTERNS) {
    if (re.test(name)) return { id, name };
  }
  return null;
}

/**
 * @param {string | null | undefined} logicalKey
 * @returns {{ id: string } | null}
 */
export function matchBulkLogicalKey(logicalKey) {
  if (typeof logicalKey !== "string" || !logicalKey) return null;
  for (const { id, re } of TEST_BULK_LOGICAL_KEY_PATTERNS) {
    if (re.test(logicalKey)) return { id };
  }
  return null;
}

export function matchTestRealmSlug(slug) {
  if (typeof slug !== "string") return null;
  if (TEST_REALM_SLUGS.includes(slug)) return slug;
  for (const prefix of TEST_REALM_SLUG_PREFIXES) {
    if (slug.startsWith(prefix) && slug.length > prefix.length) return prefix;
  }
  return null;
}

export function matchTestDungeonSlug(slug) {
  if (typeof slug !== "string") return null;
  for (const prefix of TEST_DUNGEON_SLUG_PREFIXES) {
    if (slug.startsWith(prefix) && slug.length > prefix.length) return prefix;
  }
  return null;
}

export function isTestSeasonSlug(slug) {
  return typeof slug === "string" && TEST_SEASON_SLUGS.includes(slug);
}

/** True when logicalKey is a production-style activation key (not exclusive). */
export function isModelActivateLogicalKey(logicalKey) {
  return typeof logicalKey === "string" && logicalKey.startsWith("model-activate:");
}

/** True when dedupeKey is a discover-owned job (not exclusive alone). */
export function isDiscoverDedupeKey(dedupeKey) {
  return typeof dedupeKey === "string" && dedupeKey.startsWith("discover:");
}

/**
 * Back-compat exports used by older tests (prefix arrays derived from patterns).
 * Prefer the exact matchers above.
 */
export const TEST_CHARACTER_DISPLAY_NAME_PREFIXES = Object.freeze(
  TEST_CHARACTER_IDENTITY_PATTERNS.map((p) => p.id),
);
export const TEST_CHARACTER_NORMALIZED_NAME_PREFIXES = Object.freeze([]);
export const TEST_INGESTION_DEDUPE_KEY_PREFIXES = Object.freeze(
  TEST_INGESTION_DEDUPE_KEY_PATTERNS.map((p) => p.id),
);
export const TEST_INGESTION_PAYLOAD_NAME_PREFIXES = Object.freeze(
  TEST_INGESTION_PAYLOAD_NAME_PATTERNS.map((p) => p.id),
);
export const TEST_BULK_LOGICAL_KEY_PREFIXES = Object.freeze(
  TEST_BULK_LOGICAL_KEY_PATTERNS.map((p) => p.id),
);

export function matchPrefix(value, prefixes) {
  if (typeof value !== "string" || !value) return null;
  for (const prefix of prefixes) {
    if (value.startsWith(prefix)) return prefix;
  }
  return null;
}
