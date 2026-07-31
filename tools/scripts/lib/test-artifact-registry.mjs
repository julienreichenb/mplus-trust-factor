/**
 * Authoritative allowlist of automated-test durable markers.
 * Derived from repository test suites — do not invent markers without evidence.
 *
 * Isolation (mplus_itest_*) is primary protection; this registry drives
 * operational cleanup of historical pollution only.
 */

/** Score model `key` prefixes (exact startsWith). */
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

export const CANONICAL_SCORE_MODEL_KEYS = Object.freeze(["default"]);

/**
 * Character `displayName` prefixes (exact startsWith).
 * Includes uniqueName("X") → "X-<8hex>" forms and literal AdminRefresh* / Bulk* forms.
 */
export const TEST_CHARACTER_DISPLAY_NAME_PREFIXES = Object.freeze([
  "AdminRefresh",
  "PubCancel",
  "BulkUx",
  "Bulk",
  "Hist",
  "Iamcd",
  "Force",
  "Freshcharacter-",
  "Stalecharacter-",
  "LastPublicOnly-",
  "ReuseStaleJob-",
  "MissingCharacter-",
  "Cooldowncharacter-",
  "JobLookupCharacter-",
  "SecondRefresh-",
  "ConcurrentRefresh-",
  "EnrichmentFields-",
  "RefreshPollTerminal-",
  "NormalRefreshOk-",
  "ForceDenied-",
  "ForceAdminOk-",
  "StaleOnceMore-",
  "RerollAnon-",
  "RerollViewer-",
  "MainA-",
  "AltA-",
  "OnlyB-",
  "Ac0xx-",
  "Ac1xx-",
  "Ac2xx-",
  "Ac3xx-",
  "Ac4xx-",
  "Ac5xx-",
  "Ac6xx-",
  "Ac7xx-",
  "Ac8xx-",
  "Ac9xx-",
  "LowLevelResolve-",
  "AdminRecalcTarget-",
  "CompareA-",
  "CompareB-",
  "RankEligA-",
  "RankEligB-",
  "MismatchA-",
  "MismatchB-",
  "DisabledBlizzardChar-",
  "DisabledBlizzardStatus-",
  "Examplecharacter-",
  "DisabledProviderChar-",
  "NoRaiderIo-",
  "RioFail-",
  "disabled-test-",
  "DedupeChar-",
  "RequeueChar-",
  "InvalidSnap-",
  "NoPublicLogs-",
  "AsyncWclOnly-",
  "WclParseFail-",
  "UnexpectedFail-",
  "Wallidrixe-",
  "Wallidrixe",
  "Chérith",
  "E2eApiA-",
  "E2eApiB-",
  "E2eplayerA-",
  "E2eplayerB-",
]);

/**
 * Character `normalizedName` prefixes (lowercase).
 * Prefer matching displayName first; these catch admin-refresh-jobs style rows.
 */
export const TEST_CHARACTER_NORMALIZED_NAME_PREFIXES = Object.freeze([
  "adminrefresh",
  "pubcancel",
  "bulkux",
  "wallidrixe-",
  "wallidrixe",
  "cherith-",
  "cherith",
  "freshcharacter-",
  "stalecharacter-",
  "normalrefreshok-",
  "staleoncemore-",
  "e2eapia-",
  "e2eapib-",
  "e2eplayera-",
  "e2eplayerb-",
]);

/** Realm slugs created exclusively by tests. */
export const TEST_REALM_SLUGS = Object.freeze([
  "admin-refresh-realm",
  "pub-cancel-realm",
  "iam-test-realm",
]);

/** Realm slug prefixes (bulk-ux-<timestamp>). */
export const TEST_REALM_SLUG_PREFIXES = Object.freeze(["bulk-ux-"]);

/** Dungeon slug prefixes. */
export const TEST_DUNGEON_SLUG_PREFIXES = Object.freeze(["admin-test-dungeon-"]);

/** Season slugs created exclusively by tests. */
export const TEST_SEASON_SLUGS = Object.freeze(["pub-cancel-season"]);

/** IngestionJob.dedupeKey prefixes (literal test inserts, not SHA-256 production keys). */
export const TEST_INGESTION_DEDUPE_KEY_PREFIXES = Object.freeze([
  "refresh:old:",
  "refresh:new:",
  "refresh:queued:",
  "refresh:model:",
  "refresh:nomodel:",
  "admin-prio-",
  "discover:",
  "stub-",
  "stub-bulk-",
  "test-reuse-",
  "force-reuse-",
  "concurrent-",
  "bulk-child-",
  "pub-cancel-",
  "test-dedupe-",
]);

