/**
 * Canonical WCL Report → Fight ownership invariant.
 *
 * A fight belongs to a target character only when:
 * - the report is public;
 * - the fight is Mythic+ (`keystoneLevel > 0`);
 * - the character is resolved in masterData by normalized name + realm;
 * - the resolved report-local actor ID is present in fight.friendlyPlayers.
 *
 * Never attribute a fight from report-wide masterData alone.
 */

export type FightOwnershipRejectionReason =
  | "TARGET_NOT_IN_REPORT"
  | "TARGET_NOT_IN_FIGHT"
  | "TARGET_AMBIGUOUS"
  | "FIGHT_NOT_MYTHIC_PLUS"
  | "FIGHT_INCOMPLETE";

export interface FightOwnershipActor {
  id: number;
  name: string;
  type: string;
  server?: string | null;
}

export type FightFriendlyPlayerEntry = number | { id: number; name?: string; server?: string };

export interface ResolveFightOwnershipInput {
  actors: FightOwnershipActor[];
  friendlyPlayers?: FightFriendlyPlayerEntry[] | null;
  characterName: string;
  realmSlug: string;
  /** When set, non-M+ fights are rejected as FIGHT_NOT_MYTHIC_PLUS. */
  keystoneLevel?: number | null;
  /** When true, reject as FIGHT_INCOMPLETE. */
  inProgress?: boolean | null;
  /** When true (default), require keystoneLevel > 0. */
  requireMythicPlus?: boolean;
}

export interface FightOwnershipProof {
  targetActorId: number | null;
  fightFriendlyPlayerActorIds: number[];
  targetInFight: boolean;
  reason: FightOwnershipRejectionReason | null;
}

export type FightOwnershipResult =
  | (FightOwnershipProof & {
      ok: true;
      targetActorId: number;
      targetInFight: true;
      reason: null;
    })
  | (FightOwnershipProof & {
      ok: false;
      targetInFight: false;
      reason: FightOwnershipRejectionReason;
    });

/**
 * Deterministic WCL realm / server identity key.
 * NFKC + lower-case; whitespace and underscores collapse to a single hyphen.
 * Never used for substring / prefix ownership proofs.
 */
export function normalizeWclRealmSlug(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Fail-closed name+realm identity match.
 * - exact normalized name equality
 * - exact normalized realm equality (never substring)
 * - missing actor.server does not prove ownership
 */
export function nameRealmMatches(
  name: string | undefined,
  server: string | null | undefined,
  characterName: string,
  realmSlug: string,
): boolean {
  const targetName = characterName.normalize("NFKC").trim().toLocaleLowerCase("en-US");
  const actorName = (name ?? "").normalize("NFKC").trim().toLocaleLowerCase("en-US");
  if (!actorName || actorName !== targetName) return false;

  const serverRaw = typeof server === "string" ? server.trim() : "";
  if (!serverRaw) return false;

  const targetRealm = normalizeWclRealmSlug(realmSlug);
  const normalizedServer = normalizeWclRealmSlug(serverRaw);
  if (!targetRealm || !normalizedServer) return false;
  return normalizedServer === targetRealm;
}

/** Extract report-local actor IDs from fight.friendlyPlayers (scalar or object form). */
export function extractFriendlyPlayerActorIds(
  friendlyPlayers: FightFriendlyPlayerEntry[] | null | undefined,
): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const entry of friendlyPlayers ?? []) {
    const id = typeof entry === "number" ? entry : entry.id;
    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * Resolve the target's report-local actor ID and prove fight membership.
 * Does not fetch events. Safe to call before any ReportEvents request.
 */
export function resolveFightOwnership(input: ResolveFightOwnershipInput): FightOwnershipResult {
  const fightFriendlyPlayerActorIds = extractFriendlyPlayerActorIds(input.friendlyPlayers);
  const requireMythicPlus = input.requireMythicPlus !== false;

  if (input.inProgress === true) {
    return {
      ok: false,
      targetActorId: null,
      fightFriendlyPlayerActorIds,
      targetInFight: false,
      reason: "FIGHT_INCOMPLETE",
    };
  }

  if (
    requireMythicPlus &&
    !(typeof input.keystoneLevel === "number" && input.keystoneLevel > 0)
  ) {
    return {
      ok: false,
      targetActorId: null,
      fightFriendlyPlayerActorIds,
      targetInFight: false,
      reason: "FIGHT_NOT_MYTHIC_PLUS",
    };
  }

  const playerMatches = input.actors.filter(
    (actor) =>
      actor.type === "Player" &&
      nameRealmMatches(actor.name, actor.server, input.characterName, input.realmSlug),
  );

  if (playerMatches.length === 0) {
    return {
      ok: false,
      targetActorId: null,
      fightFriendlyPlayerActorIds,
      targetInFight: false,
      reason: "TARGET_NOT_IN_REPORT",
    };
  }

  if (playerMatches.length > 1) {
    const distinctIds = [...new Set(playerMatches.map((a) => a.id))];
    if (distinctIds.length > 1) {
      return {
        ok: false,
        targetActorId: null,
        fightFriendlyPlayerActorIds,
        targetInFight: false,
        reason: "TARGET_AMBIGUOUS",
      };
    }
  }

  const targetActorId = playerMatches[0]!.id;
  const inFight = fightFriendlyPlayerActorIds.includes(targetActorId);
  if (!inFight) {
    return {
      ok: false,
      targetActorId,
      fightFriendlyPlayerActorIds,
      targetInFight: false,
      reason: "TARGET_NOT_IN_FIGHT",
    };
  }

  return {
    ok: true,
    targetActorId,
    fightFriendlyPlayerActorIds,
    targetInFight: true,
    reason: null,
  };
}

/** Structured rejection detail for acquisition / provider errors. */
export function fightOwnershipRejectionDetail(
  reason: FightOwnershipRejectionReason,
  extras?: { targetActorId?: number | null; fightId?: number },
): string {
  const parts: string[] = [reason];
  if (extras?.fightId != null) parts.push(`fight=${extras.fightId}`);
  if (extras?.targetActorId != null) parts.push(`actor=${extras.targetActorId}`);
  return parts.join(":");
}
