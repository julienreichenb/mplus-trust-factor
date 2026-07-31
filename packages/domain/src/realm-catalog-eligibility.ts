/**
 * Public retail realm catalog eligibility.
 *
 * Based on live Blizzard Game Data inspection (EU/US/KR/TW realm index + details).
 * See doc/research/providers/blizzard-realm-visibility.md.
 */

export type RealmCatalogRejectionReason =
  | "TOURNAMENT"
  | "INTERNAL_ACCOUNT_REALM"
  | "INTERNAL_INSTANCE_REALM"
  | "INTERNAL_SERVICE_REALM"
  | "MISSING_REQUIRED_DETAIL";

export type RealmCatalogEligibility =
  | { eligible: true }
  | { eligible: false; reason: RealmCatalogRejectionReason };

export interface RealmCatalogClassifyInput {
  name: string;
  slug: string;
  blizzardRealmId?: number | null;
  region?: string | null;
  isTournament?: boolean | null;
  connectedRealmId?: number | null;
  /** When false, skip connected-realm requirement (index-only early reject). Default true. */
  requireConnectedRealm?: boolean;
}

const RETAIL_REGIONS = new Set(["EU", "US", "KR", "TW"]);

/** Index-row early reject using name/slug only (no detail fields required). */
export function classifyRealmIndexEntry(input: {
  name: string;
  slug: string;
}): RealmCatalogEligibility {
  return classifyInternalNaming(input.name, input.slug) ?? { eligible: true };
}

/**
 * Full classification from normalized realm detail (or enriched catalog row).
 */
export function classifyRealmCatalogEntry(input: RealmCatalogClassifyInput): RealmCatalogEligibility {
  if (input.isTournament === true) {
    return { eligible: false, reason: "TOURNAMENT" };
  }

  const naming = classifyInternalNaming(input.name, input.slug);
  if (naming) return naming;

  const id = input.blizzardRealmId;
  if (id == null || !Number.isFinite(id) || id <= 0) {
    return { eligible: false, reason: "MISSING_REQUIRED_DETAIL" };
  }
  const name = input.name?.trim() ?? "";
  const slug = input.slug?.trim() ?? "";
  if (!name || !slug) {
    return { eligible: false, reason: "MISSING_REQUIRED_DETAIL" };
  }
  const region = (input.region ?? "").trim().toUpperCase();
  if (region && !RETAIL_REGIONS.has(region)) {
    return { eligible: false, reason: "MISSING_REQUIRED_DETAIL" };
  }

  if (input.requireConnectedRealm !== false) {
    const cr = input.connectedRealmId;
    if (cr == null || !Number.isFinite(cr) || cr <= 0) {
      return { eligible: false, reason: "MISSING_REQUIRED_DETAIL" };
    }
  }

  return { eligible: true };
}

function classifyInternalNaming(name: string, slug: string): RealmCatalogEligibility | null {
  const n = name ?? "";
  const s = (slug ?? "").toLowerCase();

  // Invariant English phrase on Blizzard account-shadow realms across all regions.
  if (/account\s+realm/i.test(n) || s.includes("account-realm") || s.includes("account_realm")) {
    return { eligible: false, reason: "INTERNAL_ACCOUNT_REALM" };
  }

  if (isInternalInstanceRealm(n, s)) {
    return { eligible: false, reason: "INTERNAL_INSTANCE_REALM" };
  }

  // Battleground / arena-pass / GM / auxiliary service realms (confirmed live).
  if (
    /(?:^|[\s_-])BG(?:[\s_-]|$)/i.test(n) ||
    /^[a-z]{2}\d+[a-z]*bg(?:-|$)/i.test(s) ||
    /arena\s*pass/i.test(n) ||
    s.includes("arena-pass") ||
    /\bauxiliary\b/i.test(n) ||
    s.includes("auxiliary") ||
    /^GMSupport\b/i.test(n) ||
    s.startsWith("gmsupport")
  ) {
    return { eligible: false, reason: "INTERNAL_SERVICE_REALM" };
  }

  return null;
}

/**
 * Instance / shard pools.
 * Live names keep "-INST" / "-INST-BFA"; normalized slugs often collapse to "eu7a1inst".
 */
function isInternalInstanceRealm(name: string, slugLower: string): boolean {
  if (/-INST(?:-|$)/i.test(name)) return true;
  if (/(?:^|[\s])INST(?:[\s-]|$)/i.test(name)) return true;
  if (/-inst(?:-|$)/i.test(slugLower)) return true;
  // Collapsed cell slug: eu7a1inst, us1a2inst, kr1a1inst, …
  if (/^[a-z]{2}\d+[a-z]\d*inst(?:-|$)/i.test(slugLower)) return true;
  return false;
}