/**
 * IngestionJob.payload.name prefixes (may differ from Character.displayName).
 * Exact startsWith on the JSON payload name field.
 */
export const TEST_INGESTION_PAYLOAD_NAME_PREFIXES = Object.freeze([
  "FailChar",
  "QueuedChar",
  "ModelChar",
  "NoModelChar",
  "Prio",
  "AdminRefresh",
  "NormalRefreshOk-",
  "StaleOnceMore-",
  "E2eApiA-",
  "E2eApiB-",
  "E2eplayerA-",
  "E2eplayerB-",
]);

/** BulkOperation.logicalKey prefixes. */
export const TEST_BULK_LOGICAL_KEY_PREFIXES = Object.freeze([
  "test-bulk-",
  "pause-cancel-",
  "missing-chars-",
  "explicit-",
  "race-bulk-",
  "concurrent-",
  "paused-terminal-",
  "counters-",
  "childjob-",
  "fk-",
  "test-in-use-",
  "model-activate:",
]);

/** MechanicRule.source values that are test-only. */
export const TEST_MECHANIC_RULE_SOURCES = Object.freeze(["test-fixture"]);

/** User.externalSubject prefixes created by tests. */
export const TEST_USER_EXTERNAL_SUBJECT_PREFIXES = Object.freeze([
  "force-denied-",
  "reroll-viewer-",
  "reroll-a-",
  "reroll-b-",
  "redis-loss-",
  "bulk-user-",
  "bnet-",
  "subj-normal-",
  "subj-boss-",
  "subj-target-",
  "subj-noforce-",
]);

/**
 * @param {string | null | undefined} value
 * @param {readonly string[]} prefixes
 * @returns {string | null} matched prefix or null
 */
export function matchPrefix(value, prefixes) {
  if (typeof value !== "string" || !value) return null;
  for (const prefix of prefixes) {
    if (value.startsWith(prefix)) return prefix;
  }
  return null;
}

/**
 * @param {string | null | undefined} key
 * @returns {string | null}
 */
export function matchScoreModelKey(key) {
  return matchPrefix(key, TEST_SCORE_MODEL_KEY_PREFIXES);
}

/**
 * @param {string | null | undefined} displayName
 * @param {string | null | undefined} normalizedName
 * @returns {{ kind: string, prefix: string } | null}
 */
export function matchTestCharacterIdentity(displayName, normalizedName) {
  const d = matchPrefix(displayName, TEST_CHARACTER_DISPLAY_NAME_PREFIXES);
  if (d) return { kind: "displayName", prefix: d };
  const n = matchPrefix(
    typeof normalizedName === "string" ? normalizedName.toLowerCase() : normalizedName,
    TEST_CHARACTER_NORMALIZED_NAME_PREFIXES,
  );
  if (n) return { kind: "normalizedName", prefix: n };
  return null;
}

/**
 * @param {string | null | undefined} dedupeKey
 * @returns {string | null}
 */
export function matchIngestionDedupeKey(dedupeKey) {
  return matchPrefix(dedupeKey, TEST_INGESTION_DEDUPE_KEY_PREFIXES);
}

/**
 * @param {unknown} payload
 * @returns {string | null}
 */
export function matchIngestionPayloadName(payload) {
  if (!payload || typeof payload !== "object") return null;
  const name = /** @type {{ name?: unknown }} */ (payload).name;
  if (typeof name !== "string") return null;
  return matchPrefix(name, TEST_INGESTION_PAYLOAD_NAME_PREFIXES);
}

/**
 * @param {string | null | undefined} logicalKey
 * @returns {string | null}
 */
export function matchBulkLogicalKey(logicalKey) {
  return matchPrefix(logicalKey, TEST_BULK_LOGICAL_KEY_PREFIXES);
}

/**
 * @param {string | null | undefined} slug
 * @returns {string | null}
 */
export function matchTestRealmSlug(slug) {
  if (typeof slug !== "string") return null;
  if (TEST_REALM_SLUGS.includes(slug)) return slug;
  return matchPrefix(slug, TEST_REALM_SLUG_PREFIXES);
}

/**
 * @param {string | null | undefined} slug
 * @returns {string | null}
 */
export function matchTestDungeonSlug(slug) {
  return matchPrefix(slug, TEST_DUNGEON_SLUG_PREFIXES);
}

/**
 * @param {string | null | undefined} slug
 * @returns {boolean}
 */
export function isTestSeasonSlug(slug) {
  return typeof slug === "string" && TEST_SEASON_SLUGS.includes(slug);
}
